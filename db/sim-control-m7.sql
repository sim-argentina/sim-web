-- ============================================================================
-- SIM Control · M7 — Recepción de jornadas, verificación y conciliación agregada
-- ----------------------------------------------------------------------------
-- El proyecto NO tiene migraciones versionadas: este archivo es la FUENTE DE
-- VERDAD del cambio. Es ADITIVO, SEGURO e IDEMPOTENTE:
--   · create table/index/type IF NOT EXISTS (o guardas equivalentes)
--   · no borra, no altera ni toca ninguna tabla existente
--   · no modifica turnos_stand, reservas, reserva_slots ni reserva_operacion
--
-- Alcance: recibir el paquete de cierre de una terminal de SIM Control,
-- guardarlo entero e inmutable, proyectar sus entidades, y conciliar la jornada
-- contra la actividad comercial central.
--
-- ── La unidad de conciliación es SIMULADOR-MINUTOS ──────────────────────────
-- Un simulador ocupado un minuto = 1. Cuatro cabinas media hora = 120, igual que
-- una cabina dos horas. NO se concilia por identidad de cabina: "Ferrari",
-- "McLaren", "Red Bull" y "Alpine" son nombres visuales de cuatro cabinas
-- comercialmente equivalentes, y pueden pasar a ser todas iguales.
--
-- ── Seguridad ───────────────────────────────────────────────────────────────
-- Todas las tablas quedan con RLS habilitada y SIN policies: deny-by-default.
-- Solo el backend (service_role, que hace bypass de RLS) las toca. `anon` y
-- `authenticated` no tienen acceso directo — mismo patrón que reservas/bloqueos.
--
-- NUNCA se guarda el token de una terminal: solo su hash.
-- ============================================================================

-- ── sim_control_terminals ───────────────────────────────────────────────────
-- Una fila por PC de SIM Control. `terminal_key` es el TerminalId local, que la
-- terminal manda en cada request; el resto es identidad central estable.
--
-- `simulator_label` es SOLO informativo (qué cabina suele ser, para el panel).
-- La conciliación NO lo usa y nada se bloquea por él.
create table if not exists public.sim_control_terminals (
  id              uuid primary key default gen_random_uuid(),
  terminal_key    text not null unique,
  display_name    text not null,
  simulator_label text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_seen_at    timestamptz,
  last_sync_at    timestamptz,
  deactivated_at  timestamptz,
  notes           text,
  constraint sim_control_terminals_key_no_vacia
    check (char_length(btrim(terminal_key)) between 1 and 64),
  constraint sim_control_terminals_nombre_no_vacio
    check (char_length(btrim(display_name)) between 1 and 80)
);

create index if not exists sim_control_terminals_activas_idx
  on public.sim_control_terminals (active) where active;

alter table public.sim_control_terminals enable row level security;

-- ── sim_control_terminal_credentials ────────────────────────────────────────
-- Credencial por terminal. El token es aleatorio de 256 bits y se muestra UNA
-- sola vez al generarlo: acá vive únicamente su hash.
--
-- `token_prefix` son los primeros caracteres del token, para que el panel pueda
-- decir "la que empieza con a3f9…" sin guardar nada secreto.
create table if not exists public.sim_control_terminal_credentials (
  id           uuid primary key default gen_random_uuid(),
  terminal_id  uuid not null references public.sim_control_terminals(id) on delete cascade,
  token_hash   text not null unique,
  token_prefix text not null,
  created_at   timestamptz not null default now(),
  created_by   text,
  revoked_at   timestamptz,
  revoked_by   text,
  last_used_at timestamptz,
  constraint sim_control_credentials_hash_formato
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint sim_control_credentials_prefijo_corto
    check (char_length(token_prefix) between 4 and 12)
);

-- Una sola credencial ACTIVA por terminal: rotar revoca la anterior.
create unique index if not exists sim_control_credentials_una_activa_idx
  on public.sim_control_terminal_credentials (terminal_id) where revoked_at is null;

alter table public.sim_control_terminal_credentials enable row level security;

-- ── sim_control_sync_packages ───────────────────────────────────────────────
-- El paquete tal como llegó. `payload` y `payload_sha256` son INMUTABLES: no se
-- "arreglan" centralmente nunca. Una corrección es un registro administrativo
-- aparte, jamás una mutación del original.
create table if not exists public.sim_control_sync_packages (
  -- El PackageId que generó la terminal. Es la identidad técnica del envío.
  id                   uuid primary key,
  terminal_id          uuid not null references public.sim_control_terminals(id),
  terminal_key         text not null,
  business_date        date not null,
  sequence             integer not null,
  closure_id           uuid not null,
  -- Período comercial que cubre este paquete. `cutoff_utc` (= periodEndUtc del
  -- payload) es el instante REAL en que se cerró la jornada, sellado por SIM
  -- Control y nunca modificado.
  --
  -- Es EL corte de la conciliación de este paquete: reintentarlo meses después
  -- tiene que comparar contra el mismo momento, no contra el reloj del reintento.
  -- Sin esto, los turnos de las 20:00 harían "fallar" el cierre de las 19:00.
  period_start_utc     timestamptz,
  cutoff_utc           timestamptz not null,
  schema_version       text not null,
  protocol_version     integer not null,
  payload_sha256       text not null,
  payload              jsonb not null,
  payload_bytes        integer not null,
  session_count        integer not null default 0,
  intervention_count   integer not null default 0,
  performance_count    integer not null default 0,
  -- Denormalizado del payload para poder sumar la jornada sin abrir el JSON.
  reconcilable_minutes integer not null default 0,
  status               text not null,
  -- Identificador central ESTABLE del comprobante: un reintento devuelve el mismo.
  receipt_id           text not null unique,
  received_at          timestamptz not null default now(),
  -- Se sella UNA sola vez. Un paquete que alcanzó `verified` no vuelve atrás
  -- nunca: la actividad posterior del mismo día se verifica con los paquetes
  -- siguientes, no revisando hacia atrás un cierre que ya cerró.
  verified_at          timestamptz,
  last_evaluated_at    timestamptz,
  constraint sim_control_packages_hash_formato
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sim_control_packages_estado_valido
    check (status in ('received', 'data_verified', 'verified', 'reconciliation_pending', 'mismatch')),
  constraint sim_control_packages_secuencia_positiva
    check (sequence >= 1)
);

-- Identidad de negocio del cierre. Si dos paquetes distintos dicen ser el mismo
-- cierre de la misma terminal, es un conflicto real y se rechaza con 409.
create unique index if not exists sim_control_packages_identidad_idx
  on public.sim_control_sync_packages (terminal_id, business_date, sequence);

create index if not exists sim_control_packages_fecha_idx
  on public.sim_control_sync_packages (business_date);

create index if not exists sim_control_packages_estado_idx
  on public.sim_control_sync_packages (status);

alter table public.sim_control_sync_packages enable row level security;

-- ── sim_control_sync_entities ───────────────────────────────────────────────
-- Índice de idempotencia a nivel ENTIDAD, además del PackageId. Si la misma
-- sesión aparece en dos paquetes (pasa tras un override de OWNER), se guarda una
-- sola vez. Si vuelve con OTRO contenido, es un conflicto y se informa.
create table if not exists public.sim_control_sync_entities (
  id              uuid primary key default gen_random_uuid(),
  terminal_id     uuid not null references public.sim_control_terminals(id),
  entity_type     text not null,
  local_entity_id uuid not null,
  content_sha256  text not null,
  first_package_id uuid not null references public.sim_control_sync_packages(id),
  first_seen_at   timestamptz not null default now(),
  constraint sim_control_entities_tipo_valido
    check (entity_type in ('session', 'intervention', 'performance'))
);

-- LA restricción que impide duplicar una sesión por un bug de empaquetado.
create unique index if not exists sim_control_entities_identidad_idx
  on public.sim_control_sync_entities (terminal_id, entity_type, local_entity_id);

alter table public.sim_control_sync_entities enable row level security;

-- ── sim_control_sessions ────────────────────────────────────────────────────
-- Proyección normalizada de los turnos. `counts_for_reconciliation` es
-- AUTORITATIVO: lo decidió SIM Control con el contexto operativo completo y el
-- receptor no lo vuelve a deducir.
--
-- `business_date` se denormaliza desde el paquete para poder sumar una jornada
-- con un solo índice, sin importar en cuántos paquetes viajaron sus sesiones.
create table if not exists public.sim_control_sessions (
  id                          uuid primary key default gen_random_uuid(),
  terminal_id                 uuid not null references public.sim_control_terminals(id),
  terminal_key                text not null,
  local_session_id            uuid not null,
  package_id                  uuid not null references public.sim_control_sync_packages(id),
  business_date               date not null,
  session_type                text not null,
  status                      text not null,
  billable                    boolean not null,
  counts_for_reconciliation   boolean not null,
  base_duration_minutes       integer not null default 0,
  extension_minutes_total     integer not null default 0,
  authorized_duration_minutes integer not null default 0,
  actual_commercial_seconds   integer not null default 0,
  started_at_utc              timestamptz,
  active_started_at_utc       timestamptz,
  finished_at_utc             timestamptz,
  opened_by_operator_id       uuid,
  opened_by_display_name      text,
  restart_of_session_id       uuid,
  replaced_by_session_id      uuid,
  reset_count                 integer not null default 0,
  created_at                  timestamptz not null default now()
);

create unique index if not exists sim_control_sessions_identidad_idx
  on public.sim_control_sessions (terminal_id, local_session_id);

-- El índice que usa la conciliación: sumar los minutos autorizados de una fecha.
create index if not exists sim_control_sessions_conciliacion_idx
  on public.sim_control_sessions (business_date, counts_for_reconciliation);

alter table public.sim_control_sessions enable row level security;

-- ── sim_control_interventions ───────────────────────────────────────────────
-- Añadir tiempo / reiniciar turno, con su motivo y quién lo autorizó. Es lo que
-- explica por qué un turno de 15 duró 20 sin que eso sea una irregularidad.
create table if not exists public.sim_control_interventions (
  id                     uuid primary key default gen_random_uuid(),
  terminal_id            uuid not null references public.sim_control_terminals(id),
  terminal_key           text not null,
  local_intervention_id  uuid not null,
  local_session_id       uuid not null,
  package_id             uuid not null references public.sim_control_sync_packages(id),
  business_date          date not null,
  intervention_type      text not null,
  reason_code            text not null,
  reason_text            text,
  minutes_added          integer,
  operator_id            uuid,
  operator_display_name  text,
  created_at_utc         timestamptz,
  created_at             timestamptz not null default now()
);

create unique index if not exists sim_control_interventions_identidad_idx
  on public.sim_control_interventions (terminal_id, local_intervention_id);

create index if not exists sim_control_interventions_fecha_idx
  on public.sim_control_interventions (business_date);

alter table public.sim_control_interventions enable row level security;

-- ── sim_control_session_performance ─────────────────────────────────────────
-- Resultado deportivo del turno (telemetría de F1). Es diagnóstico y servicio al
-- cliente, NO caja: la conciliación no lo mira.
--
-- `is_demo_data` marca datos ficticios de modo Demo: nunca presentarlos como
-- reales ni usarlos para métricas.
create table if not exists public.sim_control_session_performance (
  id                    uuid primary key default gen_random_uuid(),
  terminal_id           uuid not null references public.sim_control_terminals(id),
  local_session_id      uuid not null,
  package_id            uuid not null references public.sim_control_sync_packages(id),
  business_date         date not null,
  session_kind          text,
  circuit               text,
  laps_completed        integer,
  best_lap_ms           integer,
  best_valid_lap_ms     integer,
  finishing_position    integer,
  result                text,
  time_used_seconds     integer,
  is_demo_data          boolean not null default false,
  created_at            timestamptz not null default now()
);

create unique index if not exists sim_control_performance_identidad_idx
  on public.sim_control_session_performance (terminal_id, local_session_id);

alter table public.sim_control_session_performance enable row level security;

-- ── sim_control_reconciliations ─────────────────────────────────────────────
-- Una CORRIDA de conciliación: la foto de una fecha comercial en un momento
-- dado. NO es "el veredicto final de la fecha" — se recalcula en cada ingestión
-- y en cada reintento, y se guarda una fila nueva cada vez que el resultado
-- cambia. Así una misma fecha puede cuadrar a las 19:00 (120/120), volver a
-- operar, y cuadrar otra vez a las 22:00 (180/180) sin contradicción.
--
-- La regla es puramente agregada y NO mira terminales:
--   SIM Control  <  central → pending   (falta sincronizar)
--   SIM Control  == central → verified
--   SIM Control  >  central → mismatch  (actividad sin respaldo comercial)
--
-- Una terminal que estuvo apagada, fuera de servicio o sin clientes no necesita
-- mandar nada para que las demás verifiquen.
create table if not exists public.sim_control_reconciliations (
  id                       uuid primary key default gen_random_uuid(),
  business_date            date not null,
  -- Corte de ESTA corrida: el `cutoff_utc` del cierre que se está verificando.
  -- Dos cierres del mismo día comercial tienen cortes distintos y por lo tanto
  -- corridas distintas que conviven sin pisarse.
  cutoff_utc               timestamptz not null,
  status                   text not null,
  central_simulator_minutes integer not null default 0,
  local_simulator_minutes   integer not null default 0,
  -- central − local. >0 falta sincronizar; <0 sobra actividad; 0 cuadra.
  difference_minutes        integer not null default 0,
  central_operations        integer not null default 0,
  local_sessions            integer not null default 0,
  -- Solo auditoría: qué terminales aportaron. No participa de la decisión.
  terminal_keys             text[] not null default '{}',
  summary                   text,
  detail                    jsonb not null default '{}'::jsonb,
  is_latest                 boolean not null default true,
  computed_at               timestamptz not null default now(),
  constraint sim_control_reconciliations_estado_valido
    check (status in ('pending', 'verified', 'mismatch'))
);

-- La foto vigente de cada CORTE. Las anteriores del mismo corte quedan como
-- historial, y los distintos cortes del mismo día conviven.
create unique index if not exists sim_control_reconciliations_vigente_idx
  on public.sim_control_reconciliations (business_date, cutoff_utc) where is_latest;

create index if not exists sim_control_reconciliations_historial_idx
  on public.sim_control_reconciliations (business_date, computed_at desc);

create index if not exists sim_control_reconciliations_estado_idx
  on public.sim_control_reconciliations (status) where is_latest;

alter table public.sim_control_reconciliations enable row level security;

-- ── sim_control_reconciliation_items ────────────────────────────────────────
-- De dónde salió cada simulador-minuto esperado en una corrida. Permite explicar
-- un total sin volver a consultar el Turnero, y auditar una diferencia fila por
-- fila. Se guardan solo los de la corrida vigente.
create table if not exists public.sim_control_reconciliation_items (
  id                uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.sim_control_reconciliations(id) on delete cascade,
  business_date     date not null,
  source            text not null,
  source_id         text not null,
  simulator_minutes integer not null default 0,
  formula           text not null,
  excluded_reason   text,
  created_at        timestamptz not null default now(),
  constraint sim_control_reconciliation_items_fuente_valida
    check (source in ('stand', 'reserva')),
  constraint sim_control_reconciliation_items_formula_valida
    check (formula in ('simuladores_x_minutos', 'turnos_x_15', 'excluida'))
);

create index if not exists sim_control_reconciliation_items_fecha_idx
  on public.sim_control_reconciliation_items (business_date);

create unique index if not exists sim_control_reconciliation_items_identidad_idx
  on public.sim_control_reconciliation_items (reconciliation_id, source, source_id);

alter table public.sim_control_reconciliation_items enable row level security;

-- ── sim_control_admin_audit ─────────────────────────────────────────────────
-- Acciones HUMANAS sobre terminales y credenciales. No reemplaza el log del
-- servidor: es el rastro de quién dio de alta, rotó o dio de baja qué.
create table if not exists public.sim_control_admin_audit (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  terminal_id uuid references public.sim_control_terminals(id) on delete set null,
  terminal_key text,
  actor       text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint sim_control_admin_audit_accion_valida
    check (action in (
      'terminal_created', 'terminal_updated', 'terminal_deactivated', 'terminal_reactivated',
      'credential_created', 'credential_rotated', 'credential_revoked'
    ))
);

create index if not exists sim_control_admin_audit_fecha_idx
  on public.sim_control_admin_audit (created_at desc);

alter table public.sim_control_admin_audit enable row level security;

-- ============================================================================
-- Nada de lo anterior concede permisos a anon/authenticated: RLS habilitada y
-- sin policies = deny-by-default. El acceso es exclusivamente server-side con
-- service_role, desde las rutas de /api/sim-control/* y /api/admin/sim-control/*.
-- ============================================================================

-- ============================================================================
-- Ingestión ATÓMICA de un paquete
-- ----------------------------------------------------------------------------
-- Todo esto tiene que pasar o no pasar nada: un paquete "recibido" con 7 de 12
-- sesiones insertadas sería peor que un rechazo, porque quedaría como verdad
-- central incompleta. PostgREST no expone transacciones al cliente, así que la
-- unidad de trabajo vive acá adentro, donde una excepción revierte todo.
--
-- Devuelve un jsonb con el resultado; NUNCA lanza por un conflicto esperable
-- (paquete repetido, hash distinto, entidad incompatible): eso se informa como
-- dato para que la ruta responda el código HTTP correcto.
-- ============================================================================
create or replace function public.sim_control_ingest_package(
  p_terminal_id uuid,
  p_payload     jsonb,
  p_meta        jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_package_id   uuid := (p_payload ->> 'packageId')::uuid;
  v_terminal_key text := p_payload ->> 'terminalId';
  v_business     date := (p_payload ->> 'businessDate')::date;
  v_sequence     integer := (p_payload ->> 'sequence')::integer;
  v_closure_id   uuid := (p_payload ->> 'closureId')::uuid;
  v_hash         text := p_meta ->> 'payloadSha256';
  v_bytes        integer := (p_meta ->> 'payloadBytes')::integer;
  v_receipt_id   text := p_meta ->> 'receiptId';
  v_minutes      integer := coalesce((p_payload -> 'totals' ->> 'reconcilableMinutesTotal')::integer, 0);
  v_existing     public.sim_control_sync_packages%rowtype;
  v_conflict     record;
  v_session      jsonb;
  v_intervention jsonb;
  v_performance  jsonb;
  v_entity       jsonb;
begin
  -- Reentrada: dos requests simultáneos con el mismo PackageId se serializan en
  -- la clave primaria de la tabla. Uno inserta, el otro cae acá. La garantía es
  -- de la base, no de un lock en memoria de Next.js.
  select * into v_existing
  from public.sim_control_sync_packages
  where id = v_package_id
  for update;

  if found then
    if v_existing.payload_sha256 is distinct from v_hash then
      -- Mismo identificador, otro contenido. Es el peor error posible del
      -- protocolo: NUNCA se sobrescribe el paquete original.
      return jsonb_build_object(
        'outcome', 'hash_conflict',
        'receiptId', v_existing.receipt_id,
        'status', v_existing.status
      );
    end if;

    return jsonb_build_object(
      'outcome', 'already_processed',
      'receiptId', v_existing.receipt_id,
      'status', v_existing.status
    );
  end if;

  -- Entidades ya vistas con OTRO contenido. La misma sesión puede llegar en dos
  -- paquetes (pasa tras un override de OWNER) y eso es idempotente; si vuelve
  -- con datos distintos, alguien está reescribiendo historia y se rechaza todo.
  select e.entity_type as etype, e.local_entity_id as eid
    into v_conflict
  from jsonb_array_elements(coalesce(p_meta -> 'entities', '[]'::jsonb)) as x(item)
  join public.sim_control_sync_entities e
    on e.terminal_id = p_terminal_id
   and e.entity_type = (x.item ->> 'entityType')
   and e.local_entity_id = (x.item ->> 'localEntityId')::uuid
  where e.content_sha256 is distinct from (x.item ->> 'contentSha256')
  limit 1;

  if found then
    return jsonb_build_object(
      'outcome', 'entity_conflict',
      'entityType', v_conflict.etype,
      'localEntityId', v_conflict.eid
    );
  end if;

  insert into public.sim_control_sync_packages (
    id, terminal_id, terminal_key, business_date, sequence, closure_id,
    period_start_utc, cutoff_utc,
    schema_version, protocol_version, payload_sha256, payload, payload_bytes,
    session_count, intervention_count, performance_count, reconcilable_minutes,
    status, receipt_id, received_at
  ) values (
    v_package_id, p_terminal_id, v_terminal_key, v_business, v_sequence, v_closure_id,
    (p_payload ->> 'periodStartUtc')::timestamptz,
    -- El corte de este cierre. Se guarda como columna propia porque se consulta
    -- en cada reintento y define contra qué momento se concilia.
    (p_payload ->> 'periodEndUtc')::timestamptz,
    p_payload ->> 'schemaVersion', (p_payload ->> 'protocolVersion')::integer, v_hash, p_payload, v_bytes,
    jsonb_array_length(coalesce(p_payload -> 'sessions', '[]'::jsonb)),
    jsonb_array_length(coalesce(p_payload -> 'interventions', '[]'::jsonb)),
    jsonb_array_length(coalesce(p_payload -> 'performance', '[]'::jsonb)),
    v_minutes, 'data_verified', v_receipt_id, now()
  );

  for v_session in select * from jsonb_array_elements(coalesce(p_payload -> 'sessions', '[]'::jsonb))
  loop
    insert into public.sim_control_sessions (
      terminal_id, terminal_key, local_session_id, package_id, business_date,
      session_type, status, billable, counts_for_reconciliation,
      base_duration_minutes, extension_minutes_total, authorized_duration_minutes,
      actual_commercial_seconds, started_at_utc, active_started_at_utc, finished_at_utc,
      opened_by_operator_id, opened_by_display_name, restart_of_session_id,
      replaced_by_session_id, reset_count
    ) values (
      p_terminal_id, v_terminal_key, (v_session ->> 'sessionId')::uuid, v_package_id, v_business,
      v_session ->> 'sessionType', v_session ->> 'status',
      (v_session ->> 'billable')::boolean, (v_session ->> 'countsForReconciliation')::boolean,
      coalesce((v_session ->> 'baseDurationMinutes')::integer, 0),
      coalesce((v_session ->> 'extensionMinutesTotal')::integer, 0),
      coalesce((v_session ->> 'authorizedDurationMinutes')::integer, 0),
      coalesce((v_session ->> 'actualCommercialSeconds')::integer, 0),
      (v_session ->> 'startedAtUtc')::timestamptz,
      (v_session ->> 'activeStartedAtUtc')::timestamptz,
      (v_session ->> 'finishedAtUtc')::timestamptz,
      (v_session ->> 'openedByOperatorId')::uuid, v_session ->> 'openedByDisplayName',
      (v_session ->> 'restartOfSessionId')::uuid, (v_session ->> 'replacedBySessionId')::uuid,
      coalesce((v_session ->> 'resetCount')::integer, 0)
    )
    -- Ya la teníamos con el mismo contenido (verificado arriba): no se duplica.
    on conflict (terminal_id, local_session_id) do nothing;
  end loop;

  for v_intervention in select * from jsonb_array_elements(coalesce(p_payload -> 'interventions', '[]'::jsonb))
  loop
    insert into public.sim_control_interventions (
      terminal_id, terminal_key, local_intervention_id, local_session_id, package_id,
      business_date, intervention_type, reason_code, reason_text, minutes_added,
      operator_id, operator_display_name, created_at_utc
    ) values (
      p_terminal_id, v_terminal_key, (v_intervention ->> 'interventionId')::uuid,
      (v_intervention ->> 'sessionId')::uuid, v_package_id, v_business,
      v_intervention ->> 'type', v_intervention ->> 'reasonCode', v_intervention ->> 'reasonText',
      (v_intervention ->> 'minutesAdded')::integer,
      (v_intervention ->> 'operatorId')::uuid, v_intervention ->> 'operatorDisplayName',
      (v_intervention ->> 'createdAtUtc')::timestamptz
    )
    on conflict (terminal_id, local_intervention_id) do nothing;
  end loop;

  for v_performance in select * from jsonb_array_elements(coalesce(p_payload -> 'performance', '[]'::jsonb))
  loop
    insert into public.sim_control_session_performance (
      terminal_id, local_session_id, package_id, business_date, session_kind, circuit,
      laps_completed, best_lap_ms, best_valid_lap_ms, finishing_position, result,
      time_used_seconds, is_demo_data
    ) values (
      p_terminal_id, (v_performance ->> 'sessionId')::uuid, v_package_id, v_business,
      v_performance ->> 'sessionKind', v_performance ->> 'circuit',
      (v_performance ->> 'lapsCompleted')::integer, (v_performance ->> 'bestLapMs')::integer,
      (v_performance ->> 'bestValidLapMs')::integer, (v_performance ->> 'finishingPosition')::integer,
      v_performance ->> 'result', (v_performance ->> 'timeUsedSeconds')::integer,
      coalesce((v_performance ->> 'isDemoData')::boolean, false)
    )
    on conflict (terminal_id, local_session_id) do nothing;
  end loop;

  for v_entity in select * from jsonb_array_elements(coalesce(p_meta -> 'entities', '[]'::jsonb))
  loop
    insert into public.sim_control_sync_entities (
      terminal_id, entity_type, local_entity_id, content_sha256, first_package_id
    ) values (
      p_terminal_id, v_entity ->> 'entityType', (v_entity ->> 'localEntityId')::uuid,
      v_entity ->> 'contentSha256', v_package_id
    )
    -- Conserva el PRIMER paquete que la trajo: esa es su identidad de origen.
    on conflict (terminal_id, entity_type, local_entity_id) do nothing;
  end loop;

  update public.sim_control_terminals
     set last_sync_at = now(), last_seen_at = now(), updated_at = now()
   where id = p_terminal_id;

  return jsonb_build_object(
    'outcome', 'inserted',
    'receiptId', v_receipt_id,
    'status', 'data_verified'
  );
end;
$fn$;

revoke all on function public.sim_control_ingest_package(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sim_control_ingest_package(uuid, jsonb, jsonb) to service_role;

-- ============================================================================
-- Corrida de conciliación: guarda la foto y propaga el estado a los paquetes
-- ----------------------------------------------------------------------------
-- Se llama después de cada ingestión y de cada reintento. Guarda una fila nueva
-- SOLO si el resultado cambió respecto de la corrida vigente: así el historial
-- dice algo y no se llena con cientos de fotos idénticas del re-chequeo cada 60s.
--
-- Un paquete que ya alcanzó `verified` NUNCA se toca: su comprobante es
-- definitivo y la actividad posterior del mismo día se verifica con los paquetes
-- siguientes, no revisando hacia atrás un cierre que ya cerró.
-- ============================================================================
create or replace function public.sim_control_record_reconciliation(
  p_business_date date,
  p_cutoff_utc    timestamptz,
  p_result        jsonb,
  p_items         jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status  text := p_result ->> 'status';
  v_central integer := coalesce((p_result ->> 'centralSimulatorMinutes')::integer, 0);
  v_local   integer := coalesce((p_result ->> 'localSimulatorMinutes')::integer, 0);
  v_current public.sim_control_reconciliations%rowtype;
  v_run_id  uuid;
  v_item    jsonb;
begin
  select * into v_current
  from public.sim_control_reconciliations
  where business_date = p_business_date and cutoff_utc = p_cutoff_utc and is_latest
  for update;

  if found
     and v_current.status = v_status
     and v_current.central_simulator_minutes = v_central
     and v_current.local_simulator_minutes = v_local then
    -- Nada cambió: se refresca la marca de tiempo y se reutiliza la corrida.
    update public.sim_control_reconciliations
       set computed_at = now()
     where id = v_current.id;
    v_run_id := v_current.id;
  else
    if found then
      update public.sim_control_reconciliations set is_latest = false where id = v_current.id;
    end if;

    insert into public.sim_control_reconciliations (
      business_date, cutoff_utc, status, central_simulator_minutes, local_simulator_minutes,
      difference_minutes, central_operations, local_sessions, terminal_keys,
      summary, detail, is_latest, computed_at
    ) values (
      p_business_date, p_cutoff_utc, v_status, v_central, v_local,
      v_central - v_local,
      coalesce((p_result ->> 'centralOperations')::integer, 0),
      coalesce((p_result ->> 'localSessions')::integer, 0),
      coalesce(
        (select array_agg(t) from jsonb_array_elements_text(coalesce(p_result -> 'terminalKeys', '[]'::jsonb)) as t),
        '{}'::text[]
      ),
      p_result ->> 'summary',
      coalesce(p_result -> 'detail', '{}'::jsonb),
      true, now()
    )
    returning id into v_run_id;

    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    loop
      insert into public.sim_control_reconciliation_items (
        reconciliation_id, business_date, source, source_id, simulator_minutes, formula, excluded_reason
      ) values (
        v_run_id, p_business_date, v_item ->> 'source', v_item ->> 'sourceId',
        coalesce((v_item ->> 'simulatorMinutes')::integer, 0),
        v_item ->> 'formula', v_item ->> 'excludedReason'
      )
      on conflict (reconciliation_id, source, source_id) do nothing;
    end loop;
  end if;

  -- Propagación SOLO a los paquetes de ESTE corte. Una corrida con corte 19:00
  -- no dice nada sobre el cierre de las 22:00: cada uno se verifica contra su
  -- propio momento. Y los ya verificados no se tocan nunca.
  update public.sim_control_sync_packages
     set status = case
                    when v_status = 'verified' then 'verified'
                    when v_status = 'mismatch' then 'mismatch'
                    else 'reconciliation_pending'
                  end,
         verified_at = case when v_status = 'verified' then coalesce(verified_at, now()) else verified_at end,
         last_evaluated_at = now()
   where business_date = p_business_date
     and cutoff_utc = p_cutoff_utc
     and status <> 'verified';

  return jsonb_build_object('reconciliationId', v_run_id, 'status', v_status);
end;
$fn$;

revoke all on function public.sim_control_record_reconciliation(date, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sim_control_record_reconciliation(date, timestamptz, jsonb, jsonb) to service_role;

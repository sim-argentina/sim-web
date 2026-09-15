-- ============================================================================
-- Campeonatos · Checkout ANTES de la inscripción (pago online obligatorio)
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
--
-- PROBLEMA QUE RESUELVE
--   Hasta acá, tocar "Inscribirme" insertaba YA una fila en
--   campeonato_inscripciones con estado 'pendiente_pago_online' y recién después
--   se ofrecía pagar. Quien abandonaba Mercado Pago quedaba como inscripto
--   fantasma: ensuciaba el admin, el Bracket y los cupos.
--
-- MODELO NUEVO
--   campeonato_checkouts = INTENTO de pago. NO es una inscripción: no aparece en
--   el admin de inscripciones, ni en el Bracket, ni en la clasificación, ni en el
--   contador público de inscriptos. Solo reserva un cupo por un rato corto.
--   La inscripción deportiva nace ÚNICAMENTE cuando Mercado Pago confirma el pago
--   (webhook o reconciliación server-side), dentro de campeonato_checkout_confirmar.
--
-- NO TOCA campeonato_inscripciones salvo por UN índice único aditivo sobre
-- payment_id (garantía de idempotencia: un pago = una inscripción).
-- ============================================================================

-- ── Tabla de intentos de checkout ───────────────────────────────────────────
create table if not exists public.campeonato_checkouts (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  campeonato_id      uuid not null references public.campeonatos(id) on delete cascade,

  -- Datos validados del formulario (los MISMOS campos que puede pedir
  -- config.inscripcion.campos, nada más). Sin PII extra: ni email ni dirección.
  nombre             text not null,
  apellido           text not null,
  telefono           text not null default '',
  dni                text not null default '',
  instagram          text,
  escuderia_favorita text,

  -- Monto ESPERADO, calculado server-side desde campeonatos.precio_inscripcion en
  -- el momento de crear el intento. El webhook compara contra esto, no contra el
  -- catálogo (que puede haber cambiado después).
  monto              numeric not null check (monto > 0),

  -- Credenciales opacas. external_reference viaja a Mercado Pago; token_publico es
  -- lo único que vuelve en la URL del navegador. Ninguno es adivinable ni lleva PII.
  external_reference text not null,
  token_publico      text not null,
  idempotency_key    text,

  preference_id      text,
  init_point         text,
  payment_id         text,

  -- 'pendiente'  → retiene cupo mientras dure la retención
  -- 'aprobado'   → pago acreditado y inscripción creada (inscripcion_id)
  -- 'sin_cupo'   → el pago se acreditó cuando la retención ya había caído y el
  --                lugar estaba vendido. Queda con su payment_id para que el
  --                staff lo resuelva (devolución o cupo extra). Es la cola del
  --                índice campeonato_checkouts_sin_cupo_idx.
  estado             text not null default 'pendiente'
                       check (estado in ('pendiente', 'aprobado', 'sin_cupo')),
  mp_status          text,
  mp_status_detail   text,

  -- LÍMITE PARA PAGAR (= vencimiento de la preference de Mercado Pago). La
  -- RETENCIÓN del cupo dura un poco más: expira_el + gracia, derivado por fecha,
  -- sin columna extra, sin cron ni job de limpieza.
  expira_el          timestamptz not null,
  procesado_at       timestamptz,
  reconciliado_at    timestamptz,

  inscripcion_id     uuid references public.campeonato_inscripciones(id) on delete set null
);

-- Token de la pantalla de resultado: 24 bytes base64url = 32 caracteres.
do $tok$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'campeonato_checkouts_token_chk'
      and conrelid = 'public.campeonato_checkouts'::regclass
  ) then
    alter table public.campeonato_checkouts
      add constraint campeonato_checkouts_token_chk
      check (token_publico ~ '^[A-Za-z0-9_-]{24,64}$');
  end if;
end;
$tok$;

create unique index if not exists campeonato_checkouts_extref_uq
  on public.campeonato_checkouts (external_reference);
create unique index if not exists campeonato_checkouts_token_uq
  on public.campeonato_checkouts (token_publico);
-- Doble clic en "Inscribirme": la misma key devuelve el MISMO intento.
create unique index if not exists campeonato_checkouts_idem_uq
  on public.campeonato_checkouts (idempotency_key) where idempotency_key is not null;
-- Un pago no puede quedar asociado a dos intentos.
create unique index if not exists campeonato_checkouts_payment_uq
  on public.campeonato_checkouts (payment_id) where payment_id is not null;
-- Conteo de cupo: intentos vigentes de un campeonato.
create index if not exists campeonato_checkouts_cupo_idx
  on public.campeonato_checkouts (campeonato_id, expira_el) where estado = 'pendiente';
-- Cola de revisión del staff (pagó tarde y sin cupo).
create index if not exists campeonato_checkouts_sin_cupo_idx
  on public.campeonato_checkouts (campeonato_id, created_at desc) where estado = 'sin_cupo';

-- RLS deny-by-default: la tabla es 100% server-side (service_role). Sin políticas,
-- anon y authenticated no leen ni escriben NADA, ni siquiera con la anon key.
alter table public.campeonato_checkouts enable row level security;
revoke all on table public.campeonato_checkouts from public, anon, authenticated;
grant select, insert, update, delete on table public.campeonato_checkouts to service_role;

-- ── Idempotencia dura sobre inscripciones: un pago = una inscripción ─────────
-- Aditivo. No modifica datos existentes (verificado: 0 payment_id duplicados).
create unique index if not exists campeonato_inscripciones_payment_uq
  on public.campeonato_inscripciones (payment_id) where payment_id is not null;

-- ============================================================================
-- Conteo ÚNICO de cupo ocupado. Lo usan el alta pública, el alta de stand y el
-- contador público: una sola definición de "ocupado", imposible que se desalineen.
--
--   1) inscripciones PAGADAS no eliminadas          → cupo definitivo
--   2) inscripciones PENDIENTES no eliminadas dentro del TTL histórico (30 min)
--      → altas de stand/admin recién hechas. Se conserva la semántica que ya
--        existía; las pendientes viejas (fantasmas heredados) no ocupan nada.
--   3) intentos con la RETENCIÓN viva               → reserva temporal
--
-- La retención dura MÁS que la ventana de pago:
--   pagar hasta         = expira_el            (= vencimiento de la preference)
--   cupo retenido hasta = expira_el + gracia   (derivado, sin columna nueva)
-- Ese colchón es lo que impide terminar con cupos_maximos + 1: quien pagó en el
-- minuto 19 conserva su lugar mientras llega el webhook, y nadie puede tomarlo.
-- ============================================================================
drop function if exists public.campeonato_cupo_ocupados(uuid, integer);

create or replace function public.campeonato_cupo_ocupados(
  p_campeonato_id uuid,
  p_ttl_pendientes_min integer default 30,
  p_gracia_min integer default 5
) returns integer
language sql
stable
set search_path = public, pg_temp
as $fn$
  select (
    (select count(*) from public.campeonato_inscripciones i
      where i.campeonato_id = p_campeonato_id
        and i.estado_pago = 'pagado'
        and i.eliminada_at is null)
  + (select count(*) from public.campeonato_inscripciones i
      where i.campeonato_id = p_campeonato_id
        and i.estado_pago in ('pendiente_pago', 'pendiente_pago_online', 'pendiente_pago_stand')
        and i.eliminada_at is null
        and i.created_at >= now() - make_interval(mins => greatest(coalesce(p_ttl_pendientes_min, 30), 0)))
  + (select count(*) from public.campeonato_checkouts c
      where c.campeonato_id = p_campeonato_id
        and c.estado = 'pendiente'
        and now() <= c.expira_el + make_interval(mins => greatest(coalesce(p_gracia_min, 5), 0)))
  )::integer;
$fn$;

-- ============================================================================
-- Alta del intento de checkout. TRANSACCIONAL: el lock por campeonato serializa
-- a dos personas peleando por el último cupo, así nunca se crean dos reservas
-- para un solo lugar. No inserta NADA en campeonato_inscripciones.
-- ============================================================================
drop function if exists public.campeonato_checkout_crear(uuid, text, text, text, text, text, text, numeric, text, text, text, integer, integer);

create or replace function public.campeonato_checkout_crear(
  p_campeonato_id       uuid,
  p_nombre              text,
  p_apellido            text,
  p_telefono            text,
  p_dni                 text,
  p_instagram           text,
  p_escuderia           text,
  p_monto               numeric,
  p_external_reference  text,
  p_token_publico       text,
  p_idempotency_key     text,
  p_ttl_min             integer,
  p_ttl_pendientes_min  integer default 30,
  p_gracia_min          integer default 5
) returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $fn$
declare
  v_limite   integer;
  v_ocupados integer;
  v_row      public.campeonato_checkouts%rowtype;
begin
  -- Un solo intento a la vez por campeonato: el conteo de cupo y el insert que
  -- lo consume ocurren sin que nadie se meta en el medio.
  perform pg_advisory_xact_lock(hashtextextended(p_campeonato_id::text, 0));

  -- Reintento con la MISMA key (doble clic, reenvío del formulario): devuelve el
  -- intento que ya existe en vez de tomar un segundo cupo.
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select * into v_row from public.campeonato_checkouts
      where idempotency_key = p_idempotency_key limit 1;
    if found then
      return jsonb_build_object(
        'resultado', 'reintento',
        'checkout_id', v_row.id,
        'external_reference', v_row.external_reference,
        'token_publico', v_row.token_publico,
        'init_point', v_row.init_point,
        'preference_id', v_row.preference_id,
        'expira_el', v_row.expira_el,
        'monto', v_row.monto
      );
    end if;
  end if;

  select coalesce(cupos_maximos, 0) into v_limite
    from public.campeonatos where id = p_campeonato_id and deleted_at is null;
  if not found then
    return jsonb_build_object('resultado', 'campeonato_inexistente');
  end if;

  -- cupos_maximos 0 / negativo / null = sin límite (semántica histórica).
  if v_limite > 0 then
    v_ocupados := public.campeonato_cupo_ocupados(p_campeonato_id, p_ttl_pendientes_min, p_gracia_min);
    if v_ocupados >= v_limite then
      return jsonb_build_object('resultado', 'sin_cupo', 'ocupados', v_ocupados, 'limite', v_limite);
    end if;
  end if;

  insert into public.campeonato_checkouts (
    campeonato_id, nombre, apellido, telefono, dni, instagram, escuderia_favorita,
    monto, external_reference, token_publico, idempotency_key, expira_el
  ) values (
    p_campeonato_id, p_nombre, p_apellido, coalesce(p_telefono, ''), coalesce(p_dni, ''),
    p_instagram, p_escuderia, p_monto, p_external_reference, p_token_publico,
    nullif(p_idempotency_key, ''), now() + make_interval(mins => greatest(p_ttl_min, 1))
  )
  returning * into v_row;

  return jsonb_build_object(
    'resultado', 'creado',
    'checkout_id', v_row.id,
    'external_reference', v_row.external_reference,
    'token_publico', v_row.token_publico,
    'expira_el', v_row.expira_el,
    'monto', v_row.monto
  );
end;
$fn$;

-- ============================================================================
-- Confirmación: ACÁ y solo acá nace la inscripción deportiva definitiva.
-- La llama el procesador de pagos (webhook y reconciliación) DESPUÉS de haber
-- verificado contra Mercado Pago, con credenciales del servidor, que el pago
-- está aprobado y que el importe coincide.
--
-- Idempotente por tres caminos independientes:
--   · FOR UPDATE sobre el intento  → dos webhooks simultáneos se serializan
--   · estado = 'aprobado'          → el segundo devuelve la misma inscripción
--   · unique(payment_id)           → la base no admite dos inscripciones del mismo pago
-- ============================================================================
-- p_aprobado_at = date_approved REAL del pago, traído de Mercado Pago con las
-- credenciales del servidor. Define si la reserva estaba viva CUANDO SE PAGÓ, que
-- es lo único que importa: una notificación demorada no puede costarle el lugar a
-- alguien que pagó dentro de su ventana.
drop function if exists public.campeonato_checkout_confirmar(text, text, text, text, integer);
drop function if exists public.campeonato_checkout_confirmar(text, text, text, text, timestamptz, integer);

create or replace function public.campeonato_checkout_confirmar(
  p_external_reference  text,
  p_payment_id          text,
  p_mp_status           text,
  p_mp_status_detail    text,
  p_aprobado_at         timestamptz default null,
  p_ttl_pendientes_min  integer default 30,
  p_gracia_min          integer default 5
) returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $fn$
declare
  v_chk        public.campeonato_checkouts%rowtype;
  v_limite     integer;
  v_ocupados   integer;
  v_existente  uuid;
  v_insc_id    uuid;
  v_hold_vivo  boolean;
  v_pago_en_ventana boolean;
begin
  select * into v_chk from public.campeonato_checkouts
    where external_reference = p_external_reference
    for update;
  if not found then
    return jsonb_build_object('resultado', 'inexistente');
  end if;

  -- Ya procesado: se devuelve la MISMA inscripción, no se crea otra.
  if v_chk.estado = 'aprobado' then
    return jsonb_build_object('resultado', 'ya_aprobado', 'inscripcion_id', v_chk.inscripcion_id);
  end if;

  -- Este pago ya generó una inscripción (reintento después de un corte).
  select id into v_existente from public.campeonato_inscripciones
    where payment_id = p_payment_id limit 1;
  if found then
    update public.campeonato_checkouts set
      estado = 'aprobado', payment_id = p_payment_id, inscripcion_id = v_existente,
      mp_status = p_mp_status, mp_status_detail = p_mp_status_detail,
      procesado_at = coalesce(procesado_at, now())
    where id = v_chk.id;
    return jsonb_build_object('resultado', 'ya_aprobado', 'inscripcion_id', v_existente);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_chk.campeonato_id::text, 0));

  select coalesce(cupos_maximos, 0) into v_limite
    from public.campeonatos where id = v_chk.campeonato_id;

  -- ¿Nuestro lugar sigue retenido? Mismo criterio que campeonato_cupo_ocupados.
  v_hold_vivo := now() <= v_chk.expira_el + make_interval(mins => greatest(coalesce(p_gracia_min, 5), 0));
  -- ¿El pago entró mientras se podía pagar? Se mira el momento en que Mercado
  -- Pago APROBÓ, no cuándo llegó el aviso. Sin date_approved se asume "ahora",
  -- que es el criterio conservador.
  v_pago_en_ventana := coalesce(p_aprobado_at, now()) <= v_chk.expira_el;

  if v_hold_vivo and v_pago_en_ventana then
    -- El cupo nunca dejó de ser nuestro y el pago fue en tiempo: se confirma sin
    -- re-contar. No puede haber sobreventa: el conteo YA nos incluía, así que
    -- nadie pudo haberse quedado con este lugar mientras tanto.
    null;
  elsif coalesce(v_limite, 0) > 0 then
    -- Se cayó la retención, o el pago llegó después de la ventana. Se re-verifica
    -- capacidad SIN contarnos a nosotros mismos (si no, nos bloquearíamos solos),
    -- y el tope manda: nunca se crea la inscripción cupos_maximos + 1. El intento
    -- queda en 'sin_cupo' con su payment_id, para que el staff lo resuelva.
    v_ocupados := public.campeonato_cupo_ocupados(v_chk.campeonato_id, p_ttl_pendientes_min, p_gracia_min)
                  - (case when v_chk.estado = 'pendiente' and v_hold_vivo then 1 else 0 end);
    if v_ocupados >= v_limite then
      update public.campeonato_checkouts set
        estado = 'sin_cupo', payment_id = p_payment_id,
        mp_status = p_mp_status, mp_status_detail = p_mp_status_detail,
        procesado_at = now()
      where id = v_chk.id;
      return jsonb_build_object('resultado', 'sin_cupo');
    end if;
  end if;

  -- Inscripción REAL. Conserva exactamente los campos que el formulario
  -- configurable de ese campeonato aceptó (los ocultos viajan vacíos).
  insert into public.campeonato_inscripciones (
    campeonato_id, nombre, apellido, nombre_completo, telefono, dni, instagram,
    escuderia_favorita, categoria, monto, estado_pago, metodo_pago,
    payment_id, preference_id
  ) values (
    v_chk.campeonato_id, v_chk.nombre, v_chk.apellido,
    btrim(v_chk.nombre || ' ' || v_chk.apellido),
    v_chk.telefono, v_chk.dni, v_chk.instagram, v_chk.escuderia_favorita,
    null,                       -- categoría: la asigna el staff / la clasificación
    v_chk.monto, 'pagado', 'mercadopago',
    p_payment_id, v_chk.preference_id
  )
  returning id into v_insc_id;

  update public.campeonato_checkouts set
    estado = 'aprobado', payment_id = p_payment_id, inscripcion_id = v_insc_id,
    mp_status = p_mp_status, mp_status_detail = p_mp_status_detail,
    procesado_at = now()
  where id = v_chk.id;

  return jsonb_build_object('resultado', 'creado', 'inscripcion_id', v_insc_id);
end;
$fn$;

revoke all on function public.campeonato_cupo_ocupados(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.campeonato_checkout_crear(uuid, text, text, text, text, text, text, numeric, text, text, text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.campeonato_checkout_confirmar(text, text, text, text, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.campeonato_cupo_ocupados(uuid, integer, integer)
  to service_role;
grant execute on function public.campeonato_checkout_crear(uuid, text, text, text, text, text, text, numeric, text, text, text, integer, integer, integer)
  to service_role;
grant execute on function public.campeonato_checkout_confirmar(text, text, text, text, timestamptz, integer, integer)
  to service_role;

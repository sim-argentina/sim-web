-- ════════════════════════════════════════════════════════════════════════════
-- Modalidad comercial 10/20/30 · B1 — migración ADITIVA de preparación
-- ════════════════════════════════════════════════════════════════════════════
--
-- Deja la base lista para la modalidad v2_10 (grilla de 10, +10 de buffer,
-- 10/20/30) SIN cambiar nada de lo que hoy hace producción.
--
-- QUÉ HACE
--   1. reservas.modalidad y turnos_stand.modalidad: NULL = legacy.
--   2. reserva_slots.ocupacion_min: NULL = bloque legacy de 20 minutos.
--   3. reservas_precios_especiales: precio_10 y precio_20 (precio_30 compartido).
--   4. Mensualidades: los checks de múltiplo de 15 pasan a múltiplo de 5, para
--      que convivan saldos legacy (15/30/45/60) y v2 (10/20/30): 45 − 10 = 35.
--   5. modalidad_comercial_config: override de contingencia, arranca en NULL.
--   6. mensualidad_plan_precios: precios de planes versionados por fecha.
--   7. trg_reserva_slot_bloqueo: control de solapamiento por intervalo para las
--      filas v2; las filas legacy se validan EXACTAMENTE como antes.
--
-- QUÉ NO HACE
--   · No modifica ninguna fila existente. No hay backfill: NULL es legacy.
--   · No reemplaza ni borra ninguna RPC operativa (crear/cancelar/reprogramar,
--     mensualidad_admin_ajustar_saldo, etc.).
--   · No cambia mensualidad_planes.precio: los planes se siguen cobrando igual
--     hasta que B6 conecte la tabla versionada.
--   · No activa v2: el override queda en NULL y el corte lo decide el calendario
--     del servidor (lib/modalidadComercial.ts), que ningún flujo lee todavía.
--
-- DIVERGENCIAS VERIFICADAS ANTES DE ESCRIBIR ESTO (esquema real vs. repo)
--   · trg_reserva_slot_bloqueo y reservas_precios_especiales NO tienen archivo
--     en db/: se aplicaron solo por migración. Su definición viva coincide
--     EXACTAMENTE con la última registrada en supabase_migrations
--     (20260828122553 reserva_slot_bloqueo_ignora_vencidos y 20260828122541
--     reservas_precios_especiales). Este archivo pasa a ser su fuente en db/.
--   · Los checks de Mensualidades vivos coinciden con db/mensualidades-m2.sql y
--     db/mensualidades-m5b-mixtas.sql (reservas_mensualidad_chk con el brazo
--     'mixta', que M5B.1 conservó a propósito).
--   · mensualidad_admin_ajustar_saldo exige múltiplo de 15 dentro de la propia
--     RPC (db/mensualidades-m7-admin.sql, igual en la base). NO se toca acá: es
--     una RPC operativa legacy y se revisa en B6 junto con su pantalla.
--
-- Idempotente: cada paso se puede volver a correr. Cada ALTER es una sola
-- sentencia (drop + add del mismo check juntos), así que ni una aplicación
-- cortada a mitad deja una tabla sin su control.
-- ════════════════════════════════════════════════════════════════════════════

-- No esperar indefinidamente un lock en producción: si hay una transacción
-- larga sobre estas tablas, esta migración falla rápido en vez de encolar a
-- todas las demás detrás.
set local lock_timeout = '5s';

-- ────────────────────────────────────────────────────────────────────────────
-- 0) Helper: 'HH:MM' → minutos desde medianoche
-- ────────────────────────────────────────────────────────────────────────────
-- Estricto: '9:00', '24:00' o '12:5' devuelven NULL, nunca un número inventado.
-- Pura y sin acceso a tablas: se deja ejecutable como cualquier función, igual
-- que mensualidad_horario_valido, porque la llama el trigger con el rol de quien
-- inserta y no puede fallar por permisos.

create or replace function public.reserva_hhmm_a_minutos(p_hora text)
returns integer
language sql
immutable
set search_path = public
as $fn$
  select case
    when p_hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      then split_part(p_hora, ':', 1)::integer * 60 + split_part(p_hora, ':', 2)::integer
  end;
$fn$;

comment on function public.reserva_hhmm_a_minutos(text) is
  'HH:MM estricto a minutos desde medianoche; NULL si no es una hora valida. Lo usa trg_reserva_slot_bloqueo para las filas v2.';

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Modalidad persistida de cada operación
-- ────────────────────────────────────────────────────────────────────────────
-- Se fija al CREAR la operación y no cambia. NULL = histórico = legacy. No se
-- rellena nada: nunca se infiere de created_at.

alter table public.reservas add column if not exists modalidad text;
alter table public.reservas
  drop constraint if exists reservas_modalidad_chk,
  add constraint reservas_modalidad_chk check (modalidad is null or modalidad in ('legacy', 'v2_10'));
comment on column public.reservas.modalidad is
  'Modalidad comercial con la que se CREO la reserva (legacy | v2_10). Se fija al crear y no cambia. NULL = historico = legacy. Sin backfill: nunca se infiere de created_at.';

alter table public.turnos_stand add column if not exists modalidad text;
alter table public.turnos_stand
  drop constraint if exists turnos_stand_modalidad_chk,
  add constraint turnos_stand_modalidad_chk check (modalidad is null or modalidad in ('legacy', 'v2_10'));
comment on column public.turnos_stand.modalidad is
  'Modalidad comercial con la que se CARGO el turno (legacy | v2_10). NULL = historico = legacy. En v2_10 cantidad_turnos cuenta bloques comerciales de 10 min por persona. Sin backfill.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Ocupación de cada fila de reserva_slots
-- ────────────────────────────────────────────────────────────────────────────
-- NULL: fila legacy, el bloque de 20 minutos que empieza en `hora` (lo de
-- siempre; las 43 filas actuales quedan así). Valor: fila v2, ocupa
-- [hora, hora + ocupacion_min) de ese simulador = duración comercial + buffer.

alter table public.reserva_slots add column if not exists ocupacion_min integer;
alter table public.reserva_slots
  drop constraint if exists reserva_slots_ocupacion_chk,
  add constraint reserva_slots_ocupacion_chk check (
    ocupacion_min is null or (ocupacion_min between 5 and 720 and ocupacion_min % 5 = 0)
  );
comment on column public.reserva_slots.ocupacion_min is
  'NULL = fila legacy: bloque de 20 min que empieza en hora (sin cambios). Valor = fila v2: ocupa [hora, hora + ocupacion_min) del simulador (duracion comercial + buffer). Lo controla trg_reserva_slot_bloqueo.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Precios especiales por fecha: 10 y 20, sin perder 15
-- ────────────────────────────────────────────────────────────────────────────
-- precio_30 queda COMPARTIDO: es el override del turno de 30 en las dos
-- modalidades. precio_15 se conserva para legacy.

alter table public.reservas_precios_especiales
  add column if not exists precio_10 integer,
  add column if not exists precio_20 integer;
alter table public.reservas_precios_especiales
  drop constraint if exists precio_10_no_negativo,
  add constraint precio_10_no_negativo check (precio_10 is null or precio_10 >= 0),
  drop constraint if exists precio_20_no_negativo,
  add constraint precio_20_no_negativo check (precio_20 is null or precio_20 >= 0),
  drop constraint if exists al_menos_un_precio,
  add constraint al_menos_un_precio check (
    precio_10 is not null or precio_15 is not null or precio_20 is not null or precio_30 is not null
  );
comment on column public.reservas_precios_especiales.precio_10 is
  'v2_10: override por simulador del turno de 10 min en esa fecha. NULL = precio normal.';
comment on column public.reservas_precios_especiales.precio_20 is
  'v2_10: override por simulador del turno de 20 min en esa fecha. NULL = precio normal.';
comment on column public.reservas_precios_especiales.precio_15 is
  'legacy: override por simulador del turno de 15 min en esa fecha. Se conserva para lo creado en legacy.';
comment on column public.reservas_precios_especiales.precio_30 is
  'COMPARTIDO: override por simulador del turno de 30 min en esa fecha, en legacy y en v2_10.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Mensualidades: múltiplo de 15 → múltiplo de 5
-- ────────────────────────────────────────────────────────────────────────────
-- Todo lo que hoy valida sigue validando (todo múltiplo de 15 es múltiplo de 5).
-- Las RPC legacy siguen exigiendo 15/30/45/60 por su cuenta, así que ningún
-- flujo actual produce otro valor hasta que un bloque posterior lo habilite.
-- Se conservan tal cual: el tope de 60 minutos trasladables y los checks de los
-- PLANES (60/120/240 son múltiplos de 15 y de 10).

alter table public.mensualidades
  drop constraint if exists mensualidades_saldo_chk,
  add constraint mensualidades_saldo_chk check (saldo_minutos >= 0 and saldo_minutos % 5 = 0);

alter table public.mensualidad_movimientos
  drop constraint if exists mensualidad_mov_minutos_chk,
  add constraint mensualidad_mov_minutos_chk check (minutos <> 0 and minutos % 5 = 0),
  drop constraint if exists mensualidad_mov_saldos_chk,
  add constraint mensualidad_mov_saldos_chk check (
    saldo_anterior >= 0 and saldo_posterior >= 0
    and saldo_anterior % 5 = 0 and saldo_posterior % 5 = 0
    and saldo_posterior = saldo_anterior + minutos
  );

alter table public.mensualidad_compras
  drop constraint if exists mensualidad_compras_minutos_chk,
  add constraint mensualidad_compras_minutos_chk check (
    (minutos_trasladados is null or (minutos_trasladados >= 0 and minutos_trasladados % 5 = 0 and minutos_trasladados <= 60))
    and (minutos_descartados is null or (minutos_descartados >= 0 and minutos_descartados % 5 = 0))
    and (saldo_resultante    is null or (saldo_resultante    >= 0 and saldo_resultante    % 5 = 0))
  );

-- Mismo check de M5B, con dos cambios: se suman 10 y 20 a las duraciones y
-- minutos_consumidos pasa a múltiplo de 5. Los brazos 'saldo' y 'mixta' y el
-- ELSE quedan idénticos.
alter table public.reservas
  drop constraint if exists reservas_mensualidad_chk,
  add constraint reservas_mensualidad_chk check (
    case when origen = 'mensualidad' then
      mensualidad_id is not null
      and duracion_minutos in (10, 15, 20, 30, 45, 60)
      and minutos_consumidos is not null
      and minutos_consumidos > 0
      and (minutos_consumidos % 5) = 0
      and condiciones_version is not null
      and condiciones_at is not null
      and referencia_publica is not null
      and (
        (cobertura = 'saldo' and total = 0 and importe_complementario = 0)
        or
        (cobertura = 'mixta' and importe_complementario > 0 and total = importe_complementario)
      )
    else
      mensualidad_id is null
      and minutos_consumidos is null
      and cobertura is null
      and importe_complementario = 0
    end
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Override de la modalidad comercial (contingencia / rollback)
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo patrón que mensualidad_config (M8A): singleton id = 1, deny by default,
-- una sola puerta de escritura con rol admin y motivo obligatorio.
--   NULL     → seguir el calendario (lib/modalidadComercial.ts).
--   'legacy' → forzar legacy para operaciones NUEVAS.
--   'v2_10'  → forzar v2_10 para operaciones NUEVAS.
-- Nunca reescribe operaciones existentes. Arranca en NULL.

create table if not exists public.modalidad_comercial_config (
  id                 integer primary key default 1,
  modalidad_override text,
  motivo             text,
  actualizado_por    text,
  updated_at         timestamptz not null default now(),
  constraint modalidad_comercial_config_singleton_chk check (id = 1),
  constraint modalidad_comercial_config_override_chk
    check (modalidad_override is null or modalidad_override in ('legacy', 'v2_10')),
  constraint modalidad_comercial_config_motivo_chk
    check (motivo is null or char_length(motivo) <= 500)
);

-- Solo se inserta si no existe: volver a correr esta migración NUNCA pisa un
-- override puesto a propósito. La primera vez queda en NULL.
insert into public.modalidad_comercial_config (id, modalidad_override)
values (1, null)
on conflict (id) do nothing;

comment on table public.modalidad_comercial_config is
  'Override de contingencia de la modalidad comercial. Una sola fila (id=1). NULL = seguir el calendario del servidor; legacy/v2_10 = forzar esa modalidad para operaciones NUEVAS. Nunca reescribe operaciones existentes.';

alter table public.modalidad_comercial_config enable row level security;
revoke all on table public.modalidad_comercial_config from public, anon, authenticated;
grant select, insert, update on table public.modalidad_comercial_config to service_role;

-- Escritura. Exige rol 'admin' por su cuenta, además del requireAdmin() de la
-- ruta. FOR UPDATE serializa dos cambios simultáneos: el estado final es el del
-- segundo y nunca queda algo incoherente.
create or replace function public.modalidad_comercial_set_override(
  p_override  text,
  p_motivo    text,
  p_actor     text,
  p_actor_rol text
)
returns table (
  override_anterior text,
  override_nuevo    text,
  sin_cambios       boolean,
  updated_at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fila   public.modalidad_comercial_config;
  v_previo text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_actor  text := btrim(coalesce(p_actor, ''));
begin
  if coalesce(p_actor_rol, '') <> 'admin' then
    raise exception 'rol_no_autorizado' using errcode = '42501';
  end if;
  if v_actor = '' then
    raise exception 'actor_requerido' using errcode = '22023';
  end if;
  if p_override is not null and p_override not in ('legacy', 'v2_10') then
    raise exception 'override_invalido' using errcode = '22023';
  end if;
  if v_motivo = '' then
    raise exception 'motivo_requerido' using errcode = '22023';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'motivo_demasiado_largo' using errcode = '22023';
  end if;

  select * into v_fila from public.modalidad_comercial_config c where c.id = 1 for update;
  if not found then
    insert into public.modalidad_comercial_config (id, modalidad_override)
    values (1, null)
    returning * into v_fila;
  end if;
  v_previo := v_fila.modalidad_override;

  update public.modalidad_comercial_config c
     set modalidad_override = p_override,
         motivo             = v_motivo,
         actualizado_por    = v_actor,
         updated_at         = now()
   where c.id = 1
   returning * into v_fila;

  return query
    select v_previo, v_fila.modalidad_override,
           (v_previo is not distinct from p_override), v_fila.updated_at;
end;
$fn$;

revoke all on function public.modalidad_comercial_set_override(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.modalidad_comercial_set_override(text, text, text, text)
  to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Precios de planes de Mensualidades, versionados por fecha
-- ────────────────────────────────────────────────────────────────────────────
-- El precio que corresponde a un instante es la última versión con
-- vigente_desde <= instante. Se registran de antemano:
--   · el precio actual, desde que existe el plan (sale de mensualidad_planes,
--     no está escrito a mano);
--   · el precio nuevo, desde el corte: 38.000 / 70.000 / 128.000.
-- (B1) NINGÚN flujo público lee esta tabla todavía: la compra, la renovación y
-- el alta administrativa siguen cobrando mensualidad_planes.precio hasta B6.
-- Las versiones no se editan: una corrección es una versión nueva.

create table if not exists public.mensualidad_plan_precios (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.mensualidad_planes(id) on delete restrict,
  precio        numeric not null,
  vigente_desde timestamptz not null,
  created_at    timestamptz not null default now(),
  constraint mensualidad_plan_precios_precio_chk check (precio > 0),
  constraint mensualidad_plan_precios_version_uq unique (plan_id, vigente_desde)
);

comment on table public.mensualidad_plan_precios is
  'Precio de cada plan de Mensualidades por fecha de vigencia. Precio vigente en T = ultima version con vigente_desde <= T. Preparada en B1: ningun flujo publico la lee hasta B6 (hoy se cobra mensualidad_planes.precio).';

alter table public.mensualidad_plan_precios enable row level security;
revoke all on table public.mensualidad_plan_precios from public, anon, authenticated;
grant select, insert on table public.mensualidad_plan_precios to service_role;

insert into public.mensualidad_plan_precios (plan_id, precio, vigente_desde)
select p.id, p.precio, p.created_at
  from public.mensualidad_planes p
 where p.slug in ('1h', '2h', '4h')
on conflict (plan_id, vigente_desde) do nothing;

-- El corte, en hora argentina. Es un DATO de esta tabla; la regla del corte
-- vive en lib/modalidadComercial.ts y lib/modalidadComercialB1.integration.ts
-- falla si este instante y el del código no coinciden.
insert into public.mensualidad_plan_precios (plan_id, precio, vigente_desde)
select p.id, v.precio, timestamptz '2026-10-01 00:00:00-03'
  from public.mensualidad_planes p
  join (values ('1h', 38000::numeric), ('2h', 70000::numeric), ('4h', 128000::numeric))
       as v(slug, precio) on v.slug = p.slug
on conflict (plan_id, vigente_desde) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 7) Control de bloqueos y de solapamiento en reserva_slots
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo trigger, mismo advisory lock por fecha (compartido con
-- crear_bloqueo_reserva), misma firma: CREATE OR REPLACE conserva el vínculo
-- con el trigger reserva_slot_bloqueo.
--
-- FILA LEGACY (ocupacion_min IS NULL)
--   (a) Bloqueos: el control ANTERIOR, copiado sin cambios (el inicio del bloque
--       dentro de [hora_inicio, hora_fin], comparando texto, ignorando vencidos).
--   (b) Nuevo, y solo contra filas v2: el bloque [hora, hora + 20) no puede
--       pisar la ocupación de una fila v2 del mismo simulador. Mientras no
--       exista ninguna fila v2 esta consulta no encuentra nada, así que el
--       resultado de TODA inserción legacy es idéntico al de antes. Entre filas
--       legacy sigue mandando, como siempre, el índice reserva_slots_activa_uq.
--
-- FILA V2 (ocupacion_min NOT NULL)
--   (a) Bloqueos: la ocupación [inicio, inicio + ocupacion_min) toca el tramo
--       bloqueado [hora_inicio, hora_fin] (el fin sigue siendo inclusivo para el
--       inicio, como en legacy). Mismo criterio de vencidos.
--   (b) Solapamiento real con TODA fila activa del mismo simulador y fecha: las
--       legacy cuentan como bloques de 20 y las v2 con su propia ocupación.
--
-- Los conflictos salen con los MISMOS códigos que ya conocen los manejadores:
-- 23514 para un bloqueo y 23505 para un turno ocupado. El mensaje del 23505
-- nombra reserva_slots_activa_uq a propósito: es lo que buscan hoy
-- lib/mensualidadesReserva.ts y lib/mensualidadesGestionReserva.ts.

create or replace function public.trg_reserva_slot_bloqueo()
returns trigger
language plpgsql
as $function$
declare
  v_ini integer;
  v_fin integer;
begin
  if NEW.estado <> 'activa' then
    return NEW;
  end if;
  -- Exclusión compartida con crear_bloqueo_reserva(): serializa por fecha.
  perform pg_advisory_xact_lock(hashtext('reserva-slot:' || NEW.fecha)::bigint);

  if NEW.ocupacion_min is null then
    -- ── LEGACY ──────────────────────────────────────────────────────────────
    -- (a) Idéntico al control anterior.
    if exists (
      select 1 from public.bloqueos_reservas b
      where b.fecha = NEW.fecha::date and b.activo = true
        and (b.simulador is null or b.simulador = NEW.simulador)
        and (b.todo_el_dia = true
             or (NEW.hora >= coalesce(b.hora_inicio, '00:00') and NEW.hora <= coalesce(b.hora_fin, '23:59')))
        -- Ignorar bloqueos ya VENCIDOS (fin del bloqueo < ahora, en hora Argentina).
        and (b.fecha + (case when b.todo_el_dia then time '23:59:59'
                             else coalesce(b.hora_fin, '23:59')::time end))
            >= (now() at time zone 'America/Argentina/Buenos_Aires')
    ) then
      raise exception 'Horario bloqueado por administración' using errcode = '23514';
    end if;

    -- (b) Solo contra filas v2. Una hora legacy que no es HH:MM no se puede
    --     medir: se deja pasar exactamente como antes.
    v_ini := public.reserva_hhmm_a_minutos(NEW.hora);
    if v_ini is not null and exists (
      select 1 from public.reserva_slots s
      where s.fecha = NEW.fecha and s.simulador = NEW.simulador and s.estado = 'activa'
        and s.ocupacion_min is not null
        and public.reserva_hhmm_a_minutos(s.hora) < v_ini + 20
        and public.reserva_hhmm_a_minutos(s.hora) + s.ocupacion_min > v_ini
    ) then
      raise exception 'reserva_slots_activa_uq: el bloque se superpone con la ocupación de otra reserva del simulador'
        using errcode = '23505';
    end if;

    return NEW;
  end if;

  -- ── V2 ────────────────────────────────────────────────────────────────────
  v_ini := public.reserva_hhmm_a_minutos(NEW.hora);
  if v_ini is null then
    raise exception 'hora_invalida' using errcode = '22023';
  end if;
  v_fin := v_ini + NEW.ocupacion_min;

  -- (a) La ocupación toca un tramo bloqueado.
  if exists (
    select 1 from public.bloqueos_reservas b
    where b.fecha = NEW.fecha::date and b.activo = true
      and (b.simulador is null or b.simulador = NEW.simulador)
      and (b.todo_el_dia = true
           or (v_ini <= public.reserva_hhmm_a_minutos(coalesce(b.hora_fin, '23:59'))
               and v_fin > public.reserva_hhmm_a_minutos(coalesce(b.hora_inicio, '00:00'))))
      and (b.fecha + (case when b.todo_el_dia then time '23:59:59'
                           else coalesce(b.hora_fin, '23:59')::time end))
          >= (now() at time zone 'America/Argentina/Buenos_Aires')
  ) then
    raise exception 'Horario bloqueado por administración' using errcode = '23514';
  end if;

  -- (b) Solapamiento real: legacy = bloque de 20, v2 = su ocupación.
  if exists (
    select 1 from public.reserva_slots s
    where s.fecha = NEW.fecha and s.simulador = NEW.simulador and s.estado = 'activa'
      and public.reserva_hhmm_a_minutos(s.hora) < v_fin
      and public.reserva_hhmm_a_minutos(s.hora) + coalesce(s.ocupacion_min, 20) > v_ini
  ) then
    raise exception 'reserva_slots_activa_uq: la ocupación se superpone con otra reserva del simulador'
      using errcode = '23505';
  end if;

  return NEW;
end;
$function$;

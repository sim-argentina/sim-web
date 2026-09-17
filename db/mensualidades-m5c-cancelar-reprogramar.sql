-- ============================================================================
-- MENSUALIDADES SIM · BLOQUE M5C
-- Cancelación y reprogramación de reservas hechas con la Mensualidad.
-- ----------------------------------------------------------------------------
-- Migración ADITIVA e idempotente, hacia adelante. No edita ninguna migración
-- histórica ya aplicada (M5A, M5B y M5B.1 quedan como están).
--
-- LA REGLA DE LAS 24 HORAS
-- Se calcula SIEMPRE en el servidor, contra el instante de inicio de la reserva
-- en America/Argentina/Cordoba. `reservas.fecha` es text 'YYYY-MM-DD' y
-- `reservas.hora` es text 'HH:MM', así que el instante se arma como
--     (fecha || ' ' || hora)::timestamp AT TIME ZONE 'America/Argentina/Cordoba'
-- que devuelve el timestamptz real de ese momento en Córdoba, y se compara con
-- now(). El corte es INCLUSIVO: faltando exactamente 24:00:00 todavía se
-- restituye; a 23:59:59 ya no.
--
-- QUÉ SE RESTITUYE
--   · >= 24 h  → se cancela, se liberan los slots y vuelven a la billetera
--                EXACTAMENTE `minutos_consumidos`, con UN movimiento
--                'devolucion'.
--   · <  24 h  → se cancela y se liberan los slots, pero NO se devuelve nada y
--                no se escribe ningún movimiento. El titular lo confirma antes.
--   · no_show  → no se toca. No hay devolución automática ni cron.
--
-- IDEMPOTENCIA — garantizada por la BASE, no por la aplicación:
--   · La devolución usa idempotency_key = 'cancel:<reserva_id>', y
--     mensualidad_mov_idem_uq (índice único de M2) hace imposible un segundo
--     movimiento para la misma reserva. Doble clic o reintento no devuelve dos
--     veces ni aunque dos transacciones corran a la vez.
--   · Una reserva ya cancelada devuelve su resultado guardado y no muta nada.
--   · Reprogramar al mismo día y hora devuelve `sin_cambios` sin tocar slots.
--
-- ORDEN DE LOCKS — el mismo de M2/M5A/M5B.1, para que no haya deadlocks:
--     1) advisory  'mensualidad:<telefono_norm>'
--     2) FOR UPDATE sobre mensualidades y sobre la reserva
--     3) advisory  'reserva-slot:<fecha>'  (lo toma trg_reserva_slot_bloqueo)
-- ============================================================================

-- ── 1) Auditoría de la cancelación y de la reprogramación ───────────────────
-- Columnas nuevas, todas anulables: ninguna fila existente cambia de sentido y
-- reservas_mensualidad_chk (M5A/M5B.1) no se toca.

alter table public.reservas
  add column if not exists cancelada_at          timestamptz,
  add column if not exists cancelacion_resultado text,
  add column if not exists reprogramada_at       timestamptz,
  add column if not exists reprogramaciones      integer not null default 0;

comment on column public.reservas.cancelacion_resultado is
  'restituida = se devolvieron los minutos (cancelo con 24 h o mas). sin_restitucion = se libero el turno pero los minutos se perdieron (menos de 24 h). NULL = no esta cancelada.';
comment on column public.reservas.reprogramaciones is
  'Cuantas veces se movio de fecha/hora. La duracion, las escuderias y los minutos consumidos nunca cambian al reprogramar.';

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservas_cancelacion_chk' and conrelid = 'public.reservas'::regclass
  ) then
    alter table public.reservas add constraint reservas_cancelacion_chk check (
      cancelacion_resultado is null
      or (cancelacion_resultado in ('restituida','sin_restitucion') and estado = 'cancelada')
    );
  end if;
end $mig$;

-- Mi Plan lista las próximas de UNA billetera ordenadas por fecha y hora.
create index if not exists reservas_mens_proximas_idx
  on public.reservas (mensualidad_id, estado, fecha, hora)
  where mensualidad_id is not null;

-- ── 2) CANCELAR ─────────────────────────────────────────────────────────────
-- Se identifica la reserva por su REFERENCIA PÚBLICA, nunca por el id interno,
-- y la pertenencia se exige en el propio WHERE: una referencia de otra billetera
-- simplemente no existe para esta llamada.

create or replace function public.cancelar_reserva_mensualidad(
  p_mensualidad_id  uuid,
  p_referencia      text,
  p_idempotency_key text
)
returns table (
  reserva_id          bigint,
  referencia_publica  text,
  estado              text,
  restituyo           boolean,
  minutos_restituidos integer,
  saldo_anterior      integer,
  saldo_posterior     integer,
  idempotente         boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_telefono  text;
  v_mens      public.mensualidades%rowtype;
  v_reserva   public.reservas%rowtype;
  v_inicio    timestamptz;
  v_restituye boolean;
  v_minutos   integer;
  v_saldo_fin integer;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode = '22023';
  end if;
  if p_referencia is null or p_referencia !~ '^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$' then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  -- Orden de locks: billetera primero, siempre.
  select m.telefono_norm into v_telefono
    from public.mensualidades m where m.id = p_mensualidad_id;
  if v_telefono is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);

  select * into v_mens from public.mensualidades m
   where m.id = p_mensualidad_id for update;

  -- PERTENENCIA: la reserva tiene que ser de ESTA billetera y de Mensualidades.
  -- Si no, para quien llama es indistinguible de una referencia inexistente.
  select * into v_reserva from public.reservas r
   where r.referencia_publica = p_referencia
     and r.mensualidad_id = p_mensualidad_id
     and r.origen = 'mensualidad'
   for update;
  if not found then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  -- Reintento sobre una reserva YA cancelada: se devuelve lo que pasó la vez
  -- anterior. No se escribe nada, no se devuelve saldo otra vez.
  if v_reserva.estado = 'cancelada' then
    return query
      select v_reserva.id, v_reserva.referencia_publica, v_reserva.estado,
             (v_reserva.cancelacion_resultado = 'restituida'),
             case when v_reserva.cancelacion_resultado = 'restituida'
                  then v_reserva.minutos_consumidos else 0 end,
             v_mens.saldo_minutos, v_mens.saldo_minutos, true;
    return;
  end if;

  -- Solo una reserva viva se puede cancelar. 'reembolsada', 'conflicto_pago' y
  -- cualquier estado futuro quedan fuera por no estar en la lista.
  if v_reserva.estado <> 'activa' then
    raise exception 'estado_no_cancelable' using errcode = '22023';
  end if;
  if coalesce(v_reserva.no_show, false) then
    raise exception 'estado_no_cancelable' using errcode = '22023';
  end if;

  -- Instante real de inicio en Córdoba.
  v_inicio := (v_reserva.fecha || ' ' || v_reserva.hora)::timestamp
              at time zone 'America/Argentina/Cordoba';
  if v_inicio <= now() then
    raise exception 'reserva_ya_iniciada' using errcode = '22023';
  end if;

  -- El corte es inclusivo: faltando exactamente 24 h todavía se restituye.
  v_restituye := (v_inicio - now()) >= interval '24 hours';
  v_minutos   := coalesce(v_reserva.minutos_consumidos, 0);

  update public.reservas
     set estado = 'cancelada',
         cancelada_at = now(),
         cancelacion_resultado = case when v_restituye then 'restituida' else 'sin_restitucion' end
   where id = v_reserva.id;

  -- Liberar TODOS los slots: al dejar de estar 'activa' salen del índice único
  -- parcial y el turno queda disponible para cualquiera.
  update public.reserva_slots rs
     set estado = 'cancelada'
   where rs.reserva_id = v_reserva.id and rs.estado = 'activa';

  if not v_restituye or v_minutos <= 0 then
    return query
      select v_reserva.id, v_reserva.referencia_publica, 'cancelada'::text,
             false, 0, v_mens.saldo_minutos, v_mens.saldo_minutos, false;
    return;
  end if;

  v_saldo_fin := v_mens.saldo_minutos + v_minutos;
  update public.mensualidades set saldo_minutos = v_saldo_fin where id = v_mens.id;

  -- UN solo movimiento, garantizado por mensualidad_mov_idem_uq: la clave
  -- 'cancel:<reserva_id>' es única en toda la tabla.
  insert into public.mensualidad_movimientos
    (mensualidad_id, reserva_id, tipo, minutos, saldo_anterior, saldo_posterior,
     motivo, actor, idempotency_key)
  values
    (v_mens.id, v_reserva.id, 'devolucion', v_minutos, v_mens.saldo_minutos, v_saldo_fin,
     format('Cancelacion con 24 h o mas de anticipacion de la reserva %s (%s %s)',
            v_reserva.referencia_publica, v_reserva.fecha, v_reserva.hora),
     'titular', 'cancel:' || v_reserva.id);

  return query
    select v_reserva.id, v_reserva.referencia_publica, 'cancelada'::text,
           true, v_minutos, v_mens.saldo_minutos, v_saldo_fin, false;
end;
$fn$;

-- ── 3) REPROGRAMAR ──────────────────────────────────────────────────────────
-- Cambia SOLO fecha y hora. La duración, las escuderías y los minutos ya
-- consumidos quedan exactamente como estaban: no se devuelve ni se vuelve a
-- descontar saldo, y no se escribe ningún movimiento.
--
-- Los bloques llegan calculados por lib/agenda.ts (fuente única de M6). Acá no
-- se reconstruye el calendario: se verifica que sean coherentes con la duración
-- ORIGINAL de la reserva, que es la única que vale.
--
-- Todo ocurre en UNA transacción: se sueltan los slots viejos y se toman los
-- nuevos. Si los nuevos fallan (ocupados o bloqueados), la transacción entera
-- se revierte y la reserva original queda intacta, con sus slots. No existe un
-- estado intermedio visible en el que el titular se quede sin su turno.

create or replace function public.reprogramar_reserva_mensualidad(
  p_mensualidad_id  uuid,
  p_referencia      text,
  p_fecha           date,
  p_hora            text,
  p_slots           text[],
  p_idempotency_key text
)
returns table (
  reserva_id         bigint,
  referencia_publica text,
  fecha              text,
  hora               text,
  duracion_minutos   integer,
  minutos_consumidos integer,
  sin_cambios        boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_telefono text;
  v_mens     public.mensualidades%rowtype;
  v_reserva  public.reservas%rowtype;
  v_inicio   timestamptz;
  v_hoy      date;
  v_sims     text[];
  v_slot     text;
  v_sim      text;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode = '22023';
  end if;
  if p_referencia is null or p_referencia !~ '^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$' then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;
  if p_hora is null or p_hora !~ '^\d{2}:\d{2}$' then
    raise exception 'hora_invalida' using errcode = '22023';
  end if;

  select m.telefono_norm into v_telefono
    from public.mensualidades m where m.id = p_mensualidad_id;
  if v_telefono is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);

  select * into v_mens from public.mensualidades m
   where m.id = p_mensualidad_id for update;

  select * into v_reserva from public.reservas r
   where r.referencia_publica = p_referencia
     and r.mensualidad_id = p_mensualidad_id
     and r.origen = 'mensualidad'
   for update;
  if not found then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  if v_reserva.estado <> 'activa' then
    raise exception 'estado_no_reprogramable' using errcode = '22023';
  end if;
  if coalesce(v_reserva.no_show, false) then
    raise exception 'estado_no_reprogramable' using errcode = '22023';
  end if;

  -- El plazo se mide sobre la reserva ORIGINAL.
  v_inicio := (v_reserva.fecha || ' ' || v_reserva.hora)::timestamp
              at time zone 'America/Argentina/Cordoba';
  if v_inicio <= now() then
    raise exception 'reserva_ya_iniciada' using errcode = '22023';
  end if;
  if (v_inicio - now()) < interval '24 hours' then
    raise exception 'fuera_de_plazo' using errcode = '22023';
  end if;

  -- Mismo día y misma hora: no hay nada que hacer. Esto es lo que hace
  -- idempotente al doble clic, sin necesidad de una clave extra.
  if v_reserva.fecha = p_fecha::text and v_reserva.hora = p_hora then
    return query
      select v_reserva.id, v_reserva.referencia_publica, v_reserva.fecha, v_reserva.hora,
             v_reserva.duracion_minutos, v_reserva.minutos_consumidos, true;
    return;
  end if;

  -- Ventana pública y vigencia. La app ya lo valida con M6; acá se repite para
  -- que la RPC sea segura aunque se la llame desde otro lado.
  v_hoy := public.mensualidad_hoy();
  if p_fecha <= v_hoy then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;
  if p_fecha > (v_hoy + 15) then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;
  if p_fecha > v_mens.vence_el then
    raise exception 'turno_posterior_al_vencimiento' using errcode = '22023';
  end if;

  -- Los bloques tienen que corresponder a la duración ORIGINAL, no a una que
  -- mande el cliente: la duración no se puede cambiar reprogramando.
  if coalesce(array_length(p_slots, 1), 0) <> (v_reserva.duracion_minutos / 15) then
    raise exception 'bloques_incoherentes' using errcode = '22023';
  end if;
  if array_length(p_slots, 1) <> (select count(distinct s) from unnest(p_slots) s) then
    raise exception 'bloques_incoherentes' using errcode = '22023';
  end if;
  if p_slots[1] is distinct from p_hora then
    raise exception 'bloques_incoherentes' using errcode = '22023';
  end if;
  if p_slots <> (select array_agg(s order by s) from unnest(p_slots) s) then
    raise exception 'bloques_desordenados' using errcode = '22023';
  end if;

  -- Las MISMAS escuderías de siempre.
  select array_agg(x order by x) into v_sims
    from jsonb_array_elements_text(v_reserva.simuladores) x;
  if coalesce(array_length(v_sims, 1), 0) = 0 then
    raise exception 'reserva_sin_simuladores' using errcode = '22023';
  end if;

  -- Soltar los viejos y tomar los nuevos, en esta transacción. Si los nuevos
  -- chocan, el rollback devuelve los viejos: la reserva original nunca queda
  -- sin turno. Se marcan 'reprogramada' para distinguirlos de una cancelación.
  update public.reserva_slots rs
     set estado = 'reprogramada'
   where rs.reserva_id = v_reserva.id and rs.estado = 'activa';

  foreach v_slot in array p_slots loop
    foreach v_sim in array v_sims loop
      insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado)
      values (v_reserva.id, p_fecha, v_slot, v_sim, 'activa');
    end loop;
  end loop;

  update public.reservas
     set fecha = p_fecha::text,
         hora = p_hora,
         reprogramada_at = now(),
         reprogramaciones = coalesce(reprogramaciones, 0) + 1
   where id = v_reserva.id;

  return query
    select v_reserva.id, v_reserva.referencia_publica, p_fecha::text, p_hora,
           v_reserva.duracion_minutos, v_reserva.minutos_consumidos, false;
end;
$fn$;

-- ── 4) Permisos: nada fuera de service_role ─────────────────────────────────
revoke all on function public.cancelar_reserva_mensualidad(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.cancelar_reserva_mensualidad(uuid, text, text)
  to service_role;

revoke all on function public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text)
  from public, anon, authenticated;
grant execute on function public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text)
  to service_role;

-- reservas y reserva_slots ya están en deny-by-default (RLS activa, 0 policies,
-- grants solo a service_role). Las columnas nuevas quedan bajo esa misma
-- política: no se agrega ni se afloja ningún permiso.

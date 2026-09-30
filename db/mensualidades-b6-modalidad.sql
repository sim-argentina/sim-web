-- ============================================================================
-- Mensualidades B6 — modalidad 10/20/30 persistida y precios versionados.
-- ----------------------------------------------------------------------------
-- ADITIVA y retrocompatible. Sin backfill: las filas existentes quedan con
-- modalidad NULL, que en todos lados significa legacy.
--
--   1. mensualidad_compras.modalidad: la modalidad con la que se CREÓ la compra.
--      La resuelve el servidor UNA vez (modalidadVigente()). El webhook y la
--      aplicación leen la de la compra: nunca vuelven a mirar el reloj.
--   2. mensualidades.modalidad: la del PLAN. La fija la aplicación de una
--      compra. Con varias compras aplicadas manda la de CREACIÓN más reciente,
--      no la del webhook que llegó último: dos pagos alrededor del corte nunca
--      dejan el plan en una modalidad que dependa del orden de llegada.
--   3. RPC v2 EN PARALELO (las legacy NO se borran): crear_reserva_mensualidad_v2
--      y reprogramar_reserva_mensualidad_v2. 10/20/30, grilla de 10 y UNA fila de
--      reserva_slots por simulador con ocupacion_min = duración + 10. El buffer
--      ocupa agenda; nunca saldo, movimientos ni minutos_consumidos.
--   4. Las RPC legacy se reemplazan con CREATE OR REPLACE (misma firma) SOLO
--      para negarse a operar sobre un plan o una reserva v2 y para guardar
--      reservas.modalidad = 'legacy' explícita. Todo lo demás queda igual.
--   5. mensualidad_aplicar_compra_interna fija mensualidades.modalidad.
--   6. mensualidad_admin_ajustar_saldo: múltiplos de 5 (saldos legacy y v2
--      conviven: un saldo puede terminar en 35).
--   7. mensualidad_admin_alta_v2: el alta del panel con la modalidad comercial
--      y el precio de esa versión (mensualidad_plan_precios), resueltos en el
--      servidor. mensualidad_admin_alta queda intacta.
--
-- Definiciones previas de lo que se reemplaza: db/mensualidades-b6-modalidad.previo.sql
-- ============================================================================

-- ── 1 y 2. Columnas ─────────────────────────────────────────────────────────

alter table public.mensualidad_compras add column if not exists modalidad text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mensualidad_compras_modalidad_chk') then
    alter table public.mensualidad_compras add constraint mensualidad_compras_modalidad_chk
      check (modalidad is null or modalidad in ('legacy', 'v2_10'));
  end if;
end $$;
comment on column public.mensualidad_compras.modalidad is
  '(B6) Modalidad comercial con la que se creó la compra. NULL = histórica = legacy.';

alter table public.mensualidades add column if not exists modalidad text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mensualidades_modalidad_chk') then
    alter table public.mensualidades add constraint mensualidades_modalidad_chk
      check (modalidad is null or modalidad in ('legacy', 'v2_10'));
  end if;
end $$;
comment on column public.mensualidades.modalidad is
  '(B6) Modalidad del plan: la de su compra aplicada de creación más reciente. NULL = legacy.';

-- ── 3. Horario v2 ───────────────────────────────────────────────────────────
-- Espejo de turnoV2 (lib/agendaIntervalos.ts) para Mensualidades: paso de 10
-- desde las 10:00; de lunes a viernes el tiempo COMERCIAL termina a las 22:00
-- como máximo (10 → 21:50, 20 → 21:40, 30 → 21:30); sábado y domingo el último
-- inicio es 14:00 para las tres duraciones.

create or replace function public.mensualidad_horario_valido_v2(p_fecha date, p_hora text, p_duracion integer)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  with d as (
    select public.reserva_hhmm_a_minutos(p_hora)                    as inicio,
           extract(isodow from p_fecha) between 1 and 5             as es_semana
  )
  select coalesce(
           p_fecha is not null
           and p_duracion in (10, 20, 30)
           and d.inicio is not null
           and d.inicio >= 10 * 60
           and (d.inicio - 10 * 60) % 10 = 0
           and case when d.es_semana then d.inicio + p_duracion <= 22 * 60
                    else d.inicio <= 14 * 60 end,
           false)
    from d;
$$;

revoke all on function public.mensualidad_horario_valido_v2(date, text, integer) from public, anon, authenticated;
grant execute on function public.mensualidad_horario_valido_v2(date, text, integer) to service_role;

-- ── 3. Reserva v2 ───────────────────────────────────────────────────────────

create or replace function public.crear_reserva_mensualidad_v2(
  p_mensualidad_id uuid, p_fecha date, p_hora text, p_duracion integer,
  p_simuladores text[], p_idempotency_key text, p_condiciones_version text)
returns table(reserva_id bigint, referencia_publica text, minutos_consumidos integer,
              saldo_anterior integer, saldo_posterior integer, idempotente boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_buffer constant integer := 10;
  v_telefono text; v_mens public.mensualidades%rowtype; v_hoy date; v_estado text;
  v_minutos integer; v_saldo_fin integer; v_reserva public.reservas%rowtype;
  v_ref text; v_sim text; v_n_sims integer;
  v_sims_prev text[]; v_sims_new text[];
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode='22023'; end if;
  if p_duracion is null or p_duracion not in (10, 20, 30) then
    raise exception 'duracion_invalida' using errcode='22023'; end if;
  if coalesce(btrim(p_condiciones_version),'') = '' then
    raise exception 'condiciones_requeridas' using errcode='22023'; end if;

  if not public.mensualidad_dia_habilitado(p_fecha) then
    raise exception 'dia_no_habilitado' using errcode='22023'; end if;
  if not public.mensualidad_horario_valido_v2(p_fecha, p_hora, p_duracion) then
    raise exception 'fuera_de_horario' using errcode='22023'; end if;

  v_n_sims := coalesce(array_length(p_simuladores,1),0);
  if v_n_sims < 1 or v_n_sims > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode='22023'; end if;
  if v_n_sims <> (select count(distinct s) from unnest(p_simuladores) s) then
    raise exception 'simuladores_duplicados' using errcode='22023'; end if;
  if exists (select 1 from unnest(p_simuladores) s
             where s not in ('Ferrari','McLaren','Red Bull','Alpine')) then
    raise exception 'simulador_desconocido' using errcode='22023'; end if;

  -- Reintento con la misma clave: devuelve lo que se hizo, sin escribir nada.
  select * into v_reserva from public.reservas r where r.idempotency_key = p_idempotency_key limit 1;
  if found then
    select array_agg(x order by x) into v_sims_prev from jsonb_array_elements_text(v_reserva.simuladores) x;
    select array_agg(s order by s) into v_sims_new from unnest(p_simuladores) s;
    if v_reserva.mensualidad_id is distinct from p_mensualidad_id
       or v_reserva.fecha is distinct from p_fecha::text or v_reserva.hora is distinct from p_hora
       or v_reserva.duracion_minutos is distinct from p_duracion or v_sims_prev is distinct from v_sims_new
       or v_reserva.modalidad is distinct from 'v2_10' then
      raise exception 'idempotency_key_con_otro_payload' using errcode='23505'; end if;
    return query select v_reserva.id, v_reserva.referencia_publica, v_reserva.minutos_consumidos,
      mv.saldo_anterior, mv.saldo_posterior, true
      from public.mensualidad_movimientos mv
      where mv.reserva_id = v_reserva.id and mv.tipo='consumo' limit 1;
    return; end if;

  -- Orden de locks idéntico a la legacy: billetera primero.
  select m.telefono_norm into v_telefono from public.mensualidades m where m.id = p_mensualidad_id;
  if v_telefono is null then raise exception 'mensualidad_inexistente' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);
  select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id for update;
  if not found then raise exception 'mensualidad_inexistente' using errcode='P0002'; end if;

  -- (B6) La modalidad es la DEL PLAN, no la del reloj. Un plan legacy (o NULL)
  -- no reserva con la grilla v2. Con el plan bloqueado, esto es autoritativo.
  if v_mens.modalidad is distinct from 'v2_10' then
    raise exception 'modalidad_no_corresponde' using errcode='22023'; end if;

  v_hoy := public.mensualidad_hoy();
  v_estado := public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy);
  if v_estado='bloqueada' then raise exception 'mensualidad_bloqueada' using errcode='22023'; end if;
  if v_estado='vencida' then raise exception 'mensualidad_vencida' using errcode='22023'; end if;
  if v_estado='agotada' then raise exception 'mensualidad_agotada' using errcode='22023'; end if;
  if p_fecha > v_mens.vence_el then raise exception 'turno_posterior_al_vencimiento' using errcode='22023'; end if;
  if p_fecha <= v_hoy then raise exception 'fecha_fuera_de_ventana' using errcode='22023'; end if;
  if p_fecha > (v_hoy + 15) then raise exception 'fecha_fuera_de_ventana' using errcode='22023'; end if;

  -- Minutos COMERCIALES: duración × simuladores. El buffer no consume saldo.
  v_minutos := p_duracion * v_n_sims;
  if v_minutos > v_mens.saldo_minutos then raise exception 'saldo_insuficiente' using errcode='22023'; end if;
  v_saldo_fin := v_mens.saldo_minutos - v_minutos;
  v_ref := public.reserva_generar_referencia();

  insert into public.reservas
    (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
     total, total_original, descuento_aplicado, estado, acepto_condiciones,
     duracion_minutos, origen, mensualidad_id, minutos_consumidos,
     importe_complementario, cobertura, idempotency_key, condiciones_version, condiciones_at, referencia_publica,
     modalidad)
  values
    (v_mens.titular_nombre, v_mens.titular_apellido, v_mens.titular_telefono, v_mens.titular_email,
     p_fecha, p_hora, to_jsonb(p_simuladores), v_n_sims, 0, 0, 0, 'activa', true,
     p_duracion, 'mensualidad', v_mens.id, v_minutos, 0, 'saldo', p_idempotency_key,
     btrim(p_condiciones_version), now(), v_ref,
     'v2_10')
  returning * into v_reserva;

  -- UNA fila por simulador: [hora, hora + duración + buffer). El trigger B1
  -- (reserva_slot_bloqueo) controla bloqueos y solapamientos con legacy y v2.
  foreach v_sim in array p_simuladores loop
    insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado, ocupacion_min)
    values (v_reserva.id, p_fecha, p_hora, v_sim, 'activa', p_duracion + c_buffer);
  end loop;

  update public.mensualidades set saldo_minutos = v_saldo_fin where id = v_mens.id;
  insert into public.mensualidad_movimientos
    (mensualidad_id, reserva_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo, actor, idempotency_key)
  values (v_mens.id, v_reserva.id, 'consumo', -v_minutos, v_mens.saldo_minutos, v_saldo_fin,
     format('Reserva %s %s - %s min x %s simulador(es)', p_fecha, p_hora, p_duracion, v_n_sims),
     'titular', 'reserva:' || p_idempotency_key);

  return query select v_reserva.id, v_ref, v_minutos, v_mens.saldo_minutos, v_saldo_fin, false;
end; $function$;

revoke all on function public.crear_reserva_mensualidad_v2(uuid, date, text, integer, text[], text, text) from public, anon, authenticated;
grant execute on function public.crear_reserva_mensualidad_v2(uuid, date, text, integer, text[], text, text) to service_role;

-- ── 3. Reprogramación v2 ────────────────────────────────────────────────────
-- La reserva conserva SU modalidad y su duración: solo cambian fecha y hora.

create or replace function public.reprogramar_reserva_mensualidad_v2(
  p_mensualidad_id uuid, p_referencia text, p_fecha date, p_hora text,
  p_idempotency_key text, p_ignorar_bloqueo boolean default false)
returns table(reserva_id bigint, referencia_publica text, fecha text, hora text,
              duracion_minutos integer, minutos_consumidos integer, sin_cambios boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_buffer constant integer := 10;
  v_telefono text;
  v_mens     public.mensualidades%rowtype;
  v_reserva  public.reservas%rowtype;
  v_inicio   timestamptz;
  v_hoy      date;
  v_sims     text[];
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

  v_hoy := public.mensualidad_hoy();
  if not coalesce(p_ignorar_bloqueo, false)
     and public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy) = 'bloqueada'
  then
    raise exception 'mensualidad_bloqueada' using errcode = '22023';
  end if;

  select * into v_reserva from public.reservas r
   where r.referencia_publica = p_referencia
     and r.mensualidad_id = p_mensualidad_id
     and r.origen = 'mensualidad'
   for update;
  if not found then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  -- (B6) Esta RPC mueve solo reservas v2. Una legacy va por la legacy.
  if v_reserva.modalidad is distinct from 'v2_10' then
    raise exception 'modalidad_no_corresponde' using errcode = '22023';
  end if;

  if v_reserva.estado <> 'activa' then
    raise exception 'estado_no_reprogramable' using errcode = '22023';
  end if;
  if coalesce(v_reserva.no_show, false) then
    raise exception 'estado_no_reprogramable' using errcode = '22023';
  end if;

  v_inicio := (v_reserva.fecha || ' ' || v_reserva.hora)::timestamp
              at time zone 'America/Argentina/Cordoba';
  if v_inicio <= now() then
    raise exception 'reserva_ya_iniciada' using errcode = '22023';
  end if;
  if (v_inicio - now()) < interval '24 hours' then
    raise exception 'fuera_de_plazo' using errcode = '22023';
  end if;

  if v_reserva.fecha = p_fecha::text and v_reserva.hora = p_hora then
    return query
      select v_reserva.id, v_reserva.referencia_publica, v_reserva.fecha, v_reserva.hora,
             v_reserva.duracion_minutos, v_reserva.minutos_consumidos, true;
    return;
  end if;

  if not public.mensualidad_dia_habilitado(p_fecha) then
    raise exception 'dia_no_habilitado' using errcode = '22023';
  end if;
  if not public.mensualidad_horario_valido_v2(p_fecha, p_hora, v_reserva.duracion_minutos) then
    raise exception 'fuera_de_horario' using errcode = '22023';
  end if;

  if p_fecha <= v_hoy then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;
  if p_fecha > (v_hoy + 15) then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;
  if p_fecha > v_mens.vence_el then
    raise exception 'turno_posterior_al_vencimiento' using errcode = '22023';
  end if;

  select array_agg(x order by x) into v_sims
    from jsonb_array_elements_text(v_reserva.simuladores) x;
  if coalesce(array_length(v_sims, 1), 0) = 0 then
    raise exception 'reserva_sin_simuladores' using errcode = '22023';
  end if;
  if array_length(v_sims, 1) < 1 or array_length(v_sims, 1) > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode = '22023';
  end if;

  -- Primero se liberan los slots viejos: el trigger solo mira los activos, así
  -- que el turno nuevo puede pisar el tramo que ocupaba el viejo.
  update public.reserva_slots rs
     set estado = 'reprogramada'
   where rs.reserva_id = v_reserva.id and rs.estado = 'activa';

  foreach v_sim in array v_sims loop
    insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado, ocupacion_min)
    values (v_reserva.id, p_fecha, p_hora, v_sim, 'activa', v_reserva.duracion_minutos + c_buffer);
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
$function$;

revoke all on function public.reprogramar_reserva_mensualidad_v2(uuid, text, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.reprogramar_reserva_mensualidad_v2(uuid, text, date, text, text, boolean) to service_role;

-- ── 4. Reserva legacy: misma firma, dos guardas ─────────────────────────────
-- (a) un plan v2 no reserva con la grilla legacy; (b) la reserva guarda
-- modalidad = 'legacy' explícita (NULL también es legacy: nada cambia de lectura).

create or replace function public.crear_reserva_mensualidad(p_mensualidad_id uuid, p_fecha date, p_hora text, p_duracion integer, p_simuladores text[], p_slots text[], p_idempotency_key text, p_condiciones_version text)
 returns table(reserva_id bigint, referencia_publica text, minutos_consumidos integer, saldo_anterior integer, saldo_posterior integer, idempotente boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_telefono text; v_mens public.mensualidades%rowtype; v_hoy date; v_estado text;
  v_minutos integer; v_saldo_fin integer; v_reserva public.reservas%rowtype;
  v_ref text; v_slot text; v_sim text; v_n_sims integer;
  v_sims_prev text[]; v_sims_new text[];
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'idempotency_key_invalida' using errcode='22023'; end if;
  if p_duracion is null or p_duracion not in (15,30,45,60) then
    raise exception 'duracion_invalida' using errcode='22023'; end if;
  if coalesce(btrim(p_condiciones_version),'') = '' then
    raise exception 'condiciones_requeridas' using errcode='22023'; end if;

  if not public.mensualidad_dia_habilitado(p_fecha) then
    raise exception 'dia_no_habilitado' using errcode='22023'; end if;
  if not public.mensualidad_horario_valido(p_fecha, p_hora, p_duracion) then
    raise exception 'fuera_de_horario' using errcode='22023'; end if;

  v_n_sims := coalesce(array_length(p_simuladores,1),0);
  if v_n_sims < 1 or v_n_sims > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode='22023'; end if;
  if v_n_sims <> (select count(distinct s) from unnest(p_simuladores) s) then
    raise exception 'simuladores_duplicados' using errcode='22023'; end if;
  if exists (select 1 from unnest(p_simuladores) s
             where s not in ('Ferrari','McLaren','Red Bull','Alpine')) then
    raise exception 'simulador_desconocido' using errcode='22023'; end if;

  if not public.mensualidad_bloques_coherentes(p_hora, p_duracion, p_slots) then
    raise exception 'bloques_incoherentes' using errcode='22023'; end if;

  select * into v_reserva from public.reservas r where r.idempotency_key = p_idempotency_key limit 1;
  if found then
    select array_agg(x order by x) into v_sims_prev from jsonb_array_elements_text(v_reserva.simuladores) x;
    select array_agg(s order by s) into v_sims_new from unnest(p_simuladores) s;
    if v_reserva.mensualidad_id is distinct from p_mensualidad_id
       or v_reserva.fecha is distinct from p_fecha::text or v_reserva.hora is distinct from p_hora
       or v_reserva.duracion_minutos is distinct from p_duracion or v_sims_prev is distinct from v_sims_new
       or coalesce(v_reserva.modalidad, 'legacy') <> 'legacy' then
      raise exception 'idempotency_key_con_otro_payload' using errcode='23505'; end if;
    return query select v_reserva.id, v_reserva.referencia_publica, v_reserva.minutos_consumidos,
      mv.saldo_anterior, mv.saldo_posterior, true
      from public.mensualidad_movimientos mv
      where mv.reserva_id = v_reserva.id and mv.tipo='consumo' limit 1;
    return; end if;

  select m.telefono_norm into v_telefono from public.mensualidades m where m.id = p_mensualidad_id;
  if v_telefono is null then raise exception 'mensualidad_inexistente' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_telefono)::bigint);
  select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id for update;
  if not found then raise exception 'mensualidad_inexistente' using errcode='P0002'; end if;

  -- (B6) Un plan v2 no reserva con la grilla legacy. NULL = legacy.
  if coalesce(v_mens.modalidad, 'legacy') <> 'legacy' then
    raise exception 'modalidad_no_corresponde' using errcode='22023'; end if;

  v_hoy := public.mensualidad_hoy();
  v_estado := public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy);
  if v_estado='bloqueada' then raise exception 'mensualidad_bloqueada' using errcode='22023'; end if;
  if v_estado='vencida' then raise exception 'mensualidad_vencida' using errcode='22023'; end if;
  if v_estado='agotada' then raise exception 'mensualidad_agotada' using errcode='22023'; end if;
  if p_fecha > v_mens.vence_el then raise exception 'turno_posterior_al_vencimiento' using errcode='22023'; end if;
  if p_fecha <= v_hoy then raise exception 'fecha_fuera_de_ventana' using errcode='22023'; end if;
  if p_fecha > (v_hoy + 15) then raise exception 'fecha_fuera_de_ventana' using errcode='22023'; end if;

  v_minutos := p_duracion * v_n_sims;
  if v_minutos > v_mens.saldo_minutos then raise exception 'saldo_insuficiente' using errcode='22023'; end if;
  v_saldo_fin := v_mens.saldo_minutos - v_minutos;
  v_ref := public.reserva_generar_referencia();

  insert into public.reservas
    (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
     total, total_original, descuento_aplicado, estado, acepto_condiciones,
     duracion_minutos, origen, mensualidad_id, minutos_consumidos,
     importe_complementario, cobertura, idempotency_key, condiciones_version, condiciones_at, referencia_publica,
     modalidad)
  values
    (v_mens.titular_nombre, v_mens.titular_apellido, v_mens.titular_telefono, v_mens.titular_email,
     p_fecha, p_hora, to_jsonb(p_simuladores), v_n_sims, 0, 0, 0, 'activa', true,
     p_duracion, 'mensualidad', v_mens.id, v_minutos, 0, 'saldo', p_idempotency_key,
     btrim(p_condiciones_version), now(), v_ref,
     'legacy')
  returning * into v_reserva;

  foreach v_slot in array p_slots loop
    foreach v_sim in array p_simuladores loop
      insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado)
      values (v_reserva.id, p_fecha, v_slot, v_sim, 'activa');
    end loop;
  end loop;

  update public.mensualidades set saldo_minutos = v_saldo_fin where id = v_mens.id;
  insert into public.mensualidad_movimientos
    (mensualidad_id, reserva_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo, actor, idempotency_key)
  values (v_mens.id, v_reserva.id, 'consumo', -v_minutos, v_mens.saldo_minutos, v_saldo_fin,
     format('Reserva %s %s - %s min x %s simulador(es)', p_fecha, p_hora, p_duracion, v_n_sims),
     'titular', 'reserva:' || p_idempotency_key);

  return query select v_reserva.id, v_ref, v_minutos, v_mens.saldo_minutos, v_saldo_fin, false;
end; $function$;

revoke all on function public.crear_reserva_mensualidad(uuid, date, text, integer, text[], text[], text, text) from public, anon, authenticated;
grant execute on function public.crear_reserva_mensualidad(uuid, date, text, integer, text[], text[], text, text) to service_role;

-- ── 4. Reprogramación legacy: misma firma, una guarda ───────────────────────

create or replace function public.reprogramar_reserva_mensualidad(p_mensualidad_id uuid, p_referencia text, p_fecha date, p_hora text, p_slots text[], p_idempotency_key text, p_ignorar_bloqueo boolean default false)
 returns table(reserva_id bigint, referencia_publica text, fecha text, hora text, duracion_minutos integer, minutos_consumidos integer, sin_cambios boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  v_hoy := public.mensualidad_hoy();
  if not coalesce(p_ignorar_bloqueo, false)
     and public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy) = 'bloqueada'
  then
    raise exception 'mensualidad_bloqueada' using errcode = '22023';
  end if;

  select * into v_reserva from public.reservas r
   where r.referencia_publica = p_referencia
     and r.mensualidad_id = p_mensualidad_id
     and r.origen = 'mensualidad'
   for update;
  if not found then
    raise exception 'reserva_inexistente' using errcode = 'P0002';
  end if;

  -- (B6) Una reserva v2 no se mueve con la grilla legacy. NULL = legacy.
  if coalesce(v_reserva.modalidad, 'legacy') <> 'legacy' then
    raise exception 'modalidad_no_corresponde' using errcode = '22023';
  end if;

  if v_reserva.estado <> 'activa' then
    raise exception 'estado_no_reprogramable' using errcode = '22023';
  end if;
  if coalesce(v_reserva.no_show, false) then
    raise exception 'estado_no_reprogramable' using errcode = '22023';
  end if;

  v_inicio := (v_reserva.fecha || ' ' || v_reserva.hora)::timestamp
              at time zone 'America/Argentina/Cordoba';
  if v_inicio <= now() then
    raise exception 'reserva_ya_iniciada' using errcode = '22023';
  end if;
  if (v_inicio - now()) < interval '24 hours' then
    raise exception 'fuera_de_plazo' using errcode = '22023';
  end if;

  if v_reserva.fecha = p_fecha::text and v_reserva.hora = p_hora then
    return query
      select v_reserva.id, v_reserva.referencia_publica, v_reserva.fecha, v_reserva.hora,
             v_reserva.duracion_minutos, v_reserva.minutos_consumidos, true;
    return;
  end if;

  if not public.mensualidad_dia_habilitado(p_fecha) then
    raise exception 'dia_no_habilitado' using errcode = '22023';
  end if;
  if not public.mensualidad_horario_valido(p_fecha, p_hora, v_reserva.duracion_minutos) then
    raise exception 'fuera_de_horario' using errcode = '22023';
  end if;

  if p_fecha <= v_hoy then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;
  if p_fecha > (v_hoy + 15) then
    raise exception 'fecha_fuera_de_ventana' using errcode = '22023';
  end if;
  if p_fecha > v_mens.vence_el then
    raise exception 'turno_posterior_al_vencimiento' using errcode = '22023';
  end if;

  if not public.mensualidad_bloques_coherentes(p_hora, v_reserva.duracion_minutos, p_slots) then
    raise exception 'bloques_incoherentes' using errcode = '22023';
  end if;

  select array_agg(x order by x) into v_sims
    from jsonb_array_elements_text(v_reserva.simuladores) x;
  if coalesce(array_length(v_sims, 1), 0) = 0 then
    raise exception 'reserva_sin_simuladores' using errcode = '22023';
  end if;
  if array_length(v_sims, 1) < 1 or array_length(v_sims, 1) > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode = '22023';
  end if;

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
$function$;

revoke all on function public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text, boolean) from public, anon, authenticated;
grant execute on function public.reprogramar_reserva_mensualidad(uuid, text, date, text, text[], text, boolean) to service_role;

-- ── 5. Aplicación de compras: fija la modalidad del plan ────────────────────

create or replace function public.mensualidad_aplicar_compra_interna(p_compra_id uuid, p_efectiva_at timestamp with time zone, p_idem_movimiento text, p_mp_payment_id text default null::text, p_importe_bruto numeric default null::numeric, p_comision_mp numeric default null::numeric, p_importe_neto numeric default null::numeric)
 returns mensualidad_compras
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_max_traslado constant integer := 60;
  v_compra    public.mensualidad_compras;
  v_mens      public.mensualidades;
  v_hoy       date;
  v_vence     date;
  v_traslado  integer := 0;
  v_descarte  integer := 0;
  v_saldo_ini integer := 0;
  v_saldo_fin integer;
  v_tipo      text;
  v_codigo    text;
  v_sufijo    text;
  v_modalidad text;
begin
  select * into v_compra from public.mensualidad_compras
   where id = p_compra_id for update;
  if not found then raise exception 'compra_inexistente' using errcode = 'P0002'; end if;
  if v_compra.procesamiento = 'aplicado' then return v_compra; end if;

  if v_compra.telefono_norm !~ '^[0-9]{10}$' then
    raise exception 'telefono_no_canonico' using errcode = '22023';
  end if;

  v_sufijo := case v_compra.canal
                when 'admin_venta'    then ' (venta administrativa)'
                when 'admin_cortesia' then ' (cortesia sin cobro)'
                else '' end;

  v_hoy   := (p_efectiva_at at time zone 'America/Argentina/Cordoba')::date;
  v_vence := v_hoy + v_compra.plan_vigencia_dias;

  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_compra.telefono_norm)::bigint);

  select * into v_mens from public.mensualidades
   where telefono_norm = v_compra.telefono_norm
   order by vence_el desc, created_at desc limit 1
   for update;

  if found and v_mens.vence_el >= v_hoy then
    v_tipo      := 'renovacion';
    v_saldo_ini := v_mens.saldo_minutos;
    v_traslado  := least(v_saldo_ini, c_max_traslado);
    v_descarte  := v_saldo_ini - v_traslado;
    v_saldo_fin := v_traslado + v_compra.plan_minutos;
    v_codigo    := v_mens.codigo;

    if v_descarte > 0 then
      insert into public.mensualidad_movimientos
        (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo)
      values
        (v_mens.id, v_compra.id, 'descarte', -v_descarte, v_saldo_ini, v_traslado,
         format('Excede el maximo trasladable de %s minutos al renovar', c_max_traslado));
    end if;

    insert into public.mensualidad_movimientos
      (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo, idempotency_key)
    values
      (v_mens.id, v_compra.id, 'renovacion', v_compra.plan_minutos, v_traslado, v_saldo_fin,
       format('Renovacion con plan %s%s', v_compra.plan_slug, v_sufijo), p_idem_movimiento);

    -- (B6) La modalidad del plan es la de su compra aplicada de CREACIÓN más
    -- reciente, esta incluida. No depende del orden en que llegan los webhooks:
    -- una compra legacy creada antes del corte que se aprueba DESPUÉS de una v2
    -- no degrada el plan a legacy.
    select t.modalidad into v_modalidad
      from (
        select c.created_at, c.id, c.modalidad
          from public.mensualidad_compras c
         where c.mensualidad_id = v_mens.id
           and c.procesamiento = 'aplicado'
           and c.id <> v_compra.id
        union all
        select v_compra.created_at, v_compra.id, v_compra.modalidad
      ) t
     order by t.created_at desc, t.id desc
     limit 1;

    update public.mensualidades
       set saldo_minutos    = v_saldo_fin,
           vence_el         = v_vence,
           titular_nombre   = v_compra.comprador_nombre,
           titular_apellido = v_compra.comprador_apellido,
           titular_email    = v_compra.comprador_email,
           modalidad        = v_modalidad
     where id = v_mens.id
     returning * into v_mens;
  else
    v_tipo      := 'alta';
    v_saldo_ini := 0;
    v_traslado  := 0;
    v_descarte  := 0;
    v_saldo_fin := v_compra.plan_minutos;
    v_codigo    := public.mensualidad_generar_codigo();

    -- (B6) Un plan nuevo nace con la modalidad de su compra (NULL = legacy).
    insert into public.mensualidades
      (codigo, titular_nombre, titular_apellido, titular_telefono, telefono_norm,
       titular_email, saldo_minutos, vence_el, modalidad)
    values
      (v_codigo, v_compra.comprador_nombre, v_compra.comprador_apellido,
       v_compra.comprador_telefono, v_compra.telefono_norm, v_compra.comprador_email,
       v_saldo_fin, v_vence, v_compra.modalidad)
    returning * into v_mens;

    insert into public.mensualidad_movimientos
      (mensualidad_id, compra_id, tipo, minutos, saldo_anterior, saldo_posterior, motivo, idempotency_key)
    values
      (v_mens.id, v_compra.id, 'compra', v_compra.plan_minutos, 0, v_saldo_fin,
       format('Alta con plan %s%s', v_compra.plan_slug, v_sufijo), p_idem_movimiento);
  end if;

  update public.mensualidad_compras
     set mensualidad_id      = v_mens.id,
         tipo                = v_tipo,
         minutos_trasladados = v_traslado,
         minutos_descartados = v_descarte,
         saldo_resultante    = v_saldo_fin,
         vence_el            = v_vence,
         estado_pago         = 'aprobado',
         procesamiento       = 'aplicado',
         mp_payment_id       = coalesce(p_mp_payment_id, mp_payment_id),
         importe_bruto       = coalesce(p_importe_bruto, importe_bruto),
         comision_mp         = coalesce(p_comision_mp, comision_mp),
         importe_neto        = coalesce(p_importe_neto, importe_neto),
         aprobado_at         = p_efectiva_at
   where id = v_compra.id
   returning * into v_compra;

  return v_compra;
end;
$function$;

revoke all on function public.mensualidad_aplicar_compra_interna(uuid, timestamptz, text, text, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.mensualidad_aplicar_compra_interna(uuid, timestamptz, text, text, numeric, numeric, numeric) to service_role;

-- ── 6. Ajuste administrativo de saldo: múltiplos de 5 ───────────────────────

create or replace function public.mensualidad_admin_ajustar_saldo(p_mensualidad_id uuid, p_operacion text, p_minutos integer, p_motivo text, p_actor text, p_actor_rol text, p_idempotency_key text)
 returns table(saldo_anterior integer, saldo_posterior integer, minutos_aplicados integer, estado_resultante text, idempotente boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_mens  public.mensualidades%rowtype;
  v_tel   text;
  v_hoy   date;
  v_delta integer;
  v_final integer;
  v_prev  public.mensualidad_movimientos%rowtype;
begin
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);

  if p_operacion is null or p_operacion not in ('agregar', 'descontar') then
    raise exception 'operacion_invalida' using errcode = '22023';
  end if;
  if p_minutos is null or p_minutos <= 0 then
    raise exception 'minutos_invalidos' using errcode = '22023';
  end if;
  -- (B6) Múltiplos de 5: conviven saldos legacy (15/30/45/60) y v2 (10/20/30),
  -- así que un saldo real puede terminar en 35. Es la misma unidad que ya
  -- exigen los CHECK de mensualidades y mensualidad_movimientos desde B1.
  if p_minutos % 5 <> 0 then
    raise exception 'minutos_no_multiplo_5' using errcode = '22023';
  end if;

  v_delta := case when p_operacion = 'agregar' then p_minutos else -p_minutos end;

  select * into v_prev from public.mensualidad_movimientos mv
   where mv.idempotency_key = p_idempotency_key limit 1;
  if found then
    if v_prev.mensualidad_id is distinct from p_mensualidad_id
       or v_prev.tipo <> 'ajuste_admin'
       or v_prev.minutos is distinct from v_delta then
      raise exception 'idempotency_key_con_otro_payload' using errcode = '23505';
    end if;
    select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id;
    v_hoy := public.mensualidad_hoy();
    return query select
      v_prev.saldo_anterior, v_prev.saldo_posterior, v_prev.minutos,
      public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy),
      true;
    return;
  end if;

  select m.telefono_norm into v_tel from public.mensualidades m where m.id = p_mensualidad_id;
  if v_tel is null then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_tel)::bigint);

  select * into v_mens from public.mensualidades m where m.id = p_mensualidad_id for update;
  if not found then
    raise exception 'mensualidad_inexistente' using errcode = 'P0002';
  end if;

  v_final := v_mens.saldo_minutos + v_delta;
  if v_final < 0 then
    raise exception 'saldo_insuficiente' using errcode = '22023';
  end if;

  update public.mensualidades m
     set saldo_minutos = v_final
   where m.id = p_mensualidad_id;

  insert into public.mensualidad_movimientos (
    mensualidad_id, tipo, minutos, saldo_anterior, saldo_posterior,
    motivo, actor, idempotency_key
  ) values (
    p_mensualidad_id, 'ajuste_admin', v_delta, v_mens.saldo_minutos, v_final,
    p_motivo, p_actor, p_idempotency_key
  );

  perform public.mensualidad_auditar(
    p_mensualidad_id, 'ajustar_saldo', p_actor, p_actor_rol, p_motivo,
    jsonb_build_object('saldo_minutos', v_mens.saldo_minutos),
    jsonb_build_object('saldo_minutos', v_final, 'minutos', v_delta),
    null, null
  );

  v_hoy := public.mensualidad_hoy();
  return query select
    v_mens.saldo_minutos, v_final, v_delta,
    public.mensualidad_estado(v_final, v_mens.vence_el, v_mens.bloqueada, v_hoy),
    false;
end;
$function$;

revoke all on function public.mensualidad_admin_ajustar_saldo(uuid, text, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.mensualidad_admin_ajustar_saldo(uuid, text, integer, text, text, text, text) to service_role;

-- ── 7. Alta administrativa con modalidad comercial ─────────────────────────
-- Igual a mensualidad_admin_alta (M7.4), más dos datos que resuelve el SERVIDOR
-- una vez por request: la modalidad comercial y el precio de esa versión. El
-- precio tiene que ser una versión real del plan en mensualidad_plan_precios.
-- mensualidad_admin_alta queda intacta.

create or replace function public.mensualidad_admin_alta_v2(
  p_plan_slug text, p_nombre text, p_apellido text, p_telefono text, p_email text,
  p_modalidad text, p_medio_pago text, p_cortesia_tipo text, p_motivo text,
  p_actor text, p_actor_rol text, p_idempotency_key text, p_declaracion boolean,
  p_modalidad_comercial text, p_precio numeric, p_cobrado_el date default null::date)
returns table(compra_id uuid, mensualidad_id uuid, codigo text, tipo text, canal text,
  minutos_plan integer, saldo_anterior integer, saldo_posterior integer,
  vence_anterior date, vence_el date, codigo_conservado boolean,
  importe_bruto numeric, comision numeric, importe_neto numeric, idempotente boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tel        text;
  v_plan       public.mensualidad_planes%rowtype;
  v_canal      text;
  v_proc       text;
  v_bruto      numeric;
  v_comision   numeric;
  v_neto       numeric;
  v_pct        numeric;
  v_cfg        public.fin_comisiones_cobro%rowtype;
  v_compra     public.mensualidad_compras;
  v_previa     public.mensualidad_compras;
  v_mens       public.mensualidades;
  v_saldo_ant  integer := 0;
  v_vence_ant  date;
  v_cod_ant    text;
  v_efectiva   timestamptz;
  v_email      text;
begin
  perform public.mensualidad_admin_validar_entrada(p_motivo, p_actor, p_idempotency_key);

  if coalesce(p_actor_rol, '') <> 'admin' then
    raise exception 'rol_no_autorizado' using errcode = '42501';
  end if;
  if p_declaracion is not true then
    raise exception 'declaracion_requerida' using errcode = '22023';
  end if;
  if p_modalidad is null or p_modalidad not in ('venta', 'cortesia') then
    raise exception 'modalidad_invalida' using errcode = '22023';
  end if;
  if p_modalidad_comercial is null or p_modalidad_comercial not in ('legacy', 'v2_10') then
    raise exception 'modalidad_comercial_invalida' using errcode = '22023';
  end if;
  v_canal := case p_modalidad when 'venta' then 'admin_venta' else 'admin_cortesia' end;

  if p_cobrado_el is not null and p_cobrado_el > (now() at time zone 'America/Argentina/Cordoba')::date then
    raise exception 'fecha_cobro_futura' using errcode = '22023';
  end if;

  v_tel := public.mensualidad_normalizar_telefono(p_telefono);
  if v_tel is null or v_tel !~ '^[0-9]{10}$' then
    raise exception 'telefono_invalido' using errcode = '22023';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'email_invalido' using errcode = '22023';
  end if;
  if coalesce(btrim(p_nombre), '') = '' or coalesce(btrim(p_apellido), '') = '' then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;

  select * into v_previa from public.mensualidad_compras
   where idempotency_key = p_idempotency_key;
  if found then
    if v_previa.canal = 'web' then
      raise exception 'clave_de_otra_compra' using errcode = '23505';
    end if;
    select * into v_mens from public.mensualidades where id = v_previa.mensualidad_id;
    select (a.valor_anterior->>'saldo')::integer,
           nullif(a.valor_anterior->>'vence_el', '')::date
      into v_saldo_ant, v_vence_ant
      from public.mensualidad_auditoria a
     where a.idempotency_key = p_idempotency_key
     order by a.created_at asc limit 1;
    return query
      select v_previa.id, v_previa.mensualidad_id, v_mens.codigo, v_previa.tipo, v_previa.canal,
             v_previa.plan_minutos, coalesce(v_saldo_ant, 0), v_previa.saldo_resultante,
             v_vence_ant, v_previa.vence_el,
             (v_previa.tipo = 'renovacion'),
             v_previa.importe_bruto, v_previa.comision_mp, v_previa.importe_neto,
             true;
    return;
  end if;

  select * into v_plan from public.mensualidad_planes
   where slug = p_plan_slug and activo = true;
  if not found then
    raise exception 'plan_inexistente' using errcode = 'P0002';
  end if;
  if v_plan.minutos <= 0 or v_plan.vigencia_dias <= 0 then
    raise exception 'plan_inexistente' using errcode = 'P0002';
  end if;
  -- (B6) El precio lo resolvió el servidor para la modalidad comercial; tiene
  -- que ser una versión REAL de este plan. Nada inventado llega a una compra.
  if p_precio is null or p_precio <= 0 or not exists (
       select 1 from public.mensualidad_plan_precios pp
        where pp.plan_id = v_plan.id and pp.precio = p_precio) then
    raise exception 'precio_no_corresponde' using errcode = '22023';
  end if;

  if p_modalidad = 'venta' then
    if p_medio_pago is null or p_medio_pago not in ('efectivo', 'qr', 'debito', 'credito') then
      raise exception 'medio_pago_invalido' using errcode = '22023';
    end if;
    if p_cortesia_tipo is not null then
      raise exception 'cortesia_tipo_no_corresponde' using errcode = '22023';
    end if;
    v_proc  := case when p_medio_pago = 'efectivo' then null else 'mercado_pago' end;
    v_bruto := p_precio;

    if v_proc is not null then
      select * into v_cfg from public.fin_comisiones_cobro
       where procesador = v_proc and metodo_pago = p_medio_pago and activa = true;
      if found then
        v_pct := case when v_cfg.aplica_iva
                      then v_cfg.porcentaje_base * (1 + coalesce(v_cfg.iva_porcentaje, 0) / 100.0)
                      else v_cfg.porcentaje_base end;
        v_comision := round(v_bruto * v_pct / 100.0, 2);
        v_neto     := round(v_bruto - v_comision, 2);
      end if;
    else
      v_comision := 0;
      v_neto     := v_bruto;
    end if;

    v_efectiva := case
      when p_cobrado_el is null then now()
      else (p_cobrado_el::timestamp + (now() at time zone 'America/Argentina/Cordoba')::time)
             at time zone 'America/Argentina/Cordoba'
    end;
  else
    if p_medio_pago is not null then
      raise exception 'medio_pago_no_corresponde' using errcode = '22023';
    end if;
    if p_cortesia_tipo is null
       or p_cortesia_tipo not in ('cortesia_comercial', 'compensacion', 'correccion_autorizada') then
      raise exception 'cortesia_tipo_invalido' using errcode = '22023';
    end if;
    v_proc     := null;
    v_bruto    := 0;
    v_comision := null;
    v_neto     := null;
    v_efectiva := now();
  end if;

  perform pg_advisory_xact_lock(hashtext('mensualidad:' || v_tel)::bigint);

  select * into v_mens from public.mensualidades
   where telefono_norm = v_tel
   order by vence_el desc, created_at desc limit 1
   for update;

  if found then
    if v_mens.bloqueada then
      raise exception 'mensualidad_bloqueada' using errcode = '22023';
    end if;
    v_saldo_ant := v_mens.saldo_minutos;
    v_vence_ant := v_mens.vence_el;
    v_cod_ant   := v_mens.codigo;
  end if;

  insert into public.mensualidad_compras (
    plan_id, plan_slug, plan_nombre, plan_minutos, plan_precio, plan_vigencia_dias, plan_etiqueta,
    comprador_nombre, comprador_apellido, comprador_telefono, telefono_norm, comprador_email,
    importe_bruto, external_reference, idempotency_key,
    canal, medio_pago, procesador, cortesia_tipo, motivo_admin, registrado_por, cobrado_at,
    modalidad
  ) values (
    v_plan.id, v_plan.slug, v_plan.nombre, v_plan.minutos, p_precio, v_plan.vigencia_dias, v_plan.etiqueta,
    btrim(p_nombre), btrim(p_apellido), btrim(p_telefono), v_tel, v_email,
    v_bruto, 'admin_' || replace(gen_random_uuid()::text, '-', ''), p_idempotency_key,
    v_canal, p_medio_pago, v_proc, p_cortesia_tipo, btrim(p_motivo), p_actor,
    case when p_modalidad = 'venta' then v_efectiva else null end,
    p_modalidad_comercial
  )
  returning * into v_compra;

  v_compra := public.mensualidad_aplicar_compra_interna(
    v_compra.id, v_efectiva, 'admin:' || p_idempotency_key,
    null, v_bruto, v_comision, v_neto
  );

  select * into v_mens from public.mensualidades where id = v_compra.mensualidad_id;

  perform public.mensualidad_auditar(
    v_compra.mensualidad_id,
    case when v_compra.tipo = 'alta' then 'alta_administrativa' else 'renovacion_administrativa' end,
    p_actor, p_actor_rol, btrim(p_motivo),
    jsonb_build_object('saldo', v_saldo_ant, 'vence_el', v_vence_ant, 'codigo_previo', v_cod_ant is not null),
    jsonb_build_object(
      'modalidad', p_modalidad, 'canal', v_canal, 'plan', v_plan.slug,
      'modalidad_comercial', p_modalidad_comercial, 'plan_precio', p_precio,
      'minutos_plan', v_plan.minutos, 'saldo', v_compra.saldo_resultante,
      'vence_el', v_compra.vence_el, 'codigo_conservado', (v_compra.tipo = 'renovacion'),
      'medio_pago', p_medio_pago, 'procesador', v_proc,
      'cortesia_tipo', p_cortesia_tipo,
      'importe_bruto', v_bruto, 'comision', v_comision, 'importe_neto', v_neto,
      'cobrado_el', case when p_modalidad = 'venta' then v_efectiva::date else null end,
      'declaracion_condiciones', true
    ),
    v_compra.id::text, p_idempotency_key
  );

  return query
    select v_compra.id, v_compra.mensualidad_id, v_mens.codigo, v_compra.tipo, v_compra.canal,
           v_plan.minutos, v_saldo_ant, v_compra.saldo_resultante, v_vence_ant, v_compra.vence_el,
           (v_compra.tipo = 'renovacion'),
           v_compra.importe_bruto, v_compra.comision_mp, v_compra.importe_neto,
           false;
end;
$function$;

revoke all on function public.mensualidad_admin_alta_v2(text, text, text, text, text, text, text, text, text, text, text, text, boolean, text, numeric, date) from public, anon, authenticated;
grant execute on function public.mensualidad_admin_alta_v2(text, text, text, text, text, text, text, text, text, text, text, text, boolean, text, numeric, date) to service_role;

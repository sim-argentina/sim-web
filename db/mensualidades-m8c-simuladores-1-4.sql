-- Mensualidades SIM · M8C — Reservas con 1, 2, 3 o 4 simuladores
--
-- M5C.1 fijó el mínimo en DOS simuladores. Fue una lectura equivocada del
-- producto: nada en el negocio impide usar el saldo en un solo simulador, y el
-- consumo ya cobra lo justo en cualquier caso, porque es duración × cantidad.
-- El mínimo de 2 solo bloqueaba a quien viene a manejar solo, y además lo
-- obligaba a gastar el doble de saldo del que necesitaba.
--
-- Esta migración es ADITIVA: no edita ninguna migración ya aplicada. Recrea las
-- dos funciones que tenían el mínimo escrito a mano. La firma de las dos queda
-- EXACTAMENTE igual, así que CREATE OR REPLACE reemplaza de verdad y no deja
-- una sobrecarga ambigua (lo que sí pasaría si se agregara un parámetro).
--
-- Cambia una sola condición en cada una: `< 2` pasa a `< 1`. Todo lo demás
-- —duplicados, simuladores desconocidos, bloques, saldo, idempotencia, locks—
-- se reproduce sin tocar.

-- ── 1) Alta de la reserva ───────────────────────────────────────────────────
create or replace function public.crear_reserva_mensualidad(
  p_mensualidad_id uuid, p_fecha date, p_hora text, p_duracion integer,
  p_simuladores text[], p_slots text[], p_idempotency_key text,
  p_condiciones_version text)
returns table(reserva_id bigint, referencia_publica text, minutos_consumidos integer,
              saldo_anterior integer, saldo_posterior integer, idempotente boolean)
language plpgsql security definer set search_path to 'public'
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
  if not public.mensualidad_termina_antes_del_cierre(p_hora, p_duracion) then
    raise exception 'fuera_de_horario' using errcode='22023'; end if;

  v_n_sims := coalesce(array_length(p_simuladores,1),0);
  -- (M8C) Antes: `v_n_sims < 2`. Cero sigue siendo inválido; uno ya no.
  if v_n_sims < 1 or v_n_sims > 4 then
    raise exception 'cantidad_simuladores_invalida' using errcode='22023'; end if;
  if v_n_sims <> (select count(distinct s) from unnest(p_simuladores) s) then
    raise exception 'simuladores_duplicados' using errcode='22023'; end if;
  if exists (select 1 from unnest(p_simuladores) s
             where s not in ('Ferrari','McLaren','Red Bull','Alpine')) then
    raise exception 'simulador_desconocido' using errcode='22023'; end if;

  if coalesce(array_length(p_slots,1),0) <> (p_duracion/15) then
    raise exception 'bloques_incoherentes' using errcode='22023'; end if;
  if array_length(p_slots,1) <> (select count(distinct s) from unnest(p_slots) s) then
    raise exception 'bloques_incoherentes' using errcode='22023'; end if;
  if p_slots[1] is distinct from p_hora then
    raise exception 'bloques_incoherentes' using errcode='22023'; end if;
  if p_slots <> (select array_agg(s order by s) from unnest(p_slots) s) then
    raise exception 'bloques_desordenados' using errcode='22023'; end if;

  select * into v_reserva from public.reservas r where r.idempotency_key = p_idempotency_key limit 1;
  if found then
    select array_agg(x order by x) into v_sims_prev from jsonb_array_elements_text(v_reserva.simuladores) x;
    select array_agg(s order by s) into v_sims_new from unnest(p_simuladores) s;
    if v_reserva.mensualidad_id is distinct from p_mensualidad_id
       or v_reserva.fecha is distinct from p_fecha::text or v_reserva.hora is distinct from p_hora
       or v_reserva.duracion_minutos is distinct from p_duracion or v_sims_prev is distinct from v_sims_new then
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

  v_hoy := public.mensualidad_hoy();
  v_estado := public.mensualidad_estado(v_mens.saldo_minutos, v_mens.vence_el, v_mens.bloqueada, v_hoy);
  if v_estado='bloqueada' then raise exception 'mensualidad_bloqueada' using errcode='22023'; end if;
  if v_estado='vencida' then raise exception 'mensualidad_vencida' using errcode='22023'; end if;
  if v_estado='agotada' then raise exception 'mensualidad_agotada' using errcode='22023'; end if;
  if p_fecha > v_mens.vence_el then raise exception 'turno_posterior_al_vencimiento' using errcode='22023'; end if;
  if p_fecha <= v_hoy then raise exception 'fecha_fuera_de_ventana' using errcode='22023'; end if;

  -- El consumo lo calcula el MOTOR con la duración y la cantidad que acaba de
  -- validar. Nunca llega un total desde el navegador.
  v_minutos := p_duracion * v_n_sims;
  if v_minutos > v_mens.saldo_minutos then raise exception 'saldo_insuficiente' using errcode='22023'; end if;
  v_saldo_fin := v_mens.saldo_minutos - v_minutos;
  v_ref := public.reserva_generar_referencia();

  insert into public.reservas
    (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
     total, total_original, descuento_aplicado, estado, acepto_condiciones,
     duracion_minutos, origen, mensualidad_id, minutos_consumidos,
     importe_complementario, cobertura, idempotency_key, condiciones_version, condiciones_at, referencia_publica)
  values
    (v_mens.titular_nombre, v_mens.titular_apellido, v_mens.titular_telefono, v_mens.titular_email,
     p_fecha, p_hora, to_jsonb(p_simuladores), v_n_sims, 0, 0, 0, 'activa', true,
     p_duracion, 'mensualidad', v_mens.id, v_minutos, 0, 'saldo', p_idempotency_key,
     btrim(p_condiciones_version), now(), v_ref)
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

-- ── 2) Reprogramación ───────────────────────────────────────────────────────
-- Acá el mínimo se comprobaba sobre los simuladores YA GUARDADOS en la reserva.
-- Con `< 2` una reserva legítima de un solo simulador quedaba imposible de
-- reprogramar: se podía crear pero no mover. La reprogramación no cambia la
-- cantidad de simuladores ni vuelve a debitar saldo.
create or replace function public.reprogramar_reserva_mensualidad(
  p_mensualidad_id uuid, p_referencia text, p_fecha date, p_hora text,
  p_slots text[], p_idempotency_key text, p_ignorar_bloqueo boolean default false)
returns table(reserva_id bigint, referencia_publica text, fecha text, hora text,
              duracion_minutos integer, minutos_consumidos integer, sin_cambios boolean)
language plpgsql security definer set search_path to 'public'
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
  if not public.mensualidad_termina_antes_del_cierre(p_hora, v_reserva.duracion_minutos) then
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

  select array_agg(x order by x) into v_sims
    from jsonb_array_elements_text(v_reserva.simuladores) x;
  if coalesce(array_length(v_sims, 1), 0) = 0 then
    raise exception 'reserva_sin_simuladores' using errcode = '22023';
  end if;
  -- (M8C) Antes: `< 2`. Una reserva de un simulador ya puede reprogramarse.
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

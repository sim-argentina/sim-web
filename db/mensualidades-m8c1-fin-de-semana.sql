-- Mensualidades SIM · M8C.1 — Reservar también sábados y domingos
--
-- M5C.1 restringió Mensualidades a lunes–viernes. Nada del negocio lo pedía:
-- el local abre los siete días y quien compró horas tiene que poder usarlas
-- cuando el local abre.
--
-- REGLA DEFINITIVA
--   · lunes a viernes: inicios de 10:00 a 21:40 y la experiencia TERMINA a las
--     22:00 o antes;
--   · sábados y domingos: inicios de 10:00 a 14:00 INCLUSIVE, y el turno puede
--     terminar después de las 14:00 según la duración elegida.
--
-- Los dos tipos de día se limitan de maneras DISTINTAS, y eso es deliberado:
-- entre semana lo que manda es la hora de CIERRE; el fin de semana lo que manda
-- es el ÚLTIMO INICIO. No hay un "cierre de las 15:00": nadie fijó esa hora. Lo
-- que el negocio define el sábado es hasta qué hora se puede empezar, y eso es
-- exactamente lo que dice la grilla.
--
-- Lo demás no cambia: 15/30/45/60 minutos, de 1 a 4 simuladores, consumo =
-- duración × cantidad, desde el día siguiente, hasta 15 días, dentro de la
-- vigencia, con bloqueos y disponibilidad real.
--
-- CAMBIO DE NOMBRE Y DE FIRMA
-- `mensualidad_termina_antes_del_cierre(hora, duración)` comparaba siempre
-- contra las 22:00. Ya no describe lo que hay que verificar: el fin de semana
-- nada "termina antes del cierre". Se reemplaza por
-- `mensualidad_horario_valido(fecha, hora, duración)`, que comprueba las dos
-- cosas que de verdad importan: que el INICIO exista en la grilla de ese día y,
-- solo entre semana, que la experiencia termine a las 22:00 o antes.
--
-- Eso cierra además un hueco: la función vieja no miraba la grilla, así que un
-- cuerpo manipulado podía pedir un sábado a las 20:00 y la base lo aceptaba
-- mientras "terminara antes de las 22:00". Ahora no.
--
-- Las dos RPC que la llaman se recrean en la misma migración —y por lo tanto en
-- la misma transacción—, así que no queda ni un instante con la función vieja
-- borrada y las RPC apuntando al vacío.

-- ── 1) El día: ya no se filtra por día de la semana ─────────────────────────
-- La función se conserva, aunque hoy solo valide que la fecha exista. Es el
-- lugar donde vivía la regla y donde volvería a vivir si algún día se
-- restringiera de nuevo; borrarla obligaría a tocar las dos RPC para eso.
create or replace function public.mensualidad_dia_habilitado(p_fecha date)
returns boolean language sql immutable set search_path to 'public'
as $function$
  select p_fecha is not null;
$function$;

-- ── 2) El horario: la grilla del día, y el cierre solo entre semana ─────────
drop function if exists public.mensualidad_termina_antes_del_cierre(text, integer);
drop function if exists public.mensualidad_termina_antes_del_cierre(date, text, integer);

create function public.mensualidad_horario_valido(
  p_fecha date, p_hora text, p_duracion integer)
returns boolean language sql immutable set search_path to 'public'
as $function$
  with datos as (
    select
      p_fecha is not null
        and p_hora ~ '^\d{2}:\d{2}$'
        and p_duracion is not null
        and p_duracion > 0                                         as forma_ok,
      split_part(p_hora, ':', 1)::int * 60
        + split_part(p_hora, ':', 2)::int                          as inicio,
      -- isodow: 1 = lunes … 7 = domingo.
      extract(isodow from p_fecha) between 1 and 5                 as es_semana
  )
  select forma_ok
     -- El inicio siempre tiene que existir en la grilla de ese día: desde las
     -- 10:00, cada 20 minutos, hasta el último inicio del día. Esto es lo que
     -- rechaza un 14:20 un sábado, o un 20:00.
     and inicio >= 10 * 60
     and (inicio - 10 * 60) % 20 = 0
     and inicio <= case when es_semana then 21 * 60 + 40 else 14 * 60 end
     -- Y SOLO entre semana, además, la experiencia tiene que terminar a las
     -- 22:00 o antes. El fin de semana no se comprueba nada de esto: el turno
     -- puede terminar después del último inicio.
     and (not es_semana or inicio + p_duracion <= 22 * 60)
  from datos;
$function$;

-- ── 3) Alta de la reserva ──────────────────────────────────────────────────
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
  -- (M8C.1) Grilla del día + cierre solo entre semana.
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
  -- (M8C.1) El TOPE de 15 días faltaba acá. Lo tenía reprogramar_reserva_
  -- mensualidad pero no el alta: la ventana solo la cerraba el módulo servidor.
  -- Como el módulo es el único que llama a esta RPC, nunca llegó a explotar,
  -- pero la última línea de defensa no puede depender de la primera.
  if p_fecha > (v_hoy + 15) then raise exception 'fecha_fuera_de_ventana' using errcode='22023'; end if;

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

-- ── 4) Reprogramación ──────────────────────────────────────────────────────
-- Misma regla que el alta: la fecha NUEVA manda. Mover un turno de un martes a
-- un sábado cambia el límite que se le aplica.
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
  -- (M8C.1) El límite lo define la fecha NUEVA.
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

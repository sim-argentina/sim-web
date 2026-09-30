-- ============================================================================
-- RESPALDO (B6): definiciones VIVAS en producción, leídas con
-- pg_get_functiondef() el 30/09/2026 antes de aplicar
-- db/mensualidades-b6-modalidad.sql. Son las cuatro funciones que B6 reemplaza
-- con CREATE OR REPLACE (misma firma). No es una migración: sirve para volver
-- atrás a mano si hiciera falta. Las funciones NUEVAS de B6 (_v2) no tienen
-- versión previa; para retirarlas alcanza con dejar de llamarlas.
--
-- Permisos vigentes de las cuatro: owner postgres, EXECUTE solo postgres y
-- service_role, SECURITY DEFINER, search_path = public.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crear_reserva_mensualidad(p_mensualidad_id uuid, p_fecha date, p_hora text, p_duracion integer, p_simuladores text[], p_slots text[], p_idempotency_key text, p_condiciones_version text)
 RETURNS TABLE(reserva_id bigint, referencia_publica text, minutos_consumidos integer, saldo_anterior integer, saldo_posterior integer, idempotente boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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


CREATE OR REPLACE FUNCTION public.reprogramar_reserva_mensualidad(p_mensualidad_id uuid, p_referencia text, p_fecha date, p_hora text, p_slots text[], p_idempotency_key text, p_ignorar_bloqueo boolean DEFAULT false)
 RETURNS TABLE(reserva_id bigint, referencia_publica text, fecha text, hora text, duracion_minutos integer, minutos_consumidos integer, sin_cambios boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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


CREATE OR REPLACE FUNCTION public.mensualidad_aplicar_compra_interna(p_compra_id uuid, p_efectiva_at timestamp with time zone, p_idem_movimiento text, p_mp_payment_id text DEFAULT NULL::text, p_importe_bruto numeric DEFAULT NULL::numeric, p_comision_mp numeric DEFAULT NULL::numeric, p_importe_neto numeric DEFAULT NULL::numeric)
 RETURNS mensualidad_compras
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    update public.mensualidades
       set saldo_minutos    = v_saldo_fin,
           vence_el         = v_vence,
           titular_nombre   = v_compra.comprador_nombre,
           titular_apellido = v_compra.comprador_apellido,
           titular_email    = v_compra.comprador_email
     where id = v_mens.id
     returning * into v_mens;
  else
    v_tipo      := 'alta';
    v_saldo_ini := 0;
    v_traslado  := 0;
    v_descarte  := 0;
    v_saldo_fin := v_compra.plan_minutos;
    v_codigo    := public.mensualidad_generar_codigo();

    insert into public.mensualidades
      (codigo, titular_nombre, titular_apellido, titular_telefono, telefono_norm,
       titular_email, saldo_minutos, vence_el)
    values
      (v_codigo, v_compra.comprador_nombre, v_compra.comprador_apellido,
       v_compra.comprador_telefono, v_compra.telefono_norm, v_compra.comprador_email,
       v_saldo_fin, v_vence)
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


CREATE OR REPLACE FUNCTION public.mensualidad_admin_ajustar_saldo(p_mensualidad_id uuid, p_operacion text, p_minutos integer, p_motivo text, p_actor text, p_actor_rol text, p_idempotency_key text)
 RETURNS TABLE(saldo_anterior integer, saldo_posterior integer, minutos_aplicados integer, estado_resultante text, idempotente boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if p_minutos % 15 <> 0 then
    raise exception 'minutos_no_multiplo_15' using errcode = '22023';
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

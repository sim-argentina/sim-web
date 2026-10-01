-- ============================================================================
-- Empresas B7.1 — la vigencia de una campaña se mide con la fecha de ARGENTINA.
-- ----------------------------------------------------------------------------
-- Las tres funciones Empresa que validan la vigencia comparaban
-- fecha_inicio/fecha_vencimiento contra CURRENT_DATE, que depende de la zona
-- de la SESIÓN, y la sesión de Postgres está en UTC. Entre las 21:00 y las
-- 23:59 de Argentina eso ya es "mañana": una campaña que empieza mañana se
-- podía canjear un día antes y una que vence hoy dejaba de canjearse tres
-- horas antes.
--
-- El cambio es UNO solo, igual en las tres: "hoy" pasa a ser
--   (now() at time zone 'America/Argentina/Buenos_Aires')::date
-- en la variable v_hoy, independiente de la zona de la sesión. La semántica
-- no cambia: vale desde fecha_inicio inclusive hasta fecha_vencimiento
-- inclusive. Mismas firmas, owner, SECURITY DEFINER, search_path y permisos.
-- consumir_empresa_codigo no la usa la aplicación; se corrige igual para que
-- ninguna función Empresa mida la vigencia en UTC.
--
-- Definiciones previas: db/empresas-b7-1-fecha.previo.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consumir_empresa_codigo(p_codigo text, p_nombre text, p_apellido text, p_telefono text, p_email text)
 RETURNS TABLE(uso_id uuid, codigo_id uuid, campania_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cod public.empresa_codigos%ROWTYPE;
  v_camp public.empresa_campanias%ROWTYPE;
  v_uso_id uuid;
BEGIN
  SELECT * INTO v_cod FROM public.empresa_codigos WHERE codigo = p_codigo FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_camp FROM public.empresa_campanias WHERE id = v_cod.campania_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_camp.deleted_at IS NOT NULL
     OR v_camp.estado IN ('borrador','cancelada','finalizada')
     OR v_camp.estado_pago <> 'pagado'
     OR v_camp.fecha_inicio IS NULL OR v_camp.fecha_inicio > v_hoy
     OR v_camp.fecha_vencimiento IS NULL OR v_camp.fecha_vencimiento < v_hoy
     OR v_cod.estado <> 'disponible'
     OR v_cod.usos_actuales >= v_cod.usos_maximos THEN
    RETURN;
  END IF;

  UPDATE public.empresa_codigos
     SET usos_actuales = usos_actuales + 1,
         estado = CASE WHEN usos_actuales + 1 >= usos_maximos THEN 'utilizado' ELSE 'disponible' END,
         updated_at = now()
   WHERE id = v_cod.id;

  INSERT INTO public.empresa_codigo_usos (codigo_id, campania_id, beneficiario_nombre, beneficiario_apellido, beneficiario_telefono, beneficiario_email)
  VALUES (v_cod.id, v_camp.id, p_nombre, p_apellido, p_telefono, p_email)
  RETURNING id INTO v_uso_id;

  RETURN QUERY SELECT v_uso_id, v_cod.id, v_camp.id;
END;
$function$;

revoke all on function public.consumir_empresa_codigo(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.consumir_empresa_codigo(text, text, text, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.crear_reserva_empresa(p_codigo text, p_nombre text, p_apellido text, p_telefono text, p_email text, p_fecha date, p_hora text, p_duracion integer, p_simuladores text[], p_slots text[], p_idempotency_key text)
 RETURNS TABLE(reserva_id bigint, codigo_id uuid, campania_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_cod public.empresa_codigos%ROWTYPE;
  v_camp public.empresa_campanias%ROWTYPE;
  v_reserva_id bigint;
  v_existente bigint;
  v_ret_cod uuid;
  v_ret_camp uuid;
  v_slot text;
  v_sim text;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT u.reserva_id, u.codigo_id, u.campania_id INTO v_existente, v_ret_cod, v_ret_camp
      FROM public.empresa_codigo_usos u
      WHERE u.idempotency_key = p_idempotency_key AND u.reserva_id IS NOT NULL LIMIT 1;
    IF v_existente IS NOT NULL THEN
      RETURN QUERY SELECT v_existente, v_ret_cod, v_ret_camp;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_cod FROM public.empresa_codigos WHERE codigo = p_codigo FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_camp FROM public.empresa_campanias WHERE id = v_cod.campania_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_camp.deleted_at IS NOT NULL
     OR v_camp.estado IN ('borrador','cancelada','finalizada')
     OR v_camp.estado_pago <> 'pagado'
     OR v_camp.fecha_inicio IS NULL OR v_camp.fecha_inicio > v_hoy
     OR v_camp.fecha_vencimiento IS NULL OR v_camp.fecha_vencimiento < v_hoy
     OR v_cod.estado <> 'disponible'
     OR v_cod.usos_actuales >= v_cod.usos_maximos
     OR p_duracion <> v_camp.duracion_minutos
     OR p_simuladores IS NULL OR array_length(p_simuladores, 1) < 1
     OR coalesce(v_camp.modalidad_comercial, 'legacy') <> 'legacy' THEN
    RETURN;
  END IF;

  INSERT INTO public.reservas
    (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
     total, total_original, descuento_aplicado, estado, acepto_condiciones, duracion_minutos,
     origen, empresa_campania_id, empresa_codigo_id, modalidad)
  VALUES
    (p_nombre, p_apellido, p_telefono, p_email, p_fecha, p_hora, to_jsonb(p_simuladores),
     coalesce(array_length(p_simuladores, 1), 1),
     0, 0, 0, 'activa', true, p_duracion, 'empresa', v_camp.id, v_cod.id, 'legacy')
  RETURNING id INTO v_reserva_id;

  FOREACH v_slot IN ARRAY p_slots LOOP
    FOREACH v_sim IN ARRAY p_simuladores LOOP
      INSERT INTO public.reserva_slots (reserva_id, fecha, hora, simulador, estado)
      VALUES (v_reserva_id, p_fecha, v_slot, v_sim, 'activa');
    END LOOP;
  END LOOP;

  UPDATE public.empresa_codigos
     SET usos_actuales = usos_actuales + 1,
         estado = CASE WHEN usos_actuales + 1 >= usos_maximos THEN 'utilizado' ELSE 'disponible' END,
         updated_at = now()
   WHERE id = v_cod.id;

  INSERT INTO public.empresa_codigo_usos
    (codigo_id, campania_id, beneficiario_nombre, beneficiario_apellido, beneficiario_telefono, beneficiario_email, reserva_id, idempotency_key)
  VALUES (v_cod.id, v_camp.id, p_nombre, p_apellido, p_telefono, p_email, v_reserva_id, p_idempotency_key);

  RETURN QUERY SELECT v_reserva_id, v_cod.id, v_camp.id;
EXCEPTION WHEN unique_violation OR check_violation THEN
  RETURN;
END;
$function$;

revoke all on function public.crear_reserva_empresa(text, text, text, text, text, date, text, integer, text[], text[], text) from public, anon, authenticated;
grant execute on function public.crear_reserva_empresa(text, text, text, text, text, date, text, integer, text[], text[], text) to service_role;

CREATE OR REPLACE FUNCTION public.crear_reserva_empresa_v2(p_codigo text, p_nombre text, p_apellido text, p_telefono text, p_email text, p_fecha date, p_hora text, p_duracion integer, p_simuladores text[], p_idempotency_key text)
 RETURNS TABLE(reserva_id bigint, codigo_id uuid, campania_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  c_buffer constant integer := 10;
  v_cod public.empresa_codigos%rowtype;
  v_camp public.empresa_campanias%rowtype;
  v_reserva_id bigint;
  v_existente bigint;
  v_ret_cod uuid;
  v_ret_camp uuid;
  v_sim text;
  v_n integer;
begin
  if p_idempotency_key is not null then
    select u.reserva_id, u.codigo_id, u.campania_id into v_existente, v_ret_cod, v_ret_camp
      from public.empresa_codigo_usos u
     where u.idempotency_key = p_idempotency_key and u.reserva_id is not null limit 1;
    if v_existente is not null then
      return query select v_existente, v_ret_cod, v_ret_camp;
      return;
    end if;
  end if;

  v_n := coalesce(array_length(p_simuladores, 1), 0);
  if v_n < 1 or v_n > 4
     or v_n <> (select count(distinct s) from unnest(p_simuladores) s)
     or exists (select 1 from unnest(p_simuladores) s where s not in ('Ferrari','McLaren','Red Bull','Alpine'))
     or not public.reserva_horario_valido_v2(p_fecha, p_hora, p_duracion) then
    return;
  end if;

  select * into v_cod from public.empresa_codigos where codigo = p_codigo for update;
  if not found then return; end if;
  select * into v_camp from public.empresa_campanias where id = v_cod.campania_id;
  if not found then return; end if;

  if v_camp.deleted_at is not null
     or v_camp.estado in ('borrador','cancelada','finalizada')
     or v_camp.estado_pago <> 'pagado'
     or v_camp.fecha_inicio is null or v_camp.fecha_inicio > v_hoy
     or v_camp.fecha_vencimiento is null or v_camp.fecha_vencimiento < v_hoy
     or v_cod.estado <> 'disponible'
     or v_cod.usos_actuales >= v_cod.usos_maximos
     or v_camp.modalidad_comercial is distinct from 'v2_10'
     or p_duracion <> v_camp.duracion_minutos then
    return;
  end if;

  insert into public.reservas
    (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
     total, total_original, descuento_aplicado, estado, acepto_condiciones, duracion_minutos,
     origen, empresa_campania_id, empresa_codigo_id, modalidad)
  values
    (p_nombre, p_apellido, p_telefono, p_email, p_fecha, p_hora, to_jsonb(p_simuladores), v_n,
     0, 0, 0, 'activa', true, p_duracion, 'empresa', v_camp.id, v_cod.id, 'v2_10')
  returning id into v_reserva_id;

  foreach v_sim in array p_simuladores loop
    insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado, ocupacion_min)
    values (v_reserva_id, p_fecha, p_hora, v_sim, 'activa', p_duracion + c_buffer);
  end loop;

  update public.empresa_codigos
     set usos_actuales = usos_actuales + 1,
         estado = case when usos_actuales + 1 >= usos_maximos then 'utilizado' else 'disponible' end,
         updated_at = now()
   where id = v_cod.id;

  insert into public.empresa_codigo_usos
    (codigo_id, campania_id, beneficiario_nombre, beneficiario_apellido, beneficiario_telefono, beneficiario_email, reserva_id, idempotency_key)
  values (v_cod.id, v_camp.id, p_nombre, p_apellido, p_telefono, p_email, v_reserva_id, p_idempotency_key);

  return query select v_reserva_id, v_cod.id, v_camp.id;
exception when unique_violation or check_violation then
  return;
end;
$function$;

revoke all on function public.crear_reserva_empresa_v2(text, text, text, text, text, date, text, integer, text[], text) from public, anon, authenticated;
grant execute on function public.crear_reserva_empresa_v2(text, text, text, text, text, date, text, integer, text[], text) to service_role;

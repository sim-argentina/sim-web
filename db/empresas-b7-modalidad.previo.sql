-- ============================================================================
-- RESPALDO (B7): definiciones VIVAS en producción, leídas con
-- pg_get_functiondef() el 30/09/2026 antes de aplicar db/empresas-b7-modalidad.sql.
-- Son las dos funciones que B7 reemplaza con CREATE OR REPLACE (misma firma).
-- No es una migración: sirve para volver atrás a mano si hiciera falta.
-- Permisos vigentes: owner postgres, SECURITY DEFINER, sin search_path fijado,
-- EXECUTE solo postgres y service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crear_reserva_empresa(p_codigo text, p_nombre text, p_apellido text, p_telefono text, p_email text, p_fecha date, p_hora text, p_duracion integer, p_simuladores text[], p_slots text[], p_idempotency_key text)
 RETURNS TABLE(reserva_id bigint, codigo_id uuid, campania_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
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
     OR v_camp.fecha_inicio IS NULL OR v_camp.fecha_inicio > CURRENT_DATE
     OR v_camp.fecha_vencimiento IS NULL OR v_camp.fecha_vencimiento < CURRENT_DATE
     OR v_cod.estado <> 'disponible'
     OR v_cod.usos_actuales >= v_cod.usos_maximos
     OR p_duracion <> v_camp.duracion_minutos
     OR p_simuladores IS NULL OR array_length(p_simuladores, 1) < 1 THEN
    RETURN;
  END IF;

  INSERT INTO public.reservas
    (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
     total, total_original, descuento_aplicado, estado, acepto_condiciones, duracion_minutos,
     origen, empresa_campania_id, empresa_codigo_id)
  VALUES
    (p_nombre, p_apellido, p_telefono, p_email, p_fecha, p_hora, to_jsonb(p_simuladores),
     coalesce(array_length(p_simuladores, 1), 1),
     0, 0, 0, 'activa', true, p_duracion, 'empresa', v_camp.id, v_cod.id)
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
  RETURN; -- slot ocupado o bloqueado, o carrera de idempotencia → rollback total
END;
$function$;


CREATE OR REPLACE FUNCTION public.reprogramar_reserva_empresa(p_reserva_id bigint, p_fecha date, p_hora text, p_simuladores text[], p_slots text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_res public.reservas%ROWTYPE; v_slot text; v_sim text;
BEGIN
  SELECT * INTO v_res FROM public.reservas WHERE id = p_reserva_id AND origen = 'empresa' FOR UPDATE;
  IF NOT FOUND OR v_res.estado <> 'activa' THEN RETURN false; END IF;
  UPDATE public.reserva_slots SET estado = 'cancelada' WHERE reserva_id = p_reserva_id;
  FOREACH v_slot IN ARRAY p_slots LOOP
    FOREACH v_sim IN ARRAY p_simuladores LOOP
      INSERT INTO public.reserva_slots (reserva_id, fecha, hora, simulador, estado)
      VALUES (p_reserva_id, p_fecha, v_slot, v_sim, 'activa');
    END LOOP;
  END LOOP;
  UPDATE public.reservas
     SET fecha = p_fecha, hora = p_hora, simuladores = to_jsonb(p_simuladores),
         cantidad_turnos = coalesce(array_length(p_simuladores, 1), 1)
   WHERE id = p_reserva_id;
  RETURN true;
EXCEPTION WHEN unique_violation OR check_violation THEN
  RETURN false; -- slot nuevo ocupado o bloqueado → rollback (reserva original intacta)
END;
$function$;

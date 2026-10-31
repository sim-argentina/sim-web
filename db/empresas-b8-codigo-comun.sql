-- ============================================================================
-- Empresas B8 — código común por pack y un uso por experiencia.
-- ----------------------------------------------------------------------------
-- Condición comercial vigente (31/10/2026): un pack corporativo tiene UN código
-- común, compartido por sus tarjetas físicas. Cada tarjeta es una experiencia
-- y el cupo total son las experiencias compradas.
--
-- Hasta acá no había una configuración correcta:
--   · «Generar» crea cantidad_contratada códigos de usos_por_codigo usos. Con
--     1 código × 10 usos el cupo era correcto, pero pantallas, informe y CRM
--     decían «1 turno contratado». Con 10 × 10, el cupo se multiplicaba.
--   · Un canje sumaba UN uso aunque reservara hasta 4 simuladores. La web
--     pública manda uno, pero la API aceptaba más: una reserva de 4 daba
--     4 experiencias por un solo uso.
--
-- Cambios:
--   1. empresa_campanias.codigo_comun (boolean, falso por defecto). Con la
--      marca, la aplicación genera UN código con usos_maximos =
--      cantidad_contratada. Sin ella, todo sigue como antes. Las campañas
--      existentes quedan en falso: no cambian.
--   2. Un canje = un simulador = una experiencia: crear_reserva_empresa
--      (legacy) y crear_reserva_empresa_v2 exigen exactamente un simulador.
--   3. Reprogramar no cambia la cantidad de simuladores de la reserva
--      (reprogramar_reserva_empresa y reprogramar_reserva_empresa_v2). Una
--      reserva anterior de varios simuladores se puede mover con los mismos.
--
-- El resto de cada función es idéntico a su definición vigente: mismas firmas,
-- owner, SECURITY DEFINER, search_path y permisos. Las crear_* vienen de
-- db/empresas-b7-1-fecha.sql y las reprogramar_* de db/empresas-b7-modalidad.sql.
--
-- Definiciones previas (para volver atrás a mano): db/empresas-b8-codigo-comun.previo.sql
-- Verificación: db/empresas-b8-codigo-comun.verificacion.sql
-- Idempotente: se puede aplicar de nuevo sin efectos.
-- ============================================================================

alter table public.empresa_campanias add column if not exists codigo_comun boolean not null default false;
comment on column public.empresa_campanias.codigo_comun is
  'B8: un solo código para todas las tarjetas del pack, con usos_maximos = cantidad_contratada (cupo en experiencias). Falso = un código por experiencia (como antes).';

-- ── 2. Canje: exactamente un simulador ───────────────────────────────────────

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
     OR coalesce(array_length(p_simuladores, 1), 0) <> 1
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
  if v_n <> 1
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

-- ── 3. Reprogramar: la misma cantidad de simuladores ─────────────────────────

create or replace function public.reprogramar_reserva_empresa_v2(p_reserva_id bigint, p_fecha date, p_hora text, p_simuladores text[])
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_buffer constant integer := 10;
  v_res public.reservas%rowtype;
  v_sim text;
  v_n integer;
begin
  select * into v_res from public.reservas where id = p_reserva_id and origen = 'empresa' for update;
  if not found or v_res.estado <> 'activa' then return false; end if;
  if v_res.modalidad is distinct from 'v2_10' then return false; end if;

  v_n := coalesce(array_length(p_simuladores, 1), 0);
  if v_n < 1 or v_n <> v_res.cantidad_turnos
     or v_n <> (select count(distinct s) from unnest(p_simuladores) s)
     or exists (select 1 from unnest(p_simuladores) s where s not in ('Ferrari','McLaren','Red Bull','Alpine'))
     or not public.reserva_horario_valido_v2(p_fecha, p_hora, v_res.duracion_minutos) then
    return false;
  end if;

  update public.reserva_slots set estado = 'cancelada' where reserva_id = p_reserva_id and estado = 'activa';
  foreach v_sim in array p_simuladores loop
    insert into public.reserva_slots (reserva_id, fecha, hora, simulador, estado, ocupacion_min)
    values (p_reserva_id, p_fecha, p_hora, v_sim, 'activa', v_res.duracion_minutos + c_buffer);
  end loop;
  update public.reservas
     set fecha = p_fecha, hora = p_hora, simuladores = to_jsonb(p_simuladores), cantidad_turnos = v_n
   where id = p_reserva_id;
  return true;
exception when unique_violation or check_violation then
  return false;
end;
$function$;

revoke all on function public.reprogramar_reserva_empresa_v2(bigint, date, text, text[]) from public, anon, authenticated;
grant execute on function public.reprogramar_reserva_empresa_v2(bigint, date, text, text[]) to service_role;

CREATE OR REPLACE FUNCTION public.reprogramar_reserva_empresa(p_reserva_id bigint, p_fecha date, p_hora text, p_simuladores text[], p_slots text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_res public.reservas%ROWTYPE; v_slot text; v_sim text;
BEGIN
  SELECT * INTO v_res FROM public.reservas WHERE id = p_reserva_id AND origen = 'empresa' FOR UPDATE;
  IF NOT FOUND OR v_res.estado <> 'activa' THEN RETURN false; END IF;
  IF coalesce(v_res.modalidad, 'legacy') <> 'legacy' THEN RETURN false; END IF;
  IF coalesce(array_length(p_simuladores, 1), 0) <> v_res.cantidad_turnos THEN RETURN false; END IF;
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
  RETURN false;
END;
$function$;

revoke all on function public.reprogramar_reserva_empresa(bigint, date, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.reprogramar_reserva_empresa(bigint, date, text, text[], text[]) to service_role;

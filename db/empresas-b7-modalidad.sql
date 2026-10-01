-- ============================================================================
-- Empresas B7 — modalidad comercial persistida por campaña y agenda 10/20/30.
-- ----------------------------------------------------------------------------
-- ADITIVA y retrocompatible. Sin backfill: la campaña histórica y cualquier
-- fila existente quedan con modalidad_comercial NULL = legacy.
--
--   1. empresa_campanias.modalidad_comercial. Se llama así porque
--      empresa_campanias.modalidad YA existe y significa otra cosa (compra
--      'unica' o pack 'mensual'). La fija el servidor al CREAR la campaña
--      (modalidadVigente(), una vez) y nunca se recalcula: editar una campaña
--      no la cambia. Los códigos la heredan de su campaña.
--   2. RPC v2 EN PARALELO (las legacy NO se borran):
--      crear_reserva_empresa_v2 y reprogramar_reserva_empresa_v2. Grilla de 10,
--      10/20/30, UNA fila de reserva_slots por simulador con
--      ocupacion_min = duración + 10. Total 0, mismo canje atómico.
--   3. crear_reserva_empresa y reprogramar_reserva_empresa (legacy) se
--      reemplazan con CREATE OR REPLACE (misma firma) SOLO para negarse a operar
--      sobre una campaña/reserva v2 y para guardar reservas.modalidad = 'legacy'.
--   4. cancelar_reserva_empresa no cambia: ya libera TODOS los slots de la
--      reserva (en v2, la fila con su buffer).
--
-- Definiciones previas: db/empresas-b7-modalidad.previo.sql
-- ============================================================================

alter table public.empresa_campanias add column if not exists modalidad_comercial text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'empresa_campanias_modalidad_comercial_chk') then
    alter table public.empresa_campanias add constraint empresa_campanias_modalidad_comercial_chk
      check (modalidad_comercial is null or modalidad_comercial in ('legacy', 'v2_10'));
  end if;
end $$;
comment on column public.empresa_campanias.modalidad_comercial is
  '(B7) Modalidad comercial con la que se creó la campaña. NULL = histórica = legacy. No confundir con modalidad (unica/mensual).';

-- Horario v2 de una reserva (misma regla aprobada que Reservas y Mensualidades):
-- paso de 10 desde las 10:00; de lunes a viernes el tiempo COMERCIAL termina a
-- las 22:00 como máximo; sábado y domingo último inicio 14:00.
create or replace function public.reserva_horario_valido_v2(p_fecha date, p_hora text, p_duracion integer)
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

revoke all on function public.reserva_horario_valido_v2(date, text, integer) from public, anon, authenticated;
grant execute on function public.reserva_horario_valido_v2(date, text, integer) to service_role;

-- ── Canje v2 ────────────────────────────────────────────────────────────────
--   · Reintento con la misma clave de idempotencia: devuelve la reserva ya creada.
--   · El código se toma FOR UPDATE: dos canjes simultáneos del mismo código se
--     serializan ahí y el segundo ve el uso del primero.
--   · Solo campañas v2 (modalidad_comercial = 'v2_10'); la duración es la de la campaña.
--   · UNA fila de reserva_slots por simulador: [hora, hora + duración + 10). El
--     trigger B1 controla bloqueos y solapamientos con legacy y v2; cualquier
--     rechazo (unique/check) deshace todo y la función no devuelve filas.
create or replace function public.crear_reserva_empresa_v2(
  p_codigo text, p_nombre text, p_apellido text, p_telefono text, p_email text,
  p_fecha date, p_hora text, p_duracion integer, p_simuladores text[], p_idempotency_key text)
returns table(reserva_id bigint, codigo_id uuid, campania_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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
     or v_camp.fecha_inicio is null or v_camp.fecha_inicio > current_date
     or v_camp.fecha_vencimiento is null or v_camp.fecha_vencimiento < current_date
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

-- ── Reprogramación v2 (admin) ───────────────────────────────────────────────
--   · Solo reservas v2: conservan su modalidad al moverse. No consume otro uso.
--   · Primero se cancelan los slots activos (el trigger solo mira los activos) y
--     después se insertan los nuevos; un rechazo deshace todo y devuelve false.
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
  if v_n < 1 or v_n > 4
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

-- ── Legacy: misma firma, dos guardas ────────────────────────────────────────
--   · crear_reserva_empresa: una campaña v2 no canjea con la grilla legacy
--     (NULL = legacy) y la reserva se guarda con modalidad = 'legacy'.
--   · reprogramar_reserva_empresa: una reserva v2 no se mueve con la grilla
--     legacy (NULL = legacy).
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

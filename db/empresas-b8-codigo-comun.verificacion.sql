-- ============================================================================
-- Verificación de B8 (código común y un uso por experiencia), SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Mismo esquema que db/empresas-b7-1-fecha.verificacion.sql:
--   · todo corre dentro de un sub-bloque que termina en RAISE, así que se
--     deshace entero;
--   · reservas y reserva_slots quedan bloqueadas en SHARE ROW EXCLUSIVE;
--   · las secuencias se restauran con setval.
-- El resultado sale en el mensaje final («RESULTADO B8|...»); «FALLA:» marca
-- lo que no se cumplió. Los fixtures son sintéticos (EMP-TB8-*), en una fecha
-- sin ocupación real, y no se toca ninguna campaña real.
--   T1  columna codigo_comun: boolean, not null, falso por defecto.
--   T2  v2, código común de 3 usos: 2 simuladores o ninguno → no canjea ni
--       consume; 3 canjes de un simulador → 3 usos y «utilizado»; el 4.º no.
--   T3  legacy: 2 simuladores o ninguno → no canjea ni consume; 1 → canjea.
--   T4  reprogramar v2 con otra cantidad → no; con la misma → sí, sin otro uso.
--   T5  reprogramar legacy con otra cantidad → no; con la misma → sí.
--   T6  una reserva anterior de 2 simuladores se mueve con 2 y no con 1.
--   T7  la idempotencia sigue devolviendo la reserva ya creada, sin otro uso.
-- ============================================================================
do $b8$
declare
  v_seq_res  regclass := pg_get_serial_sequence('public.reservas', 'id')::regclass;
  v_seq_slot regclass := pg_get_serial_sequence('public.reserva_slots', 'id')::regclass;
  v_res_last bigint; v_res_called boolean; v_slot_last bigint; v_slot_called boolean;
  v_resultado text;
  v_log text := '';
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_habil date;
  v_n int;
  v_ok boolean;
  v_camp uuid;
  v_cod_id uuid;
  v_res_v2 bigint;
  v_res_leg bigint;
  v_res_vieja bigint;
  v_usos int;
  v_estado text;
begin
  lock table public.reservas, public.reserva_slots in share row exclusive mode;
  execute format('select last_value, is_called from %s', v_seq_res) into v_res_last, v_res_called;
  execute format('select last_value, is_called from %s', v_seq_slot) into v_slot_last, v_slot_called;

  begin
    -- T1 · la columna.
    select count(*) into v_n from information_schema.columns
     where table_schema = 'public' and table_name = 'empresa_campanias' and column_name = 'codigo_comun'
       and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false';
    v_log := v_log || case when v_n = 1 then 'T1 ' else 'FALLA:T1 ' end;

    select min(x)::date into v_habil from generate_series(v_hoy + 30, v_hoy + 90, interval '1 day') x
     where extract(isodow from x) between 1 and 5
       and not exists (select 1 from public.reservas r where r.fecha = x::date::text)
       and not exists (select 1 from public.reserva_slots s where s.fecha = x::date::text)
       and not exists (select 1 from public.bloqueos_reservas b where b.fecha = x::date);

    -- T2 · v2, código común de 3 usos (20 minutos).
    v_camp := gen_random_uuid();
    insert into public.empresa_campanias (id, empresa, modalidad, modalidad_comercial, cantidad_contratada, duracion_minutos,
      usos_por_codigo, precio_neto, iva_porcentaje, estado, estado_pago, fecha_pago, fecha_inicio, fecha_vencimiento, codigos_generados, codigo_comun)
    values (v_camp, 'B8 VERIF común v2 (sintética)', 'unica', 'v2_10', 3, 20, 1, 0, 21, 'activa', 'pagado', v_hoy, v_hoy, v_hoy + 60, true, true);
    insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales)
    values (v_camp, 'EMP-TB8-COMUN', 'disponible', 3, 0) returning id into v_cod_id;

    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Ferrari', 'McLaren'], 'b8-verif-dos');
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_id;
    v_log := v_log || case when v_n = 0 and v_usos = 0 then 'T2a ' else 'FALLA:T2a(' || v_n || ',' || v_usos || ') ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array[]::text[], 'b8-verif-cero');
    v_log := v_log || case when v_n = 0 then 'T2b ' else 'FALLA:T2b ' end;

    select r.reserva_id into v_res_v2 from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Ferrari'], 'b8-verif-1') r;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['McLaren'], 'b8-verif-2');
    v_ok := v_n = 1;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Red Bull'], 'b8-verif-3');
    v_ok := v_ok and v_n = 1 and v_res_v2 is not null;
    select usos_actuales, estado into v_usos, v_estado from public.empresa_codigos where id = v_cod_id;
    v_log := v_log || case when v_ok and v_usos = 3 and v_estado = 'utilizado' then 'T2c ' else 'FALLA:T2c(' || v_usos || ',' || v_estado || ') ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Alpine'], 'b8-verif-4');
    v_log := v_log || case when v_n = 0 then 'T2d ' else 'FALLA:T2d ' end;

    -- T3 · legacy, un código de 2 usos (15 minutos, bloques de 20).
    v_camp := gen_random_uuid();
    insert into public.empresa_campanias (id, empresa, modalidad, modalidad_comercial, cantidad_contratada, duracion_minutos,
      usos_por_codigo, precio_neto, iva_porcentaje, estado, estado_pago, fecha_pago, fecha_inicio, fecha_vencimiento, codigos_generados)
    values (v_camp, 'B8 VERIF legacy (sintética)', 'unica', null, 2, 15, 2, 0, 21, 'activa', 'pagado', v_hoy, v_hoy, v_hoy + 60, true);
    insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales)
    values (v_camp, 'EMP-TB8-LEG', 'disponible', 2, 0) returning id into v_cod_id;
    select count(*) into v_n from public.crear_reserva_empresa('EMP-TB8-LEG', 'B8', 'Verif', '0000000082', null,
      v_habil, '10:00', 15, array['Ferrari', 'McLaren'], array['10:00'], 'b8-verif-l-dos');
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_id;
    v_log := v_log || case when v_n = 0 and v_usos = 0 then 'T3a ' else 'FALLA:T3a(' || v_n || ',' || v_usos || ') ' end;
    select count(*) into v_n from public.crear_reserva_empresa('EMP-TB8-LEG', 'B8', 'Verif', '0000000082', null,
      v_habil, '10:00', 15, array[]::text[], array['10:00'], 'b8-verif-l-cero');
    v_log := v_log || case when v_n = 0 then 'T3b ' else 'FALLA:T3b ' end;
    select r.reserva_id into v_res_leg from public.crear_reserva_empresa('EMP-TB8-LEG', 'B8', 'Verif', '0000000082', null,
      v_habil, '10:00', 15, array['Ferrari'], array['10:00'], 'b8-verif-l-1') r;
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_id;
    v_log := v_log || case when v_res_leg is not null and v_usos = 1 then 'T3c ' else 'FALLA:T3c ' end;

    -- T4 · reprogramar v2.
    v_ok := public.reprogramar_reserva_empresa_v2(v_res_v2, v_habil, '16:10', array['Ferrari', 'McLaren']);
    v_log := v_log || case when not v_ok then 'T4a ' else 'FALLA:T4a ' end;
    v_ok := public.reprogramar_reserva_empresa_v2(v_res_v2, v_habil, '16:10', array['Alpine']);
    select c.usos_actuales into v_usos from public.empresa_codigos c where c.codigo = 'EMP-TB8-COMUN';
    select count(*) into v_n from public.reservas where id = v_res_v2 and hora = '16:10' and cantidad_turnos = 1;
    v_log := v_log || case when v_ok and v_n = 1 and v_usos = 3 then 'T4b ' else 'FALLA:T4b ' end;

    -- T5 · reprogramar legacy.
    v_ok := public.reprogramar_reserva_empresa(v_res_leg, v_habil, '11:00', array['Ferrari', 'McLaren'], array['11:00']);
    v_log := v_log || case when not v_ok then 'T5a ' else 'FALLA:T5a ' end;
    v_ok := public.reprogramar_reserva_empresa(v_res_leg, v_habil, '11:00', array['McLaren'], array['11:00']);
    v_log := v_log || case when v_ok then 'T5b ' else 'FALLA:T5b ' end;

    -- T6 · reserva anterior de 2 simuladores (como las que la API permitía antes).
    insert into public.reservas (nombre, apellido, telefono, email, fecha, hora, simuladores, cantidad_turnos,
      total, total_original, descuento_aplicado, estado, acepto_condiciones, duracion_minutos, origen, modalidad)
    values ('B8', 'Verif', '0000000083', null, v_habil, '18:10', to_jsonb(array['Ferrari', 'McLaren']), 2,
      0, 0, 0, 'activa', true, 20, 'empresa', 'v2_10') returning id into v_res_vieja;
    v_ok := public.reprogramar_reserva_empresa_v2(v_res_vieja, v_habil, '19:10', array['Ferrari']);
    v_log := v_log || case when not v_ok then 'T6a ' else 'FALLA:T6a ' end;
    v_ok := public.reprogramar_reserva_empresa_v2(v_res_vieja, v_habil, '19:10', array['Red Bull', 'Alpine']);
    v_log := v_log || case when v_ok then 'T6b ' else 'FALLA:T6b ' end;

    -- T7 · idempotencia: la misma clave devuelve la misma reserva y no consume.
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Ferrari'], 'b8-verif-1') r where r.reserva_id = v_res_v2;
    select usos_actuales into v_usos from public.empresa_codigos where codigo = 'EMP-TB8-COMUN';
    v_log := v_log || case when v_n = 1 and v_usos = 3 then 'T7 ' else 'FALLA:T7 ' end;

    raise exception 'B8|% habil=%', v_log, v_habil;
  exception when others then
    v_resultado := sqlerrm || case when sqlerrm like 'B8|%' then '' else ' || log: ' || v_log end;
  end;

  perform setval(v_seq_res, v_res_last, v_res_called);
  perform setval(v_seq_slot, v_slot_last, v_slot_called);
  raise exception 'RESULTADO %', v_resultado;
end $b8$;

-- ============================================================================
-- Verificación de B8 (código común; cupo en experiencias), SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Mismo esquema que db/empresas-b7-1-fecha.verificacion.sql:
--   · todo corre dentro de un sub-bloque que termina en RAISE, así que se
--     deshace entero;
--   · reservas y reserva_slots quedan bloqueadas en SHARE ROW EXCLUSIVE;
--   · las secuencias se restauran con setval.
-- El resultado sale en el mensaje final («RESULTADO B8|...»); «FALLA:» marca
-- lo que no se cumplió. Los fixtures son sintéticos (EMP-TB8-*), en una fecha
-- sin ocupación real, y no se toca ninguna campaña real.
--   T1  columnas codigo_comun (falso por defecto) y experiencias (1 a 4, por
--       defecto 1).
--   T2  v2, código de 3 usos: 2 simuladores → 2 usos (experiencias 2); otros
--       2 con 1 libre → no; ninguno → no; 1 → completa; el siguiente → no.
--   T3  legacy, código de 2 usos: 2 simuladores → 2 usos; 1 más → no; un
--       canje sin simulador → no.
--   T4  idempotencia: la misma clave devuelve la reserva ya creada, sin consumir.
--   T5  reprogramar v2 y legacy con otra cantidad → no; con la misma → sí, sin
--       consumir.
--   T6  cancelar con «liberar» devuelve las 2 experiencias de esa reserva, una
--       sola vez: el reintento no vuelve a devolver. Cancelar sin «liberar» no
--       devuelve, y un reintento con «liberar» tampoco.
--   T7  el CHECK usos_actuales <= usos_maximos rechaza pasar el cupo, aun
--       escribiendo directo.
--   T8  las cinco funciones: SECURITY DEFINER, search_path = public, EXECUTE
--       solo para service_role (ni PUBLIC, ni anon, ni authenticated).
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
  v_cod_v2 uuid;
  v_cod_leg uuid;
  v_res_dos bigint;
  v_res_uno bigint;
  v_res_leg bigint;
  v_usos int;
  v_estado text;
  v_exp int;
begin
  lock table public.reservas, public.reserva_slots in share row exclusive mode;
  execute format('select last_value, is_called from %s', v_seq_res) into v_res_last, v_res_called;
  execute format('select last_value, is_called from %s', v_seq_slot) into v_slot_last, v_slot_called;

  begin
    -- T1 · columnas.
    select count(*) into v_n from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'empresa_campanias' and column_name = 'codigo_comun' and data_type = 'boolean' and column_default = 'false')
         or (table_name = 'empresa_codigo_usos' and column_name = 'experiencias' and data_type = 'integer' and column_default = '1'))
       and is_nullable = 'NO';
    select count(*) + v_n into v_n from pg_constraint where conname = 'empresa_codigo_usos_experiencias_check';
    v_log := v_log || case when v_n = 3 then 'T1 ' else 'FALLA:T1(' || v_n || ') ' end;

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
    values (v_camp, 'EMP-TB8-COMUN', 'disponible', 3, 0) returning id into v_cod_v2;

    select r.reserva_id into v_res_dos from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Ferrari', 'McLaren'], 'b8-verif-dos') r;
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_v2;
    select experiencias into v_exp from public.empresa_codigo_usos where reserva_id = v_res_dos;
    select cantidad_turnos into v_n from public.reservas where id = v_res_dos;
    v_log := v_log || case when v_res_dos is not null and v_usos = 2 and v_exp = 2 and v_n = 2 then 'T2a ' else 'FALLA:T2a(' || coalesce(v_usos, -1) || ',' || coalesce(v_exp, -1) || ') ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '15:10', 20, array['Ferrari', 'McLaren'], 'b8-verif-dos-sin-cupo');
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_v2;
    v_log := v_log || case when v_n = 0 and v_usos = 2 then 'T2b ' else 'FALLA:T2b(' || v_n || ',' || v_usos || ') ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '15:10', 20, array[]::text[], 'b8-verif-cero');
    v_log := v_log || case when v_n = 0 then 'T2c ' else 'FALLA:T2c ' end;
    select r.reserva_id into v_res_uno from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Red Bull'], 'b8-verif-uno') r;
    select usos_actuales, estado into v_usos, v_estado from public.empresa_codigos where id = v_cod_v2;
    v_log := v_log || case when v_res_uno is not null and v_usos = 3 and v_estado = 'utilizado' then 'T2d ' else 'FALLA:T2d(' || v_usos || ',' || v_estado || ') ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Alpine'], 'b8-verif-agotado');
    v_log := v_log || case when v_n = 0 then 'T2e ' else 'FALLA:T2e ' end;

    -- T3 · legacy, código de 2 usos (15 minutos, bloques de 20).
    v_camp := gen_random_uuid();
    insert into public.empresa_campanias (id, empresa, modalidad, modalidad_comercial, cantidad_contratada, duracion_minutos,
      usos_por_codigo, precio_neto, iva_porcentaje, estado, estado_pago, fecha_pago, fecha_inicio, fecha_vencimiento, codigos_generados)
    values (v_camp, 'B8 VERIF legacy (sintética)', 'unica', null, 2, 15, 2, 0, 21, 'activa', 'pagado', v_hoy, v_hoy, v_hoy + 60, true);
    insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales)
    values (v_camp, 'EMP-TB8-LEG', 'disponible', 2, 0) returning id into v_cod_leg;
    insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales)
    values (v_camp, 'EMP-TB8-LEG-VACIO', 'disponible', 1, 0);
    select r.reserva_id into v_res_leg from public.crear_reserva_empresa('EMP-TB8-LEG', 'B8', 'Verif', '0000000082', null,
      v_habil, '10:00', 15, array['Ferrari', 'McLaren'], array['10:00'], 'b8-verif-l-dos') r;
    select usos_actuales, estado into v_usos, v_estado from public.empresa_codigos where id = v_cod_leg;
    select experiencias into v_exp from public.empresa_codigo_usos where reserva_id = v_res_leg;
    v_log := v_log || case when v_res_leg is not null and v_usos = 2 and v_exp = 2 and v_estado = 'utilizado' then 'T3a ' else 'FALLA:T3a ' end;
    select count(*) into v_n from public.crear_reserva_empresa('EMP-TB8-LEG', 'B8', 'Verif', '0000000082', null,
      v_habil, '11:00', 15, array['Ferrari'], array['11:00'], 'b8-verif-l-mas');
    v_log := v_log || case when v_n = 0 then 'T3b ' else 'FALLA:T3b ' end;
    select count(*) into v_n from public.crear_reserva_empresa('EMP-TB8-LEG-VACIO', 'B8', 'Verif', '0000000082', null,
      v_habil, '11:00', 15, array[]::text[], array['11:00'], 'b8-verif-l-cero');
    select usos_actuales into v_usos from public.empresa_codigos where codigo = 'EMP-TB8-LEG-VACIO';
    v_log := v_log || case when v_n = 0 and v_usos = 0 then 'T3c ' else 'FALLA:T3c ' end;

    -- T4 · idempotencia: la misma clave devuelve la reserva y no consume.
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '14:10', 20, array['Ferrari', 'McLaren'], 'b8-verif-dos') r where r.reserva_id = v_res_dos;
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_v2;
    select count(*) into v_exp from public.empresa_codigo_usos where codigo_id = v_cod_v2;
    v_log := v_log || case when v_n = 1 and v_usos = 3 and v_exp = 2 then 'T4 ' else 'FALLA:T4 ' end;

    -- T5 · reprogramar: la misma cantidad de simuladores, sin consumir.
    v_ok := public.reprogramar_reserva_empresa_v2(v_res_dos, v_habil, '16:10', array['Alpine']);
    v_log := v_log || case when not v_ok then 'T5a ' else 'FALLA:T5a ' end;
    v_ok := public.reprogramar_reserva_empresa_v2(v_res_dos, v_habil, '16:10', array['Alpine', 'Red Bull']);
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_v2;
    select count(*) into v_n from public.reservas where id = v_res_dos and hora = '16:10' and cantidad_turnos = 2;
    v_log := v_log || case when v_ok and v_n = 1 and v_usos = 3 then 'T5b ' else 'FALLA:T5b ' end;
    v_ok := public.reprogramar_reserva_empresa(v_res_leg, v_habil, '12:00', array['McLaren'], array['12:00']);
    v_log := v_log || case when not v_ok then 'T5c ' else 'FALLA:T5c ' end;
    v_ok := public.reprogramar_reserva_empresa(v_res_leg, v_habil, '12:00', array['McLaren', 'Ferrari'], array['12:00']);
    v_log := v_log || case when v_ok then 'T5d ' else 'FALLA:T5d ' end;

    -- T6 · cancelar: devuelve lo consumido por ESA reserva, una sola vez.
    v_ok := public.cancelar_reserva_empresa(v_res_dos, true);
    select usos_actuales, estado into v_usos, v_estado from public.empresa_codigos where id = v_cod_v2;
    select count(*) into v_n from public.empresa_codigo_usos where reserva_id = v_res_dos and estado = 'cancelado';
    v_log := v_log || case when v_ok and v_usos = 1 and v_estado = 'disponible' and v_n = 1 then 'T6a ' else 'FALLA:T6a(' || v_usos || ',' || v_estado || ') ' end;
    v_ok := public.cancelar_reserva_empresa(v_res_dos, true);
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_v2;
    v_log := v_log || case when v_ok and v_usos = 1 then 'T6b ' else 'FALLA:T6b(' || v_usos || ') ' end;
    v_ok := public.cancelar_reserva_empresa(v_res_uno, false);
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_v2;
    v_log := v_log || case when v_ok and v_usos = 1 then 'T6c ' else 'FALLA:T6c(' || v_usos || ') ' end;
    v_ok := public.cancelar_reserva_empresa(v_res_uno, true);
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_v2;
    select count(*) into v_n from public.empresa_codigo_usos where reserva_id = v_res_uno and estado = 'consumido';
    v_log := v_log || case when v_ok and v_usos = 1 and v_n = 1 then 'T6d ' else 'FALLA:T6d(' || v_usos || ') ' end;
    -- Lo devuelto se vuelve a poder usar, y el cupo sigue en 3.
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB8-COMUN', 'B8', 'Verif', '0000000081', null,
      v_habil, '17:10', 20, array['Ferrari', 'McLaren'], 'b8-verif-vuelve') r;
    select usos_actuales into v_usos from public.empresa_codigos where id = v_cod_v2;
    v_log := v_log || case when v_n = 1 and v_usos = 3 then 'T6e ' else 'FALLA:T6e(' || v_usos || ') ' end;

    -- T7 · el CHECK es la segunda barrera.
    begin
      update public.empresa_codigos set usos_actuales = usos_maximos + 1 where id = v_cod_v2;
      v_log := v_log || 'FALLA:T7 ';
    exception when check_violation then
      v_log := v_log || 'T7 ';
    end;

    -- T8 · permisos y atributos de las funciones modificadas.
    select count(*) into v_n from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('crear_reserva_empresa', 'crear_reserva_empresa_v2', 'reprogramar_reserva_empresa',
                         'reprogramar_reserva_empresa_v2', 'cancelar_reserva_empresa')
       and p.prosecdef
       and coalesce(p.proconfig, '{}') @> array['search_path=public']
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE');
    v_log := v_log || case when v_n = 5 then 'T8 ' else 'FALLA:T8(' || v_n || ') ' end;

    raise exception 'B8|% habil=%', v_log, v_habil;
  exception when others then
    v_resultado := sqlerrm || case when sqlerrm like 'B8|%' then '' else ' || log: ' || v_log end;
  end;

  perform setval(v_seq_res, v_res_last, v_res_called);
  perform setval(v_seq_slot, v_slot_last, v_slot_called);
  raise exception 'RESULTADO %', v_resultado;
end $b8$;

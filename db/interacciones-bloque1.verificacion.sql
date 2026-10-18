-- ============================================================================
-- Verificación de Interacciones · Bloque 1, SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: se deshace entero.
-- Fixtures: turnos_stand con id NEGATIVO explícito (identity BY DEFAULT: no
-- consume la secuencia), un empleado y las interacciones de prueba, todos con
-- uuid o id fijo. Los turnos llevan nombre/teléfono "SECRETO" para comprobar que
-- nada de eso llega al módulo.
-- Resultado en el mensaje final: "RESULTADO INTERACCIONES-B1|T0 T1 ...";
-- "FALLA:" marca lo que no se cumplió; "ABORTO:" un error inesperado.
--
-- Pensada para el stack LOCAL (npm run pruebas:esquema y luego
-- node scripts/pruebas/interacciones-bloque1.mjs). La concurrencia real (dos
-- conexiones a la vez) la prueba ese script: acá todo es una sola transacción.
-- ============================================================================
do $ib1$
declare
  v_log       text := '';
  v_resultado text;
  v_hoy       date;
  v_ayer0     timestamptz;
  v_emp       uuid;
  v_j         jsonb;
  v_x         uuid;
  v_y         uuid;
  v_z         uuid;
  v_p         uuid;
  v_g         uuid;
  v_w         uuid;
  v_m4        uuid;
  v_q         uuid;
  v_vieja     uuid;
  v_k         uuid;
  v_n         integer;
  v_n2        integer;
  v_v         integer;
  v_e         text;
  v_e2        text;
  v_h0        text;
  v_h1        text;
  v_ok        boolean;
  v_antes     integer;
  v_d1        uuid;
  v_d2        uuid;
  v_d3        uuid;
  v_d4        uuid;
  v_d5        uuid;
  v_d6        uuid;
  v_key       uuid;
  v_inicio    timestamptz;
  v_pausa     timestamptz;
  v_ht        text;
begin
  begin
    -- ── Utilidades temporales (se van con el ROLLBACK) ─────────────────────
    create function pg_temp.intentar(p_sql text) returns text language plpgsql as $f$
    begin
      execute p_sql;
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.t_alta(p_datos jsonb, p_turnos bigint[], p_rol text, p_key uuid default null)
    returns text language plpgsql as $f$
    declare v jsonb;
    begin
      v := public.interaccion_registrar(coalesce(p_key, gen_random_uuid()), p_datos, p_turnos, p_rol);
      return 'ok:' || (v -> 'interaccion' ->> 'id');
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.t_editar(p_id uuid, p_v integer, p_c jsonb, p_rol text) returns text language plpgsql as $f$
    begin
      perform public.interaccion_editar(p_id, p_v, p_c, p_rol);
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.t_vincular(p_id uuid, p_v integer, p_t bigint[], p_rol text) returns text language plpgsql as $f$
    begin
      perform public.interaccion_vincular(p_id, p_v, p_t, p_rol);
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.t_desvincular(p_id uuid, p_v integer, p_t bigint, p_rol text) returns text language plpgsql as $f$
    begin
      perform public.interaccion_desvincular(p_id, p_v, p_t, p_rol);
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.t_anular(p_id uuid, p_v integer, p_m text, p_rol text) returns text language plpgsql as $f$
    begin
      perform public.interaccion_anular(p_id, p_v, p_m, p_rol);
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.t_cerrar(p_id uuid, p_v integer, p_m text, p_nota text, p_rol text) returns text language plpgsql as $f$
    begin
      perform public.interaccion_cerrar_sin_vinculo(p_id, p_v, p_m, p_nota, p_rol);
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.t_eliminar(p_id uuid, p_v integer, p_m text, p_rol text) returns text language plpgsql as $f$
    begin
      perform public.interaccion_eliminar(p_id, p_v, p_m, p_rol);
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.ver(p_id uuid) returns integer language sql as $f$
      select version from public.interacciones_stand where id = p_id
    $f$;

    create function pg_temp.est(p_id uuid) returns text language sql as $f$
      select vinculo_estado from public.interacciones_stand_estado where interaccion_id = p_id
    $f$;

    create function pg_temp.nvinc(p_id uuid) returns integer language sql as $f$
      select count(*)::integer from public.interaccion_turnos where interaccion_id = p_id
    $f$;

    -- Huella de los datos que este módulo NO debe tocar.
    create function pg_temp.huella() returns text language plpgsql as $f$
    declare v_t text; v_acc text := ''; v_h text;
    begin
      for v_t in
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
           and (c.relname in ('turnos_stand', 'turnos_historicos', 'reservas', 'reserva_operacion', 'reserva_slots',
                              'empleados', 'gift_cards', 'colectivo_ventas', 'colectivo_turnos')
                or c.relname like 'fin\_%' or c.relname like 'mensualidad%')
         order by c.relname
      loop
        execute format('select coalesce(md5(string_agg(md5(t::text), '''' order by md5(t::text))), ''vacia'') from public.%I t', v_t)
          into v_h;
        v_acc := v_acc || v_t || '=' || v_h || ';';
      end loop;
      return md5(v_acc);
    end $f$;

    -- ── Fixtures ──────────────────────────────────────────────────────────
    update public.interacciones_config set inicio_registro = null, altas_pausadas_en = null, actualizado_por_rol = null where id;
    v_hoy := public.interacciones_fecha_sim(now());
    v_ayer0 := ((v_hoy - 1)::timestamp at time zone 'America/Argentina/Cordoba');

    insert into public.turnos_stand
      (id, nombre, telefono, fecha, hora, cantidad_personas, cantidad_minutos, cantidad_turnos, total, metodo_pago, estado, modalidad)
    select g, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '12:00', 2, 20, 4, 34000, 'qr', 'activo', 'v2_10'
      from generate_series(-910012, -910001) g;
    insert into public.turnos_stand
      (id, nombre, telefono, fecha, hora, cantidad_personas, cantidad_minutos, cantidad_turnos, total, metodo_pago, estado, modalidad)
    values
      (-910013, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy - 1, '20:00', 1, 10, 1, 10000, 'efectivo', 'activo', 'v2_10'),
      (-910014, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy - 2, '20:00', 1, 10, 1, 10000, 'efectivo', 'activo', 'v2_10'),
      (-910015, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '13:00', 2, 10, 2, 0, 'gratis', 'activo', 'v2_10'),
      (-910016, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '13:30', 1, 30, 3, 23000, 'debito', 'activo', 'v2_10'),
      (-910017, 'NOMBRE SECRETO B1', '000-SECRETO', public.interacciones_fecha_sim(now() - interval '49 hours'),
                '18:00', 1, 20, 2, 17000, 'qr', 'activo', 'v2_10'),
      (-910018, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '14:00', 1, 10, 1, 5000, 'gratis', 'activo', 'v2_10'),
      (-910019, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '14:10', 1, 10, 1, 0, 'qr', 'activo', 'v2_10'),
      (-910020, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '14:20', 2, 10, 2, 20000, 'qr', 'activo', 'v2_10'),
      (-910021, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '14:30', 2, 10, 2, 20000, 'qr', 'activo', 'v2_10'),
      (-910022, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '14:40', 2, 10, 2, 20000, 'qr', 'activo', 'v2_10'),
      (-910023, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '15:00', 2, 10, 2, 20000, 'qr', 'activo', 'v2_10'),
      (-910024, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '15:10', 2, 20, 4, 34000, 'qr', 'activo', 'v2_10'),
      (-910025, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '15:20', 2, 10, 2, 0, 'gratis', 'activo', 'v2_10'),
      (-910026, 'NOMBRE SECRETO B1', '000-SECRETO', v_hoy, '15:30', 1, 10, 1, 10000, 'efectivo', 'activo', 'v2_10');

    insert into public.empleados (nombre_formal) values ('__TEST_INTERACCIONES_B1') returning id into v_emp;

    v_h0 := pg_temp.huella();

    -- T0 · estructura y permisos mínimos.
    v_ok :=
          (select bool_and(c.relrowsecurity) from pg_class c
            where c.oid in ('public.interacciones_config'::regclass, 'public.interacciones_stand'::regclass,
                            'public.interaccion_turnos'::regclass, 'public.interacciones_stand_eventos'::regclass))
      and not exists (select 1 from pg_policies where schemaname = 'public'
                       and tablename in ('interacciones_config', 'interacciones_stand', 'interaccion_turnos', 'interacciones_stand_eventos'))
      and (select bool_and(not has_table_privilege(r, 'public.' || t, p))
             from unnest(array['anon', 'authenticated']) r,
                  unnest(array['interacciones_config', 'interacciones_stand', 'interaccion_turnos', 'interacciones_stand_eventos',
                               'interacciones_stand_estado', 'interacciones_vinculos_control', 'interacciones_cobertura_turnos']) t,
                  unnest(array['select', 'insert', 'update', 'delete']) p)
      and (select bool_and(has_table_privilege('service_role', 'public.' || t, 'select'))
             from unnest(array['interacciones_config', 'interacciones_stand', 'interaccion_turnos', 'interacciones_stand_eventos',
                               'interacciones_stand_estado', 'interacciones_vinculos_control', 'interacciones_cobertura_turnos']) t)
      and (select bool_and(not has_table_privilege('service_role', 'public.' || t, p))
             from unnest(array['interacciones_config', 'interacciones_stand', 'interaccion_turnos', 'interacciones_stand_eventos']) t,
                  unnest(array['insert', 'update', 'delete', 'truncate']) p)
      and (select bool_and(has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute')
                           and not has_function_privilege('authenticated', f, 'execute'))
             from unnest(array[
               'public.interacciones_limites()', 'public.interaccion_detalle(uuid)',
               'public.interaccion_registrar(uuid, jsonb, bigint[], text)', 'public.interaccion_editar(uuid, integer, jsonb, text)',
               'public.interaccion_vincular(uuid, integer, bigint[], text)', 'public.interaccion_desvincular(uuid, integer, bigint, text)',
               'public.interaccion_anular(uuid, integer, text, text)', 'public.interaccion_cerrar_sin_vinculo(uuid, integer, text, text, text)',
               'public.interacciones_definir_inicio(timestamp without time zone, text)',
               'public.interaccion_eliminar(uuid, integer, text, text)', 'public.interacciones_pausar_altas(text)',
               'public.interacciones_reanudar_altas(text)']) f)
      and (select bool_and(not has_function_privilege(r, f, 'execute'))
             from unnest(array['service_role', 'anon', 'authenticated']) r,
                  unnest(array['public.interaccion_normalizar(jsonb)', 'public.interacciones_insertar_vinculos(uuid, bigint[], text)',
                               'public.interacciones_exigir_ocurrida(text, timestamptz, timestamptz)']) f)
      and (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public'])
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('interaccion_registrar', 'interaccion_editar', 'interaccion_vincular', 'interaccion_desvincular',
                                'interaccion_anular', 'interaccion_cerrar_sin_vinculo', 'interacciones_definir_inicio',
                                'interaccion_eliminar', 'interacciones_pausar_altas', 'interacciones_reanudar_altas',
                                'interaccion_turnos_validar', 'interaccion_turnos_registrar_alta', 'interaccion_turnos_registrar_baja',
                                'interacciones_stand_proteger', 'interaccion_turnos_inmutable'))
      and exists (select 1 from pg_constraint where conrelid = 'public.interaccion_turnos'::regclass and contype = 'f'
                   and confrelid = 'public.turnos_stand'::regclass and confdeltype = 'c')
      and exists (select 1 from pg_constraint where conrelid = 'public.interaccion_turnos'::regclass and contype = 'f'
                   and confrelid = 'public.interacciones_stand'::regclass and confdeltype = 'r')
      and exists (select 1 from pg_constraint where conrelid = 'public.interacciones_stand'::regclass and contype = 'f'
                   and confrelid = 'public.empleados'::regclass and confdeltype = 'r')
      and exists (select 1 from pg_constraint where conname = 'interaccion_turnos_turno_key' and contype = 'u')
      and exists (select 1 from pg_constraint where conname = 'interacciones_stand_idempotency_key' and contype = 'u')
      and (select bool_and(c.reloptions @> array['security_invoker=true']) from pg_class c
            where c.oid in ('public.interacciones_stand_estado'::regclass, 'public.interacciones_vinculos_control'::regclass,
                            'public.interacciones_cobertura_turnos'::regclass))
      and (public.interacciones_limites() ->> 'max_turnos_por_interaccion')::int = 4
      and (public.interacciones_limites() ->> 'zona') = 'America/Argentina/Cordoba';
    v_log := v_log || case when v_ok then 'T0 ' else 'FALLA:T0 ' end;

    -- T1 · sin inicio del registro no se puede registrar nada.
    v_e := pg_temp.t_alta('{"resultado":"miro","personas_grupo":1}', null, 'staff');
    v_log := v_log || case when v_e = '55000:registro_no_iniciado' then 'T1 ' else 'FALLA:T1(' || v_e || ') ' end;

    -- T2 · el inicio lo define solo admin, en hora de Córdoba.
    v_e := pg_temp.intentar(format('select public.interacciones_definir_inicio(%L::timestamp, ''staff'')',
                                   (now() at time zone 'America/Argentina/Cordoba') - interval '30 days'));
    perform public.interacciones_definir_inicio((now() at time zone 'America/Argentina/Cordoba') - interval '30 days', 'admin');
    v_log := v_log || case when v_e = '42501:solo_admin'
                             and (select inicio_registro from public.interacciones_config where id)
                                 = date_trunc('microseconds', now() - interval '30 days')
                           then 'T2 ' else 'FALLA:T2(' || v_e || ') ' end;

    -- T3 · alta idempotente: misma clave + mismo contenido (otro orden de claves,
    -- 3.0 en vez de 3, espacios en observaciones) → la fila original, sin duplicar.
    v_k := gen_random_uuid();
    v_j := public.interaccion_registrar(v_k,
      '{"resultado":"pregunto","personas_grupo":3,"hombres":2,"mujeres":1,"rango_etario":"18_24","conocia_sim":"no","se_subio_antes":"no_sabe","iniciador":"cliente","motivo":"precio","observaciones":"  caro  "}',
      null, 'staff');
    v_x := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_j := public.interaccion_registrar(v_k,
      '{"observaciones":"caro","motivo":"precio","iniciador":"cliente","se_subio_antes":"no_sabe","conocia_sim":"no","rango_etario":"18_24","mujeres":1,"hombres":2,"personas_grupo":3.0,"resultado":"pregunto"}',
      null, 'staff');
    select count(*) into v_n from public.interacciones_stand where idempotency_key = v_k;
    select count(*) into v_n2 from public.interacciones_stand_eventos where interaccion_id = v_x and tipo = 'alta';
    v_log := v_log || case when v_n = 1 and v_n2 = 1 and (v_j ->> 'repetida')::boolean
                              and (v_j -> 'interaccion' ->> 'id')::uuid = v_x
                              and (select observaciones from public.interacciones_stand where id = v_x) = 'caro'
                              and pg_temp.est(v_x) = 'no_aplica'
                           then 'T3 ' else 'FALLA:T3 ' end;

    -- T4 · misma clave con contenido distinto → conflicto; la fila no cambia.
    v_e := pg_temp.t_alta('{"resultado":"pregunto","personas_grupo":4}', null, 'staff', v_k);
    v_log := v_log || case when v_e = '23505:idempotency_key_con_otro_payload'
                              and (select personas_grupo from public.interacciones_stand where id = v_x) = 3
                              and (select count(*) from public.interacciones_stand where idempotency_key = v_k) = 1
                           then 'T4 ' else 'FALLA:T4(' || v_e || ') ' end;

    -- T5 · validaciones de perfil y resultado (ninguna escribe).
    select count(*) into v_antes from public.interacciones_stand;
    v_e := '';
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":3,"hombres":2,"mujeres":2}', null, 'staff') = '22023:desglose_no_suma' then '' else 'a' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":3,"hombres":2}', null, 'staff') = '22023:desglose_incompleto' then '' else 'b' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":0}', null, 'staff') = '22023:campo_invalido:personas_grupo' then '' else 'c0' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":51}', null, 'staff') = '22023:campo_invalido:personas_grupo' then '' else 'c51' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":2.5}', null, 'staff') = '22023:campo_invalido:personas_grupo' then '' else 'c25' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":"3"}', null, 'staff') = '22023:campo_invalido:personas_grupo' then '' else 'cs' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1,"rango_etario":"adulto"}', null, 'staff') = '22023:campo_invalido:rango_etario' then '' else 'd' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1,"conocia_sim":"quizas"}', null, 'staff') = '22023:campo_invalido:conocia_sim' then '' else 'e' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"subio","personas_grupo":1,"motivo":"precio"}', null, 'staff') = '22023:motivo_no_aplica' then '' else 'f' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"pregunto","personas_grupo":1,"motivo":"caro"}', null, 'staff') = '22023:campo_invalido:motivo' then '' else 'g' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1,"nombre":"Juan"}', null, 'staff') = '22023:campo_desconocido:nombre' then '' else 'h1' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1,"telefono":"351"}', null, 'staff') = '22023:campo_desconocido:telefono' then '' else 'h2' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1,"ocurrida_en":"2026-10-18 10:00"}', null, 'staff') = '22023:campo_invalido:ocurrida_en' then '' else 'i' end;
    v_e := v_e || case when pg_temp.t_alta(jsonb_build_object('resultado', 'miro', 'personas_grupo', 1, 'ocurrida_en', now() + interval '10 minutes'), null, 'admin') = '22023:ocurrida_en_futura' then '' else 'j' end;
    v_e := v_e || case when pg_temp.t_alta(jsonb_build_object('resultado', 'miro', 'personas_grupo', 1, 'ocurrida_en', now() - interval '31 days'), null, 'admin') = '22023:ocurrida_en_antes_del_inicio' then '' else 'k' end;
    v_e := v_e || case when pg_temp.t_alta(jsonb_build_object('resultado', 'miro', 'personas_grupo', 1, 'observaciones', repeat('x', 501)), null, 'staff') = '22023:campo_invalido:observaciones' then '' else 'l' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"compro","personas_grupo":1}', null, 'staff') = '22023:campo_invalido:resultado' then '' else 'm' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1,"iniciador":"otro"}', null, 'staff') = '22023:campo_invalido:iniciador' then '' else 'n' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1}', array[-910001]::bigint[], 'staff') = '55000:resultado_no_admite_vinculos' then '' else 'o' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1}', null, 'cliente') = '42501:actor_invalido' then '' else 'p' end;
    v_e := v_e || case when pg_temp.t_alta(jsonb_build_object('resultado', 'miro', 'personas_grupo', 1, 'atendio_empleado_id', gen_random_uuid()), null, 'staff') = '22023:empleado_no_disponible' then '' else 'q' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1}', array[-910001, -910001]::bigint[], 'staff') = '22023:turnos_repetidos' then '' else 'r' end;
    select count(*) into v_n from public.interacciones_stand;
    -- Casos válidos: solo personas; desglose vacío; 50 personas; motivo en "miró".
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1}', null, 'staff') like 'ok:%' then '' else 's1' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":2,"hombres":null,"mujeres":null}', null, 'staff') like 'ok:%' then '' else 's2' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"pregunto","personas_grupo":50,"hombres":0,"mujeres":50}', null, 'staff') like 'ok:%' then '' else 's3' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1,"motivo":"tiempo"}', null, 'staff') like 'ok:%' then '' else 's4' end;
    select count(*) into v_n2 from public.interacciones_stand;
    v_log := v_log || case when v_e = '' and v_n = v_antes and v_n2 = v_antes + 4 then 'T5 ' else 'FALLA:T5(' || v_e || ') ' end;

    -- T6 · los CHECK de la tabla también lo impiden sin pasar por la RPC.
    v_e := '';
    v_e := v_e || case when pg_temp.intentar($s$insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_por_rol, resultado, personas_grupo, hombres, mujeres)
                         values (gen_random_uuid(), md5('x'), now(), 'staff', 'miro', 3, 2, 2)$s$) like '23514:%' then '' else 'a' end;
    v_e := v_e || case when pg_temp.intentar($s$insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_por_rol, resultado, personas_grupo, hombres)
                         values (gen_random_uuid(), md5('x'), now(), 'staff', 'miro', 3, 3)$s$) like '23514:%' then '' else 'b' end;
    v_e := v_e || case when pg_temp.intentar($s$insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_por_rol, resultado, personas_grupo, motivo)
                         values (gen_random_uuid(), md5('x'), now(), 'staff', 'subio', 1, 'precio')$s$) like '23514:%' then '' else 'c' end;
    v_e := v_e || case when pg_temp.intentar($s$insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_por_rol, resultado, personas_grupo)
                         values (gen_random_uuid(), md5('x'), now(), 'staff', 'miro', 51)$s$) like '23514:%' then '' else 'd' end;
    v_e := v_e || case when pg_temp.intentar($s$insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_por_rol, resultado, personas_grupo, cierre_motivo, cerrada_en, cerrada_por_rol)
                         values (gen_random_uuid(), md5('x'), now(), 'staff', 'subio', 1, 'otro', now(), 'staff')$s$) like '23514:%' then '' else 'e' end;
    v_e := v_e || case when pg_temp.intentar($s$insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_por_rol, resultado, personas_grupo, cierre_motivo, cerrada_en, cerrada_por_rol)
                         values (gen_random_uuid(), md5('x'), now(), 'staff', 'subio', 1, 'otro', now(), 'admin')$s$) like '23514:%' then '' else 'f' end;
    v_e := v_e || case when pg_temp.intentar($s$insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_por_rol, resultado, personas_grupo)
                         values (gen_random_uuid(), md5('x'), now(), 'staff', 'miro', 50)$s$) = 'ok' then '' else 'g' end;
    v_log := v_log || case when v_e = '' then 'T6 ' else 'FALLA:T6(' || v_e || ') ' end;

    -- T7 · ventana de carga del staff por la RPC: "ayer" es el día calendario
    -- anterior en Córdoba (desde las 00:00:00), no 24 h móviles. Admin no tiene ese tope.
    v_e := pg_temp.t_alta(jsonb_build_object('resultado', 'subio', 'personas_grupo', 1, 'ocurrida_en', v_ayer0), null, 'staff');
    v_w := case when v_e like 'ok:%' then substr(v_e, 4)::uuid end;
    v_e2 := pg_temp.t_alta(jsonb_build_object('resultado', 'miro', 'personas_grupo', 1, 'ocurrida_en', v_ayer0 - interval '1 second'), null, 'staff');
    v_log := v_log || case when v_w is not null
                              and (select fecha_negocio from public.interacciones_stand where id = v_w) = v_hoy - 1
                              and v_e2 = '42501:fuera_de_ventana'
                              and pg_temp.t_alta(jsonb_build_object('resultado', 'miro', 'personas_grupo', 1, 'ocurrida_en', v_ayer0 - interval '1 second'), null, 'admin') like 'ok:%'
                           then 'T7 ' else 'FALLA:T7(' || v_e || '|' || v_e2 || ') ' end;

    -- T8 · reglas puras con instantes fijos (Córdoba = UTC−3).
    --   alta 19/10 00:05 Cba (= 19/10 03:05Z): vale desde 18/10 00:00 Cba (= 18/10 03:00Z).
    --   17/10 23:30 Cba es 18/10 02:30Z: por fecha UTC pasaría; por fecha SIM, no.
    v_ok :=
          public.interacciones_validar_ocurrida('staff', '2026-10-18T03:00:00Z', '2026-10-19T03:05:00Z', '2026-10-19T03:05:00Z', '2026-10-02T03:00:00Z') is null
      and public.interacciones_validar_ocurrida('staff', '2026-10-18T02:59:59Z', '2026-10-19T03:05:00Z', '2026-10-19T03:05:00Z', '2026-10-02T03:00:00Z') = 'fuera_de_ventana'
      and public.interacciones_validar_ocurrida('staff', '2026-10-18T02:30:00Z', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', '2026-10-02T03:00:00Z') = 'fuera_de_ventana'
      and public.interacciones_validar_ocurrida('admin', '2026-10-18T02:30:00Z', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', '2026-10-02T03:00:00Z') is null
      and public.interacciones_validar_ocurrida('admin', '2026-10-02T02:59:59Z', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', '2026-10-02T03:00:00Z') = 'ocurrida_en_antes_del_inicio'
      and public.interacciones_validar_ocurrida('admin', '2026-10-19T12:02:00Z', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', '2026-10-02T03:00:00Z') is null
      and public.interacciones_validar_ocurrida('admin', '2026-10-19T12:02:01Z', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', '2026-10-02T03:00:00Z') = 'ocurrida_en_futura'
      and public.interacciones_validar_ocurrida('admin', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', null) = 'registro_no_iniciado'
      and public.interacciones_staff_puede_corregir('2026-10-18T00:30:00Z', '2026-10-20T00:30:00Z')
      and not public.interacciones_staff_puede_corregir('2026-10-18T00:30:00Z', '2026-10-20T00:30:01Z')
      and public.interacciones_fecha_sim('2026-10-18T02:59:59Z') = '2026-10-17'
      and public.interacciones_fecha_sim('2026-10-18T03:00:00Z') = '2026-10-18';
    v_log := v_log || case when v_ok then 'T8 ' else 'FALLA:T8 ' end;

    -- T9 · alta "se subió" con turno: verificada, venta verificada, datos mínimos
    -- del turno copiados al vincular, historial del vínculo.
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2,"iniciador":"empleado"}',
                                        array[-910001]::bigint[], 'staff');
    v_y := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_log := v_log || case when pg_temp.est(v_y) = 'con_turno'
                              and (v_j -> 'estado' ->> 'venta_verificada')::boolean
                              and (v_j -> 'estado' ->> 'turnos_vinculados')::int = 1
                              and (select turno_fecha = v_hoy and turno_total = 34000 and turno_personas = 2 and vinculado_por_rol = 'staff'
                                     from public.interaccion_turnos where turno_stand_id = -910001)
                              and exists (select 1 from public.interacciones_stand_eventos
                                           where interaccion_id = v_y and tipo = 'vinculo' and rol = 'staff'
                                             and turno_stand_id = -910001 and datos ->> 'causa' = 'alta')
                              and pg_temp.ver(v_y) = 1
                           then 'T9 ' else 'FALLA:T9 ' end;

    -- T10 · un turno no puede pertenecer a dos interacciones: el alta que lo pide no
    -- guarda nada; vincularlo a una pendiente tampoco.
    v_k := gen_random_uuid();
    v_e := pg_temp.t_alta('{"resultado":"subio","personas_grupo":1}', array[-910001]::bigint[], 'staff', v_k);
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":1}', null, 'staff');
    v_q := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_e2 := pg_temp.t_vincular(v_q, 1, array[-910001]::bigint[], 'admin');
    v_log := v_log || case when v_e = '23505:turno_ya_vinculado:-910001'
                              and not exists (select 1 from public.interacciones_stand where idempotency_key = v_k)
                              and v_e2 = '23505:turno_ya_vinculado:-910001'
                              and pg_temp.est(v_q) = 'pendiente' and pg_temp.nvinc(v_q) = 0 and pg_temp.ver(v_q) = 1
                              and (select interaccion_id from public.interaccion_turnos where turno_stand_id = -910001) = v_y
                           then 'T10 ' else 'FALLA:T10(' || v_e || '|' || v_e2 || ') ' end;

    -- T11 · máximo de 4 turnos por interacción, por la RPC y por inserción directa.
    v_e := pg_temp.t_alta('{"resultado":"subio","personas_grupo":6}', array[-910002, -910003, -910004, -910005, -910006]::bigint[], 'staff');
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":6}',
                                        array[-910002, -910003, -910004, -910005]::bigint[], 'staff');
    v_m4 := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_e2 := pg_temp.t_vincular(v_m4, pg_temp.ver(v_m4), array[-910006]::bigint[], 'staff');
    v_log := v_log || case when v_e = '23514:maximo_turnos_por_interaccion'
                              and v_e2 = '23514:maximo_turnos_por_interaccion'
                              and pg_temp.intentar(format('insert into public.interaccion_turnos (interaccion_id, turno_stand_id, vinculado_por_rol) values (%L, -910006, ''admin'')', v_m4))
                                  = '23514:maximo_turnos_por_interaccion'
                              and pg_temp.nvinc(v_m4) = 4
                           then 'T11 ' else 'FALLA:T11(' || v_e || '|' || v_e2 || ') ' end;

    -- T12 · solo una interacción viva con resultado 'subio' puede tener vínculos.
    v_e := pg_temp.t_vincular(v_x, pg_temp.ver(v_x), array[-910006]::bigint[], 'staff');
    v_e2 := pg_temp.intentar(format('insert into public.interaccion_turnos (interaccion_id, turno_stand_id, vinculado_por_rol) values (%L, -910006, ''admin'')', v_x));
    v_log := v_log || case when v_e = '55000:resultado_no_admite_vinculos' and v_e2 = '55000:resultado_no_admite_vinculos'
                           then 'T12 ' else 'FALLA:T12(' || v_e || '|' || v_e2 || ') ' end;

    -- T13 · tolerancia de fecha: ±1 día entre turno e interacción.
    v_e := pg_temp.t_vincular(v_q, pg_temp.ver(v_q), array[-910014]::bigint[], 'staff');
    v_e2 := pg_temp.t_vincular(v_q, pg_temp.ver(v_q), array[-910013]::bigint[], 'staff');
    v_log := v_log || case when v_e = '22023:turno_fuera_de_tolerancia:-910014' and v_e2 = 'ok'
                              and pg_temp.est(v_q) = 'con_turno' and pg_temp.ver(v_q) = 2
                           then 'T13 ' else 'FALLA:T13(' || v_e || '|' || v_e2 || ') ' end;

    -- T14 · control optimista: una versión vieja no pisa cambios nuevos.
    v_e := pg_temp.t_editar(v_x, 1, '{"observaciones":"volvería el finde"}', 'staff');
    v_e2 := pg_temp.t_editar(v_x, 1, '{"personas_grupo":5,"hombres":null,"mujeres":null}', 'admin');
    v_log := v_log || case when v_e = 'ok' and v_e2 = '55000:version_desactualizada'
                              and (select personas_grupo = 3 and hombres = 2 and observaciones = 'volvería el finde' and version = 2
                                     from public.interacciones_stand where id = v_x)
                              and exists (select 1 from public.interacciones_stand_eventos where interaccion_id = v_x and tipo = 'edicion'
                                             and datos -> 'antes' ->> 'observaciones' = 'caro'
                                             and datos -> 'despues' ->> 'observaciones' = 'volvería el finde')
                           then 'T14 ' else 'FALLA:T14(' || v_e || '|' || v_e2 || ') ' end;

    -- T15 · una edición sin cambios no sube la versión ni deja historial.
    v_j := public.interaccion_editar(v_x, 2, '{"observaciones":"  volvería el finde "}', 'staff');
    v_log := v_log || case when (v_j ->> 'sin_cambios')::boolean and pg_temp.ver(v_x) = 2
                              and (select count(*) from public.interacciones_stand_eventos where interaccion_id = v_x and tipo = 'edicion') = 1
                           then 'T15 ' else 'FALLA:T15 ' end;

    -- T16 · pasar de 'subio' a 'pregunto' libera los turnos en la misma
    -- transacción, con historial, y sube la versión UNA vez. El turno queda libre.
    v_v := pg_temp.ver(v_q);
    v_e := pg_temp.t_editar(v_q, v_v, '{"resultado":"pregunto","motivo":"espera"}', 'staff');
    v_log := v_log || case when v_e = 'ok' and pg_temp.nvinc(v_q) = 0 and pg_temp.est(v_q) = 'no_aplica'
                              and pg_temp.ver(v_q) = v_v + 1
                              and exists (select 1 from public.interacciones_stand_eventos where interaccion_id = v_q and tipo = 'desvinculo'
                                             and turno_stand_id = -910013 and datos ->> 'causa' = 'cambio_resultado' and rol = 'staff')
                              and exists (select 1 from public.interacciones_stand_eventos where interaccion_id = v_q and tipo = 'edicion'
                                             and datos -> 'turnos_liberados' = '[-910013]'::jsonb)
                              and pg_temp.t_vincular(v_w, pg_temp.ver(v_w), array[-910013]::bigint[], 'staff') = 'ok'
                           then 'T16 ' else 'FALLA:T16(' || v_e || ') ' end;

    -- T16b · pasar a 'subio' exige quitar el motivo explícitamente.
    v_e := pg_temp.t_editar(v_x, 2, '{"resultado":"subio"}', 'staff');
    v_e2 := pg_temp.t_editar(v_x, 2, '{"resultado":"subio","motivo":null}', 'staff');
    v_log := v_log || case when v_e = '22023:motivo_no_aplica' and v_e2 = 'ok' and pg_temp.est(v_x) = 'pendiente'
                           then 'T16b ' else 'FALLA:T16b(' || v_e || '|' || v_e2 || ') ' end;

    -- T17 · anulación: libera los turnos, no se puede repetir ni editar después.
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2}',
                                        array[-910008, -910009]::bigint[], 'staff');
    v_z := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_e := pg_temp.t_anular(v_z, 1, '  duplicada  ', 'staff');
    v_j := public.interaccion_anular(v_z, 1, 'otra vez', 'staff');
    v_log := v_log || case when v_e = 'ok' and (v_j ->> 'sin_cambios')::boolean
                              and pg_temp.est(v_z) = 'anulada' and pg_temp.nvinc(v_z) = 0
                              and (select anulada_motivo = 'duplicada' and anulada_por_rol = 'staff' and version = 2
                                     from public.interacciones_stand where id = v_z)
                              and exists (select 1 from public.interacciones_stand_eventos where interaccion_id = v_z and tipo = 'anulacion'
                                             and datos -> 'turnos_liberados' = '[-910009, -910008]'::jsonb)
                              and (select count(*) from public.interacciones_stand_eventos where interaccion_id = v_z and tipo = 'desvinculo'
                                     and datos ->> 'causa' = 'anulacion') = 2
                              and pg_temp.t_editar(v_z, 2, '{"personas_grupo":3}', 'admin') = '55000:interaccion_anulada'
                              and pg_temp.t_vincular(v_z, 2, array[-910010]::bigint[], 'admin') = '55000:interaccion_anulada'
                              and pg_temp.intentar(format('update public.interacciones_stand set personas_grupo = 4, version = version + 1 where id = %L', v_z))
                                  = '55000:interaccion_anulada'
                              and not exists (select 1 from public.interacciones_cobertura_turnos where turno_stand_id in (-910008, -910009) and vinculado)
                           then 'T17 ' else 'FALLA:T17(' || v_e || ') ' end;

    -- T18 · cierre sin vínculo: solo admin, motivo obligatorio, solo sobre una
    -- 'subio' sin turnos. Sigue siendo declarada: no es venta verificada.
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":3}', null, 'staff');
    v_p := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_e := '';
    v_e := v_e || case when pg_temp.t_cerrar(v_p, 1, 'sin_turno_en_turnero', null, 'staff') = '42501:solo_admin' then '' else 'a' end;
    v_e := v_e || case when pg_temp.t_cerrar(v_p, 1, null, null, 'admin') = '22023:campo_invalido:cierre_motivo' then '' else 'b' end;
    v_e := v_e || case when pg_temp.t_cerrar(v_p, 1, 'otro', '   ', 'admin') = '22023:campo_invalido:cierre_nota' then '' else 'c' end;
    v_e := v_e || case when pg_temp.t_cerrar(v_p, 1, 'reserva_web', null, 'admin') = '22023:campo_invalido:cierre_motivo' then '' else 'd' end;
    v_e := v_e || case when pg_temp.t_cerrar(v_y, 1, 'sin_turno_en_turnero', null, 'admin') = '55000:tiene_turnos_vinculados' then '' else 'e' end;
    v_e := v_e || case when pg_temp.t_cerrar(v_q, pg_temp.ver(v_q), 'sin_turno_en_turnero', null, 'admin') = '55000:resultado_no_admite_cierre' then '' else 'f' end;
    v_e := v_e || case when pg_temp.t_cerrar(v_p, 1, 'sin_turno_en_turnero', 'no se cargó', 'admin') = 'ok' then '' else 'g' end;
    v_log := v_log || case when v_e = '' and pg_temp.est(v_p) = 'cerrada_sin_turno' and pg_temp.ver(v_p) = 2
                              and not (select venta_verificada from public.interacciones_stand_estado where interaccion_id = v_p)
                              and exists (select 1 from public.interacciones_stand_eventos where interaccion_id = v_p and tipo = 'cierre_sin_vinculo'
                                             and rol = 'admin' and datos ->> 'motivo' = 'sin_turno_en_turnero')
                           then 'T18 ' else 'FALLA:T18(' || v_e || ') ' end;

    -- T19 · vincular después del cierre: el cierre se retira con historial y la
    -- versión sube una sola vez.
    v_e := pg_temp.t_vincular(v_p, 2, array[-910007]::bigint[], 'staff');
    v_log := v_log || case when v_e = 'ok' and pg_temp.est(v_p) = 'con_turno' and pg_temp.ver(v_p) = 3
                              and (select cierre_motivo is null and cierre_nota is null and cerrada_en is null and cerrada_por_rol is null
                                     from public.interacciones_stand where id = v_p)
                              and exists (select 1 from public.interacciones_stand_eventos where interaccion_id = v_p and tipo = 'cierre_retirado'
                                             and datos ->> 'motivo' = 'sin_turno_en_turnero' and datos ->> 'nota' = 'no se cargó')
                           then 'T19 ' else 'FALLA:T19(' || v_e || ') ' end;

    -- T20 · desvincular: staff dentro de su ventana; el último deja la interacción pendiente.
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":1}',
                                        array[-910011]::bigint[], 'staff');
    v_g := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_e := pg_temp.t_desvincular(v_g, 1, -910012, 'staff');
    v_e2 := pg_temp.t_desvincular(v_g, 1, -910011, 'staff');
    v_log := v_log || case when v_e = 'P0002:vinculo_inexistente' and v_e2 = 'ok'
                              and pg_temp.est(v_g) = 'pendiente' and pg_temp.ver(v_g) = 2
                              and exists (select 1 from public.interacciones_stand_eventos where interaccion_id = v_g and tipo = 'desvinculo'
                                             and turno_stand_id = -910011 and datos ->> 'causa' = 'desvinculo')
                           then 'T20 ' else 'FALLA:T20(' || v_e || '|' || v_e2 || ') ' end;

    -- T21 · turnos gratis y participaciones: "se subió" con un turno gratis no es
    -- venta verificada; con uno pago, sí. Participaciones (4) puede superar el
    -- tamaño del grupo (2): no son personas únicas y no hay restricción.
    v_e := pg_temp.t_vincular(v_g, 2, array[-910015]::bigint[], 'staff');
    v_ok := v_e = 'ok' and pg_temp.est(v_g) = 'con_turno'
            and (select turnos_gratis = 1 and turnos_pagos = 0 and not venta_verificada
                   from public.interacciones_stand_estado where interaccion_id = v_g);
    perform public.interaccion_editar(v_g, 3, '{"personas_grupo":2}', 'staff');
    v_e2 := pg_temp.t_vincular(v_g, 4, array[-910016]::bigint[], 'staff');
    v_log := v_log || case when v_ok and v_e2 = 'ok'
                              and (select turnos_gratis = 1 and turnos_pagos = 1 and venta_verificada and participaciones = 3
                                     and personas_grupo = 2 from public.interacciones_stand_estado where interaccion_id = v_g)
                           then 'T21 ' else 'FALLA:T21(' || v_e || '|' || v_e2 || ') ' end;

    -- T22 · cobertura por la fecha del TURNO: el turno de hoy vinculado a una
    -- interacción de ayer cuenta hoy; pago y gratis se distinguen; una anulada no cubre.
    v_e := pg_temp.t_vincular(v_w, pg_temp.ver(v_w), array[-910010]::bigint[], 'staff');
    select count(*) filter (where vinculado), count(*) filter (where vinculado and not es_pago), count(*)
      into v_n, v_n2, v_antes
      from public.interacciones_cobertura_turnos where turno_stand_id between -910016 and -910001 and fecha = v_hoy;
    v_log := v_log || case when v_e = 'ok'
                              and (select fecha from public.interacciones_cobertura_turnos where turno_stand_id = -910010) = v_hoy
                              and (select fecha_negocio from public.interacciones_stand where id = v_w) = v_hoy - 1
                              and (select vinculado from public.interacciones_cobertura_turnos where turno_stand_id = -910010)
                              and v_antes = 14
                              and v_n = (select count(*) from public.interaccion_turnos it join public.turnos_stand t on t.id = it.turno_stand_id
                                          where it.turno_stand_id between -910016 and -910001 and t.fecha = v_hoy)
                              and v_n2 = 1
                           then 'T22 ' else 'FALLA:T22(' || v_e || ') ' end;

    -- T23 · ventana de corrección del staff (48 h desde el alta). Completar el
    -- vínculo de una pendiente no tiene ventana; desvincular, editar y anular sí.
    insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_en, registrada_por_rol, resultado, personas_grupo)
    values (gen_random_uuid(), md5('vieja'), now() - interval '49 hours', now() - interval '49 hours', 'staff', 'subio', 1)
    returning id into v_vieja;
    v_e := '';
    v_e := v_e || case when pg_temp.t_editar(v_vieja, 1, '{"personas_grupo":2}', 'staff') = '42501:fuera_de_ventana' then '' else 'a' end;
    v_e := v_e || case when pg_temp.t_anular(v_vieja, 1, null, 'staff') = '42501:fuera_de_ventana' then '' else 'b' end;
    v_e := v_e || case when pg_temp.t_vincular(v_vieja, 1, array[-910017]::bigint[], 'staff') = 'ok' then '' else 'c' end;
    v_e := v_e || case when pg_temp.t_desvincular(v_vieja, 2, -910017, 'staff') = '42501:fuera_de_ventana' then '' else 'd' end;
    v_e := v_e || case when pg_temp.t_desvincular(v_vieja, 2, -910017, 'admin') = 'ok' then '' else 'e' end;
    v_e := v_e || case when pg_temp.t_editar(v_vieja, 3, '{"personas_grupo":2}', 'admin') = 'ok' then '' else 'f' end;
    insert into public.interacciones_stand (idempotency_key, alta_huella, ocurrida_en, registrada_en, registrada_por_rol, resultado, personas_grupo)
    values (gen_random_uuid(), md5('reciente'), now() - interval '47 hours', now() - interval '47 hours', 'staff', 'miro', 1)
    returning id into v_k;
    v_e := v_e || case when pg_temp.t_editar(v_k, 1, '{"personas_grupo":2}', 'staff') = 'ok' then '' else 'g' end;
    -- Staff tampoco puede mover ocurrida_en antes del día anterior al ALTA.
    v_e := v_e || case when pg_temp.t_editar(v_k, 2, jsonb_build_object('ocurrida_en', now() - interval '47 hours' - interval '2 days'), 'staff')
                            = '42501:fuera_de_ventana' then '' else 'h' end;
    v_log := v_log || case when v_e = '' then 'T23 ' else 'FALLA:T23(' || v_e || ') ' end;

    -- T24 · integridad en cualquier camino de escritura (no solo por la RPC).
    v_e := '';
    v_e := v_e || case when pg_temp.intentar(format('update public.interacciones_stand set idempotency_key = gen_random_uuid(), version = version + 1 where id = %L', v_y))
                            = '55000:campo_inmutable' then '' else 'a' end;
    v_e := v_e || case when pg_temp.intentar(format('update public.interacciones_stand set personas_grupo = 3 where id = %L', v_y))
                            = '55000:version_no_incrementada' then '' else 'b' end;
    v_e := v_e || case when pg_temp.intentar(format('update public.interacciones_stand set resultado = ''miro'', version = version + 1 where id = %L', v_y))
                            = '55000:tiene_turnos_vinculados' then '' else 'c' end;
    v_e := v_e || case when pg_temp.intentar(format('update public.interacciones_stand set anulada_en = now(), anulada_por_rol = ''admin'', version = version + 1 where id = %L', v_y))
                            = '55000:tiene_turnos_vinculados' then '' else 'd' end;
    v_e := v_e || case when pg_temp.intentar('update public.interaccion_turnos set vinculado_por_rol = ''admin'' where turno_stand_id = -910001')
                            = '55000:vinculo_inmutable' then '' else 'e' end;
    v_e := v_e || case when pg_temp.intentar(format('delete from public.interacciones_stand where id = %L', v_y))
                            like '23503:%' then '' else 'f' end;
    v_log := v_log || case when v_e = '' then 'T24 ' else 'FALLA:T24(' || v_e || ') ' end;

    -- T25 · el inicio es HISTÓRICO: con interacciones registradas ya no se cambia
    -- (ni hacia atrás ni hacia adelante). Si faltara (NULL por una intervención
    -- manual), tampoco puede quedar después de una interacción viva.
    select inicio_registro into v_inicio from public.interacciones_config where id;
    v_e := pg_temp.intentar('select public.interacciones_definir_inicio((now() at time zone ''America/Argentina/Cordoba'')::timestamp, ''admin'')');
    v_e2 := pg_temp.intentar('select public.interacciones_definir_inicio(''2020-01-01 00:00''::timestamp, ''admin'')');
    update public.interacciones_config set inicio_registro = null where id;
    v_e := v_e || '|' || v_e2 || '|' || pg_temp.intentar('select public.interacciones_definir_inicio((now() at time zone ''America/Argentina/Cordoba'')::timestamp, ''admin'')');
    update public.interacciones_config set inicio_registro = v_inicio where id;
    v_log := v_log || case when v_e = '55000:inicio_ya_definido|55000:inicio_ya_definido|55000:inicio_posterior_a_registros'
                              and (select inicio_registro from public.interacciones_config where id) = v_inicio
                           then 'T25 ' else 'FALLA:T25(' || v_e || ') ' end;

    -- T32 · editar la FECHA de una 'subio' con turnos: si un turno vinculado quedaría
    -- fuera de la tolerancia, se rechaza; dentro de la tolerancia, se acepta.
    v_e := pg_temp.t_editar(v_y, 1, jsonb_build_object('ocurrida_en', now() - interval '3 days'), 'admin');
    v_e2 := pg_temp.t_editar(v_y, 1, jsonb_build_object('ocurrida_en', now() - interval '1 minute'), 'admin');
    v_log := v_log || case when v_e = '22023:turno_fuera_de_tolerancia:-910001' and v_e2 = 'ok'
                              and pg_temp.nvinc(v_y) = 1 and pg_temp.ver(v_y) = 2
                           then 'T32 ' else 'FALLA:T32(' || v_e || '|' || v_e2 || ') ' end;

    -- T33 · total y método contradictorios: se SEÑALAN sin cambiar la regla de pago
    -- (total > 0). 5000 'gratis' cuenta como pago; 0 'qr', como gratis.
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2}',
                                        array[-910018, -910019]::bigint[], 'staff');
    v_k := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_log := v_log || case when (select turnos_pagos = 1 and turnos_gratis = 1 and venta_verificada and turnos_pago_contradictorio = 2
                                   from public.interacciones_stand_estado where interaccion_id = v_k)
                              and (select bool_and(pago_contradictorio) from public.interacciones_vinculos_control where interaccion_id = v_k)
                              and (select turno_metodo_pago = 'gratis' and turno_pago from public.interacciones_vinculos_control where turno_stand_id = -910018)
                              and not (select pago_contradictorio from public.interacciones_cobertura_turnos where turno_stand_id = -910015)
                              and (select pago_contradictorio from public.interacciones_cobertura_turnos where turno_stand_id = -910019)
                              and has_function_privilege('service_role', 'public.interacciones_pago_contradictorio(numeric, text)', 'execute')
                           then 'T33 ' else 'FALLA:T33 ' end;

    -- T34 · respuestas de las RPCs: IDs de turnos como TEXTO; edición y anulación
    -- informan los turnos liberados; vincular informa si retiró un cierre.
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2}',
                                        array[-910020]::bigint[], 'staff');
    v_k := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_ok := jsonb_typeof(v_j -> 'turnos' -> 0 -> 'turno_stand_id') = 'string'
            and v_j -> 'turnos' -> 0 ->> 'turno_stand_id' = '-910020';
    v_j := public.interaccion_editar(v_k, 1, '{"resultado":"pregunto"}', 'staff');
    v_ok := v_ok and v_j -> 'turnos_liberados' = '["-910020"]'::jsonb and (v_j ->> 'cierre_retirado')::boolean = false;
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2}', null, 'staff');
    v_k := (v_j -> 'interaccion' ->> 'id')::uuid;
    perform public.interaccion_cerrar_sin_vinculo(v_k, 1, 'turno_no_identificable', null, 'admin');
    v_j := public.interaccion_vincular(v_k, 2, array[-910021]::bigint[], 'staff');
    v_ok := v_ok and (v_j ->> 'cierre_retirado')::boolean and v_j -> 'turnos' -> 0 ->> 'turno_stand_id' = '-910021';
    v_j := public.interaccion_vincular(v_k, 3, array[-910022]::bigint[], 'staff');
    v_ok := v_ok and not (v_j ->> 'cierre_retirado')::boolean;
    v_j := public.interaccion_anular(v_k, 4, null, 'admin');
    v_log := v_log || case when v_ok and v_j -> 'turnos_liberados' = '["-910022", "-910021"]'::jsonb
                           then 'T34 ' else 'FALLA:T34 ' end;

    -- T35 · (Bloque 4) la base del análisis excluye anuladas, no expone
    -- observaciones ni auditoría y solo service_role la lee.
    v_log := v_log || case when
          not exists (select 1 from public.interacciones_analisis where interaccion_id = v_z)
      and exists (select 1 from public.interacciones_analisis where interaccion_id = v_x)
      and (select count(*) from public.interacciones_analisis) = (select count(*) from public.interacciones_stand where anulada_en is null and eliminada_en is null)
      and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'interacciones_analisis'
                        and column_name in ('observaciones', 'idempotency_key', 'alta_huella', 'registrada_por_rol', 'anulada_motivo'))
      and has_table_privilege('service_role', 'public.interacciones_analisis', 'select')
      and not has_table_privilege('service_role', 'public.interacciones_analisis', 'insert')
      and not has_table_privilege('anon', 'public.interacciones_analisis', 'select')
      and not has_table_privilege('authenticated', 'public.interacciones_analisis', 'select')
      and (select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.interacciones_analisis'::regclass)
      then 'T35 ' else 'FALLA:T35 ' end;

    -- T36 · pausa de ALTAS separada del inicio histórico: solo admin; rechaza
    -- altas nuevas sin guardar nada; el reintento de una carga YA guardada
    -- devuelve la original; correcciones y vínculos siguen; pausar dos veces
    -- conserva el instante; no se puede quitar el inicio mientras está pausado ni
    -- cambiarlo; reanudar no toca el inicio; sin inicio no hay pausa.
    select inicio_registro into v_inicio from public.interacciones_config where id;
    v_key := gen_random_uuid();
    v_e := pg_temp.t_alta('{"resultado":"subio","personas_grupo":2}', null, 'staff', v_key);
    v_d1 := case when v_e like 'ok:%' then substr(v_e, 4)::uuid end;
    v_e := '';
    v_e := v_e || case when pg_temp.intentar('select public.interacciones_pausar_altas(''staff'')') = '42501:solo_admin'
                            and (select altas_pausadas_en is null from public.interacciones_config where id) then '' else 'a' end;
    v_j := public.interacciones_pausar_altas('admin');
    select altas_pausadas_en into v_pausa from public.interacciones_config where id;
    v_e := v_e || case when (v_j ->> 'altas_pausadas')::boolean and v_pausa is not null
                            and (select inicio_registro from public.interacciones_config where id) = v_inicio then '' else 'b' end;
    v_k := gen_random_uuid();
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1}', null, 'admin', v_k) = '55000:altas_pausadas'
                            and not exists (select 1 from public.interacciones_stand where idempotency_key = v_k) then '' else 'c' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"subio","personas_grupo":2}', null, 'staff', v_key) = 'ok:' || v_d1
                            and (select count(*) from public.interacciones_stand where idempotency_key = v_key) = 1 then '' else 'd' end;
    v_e := v_e || case when pg_temp.t_editar(v_d1, 1, '{"personas_grupo":3}', 'staff') = 'ok'
                            and pg_temp.t_vincular(v_d1, 2, array[-910023]::bigint[], 'staff') = 'ok'
                            and pg_temp.est(v_d1) = 'con_turno'
                            and exists (select 1 from public.interacciones_analisis where interaccion_id = v_d1) then '' else 'e' end;
    perform public.interacciones_pausar_altas('admin');
    v_e := v_e || case when (select altas_pausadas_en from public.interacciones_config where id) = v_pausa then '' else 'f' end;
    v_e := v_e || case when pg_temp.intentar('update public.interacciones_config set inicio_registro = null where id') like '23514:%' then '' else 'g' end;
    v_e := v_e || case when pg_temp.intentar('select public.interacciones_definir_inicio(''2020-01-01 00:00''::timestamp, ''admin'')') = '55000:inicio_ya_definido'
                            and (select inicio_registro = v_inicio and altas_pausadas_en = v_pausa from public.interacciones_config where id) then '' else 'h' end;
    v_j := public.interacciones_reanudar_altas('admin');
    v_e := v_e || case when not (v_j ->> 'altas_pausadas')::boolean
                            and (select inicio_registro = v_inicio and altas_pausadas_en is null from public.interacciones_config where id)
                            and pg_temp.t_alta('{"resultado":"miro","personas_grupo":1}', null, 'admin', v_k) like 'ok:%' then '' else 'i' end;
    update public.interacciones_config set inicio_registro = null where id;
    v_e := v_e || case when pg_temp.intentar('select public.interacciones_pausar_altas(''admin'')') = '55000:registro_no_iniciado' then '' else 'j' end;
    update public.interacciones_config set inicio_registro = v_inicio where id;
    v_log := v_log || case when v_e = '' then 'T36 ' else 'FALLA:T36(' || v_e || ') ' end;

    -- T37 · borrado administrativo: solo admin, en cualquier estado (con turnos,
    -- pendiente, cerrada, viva, anulada) y fecha (49 h, fuera de toda ventana de
    -- staff), con control de versión. En una sola operación libera TODOS los
    -- vínculos sin tocar los turnos, conserva la fila y una sola auditoría, y la
    -- interacción desaparece de las vistas operativas y del análisis. La
    -- cobertura conserva su denominador. Repetirlo no duplica nada; una eliminada
    -- no se edita, vincula, desvincula, anula, cierra ni reactiva; el reintento de
    -- su alta no la recrea; sus turnos se pueden vincular a otra; también se borra
    -- con las altas pausadas.
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":4}', array[-910024, -910025]::bigint[], 'staff');
    v_d2 := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":1}', null, 'staff');
    v_d3 := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"subio","personas_grupo":2}', null, 'staff');
    v_d4 := (v_j -> 'interaccion' ->> 'id')::uuid;
    perform public.interaccion_cerrar_sin_vinculo(v_d4, 1, 'turno_no_identificable', null, 'admin');
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"miro","personas_grupo":3}', null, 'staff');
    v_d5 := (v_j -> 'interaccion' ->> 'id')::uuid;
    select count(*), count(*) filter (where vinculado) into v_n, v_n2
      from public.interacciones_cobertura_turnos where turno_stand_id in (-910024, -910025);
    select md5(string_agg(md5(t::text), '' order by t.id)) into v_ht from public.turnos_stand t where t.id in (-910024, -910025);
    v_e := '';
    v_e := v_e || case when pg_temp.t_eliminar(v_d2, 1, null, 'staff') = '42501:solo_admin' and pg_temp.nvinc(v_d2) = 2 then '' else 'a' end;
    v_e := v_e || case when pg_temp.t_eliminar(v_d2, 9, null, 'admin') = '55000:version_desactualizada' and pg_temp.nvinc(v_d2) = 2
                            and pg_temp.est(v_d2) = 'con_turno' then '' else 'b' end;
    v_e := v_e || case when pg_temp.t_eliminar(v_d2, 1, repeat('x', 201), 'admin') = '22023:campo_invalido:motivo_eliminacion' then '' else 'c' end;
    v_j := public.interaccion_eliminar(v_d2, 1, '  cargada por error  ', 'admin');
    v_e := v_e || case when v_j -> 'turnos_liberados' = '["-910025", "-910024"]'::jsonb and not (v_j ->> 'sin_cambios')::boolean then '' else 'd' end;
    v_e := v_e || case when pg_temp.t_eliminar(v_d3, 1, null, 'admin') = 'ok'
                            and pg_temp.t_eliminar(v_d4, 2, null, 'admin') = 'ok'
                            and pg_temp.t_eliminar(v_d5, 1, null, 'admin') = 'ok'
                            and pg_temp.t_eliminar(v_z, 2, null, 'admin') = 'ok'
                            and pg_temp.t_eliminar(v_vieja, pg_temp.ver(v_vieja), null, 'admin') = 'ok' then '' else 'e' end;
    v_e := v_e || case when not exists (select 1 from public.interacciones_stand_estado where interaccion_id in (v_d2, v_d3, v_d4, v_d5, v_z, v_vieja))
                            and not exists (select 1 from public.interacciones_analisis where interaccion_id in (v_d2, v_d3, v_d4, v_d5, v_z, v_vieja))
                            and not exists (select 1 from public.interacciones_vinculos_control where interaccion_id in (v_d2, v_d3, v_d4, v_d5, v_z, v_vieja))
                            and not exists (select 1 from public.interaccion_turnos where interaccion_id in (v_d2, v_d3, v_d4, v_d5, v_z, v_vieja))
                            and public.interaccion_detalle(v_d2) is null and public.interaccion_detalle(v_z) is null then '' else 'f' end;
    v_e := v_e || case when (select md5(string_agg(md5(t::text), '' order by t.id)) from public.turnos_stand t where t.id in (-910024, -910025)) = v_ht
                            and v_n = 2 and v_n2 = 2
                            and (select count(*) from public.interacciones_cobertura_turnos where turno_stand_id in (-910024, -910025)) = 2
                            and (select count(*) filter (where vinculado) from public.interacciones_cobertura_turnos where turno_stand_id in (-910024, -910025)) = 0
                         then '' else 'g' end;
    v_e := v_e || case when (select eliminada_en is not null and eliminada_por_rol = 'admin' and eliminada_motivo = 'cargada por error'
                                   and version = 2 and resultado = 'subio' and personas_grupo = 4
                              from public.interacciones_stand where id = v_d2)
                            and (select count(*) from public.interacciones_stand_eventos where interaccion_id = v_d2 and tipo = 'eliminacion'
                                   and rol = 'admin' and datos -> 'turnos_liberados' = '[-910025, -910024]'::jsonb) = 1
                            and (select count(*) from public.interacciones_stand_eventos where interaccion_id = v_d2 and tipo = 'desvinculo'
                                   and datos ->> 'causa' = 'eliminacion') = 2
                            and (select count(*) from public.interacciones_stand_eventos where tipo = 'eliminacion'
                                   and interaccion_id in (v_d2, v_d3, v_d4, v_d5, v_z, v_vieja)) = 6
                            and (select (datos ->> 'estaba_anulada')::boolean from public.interacciones_stand_eventos
                                  where interaccion_id = v_z and tipo = 'eliminacion') then '' else 'h' end;
    v_j := public.interaccion_eliminar(v_d2, 1, null, 'admin');
    v_e := v_e || case when (v_j ->> 'sin_cambios')::boolean and pg_temp.ver(v_d2) = 2
                            and (select count(*) from public.interacciones_stand_eventos where interaccion_id = v_d2 and tipo = 'eliminacion') = 1
                         then '' else 'i' end;
    v_e := v_e || case when pg_temp.t_editar(v_d3, 2, '{"personas_grupo":2}', 'admin') = 'P0002:interaccion_eliminada'
                            and pg_temp.t_vincular(v_d3, 2, array[-910026]::bigint[], 'admin') = 'P0002:interaccion_eliminada'
                            and pg_temp.t_desvincular(v_d3, 2, -910026, 'admin') = 'P0002:interaccion_eliminada'
                            and pg_temp.t_anular(v_d3, 2, null, 'admin') = 'P0002:interaccion_eliminada'
                            and pg_temp.t_cerrar(v_d3, 2, 'otro', 'x', 'admin') = 'P0002:interaccion_eliminada'
                            and pg_temp.intentar(format('insert into public.interaccion_turnos (interaccion_id, turno_stand_id, vinculado_por_rol) values (%L, -910026, ''admin'')', v_d3))
                                = 'P0002:interaccion_eliminada'
                            and pg_temp.intentar(format('update public.interacciones_stand set eliminada_en = null, eliminada_por_rol = null, version = version + 1 where id = %L', v_d3))
                                = '55000:interaccion_eliminada'
                         then '' else 'j' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":3}', null, 'staff',
                                           (select idempotency_key from public.interacciones_stand where id = v_d5)) = 'P0002:interaccion_eliminada'
                            and (select count(*) from public.interacciones_stand
                                  where idempotency_key = (select idempotency_key from public.interacciones_stand where id = v_d5)) = 1
                         then '' else 'k' end;
    v_e2 := pg_temp.t_alta('{"resultado":"subio","personas_grupo":2}', array[-910024, -910025]::bigint[], 'staff');
    v_e := v_e || case when v_e2 like 'ok:%'
                            and (select count(*) filter (where vinculado) from public.interacciones_cobertura_turnos where turno_stand_id in (-910024, -910025)) = 2
                         then '' else 'l' end;
    perform public.interacciones_pausar_altas('admin');
    -- (cada escritura va en su propia sentencia: una subconsulta de la MISMA
    -- sentencia no vería sus efectos)
    v_e2 := pg_temp.t_eliminar(v_d1, pg_temp.ver(v_d1), null, 'admin');
    v_e := v_e || case when v_e2 = 'ok' and pg_temp.nvinc(v_d1) = 0
                            and not exists (select 1 from public.interacciones_cobertura_turnos where turno_stand_id = -910023 and vinculado)
                         then '' else 'm' end;
    perform public.interacciones_reanudar_altas('admin');
    v_j := public.interaccion_registrar(gen_random_uuid(), '{"resultado":"miro","personas_grupo":1}', null, 'staff');
    v_d6 := (v_j -> 'interaccion' ->> 'id')::uuid;
    perform public.interaccion_anular(v_d6, 1, null, 'staff');
    v_e := v_e || case when pg_temp.intentar(format('update public.interacciones_stand set eliminada_en = now(), eliminada_por_rol = ''admin'', observaciones = ''x'', version = version + 1 where id = %L', v_d6))
                                = '55000:interaccion_anulada'
                            and pg_temp.intentar(format('update public.interacciones_stand set eliminada_en = now(), eliminada_por_rol = ''admin'', version = version + 1 where id = %L', v_y))
                                = '55000:tiene_turnos_vinculados'
                            and pg_temp.intentar(format('update public.interacciones_stand set eliminada_en = now(), eliminada_por_rol = ''staff'', version = version + 1 where id = %L', v_d6))
                                like '23514:%'
                         then '' else 'n' end;
    v_log := v_log || case when v_e = '' then 'T37 ' else 'FALLA:T37(' || v_e || '|' || coalesce(v_e2, '') || ') ' end;

    -- T38 · edades MÚLTIPLES, tipo de grupo y "Paseando". Conjunto canónico sin
    -- repetidos ni más rangos que personas; la columna anterior (un rango) queda
    -- sincronizada: valor con 1 rango, NULL con 0 o varios. La pantalla anterior
    -- sigue registrando un rango (= conjunto de uno, MISMA huella que antes) y no
    -- puede truncar varios rangos al editar (cliente_desactualizado). Reducir
    -- personas por debajo de los rangos se rechaza sin borrar nada. El trigger
    -- solo deja pasar el backfill exacto (rango anterior → conjunto de uno, nada
    -- más), sin deshabilitarse.
    v_e := '';
    v_j := public.interaccion_registrar(gen_random_uuid(),
             '{"resultado":"pregunto","personas_grupo":3,"rangos_etarios":["50_mas","menos_14"],"tipo_grupo":"familia","motivo":"paseando"}', null, 'staff');
    v_k := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_e := v_e || case when (select rangos_etarios = array['menos_14', '50_mas'] and rango_etario is null and tipo_grupo = 'familia' and motivo = 'paseando'
                               from public.interacciones_stand where id = v_k)
                        and (select datos -> 'datos' -> 'rangos_etarios' = '["menos_14","50_mas"]'::jsonb
                               from public.interacciones_stand_eventos where interaccion_id = v_k and tipo = 'alta')
                       then '' else 'a' end;
    select count(*) into v_antes from public.interacciones_stand;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":3,"rangos_etarios":["18_24","18_24"]}', null, 'staff') = '22023:rangos_repetidos' then '' else 'b1' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":1,"rangos_etarios":["18_24","50_mas"]}', null, 'staff') = '22023:rangos_superan_personas' then '' else 'b2' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":2,"rangos_etarios":["mixto"]}', null, 'staff') = '22023:campo_invalido:rangos_etarios' then '' else 'b3' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":2,"rangos_etarios":[null]}', null, 'staff') = '22023:campo_invalido:rangos_etarios' then '' else 'b4' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":2,"rangos_etarios":"18_24"}', null, 'staff') = '22023:campo_invalido:rangos_etarios' then '' else 'b5' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":2,"rangos_etarios":["18_24"],"rango_etario":"18_24"}', null, 'staff') = '22023:campo_invalido:rangos_etarios' then '' else 'b6' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"miro","personas_grupo":2,"tipo_grupo":"grupo"}', null, 'staff') = '22023:campo_invalido:tipo_grupo' then '' else 'b7' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"subio","personas_grupo":2,"motivo":"paseando"}', null, 'staff') = '22023:motivo_no_aplica' then '' else 'b8' end;
    v_e := v_e || case when (select count(*) from public.interacciones_stand) = v_antes then '' else 'b9' end;
    -- Huella compatible: un rango con la forma anterior y con la nueva = el mismo envío.
    v_key := gen_random_uuid();
    v_j := public.interaccion_registrar(v_key, '{"resultado":"pregunto","personas_grupo":2,"rango_etario":"25_34"}', null, 'staff');
    v_y := (v_j -> 'interaccion' ->> 'id')::uuid;
    v_j := public.interaccion_registrar(v_key, '{"resultado":"pregunto","personas_grupo":2,"rangos_etarios":["25_34"],"tipo_grupo":null}', null, 'staff');
    v_e := v_e || case when (v_j ->> 'repetida')::boolean and (v_j -> 'interaccion' ->> 'id')::uuid = v_y
                        and (select rangos_etarios = array['25_34'] and rango_etario = '25_34' from public.interacciones_stand where id = v_y)
                       then '' else 'c' end;
    v_e := v_e || case when pg_temp.t_alta('{"resultado":"pregunto","personas_grupo":2,"rangos_etarios":["25_34","50_mas"]}', null, 'staff', v_key)
                            = '23505:idempotency_key_con_otro_payload' then '' else 'c2' end;
    -- Edición: la forma anterior sobre UN rango funciona; sobre varios, 409 sin tocar.
    -- (Cada edición en su propia sentencia: una subconsulta de la misma no vería lo escrito.)
    v_e2 := pg_temp.t_editar(v_y, 1, '{"rango_etario":"35_49"}', 'staff');
    v_e := v_e || case when v_e2 = 'ok'
                        and (select rangos_etarios = array['35_49'] and rango_etario = '35_49' from public.interacciones_stand where id = v_y)
                       then '' else 'd1(' || v_e2 || ')' end;
    v_e := v_e || case when pg_temp.t_editar(v_k, 1, '{"rango_etario":"18_24"}', 'staff') = '55000:cliente_desactualizado'
                        and pg_temp.t_editar(v_k, 1, '{"rango_etario":null}', 'staff') = '55000:cliente_desactualizado'
                        and pg_temp.ver(v_k) = 1
                       then '' else 'd2' end;
    v_e := v_e || case when pg_temp.t_editar(v_k, 1, '{"personas_grupo":1}', 'staff') = '22023:rangos_superan_personas'
                        and (select rangos_etarios = array['menos_14', '50_mas'] and personas_grupo = 3 from public.interacciones_stand where id = v_k)
                       then '' else 'd3' end;
    v_e2 := pg_temp.t_editar(v_k, 1, '{"observaciones":"sin tocar edades"}', 'staff');
    v_e := v_e || case when v_e2 = 'ok' and pg_temp.ver(v_k) = 2
                        and (select rangos_etarios = array['menos_14', '50_mas'] and tipo_grupo = 'familia' from public.interacciones_stand where id = v_k)
                       then '' else 'd4(' || v_e2 || ')' end;
    v_e2 := pg_temp.t_editar(v_k, 2, '{"rangos_etarios":[],"tipo_grupo":null}', 'staff');
    v_e := v_e || case when v_e2 = 'ok'
                        and (select rangos_etarios = '{}' and rango_etario is null and tipo_grupo is null from public.interacciones_stand where id = v_k)
                        and (select datos -> 'antes' -> 'rangos_etarios' = '["menos_14","50_mas"]'::jsonb and datos -> 'despues' -> 'rangos_etarios' = '[]'::jsonb
                               from public.interacciones_stand_eventos where interaccion_id = v_k and tipo = 'edicion' order by en desc limit 1)
                       then '' else 'd5(' || v_e2 || ')' end;
    -- La tabla no acepta rangos fuera de orden, repetidos ni desincronizados, ni por update directo.
    v_e := v_e || case when pg_temp.intentar(format('update public.interacciones_stand set rangos_etarios = array[''50_mas'', ''18_24''], version = version + 1 where id = %L', v_y)) like '23514:%'
                        and pg_temp.intentar(format('update public.interacciones_stand set rango_etario = ''18_24'', version = version + 1 where id = %L', v_y)) like '23514:%'
                       then '' else 'e' end;
    -- Backfill: solo pasa la copia exacta del rango anterior; otro cambio en la misma fila, no.
    -- (Se simula una fila previa a la migración: columna nueva vacía y la anterior con valor;
    -- todo dentro de este bloque que se revierte. El trigger sigue activo.)
    alter table public.interacciones_stand drop constraint interacciones_stand_rango_sincronizado_chk;
    update public.interacciones_stand set rangos_etarios = '{}', version = version + 1 where id = v_y;
    v_v := pg_temp.ver(v_y);
    v_e2 := pg_temp.intentar(format('update public.interacciones_stand set rangos_etarios = array[rango_etario], observaciones = ''x'' where id = %L', v_y));
    update public.interacciones_stand set rangos_etarios = array[rango_etario] where id = v_y and rango_etario is not null and rangos_etarios = '{}';
    v_e := v_e || case when v_e2 like '55000:%'
                        and (select rangos_etarios = array['35_49'] and version = v_v from public.interacciones_stand where id = v_y)
                       then '' else 'f(' || v_e2 || ')' end;
    alter table public.interacciones_stand add constraint interacciones_stand_rango_sincronizado_chk check (
      rango_etario is not distinct from (case when cardinality(rangos_etarios) = 1 then rangos_etarios[1] end));
    v_log := v_log || case when v_e = '' then 'T38 ' else 'FALLA:T38(' || v_e || ') ' end;

    -- T26 · las RPCs de Interacciones no modificaron turnos, reservas, Finanzas,
    -- Mensualidades, Gift Cards, Colectivo ni empleados (huella idéntica), y su
    -- código no tiene ninguna escritura sobre esas tablas.
    v_h1 := pg_temp.huella();
    select count(*) into v_n from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname ~ '^interacci'
       and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(turnos_stand|turnos_historicos|reserva|fin_|empleados|gift_|mensualidad|colectivo_)';
    v_log := v_log || case when v_h0 = v_h1 and v_n = 0 then 'T26 ' else 'FALLA:T26(' || v_n || ') ' end;

    -- ── Desde acá actúa el TURNERO / el admin de empleados (no las RPCs) ──

    -- T27 · "Atendió" declarado: se conserva si el empleado se archiva; uno
    -- archivado no se puede elegir de nuevo; el empleado no se puede borrar.
    v_j := public.interaccion_registrar(gen_random_uuid(),
             jsonb_build_object('resultado', 'pregunto', 'personas_grupo', 2, 'atendio_empleado_id', v_emp, 'iniciador', 'cliente'),
             null, 'staff');
    v_k := (v_j -> 'interaccion' ->> 'id')::uuid;
    update public.empleados set activo = false where id = v_emp;
    v_e := pg_temp.t_editar(v_k, 1, '{"observaciones":"preguntó por cumpleaños"}', 'staff');
    v_e2 := pg_temp.t_alta(jsonb_build_object('resultado', 'miro', 'personas_grupo', 1, 'atendio_empleado_id', v_emp), null, 'staff');
    v_log := v_log || case when v_e = 'ok' and v_e2 = '22023:empleado_no_disponible'
                              and (select atendio_empleado_id from public.interacciones_stand where id = v_k) = v_emp
                              and pg_temp.t_editar(v_x, pg_temp.ver(v_x), jsonb_build_object('atendio_empleado_id', v_emp), 'admin') = '22023:empleado_no_disponible'
                              and pg_temp.intentar(format('delete from public.empleados where id = %L', v_emp)) like '23503:%'
                           then 'T27 ' else 'FALLA:T27(' || v_e || '|' || v_e2 || ') ' end;

    -- T28 · el Turnero corrige un turno vinculado (fecha +2 días, personas): no se
    -- bloquea; el control lo detecta y las participaciones usan el valor vivo.
    v_e := pg_temp.intentar('update public.turnos_stand set fecha = fecha + 2, cantidad_personas = 3 where id = -910016');
    v_log := v_log || case when v_e = 'ok'
                              and (select turno_modificado and fuera_de_tolerancia and dias_diferencia = 2 and turno_personas = 3
                                     from public.interacciones_vinculos_control where turno_stand_id = -910016)
                              and (select turno_fecha from public.interaccion_turnos where turno_stand_id = -910016) = v_hoy
                              and (select participaciones from public.interacciones_stand_estado where interaccion_id = v_g) = 5
                              and pg_temp.est(v_g) = 'con_turno'
                           then 'T28 ' else 'FALLA:T28(' || v_e || ') ' end;

    -- T29 · el Turnero borra el ÚLTIMO turno vinculado de una interacción que antes
    -- había sido cerrada sin turno: el vínculo desaparece (CASCADE), queda el evento
    -- con el ID y los datos mínimos (sin nombre ni teléfono), la interacción vuelve a
    -- PENDIENTE (el cierre viejo no la oculta) y la versión sube.
    v_v := pg_temp.ver(v_p);
    delete from public.turnos_stand where id = -910007;
    v_log := v_log || case when pg_temp.nvinc(v_p) = 0 and pg_temp.est(v_p) = 'pendiente'
                              and (select cierre_motivo is null and version = v_v + 1 and actualizada_por_rol = 'sistema'
                                     from public.interacciones_stand where id = v_p)
                              and exists (select 1 from public.interacciones_stand_eventos
                                           where interaccion_id = v_p and tipo = 'turno_eliminado' and rol is null
                                             and turno_stand_id = -910007 and datos ->> 'causa' = 'externa'
                                             and datos -> 'al_vincular' ->> 'fecha' = v_hoy::text
                                             and (datos -> 'al_vincular' ->> 'total')::numeric = 34000)
                           then 'T29 ' else 'FALLA:T29 ' end;

    -- T30 · borrar un turno que NO es el último: sigue con turno, con uno menos.
    delete from public.turnos_stand where id = -910002;
    v_log := v_log || case when pg_temp.nvinc(v_m4) = 3 and pg_temp.est(v_m4) = 'con_turno'
                              and (select turnos_vinculados from public.interacciones_stand_estado where interaccion_id = v_m4) = 3
                           then 'T30 ' else 'FALLA:T30 ' end;

    -- T31 · nada del módulo guarda nombre ni teléfono de los turnos.
    select count(*) into v_n from public.interacciones_stand_eventos where datos::text like '%SECRETO%';
    select count(*) into v_n2 from public.interaccion_turnos it where to_jsonb(it)::text like '%SECRETO%';
    v_log := v_log || case when v_n = 0 and v_n2 = 0
                              and (select count(*) from public.interacciones_vinculos_control c where to_jsonb(c)::text like '%SECRETO%') = 0
                              and (select count(*) from public.interacciones_cobertura_turnos c where to_jsonb(c)::text like '%SECRETO%') = 0
                           then 'T31 ' else 'FALLA:T31 ' end;

    raise exception 'INTERACCIONES-B1|%', v_log;
  exception when others then
    v_resultado := case when sqlerrm like 'INTERACCIONES-B1|%' then sqlerrm
                        else 'INTERACCIONES-B1|' || v_log || 'ABORTO:' || sqlstate || ':' || sqlerrm end;
  end;
  raise exception 'RESULTADO %', v_resultado;
end $ib1$;

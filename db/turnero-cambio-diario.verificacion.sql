-- ============================================================================
-- Verificación del cambio diario de caja contra la base REAL, SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: se deshace entero.
-- Usa fechas sintéticas de 1999 (ningún cierre real) y la PK es uuid, así que
-- no consume ninguna secuencia. Resultado en el mensaje final
-- ("RESULTADO TURNERO-CAMBIO|..."); "FALLA:" marca lo que no se cumplió.
-- Después, fuera del bloque: la tabla tiene que seguir con 0 filas sintéticas.
-- ============================================================================
do $tc$
declare
  v_log text := '';
  v_resultado text;
  v_fila public.turnero_cambio_diario;
  v_creado timestamptz;
  v_n int;
  v_monto int;
  v_estado text;
begin
  begin
    -- T0 · estructura: UNIQUE(fecha), CHECK del monto, RLS sin policies, nada
    -- para anon/authenticated, RPC security definer con search_path fijo.
    v_log := v_log || case when
          exists (select 1 from pg_constraint where conname = 'turnero_cambio_diario_fecha_key' and contype = 'u'
                    and conrelid = 'public.turnero_cambio_diario'::regclass)
      and exists (select 1 from pg_constraint where conname = 'turnero_cambio_diario_monto_chk' and contype = 'c'
                    and conrelid = 'public.turnero_cambio_diario'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.turnero_cambio_diario'::regclass)
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'turnero_cambio_diario')
      and not has_table_privilege('anon', 'public.turnero_cambio_diario', 'select')
      and not has_table_privilege('anon', 'public.turnero_cambio_diario', 'insert')
      and not has_table_privilege('authenticated', 'public.turnero_cambio_diario', 'select')
      and not has_table_privilege('authenticated', 'public.turnero_cambio_diario', 'update')
      and has_table_privilege('service_role', 'public.turnero_cambio_diario', 'select')
      and not has_function_privilege('anon', 'public.turnero_cambio_guardar(date, integer, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.turnero_cambio_guardar(date, integer, text)', 'execute')
      and has_function_privilege('service_role', 'public.turnero_cambio_guardar(date, integer, text)', 'execute')
      and (select prosecdef and proconfig @> array['search_path=public'] from pg_proc
             where proname = 'turnero_cambio_guardar' and pronamespace = 'public'::regnamespace)
      then 'T0 ' else 'FALLA:T0 ' end;

    -- T1 · creación: sin registro ese día, 50.000 → 1 fila.
    v_fila := public.turnero_cambio_guardar('1999-01-03', 50000, 'staff');
    select count(*) into v_n from public.turnero_cambio_diario where fecha = '1999-01-03';
    v_creado := v_fila.created_at;
    v_log := v_log || case when v_n = 1 and v_fila.monto = 50000 and v_fila.creado_por = 'staff'
                              and v_fila.actualizado_por = 'staff' then 'T1 ' else 'FALLA:T1 ' end;

    -- T2 · edición: mismo día 50.000 → 60.000, sigue 1 fila; conserva creado_por y created_at.
    v_fila := public.turnero_cambio_guardar('1999-01-03', 60000, 'admin');
    select count(*), max(monto) into v_n, v_monto from public.turnero_cambio_diario where fecha = '1999-01-03';
    v_log := v_log || case when v_n = 1 and v_monto = 60000 and v_fila.creado_por = 'staff'
                              and v_fila.actualizado_por = 'admin' and v_fila.created_at = v_creado
                              and v_fila.updated_at >= v_fila.created_at then 'T2 ' else 'FALLA:T2 ' end;

    -- T3 · monto 0 es válido.
    v_fila := public.turnero_cambio_guardar('1999-01-04', 0, 'staff');
    v_log := v_log || case when v_fila.monto = 0 then 'T3 ' else 'FALLA:T3 ' end;

    -- T4 · monto negativo: la RPC lo rechaza y no escribe nada.
    begin
      v_fila := public.turnero_cambio_guardar('1999-01-05', -1, 'staff');
      v_estado := 'escribio';
    exception when others then v_estado := sqlstate || ':' || sqlerrm;
    end;
    select count(*) into v_n from public.turnero_cambio_diario where fecha = '1999-01-05';
    v_log := v_log || case when v_estado = '22023:monto_invalido' and v_n = 0 then 'T4 ' else 'FALLA:T4(' || v_estado || ') ' end;

    -- T5 · el CHECK de la tabla también lo impide sin pasar por la RPC.
    begin
      insert into public.turnero_cambio_diario (fecha, monto, creado_por, actualizado_por)
      values ('1999-01-05', -1, 'admin', 'admin');
      v_estado := 'escribio';
    exception when others then v_estado := sqlstate;
    end;
    v_log := v_log || case when v_estado = '23514' then 'T5 ' else 'FALLA:T5(' || v_estado || ') ' end;

    -- T6 · por encima del tope, rechazado.
    begin
      v_fila := public.turnero_cambio_guardar('1999-01-05', 10000001, 'admin');
      v_estado := 'escribio';
    exception when others then v_estado := sqlerrm;
    end;
    v_log := v_log || case when v_estado = 'monto_invalido' then 'T6 ' else 'FALLA:T6(' || v_estado || ') ' end;

    -- T7 · un actor que no es admin ni staff, rechazado.
    begin
      v_fila := public.turnero_cambio_guardar('1999-01-05', 100, 'cliente');
      v_estado := 'escribio';
    exception when others then v_estado := sqlstate || ':' || sqlerrm;
    end;
    v_log := v_log || case when v_estado = '42501:actor_invalido' then 'T7 ' else 'FALLA:T7(' || v_estado || ') ' end;

    -- T8 · un segundo INSERT del mismo día choca con UNIQUE(fecha).
    begin
      insert into public.turnero_cambio_diario (fecha, monto, creado_por, actualizado_por)
      values ('1999-01-03', 1, 'admin', 'admin');
      v_estado := 'escribio';
    exception when others then v_estado := sqlstate;
    end;
    v_log := v_log || case when v_estado = '23505' then 'T8 ' else 'FALLA:T8(' || v_estado || ') ' end;

    -- T9 · cierre anterior: 01 = 30.000 y 02 = 45.000 → consultando el 03, 45.000
    -- (misma consulta que lib/turneroCambio.ts: fecha < hoy, la más reciente).
    v_fila := public.turnero_cambio_guardar('1999-01-01', 30000, 'staff');
    v_fila := public.turnero_cambio_guardar('1999-01-02', 45000, 'staff');
    select monto into v_monto from public.turnero_cambio_diario
     where fecha < '1999-01-03' order by fecha desc limit 1;
    v_log := v_log || case when v_monto = 45000 then 'T9 ' else 'FALLA:T9 ' end;

    -- T10 · sin registro anterior: nada antes del primero.
    select count(*) into v_n from public.turnero_cambio_diario where fecha < '1999-01-01';
    v_log := v_log || case when v_n = 0 then 'T10 ' else 'FALLA:T10 ' end;

    raise exception 'TURNERO-CAMBIO|%', v_log;
  exception when others then v_resultado := sqlerrm;
  end;
  raise exception 'RESULTADO %', v_resultado;
end $tc$;

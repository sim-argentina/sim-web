-- ============================================================================
-- Verificación de B9 (consumir_codigo_descuento) contra la base REAL, SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: se deshace entero
-- (códigos sintéticos B9-VERIF-* con ids negativos, que no tocan la secuencia).
-- Resultado en el mensaje final ("RESULTADO B9|..."); "FALLA:" marca lo que no
-- se cumplió.
--
-- El bug viejo dependía del INSTANTE (fecha UTC), no de la zona de sesión: solo
-- se ve entre las 21:00 y las 23:59 de Argentina. Para probar el borde a
-- cualquier hora, se crean en pg_temp DOS copias con el reloj inyectado:
--   · b9_nueva: el cuerpo DESPLEGADO tal cual (leído de pg_proc), con now()
--     reemplazado por p_ahora → prueba exactamente lo que corre en producción;
--   · b9_vieja: el cuerpo anterior (db/codigos-b9-fecha-argentina.previo.sql).
-- Borde en una fecha neutra: 15/11 23:59:59 de Argentina (= 16/11 02:59:59 UTC)
-- y 16/11 00:00:00 de Argentina (= 16/11 03:00:00 UTC).
-- Además, la función REAL (con su now()) sobre códigos sintéticos: consume una
-- vez, desactiva al llegar al máximo, no consume eliminados.
-- ============================================================================
do $b9$
declare
  v_src text;
  v_log text := '';
  v_resultado text;
  v_t1 timestamptz := '2026-11-16 02:59:59+00';
  v_t2 timestamptz := '2026-11-16 03:00:00+00';
  v_caso record;
  v_r boolean;
  v_usos int;
  v_activo boolean;
begin
  begin
    -- T0 · el cuerpo desplegado usa la fecha de Argentina y excluye eliminados.
    select prosrc into v_src from pg_proc
     where proname = 'consumir_codigo_descuento' and pronamespace = 'public'::regnamespace;
    v_log := v_log || case when v_src like '%now() at time zone ''America/Argentina/Buenos_Aires''%'
                             and v_src like '%c.deleted_at is null%'
                             and v_src not like '%''utc''%'
                           then 'T0 ' else 'FALLA:T0 ' end;

    -- Copias con reloj inyectado.
    execute format('create function pg_temp.b9_nueva(p_codigo text, p_ahora timestamptz) returns boolean language plpgsql as %L',
                   replace(v_src, 'now()', 'p_ahora'));
    execute $f$
      create function pg_temp.b9_vieja(p_codigo text, p_ahora timestamptz) returns boolean language plpgsql as $b$
      declare
        v_rows integer;
        v_hoy text := to_char((p_ahora at time zone 'utc'), 'YYYY-MM-DD');
      begin
        update codigos_descuento c
        set usos_actuales = coalesce(c.usos_actuales, 0) + 1,
            activo = case
                       when c.usos_maximos is not null
                            and coalesce(c.usos_actuales, 0) + 1 >= c.usos_maximos then false
                       else c.activo
                     end
        where c.codigo = upper(trim(p_codigo))
          and c.activo = true
          and (c.fecha_inicio is null or c.fecha_inicio::text <= v_hoy)
          and (c.fecha_fin is null or c.fecha_fin::text >= v_hoy)
          and (c.usos_maximos is null or coalesce(c.usos_actuales, 0) < c.usos_maximos);
        get diagnostics v_rows = row_count;
        return v_rows > 0;
      end $b$ $f$;

    -- T1..T10 · bordes de fecha (nueva = Argentina; vieja = UTC, el bug).
    for v_caso in
      select * from (values
        (-901, 'B9-VERIF-A1', 'nueva', v_t1, null::date, date '2026-11-15', false, true),  -- vence hoy (AR) a las 23:59:59
        (-902, 'B9-VERIF-A2', 'vieja', v_t1, null::date, date '2026-11-15', false, false), -- el bug: ya "vencido" en UTC
        (-903, 'B9-VERIF-B1', 'nueva', v_t1, date '2026-11-16', null::date, false, false), -- empieza mañana (AR): todavía no
        (-904, 'B9-VERIF-B2', 'vieja', v_t1, date '2026-11-16', null::date, false, true),  -- el bug: ya vigente en UTC
        (-905, 'B9-VERIF-C1', 'nueva', v_t2, null::date, date '2026-11-15', false, false), -- 00:00 AR: ya vencido
        (-906, 'B9-VERIF-D1', 'nueva', v_t2, date '2026-11-16', null::date, false, true),  -- 00:00 AR: ya vigente
        (-907, 'B9-VERIF-E1', 'nueva', v_t2, null::date, null::date, true, false),        -- eliminado: no se consume
        (-908, 'B9-VERIF-E2', 'vieja', v_t2, null::date, null::date, true, true)          -- el bug: se consumía igual
      ) as c(id, codigo, version, ahora, inicio, fin, eliminado, esperado)
    loop
      insert into public.codigos_descuento (id, codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales,
        fecha_inicio, fecha_fin, activo, deleted_at)
      values (v_caso.id, v_caso.codigo, 'B9 VERIF (sintético)', 'monto_fijo', 1, null, 0, v_caso.inicio, v_caso.fin, true,
        case when v_caso.eliminado then now() end);
      v_r := case when v_caso.version = 'nueva' then pg_temp.b9_nueva(v_caso.codigo, v_caso.ahora)
                  else pg_temp.b9_vieja(v_caso.codigo, v_caso.ahora) end;
      v_log := v_log || v_caso.codigo || '(' || v_caso.version || ')' ||
        case when v_r = v_caso.esperado then '=ok ' else '=FALLA:' || v_r || ' ' end;
    end loop;

    -- T11 · función REAL: consume una vez y desactiva al llegar al máximo.
    insert into public.codigos_descuento (id, codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo)
    values (-911, 'B9-VERIF-F1', 'B9 VERIF (sintético)', 'turno_gratis', 12000, 1, 0, true);
    v_r := public.consumir_codigo_descuento('b9-verif-f1 ');
    select usos_actuales, activo into v_usos, v_activo from public.codigos_descuento where id = -911;
    v_log := v_log || case when v_r and v_usos = 1 and not v_activo then 'T11 ' else 'FALLA:T11 ' end;
    v_r := public.consumir_codigo_descuento('B9-VERIF-F1');
    v_log := v_log || case when not v_r then 'T12 ' else 'FALLA:T12 ' end;

    -- T13 · función REAL: un eliminado activo y vigente no se consume.
    insert into public.codigos_descuento (id, codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, deleted_at)
    values (-913, 'B9-VERIF-G1', 'B9 VERIF (sintético)', 'monto_fijo', 1, null, 0, true, now());
    v_r := public.consumir_codigo_descuento('B9-VERIF-G1');
    select usos_actuales into v_usos from public.codigos_descuento where id = -913;
    v_log := v_log || case when not v_r and v_usos = 0 then 'T13 ' else 'FALLA:T13 ' end;

    raise exception 'B9|%', v_log;
  exception when others then v_resultado := sqlerrm;
  end;
  raise exception 'RESULTADO %', v_resultado;
end $b9$;

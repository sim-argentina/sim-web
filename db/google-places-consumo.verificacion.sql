-- Verificación de db/google-places-consumo.sql. Corre en UNA transacción que
-- termina SIEMPRE en RAISE (no deja nada): el resultado viene en el error,
-- "RESULTADO GOOGLE-PLACES|<casos>". Solo para la base LOCAL de pruebas:
--   docker exec -i supabase_db_sim-web-pruebas psql -U postgres -d postgres -X -q -f - < db/google-places-consumo.verificacion.sql
do $$
declare
  r text := '';
  v integer;
  hoy_ar date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  ok boolean;
begin
  -- La zona de la SESIÓN no decide la fecha (UTC+14: otra fecha que Argentina buena parte del día).
  perform set_config('timezone', 'Etc/GMT-14', true);
  delete from public.google_places_consumo where fecha = hoy_ar;

  -- 1) Tope 0 sin forzar: no reserva ni crea fila.
  v := public.google_places_reservar_llamada(0, false);
  r := r || case when v is null and not exists (select 1 from public.google_places_consumo where fecha = hoy_ar)
    then 'tope0 OK; ' else 'FALLA: tope0; ' end;

  -- 2) Tope 3: 1, 2, 3 y después NULL; el contador queda en 3. (En pasos: SQL no
  --    garantiza el orden de evaluación dentro de un AND.)
  declare
    seq text := '';
  begin
    for i in 1..4 loop
      seq := seq || coalesce(public.google_places_reservar_llamada(3)::text, 'null') || ',';
    end loop;
    r := r || case when seq = '1,2,3,null,' and (select llamadas from public.google_places_consumo where fecha = hoy_ar) = 3
      then 'tope3 OK; ' else 'FALLA: tope3 ' || seq || '; ' end;
  end;

  -- 3) Forzado (diagnóstico admin): cuenta aunque se haya alcanzado el tope.
  v := public.google_places_reservar_llamada(3, true);
  r := r || case when v = 4 and (select llamadas from public.google_places_consumo where fecha = hoy_ar) = 4
    then 'forzado OK; ' else 'FALLA: forzado; ' end;

  -- 4) Fecha de negocio de Argentina aunque la sesión esté en otra zona.
  r := r || case when (select count(*) from public.google_places_consumo where fecha = hoy_ar) = 1
    then 'fecha_ar OK; ' else 'FALLA: fecha_ar; ' end;

  -- 5) Tope inválido: error explícito.
  begin
    perform public.google_places_reservar_llamada(-1);
    r := r || 'FALLA: tope_negativo; ';
  exception when others then
    r := r || case when sqlerrm = 'tope_invalido' then 'tope_negativo OK; ' else 'FALLA: tope_negativo ' || sqlerrm || '; ' end;
  end;

  -- 6) Permisos: anon/authenticated no ejecutan ni leen; service_role lee y ejecuta, no escribe directo.
  ok := not has_function_privilege('anon', 'public.google_places_reservar_llamada(integer, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.google_places_reservar_llamada(integer, boolean)', 'execute')
    and has_function_privilege('service_role', 'public.google_places_reservar_llamada(integer, boolean)', 'execute')
    and not has_table_privilege('anon', 'public.google_places_consumo', 'select')
    and not has_table_privilege('authenticated', 'public.google_places_consumo', 'select')
    and has_table_privilege('service_role', 'public.google_places_consumo', 'select')
    and not has_table_privilege('service_role', 'public.google_places_consumo', 'insert')
    and not has_table_privilege('service_role', 'public.google_places_consumo', 'update')
    and (select relrowsecurity from pg_class where oid = 'public.google_places_consumo'::regclass);
  r := r || case when ok then 'permisos OK' else 'FALLA: permisos' end;

  raise exception 'RESULTADO GOOGLE-PLACES|%', r;
end $$;

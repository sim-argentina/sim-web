-- ============================================================================
-- Verificación de B7.1 contra la base REAL, SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Mismo esquema que db/empresas-b7-modalidad.verificacion.sql: todo dentro de
-- un sub-bloque que termina en RAISE (se deshace entero), reservas y
-- reserva_slots bloqueadas en SHARE ROW EXCLUSIVE y secuencias restauradas con
-- setval. Resultado en el mensaje final ("RESULTADO B71|..."); "FALLA:" marca
-- lo que no se cumplió.
--
-- La prueba fuerza, solo dentro de la transacción, una zona de SESIÓN cuya
-- fecha NO es la de Argentina en este instante (UTC−12 de madrugada, UTC+14 el
-- resto del día). Con CURRENT_DATE las funciones darían otro resultado; con la
-- fecha de Argentina, el de siempre:
--   · fecha_inicio = hoy → canjea;   fecha_inicio = mañana → no;
--   · fecha_vencimiento = hoy → canjea; fecha_vencimiento = ayer → no.
-- Para crear_reserva_empresa (legacy), crear_reserva_empresa_v2 y
-- consumir_empresa_codigo. Fixtures sintéticos (EMP-TB71-*), fecha sin
-- ocupación real; la campaña real no se toca.
-- ============================================================================
do $b71$
declare
  v_seq_res  regclass := pg_get_serial_sequence('public.reservas', 'id')::regclass;
  v_seq_slot regclass := pg_get_serial_sequence('public.reserva_slots', 'id')::regclass;
  v_res_last bigint; v_res_called boolean; v_slot_last bigint; v_slot_called boolean;
  v_resultado text;
  v_log text := '';
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_zona text;
  v_habil date;
  v_caso record;
  v_i int := 0;
  v_n int;
  v_camp uuid;
  v_cod text;
  v_hora text;
begin
  lock table public.reservas, public.reserva_slots in share row exclusive mode;
  execute format('select last_value, is_called from %s', v_seq_res) into v_res_last, v_res_called;
  execute format('select last_value, is_called from %s', v_seq_slot) into v_slot_last, v_slot_called;

  begin
    -- T0 · zona de sesión con OTRA fecha que Argentina (solo en esta transacción).
    v_zona := case when extract(hour from now() at time zone 'America/Argentina/Buenos_Aires') < 8
                   then 'Etc/GMT+12' else 'Etc/GMT-14' end;
    perform set_config('timezone', v_zona, true);
    v_log := v_log || case when current_date <> v_hoy
      then format('T0(%s: current_date %s, Argentina %s) ', v_zona, current_date, v_hoy) else 'FALLA:T0 ' end;

    -- T1 · Buenos Aires y Córdoba dan la misma fecha (cada hora durante dos años).
    select count(*) into v_n
      from generate_series(now() - interval '365 days', now() + interval '365 days', interval '1 hour') t
     where (t at time zone 'America/Argentina/Buenos_Aires')::date <> (t at time zone 'America/Argentina/Cordoba')::date;
    v_log := v_log || case when v_n = 0 then 'T1 ' else 'FALLA:T1(' || v_n || ') ' end;

    select min(x)::date into v_habil from generate_series(v_hoy + 30, v_hoy + 90, interval '1 day') x
     where extract(isodow from x) between 1 and 5
       and not exists (select 1 from public.reservas r where r.fecha = x::date::text)
       and not exists (select 1 from public.reserva_slots s where s.fecha = x::date::text)
       and not exists (select 1 from public.bloqueos_reservas b where b.fecha = x::date);

    -- T2..T13 · cada caso con las tres funciones.
    for v_caso in
      select * from (values
        ('inicio_hoy',    v_hoy,      v_hoy + 30, true),
        ('inicio_manana', v_hoy + 1,  v_hoy + 30, false),
        ('vence_hoy',     v_hoy - 30, v_hoy,      true),
        ('vence_ayer',    v_hoy - 30, v_hoy - 1,  false)
      ) as c(nombre, inicio, vence, canjea)
    loop
      v_i := v_i + 1;

      -- Legacy (15 min, bloques de 20).
      v_camp := gen_random_uuid(); v_cod := 'EMP-TB71-L' || v_i;
      insert into public.empresa_campanias (id, empresa, modalidad, modalidad_comercial, cantidad_contratada, duracion_minutos,
        usos_por_codigo, precio_neto, iva_porcentaje, estado, estado_pago, fecha_pago, fecha_inicio, fecha_vencimiento, codigos_generados)
      values (v_camp, 'B71 VERIF legacy (sintética)', 'unica', null, 1, 15, 1, 0, 21, 'activa', 'pagado', v_caso.inicio, v_caso.inicio, v_caso.vence, true);
      insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales) values (v_camp, v_cod, 'disponible', 1, 0);
      v_hora := to_char(time '10:00' + (v_i - 1) * interval '40 minutes', 'HH24:MI');
      select count(*) into v_n from public.crear_reserva_empresa(v_cod, 'B71', 'Verif', '0000000091', null,
        v_habil, v_hora, 15, array['Ferrari'], array[v_hora], 'b71-verif-l' || v_i);
      v_log := v_log || case when v_n = (case when v_caso.canjea then 1 else 0 end)
        then 'legacy:' || v_caso.nombre || ' ' else 'FALLA:legacy:' || v_caso.nombre || ' ' end;

      -- v2 (20 min, una fila con buffer).
      v_camp := gen_random_uuid(); v_cod := 'EMP-TB71-V' || v_i;
      insert into public.empresa_campanias (id, empresa, modalidad, modalidad_comercial, cantidad_contratada, duracion_minutos,
        usos_por_codigo, precio_neto, iva_porcentaje, estado, estado_pago, fecha_pago, fecha_inicio, fecha_vencimiento, codigos_generados)
      values (v_camp, 'B71 VERIF v2 (sintética)', 'unica', 'v2_10', 1, 20, 1, 0, 21, 'activa', 'pagado', v_caso.inicio, v_caso.inicio, v_caso.vence, true);
      insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales) values (v_camp, v_cod, 'disponible', 1, 0);
      v_hora := to_char(time '14:10' + (v_i - 1) * interval '40 minutes', 'HH24:MI');
      select count(*) into v_n from public.crear_reserva_empresa_v2(v_cod, 'B71', 'Verif', '0000000092', null,
        v_habil, v_hora, 20, array['McLaren'], 'b71-verif-v' || v_i);
      v_log := v_log || case when v_n = (case when v_caso.canjea then 1 else 0 end)
        then 'v2:' || v_caso.nombre || ' ' else 'FALLA:v2:' || v_caso.nombre || ' ' end;

      -- consumir_empresa_codigo (sin reserva; la app no la usa).
      v_camp := gen_random_uuid(); v_cod := 'EMP-TB71-C' || v_i;
      insert into public.empresa_campanias (id, empresa, modalidad, modalidad_comercial, cantidad_contratada, duracion_minutos,
        usos_por_codigo, precio_neto, iva_porcentaje, estado, estado_pago, fecha_pago, fecha_inicio, fecha_vencimiento, codigos_generados)
      values (v_camp, 'B71 VERIF consumo (sintética)', 'unica', null, 1, 15, 1, 0, 21, 'activa', 'pagado', v_caso.inicio, v_caso.inicio, v_caso.vence, true);
      insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales) values (v_camp, v_cod, 'disponible', 1, 0);
      select count(*) into v_n from public.consumir_empresa_codigo(v_cod, 'B71', 'Verif', '0000000093', null);
      v_log := v_log || case when v_n = (case when v_caso.canjea then 1 else 0 end)
        then 'consumir:' || v_caso.nombre || ' ' else 'FALLA:consumir:' || v_caso.nombre || ' ' end;
    end loop;

    -- T14 · lo que canjeó quedó bien: total 0, modalidad y ocupación según su campaña.
    select count(*) into v_n from public.reservas r join public.empresa_campanias c on c.id = r.empresa_campania_id
     where c.empresa like 'B71 VERIF%' and r.total = 0
       and ((c.modalidad_comercial is null and r.modalidad = 'legacy') or (c.modalidad_comercial = 'v2_10' and r.modalidad = 'v2_10'));
    v_log := v_log || case when v_n = 4 then 'T14 ' else 'FALLA:T14(' || v_n || ') ' end;
    select count(*) into v_n from public.reserva_slots s join public.reservas r on r.id = s.reserva_id
      join public.empresa_campanias c on c.id = r.empresa_campania_id
     where c.empresa like 'B71 VERIF%' and s.estado = 'activa'
       and ((c.modalidad_comercial is null and s.ocupacion_min is null) or (c.modalidad_comercial = 'v2_10' and s.ocupacion_min = 30));
    v_log := v_log || case when v_n = 4 then 'T15 ' else 'FALLA:T15(' || v_n || ') ' end;

    raise exception 'B71|% habil=%', v_log, v_habil;
  exception when others then
    v_resultado := sqlerrm || case when sqlerrm like 'B71|%' then '' else ' || log: ' || v_log end;
  end;

  perform setval(v_seq_res, v_res_last, v_res_called);
  perform setval(v_seq_slot, v_slot_last, v_slot_called);
  raise exception 'RESULTADO %', v_resultado;
end $b71$;

-- ============================================================================
-- CONTROL: la lógica VIEJA (CURRENT_DATE) en las mismas condiciones. Copia
-- temporal en pg_temp, dentro de una transacción que se deshace. Esperado:
-- "inicio_hoy=MAL" y "vence_ayer=MAL" (la prueba de arriba sí distingue).
-- ============================================================================
do $control$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_log text := '';
  v_caso record; v_i int := 0; v_n int; v_camp uuid; v_cod text; v_resultado text;
begin
  begin
    perform set_config('timezone', case when extract(hour from now() at time zone 'America/Argentina/Buenos_Aires') < 8 then 'Etc/GMT+12' else 'Etc/GMT-14' end, true);
    execute $f$
      create function pg_temp.consumir_viejo(p_codigo text) returns int language plpgsql as $b$
      declare v_cod public.empresa_codigos%rowtype; v_camp public.empresa_campanias%rowtype;
      begin
        select * into v_cod from public.empresa_codigos where codigo = p_codigo for update;
        select * into v_camp from public.empresa_campanias where id = v_cod.campania_id;
        if v_camp.fecha_inicio is null or v_camp.fecha_inicio > CURRENT_DATE
           or v_camp.fecha_vencimiento is null or v_camp.fecha_vencimiento < CURRENT_DATE then return 0; end if;
        return 1;
      end $b$ $f$;
    for v_caso in select * from (values ('inicio_hoy', v_hoy, v_hoy + 30, 1), ('inicio_manana', v_hoy + 1, v_hoy + 30, 0),
        ('vence_hoy', v_hoy - 30, v_hoy, 1), ('vence_ayer', v_hoy - 30, v_hoy - 1, 0)) as c(nombre, inicio, vence, esperado)
    loop
      v_i := v_i + 1; v_camp := gen_random_uuid(); v_cod := 'EMP-TB71-K' || v_i;
      insert into public.empresa_campanias (id, empresa, modalidad, cantidad_contratada, duracion_minutos, usos_por_codigo, precio_neto, iva_porcentaje, estado, estado_pago, fecha_pago, fecha_inicio, fecha_vencimiento, codigos_generados)
      values (v_camp, 'B71 CONTROL (sintética)', 'unica', 1, 15, 1, 0, 21, 'activa', 'pagado', v_caso.inicio, v_caso.inicio, v_caso.vence, true);
      insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales) values (v_camp, v_cod, 'disponible', 1, 0);
      v_n := pg_temp.consumir_viejo(v_cod);
      v_log := v_log || v_caso.nombre || case when v_n = v_caso.esperado then '=ok ' else '=MAL ' end;
    end loop;
    raise exception 'CONTROL|current_date=% argentina=% | vieja: %', current_date, v_hoy, v_log;
  exception when others then v_resultado := sqlerrm;
  end;
  raise exception 'RESULTADO %', v_resultado;
end $control$;

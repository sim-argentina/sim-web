-- ============================================================================
-- Verificación de B7 contra la base REAL, SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: lo que escribe se
-- deshace entero. Las secuencias NO son transaccionales, así que:
--   · se bloquean reservas y reserva_slots para escritura (SHARE ROW EXCLUSIVE)
--     durante los milisegundos que dura, para que nadie más tome ids;
--   · se anota last_value de sus secuencias y se restaura con setval al final.
-- Las filas que se insertan a mano (bloqueo, reserva web, su slot) usan ids
-- negativos con OVERRIDING SYSTEM VALUE: no tocan ninguna secuencia.
-- Resultado: 0 filas, 0 ids consumidos. El resultado vuelve en el mensaje del
-- error final ("RESULTADO B7|..."). "FALLA:" marca lo que no se cumplió.
-- No toca la campaña real ni sus códigos ni ninguna reserva real: usa una fecha
-- sin ocupación real y fixtures sintéticos (códigos EMP-TB7X-*).
-- ============================================================================
do $b7$
declare
  v_seq_res  regclass := pg_get_serial_sequence('public.reservas', 'id')::regclass;
  v_seq_slot regclass := pg_get_serial_sequence('public.reserva_slots', 'id')::regclass;
  v_res_last bigint; v_res_called boolean; v_slot_last bigint; v_slot_called boolean;
  v_resultado text;
  v_log text := '';
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_habil date; v_finde date;
  v_leg uuid := gen_random_uuid();
  v_v2 uuid := gen_random_uuid();
  v_r record;
  v_n int; v_id_v2 bigint; v_id_leg bigint; v_id bigint;
begin
  lock table public.reservas, public.reserva_slots in share row exclusive mode;
  execute format('select last_value, is_called from %s', v_seq_res) into v_res_last, v_res_called;
  execute format('select last_value, is_called from %s', v_seq_slot) into v_slot_last, v_slot_called;

  begin
    -- Un día hábil y uno de fin de semana SIN nada real (reservas, slots ni bloqueos).
    select min(x)::date into v_habil from generate_series(v_hoy + 30, v_hoy + 90, interval '1 day') x
     where extract(isodow from x) between 1 and 5
       and not exists (select 1 from public.reservas r where r.fecha = x::date::text)
       and not exists (select 1 from public.reserva_slots s where s.fecha = x::date::text)
       and not exists (select 1 from public.bloqueos_reservas b where b.fecha = x::date);
    select min(x)::date into v_finde from generate_series(v_hoy + 30, v_hoy + 90, interval '1 day') x
     where extract(isodow from x) in (6, 7);

    insert into public.empresa_campanias (id, empresa, modalidad, modalidad_comercial, cantidad_contratada, duracion_minutos,
      usos_por_codigo, precio_neto, iva_porcentaje, estado, estado_pago, fecha_pago, fecha_inicio, fecha_vencimiento, codigos_generados)
    values (v_leg, 'B7 VERIF legacy (sintética)', 'unica', null, 3, 30, 1, 0, 21, 'activa', 'pagado', current_date - 2, current_date - 1, current_date + 120, true),
           (v_v2,  'B7 VERIF v2 (sintética)',     'unica', 'v2_10', 12, 30, 1, 0, 21, 'activa', 'pagado', current_date - 2, current_date - 1, current_date + 120, true);
    insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales)
    select v_leg, 'EMP-TB7X-LC000' || g, 'disponible', 1, 0 from generate_series(1, 3) g;
    insert into public.empresa_codigos (campania_id, codigo, estado, usos_maximos, usos_actuales)
    select v_v2, 'EMP-TB7X-VC' || lpad(g::text, 4, '0'), 'disponible', 1, 0 from generate_series(1, 12) g;

    -- T1 · grilla y cierre v2 (función de la base)
    v_log := v_log || case when public.reserva_horario_valido_v2(v_habil, '21:50', 10)
      and public.reserva_horario_valido_v2(v_habil, '21:40', 20)
      and public.reserva_horario_valido_v2(v_habil, '21:30', 30)
      and not public.reserva_horario_valido_v2(v_habil, '21:40', 30)
      and not public.reserva_horario_valido_v2(v_habil, '21:50', 20)
      and not public.reserva_horario_valido_v2(v_habil, '22:00', 10)
      and not public.reserva_horario_valido_v2(v_habil, '12:05', 10)
      and not public.reserva_horario_valido_v2(v_habil, '09:50', 10)
      and not public.reserva_horario_valido_v2(v_habil, '12:10', 15)
      and public.reserva_horario_valido_v2(v_habil, '12:10', 30)
      and public.reserva_horario_valido_v2(v_finde, '14:00', 30)
      and not public.reserva_horario_valido_v2(v_finde, '14:10', 10)
      then 'T1 ' else 'FALLA:T1 ' end;

    -- T2 · canje v2 30 a las 12:10: total 0, modalidad v2, UNA fila con ocupación 40, código consumido
    select * into v_r from public.crear_reserva_empresa_v2('EMP-TB7X-VC0001', 'B7', 'Verif', '0000000071', null,
      v_habil, '12:10', 30, array['Ferrari'], 'b7-verif-v2-0001');
    v_id_v2 := v_r.reserva_id;
    perform 1 from public.reservas where id = v_id_v2 and total = 0 and total_original = 0 and descuento_aplicado = 0
      and estado = 'activa' and origen = 'empresa' and modalidad = 'v2_10' and duracion_minutos = 30 and cantidad_turnos = 1
      and empresa_campania_id = v_v2 and fecha = v_habil::text and hora = '12:10';
    v_log := v_log || case when found then 'T2a ' else 'FALLA:T2a ' end;
    select count(*) into v_n from public.reserva_slots where reserva_id = v_id_v2 and estado = 'activa' and simulador = 'Ferrari' and hora = '12:10' and ocupacion_min = 40;
    v_log := v_log || case when v_n = 1 and (select count(*) from public.reserva_slots where reserva_id = v_id_v2) = 1 then 'T2b ' else 'FALLA:T2b(' || v_n || ') ' end;
    perform 1 from public.empresa_codigos where codigo = 'EMP-TB7X-VC0001' and usos_actuales = 1 and estado = 'utilizado';
    v_log := v_log || case when found then 'T2c ' else 'FALLA:T2c ' end;
    perform 1 from public.empresa_codigo_usos where reserva_id = v_id_v2 and idempotency_key = 'b7-verif-v2-0001' and campania_id = v_v2;
    v_log := v_log || case when found then 'T2d ' else 'FALLA:T2d ' end;

    -- T3 · idempotencia: misma clave → misma reserva, sin filas nuevas
    select * into v_r from public.crear_reserva_empresa_v2('EMP-TB7X-VC0001', 'B7', 'Verif', '0000000071', null,
      v_habil, '12:10', 30, array['Ferrari'], 'b7-verif-v2-0001');
    select count(*) into v_n from public.reservas where empresa_campania_id = v_v2;
    v_log := v_log || case when v_r.reserva_id = v_id_v2 and v_n = 1 then 'T3 ' else 'FALLA:T3 ' end;

    -- T4 · el código consumido no vuelve a canjear (otra clave)
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0001', 'B7', 'Verif', '0000000071', null,
      v_habil, '15:00', 30, array['Alpine'], 'b7-verif-v2-0002');
    v_log := v_log || case when v_n = 0 then 'T4 ' else 'FALLA:T4 ' end;

    -- T5 · cada RPC rechaza la campaña de la otra modalidad (sin consumir)
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-LC0001', 'B7', 'Verif', '0000000072', null,
      v_habil, '12:10', 30, array['McLaren'], 'b7-verif-cruce-0001');
    v_log := v_log || case when v_n = 0 then 'T5a ' else 'FALLA:T5a ' end;
    select count(*) into v_n from public.crear_reserva_empresa('EMP-TB7X-VC0002', 'B7', 'Verif', '0000000073', null,
      v_habil, '12:00', 30, array['McLaren'], array['12:00','12:20'], 'b7-verif-cruce-0002');
    v_log := v_log || case when v_n = 0 then 'T5b ' else 'FALLA:T5b ' end;
    select count(*) into v_n from public.empresa_codigos where codigo in ('EMP-TB7X-LC0001', 'EMP-TB7X-VC0002') and usos_actuales = 0 and estado = 'disponible';
    v_log := v_log || case when v_n = 2 then 'T5c ' else 'FALLA:T5c ' end;

    -- T6 · canje legacy 30 a las 14:00: bloques de 20, ocupacion_min NULL, modalidad legacy, total 0
    select * into v_r from public.crear_reserva_empresa('EMP-TB7X-LC0001', 'B7', 'Verif', '0000000074', null,
      v_habil, '14:00', 30, array['McLaren'], array['14:00','14:20'], 'b7-verif-leg-0001');
    v_id_leg := v_r.reserva_id;
    perform 1 from public.reservas where id = v_id_leg and modalidad = 'legacy' and total = 0 and origen = 'empresa' and duracion_minutos = 30;
    v_log := v_log || case when found then 'T6a ' else 'FALLA:T6a ' end;
    select count(*) into v_n from public.reserva_slots where reserva_id = v_id_leg and estado = 'activa' and ocupacion_min is null and hora in ('14:00', '14:20');
    v_log := v_log || case when v_n = 2 then 'T6b ' else 'FALLA:T6b(' || v_n || ') ' end;

    -- T7 · agenda mixta: v2 contra legacy (trigger B1). McLaren legacy = [14:00, 14:40)
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0003', 'B7', 'Verif', '0000000075', null,
      v_habil, '14:30', 30, array['McLaren'], 'b7-verif-mix-0001');
    v_log := v_log || case when v_n = 0 then 'T7a ' else 'FALLA:T7a ' end;
    perform 1 from public.empresa_codigos where codigo = 'EMP-TB7X-VC0003' and usos_actuales = 0 and estado = 'disponible';
    v_log := v_log || case when found then 'T7b(rollback_total) ' else 'FALLA:T7b ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0003', 'B7', 'Verif', '0000000075', null,
      v_habil, '14:40', 30, array['McLaren'], 'b7-verif-mix-0002');
    v_log := v_log || case when v_n = 1 then 'T7c ' else 'FALLA:T7c ' end;

    -- T8 · v2 contra v2 (semiabierto). Ferrari v2 = [12:10, 12:50)
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0004', 'B7', 'Verif', '0000000076', null,
      v_habil, '12:40', 30, array['Ferrari'], 'b7-verif-v2v2-0001');
    v_log := v_log || case when v_n = 0 then 'T8a ' else 'FALLA:T8a ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0004', 'B7', 'Verif', '0000000076', null,
      v_habil, '12:50', 30, array['Ferrari'], 'b7-verif-v2v2-0002');
    v_log := v_log || case when v_n = 1 then 'T8b ' else 'FALLA:T8b ' end;

    -- T9 · reserva web v2 (otro origen) en Red Bull [18:00, 18:30) bloquea a Empresa
    insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado, duracion_minutos, origen, modalidad)
    overriding system value
    values (-7002, 'B7 verif web', '0000000077', v_habil::text, '18:00', '["Red Bull"]'::jsonb, 2, 0, 'activa', 20, 'web', 'v2_10');
    insert into public.reserva_slots (id, reserva_id, fecha, hora, simulador, estado, ocupacion_min)
    overriding system value
    values (-7003, -7002, v_habil::text, '18:00', 'Red Bull', 'activa', 30);
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0005', 'B7', 'Verif', '0000000078', null,
      v_habil, '18:20', 30, array['Red Bull'], 'b7-verif-web-0001');
    v_log := v_log || case when v_n = 0 then 'T9a ' else 'FALLA:T9a ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0005', 'B7', 'Verif', '0000000078', null,
      v_habil, '18:30', 30, array['Red Bull'], 'b7-verif-web-0002');
    v_log := v_log || case when v_n = 1 then 'T9b ' else 'FALLA:T9b ' end;

    -- T10 · bloqueo 16:20–16:40 en Alpine: v2 30 a las 16:00 [16:00,16:40) choca; 15:30 [15:30,16:10) no
    insert into public.bloqueos_reservas (id, fecha, todo_el_dia, hora_inicio, hora_fin, simulador, motivo, activo)
    overriding system value
    values (-7001, v_habil, false, '16:20', '16:40', 'Alpine', 'B7 verificación', true);
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0006', 'B7', 'Verif', '0000000079', null,
      v_habil, '16:00', 30, array['Alpine'], 'b7-verif-bloq-0001');
    v_log := v_log || case when v_n = 0 then 'T10a ' else 'FALLA:T10a ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0006', 'B7', 'Verif', '0000000079', null,
      v_habil, '15:30', 30, array['Alpine'], 'b7-verif-bloq-0002');
    v_log := v_log || case when v_n = 1 then 'T10b ' else 'FALLA:T10b ' end;

    -- T11 · entradas inválidas: duración distinta a la campaña, simuladores, horario
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0007', 'B7', 'Verif', '0000000080', null,
      v_habil, '10:00', 20, array['Ferrari'], 'b7-verif-inv-0001');
    v_log := v_log || case when v_n = 0 then 'T11a(duracion) ' else 'FALLA:T11a ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0007', 'B7', 'Verif', '0000000080', null,
      v_habil, '10:00', 30, array['Ferrari','Ferrari'], 'b7-verif-inv-0002');
    v_log := v_log || case when v_n = 0 then 'T11b(repetido) ' else 'FALLA:T11b ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0007', 'B7', 'Verif', '0000000080', null,
      v_habil, '10:00', 30, array['Mercedes'], 'b7-verif-inv-0003');
    v_log := v_log || case when v_n = 0 then 'T11c(desconocido) ' else 'FALLA:T11c ' end;
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0007', 'B7', 'Verif', '0000000080', null,
      v_habil, '21:40', 30, array['Ferrari'], 'b7-verif-inv-0004');
    v_log := v_log || case when v_n = 0 then 'T11d(cierre) ' else 'FALLA:T11d ' end;
    perform 1 from public.empresa_codigos where codigo = 'EMP-TB7X-VC0007' and usos_actuales = 0;
    v_log := v_log || case when found then 'T11e(sin_consumo) ' else 'FALLA:T11e ' end;

    -- T12 · reprogramación v2: conserva modalidad, una fila con buffer, no consume otro uso
    v_log := v_log || case when public.reprogramar_reserva_empresa_v2(v_id_v2, v_habil, '13:00', array['Red Bull'])
      then 'T12a ' else 'FALLA:T12a ' end;
    perform 1 from public.reservas where id = v_id_v2 and hora = '13:00' and modalidad = 'v2_10' and simuladores = '["Red Bull"]'::jsonb;
    v_log := v_log || case when found then 'T12b ' else 'FALLA:T12b ' end;
    select count(*) into v_n from public.reserva_slots where reserva_id = v_id_v2 and estado = 'activa';
    v_log := v_log || case when v_n = 1 and exists (select 1 from public.reserva_slots where reserva_id = v_id_v2 and estado = 'activa'
      and hora = '13:00' and simulador = 'Red Bull' and ocupacion_min = 40) then 'T12c ' else 'FALLA:T12c(' || v_n || ') ' end;
    perform 1 from public.empresa_codigos where codigo = 'EMP-TB7X-VC0001' and usos_actuales = 1;
    v_log := v_log || case when found then 'T12d ' else 'FALLA:T12d ' end;
    -- a un lugar ocupado → false y la reserva queda donde estaba
    v_log := v_log || case when not public.reprogramar_reserva_empresa_v2(v_id_v2, v_habil, '14:20', array['McLaren'])
      and exists (select 1 from public.reserva_slots where reserva_id = v_id_v2 and estado = 'activa' and hora = '13:00')
      then 'T12e ' else 'FALLA:T12e ' end;
    -- cruces de modalidad
    v_log := v_log || case when not public.reprogramar_reserva_empresa_v2(v_id_leg, v_habil, '17:00', array['McLaren'])
      and not public.reprogramar_reserva_empresa(v_id_v2, v_habil, '17:00', array['Ferrari'], array['17:00','17:20'])
      then 'T12f ' else 'FALLA:T12f ' end;

    -- T13 · reprogramación legacy: sigue legacy, bloques de 20
    v_log := v_log || case when public.reprogramar_reserva_empresa(v_id_leg, v_habil, '17:00', array['McLaren'], array['17:00','17:20'])
      then 'T13a ' else 'FALLA:T13a ' end;
    select count(*) into v_n from public.reserva_slots where reserva_id = v_id_leg and estado = 'activa' and ocupacion_min is null and hora in ('17:00', '17:20');
    v_log := v_log || case when v_n = 2 and exists (select 1 from public.reservas where id = v_id_leg and modalidad = 'legacy' and hora = '17:00')
      then 'T13b ' else 'FALLA:T13b(' || v_n || ') ' end;

    -- T14 · cancelar libera TODOS los slots (v2 y legacy) y puede liberar el código
    v_log := v_log || case when public.cancelar_reserva_empresa(v_id_v2, true) and public.cancelar_reserva_empresa(v_id_leg, false)
      then 'T14a ' else 'FALLA:T14a ' end;
    select count(*) into v_n from public.reserva_slots where reserva_id in (v_id_v2, v_id_leg) and estado = 'activa';
    v_log := v_log || case when v_n = 0 then 'T14b ' else 'FALLA:T14b(' || v_n || ') ' end;
    perform 1 from public.empresa_codigos where codigo = 'EMP-TB7X-VC0001' and usos_actuales = 0 and estado = 'disponible';
    v_log := v_log || case when found then 'T14c ' else 'FALLA:T14c ' end;
    -- el turno liberado se vuelve a poder tomar
    select count(*) into v_n from public.crear_reserva_empresa_v2('EMP-TB7X-VC0008', 'B7', 'Verif', '0000000081', null,
      v_habil, '13:00', 30, array['Red Bull'], 'b7-verif-lib-0001');
    v_log := v_log || case when v_n = 1 then 'T14d ' else 'FALLA:T14d ' end;

    -- T15 · permisos: solo service_role (y el dueño) ejecutan las RPC nuevas
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('crear_reserva_empresa_v2', 'reprogramar_reserva_empresa_v2', 'reserva_horario_valido_v2')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and has_function_privilege('service_role', p.oid, 'execute');
    v_log := v_log || case when v_n = 3 then 'T15 ' else 'FALLA:T15(' || v_n || ') ' end;

    raise exception 'B7|% habil=%', v_log, v_habil;
  exception when others then
    v_resultado := sqlerrm || case when sqlerrm like 'B7|%' then '' else ' || log: ' || v_log end;
  end;

  perform setval(v_seq_res, v_res_last, v_res_called);
  perform setval(v_seq_slot, v_slot_last, v_slot_called);
  raise exception 'RESULTADO %', v_resultado;
end $b7$;

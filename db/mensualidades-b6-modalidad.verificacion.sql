-- ============================================================================
-- Verificación de B6 contra la base REAL, SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: lo que escribe se
-- deshace entero. Las secuencias NO son transaccionales, así que:
--   · se bloquean reservas y reserva_slots para escritura (SHARE ROW EXCLUSIVE)
--     durante los milisegundos que dura, para que nadie más tome ids;
--   · se anota last_value de sus secuencias y se restaura con setval al final.
-- Resultado: 0 filas, 0 ids consumidos. El resultado vuelve en el mensaje del
-- error final ("RESULTADO B6|..."). "FALLA:" marca lo que no se cumplió.
-- No toca el plan real ni ninguna reserva real: usa fechas sin ocupación real y
-- fixtures sintéticos (códigos MEN-BSEX-*, teléfonos 00000000xx).
-- ============================================================================
do $b6$
declare
  v_seq_res  regclass := pg_get_serial_sequence('public.reservas', 'id')::regclass;
  v_seq_slot regclass := pg_get_serial_sequence('public.reserva_slots', 'id')::regclass;
  v_res_last bigint; v_res_called boolean; v_slot_last bigint; v_slot_called boolean;
  v_resultado text;
  v_log text := '';
  v_hoy date := public.mensualidad_hoy();
  v_habil date; v_finde date; v_manana date := public.mensualidad_hoy() + 1;
  v_m_v2 uuid := gen_random_uuid();
  v_m_leg uuid := gen_random_uuid();
  v_r record; v_r2 record;
  v_n int; v_id bigint; v_ref text; v_ref_leg text; v_plan1h uuid;
begin
  lock table public.reservas, public.reserva_slots in share row exclusive mode;
  execute format('select last_value, is_called from %s', v_seq_res) into v_res_last, v_res_called;
  execute format('select last_value, is_called from %s', v_seq_slot) into v_slot_last, v_slot_called;

  begin
    select min(x)::date into v_habil from generate_series(v_hoy + 8, v_hoy + 15, interval '1 day') x where extract(isodow from x) between 1 and 5;
    select min(x)::date into v_finde from generate_series(v_hoy + 8, v_hoy + 15, interval '1 day') x where extract(isodow from x) in (6, 7);
    select id into v_plan1h from public.mensualidad_planes where slug = '1h';

    insert into public.mensualidades (id, codigo, titular_nombre, titular_apellido, titular_telefono, telefono_norm, titular_email, saldo_minutos, vence_el, modalidad)
    values (v_m_v2,  'MEN-BSEX-TVDZ', 'B6', 'V2',     '0000000061', '0000000061', 'b6@test.local',  60, v_hoy + 20, 'v2_10'),
           (v_m_leg, 'MEN-BSEX-LGCY', 'B6', 'Legacy', '0000000062', '0000000062', 'b6@test.local', 120, v_hoy + 20, null);

    -- T3 · grilla v2 (función de la base)
    v_log := v_log || case when public.mensualidad_horario_valido_v2(v_habil, '21:50', 10)
      and public.mensualidad_horario_valido_v2(v_habil, '21:40', 20)
      and public.mensualidad_horario_valido_v2(v_habil, '21:30', 30)
      and not public.mensualidad_horario_valido_v2(v_habil, '21:40', 30)
      and not public.mensualidad_horario_valido_v2(v_habil, '21:50', 20)
      and not public.mensualidad_horario_valido_v2(v_habil, '22:00', 10)
      and not public.mensualidad_horario_valido_v2(v_habil, '12:05', 10)
      and not public.mensualidad_horario_valido_v2(v_habil, '09:50', 10)
      and not public.mensualidad_horario_valido_v2(v_habil, '12:10', 15)
      and public.mensualidad_horario_valido_v2(v_finde, '14:00', 10)
      and public.mensualidad_horario_valido_v2(v_finde, '14:00', 20)
      and public.mensualidad_horario_valido_v2(v_finde, '14:00', 30)
      and not public.mensualidad_horario_valido_v2(v_finde, '14:10', 10)
      then 'T3 ' else 'FALLA:T3 ' end;

    -- T1 · reserva v2: 20 min × 2 simuladores → consume 40, 2 slots de 30
    select * into v_r from public.crear_reserva_mensualidad_v2(v_m_v2, v_habil, '12:10', 20, array['Ferrari','McLaren'], 'b6-verif-v2-0001-abcdef', 'test-b6');
    v_id := v_r.reserva_id; v_ref := v_r.referencia_publica;
    v_log := v_log || case when v_r.minutos_consumidos = 40 and v_r.saldo_anterior = 60 and v_r.saldo_posterior = 20 and not v_r.idempotente then 'T1a ' else 'FALLA:T1a ' end;
    select count(*) into v_n from public.reserva_slots where reserva_id = v_id and estado = 'activa' and hora = '12:10' and ocupacion_min = 30;
    v_log := v_log || case when v_n = 2 then 'T1b ' else 'FALLA:T1b(' || v_n || ') ' end;
    perform 1 from public.reservas where id = v_id and modalidad = 'v2_10' and duracion_minutos = 20 and minutos_consumidos = 40 and cobertura = 'saldo' and total = 0 and origen = 'mensualidad';
    v_log := v_log || case when found then 'T1c ' else 'FALLA:T1c ' end;
    perform 1 from public.mensualidad_movimientos where reserva_id = v_id and tipo = 'consumo' and minutos = -40 and saldo_anterior = 60 and saldo_posterior = 20;
    v_log := v_log || case when found then 'T1d(buffer_no_consume) ' else 'FALLA:T1d ' end;

    -- T7 · idempotencia: la misma clave devuelve la misma reserva, sin escribir
    select * into v_r from public.crear_reserva_mensualidad_v2(v_m_v2, v_habil, '12:10', 20, array['Ferrari','McLaren'], 'b6-verif-v2-0001-abcdef', 'test-b6');
    select count(*) into v_n from public.reservas where idempotency_key = 'b6-verif-v2-0001-abcdef';
    v_log := v_log || case when v_r.idempotente and v_r.reserva_id = v_id and v_n = 1 then 'T7 ' else 'FALLA:T7 ' end;

    -- T5 · saldo insuficiente (20 de saldo, pide 30 × 1): nada cambia
    begin
      perform * from public.crear_reserva_mensualidad_v2(v_m_v2, v_habil, '16:00', 30, array['Alpine'], 'b6-verif-v2-0002-abcdef', 'test-b6');
      v_log := v_log || 'FALLA:T5 ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%saldo_insuficiente%' then 'T5 ' else 'FALLA:T5(' || sqlerrm || ') ' end;
    end;
    perform 1 from public.mensualidades where id = v_m_v2 and saldo_minutos = 20;
    v_log := v_log || case when found then 'T5b ' else 'FALLA:T5b ' end;

    -- T4 · duraciones y modalidad del plan
    begin
      perform * from public.crear_reserva_mensualidad_v2(v_m_v2, v_habil, '12:40', 15, array['Alpine'], 'b6-verif-v2-0003-abcdef', 'test-b6');
      v_log := v_log || 'FALLA:T4a ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%duracion_invalida%' then 'T4a ' else 'FALLA:T4a(' || sqlerrm || ') ' end;
    end;
    begin
      perform * from public.crear_reserva_mensualidad(v_m_v2, v_habil, '12:40', 15, array['Alpine'], array['12:40'], 'b6-verif-v2-0004-abcdef', 'test-b6');
      v_log := v_log || 'FALLA:T4b ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%modalidad_no_corresponde%' then 'T4b ' else 'FALLA:T4b(' || sqlerrm || ') ' end;
    end;
    begin
      perform * from public.crear_reserva_mensualidad_v2(v_m_leg, v_habil, '12:40', 10, array['Alpine'], 'b6-verif-v2-0005-abcdef', 'test-b6');
      v_log := v_log || 'FALLA:T4c ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%modalidad_no_corresponde%' then 'T4c ' else 'FALLA:T4c(' || sqlerrm || ') ' end;
    end;
    begin
      perform * from public.crear_reserva_mensualidad_v2(v_m_v2, v_habil, '21:40', 30, array['Alpine'], 'b6-verif-v2-0010-abcdef', 'test-b6');
      v_log := v_log || 'FALLA:T4d ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%fuera_de_horario%' then 'T4d ' else 'FALLA:T4d(' || sqlerrm || ') ' end;
    end;

    -- T8 · cancelación con 24 h o más: devuelve 40 (no 60), libera los slots
    select * into v_r from public.cancelar_reserva_mensualidad(v_m_v2, v_ref, 'b6-verif-cancel-0001-ab', 'titular');
    v_log := v_log || case when v_r.restituyo and v_r.minutos_restituidos = 40 and v_r.saldo_posterior = 60 then 'T8a ' else 'FALLA:T8a ' end;
    select count(*) into v_n from public.reserva_slots where reserva_id = v_id and estado = 'activa';
    v_log := v_log || case when v_n = 0 then 'T8b ' else 'FALLA:T8b ' end;

    -- T6 · agenda mixta: legacy 30 min 13:00 en Alpine (13:00–13:40)
    select * into v_r from public.crear_reserva_mensualidad(v_m_leg, v_habil, '13:00', 30, array['Alpine'], array['13:00','13:20'], 'b6-verif-lg-0001-abcdef', 'test-b6');
    v_ref_leg := v_r.referencia_publica;
    perform 1 from public.reservas where id = v_r.reserva_id and modalidad = 'legacy';
    v_log := v_log || case when found then 'T6a(legacy_explicita) ' else 'FALLA:T6a ' end;
    --       v2 20 min 13:20 (13:20–13:50) en Alpine: conflicto, y atómico
    begin
      perform * from public.crear_reserva_mensualidad_v2(v_m_v2, v_habil, '13:20', 20, array['Alpine'], 'b6-verif-v2-0006-abcdef', 'test-b6');
      v_log := v_log || 'FALLA:T6b ';
    exception when others then
      v_log := v_log || case when sqlstate = '23505' then 'T6b ' else 'FALLA:T6b(' || sqlerrm || ') ' end;
    end;
    perform 1 from public.mensualidades where id = v_m_v2 and saldo_minutos = 60;
    v_log := v_log || case when found then 'T6c(sin_descuento) ' else 'FALLA:T6c ' end;
    perform 1 from public.reservas where idempotency_key = 'b6-verif-v2-0006-abcdef';
    v_log := v_log || case when not found then 'T6d(sin_reserva) ' else 'FALLA:T6d ' end;
    --       en Red Bull (libre): permitido
    select * into v_r from public.crear_reserva_mensualidad_v2(v_m_v2, v_habil, '13:20', 20, array['Red Bull'], 'b6-verif-v2-0007-abcdef', 'test-b6');
    v_log := v_log || case when v_r.saldo_posterior = 40 then 'T6e ' else 'FALLA:T6e ' end;

    -- T11 · reprogramación v2: 15:00 → 15:10 (pisa su propio tramo), sigue v2
    select * into v_r from public.crear_reserva_mensualidad_v2(v_m_v2, v_habil, '15:00', 20, array['Ferrari'], 'b6-verif-v2-0008-abcdef', 'test-b6');
    v_id := v_r.reserva_id; v_ref := v_r.referencia_publica;
    select * into v_r2 from public.reprogramar_reserva_mensualidad_v2(v_m_v2, v_ref, v_habil, '15:10', 'b6-verif-repro-0001-ab', false);
    select count(*) into v_n from public.reserva_slots where reserva_id = v_id and estado = 'activa' and hora = '15:10' and ocupacion_min = 30;
    perform 1 from public.reservas where id = v_id and hora = '15:10' and modalidad = 'v2_10' and minutos_consumidos = 20 and reprogramaciones = 1;
    v_log := v_log || case when not v_r2.sin_cambios and v_n = 1 and found then 'T11a ' else 'FALLA:T11a ' end;
    select count(*) into v_n from public.reserva_slots where reserva_id = v_id and estado = 'reprogramada' and hora = '15:00';
    v_log := v_log || case when v_n = 1 then 'T11b ' else 'FALLA:T11b ' end;
    perform 1 from public.mensualidades where id = v_m_v2 and saldo_minutos = 20;
    v_log := v_log || case when found then 'T11c(saldo_igual) ' else 'FALLA:T11c ' end;
    begin
      perform * from public.reprogramar_reserva_mensualidad(v_m_v2, v_ref, v_habil, '16:00', array['16:00','16:20'], 'b6-verif-repro-0002-ab', false);
      v_log := v_log || 'FALLA:T11d ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%modalidad_no_corresponde%' then 'T11d ' else 'FALLA:T11d(' || sqlerrm || ') ' end;
    end;

    -- T12 · el plan legacy renueva a v2: su reserva LEGACY se mueve con la legacy
    update public.mensualidades set modalidad = 'v2_10' where id = v_m_leg;
    select * into v_r2 from public.reprogramar_reserva_mensualidad(v_m_leg, v_ref_leg, v_habil, '17:00', array['17:00','17:20'], 'b6-verif-repro-0003-ab', false);
    select count(*) into v_n from public.reserva_slots s join public.reservas r on r.id = s.reserva_id
     where r.referencia_publica = v_ref_leg and s.estado = 'activa' and s.ocupacion_min is null and s.hora in ('17:00','17:20');
    perform 1 from public.reservas where referencia_publica = v_ref_leg and modalidad = 'legacy' and hora = '17:00';
    v_log := v_log || case when v_n = 2 and found then 'T12a ' else 'FALLA:T12a ' end;
    begin
      perform * from public.reprogramar_reserva_mensualidad_v2(v_m_leg, v_ref_leg, v_habil, '18:00', 'b6-verif-repro-0004-ab', false);
      v_log := v_log || 'FALLA:T12b ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%modalidad_no_corresponde%' then 'T12b ' else 'FALLA:T12b(' || sqlerrm || ') ' end;
    end;

    -- T9 · cancelación con menos de 24 h: libera, no devuelve
    select * into v_r from public.crear_reserva_mensualidad_v2(v_m_v2, v_manana, '10:00', 10, array['Ferrari'], 'b6-verif-v2-0009-abcdef', 'test-b6');
    select * into v_r2 from public.cancelar_reserva_mensualidad(v_m_v2, v_r.referencia_publica, 'b6-verif-cancel-0002-ab', 'titular');
    select count(*) into v_n from public.reserva_slots where reserva_id = v_r.reserva_id and estado = 'activa';
    v_log := v_log || case when not v_r2.restituyo and v_r2.minutos_restituidos = 0 and v_r2.saldo_posterior = 10 and v_n = 0 then 'T9 ' else 'FALLA:T9 ' end;

    -- T10 · no-show: consume los 10 comerciales (no 20) y ya no se cancela
    select * into v_r from public.crear_reserva_mensualidad_v2(v_m_v2, v_manana, '10:10', 10, array['McLaren'], 'b6-verif-v2-0011-abcdef', 'test-b6');
    update public.reservas set no_show = true where id = v_r.reserva_id;
    begin
      perform * from public.cancelar_reserva_mensualidad(v_m_v2, v_r.referencia_publica, 'b6-verif-cancel-0003-ab', 'titular');
      v_log := v_log || 'FALLA:T10 ';
    exception when others then
      perform 1 from public.reservas where id = v_r.reserva_id and minutos_consumidos = 10;
      v_log := v_log || case when sqlerrm like '%estado_no_cancelable%' and found then 'T10 ' else 'FALLA:T10(' || sqlerrm || ') ' end;
    end;

    -- T13 · aplicación de compras: modalidad del plan determinística
    insert into public.mensualidad_compras (plan_id, plan_slug, plan_nombre, plan_minutos, plan_precio, plan_vigencia_dias,
      comprador_nombre, comprador_apellido, comprador_telefono, telefono_norm, comprador_email, importe_bruto,
      external_reference, idempotency_key, condiciones_version, condiciones_aceptadas_at, canal, modalidad, created_at)
    values
      (v_plan1h, '1h', '1 hora', 60, 30000, 30, 'B6', 'A', '0000000063', '0000000063', 'b6@test.local', 30000, 'mensualidad_b6verifA', 'b6-verif-compra-A-0001', '2026-09-m8c1', now(), 'web', 'legacy', now() - interval '10 minutes'),
      (v_plan1h, '1h', '1 hora', 60, 38000, 30, 'B6', 'B', '0000000063', '0000000063', 'b6@test.local', 38000, 'mensualidad_b6verifB', 'b6-verif-compra-B-0001', '2026-10-v2',   now(), 'web', 'v2_10',  now() - interval '5 minutes'),
      (v_plan1h, '1h', '1 hora', 60, 30000, 30, 'B6', 'C', '0000000064', '0000000064', 'b6@test.local', 30000, 'mensualidad_b6verifC', 'b6-verif-compra-C-0001', '2026-09-m8c1', now(), 'web', 'legacy', now() - interval '10 minutes'),
      (v_plan1h, '1h', '1 hora', 60, 38000, 30, 'B6', 'D', '0000000064', '0000000064', 'b6@test.local', 38000, 'mensualidad_b6verifD', 'b6-verif-compra-D-0001', '2026-10-v2',   now(), 'web', 'v2_10',  now() - interval '5 minutes'),
      (v_plan1h, '1h', '1 hora', 60, 30000, 30, 'B6', 'E', '0000000065', '0000000065', 'b6@test.local', 30000, 'mensualidad_b6verifE', 'b6-verif-compra-E-0001', '2026-09-m8c1', now(), 'web', 'legacy', now() - interval '10 minutes');
    --   v2 (creada después) llega PRIMERO; la legacy (creada antes) después
    perform public.mensualidad_aplicar_compra('mensualidad_b6verifB', 'b6-verif-pay-B', 38000, 0, 38000, now());
    perform 1 from public.mensualidades where telefono_norm = '0000000063' and modalidad = 'v2_10' and saldo_minutos = 60;
    v_log := v_log || case when found then 'T13a ' else 'FALLA:T13a ' end;
    perform public.mensualidad_aplicar_compra('mensualidad_b6verifA', 'b6-verif-pay-A', 30000, 0, 30000, now());
    perform 1 from public.mensualidades where telefono_norm = '0000000063' and modalidad = 'v2_10' and saldo_minutos = 120;
    v_log := v_log || case when found then 'T13b(fuera_de_orden_no_degrada) ' else 'FALLA:T13b ' end;
    --   en orden: legacy primero (alta legacy), v2 después (pasa a v2)
    perform public.mensualidad_aplicar_compra('mensualidad_b6verifC', 'b6-verif-pay-C', 30000, 0, 30000, now());
    perform 1 from public.mensualidades where telefono_norm = '0000000064' and modalidad = 'legacy';
    v_log := v_log || case when found then 'T13c ' else 'FALLA:T13c ' end;
    perform public.mensualidad_aplicar_compra('mensualidad_b6verifD', 'b6-verif-pay-D', 38000, 0, 38000, now());
    perform 1 from public.mensualidades where telefono_norm = '0000000064' and modalidad = 'v2_10';
    v_log := v_log || case when found then 'T13d(renovacion_v2) ' else 'FALLA:T13d ' end;
    --   legacy creada antes del corte y aprobada después: legacy, con su precio
    perform public.mensualidad_aplicar_compra('mensualidad_b6verifE', 'b6-verif-pay-E', 30000, 0, 30000, now());
    perform 1 from public.mensualidades m join public.mensualidad_compras c on c.mensualidad_id = m.id
     where m.telefono_norm = '0000000065' and m.modalidad = 'legacy' and c.importe_bruto = 30000 and c.modalidad = 'legacy' and c.procesamiento = 'aplicado';
    v_log := v_log || case when found then 'T13e(pago_tardio_legacy) ' else 'FALLA:T13e ' end;

    -- T14 · ajuste de saldo en múltiplos de 5 (v_m_leg: 120 − 30 = 90)
    select * into v_r from public.mensualidad_admin_ajustar_saldo(v_m_leg, 'agregar', 5, 'b6 verif', 'admin', 'admin', 'b6-verif-ajuste-0001-ab');
    select * into v_r2 from public.mensualidad_admin_ajustar_saldo(v_m_leg, 'descontar', 10, 'b6 verif', 'admin', 'admin', 'b6-verif-ajuste-0002-ab');
    v_log := v_log || case when v_r.saldo_posterior = 95 and v_r2.saldo_posterior = 85 then 'T14a ' else 'FALLA:T14a ' end;
    select * into v_r from public.mensualidad_admin_ajustar_saldo(v_m_leg, 'agregar', 15, 'b6 verif', 'admin', 'admin', 'b6-verif-ajuste-0003-ab');
    v_log := v_log || case when v_r.saldo_posterior = 100 then 'T14b ' else 'FALLA:T14b ' end;
    begin
      perform * from public.mensualidad_admin_ajustar_saldo(v_m_leg, 'agregar', 7, 'b6 verif', 'admin', 'admin', 'b6-verif-ajuste-0004-ab');
      v_log := v_log || 'FALLA:T14c ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%minutos_no_multiplo_5%' then 'T14c ' else 'FALLA:T14c(' || sqlerrm || ') ' end;
    end;
    begin
      perform * from public.mensualidad_admin_ajustar_saldo(v_m_leg, 'descontar', 500, 'b6 verif', 'admin', 'admin', 'b6-verif-ajuste-0005-ab');
      v_log := v_log || 'FALLA:T14d ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%saldo_insuficiente%' then 'T14d ' else 'FALLA:T14d(' || sqlerrm || ') ' end;
    end;

    -- T15 · alta del panel con modalidad y precio de la versión
    select * into v_r from public.mensualidad_admin_alta_v2('1h', 'B6', 'Panel', '3519990066', 'b6@test.local', 'venta', 'efectivo', null,
      'b6 verif', 'admin', 'admin', 'b6-verif-alta-0001-abcd', true, 'v2_10', 38000, null);
    perform 1 from public.mensualidad_compras c join public.mensualidades m on m.id = c.mensualidad_id
     where c.id = v_r.compra_id and c.modalidad = 'v2_10' and c.plan_precio = 38000 and c.importe_bruto = 38000
       and c.canal = 'admin_venta' and m.modalidad = 'v2_10' and m.saldo_minutos = 60;
    v_log := v_log || case when found then 'T15a ' else 'FALLA:T15a ' end;
    begin
      perform * from public.mensualidad_admin_alta_v2('1h', 'B6', 'Panel', '3519990067', 'b6@test.local', 'venta', 'efectivo', null,
        'b6 verif', 'admin', 'admin', 'b6-verif-alta-0002-abcd', true, 'v2_10', 12345, null);
      v_log := v_log || 'FALLA:T15b ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%precio_no_corresponde%' then 'T15b ' else 'FALLA:T15b(' || sqlerrm || ') ' end;
    end;
    begin
      perform * from public.mensualidad_admin_alta_v2('1h', 'B6', 'Panel', '3519990068', 'b6@test.local', 'venta', 'efectivo', null,
        'b6 verif', 'admin', 'admin', 'b6-verif-alta-0003-abcd', true, 'v3', 38000, null);
      v_log := v_log || 'FALLA:T15c ';
    exception when others then
      v_log := v_log || case when sqlerrm like '%modalidad_comercial_invalida%' then 'T15c ' else 'FALLA:T15c(' || sqlerrm || ') ' end;
    end;

    raise exception 'B6|%', v_log;
  exception when others then
    v_resultado := sqlerrm || case when sqlerrm like 'B6|%' then '' else ' || log: ' || v_log end;
  end;

  perform setval(v_seq_res, v_res_last, v_res_called);
  perform setval(v_seq_slot, v_slot_last, v_slot_called);
  raise exception 'RESULTADO %', v_resultado;
end $b6$;

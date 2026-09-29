-- ════════════════════════════════════════════════════════════════════════════
-- Modalidad comercial · B1 — VERIFICACIÓN de la migración (tests B1 10 a 20)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Se corre DESPUÉS de db/modalidad-comercial-b1.sql. Comprueba estructura,
-- ausencia de backfill, equivalencia legacy del trigger, solapamiento v2,
-- checks de Mensualidades, precios especiales, override y precios de planes.
--
-- NO DEJA NADA: es un único bloque que termina SIEMPRE con RAISE EXCEPTION, así
-- que la transacción entera se revierte (fixtures, slots, cambios de override,
-- funciones y tabla temporales). Ids negativos y explícitos: no consumen las
-- secuencias reales. Fechas de 2099 y del año 2000, salvo UN caso que prueba la
-- RPC legacy de Mensualidades en una fecha real de la ventana: esa reserva
-- nunca se confirma (se revierte) y ningún otro proceso llega a verla.
--
-- Resultado (llega como ERROR a propósito):
--   'B1_VERIFICACION_OK <n> chequeos'           → todo bien
--   'B1_FALLA <k> de <n> chequeos: <detalle>'   → qué falló y qué se esperaba
--
-- La firma esperada de la matriz legacy es la que devolvió el trigger ANTERIOR
-- en producción (db/modalidad-comercial-b1.matriz-legacy.sql, 2026-09-28).
-- ════════════════════════════════════════════════════════════════════════════

do $verif$
declare
  -- <<DECLARE>>
  v_f1       constant text := '2099-01-05';
  v_f2       constant text := '2099-01-06';
  v_f3       constant text := '2099-01-07';
  v_f4       constant text := '2099-01-08';
  v_fp       constant text := '2000-01-03';
  v_esperada constant text := 'c01=ok|c02=23514|c03=23514|c04=23514|c05=ok|c06=23514|c07=ok|c08=23514|c09=ok|c10=ok|c11=23514|c12=ok|c13=23505|c14=ok|c15=ok|c16=ok|c17=ok|c18=ok';
  v_firma    text;
  v_mens     uuid;
  v_ref      text;
  v_fecha    date;
  v_sim      text;
  v_fallas   integer;
  v_total    integer;
  v_detalle  text;
  -- <<FIN_DECLARE>>
begin
  perform set_config('lock_timeout', '5s', true);
  -- <<BODY>>

  -- ── Herramientas temporales (se revierten con el bloque) ─────────────────
  create temp table b1_res (orden serial, caso text, obtenido text, esperado text);

  -- Ejecuta SQL y devuelve 'ok' o 'SQLSTATE:mensaje'.
  create function pg_temp.b1_sql(p_sql text) returns text language plpgsql as $f$
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end $f$;

  -- Slot con ocupación explícita (v2 si p_ocup no es NULL).
  create function pg_temp.b1_slot(p_id bigint, p_res bigint, p_fecha text, p_hora text, p_sim text,
                                  p_ocup integer, p_estado text default 'activa')
  returns text language plpgsql as $f$
  begin
    insert into public.reserva_slots
      (id, reserva_id, fecha, hora, simulador, estado, ocupacion_min) overriding system value
    values (p_id, p_res, p_fecha, p_hora, p_sim, p_estado, p_ocup);
    return 'ok';
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end $f$;

  -- Slot legacy SIN mencionar la columna nueva: exactamente lo que insertan
  -- hoy /api/reservas, el webhook, la reactivación y las RPC.
  create function pg_temp.b1_legacy(p_id bigint, p_res bigint, p_fecha text, p_hora text,
                                    p_sim text, p_estado text default 'activa')
  returns text language plpgsql as $f$
  begin
    insert into public.reserva_slots
      (id, reserva_id, fecha, hora, simulador, estado) overriding system value
    values (p_id, p_res, p_fecha, p_hora, p_sim, p_estado);
    return 'ok';
  exception when others then
    return sqlstate;
  end $f$;

  -- ── A · Estructura ──────────────────────────────────────────────────────
  insert into b1_res (caso, obtenido, esperado)
  select 'A1 columnas nuevas (reservas.modalidad, turnos_stand.modalidad, reserva_slots.ocupacion_min, precio_10, precio_20)',
         count(*)::text, '5'
    from information_schema.columns
   where table_schema = 'public'
     and (table_name, column_name) in (('reservas', 'modalidad'), ('turnos_stand', 'modalidad'),
          ('reserva_slots', 'ocupacion_min'), ('reservas_precios_especiales', 'precio_10'),
          ('reservas_precios_especiales', 'precio_20'));
  insert into b1_res (caso, obtenido, esperado)
  select 'A2 precio_15 y precio_30 siguen existiendo', count(*)::text, '2'
    from information_schema.columns
   where table_schema = 'public' and table_name = 'reservas_precios_especiales'
     and column_name in ('precio_15', 'precio_30');
  insert into b1_res (caso, obtenido, esperado)
  select 'A3 trigger reserva_slot_bloqueo sigue enganchado', count(*)::text, '1'
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'reserva_slots' and t.tgname = 'reserva_slot_bloqueo' and not t.tgisinternal;
  insert into b1_res (caso, obtenido, esperado)
  select 'A4 la función del trigger es la versión B1',
         (pg_get_functiondef('public.trg_reserva_slot_bloqueo()'::regprocedure) like '%ocupacion_min%')::text, 'true';
  insert into b1_res (caso, obtenido, esperado) values
    ('A5 hhmm 21:50',  coalesce(public.reserva_hhmm_a_minutos('21:50')::text, 'null'), '1310'),
    ('A6 hhmm 09:00',  coalesce(public.reserva_hhmm_a_minutos('09:00')::text, 'null'), '540'),
    ('A7 hhmm 9:00',   coalesce(public.reserva_hhmm_a_minutos('9:00')::text, 'null'), 'null'),
    ('A8 hhmm 24:00',  coalesce(public.reserva_hhmm_a_minutos('24:00')::text, 'null'), 'null');
  insert into b1_res (caso, obtenido, esperado)
  select 'A9 checks de Mensualidades en múltiplo de 5', count(*)::text, '5'
    from pg_constraint
   where connamespace = 'public'::regnamespace
     and conname in ('mensualidades_saldo_chk', 'mensualidad_mov_minutos_chk', 'mensualidad_mov_saldos_chk',
                     'mensualidad_compras_minutos_chk', 'reservas_mensualidad_chk')
     and pg_get_constraintdef(oid) like '%\% 5)%' escape '\'
     and pg_get_constraintdef(oid) not like '%\% 15)%' escape '\';
  insert into b1_res (caso, obtenido, esperado)
  select 'A10 los checks de PLANES siguen en múltiplo de 15 (no se tocan)', count(*)::text, '2'
    from pg_constraint
   where connamespace = 'public'::regnamespace
     and conname in ('mensualidad_planes_minutos_chk', 'mensualidad_compras_plan_min_chk')
     and pg_get_constraintdef(oid) like '%\% 15)%' escape '\';
  insert into b1_res (caso, obtenido, esperado)
  select 'A11 mensualidad_admin_ajustar_saldo sigue exigiendo múltiplo de 15',
         (pg_get_functiondef('public.mensualidad_admin_ajustar_saldo(uuid,text,integer,text,text,text,text)'::regprocedure)
            like '%minutos_no_multiplo_15%')::text, 'true';

  -- ── B · Sin backfill y datos existentes válidos (tests 10, 11, 12) ───────
  -- Se miden ANTES de crear cualquier fixture.
  insert into b1_res (caso, obtenido, esperado)
  select 'B1 reservas con modalidad (sin backfill)', count(*)::text, '0' from public.reservas where modalidad is not null;
  insert into b1_res (caso, obtenido, esperado)
  select 'B2 slots con ocupacion_min (sin backfill)', count(*)::text, '0' from public.reserva_slots where ocupacion_min is not null;
  insert into b1_res (caso, obtenido, esperado)
  select 'B3 turnos_stand con modalidad (sin backfill)', count(*)::text, '0' from public.turnos_stand where modalidad is not null;
  insert into b1_res (caso, obtenido, esperado)
  select 'B4 precios especiales con 10/20 cargados', count(*)::text, '0'
    from public.reservas_precios_especiales where precio_10 is not null or precio_20 is not null;
  insert into b1_res (caso, obtenido, esperado)
  select 'B5 override arranca en NULL', count(*)::text, '1'
    from public.modalidad_comercial_config where id = 1 and modalidad_override is null;
  insert into b1_res (caso, obtenido, esperado)
  select 'B6 mensualidades existentes cumplen el check nuevo', count(*)::text, '0'
    from public.mensualidades where not (saldo_minutos >= 0 and saldo_minutos % 5 = 0);
  insert into b1_res (caso, obtenido, esperado)
  select 'B7 mensualidad_planes.precio sin cambios (30.000 / 55.000 / 100.000)',
         string_agg(slug || '=' || precio::integer, ',' order by minutos), '1h=30000,2h=55000,4h=100000'
    from public.mensualidad_planes where slug in ('1h', '2h', '4h');

  -- ── C · Matriz legacy: mismo resultado que el trigger anterior (test 13) ─
  insert into public.reservas
    (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
     acepto_condiciones, duracion_minutos, origen) overriding system value
  values
    (-910001, 'ZZ_B1_MATRIZ', '0000000000', v_f1, '10:00', '["Ferrari"]', 1, 0, 'activa', true, 15, 'web'),
    (-910002, 'ZZ_B1_MATRIZ', '0000000000', v_f2, '10:00', '["Ferrari"]', 1, 0, 'activa', true, 15, 'web'),
    (-910003, 'ZZ_B1_MATRIZ', '0000000000', v_fp, '10:00', '["Ferrari"]', 1, 0, 'activa', true, 15, 'web');
  insert into public.bloqueos_reservas
    (id, fecha, todo_el_dia, hora_inicio, hora_fin, simulador, motivo, activo) overriding system value
  values
    (-910101, v_f1::date, false, '12:00', '13:00', null,      'ZZ_B1', true),
    (-910102, v_f1::date, false, '16:00', '16:40', 'McLaren', 'ZZ_B1', true),
    (-910103, v_f2::date, true,  null,    null,    'Alpine',  'ZZ_B1', true),
    (-910104, v_f1::date, false, '18:00', '19:00', null,      'ZZ_B1', false),
    (-910105, v_fp::date, false, '12:00', '13:00', null,      'ZZ_B1', true);

  v_firma := 'c01=' || pg_temp.b1_legacy(-910201, -910001, v_f1, '11:40', 'Ferrari');
  v_firma := v_firma || '|c02=' || pg_temp.b1_legacy(-910202, -910001, v_f1, '12:00', 'Ferrari');
  v_firma := v_firma || '|c03=' || pg_temp.b1_legacy(-910203, -910001, v_f1, '12:40', 'Red Bull');
  v_firma := v_firma || '|c04=' || pg_temp.b1_legacy(-910204, -910001, v_f1, '13:00', 'Red Bull');
  v_firma := v_firma || '|c05=' || pg_temp.b1_legacy(-910205, -910001, v_f1, '13:20', 'Ferrari');
  v_firma := v_firma || '|c06=' || pg_temp.b1_legacy(-910206, -910001, v_f1, '16:00', 'McLaren');
  v_firma := v_firma || '|c07=' || pg_temp.b1_legacy(-910207, -910001, v_f1, '16:00', 'Ferrari');
  v_firma := v_firma || '|c08=' || pg_temp.b1_legacy(-910208, -910001, v_f1, '16:40', 'McLaren');
  v_firma := v_firma || '|c09=' || pg_temp.b1_legacy(-910209, -910001, v_f1, '17:00', 'McLaren');
  v_firma := v_firma || '|c10=' || pg_temp.b1_legacy(-910210, -910001, v_f1, '18:20', 'Alpine');
  v_firma := v_firma || '|c11=' || pg_temp.b1_legacy(-910211, -910002, v_f2, '10:00', 'Alpine');
  v_firma := v_firma || '|c12=' || pg_temp.b1_legacy(-910212, -910002, v_f2, '10:00', 'Ferrari');
  v_firma := v_firma || '|c13=' || pg_temp.b1_legacy(-910213, -910001, v_f1, '11:40', 'Ferrari');
  v_firma := v_firma || '|c14=' || pg_temp.b1_legacy(-910214, -910003, v_fp, '12:00', 'Ferrari');
  v_firma := v_firma || '|c15=' || pg_temp.b1_legacy(-910215, -910001, v_f1, '12:00', 'Red Bull', 'cancelada');
  v_firma := v_firma || '|c16=' || pg_temp.b1_legacy(-910216, -910001, v_f1, '9:00',  'Ferrari');
  v_firma := v_firma || '|c17=' || pg_temp.b1_legacy(-910217, -910001, v_f1, '14:10', 'Ferrari');
  v_firma := v_firma || '|c18=' || pg_temp.b1_legacy(-910218, -910001, v_f1, '14:00', 'Ferrari');
  insert into b1_res (caso, obtenido, esperado)
  values ('C1 matriz legacy idéntica a la del trigger anterior', v_firma, v_esperada);

  -- ── D · Solapamiento v2 y convivencia legacy/v2 (tests 14, 15, 16) ────────
  insert into public.reservas
    (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
     acepto_condiciones, duracion_minutos, origen) overriding system value
  values
    (-920001, 'ZZ_B1_V2', '0000000000', v_f3, '12:00', '["Ferrari"]', 1, 0, 'activa', true, 20, 'web'),
    (-920002, 'ZZ_B1_V2', '0000000000', v_f4, '12:00', '["Ferrari"]', 1, 0, 'activa', true, 20, 'web'),
    (-920003, 'ZZ_B1_V2', '0000000000', v_fp, '12:00', '["Ferrari"]', 1, 0, 'activa', true, 20, 'web');

  insert into b1_res (caso, obtenido, esperado) values
    ('D01 v2 12:00 +30 Ferrari', pg_temp.b1_slot(-920201, -920001, v_f3, '12:00', 'Ferrari', 30), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D02 [14] v2 12:20 pisa 12:00-12:30 aunque el inicio sea distinto',
     pg_temp.b1_slot(-920202, -920001, v_f3, '12:20', 'Ferrari', 30), '23505:reserva_slots_activa_uq%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D03 [15] v2 12:30 justo al terminar 12:00-12:30', pg_temp.b1_slot(-920203, -920001, v_f3, '12:30', 'Ferrari', 20), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D04 v2 12:10 +10 adentro de 12:00-12:30', pg_temp.b1_slot(-920204, -920001, v_f3, '12:10', 'Ferrari', 10), '23505%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D05 v2 12:00 en OTRO simulador', pg_temp.b1_slot(-920205, -920001, v_f3, '12:00', 'McLaren', 30), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D06 legacy 14:00 Red Bull', pg_temp.b1_legacy(-920206, -920001, v_f3, '14:00', 'Red Bull'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D07 [16] v2 14:10 pisa el bloque legacy 14:00-14:20',
     pg_temp.b1_slot(-920207, -920001, v_f3, '14:10', 'Red Bull', 20), '23505:reserva_slots_activa_uq%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D08 [16] v2 13:40-14:00 toca el inicio legacy sin pisarlo', pg_temp.b1_slot(-920208, -920001, v_f3, '13:40', 'Red Bull', 20), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D09 [16] v2 14:20 justo al terminar el bloque legacy', pg_temp.b1_slot(-920209, -920001, v_f3, '14:20', 'Red Bull', 20), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D10 v2 15:00 +40 Alpine', pg_temp.b1_slot(-920210, -920001, v_f3, '15:00', 'Alpine', 40), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D11 [16] legacy 15:20 pisa la ocupación v2 15:00-15:40', pg_temp.b1_legacy(-920211, -920001, v_f3, '15:20', 'Alpine'), '23505');
  insert into b1_res (caso, obtenido, esperado) values
    ('D12 [16] legacy 15:40 justo al terminar la v2', pg_temp.b1_legacy(-920212, -920001, v_f3, '15:40', 'Alpine'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D13 [16] legacy 14:40-15:00 termina donde empieza la v2', pg_temp.b1_legacy(-920213, -920001, v_f3, '14:40', 'Alpine'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D14 legacy CANCELADA 16:00', pg_temp.b1_legacy(-920214, -920001, v_f3, '16:00', 'Ferrari', 'cancelada'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D15 v2 16:00 sobre una fila cancelada (no ocupa)', pg_temp.b1_slot(-920215, -920001, v_f3, '16:00', 'Ferrari', 20), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D16 v2 mismo inicio que otra v2', pg_temp.b1_slot(-920216, -920001, v_f3, '12:00', 'Ferrari', 20), '23505%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D17 v2 con hora no HH:MM', pg_temp.b1_slot(-920217, -920001, v_f3, '9:00', 'Ferrari', 20), '22023:hora_invalida%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D18 ocupacion_min 0', pg_temp.b1_slot(-920218, -920001, v_f3, '20:00', 'Ferrari', 0), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D19 ocupacion_min 23 (no múltiplo de 5)', pg_temp.b1_slot(-920219, -920001, v_f3, '20:00', 'Ferrari', 23), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D20 ocupacion_min 725 (más de 12 h)', pg_temp.b1_slot(-920220, -920001, v_f3, '20:00', 'Ferrari', 725), '23514%');

  -- Bloqueos con filas v2 (y legacy, que no cambian).
  insert into public.bloqueos_reservas
    (id, fecha, todo_el_dia, hora_inicio, hora_fin, simulador, motivo, activo) overriding system value
  values
    (-920101, v_f4::date, false, '18:00', '18:30', null,      'ZZ_B1', true),
    (-920102, v_f4::date, true,  null,    null,    'McLaren', 'ZZ_B1', true);
  insert into b1_res (caso, obtenido, esperado) values
    ('D21 v2 17:40-18:00 termina justo donde empieza el bloqueo', pg_temp.b1_slot(-920301, -920002, v_f4, '17:40', 'Ferrari', 20), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D22 v2 17:40-18:10 se mete en el bloqueo', pg_temp.b1_slot(-920302, -920002, v_f4, '17:40', 'Red Bull', 30), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D23 v2 que EMPIEZA en hora_fin (inclusivo, como legacy)', pg_temp.b1_slot(-920303, -920002, v_f4, '18:30', 'Alpine', 20), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D24 v2 después del bloqueo', pg_temp.b1_slot(-920304, -920002, v_f4, '18:40', 'Alpine', 20), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D25 v2 en simulador bloqueado todo el día', pg_temp.b1_slot(-920305, -920002, v_f4, '10:00', 'McLaren', 20), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('D26 legacy 18:20 dentro del bloqueo (igual que antes)', pg_temp.b1_legacy(-920306, -920002, v_f4, '18:20', 'Ferrari'), '23514');
  insert into b1_res (caso, obtenido, esperado) values
    ('D27 legacy 17:40 (el inicio no está en el tramo: igual que antes)', pg_temp.b1_legacy(-920307, -920002, v_f4, '17:40', 'Alpine'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D28 v2 con bloqueo VENCIDO (se ignora)', pg_temp.b1_slot(-920308, -920003, v_fp, '12:00', 'Red Bull', 20), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('D29 v2 con bloqueo INACTIVO (se ignora)', pg_temp.b1_slot(-920309, -910001, v_f1, '18:00', 'Red Bull', 20), 'ok');

  -- ── E · Mensualidades (tests 17 y 18) ───────────────────────────────────
  insert into public.mensualidades
    (codigo, titular_nombre, titular_apellido, titular_telefono, telefono_norm, titular_email,
     saldo_minutos, vence_el)
  values ('MEN-ZZZZ-ZZB2', 'ZZ', 'B1', '0000000000', '0000000000', 'zz.b1@test.local', 60, date '2099-12-31')
  returning id into v_mens;

  insert into b1_res (caso, obtenido, esperado) values
    ('E01 [17] saldo 60 − 20 = 40', pg_temp.b1_sql(format(
      'update public.mensualidades set saldo_minutos = 40 where id = %L', v_mens)), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('E02 [17] movimiento consumo −20 (60 → 40)', pg_temp.b1_sql(format(
      'insert into public.mensualidad_movimientos (mensualidad_id, tipo, minutos, saldo_anterior, saldo_posterior, actor)
       values (%L, ''consumo'', -20, 60, 40, ''titular'')', v_mens)), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('E03 [18] saldo híbrido 45 − 10 = 35', pg_temp.b1_sql(format(
      'update public.mensualidades set saldo_minutos = 35 where id = %L', v_mens)), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('E04 [18] movimiento consumo −10 (45 → 35)', pg_temp.b1_sql(format(
      'insert into public.mensualidad_movimientos (mensualidad_id, tipo, minutos, saldo_anterior, saldo_posterior, actor)
       values (%L, ''consumo'', -10, 45, 35, ''titular'')', v_mens)), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('E05 saldo 37 sigue rechazado', pg_temp.b1_sql(format(
      'update public.mensualidades set saldo_minutos = 37 where id = %L', v_mens)), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('E06 movimiento de −7 sigue rechazado', pg_temp.b1_sql(format(
      'insert into public.mensualidad_movimientos (mensualidad_id, tipo, minutos, saldo_anterior, saldo_posterior, actor)
       values (%L, ''consumo'', -7, 45, 38, ''titular'')', v_mens)), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('E07 movimiento incoherente (45 − 10 ≠ 30) sigue rechazado', pg_temp.b1_sql(format(
      'insert into public.mensualidad_movimientos (mensualidad_id, tipo, minutos, saldo_anterior, saldo_posterior, actor)
       values (%L, ''consumo'', -10, 45, 30, ''titular'')', v_mens)), '23514%');

  -- reservas_mensualidad_chk: 10/20 entran, 45 legacy sigue, 25 y 22 no.
  insert into b1_res (caso, obtenido, esperado) values
    ('E08 reserva de Mensualidad 20 min × 1 (consume 20)', pg_temp.b1_sql(format(
      'insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
         acepto_condiciones, duracion_minutos, origen, mensualidad_id, minutos_consumidos, cobertura,
         importe_complementario, condiciones_version, condiciones_at, referencia_publica) overriding system value
       values (-920401, ''ZZ'', ''0000000000'', %L, ''12:00'', ''["Ferrari"]'', 1, 0, ''activa'', true, 20,
         ''mensualidad'', %L, 20, ''saldo'', 0, ''b1'', now(), ''RES-ZZZZ-ZZB2'')', v_f3, v_mens)), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('E09 reserva de Mensualidad 10 min × 3 (consume 30)', pg_temp.b1_sql(format(
      'insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
         acepto_condiciones, duracion_minutos, origen, mensualidad_id, minutos_consumidos, cobertura,
         importe_complementario, condiciones_version, condiciones_at, referencia_publica) overriding system value
       values (-920402, ''ZZ'', ''0000000000'', %L, ''12:00'', ''["Ferrari","McLaren","Alpine"]'', 3, 0, ''activa'', true, 10,
         ''mensualidad'', %L, 30, ''saldo'', 0, ''b1'', now(), ''RES-ZZZZ-ZZB3'')', v_f3, v_mens)), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('E10 reserva de Mensualidad legacy 45 min sigue válida', pg_temp.b1_sql(format(
      'insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
         acepto_condiciones, duracion_minutos, origen, mensualidad_id, minutos_consumidos, cobertura,
         importe_complementario, condiciones_version, condiciones_at, referencia_publica) overriding system value
       values (-920403, ''ZZ'', ''0000000000'', %L, ''12:00'', ''["Ferrari"]'', 1, 0, ''activa'', true, 45,
         ''mensualidad'', %L, 45, ''saldo'', 0, ''b1'', now(), ''RES-ZZZZ-ZZB4'')', v_f3, v_mens)), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('E11 duración 25 en Mensualidad sigue rechazada', pg_temp.b1_sql(format(
      'insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
         acepto_condiciones, duracion_minutos, origen, mensualidad_id, minutos_consumidos, cobertura,
         importe_complementario, condiciones_version, condiciones_at, referencia_publica) overriding system value
       values (-920404, ''ZZ'', ''0000000000'', %L, ''12:00'', ''["Ferrari"]'', 1, 0, ''activa'', true, 25,
         ''mensualidad'', %L, 25, ''saldo'', 0, ''b1'', now(), ''RES-ZZZZ-ZZB5'')', v_f3, v_mens)), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('E12 minutos consumidos 22 siguen rechazados', pg_temp.b1_sql(format(
      'insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
         acepto_condiciones, duracion_minutos, origen, mensualidad_id, minutos_consumidos, cobertura,
         importe_complementario, condiciones_version, condiciones_at, referencia_publica) overriding system value
       values (-920405, ''ZZ'', ''0000000000'', %L, ''12:00'', ''["Ferrari"]'', 1, 0, ''activa'', true, 20,
         ''mensualidad'', %L, 22, ''saldo'', 0, ''b1'', now(), ''RES-ZZZZ-ZZB6'')', v_f3, v_mens)), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('E13 reserva web con minutos de Mensualidad sigue rechazada (brazo ELSE intacto)', pg_temp.b1_sql(format(
      'insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
         acepto_condiciones, duracion_minutos, origen, minutos_consumidos) overriding system value
       values (-920406, ''ZZ'', ''0000000000'', %L, ''12:00'', ''["Ferrari"]'', 1, 0, ''activa'', true, 20,
         ''web'', 20)', v_f3)), '23514%');

  -- mensualidad_compras: 35 trasladados entra; 65 (> 60) y 37 no.
  insert into b1_res (caso, obtenido, esperado) values
    ('E14 compra con 35 trasladados y saldo 95', pg_temp.b1_sql(
      'insert into public.mensualidad_compras (plan_slug, plan_nombre, plan_minutos, plan_precio, plan_vigencia_dias,
         comprador_nombre, comprador_apellido, comprador_telefono, telefono_norm, comprador_email, importe_bruto,
         minutos_trasladados, minutos_descartados, saldo_resultante)
       values (''1h'', ''1 hora'', 60, 30000, 30, ''ZZ'', ''B1'', ''0000000000'', ''0000000000'', ''zz.b1@test.local'', 30000,
         35, 5, 95)'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('E15 compra con 65 trasladados sigue rechazada (tope 60)', pg_temp.b1_sql(
      'insert into public.mensualidad_compras (plan_slug, plan_nombre, plan_minutos, plan_precio, plan_vigencia_dias,
         comprador_nombre, comprador_apellido, comprador_telefono, telefono_norm, comprador_email, importe_bruto,
         minutos_trasladados)
       values (''1h'', ''1 hora'', 60, 30000, 30, ''ZZ'', ''B1'', ''0000000000'', ''0000000000'', ''zz.b1@test.local'', 30000, 65)'), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('E16 compra con saldo resultante 37 sigue rechazada', pg_temp.b1_sql(
      'insert into public.mensualidad_compras (plan_slug, plan_nombre, plan_minutos, plan_precio, plan_vigencia_dias,
         comprador_nombre, comprador_apellido, comprador_telefono, telefono_norm, comprador_email, importe_bruto,
         saldo_resultante)
       values (''1h'', ''1 hora'', 60, 30000, 30, ''ZZ'', ''B1'', ''0000000000'', ''0000000000'', ''zz.b1@test.local'', 30000, 37)'), '23514%');

  -- La RPC operativa de ajuste NO cambió: sigue exigiendo múltiplo de 15.
  insert into b1_res (caso, obtenido, esperado) values
    ('E17 mensualidad_admin_ajustar_saldo sigue rechazando 20', pg_temp.b1_sql(format(
      'select * from public.mensualidad_admin_ajustar_saldo(%L, ''descontar'', 20, ''b1 verificacion'', ''admin'', ''admin'', ''b1_verif_ajuste_0001'')',
      v_mens)), '22023:%minutos_no_multiplo_15%');

  -- Flujo LEGACY real de reservar y cancelar con saldo, en una fecha de la
  -- ventana (hoy + 15). Sigue aceptando 15, sigue rechazando 20 y sus slots
  -- quedan legacy (ocupacion_min NULL). Se revierte con todo el bloque.
  update public.mensualidades set saldo_minutos = 60 where id = v_mens;
  v_fecha := public.mensualidad_hoy() + 15;
  select s into v_sim
    from unnest(array['Ferrari', 'McLaren', 'Red Bull', 'Alpine']) as s
   where not exists (select 1 from public.reserva_slots x
                      where x.fecha = v_fecha::text and x.estado = 'activa' and x.simulador = s
                        and x.hora in ('09:40', '10:00'))
   limit 1;
  if v_sim is null then
    insert into b1_res (caso, obtenido, esperado) values ('E18 flujo legacy de Mensualidad', 'omitido: sin simulador libre a las 10:00', 'omitido%');
  else
    insert into b1_res (caso, obtenido, esperado) values
      ('E18 RPC legacy acepta 15 min', pg_temp.b1_sql(format(
        'select * from public.crear_reserva_mensualidad(%L, %L, ''10:00'', 15, array[%L], array[''10:00''], ''b1_verif_reserva_0001'', ''b1-verif'')',
        v_mens, v_fecha, v_sim)), 'ok');
    insert into b1_res (caso, obtenido, esperado)
    select 'E19 saldo 60 → 45 tras la reserva legacy', saldo_minutos::text, '45' from public.mensualidades where id = v_mens;
    insert into b1_res (caso, obtenido, esperado)
    select 'E20 el slot creado por la RPC queda legacy (ocupacion_min NULL)',
           count(*)::text, '1'
      from public.reserva_slots s join public.reservas r on r.id = s.reserva_id
     where r.idempotency_key = 'b1_verif_reserva_0001' and s.estado = 'activa' and s.ocupacion_min is null;
    insert into b1_res (caso, obtenido, esperado) values
      ('E21 RPC legacy sigue rechazando 20 min', pg_temp.b1_sql(format(
        'select * from public.crear_reserva_mensualidad(%L, %L, ''10:00'', 20, array[%L], array[''10:00''], ''b1_verif_reserva_0002'', ''b1-verif'')',
        v_mens, v_fecha, v_sim)), '22023:%duracion_invalida%');
    select r.referencia_publica into v_ref from public.reservas r where r.idempotency_key = 'b1_verif_reserva_0001';
    insert into b1_res (caso, obtenido, esperado) values
      ('E22 cancelar con 24 h o más restituye', pg_temp.b1_sql(format(
        'select * from public.cancelar_reserva_mensualidad(%L, %L, ''b1_verif_cancel_0001'', ''titular'')', v_mens, v_ref)), 'ok');
    insert into b1_res (caso, obtenido, esperado)
    select 'E23 saldo vuelve a 60', saldo_minutos::text, '60' from public.mensualidades where id = v_mens;
  end if;

  -- ── F · Precios especiales (test 19) ────────────────────────────────────
  insert into b1_res (caso, obtenido, esperado) values
    ('F1 solo precio_10', pg_temp.b1_sql('insert into public.reservas_precios_especiales (fecha, precio_10) values (''2099-02-01'', 11000)'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('F2 solo precio_20', pg_temp.b1_sql('insert into public.reservas_precios_especiales (fecha, precio_20) values (''2099-02-02'', 18000)'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('F3 sin ningún precio sigue rechazado', pg_temp.b1_sql('insert into public.reservas_precios_especiales (fecha) values (''2099-02-03'')'), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('F4 precio_10 negativo rechazado', pg_temp.b1_sql('insert into public.reservas_precios_especiales (fecha, precio_10) values (''2099-02-04'', -1)'), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('F5 forma legacy 15/30 sigue entrando', pg_temp.b1_sql('insert into public.reservas_precios_especiales (fecha, precio_15, precio_30) values (''2099-02-05'', 13000, 21000)'), 'ok');
  insert into b1_res (caso, obtenido, esperado) values
    ('F6 solo precio_30 (compartido)', pg_temp.b1_sql('insert into public.reservas_precios_especiales (fecha, precio_30) values (''2099-02-06'', 25000)'), 'ok');

  -- ── G · Override (test 20) ──────────────────────────────────────────────
  insert into b1_res (caso, obtenido, esperado) values
    ('G1 staff no puede cambiar el override', pg_temp.b1_sql(
      'select * from public.modalidad_comercial_set_override(''legacy'', ''b1'', ''staff'', ''staff'')'), '42501:rol_no_autorizado%');
  insert into b1_res (caso, obtenido, esperado) values
    ('G2 motivo vacío rechazado', pg_temp.b1_sql(
      'select * from public.modalidad_comercial_set_override(''legacy'', ''  '', ''admin'', ''admin'')'), '22023:motivo_requerido%');
  insert into b1_res (caso, obtenido, esperado) values
    ('G3 modalidad desconocida rechazada', pg_temp.b1_sql(
      'select * from public.modalidad_comercial_set_override(''v3'', ''b1'', ''admin'', ''admin'')'), '22023:override_invalido%');
  insert into b1_res (caso, obtenido, esperado) values
    ('G4 actor vacío rechazado', pg_temp.b1_sql(
      'select * from public.modalidad_comercial_set_override(''legacy'', ''b1'', '''', ''admin'')'), '22023:actor_requerido%');
  insert into b1_res (caso, obtenido, esperado) values
    ('G5 motivo de 501 caracteres rechazado', pg_temp.b1_sql(format(
      'select * from public.modalidad_comercial_set_override(''legacy'', %L, ''admin'', ''admin'')', repeat('x', 501))),
     '22023:motivo_demasiado_largo%');
  insert into b1_res (caso, obtenido, esperado) values
    ('G6 admin fuerza legacy', pg_temp.b1_sql(
      'select * from public.modalidad_comercial_set_override(''legacy'', ''b1 verificacion'', ''admin'', ''admin'')'), 'ok');
  insert into b1_res (caso, obtenido, esperado)
  select 'G7 el override quedó en legacy con motivo y actor',
         coalesce(modalidad_override, 'null') || '|' || motivo || '|' || actualizado_por, 'legacy|b1 verificacion|admin'
    from public.modalidad_comercial_config where id = 1;
  insert into b1_res (caso, obtenido, esperado) values
    ('G8 admin vuelve al calendario (NULL)', pg_temp.b1_sql(
      'select * from public.modalidad_comercial_set_override(null, ''b1 volver'', ''admin'', ''admin'')'), 'ok');
  insert into b1_res (caso, obtenido, esperado)
  select 'G9 el override volvió a NULL', coalesce(modalidad_override, 'null'), 'null'
    from public.modalidad_comercial_config where id = 1;
  insert into b1_res (caso, obtenido, esperado) values
    ('G10 no puede haber una segunda fila', pg_temp.b1_sql(
      'insert into public.modalidad_comercial_config (id, modalidad_override) values (2, null)'), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('G11 un valor desconocido no entra ni por UPDATE directo', pg_temp.b1_sql(
      'update public.modalidad_comercial_config set modalidad_override = ''v3'' where id = 1'), '23514%');
  insert into b1_res (caso, obtenido, esperado) values
    ('G12 anon no lee la configuración', has_table_privilege('anon', 'public.modalidad_comercial_config', 'select')::text, 'false'),
    ('G13 authenticated no la lee', has_table_privilege('authenticated', 'public.modalidad_comercial_config', 'select')::text, 'false'),
    ('G14 anon no ejecuta la RPC',
     has_function_privilege('anon', 'public.modalidad_comercial_set_override(text,text,text,text)', 'execute')::text, 'false'),
    ('G15 service_role sí ejecuta la RPC',
     has_function_privilege('service_role', 'public.modalidad_comercial_set_override(text,text,text,text)', 'execute')::text, 'true'),
    ('G16 anon no lee los precios versionados', has_table_privilege('anon', 'public.mensualidad_plan_precios', 'select')::text, 'false');
  insert into b1_res (caso, obtenido, esperado)
  select 'G17 RLS activo en las dos tablas nuevas', count(*)::text, '2'
    from pg_class where relname in ('modalidad_comercial_config', 'mensualidad_plan_precios') and relrowsecurity;

  -- ── H · Precios de planes versionados ───────────────────────────────────
  insert into b1_res (caso, obtenido, esperado)
  select 'H1 seis versiones cargadas', count(*)::text, '6' from public.mensualidad_plan_precios;
  insert into b1_res (caso, obtenido, esperado)
  select 'H2 la versión vigente hoy es el precio actual de mensualidad_planes', count(*)::text, '3'
    from public.mensualidad_planes p
   where p.slug in ('1h', '2h', '4h')
     and p.precio = (select v.precio from public.mensualidad_plan_precios v
                      where v.plan_id = p.id and v.vigente_desde <= now()
                      order by v.vigente_desde desc limit 1);
  insert into b1_res (caso, obtenido, esperado)
  select 'H3 desde el corte: 38.000 / 70.000 / 128.000',
         string_agg(p.slug || '=' || v.precio::integer, ',' order by p.minutos), '1h=38000,2h=70000,4h=128000'
    from public.mensualidad_plan_precios v join public.mensualidad_planes p on p.id = v.plan_id
   where v.vigente_desde = timestamptz '2026-10-01 00:00:00-03';
  insert into b1_res (caso, obtenido, esperado)
  select 'H4 el precio nuevo NO rige un milisegundo antes del corte', count(*)::text, '3'
    from public.mensualidad_planes p
   where p.slug in ('1h', '2h', '4h')
     and p.precio = (select v.precio from public.mensualidad_plan_precios v
                      where v.plan_id = p.id
                        and v.vigente_desde <= timestamptz '2026-10-01 00:00:00-03' - interval '1 millisecond'
                      order by v.vigente_desde desc limit 1);
  insert into b1_res (caso, obtenido, esperado) values
    ('H5 no se puede duplicar una versión', pg_temp.b1_sql(
      'insert into public.mensualidad_plan_precios (plan_id, precio, vigente_desde)
       select plan_id, precio, vigente_desde from public.mensualidad_plan_precios limit 1'), '23505%');
  insert into b1_res (caso, obtenido, esperado) values
    ('H6 precio 0 rechazado', pg_temp.b1_sql(
      'insert into public.mensualidad_plan_precios (plan_id, precio, vigente_desde)
       select id, 0, now() from public.mensualidad_planes limit 1'), '23514%');

  -- ── Resultado (siempre revierte) ────────────────────────────────────────
  select count(*),
         string_agg(format('%s → esperaba [%s] y dio [%s]', caso, esperado, obtenido), ' ; ' order by orden)
    into v_fallas, v_detalle
    from b1_res where obtenido is null or not (obtenido like esperado);
  select count(*) into v_total from b1_res;
  if v_fallas > 0 then
    raise exception 'B1_FALLA % de % chequeos: %', v_fallas, v_total, v_detalle;
  end if;
  raise exception 'B1_VERIFICACION_OK % chequeos', v_total;
  -- <<FIN_BODY>>
end
$verif$;

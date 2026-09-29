-- ════════════════════════════════════════════════════════════════════════════
-- Modalidad comercial · B1 — MATRIZ LEGACY de inserción de slots
-- ════════════════════════════════════════════════════════════════════════════
--
-- Prueba de equivalencia del trigger trg_reserva_slot_bloqueo para filas
-- LEGACY. Se corre ANTES de aplicar db/modalidad-comercial-b1.sql y DESPUÉS:
-- las dos corridas tienen que devolver la MISMA firma. No usa ninguna columna ni
-- función nueva, así que sirve con el esquema viejo y con el nuevo.
--
-- NO DEJA NADA: todo pasa dentro de un único bloque que termina SIEMPRE con
-- RAISE EXCEPTION, así que la transacción entera se revierte (fixtures, slots y
-- la función temporal). Los ids son negativos y explícitos (OVERRIDING SYSTEM
-- VALUE): no consumen las secuencias reales. Las fechas son de 2099 y del año
-- 2000, fuera de toda operación real.
--
-- Ejecutar en el editor SQL de Supabase (o con execute_sql). El resultado
-- llega como ERROR a propósito: 'B1_MATRIZ_LEGACY c01=ok|c02=23514|…'.
-- ════════════════════════════════════════════════════════════════════════════

do $matriz$
declare
  f1 constant text := '2099-01-05';
  f2 constant text := '2099-01-06';
  fp constant text := '2000-01-03';
  firma text := '';
begin
  perform set_config('lock_timeout', '5s', true);

  -- Intenta insertar UN slot legacy y devuelve 'ok' o el SQLSTATE del rechazo.
  -- El EXCEPTION abre un subtransacción: un rechazo no arrastra al resto.
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

  -- Reservas contenedoras (solo por la FK de reserva_slots).
  insert into public.reservas
    (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,
     acepto_condiciones, duracion_minutos, origen) overriding system value
  values
    (-910001, 'ZZ_B1_MATRIZ', '0000000000', f1, '10:00', '["Ferrari"]', 1, 0, 'activa', true, 15, 'web'),
    (-910002, 'ZZ_B1_MATRIZ', '0000000000', f2, '10:00', '["Ferrari"]', 1, 0, 'activa', true, 15, 'web'),
    (-910003, 'ZZ_B1_MATRIZ', '0000000000', fp, '10:00', '["Ferrari"]', 1, 0, 'activa', true, 15, 'web');

  -- Bloqueos de la matriz.
  insert into public.bloqueos_reservas
    (id, fecha, todo_el_dia, hora_inicio, hora_fin, simulador, motivo, activo) overriding system value
  values
    (-910101, f1::date, false, '12:00', '13:00', null,      'ZZ_B1', true),   -- parcial, todos
    (-910102, f1::date, false, '16:00', '16:40', 'McLaren', 'ZZ_B1', true),   -- parcial, un simulador
    (-910103, f2::date, true,  null,    null,    'Alpine',  'ZZ_B1', true),   -- todo el día, un simulador
    (-910104, f1::date, false, '18:00', '19:00', null,      'ZZ_B1', false),  -- inactivo
    (-910105, fp::date, false, '12:00', '13:00', null,      'ZZ_B1', true);   -- vencido

  -- Una sentencia por caso: el ORDEN importa (c13 repite c01, c18 convive con
  -- c17) y PostgreSQL no garantiza el orden de evaluación de argumentos.
  firma := 'c01=' || pg_temp.b1_legacy(-910201, -910001, f1, '11:40', 'Ferrari');
  firma := firma || '|c02=' || pg_temp.b1_legacy(-910202, -910001, f1, '12:00', 'Ferrari');
  firma := firma || '|c03=' || pg_temp.b1_legacy(-910203, -910001, f1, '12:40', 'Red Bull');
  firma := firma || '|c04=' || pg_temp.b1_legacy(-910204, -910001, f1, '13:00', 'Red Bull');
  firma := firma || '|c05=' || pg_temp.b1_legacy(-910205, -910001, f1, '13:20', 'Ferrari');
  firma := firma || '|c06=' || pg_temp.b1_legacy(-910206, -910001, f1, '16:00', 'McLaren');
  firma := firma || '|c07=' || pg_temp.b1_legacy(-910207, -910001, f1, '16:00', 'Ferrari');
  firma := firma || '|c08=' || pg_temp.b1_legacy(-910208, -910001, f1, '16:40', 'McLaren');
  firma := firma || '|c09=' || pg_temp.b1_legacy(-910209, -910001, f1, '17:00', 'McLaren');
  firma := firma || '|c10=' || pg_temp.b1_legacy(-910210, -910001, f1, '18:20', 'Alpine');     -- bloqueo inactivo
  firma := firma || '|c11=' || pg_temp.b1_legacy(-910211, -910002, f2, '10:00', 'Alpine');     -- todo el día
  firma := firma || '|c12=' || pg_temp.b1_legacy(-910212, -910002, f2, '10:00', 'Ferrari');
  firma := firma || '|c13=' || pg_temp.b1_legacy(-910213, -910001, f1, '11:40', 'Ferrari');    -- repite c01
  firma := firma || '|c14=' || pg_temp.b1_legacy(-910214, -910003, fp, '12:00', 'Ferrari');    -- bloqueo vencido
  firma := firma || '|c15=' || pg_temp.b1_legacy(-910215, -910001, f1, '12:00', 'Red Bull', 'cancelada');
  firma := firma || '|c16=' || pg_temp.b1_legacy(-910216, -910001, f1, '9:00',  'Ferrari');    -- hora no HH:MM
  firma := firma || '|c17=' || pg_temp.b1_legacy(-910217, -910001, f1, '14:10', 'Ferrari');    -- fuera de grilla
  firma := firma || '|c18=' || pg_temp.b1_legacy(-910218, -910001, f1, '14:00', 'Ferrari');    -- legacy vs legacy

  raise exception 'B1_MATRIZ_LEGACY %', firma;
end
$matriz$;

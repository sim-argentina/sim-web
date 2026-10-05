-- ============================================================================
-- ESCENARIO HISTÓRICO SINTÉTICO de IA SIM — familia TEST_IA_HIST_2026
-- ----------------------------------------------------------------------------
-- GENERADO por scripts/pruebas/generar-historico-ia.mjs. No editar a mano: ese
-- script declara los repartos y verifica TODA la aritmética del contrato antes
-- de emitir. Si una suma no cierra, no genera nada.
--
-- Para qué: las suites servidor5a, servidor5b, servidor5b1 y servidor5c
-- verificaban cifras del historial REAL de agosto y septiembre de 2026. Este
-- escenario las reproduce en la base LOCAL atravesando las mismas tablas fuente
-- y las mismas reglas de imputación:
--   turnero      → fecha de SERVICIO (turnos_stand.fecha)
--   reservas     → fecha de PAGO (reservas.created_at en hora Argentina)
--   campeonatos  → fecha de PAGO (campeonato_inscripciones.created_at)
--   manuales     → fecha contable (fin_movimientos.fecha + mes_contable)
--   actividad    → fecha de servicio y modalidad persistida de cada fila
--   cronograma   → jornadas del mes CONFIRMADO
--
-- No se insertan resultados: ni vistas, ni salidas de RPC, ni tablas derivadas,
-- ni mensajes de IA. Los totales aparecen al ejecutar las funciones y las
-- herramientas reales. scripts/pruebas/contrato-historico-ia.ts lo comprueba
-- contra el motor antes de dejar correr las suites.
--
-- Todo sintético: sin nombres, teléfonos, correos ni IDs de pago reales. Los
-- correos usan el dominio reservado @example.test.
--
-- Idempotente: borra su propia familia antes de insertar.
-- ============================================================================

-- Todo en UNA transacción. La guardia de abajo es la primera sentencia: si aborta, los
-- `delete` que siguen NO se ejecutan ni siquiera si psql corre sin ON_ERROR_STOP, porque
-- la transacción queda abortada y el commit se vuelve un rollback.
begin;

-- ── Guardia: esto NO se aplica a una base con datos reales ──────────────────
-- Segunda barrera, independiente del runner (que ya exige un destino loopback):
-- la base no puede tener historia fuera de agosto y septiembre de 2026, ni
-- reservas con correos que no sean del dominio de prueba. Producción tiene las
-- dos cosas, así que ahí esto aborta antes de escribir.
do $guardia$
begin
  if exists (select 1 from public.turnos_stand where fecha < date '2026-08-01' or fecha > date '2026-09-30') then
    raise exception 'FIXTURE_IA_HIST: la base tiene turnos del stand fuera de agosto y septiembre de 2026, parece una base con datos reales. El escenario histórico sintético solo se aplica a la base LOCAL de pruebas.';
  end if;
  if exists (select 1 from public.reservas where email is not null and email not like '%@example.test') then
    raise exception 'FIXTURE_IA_HIST: la base tiene reservas con correos que no son del dominio de prueba. Abortado.';
  end if;
end $guardia$;

-- ── Limpieza idempotente de la familia ─────────────────────────────────────
delete from public.campeonato_inscripciones where campeonato_id in (select id from public.campeonatos where nombre like 'TEST_IA_HIST_2026%');
delete from public.campeonatos where nombre like 'TEST_IA_HIST_2026%';
delete from public.reserva_slots where reserva_id in (select id from public.reservas where nombre like 'TEST_IA_HIST_2026%');
delete from public.reservas where nombre like 'TEST_IA_HIST_2026%';
delete from public.turnos_stand where nombre like 'TEST_IA_HIST_2026%';
delete from public.fin_movimientos where creado_por = 'TEST_IA_HIST_2026';
delete from public.cronograma_jornadas where dia_id in (select d.id from public.cronograma_dias d join public.cronograma_meses m on m.id = d.mes_id where m.anio = 2026 and m.mes in (8, 9));
delete from public.cronograma_dias where mes_id in (select id from public.cronograma_meses where anio = 2026 and mes in (8, 9));
delete from public.cronograma_meses where anio = 2026 and mes in (8, 9);

-- ── Turnero del stand ──────────────────────────────────────────────────────
-- Dos filas por día, la forma real de una jornada: una de 15 minutos y otra de 30.
-- `cantidad_turnos` expresa la cantidad del día, así el escenario son decenas de
-- filas y no miles, y la fórmula legacy se cumple en cada fila:
--   turnos = personas × (minutos / 15)   ·   minutos de actividad = turnos × 15
-- `modalidad` legacy, la vigente en esos meses (v2_10 arrancó el 01/10/2026).
insert into public.turnos_stand (nombre, fecha, hora, cantidad_turnos, cantidad_personas, cantidad_simuladores, cantidad_minutos, duracion_minutos, total, metodo_pago, estado, modalidad, observaciones) values
  ('TEST_IA_HIST_2026', '2026-08-01', '15:00', 38, 38, 38, 15, 15, 430000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-01', '18:00', 8, 4, 4, 30, 30, 90000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-02', '15:00', 39, 39, 39, 15, 15, 446000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-02', '18:00', 10, 5, 5, 30, 30, 114000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-03', '15:00', 15, 15, 15, 15, 15, 174000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-03', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-04', '15:00', 17, 17, 17, 15, 15, 194000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-04', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-05', '15:00', 20, 20, 20, 15, 15, 223000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-05', '18:00', 4, 2, 2, 30, 30, 45000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-06', '15:00', 22, 22, 22, 15, 15, 254000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-06', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-07', '15:00', 22, 22, 22, 15, 15, 251000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-07', '18:00', 6, 3, 3, 30, 30, 69000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-08', '15:00', 34, 34, 34, 15, 15, 389000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-08', '18:00', 8, 4, 4, 30, 30, 91000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-09', '15:00', 43, 43, 43, 15, 15, 487000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-09', '18:00', 10, 5, 5, 30, 30, 113000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-10', '15:00', 12, 12, 12, 15, 15, 135000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-10', '18:00', 4, 2, 2, 30, 30, 45000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-11', '15:00', 12, 12, 12, 15, 15, 138000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-11', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-12', '15:00', 14, 14, 14, 15, 15, 156000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-12', '18:00', 4, 2, 2, 30, 30, 44000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-13', '15:00', 15, 15, 15, 15, 15, 174000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-13', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-14', '15:00', 15, 15, 15, 15, 15, 174000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-14', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-15', '15:00', 64, 64, 64, 15, 15, 720000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-15', '18:00', 14, 7, 7, 30, 30, 158000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-16', '15:00', 38, 38, 38, 15, 15, 427000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-16', '18:00', 10, 5, 5, 30, 30, 113000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-17', '15:00', 22, 22, 22, 15, 15, 254000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-17', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-18', '15:00', 15, 15, 15, 15, 15, 174000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-18', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-19', '15:00', 22, 22, 22, 15, 15, 251000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-19', '18:00', 6, 3, 3, 30, 30, 69000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-20', '15:00', 22, 22, 22, 15, 15, 254000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-20', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-21', '15:00', 22, 22, 22, 15, 15, 247000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-21', '18:00', 6, 3, 3, 30, 30, 67000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-22', '15:00', 36, 36, 36, 15, 15, 409000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-22', '18:00', 8, 4, 4, 30, 30, 91000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-23', '15:00', 39, 39, 39, 15, 15, 440000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-23', '18:00', 8, 4, 4, 30, 30, 90000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-24', '15:00', 12, 12, 12, 15, 15, 135000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-24', '18:00', 4, 2, 2, 30, 30, 45000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-25', '15:00', 14, 14, 14, 15, 15, 156000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-25', '18:00', 4, 2, 2, 30, 30, 44000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-26', '15:00', 11, 11, 11, 15, 15, 127000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-26', '18:00', 2, 1, 1, 30, 30, 23000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-27', '15:00', 9, 9, 9, 15, 15, 98000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-27', '18:00', 2, 1, 1, 30, 30, 22000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-28', '15:00', 7, 7, 7, 15, 15, 79000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-28', '18:00', 2, 1, 1, 30, 30, 23000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-29', '15:00', 38, 38, 38, 15, 15, 430000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-29', '18:00', 8, 4, 4, 30, 30, 90000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-30', '15:00', 31, 31, 31, 15, 15, 350000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-30', '18:00', 8, 4, 4, 30, 30, 90000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-08-31', '15:00', 12, 12, 12, 15, 15, 113000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-08-31', '18:00', 2, 1, 1, 30, 30, 19000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-01', '15:00', 19, 19, 19, 15, 15, 214000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-01', '18:00', 6, 3, 3, 30, 30, 68000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-02', '15:00', 19, 19, 19, 15, 15, 222000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-02', '18:00', 6, 3, 3, 30, 30, 70000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-03', '15:00', 20, 20, 20, 15, 15, 231000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-03', '18:00', 6, 3, 3, 30, 30, 69000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-04', '15:00', 21, 21, 21, 15, 15, 241000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-04', '18:00', 6, 3, 3, 30, 30, 69000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-05', '15:00', 31, 31, 31, 15, 15, 361000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-05', '18:00', 8, 4, 4, 30, 30, 93000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-06', '15:00', 30, 30, 30, 15, 15, 349000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-06', '18:00', 8, 4, 4, 30, 30, 93000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-07', '15:00', 20, 20, 20, 15, 15, 227000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-07', '18:00', 4, 2, 2, 30, 30, 45000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-08', '15:00', 20, 20, 20, 15, 15, 235000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-08', '18:00', 4, 2, 2, 30, 30, 47000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-09', '15:00', 19, 19, 19, 15, 15, 222000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-09', '18:00', 6, 3, 3, 30, 30, 70000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-10', '15:00', 20, 20, 20, 15, 15, 235000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-10', '18:00', 4, 2, 2, 30, 30, 47000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-11', '15:00', 20, 20, 20, 15, 15, 231000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-11', '18:00', 6, 3, 3, 30, 30, 69000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-12', '15:00', 30, 30, 30, 15, 15, 341000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-12', '18:00', 8, 4, 4, 30, 30, 91000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-13', '15:00', 29, 29, 29, 15, 15, 332000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-13', '18:00', 8, 4, 4, 30, 30, 92000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-14', '15:00', 19, 19, 19, 15, 15, 218000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-14', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-15', '15:00', 20, 20, 20, 15, 15, 227000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-15', '18:00', 4, 2, 2, 30, 30, 45000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-16', '15:00', 20, 20, 20, 15, 15, 235000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-16', '18:00', 4, 2, 2, 30, 30, 47000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-17', '15:00', 19, 19, 19, 15, 15, 222000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-17', '18:00', 6, 3, 3, 30, 30, 70000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-18', '15:00', 20, 20, 20, 15, 15, 231000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-18', '18:00', 6, 3, 3, 30, 30, 69000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-19', '15:00', 28, 28, 28, 15, 15, 322000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-19', '18:00', 8, 4, 4, 30, 30, 92000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-20', '15:00', 27, 27, 27, 15, 15, 312000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-20', '18:00', 8, 4, 4, 30, 30, 92000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-21', '15:00', 18, 18, 18, 15, 15, 208000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-21', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-22', '15:00', 19, 19, 19, 15, 15, 218000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-22', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-23', '15:00', 20, 20, 20, 15, 15, 227000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-23', '18:00', 4, 2, 2, 30, 30, 45000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-24', '15:00', 20, 20, 20, 15, 15, 235000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-24', '18:00', 4, 2, 2, 30, 30, 47000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-25', '15:00', 19, 19, 19, 15, 15, 222000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-25', '18:00', 6, 3, 3, 30, 30, 70000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-26', '15:00', 26, 26, 26, 15, 15, 301000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-26', '18:00', 8, 4, 4, 30, 30, 93000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-27', '15:00', 26, 26, 26, 15, 15, 295000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-27', '18:00', 8, 4, 4, 30, 30, 91000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-28', '15:00', 17, 17, 17, 15, 15, 193000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-28', '18:00', 4, 2, 2, 30, 30, 45000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-29', '15:00', 17, 17, 17, 15, 15, 198000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-29', '18:00', 4, 2, 2, 30, 30, 46000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min'),
  ('TEST_IA_HIST_2026', '2026-09-30', '15:00', 17, 17, 17, 15, 15, 191000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 15 min'),
  ('TEST_IA_HIST_2026', '2026-09-30', '18:00', 4, 2, 2, 30, 30, 45000, 'efectivo', 'activo', 'legacy', 'TEST_IA_HIST_2026 jornada sintética de 30 min');

-- ── Reservas web ───────────────────────────────────────────────────────────
-- Imputan por fecha de PAGO (created_at); se les da la misma fecha de servicio para
-- que su actividad caiga en el mismo mes. Un simulador por reserva = una persona.
insert into public.reservas (nombre, apellido, email, telefono, fecha, hora, simuladores, cantidad_turnos, duracion_minutos, total, estado, origen, acepto_condiciones, modalidad, created_at) values
  ('TEST_IA_HIST_2026', 'Reserva 1', 'hist-1@example.test', '0000000000', '2026-08-16', '16:00', '["Ferrari"]'::jsonb, 2, 15, 50000, 'activa', 'web', true, 'legacy', '2026-08-16 16:00:00-03'),
  ('TEST_IA_HIST_2026', 'Reserva 2', 'hist-2@example.test', '0000000000', '2026-08-23', '16:00', '["Ferrari"]'::jsonb, 2, 15, 40000, 'activa', 'web', true, 'legacy', '2026-08-23 16:00:00-03'),
  ('TEST_IA_HIST_2026', 'Reserva 3', 'hist-3@example.test', '0000000000', '2026-08-30', '16:00', '["Ferrari"]'::jsonb, 2, 15, 36000, 'activa', 'web', true, 'legacy', '2026-08-30 16:00:00-03'),
  ('TEST_IA_HIST_2026', 'Reserva 4', 'hist-4@example.test', '0000000000', '2026-09-05', '16:00', '["Ferrari"]'::jsonb, 2, 15, 30000, 'activa', 'web', true, 'legacy', '2026-09-05 16:00:00-03'),
  ('TEST_IA_HIST_2026', 'Reserva 5', 'hist-5@example.test', '0000000000', '2026-09-19', '16:00', '["Ferrari"]'::jsonb, 2, 15, 26000, 'activa', 'web', true, 'legacy', '2026-09-19 16:00:00-03'),
  ('TEST_IA_HIST_2026', 'Reserva 6', 'hist-6@example.test', '0000000000', '2026-09-27', '16:00', '["Ferrari"]'::jsonb, 2, 15, 20000, 'activa', 'web', true, 'legacy', '2026-09-27 16:00:00-03');

-- ── Campeonatos ────────────────────────────────────────────────────────────
-- Un campeonato sintético con sus inscripciones PAGADAS, que imputan por fecha de
-- pago. Sin payment_id: no se inventan identificadores de Mercado Pago.
insert into public.campeonatos (nombre, estado, modalidad, precio_inscripcion, cupos_maximos, inscripcion_habilitada, fecha_inicio, fecha_fin)
values ('TEST_IA_HIST_2026 campeonato', 'finalizado', 'liga', 20000, 64, false, '2026-08-01', '2026-09-30');

insert into public.campeonato_inscripciones (campeonato_id, nombre, apellido, nombre_completo, telefono, dni, monto, estado_pago, metodo_pago, created_at)
select c.id, 'TEST_IA_HIST_2026', v.apellido, 'TEST_IA_HIST_2026' || ' ' || v.apellido, '0000000000', '', 20000, 'pagado', 'mercadopago', v.pago
from public.campeonatos c, (values
  ('Piloto sintetico 1', '2026-08-25 12:00:00-03'::timestamptz),
  ('Piloto sintetico 2', '2026-08-25 12:00:00-03'::timestamptz),
  ('Piloto sintetico 3', '2026-08-08 12:00:00-03'::timestamptz),
  ('Piloto sintetico 4', '2026-08-08 12:00:00-03'::timestamptz),
  ('Piloto sintetico 5', '2026-08-22 12:00:00-03'::timestamptz),
  ('Piloto sintetico 6', '2026-08-22 12:00:00-03'::timestamptz),
  ('Piloto sintetico 7', '2026-09-12 12:00:00-03'::timestamptz),
  ('Piloto sintetico 8', '2026-09-12 12:00:00-03'::timestamptz),
  ('Piloto sintetico 9', '2026-09-12 12:00:00-03'::timestamptz),
  ('Piloto sintetico 10', '2026-09-12 12:00:00-03'::timestamptz),
  ('Piloto sintetico 11', '2026-09-12 12:00:00-03'::timestamptz),
  ('Piloto sintetico 12', '2026-09-12 12:00:00-03'::timestamptz),
  ('Piloto sintetico 13', '2026-09-26 12:00:00-03'::timestamptz),
  ('Piloto sintetico 14', '2026-09-26 12:00:00-03'::timestamptz),
  ('Piloto sintetico 15', '2026-09-26 12:00:00-03'::timestamptz),
  ('Piloto sintetico 16', '2026-09-26 12:00:00-03'::timestamptz),
  ('Piloto sintetico 17', '2026-09-26 12:00:00-03'::timestamptz),
  ('Piloto sintetico 18', '2026-09-26 12:00:00-03'::timestamptz)
) as v(apellido, pago)
where c.nombre = 'TEST_IA_HIST_2026 campeonato';

-- ── Ingresos manuales ──────────────────────────────────────────────────────
-- tipo ingreso, sin financiamiento y sin ajuste inicial: así los toma la composición
-- canónica, imputados por mes contable.
insert into public.fin_movimientos (fecha, mes_contable, ambito, tipo, clasificacion, cuenta_origen_id, categoria_id, descripcion, monto, origen, creado_por)
select v.fecha::date, v.mes, 'sim', 'ingreso', 'ingreso',
       (select id from public.fin_cuentas where nombre = 'Mercado Pago' limit 1),
       (select id from public.fin_categorias where tipo = 'ingreso' order by nombre limit 1),
       v.detalle, v.monto, 'manual', 'TEST_IA_HIST_2026'
from (values
  ('2026-08-18', '2026-08', 'TEST_IA_HIST_2026 evento corporativo', 1500000),
  ('2026-08-26', '2026-08', 'TEST_IA_HIST_2026 convenio institucional', 1450000),
  ('2026-09-10', '2026-09', 'TEST_IA_HIST_2026 evento corporativo', 400000),
  ('2026-09-24', '2026-09', 'TEST_IA_HIST_2026 convenio institucional', 270000)
) as v(fecha, mes, detalle, monto);

-- ── Cronograma confirmado ──────────────────────────────────────────────────
-- Cada día abierto con una jornada que cubre toda la ventana operativa, así no quedan
-- huecos y el integrante de respaldo no suma minutos; algunos días llevan una segunda
-- jornada de tarde de otro integrante. Los integrantes se eligen por orden de nombre,
-- no por UUID: la configuración base del repositorio crea los tres.
insert into public.cronograma_meses (anio, mes, estado, apertura_default, cierre_default, confirmado_at) values
  (2026, 8, 'confirmado', '10:00', '22:00', '2026-07-31 12:00:00-03'),
  (2026, 9, 'confirmado', '10:00', '22:00', '2026-08-31 12:00:00-03');

insert into public.cronograma_dias (mes_id, fecha, cerrado, apertura, cierre)
select m.id, v.fecha::date, false, '10:00', '22:00'
from public.cronograma_meses m, (values
  ('2026-08-01', 8),
  ('2026-08-02', 8),
  ('2026-08-03', 8),
  ('2026-08-04', 8),
  ('2026-08-05', 8),
  ('2026-08-06', 8),
  ('2026-08-07', 8),
  ('2026-08-08', 8),
  ('2026-08-09', 8),
  ('2026-08-10', 8),
  ('2026-08-11', 8),
  ('2026-08-12', 8),
  ('2026-08-13', 8),
  ('2026-08-14', 8),
  ('2026-08-15', 8),
  ('2026-08-16', 8),
  ('2026-08-17', 8),
  ('2026-08-18', 8),
  ('2026-08-19', 8),
  ('2026-08-20', 8),
  ('2026-08-21', 8),
  ('2026-08-22', 8),
  ('2026-08-23', 8),
  ('2026-08-24', 8),
  ('2026-08-25', 8),
  ('2026-08-26', 8),
  ('2026-08-27', 8),
  ('2026-08-28', 8),
  ('2026-08-29', 8),
  ('2026-08-30', 8),
  ('2026-08-31', 8),
  ('2026-09-01', 9),
  ('2026-09-02', 9),
  ('2026-09-03', 9),
  ('2026-09-04', 9),
  ('2026-09-05', 9),
  ('2026-09-06', 9),
  ('2026-09-07', 9),
  ('2026-09-08', 9),
  ('2026-09-09', 9),
  ('2026-09-10', 9),
  ('2026-09-11', 9),
  ('2026-09-12', 9),
  ('2026-09-13', 9),
  ('2026-09-14', 9),
  ('2026-09-15', 9),
  ('2026-09-16', 9),
  ('2026-09-17', 9),
  ('2026-09-18', 9),
  ('2026-09-19', 9),
  ('2026-09-20', 9),
  ('2026-09-21', 9),
  ('2026-09-22', 9),
  ('2026-09-23', 9),
  ('2026-09-24', 9),
  ('2026-09-25', 9),
  ('2026-09-26', 9),
  ('2026-09-27', 9),
  ('2026-09-28', 9),
  ('2026-09-29', 9),
  ('2026-09-30', 9)
) as v(fecha, mes)
where m.anio = 2026 and m.mes = v.mes;

-- Jornada principal: 10:00–22:00 (720 min) en todos los días abiertos.
insert into public.cronograma_jornadas (dia_id, empleado_id, hora_inicio, hora_fin, activo)
select d.id, (select id from public.empleados where es_fallback = false and activo order by nombre_formal limit 1), '10:00', '22:00', true
from public.cronograma_dias d join public.cronograma_meses m on m.id = d.mes_id
where m.anio = 2026 and m.mes in (8, 9);

-- Segunda jornada de tarde: 16:00–22:00 (360 min) en los días declarados.
insert into public.cronograma_jornadas (dia_id, empleado_id, hora_inicio, hora_fin, activo)
select d.id, (select id from public.empleados where es_fallback = false and activo order by nombre_formal desc limit 1), '16:00', '22:00', true
from public.cronograma_dias d join public.cronograma_meses m on m.id = d.mes_id
where m.anio = 2026 and m.mes in (8, 9) and d.fecha in (
  '2026-08-07'::date, '2026-08-08'::date, '2026-08-14'::date, '2026-08-15'::date, '2026-08-21'::date, '2026-08-22'::date, '2026-08-29'::date, '2026-09-04'::date, '2026-09-05'::date, '2026-09-11'::date, '2026-09-12'::date, '2026-09-18'::date, '2026-09-19'::date, '2026-09-25'::date
);

-- Jornada corta de 185 minutos: cierra septiembre en 24.305 min = 405,08 h.
insert into public.cronograma_jornadas (dia_id, empleado_id, hora_inicio, hora_fin, activo)
select d.id, (select id from public.empleados where es_fallback = false and activo order by nombre_formal desc limit 1), '18:55', '22:00', true
from public.cronograma_dias d join public.cronograma_meses m on m.id = d.mes_id
where m.anio = 2026 and m.mes = 9 and d.fecha = '2026-09-26'::date;

commit;


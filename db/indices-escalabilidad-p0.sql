-- ============================================================================
-- Índices críticos de escalabilidad (P0) — SIM Argentina
-- ----------------------------------------------------------------------------
-- El proyecto NO tiene sistema de migraciones versionadas: ejecutar este archivo
-- MANUALMENTE en el SQL Editor de Supabase.
--
-- Es idempotente y seguro: usa CREATE INDEX IF NOT EXISTS, no borra ni modifica
-- datos y no altera ninguna restricción existente.
--
-- Estado verificado el 2026-07-03 (solo lectura, sin cambios aplicados):
--   reserva_slots(fecha,hora,simulador) UNIQUE  -> YA EXISTE  (reserva_slots_activa_uq)
--   reservas(fecha)                             -> FALTA      (lo crea este script)  <<<
--   turnos_stand(fecha)                         -> YA EXISTE  (turnos_stand_fecha_idx)
--   campeonato_registros(campeonato_fecha_id)   -> YA EXISTE  (campeonato_registros_fecha_id_idx)
--
-- Nota: en tablas grandes se puede usar CREATE INDEX CONCURRENTLY para evitar
-- bloqueos (no puede ir dentro de una transacción). Aquí las tablas son chicas,
-- por lo que CREATE INDEX IF NOT EXISTS es suficiente y no bloquea de forma notoria.
-- ============================================================================

-- 1) reservas(fecha)  [ÚNICO REALMENTE FALTANTE]
--    Acelera GET /api/reservas?fecha=... (chequeo de disponibilidad público, el
--    endpoint más caliente). Sin este índice la consulta hace seq scan y crece
--    en latencia a medida que aumentan las reservas.
create index if not exists reservas_fecha_idx on public.reservas (fecha);

-- 2) turnos_stand(fecha)  [YA EXISTE — incluido por idempotencia]
create index if not exists turnos_stand_fecha_idx on public.turnos_stand (fecha);

-- 3) campeonato_registros(campeonato_fecha_id)  [YA EXISTE — incluido por idempotencia]
create index if not exists campeonato_registros_fecha_id_idx
  on public.campeonato_registros (campeonato_fecha_id);

-- 4) reserva_slots(fecha,hora,simulador) UNIQUE  [YA EXISTE — NO recrear]
--    La garantía anti doble-reserva ya está implementada como índice ÚNICO PARCIAL
--    (solo filas con estado='activa'): reserva_slots_activa_uq. Recrearlo como
--    único total rompería la semántica (impediría re-reservar un slot liberado).
--    Verificación (debe devolver 1 fila):
--        select indexname from pg_indexes where indexname = 'reserva_slots_activa_uq';

-- ---------------------------------------------------------------------------
-- Verificación posterior (opcional): listar los índices resultantes.
--   select tablename, indexname
--   from pg_indexes
--   where schemaname = 'public'
--     and tablename in ('reservas','reserva_slots','turnos_stand','campeonato_registros')
--   order by tablename, indexname;
-- ---------------------------------------------------------------------------

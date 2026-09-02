-- ============================================================================
-- IA SIM · Bloque 4C.2 — Requisitos solicitados + formatos seleccionados.
-- Aditiva/idempotente. Solo SIM WEB. No recrea tablas de 4C. RLS ya deny-by-default.
-- ============================================================================

-- Requisitos SOLICITADOS por el administrador (componentes + formatos), reconocidos
-- del texto del pedido. Independiente del texto libre que produzca Claude.
alter table public.ia_informes add column if not exists requisitos jsonb;

-- Formatos SELECCIONADOS para generar (persisten y se restauran al recargar).
-- Por defecto = los formatos solicitados.
alter table public.ia_informe_versiones add column if not exists formatos jsonb;

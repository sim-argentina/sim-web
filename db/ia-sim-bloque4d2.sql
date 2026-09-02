-- ============================================================================
-- IA SIM · Bloque 4D.2 — Auditoría de validación y consumo (ADITIVO/IDEMPOTENTE)
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). Solo columnas nuevas en ia_busquedas_web.
-- RLS deny-by-default ya activo en la tabla (sin policies → solo service_role).
-- ============================================================================

alter table public.ia_busquedas_web add column if not exists validador_version text;
alter table public.ia_busquedas_web add column if not exists fuentes_recibidas integer;      -- fuentes externas devueltas por la búsqueda
alter table public.ia_busquedas_web add column if not exists salvedades integer;              -- advertencias reales de validación
alter table public.ia_busquedas_web add column if not exists herramientas_ofrecidas integer;  -- schemas ofrecidos al modelo (consumo)
alter table public.ia_busquedas_web add column if not exists integridad_ok boolean;           -- Markdown estructuralmente válido

-- ============================================================================
-- IA SIM · Bloque 4D.4 — Consumo auditable de ejecuciones con timeout (ADITIVO/IDEMPOTENTE)
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). Solo columnas nuevas. RLS ya activo (deny-by-default).
-- Distingue consumo CONOCIDO / PARCIAL / DESCONOCIDO: si el request se abortó sin usage final,
-- NO se afirma costo 0 confirmado (el proveedor pudo cobrar). Queda pendiente de conciliación.
-- ============================================================================

alter table public.ia_ejecuciones   add column if not exists uso_desconocido boolean not null default false;
alter table public.ia_ejecuciones   add column if not exists fase_fallo text;          -- fase donde cortó (para diagnóstico)
alter table public.ia_busquedas_web add column if not exists uso_desconocido boolean not null default false;

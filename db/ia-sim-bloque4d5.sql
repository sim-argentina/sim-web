-- ============================================================================
-- IA SIM · Bloque 4D.5 — Búsqueda web económica (Tavily), caché y presupuesto previo
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE. RLS deny-by-default
-- (sin policies → solo service_role). Sin API keys ni PII. No se modifican registros
-- históricos de ia_busquedas_web/ia_fuentes_externas (la ejecución cara real queda intacta).
-- ============================================================================

-- 1) Auditoría extendida de búsquedas web: proveedor efectivo, caché, créditos, tamaños,
--    presupuesto proyectado/aprobado (Bloque 4D.5).
alter table public.ia_busquedas_web add column if not exists cache_hit boolean not null default false;
alter table public.ia_busquedas_web add column if not exists creditos_busqueda integer;
alter table public.ia_busquedas_web add column if not exists chars_recibidos integer;
alter table public.ia_busquedas_web add column if not exists chars_enviados integer;
alter table public.ia_busquedas_web add column if not exists tokens_proyectados integer;
alter table public.ia_busquedas_web add column if not exists costo_proyectado_usd numeric;
alter table public.ia_busquedas_web add column if not exists presupuesto_aprobado text; -- 'estandar' | 'ampliado' | 'excedido_bloqueado'

-- 2) Caché persistente de resultados de búsqueda web (evidencia, no conclusiones). Una fila
--    por clave (consulta normalizada + proveedor + localización + parámetros + versión del
--    normalizador). Upsert idempotente: una carrera concurrente no duplica.
create table if not exists public.ia_web_cache (
  id               uuid primary key default gen_random_uuid(),
  clave_hash       text not null,
  consulta_saneada text,
  proveedor        text not null,
  resultados       jsonb not null default '[]'::jsonb,
  n_resultados     integer not null default 0,
  creditos         integer not null default 0,
  hash_contenido   text,
  estado           text not null default 'ok' check (estado in ('ok','vacio','error')),
  created_at       timestamptz not null default now(),
  vence_at         timestamptz not null
);
create unique index if not exists ia_web_cache_clave_uq on public.ia_web_cache (clave_hash);
create index if not exists ia_web_cache_vence_idx on public.ia_web_cache (vence_at);

alter table public.ia_web_cache enable row level security;
-- Deny-by-default: sin policies → solo service_role.

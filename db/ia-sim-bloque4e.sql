-- ============================================================================
-- IA SIM · Bloque 4E — Comparaciones, anomalías, FODA y proyecciones
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE. RLS deny-by-default
-- (sin policies → solo service_role). Sin API keys ni PII.
--
-- Única tabla nueva: el índice IPC oficial (dato que hoy no tiene ningún lugar en el
-- sistema). El resto de 4E (auditoría de cada análisis, snapshots para informes) reutiliza
-- ia_ejecuciones/ia_herramientas_ejecuciones/ia_informe_versiones.snapshot_fuentes ya
-- existentes — no hace falta ninguna tabla nueva para eso.
-- ============================================================================

-- Serie oficial del IPC (INDEC u otra fuente oficial), cargada/actualizada por el admin de
-- forma auditable (nunca hardcodeada en el código, nunca consultada en cada respuesta).
create table if not exists public.ia_ipc_indice (
  id                  uuid primary key default gen_random_uuid(),
  periodo             text not null,       -- 'YYYY-MM'
  indice              numeric not null,    -- número índice del IPC nivel general para el período
  fuente              text not null default 'INDEC',
  url                 text,
  fecha_publicacion   date,
  fecha_consulta      timestamptz not null default now(),
  version             text not null default '1',
  cargado_por         text,                -- owner admin que cargó/actualizó el dato
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists ia_ipc_indice_periodo_uq on public.ia_ipc_indice (periodo);

alter table public.ia_ipc_indice enable row level security;
-- Deny-by-default: sin policies → solo service_role (lectura/carga vía endpoint admin-only).

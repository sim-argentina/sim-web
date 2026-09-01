-- ============================================================================
-- IA SIM · Bloque 4B.1 — OCR/visión bajo autorización (ADITIVO/IDEMPOTENTE, SIM WEB)
-- Solo escribe tablas ia_*. RLS deny-by-default. Nada de negocio se modifica.
-- ============================================================================

-- Columnas OCR en adjuntos (separa OCR de descripción visual y corrección).
alter table public.ia_adjuntos_conversacion add column if not exists ocr_texto_detectado    text;
alter table public.ia_adjuntos_conversacion add column if not exists ocr_descripcion_visual text;
alter table public.ia_adjuntos_conversacion add column if not exists ocr_confianza          text;

-- Caché + auditoría de OCR/visión (idempotencia por hash+páginas+capacidad).
create table if not exists public.ia_ocr_resultados (
  id                 uuid primary key default gen_random_uuid(),
  sha256             text not null,
  paginas_key        text not null,      -- 'img' | 'pdf:all' | 'pdf:2,5'
  capacidad          text not null default 'vision',
  modelo             text,
  proveedor          text,
  texto_detectado    text,
  descripcion_visual text,
  tablas             text,
  confianza          text,
  advertencias       jsonb,
  paginas_o_imagenes integer,
  tokens_in          integer not null default 0,
  tokens_out         integer not null default 0,
  costo_estimado     numeric not null default 0,
  duracion_ms        integer,
  estado             text not null,      -- 'listo' | 'necesita_revision' | 'error'
  error              text,
  actor              text,
  created_at         timestamptz not null default now()
);
-- Reutilización solo de resultados exitosos: máximo uno 'listo' por (hash, páginas, capacidad).
create unique index if not exists ia_ocr_idem_uq on public.ia_ocr_resultados (sha256, paginas_key, capacidad) where estado = 'listo';
create index if not exists ia_ocr_sha_idx on public.ia_ocr_resultados (sha256);

alter table public.ia_ocr_resultados enable row level security;

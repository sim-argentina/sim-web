-- ============================================================================
-- IA SIM · Bloque 4D — Investigación web segura, citada y medida
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Solo tablas ia_*. No borra ni recrea nada. RLS deny-by-default (sin policies →
-- solo service_role). Nunca se guardan API keys, cookies, cabeceras ni prompts.
-- La búsqueda web de Anthropic se cobra aparte de los tokens: se audita por ejecución
-- (cantidad de búsquedas facturables + costo versionado) y se suma al costo interno.
-- ============================================================================

-- 1) Ejecuciones: costo de búsquedas web (aparte de los tokens) + cantidad facturable.
--    El costo total interno de la ejecución (costo_estimado) ya incluye tokens + web,
--    así el saldo dinámico (4B.5.1) descuenta la búsqueda una sola vez.
alter table public.ia_ejecuciones add column if not exists busquedas_web integer not null default 0;
alter table public.ia_ejecuciones add column if not exists costo_busquedas_usd numeric;
alter table public.ia_ejecuciones add column if not exists precios_web_version text;

-- 2) Mensaje del asistente: cantidad de búsquedas web usadas (para la etiqueta discreta).
alter table public.ia_mensajes add column if not exists busquedas_web integer not null default 0;

-- 3) Auditoría de búsquedas web (una fila por ejecución que habilitó internet).
create table if not exists public.ia_busquedas_web (
  id                    uuid primary key default gen_random_uuid(),
  conversacion_id       uuid references public.ia_conversaciones(id) on delete cascade,
  mensaje_usuario_id    uuid,
  ejecucion_id          uuid references public.ia_ejecuciones(id) on delete set null,
  motivo                text,                    -- por qué se habilitó internet (determinístico)
  explicita             boolean not null default false,  -- pedido explícito vs automática
  proveedor             text,
  modelo                text,
  estado                text not null default 'ok'
                          check (estado in ('ok','vacio','error','deshabilitada')),
  duracion_ms           integer,
  consultas             jsonb,                   -- lista de queries EJECUTADAS (saneadas, sin PII)
  busquedas_facturables integer not null default 0,
  costo_usd             numeric,
  precios_version       text,
  error_normalizado     text,                    -- código de error saneado (sin secretos)
  created_at            timestamptz not null default now()
);
create index if not exists ia_busquedas_web_conv_idx on public.ia_busquedas_web (conversacion_id, created_at);
create index if not exists ia_busquedas_web_eje_idx on public.ia_busquedas_web (ejecucion_id);

-- 4) Fuentes externas citadas (procedencia entregada por Anthropic; sin páginas completas).
create table if not exists public.ia_fuentes_externas (
  id             uuid primary key default gen_random_uuid(),
  busqueda_id    uuid references public.ia_busquedas_web(id) on delete cascade,
  ejecucion_id   uuid,
  url            text not null,
  dominio        text,
  titulo         text,
  fecha_pagina   text,                            -- page_age / antigüedad cuando exista
  fragmento      text,                            -- cited_text acotado (no la página entera)
  claim          text,                            -- tramo de respuesta respaldado, si la API lo da
  orden          integer not null default 0,
  recuperado_at  timestamptz not null default now()
);
-- Evita duplicados de la misma URL dentro de una búsqueda/ejecución.
create unique index if not exists ia_fuentes_externas_uq on public.ia_fuentes_externas (busqueda_id, url);
create index if not exists ia_fuentes_externas_eje_idx on public.ia_fuentes_externas (ejecucion_id);

-- 5) RLS deny-by-default (sin policies → solo service_role).
alter table public.ia_busquedas_web    enable row level security;
alter table public.ia_fuentes_externas enable row level security;

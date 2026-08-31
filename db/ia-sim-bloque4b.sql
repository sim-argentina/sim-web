-- ============================================================================
-- IA SIM · Bloque 4B — Adjuntos + Base de conocimiento (documentos/versiones/fragmentos)
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Solo se escriben tablas ia_* + Storage privado. Datos de negocio: solo lectura.
-- RLS deny-by-default (sin policies → solo service_role). FTS en español.
-- ============================================================================

-- ── Categorías de conocimiento ────────────────────────────────────────────────
create table if not exists public.ia_conocimiento_categorias (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  nombre_norm text not null,
  estado      text not null default 'activa' check (estado in ('activa','archivada')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists ia_categorias_norm_uq on public.ia_conocimiento_categorias (nombre_norm);

-- ── Documento lógico ──────────────────────────────────────────────────────────
create table if not exists public.ia_documentos (
  id               uuid primary key default gen_random_uuid(),
  titulo           text not null,
  categoria_id     uuid references public.ia_conocimiento_categorias(id),
  descripcion      text,
  estado           text not null default 'activo' check (estado in ('activo','archivado')),
  version_activa_id uuid,
  vigencia_desde   date,
  vigencia_hasta   date,
  fuente           text,
  actor            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ia_documentos_estado_idx on public.ia_documentos (estado, categoria_id, updated_at desc);

-- ── Versión de documento ──────────────────────────────────────────────────────
create table if not exists public.ia_documento_versiones (
  id                  uuid primary key default gen_random_uuid(),
  documento_id        uuid not null references public.ia_documentos(id) on delete cascade,
  numero              integer not null,
  estado              text not null default 'borrador' check (estado in ('borrador','activa','reemplazada')),
  storage_path        text,
  nombre_original     text,
  mime                text,
  tamano              bigint,
  sha256              text,
  contenido_extraido  text,
  contenido_corregido text,
  metodo_extraccion   text,
  estado_procesamiento text,
  paginas             integer,
  hojas               integer,
  diapositivas        integer,
  filas               integer,
  advertencias        jsonb,
  error_tecnico       text,
  actor               text,
  created_at          timestamptz not null default now(),
  constraint ia_doc_ver_num_uq unique (documento_id, numero)
);
create index if not exists ia_doc_ver_doc_idx on public.ia_documento_versiones (documento_id, numero desc);

-- ── Fragmentos (para recuperación con procedencia) ────────────────────────────
create table if not exists public.ia_documento_fragmentos (
  id           uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.ia_documentos(id) on delete cascade,
  version_id   uuid not null references public.ia_documento_versiones(id) on delete cascade,
  categoria_id uuid,
  ordinal      integer not null,
  ubicacion    text,           -- "Página 3" / "Hoja Ventas" / "Diapositiva 2" / "Sección 1"
  texto        text not null,
  tsv          tsvector generated always as (to_tsvector('spanish', coalesce(texto, ''))) stored,
  created_at   timestamptz not null default now()
);
create index if not exists ia_frag_tsv_gin on public.ia_documento_fragmentos using gin (tsv);
create index if not exists ia_frag_ver_idx on public.ia_documento_fragmentos (version_id, ordinal);

-- ── Adjuntos de conversación (temporales, atados a la conversación) ───────────
create table if not exists public.ia_adjuntos_conversacion (
  id                   uuid primary key default gen_random_uuid(),
  conversacion_id      uuid not null references public.ia_conversaciones(id) on delete cascade,
  mensaje_id           uuid,
  storage_path         text,
  nombre_original      text,
  mime                 text,
  tamano               bigint,
  sha256               text,
  contenido_extraido   text,
  contenido_corregido  text,
  metodo_extraccion    text,
  estado_procesamiento text,
  paginas              integer,
  hojas                integer,
  diapositivas         integer,
  advertencias         jsonb,
  error_tecnico        text,
  promovido_documento_id uuid,
  actor                text,
  created_at           timestamptz not null default now()
);
create index if not exists ia_adj_conv_idx on public.ia_adjuntos_conversacion (conversacion_id, created_at);

-- ── Auditoría de procesamiento de archivos ────────────────────────────────────
create table if not exists public.ia_procesamientos_archivos (
  id         uuid primary key default gen_random_uuid(),
  ambito     text not null check (ambito in ('adjunto','version')),
  ref_id     uuid,
  evento     text not null,
  detalle    jsonb,
  created_at timestamptz not null default now()
);

alter table public.ia_conocimiento_categorias  enable row level security;
alter table public.ia_documentos               enable row level security;
alter table public.ia_documento_versiones      enable row level security;
alter table public.ia_documento_fragmentos     enable row level security;
alter table public.ia_adjuntos_conversacion    enable row level security;
alter table public.ia_procesamientos_archivos  enable row level security;

-- Seed de categorías iniciales (idempotente).
insert into public.ia_conocimiento_categorias (nombre, nombre_norm)
select v.nombre, v.norm from (values
  ('General','general'), ('Operación','operacion'), ('Finanzas','finanzas'),
  ('RRHH','rrhh'), ('Marketing','marketing'), ('Legal','legal')
) as v(nombre, norm)
where not exists (select 1 from public.ia_conocimiento_categorias c where c.nombre_norm = v.norm);

-- ── Activación ATÓMICA de versión (nunca dos activas a la vez) ────────────────
create or replace function public.ia_doc_activar_version(p_documento_id uuid, p_version_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- La versión debe pertenecer al documento.
  if not exists (select 1 from ia_documento_versiones where id = p_version_id and documento_id = p_documento_id) then
    raise exception 'version_no_pertenece' using errcode = '22023';
  end if;
  -- Las activas anteriores pasan a 'reemplazada'.
  update ia_documento_versiones set estado = 'reemplazada'
   where documento_id = p_documento_id and estado = 'activa' and id <> p_version_id;
  -- La nueva queda activa.
  update ia_documento_versiones set estado = 'activa' where id = p_version_id;
  update ia_documentos set version_activa_id = p_version_id, updated_at = now() where id = p_documento_id;
end; $$;

-- ── Promoción ATÓMICA de un adjunto a documento de conocimiento ───────────────
-- Crea documento + versión activa (numero 1) con el contenido CONFIRMADO y marca el
-- adjunto como promovido. El archivo de conocimiento usa su propio storage_path
-- (independiente de la conversación). Devuelve documento_id y version_id.
create or replace function public.ia_promover_adjunto(
  p_adjunto_id uuid, p_titulo text, p_categoria_id uuid, p_descripcion text,
  p_contenido text, p_storage_path text, p_vigencia_desde date, p_vigencia_hasta date, p_actor text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_adj ia_adjuntos_conversacion; v_doc uuid; v_ver uuid;
begin
  select * into v_adj from ia_adjuntos_conversacion where id = p_adjunto_id;
  if v_adj.id is null then raise exception 'adjunto_inexistente' using errcode = 'P0002'; end if;
  if v_adj.promovido_documento_id is not null then raise exception 'ya_promovido' using errcode = '23505'; end if;

  insert into ia_documentos (titulo, categoria_id, descripcion, fuente, vigencia_desde, vigencia_hasta, actor)
    values (p_titulo, p_categoria_id, p_descripcion, 'adjunto_chat', p_vigencia_desde, p_vigencia_hasta, p_actor)
    returning id into v_doc;

  insert into ia_documento_versiones (documento_id, numero, estado, storage_path, nombre_original, mime, tamano, sha256, contenido_extraido, contenido_corregido, metodo_extraccion, estado_procesamiento, paginas, hojas, diapositivas, advertencias, actor)
    values (v_doc, 1, 'activa', p_storage_path, v_adj.nombre_original, v_adj.mime, v_adj.tamano, v_adj.sha256, v_adj.contenido_extraido, p_contenido, v_adj.metodo_extraccion, 'listo', v_adj.paginas, v_adj.hojas, v_adj.diapositivas, v_adj.advertencias, p_actor)
    returning id into v_ver;

  update ia_documentos set version_activa_id = v_ver, updated_at = now() where id = v_doc;
  update ia_adjuntos_conversacion set promovido_documento_id = v_doc where id = p_adjunto_id;
  return jsonb_build_object('documento_id', v_doc, 'version_id', v_ver);
end; $$;

revoke all on function public.ia_doc_activar_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ia_promover_adjunto(uuid, text, uuid, text, text, text, date, date, text) from public, anon, authenticated;
grant execute on function public.ia_doc_activar_version(uuid, uuid) to service_role;
grant execute on function public.ia_promover_adjunto(uuid, text, uuid, text, text, text, date, date, text) to service_role;

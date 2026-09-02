-- ============================================================================
-- IA SIM · Bloque 4C — Generación auditable de informes y archivos
-- ----------------------------------------------------------------------------
-- Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Solo tablas ia_*. No toca datos de negocio. RLS deny-by-default (sin policies →
-- acceso solo con service_role). El modelo NUNCA accede a Supabase/Storage/SQL.
--
-- Separación real: informe / versión (borrador) / fuentes / archivo generado / historial.
-- Los archivos van a un bucket PRIVADO separado (ia-sim-informes): distinto ciclo de
-- vida que el conocimiento (ia-sim-docs), atado a la conversación (papelera/purga),
-- acceso solo por URL firmada corta.
-- ============================================================================

-- ── 1) Informe (atado a la conversación y al owner) ──────────────────────────
create table if not exists public.ia_informes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.ia_conversaciones(id) on delete cascade,
  owner           text not null,
  ejecucion_id    uuid,                        -- ejecución del chat que originó el borrador
  titulo          text not null,
  tipo_informe    text not null,
  periodo         text,
  estado          text not null default 'borrador'
                    check (estado in ('borrador','generando','generado','error','descartado','papelera','eliminado')),
  version_actual  integer not null default 1,
  incluye_pii     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists ia_informes_conv_idx on public.ia_informes (conversacion_id, estado, updated_at desc);
create index if not exists ia_informes_owner_idx on public.ia_informes (owner, estado);

-- ── 2) Versiones (cada una conserva su snapshot; nunca se sobrescribe) ────────
create table if not exists public.ia_informe_versiones (
  id                 uuid primary key default gen_random_uuid(),
  informe_id         uuid not null references public.ia_informes(id) on delete cascade,
  version            integer not null,
  spec               jsonb not null,           -- InformeSpec validado
  hash               text not null,            -- sha256 del spec congelado
  snapshot_fuentes   jsonb,                    -- resúmenes reales de las tools (grounding)
  fecha_corte        text,
  ediciones_manuales jsonb,                    -- cambios manuales del admin (before/after)
  reconciliacion     jsonb,                    -- resultado de la reconciliación al confirmar
  actor              text not null,
  estado             text not null default 'borrador'
                       check (estado in ('borrador','generando','generado','error')),
  created_at         timestamptz not null default now(),
  constraint ia_informe_version_uq unique (informe_id, version)
);
create index if not exists ia_informe_versiones_idx on public.ia_informe_versiones (informe_id, version desc);

-- ── 3) Fuentes utilizadas por versión ────────────────────────────────────────
create table if not exists public.ia_informe_fuentes (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.ia_informe_versiones(id) on delete cascade,
  modulo        text not null,
  periodo       text,
  registros     integer,
  actualizado   text,
  herramienta   text,                          -- tool que aportó el dato
  created_at    timestamptz not null default now()
);
create index if not exists ia_informe_fuentes_idx on public.ia_informe_fuentes (version_id);

-- ── 4) Archivos generados (uno por formato, desde el mismo snapshot) ──────────
create table if not exists public.ia_archivos_generados (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.ia_informe_versiones(id) on delete cascade,
  informe_id     uuid not null references public.ia_informes(id) on delete cascade,
  formato        text not null check (formato in ('pdf','docx','xlsx','csv','png')),
  storage_path   text not null,                -- nombre FÍSICO server-side (sin PII)
  nombre_descarga text not null,               -- nombre de descarga (sin PII)
  mime           text not null,
  tamano_bytes   bigint not null default 0,
  hash_sha256    text not null,
  incluye_pii    boolean not null default false,
  estado         text not null default 'ok' check (estado in ('ok','error')),
  created_at     timestamptz not null default now(),
  constraint ia_archivo_version_formato_uq unique (version_id, formato)
);
create index if not exists ia_archivos_informe_idx on public.ia_archivos_generados (informe_id);

-- ── 5) Historial auditable ───────────────────────────────────────────────────
create table if not exists public.ia_informe_historial (
  id          uuid primary key default gen_random_uuid(),
  informe_id  uuid not null references public.ia_informes(id) on delete cascade,
  version_id  uuid references public.ia_informe_versiones(id) on delete set null,
  accion      text not null,                   -- crear_borrador|editar|confirmar|generar|descartar|papelera|restaurar|purga
  actor       text not null,
  detalle     jsonb,                           -- snapshots before/after de ediciones
  created_at  timestamptz not null default now()
);
create index if not exists ia_informe_historial_idx on public.ia_informe_historial (informe_id, created_at);

alter table public.ia_informes            enable row level security;
alter table public.ia_informe_versiones   enable row level security;
alter table public.ia_informe_fuentes      enable row level security;
alter table public.ia_archivos_generados   enable row level security;
alter table public.ia_informe_historial    enable row level security;
-- Deny-by-default: SIN policies. Acceso solo con service_role.

-- ── RPC: lock atómico de confirmación (borrador → generando). Idempotencia y
-- bloqueo de concurrencia: solo un proceso pasa de 'borrador' a 'generando'. ──
create or replace function public.ia_informe_lock_generacion(p_version_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_estado text;
begin
  update public.ia_informe_versiones
     set estado = 'generando'
   where id = p_version_id and estado = 'borrador'
   returning estado into v_estado;
  if v_estado is not null then return 'lock_ok'; end if;
  -- No se pudo lockear: devolver el estado actual (generando/generado/error).
  select estado into v_estado from public.ia_informe_versiones where id = p_version_id;
  return coalesce(v_estado, 'inexistente');
end;
$$;

-- ── RPC: purga de informes en papelera > N días (borra filas; el Storage lo
-- limpia el servidor antes de llamar a esto). ───────────────────────────────
create or replace function public.ia_informes_purgar(p_dias integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  with borrados as (
    delete from public.ia_informes
     where estado = 'papelera' and deleted_at is not null and deleted_at < now() - make_interval(days => p_dias)
     returning 1
  )
  select count(*) into v_n from borrados;
  return v_n;
end;
$$;

revoke all on function public.ia_informe_lock_generacion(uuid) from public, anon, authenticated;
revoke all on function public.ia_informes_purgar(integer) from public, anon, authenticated;
grant execute on function public.ia_informe_lock_generacion(uuid) to service_role;
grant execute on function public.ia_informes_purgar(integer) to service_role;

-- ── Bucket PRIVADO separado para los archivos generados ──────────────────────
insert into storage.buckets (id, name, public)
  values ('ia-sim-informes', 'ia-sim-informes', false)
  on conflict (id) do nothing;
-- storage.objects ya tiene RLS; sin policies para este bucket → solo service_role.

-- ============================================================================
-- IA SIM · Bloque 1 — Integrantes configurables + base de Cronograma
-- ----------------------------------------------------------------------------
-- El proyecto NO tiene migraciones versionadas: este archivo es la FUENTE DE
-- VERDAD del cambio. Se aplicó también vía Supabase (apply_migration) al proyecto
-- SIM WEB (ref bcmoewwhsyxsiyvroarj). Es ADITIVO, SEGURO e IDEMPOTENTE:
--   · create table/index IF NOT EXISTS
--   · seed con guardas "if not exists" (re-ejecutable sin duplicar)
--   · no borra ni altera datos ni tablas existentes
--
-- Alcance Bloque 1 (NO más): estructura de integrantes, alias normalizados,
-- seed Ramiro/Francisco/Federico, y las funciones atómicas de crear/editar.
-- NO incluye jornadas, horarios, calendario, PDF, atribución ni IA.
-- ============================================================================

-- ── empleados ───────────────────────────────────────────────────────────────
-- Integrantes del equipo. Sin borrado físico desde la app: se archiva/reactiva
-- con `activo`. `es_fallback` marca al integrante por defecto (Ramiro): a lo
-- sumo uno, y no puede archivarse (garantizado por índice y check).
create table if not exists public.empleados (
  id            uuid primary key default gen_random_uuid(),
  nombre_formal text not null,
  activo        boolean not null default true,
  es_fallback   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint empleados_nombre_no_vacio
    check (char_length(btrim(nombre_formal)) between 1 and 80),
  -- El integrante fallback nunca puede quedar archivado.
  constraint empleados_fallback_siempre_activo
    check (activo or not es_fallback)
);

-- A lo sumo un integrante con es_fallback = true.
create unique index if not exists empleados_fallback_unico_idx
  on public.empleados ((es_fallback))
  where es_fallback;

create index if not exists empleados_activo_idx
  on public.empleados (activo);

alter table public.empleados enable row level security;
-- Deny-by-default: SIN policies. Solo service_role (backend) accede; anon y
-- authenticated no tienen acceso directo (mismo patrón que reservas/bloqueos).

-- ── empleado_aliases ─────────────────────────────────────────────────────────
-- Nombres/alias por los que se puede reconocer a un integrante (p. ej. en
-- cronogramas). `alias_normalizado` lo calcula el backend (lib/empleados.ts,
-- autoridad server-side); acá el UNIQUE global garantiza que un mismo alias
-- normalizado no pertenezca a dos integrantes.
create table if not exists public.empleado_aliases (
  id                uuid primary key default gen_random_uuid(),
  empleado_id       uuid not null references public.empleados(id) on delete cascade,
  alias             text not null,
  alias_normalizado text not null,
  created_at        timestamptz not null default now(),
  constraint empleado_alias_no_vacio
    check (char_length(btrim(alias)) between 1 and 60),
  constraint empleado_alias_norm_no_vacio
    check (char_length(alias_normalizado) between 1 and 60)
);

create unique index if not exists empleado_aliases_norm_uq
  on public.empleado_aliases (alias_normalizado);

create index if not exists empleado_aliases_empleado_idx
  on public.empleado_aliases (empleado_id);

alter table public.empleado_aliases enable row level security;
-- Deny-by-default: SIN policies.

-- ── Funciones atómicas de crear / editar ─────────────────────────────────────
-- Crear y editar tocan dos tablas (empleado + aliases). Se hacen dentro de una
-- función para que sean ATÓMICAS: si un alias colisiona (UNIQUE), toda la
-- operación se revierte y nunca queda a medio aplicar. SECURITY DEFINER + EXECUTE
-- revocado a anon/authenticated: solo el backend (service_role) puede invocarlas.
-- El backend envía `alias_normalizado` ya calculado (única autoridad de normalización).

create or replace function public.ia_empleado_crear(p_nombre text, p_aliases jsonb)
returns public.empleados
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.empleados;
  r     record;
begin
  insert into public.empleados (nombre_formal)
  values (p_nombre)
  returning * into v_emp;

  for r in
    select value->>'alias' as alias, value->>'alias_normalizado' as norm
    from jsonb_array_elements(coalesce(p_aliases, '[]'::jsonb))
  loop
    insert into public.empleado_aliases (empleado_id, alias, alias_normalizado)
    values (v_emp.id, r.alias, r.norm);
  end loop;

  return v_emp;
end;
$$;

create or replace function public.ia_empleado_editar(p_id uuid, p_nombre text, p_aliases jsonb)
returns public.empleados
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.empleados;
  r     record;
begin
  update public.empleados
     set nombre_formal = p_nombre,
         updated_at    = now()
   where id = p_id
  returning * into v_emp;

  if v_emp.id is null then
    raise exception 'empleado_no_encontrado' using errcode = 'P0002';
  end if;

  -- Reemplazo completo del set de alias (atómico dentro de la función).
  delete from public.empleado_aliases where empleado_id = p_id;

  for r in
    select value->>'alias' as alias, value->>'alias_normalizado' as norm
    from jsonb_array_elements(coalesce(p_aliases, '[]'::jsonb))
  loop
    insert into public.empleado_aliases (empleado_id, alias, alias_normalizado)
    values (p_id, r.alias, r.norm);
  end loop;

  return v_emp;
end;
$$;

revoke all on function public.ia_empleado_crear(text, jsonb)  from public, anon, authenticated;
revoke all on function public.ia_empleado_editar(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.ia_empleado_crear(text, jsonb)  to service_role;
grant execute on function public.ia_empleado_editar(uuid, text, jsonb) to service_role;

-- ── Seed idempotente ─────────────────────────────────────────────────────────
-- Ramiro (fallback), Francisco (Francisco/Fran), Federico (Federico/Fede).
-- Guarda por alias_normalizado principal: re-ejecutar no duplica.
do $$
declare v_id uuid;
begin
  if not exists (select 1 from public.empleado_aliases where alias_normalizado = 'ramiro') then
    insert into public.empleados (nombre_formal, es_fallback, activo)
    values ('Ramiro', true, true) returning id into v_id;
    insert into public.empleado_aliases (empleado_id, alias, alias_normalizado)
    values (v_id, 'Ramiro', 'ramiro');
  end if;

  if not exists (select 1 from public.empleado_aliases where alias_normalizado = 'francisco') then
    insert into public.empleados (nombre_formal) values ('Francisco') returning id into v_id;
    insert into public.empleado_aliases (empleado_id, alias, alias_normalizado)
    values (v_id, 'Francisco', 'francisco'), (v_id, 'Fran', 'fran');
  end if;

  if not exists (select 1 from public.empleado_aliases where alias_normalizado = 'federico') then
    insert into public.empleados (nombre_formal) values ('Federico') returning id into v_id;
    insert into public.empleado_aliases (empleado_id, alias, alias_normalizado)
    values (v_id, 'Federico', 'federico'), (v_id, 'Fede', 'fede');
  end if;
end $$;

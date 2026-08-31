-- ============================================================================
-- IA SIM · Bloque 4A — Chat con Claude + herramientas de solo lectura
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicar SOLO a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Solo se ESCRIBEN tablas ia_* (conversaciones/auditoría). Los datos de negocio
-- siguen siendo de solo lectura. RLS deny-by-default (sin policies → solo service_role).
-- Nunca se guardan API keys, cookies, cabeceras de auth ni stack traces visibles.
-- ============================================================================

create table if not exists public.ia_conversaciones (
  id            uuid primary key default gen_random_uuid(),
  owner         text not null,                      -- identidad interna estable (server-side)
  titulo        text,
  estado        text not null default 'activa' check (estado in ('activa','papelera')),
  proveedor     text,
  modelo_ultimo text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists ia_conversaciones_owner_idx on public.ia_conversaciones (owner, estado, updated_at desc);

create table if not exists public.ia_mensajes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.ia_conversaciones(id) on delete cascade,
  rol             text not null check (rol in ('user','assistant')),
  contenido       text not null,
  modelo          text,
  proveedor       text,
  clase_modelo    text,
  motivo_router   text,
  escalado        boolean not null default false,
  tokens_in       integer not null default 0,
  tokens_out      integer not null default 0,
  fuentes         jsonb,
  herramientas    jsonb,
  estado          text not null default 'completa' check (estado in ('completa','error','cancelada')),
  error           text,
  idempotency_key text,
  created_at      timestamptz not null default now()
);
create index if not exists ia_mensajes_conv_idx on public.ia_mensajes (conversacion_id, created_at);
create unique index if not exists ia_mensajes_idem_uq on public.ia_mensajes (idempotency_key) where idempotency_key is not null;

create table if not exists public.ia_ejecuciones (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid,
  mensaje_id      uuid,
  modelo          text,
  proveedor       text,
  clase_modelo    text,
  motivo_router   text,
  escalado        boolean not null default false,
  tokens_in       integer not null default 0,
  tokens_out      integer not null default 0,
  rondas          integer not null default 0,
  duracion_ms     integer,
  estado          text,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists ia_ejecuciones_conv_idx on public.ia_ejecuciones (conversacion_id, created_at);

create table if not exists public.ia_herramientas_ejecuciones (
  id           uuid primary key default gen_random_uuid(),
  ejecucion_id uuid references public.ia_ejecuciones(id) on delete cascade,
  herramienta  text not null,
  params       jsonb,
  resumen      jsonb,
  ok           boolean not null default true,
  error        text,
  duracion_ms  integer,
  created_at   timestamptz not null default now()
);

create table if not exists public.ia_feedback (
  id         uuid primary key default gen_random_uuid(),
  mensaje_id uuid not null references public.ia_mensajes(id) on delete cascade,
  tipo       text not null check (tipo in ('util','no_util','error')),
  comentario text,
  actor      text,
  created_at timestamptz not null default now()
);
create index if not exists ia_feedback_msg_idx on public.ia_feedback (mensaje_id);

create table if not exists public.ia_consumo (
  id             uuid primary key default gen_random_uuid(),
  dia            date not null,
  owner          text not null,
  tokens_in      bigint not null default 0,
  tokens_out     bigint not null default 0,
  solicitudes    integer not null default 0,
  costo_estimado numeric not null default 0,
  constraint ia_consumo_dia_owner_uq unique (dia, owner)
);

alter table public.ia_conversaciones            enable row level security;
alter table public.ia_mensajes                  enable row level security;
alter table public.ia_ejecuciones               enable row level security;
alter table public.ia_herramientas_ejecuciones  enable row level security;
alter table public.ia_feedback                  enable row level security;
alter table public.ia_consumo                   enable row level security;
-- Deny-by-default: SIN policies. Acceso solo con service_role.

-- ── Cuota ATÓMICA: reserva una solicitud si no se superan los límites ─────────
create or replace function public.ia_reservar_solicitud(p_owner text, p_dia date, p_max_dia integer, p_max_mes bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_sol   integer;
  v_mes   bigint;
begin
  insert into public.ia_consumo (dia, owner) values (p_dia, p_owner)
    on conflict (dia, owner) do nothing;

  -- Tokens del MES en curso (input+output) para el tope mensual.
  select coalesce(sum(tokens_in + tokens_out), 0) into v_mes
    from public.ia_consumo
   where owner = p_owner and to_char(dia, 'YYYY-MM') = to_char(p_dia, 'YYYY-MM');
  if v_mes >= p_max_mes then
    return jsonb_build_object('ok', false, 'motivo', 'limite_mensual', 'tokens_mes', v_mes);
  end if;

  -- Incremento atómico del contador diario solo si no se alcanzó el tope.
  update public.ia_consumo
     set solicitudes = solicitudes + 1
   where dia = p_dia and owner = p_owner and solicitudes < p_max_dia
   returning solicitudes into v_sol;

  if v_sol is null then
    return jsonb_build_object('ok', false, 'motivo', 'limite_diario');
  end if;
  return jsonb_build_object('ok', true, 'solicitudes', v_sol, 'tokens_mes', v_mes);
end;
$$;

-- ── Suma de consumo real (tokens/costo) tras completar la ejecución ───────────
create or replace function public.ia_sumar_consumo(p_owner text, p_dia date, p_in bigint, p_out bigint, p_costo numeric)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ia_consumo (dia, owner, tokens_in, tokens_out, costo_estimado)
    values (p_dia, p_owner, p_in, p_out, coalesce(p_costo, 0))
  on conflict (dia, owner) do update
    set tokens_in = public.ia_consumo.tokens_in + excluded.tokens_in,
        tokens_out = public.ia_consumo.tokens_out + excluded.tokens_out,
        costo_estimado = public.ia_consumo.costo_estimado + excluded.costo_estimado;
end;
$$;

-- ── Purga definitiva de la papelera (> N días). Auditable/segura. ─────────────
create or replace function public.ia_purgar_papelera(p_dias integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  with borradas as (
    delete from public.ia_conversaciones
     where estado = 'papelera' and deleted_at is not null and deleted_at < now() - make_interval(days => p_dias)
     returning 1
  )
  select count(*) into v_n from borradas;
  return v_n;
end;
$$;

revoke all on function public.ia_reservar_solicitud(text, date, integer, bigint) from public, anon, authenticated;
revoke all on function public.ia_sumar_consumo(text, date, bigint, bigint, numeric) from public, anon, authenticated;
revoke all on function public.ia_purgar_papelera(integer) from public, anon, authenticated;
grant execute on function public.ia_reservar_solicitud(text, date, integer, bigint) to service_role;
grant execute on function public.ia_sumar_consumo(text, date, bigint, bigint, numeric) to service_role;
grant execute on function public.ia_purgar_papelera(integer) to service_role;

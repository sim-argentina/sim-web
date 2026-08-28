-- ============================================================================
-- IA SIM · Bloque 2 — Cronograma mensual manual
-- ----------------------------------------------------------------------------
-- Fuente de verdad del cambio (el repo no tiene migraciones versionadas). Se
-- aplicó también vía Supabase (apply_migration) al proyecto SIM WEB
-- (ref bcmoewwhsyxsiyvroarj). ADITIVO, SEGURO e IDEMPOTENTE:
--   · create table/type/index/extension IF NOT EXISTS (o guardas equivalentes)
--   · no borra ni altera datos existentes; NO toca las tablas del Bloque 1
--     (empleados / empleado_aliases), solo las referencia por FK.
--
-- Alcance Bloque 2 (NO más): meses (borrador/confirmado), días (abierto/cerrado +
-- horario operativo), jornadas manuales por integrante, historial append-only, y
-- las funciones atómicas de crear borrador / guardar día / confirmar.
-- NO incluye: importación PDF/Canva, copia de semanas/meses, plantillas,
-- atribución de turnos/facturación, ni IA.
-- ============================================================================

create extension if not exists btree_gist;

-- Rango de `time` para la restricción de exclusión (no-solapamiento).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cronograma_timerange') then
    create type public.cronograma_timerange as range (subtype = time);
  end if;
end $$;

-- ── cronograma_meses ─────────────────────────────────────────────────────────
-- Un registro por mes. "Sin cronograma" = no existe fila. Estados: borrador
-- (en armado, no oficial) / confirmado (oficial; huecos → Ramiro).
create table if not exists public.cronograma_meses (
  id             uuid primary key default gen_random_uuid(),
  anio           smallint not null,
  mes            smallint not null,
  estado         text not null default 'borrador',
  apertura_default time not null default '10:00',
  cierre_default   time not null default '22:00',
  confirmado_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cronograma_meses_anio_chk    check (anio between 2020 and 2100),
  constraint cronograma_meses_mes_chk     check (mes between 1 and 12),
  constraint cronograma_meses_estado_chk  check (estado in ('borrador','confirmado')),
  constraint cronograma_meses_horario_chk check (apertura_default < cierre_default),
  constraint cronograma_meses_unico       unique (anio, mes)
);
alter table public.cronograma_meses enable row level security;

-- ── cronograma_dias ──────────────────────────────────────────────────────────
-- Estado por día. Solo existe fila si el admin tocó el día (lo cerró, cambió su
-- horario o le cargó jornadas). Ausencia de fila = día abierto con horario por
-- defecto y sin jornadas manuales. La pertenencia de `fecha` al mes se valida en
-- la RPC (server-side).
create table if not exists public.cronograma_dias (
  id         uuid primary key default gen_random_uuid(),
  mes_id     uuid not null references public.cronograma_meses(id) on delete cascade,
  fecha      date not null,
  cerrado    boolean not null default false,
  apertura   time not null default '10:00',
  cierre     time not null default '22:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cronograma_dias_horario_chk check (apertura < cierre),
  constraint cronograma_dias_unico       unique (mes_id, fecha)
);
create index if not exists cronograma_dias_mes_idx on public.cronograma_dias (mes_id);
alter table public.cronograma_dias enable row level security;

-- ── cronograma_jornadas ──────────────────────────────────────────────────────
-- Jornadas manuales (presencia de un integrante en un tramo). Baja LÓGICA
-- (activo=false): nunca se borran físicamente. FK a empleados SIN cascade: un
-- integrante con jornadas no puede eliminarse físicamente (y en la app tampoco se
-- borra: se archiva). Intervalos [inicio, fin). Restricción de exclusión: el
-- MISMO integrante no puede solaparse en el mismo día (solo filas activas).
create table if not exists public.cronograma_jornadas (
  id          uuid primary key default gen_random_uuid(),
  dia_id      uuid not null references public.cronograma_dias(id) on delete cascade,
  empleado_id uuid not null references public.empleados(id),
  hora_inicio time not null,
  hora_fin    time not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cronograma_jornadas_horas_chk check (hora_inicio < hora_fin),
  constraint cronograma_jornadas_no_solapa exclude using gist (
    dia_id with =,
    empleado_id with =,
    public.cronograma_timerange(hora_inicio, hora_fin, '[)') with &&
  ) where (activo)
);
create index if not exists cronograma_jornadas_dia_idx on public.cronograma_jornadas (dia_id) where activo;
create index if not exists cronograma_jornadas_empleado_idx on public.cronograma_jornadas (empleado_id);
alter table public.cronograma_jornadas enable row level security;

-- ── cronograma_historial ─────────────────────────────────────────────────────
-- Auditoría append-only. `actor` = rol disponible hoy ("Administrador"); la cookie
-- identifica un rol, no una persona (no se inventa identidad individual).
create table if not exists public.cronograma_historial (
  id         uuid primary key default gen_random_uuid(),
  mes_id     uuid not null references public.cronograma_meses(id) on delete cascade,
  fecha      date,
  tipo       text not null,
  actor      text not null default 'Administrador',
  antes      jsonb,
  despues    jsonb,
  created_at timestamptz not null default now(),
  constraint cronograma_historial_tipo_chk check (tipo in
    ('mes_creado','dia_guardado','mes_confirmado','correccion_confirmado'))
);
create index if not exists cronograma_historial_mes_idx on public.cronograma_historial (mes_id, created_at);
alter table public.cronograma_historial enable row level security;

-- Todas con RLS habilitado y SIN policies (deny-by-default; solo service_role),
-- igual que el resto de tablas administrativas del proyecto.

-- ── Funciones atómicas (SECURITY DEFINER, search_path fijo, execute solo service_role) ──

-- Crear borrador del mes (idempotente: si ya existe, lo devuelve sin duplicar historial).
create or replace function public.cronograma_crear_borrador(p_anio int, p_mes int)
returns public.cronograma_meses
language plpgsql security definer set search_path = public
as $$
declare v_mes public.cronograma_meses;
begin
  insert into public.cronograma_meses (anio, mes)
  values (p_anio, p_mes)
  on conflict (anio, mes) do nothing
  returning * into v_mes;

  if v_mes.id is null then
    select * into v_mes from public.cronograma_meses where anio = p_anio and mes = p_mes;
    return v_mes;
  end if;

  insert into public.cronograma_historial (mes_id, tipo, despues)
  values (v_mes.id, 'mes_creado',
          jsonb_build_object('estado','borrador','anio',p_anio,'mes',p_mes));
  return v_mes;
end;
$$;

-- Guardado ATÓMICO de un día: upsert del día + reemplazo (baja lógica + alta) de
-- sus jornadas + registro en historial (con snapshots antes/después). Si algo
-- falla (integrante inactivo, solapamiento, fecha fuera de mes), revierte todo.
create or replace function public.cronograma_guardar_dia(
  p_anio int, p_mes int, p_fecha date, p_cerrado boolean,
  p_apertura time, p_cierre time, p_jornadas jsonb
)
returns public.cronograma_dias
language plpgsql security definer set search_path = public
as $$
declare
  v_mes    public.cronograma_meses;
  v_dia    public.cronograma_dias;
  v_antes  jsonb;
  v_despues jsonb;
  v_correccion boolean;
  r record;
begin
  select * into v_mes from public.cronograma_meses where anio = p_anio and mes = p_mes;
  if v_mes.id is null then
    raise exception 'mes_inexistente' using errcode = 'P0002';
  end if;

  if extract(year from p_fecha)::int <> p_anio or extract(month from p_fecha)::int <> p_mes then
    raise exception 'fecha_fuera_de_mes' using errcode = '22007';
  end if;

  -- Solo integrantes ACTIVOS pueden asignarse a jornadas.
  for r in select (value->>'empleado_id')::uuid as emp
           from jsonb_array_elements(coalesce(p_jornadas, '[]'::jsonb)) loop
    if not exists (select 1 from public.empleados where id = r.emp and activo) then
      raise exception 'integrante_inactivo' using errcode = '23514';
    end if;
  end loop;

  -- Snapshot ANTES (o null si el día no existía).
  select * into v_dia from public.cronograma_dias where mes_id = v_mes.id and fecha = p_fecha;
  if v_dia.id is not null then
    v_antes := jsonb_build_object(
      'cerrado', v_dia.cerrado, 'apertura', v_dia.apertura, 'cierre', v_dia.cierre,
      'jornadas', (select coalesce(jsonb_agg(jsonb_build_object(
                     'empleado_id', j.empleado_id, 'hora_inicio', j.hora_inicio, 'hora_fin', j.hora_fin
                   ) order by j.hora_inicio), '[]'::jsonb)
                   from public.cronograma_jornadas j where j.dia_id = v_dia.id and j.activo));
  else
    v_antes := null;
  end if;

  -- Upsert del día.
  if v_dia.id is null then
    insert into public.cronograma_dias (mes_id, fecha, cerrado, apertura, cierre)
    values (v_mes.id, p_fecha, p_cerrado, p_apertura, p_cierre)
    returning * into v_dia;
  else
    update public.cronograma_dias
       set cerrado = p_cerrado, apertura = p_apertura, cierre = p_cierre, updated_at = now()
     where id = v_dia.id
    returning * into v_dia;
  end if;

  -- Baja lógica de las jornadas activas actuales del día.
  update public.cronograma_jornadas set activo = false, updated_at = now()
   where dia_id = v_dia.id and activo;

  -- Alta de las jornadas nuevas (un día cerrado nunca tiene jornadas).
  if not p_cerrado then
    for r in select value->>'empleado_id' as emp, value->>'hora_inicio' as ini, value->>'hora_fin' as fin
             from jsonb_array_elements(coalesce(p_jornadas, '[]'::jsonb)) loop
      insert into public.cronograma_jornadas (dia_id, empleado_id, hora_inicio, hora_fin)
      values (v_dia.id, r.emp::uuid, r.ini::time, r.fin::time);
    end loop;
  end if;

  -- Snapshot DESPUÉS.
  v_despues := jsonb_build_object(
    'cerrado', v_dia.cerrado, 'apertura', v_dia.apertura, 'cierre', v_dia.cierre,
    'jornadas', (select coalesce(jsonb_agg(jsonb_build_object(
                   'empleado_id', j.empleado_id, 'hora_inicio', j.hora_inicio, 'hora_fin', j.hora_fin
                 ) order by j.hora_inicio), '[]'::jsonb)
                 from public.cronograma_jornadas j where j.dia_id = v_dia.id and j.activo));

  v_correccion := (v_mes.estado = 'confirmado');
  insert into public.cronograma_historial (mes_id, fecha, tipo, antes, despues)
  values (v_mes.id, p_fecha,
          case when v_correccion then 'correccion_confirmado' else 'dia_guardado' end,
          v_antes, v_despues);

  update public.cronograma_meses set updated_at = now() where id = v_mes.id;
  return v_dia;
end;
$$;

-- Confirmar el mes (borrador → confirmado). Idempotente: si ya está confirmado, lo
-- devuelve sin re-registrar. La corrección posterior NO despublica (ver guardar_dia).
create or replace function public.cronograma_confirmar(p_anio int, p_mes int)
returns public.cronograma_meses
language plpgsql security definer set search_path = public
as $$
declare v_mes public.cronograma_meses;
begin
  update public.cronograma_meses
     set estado = 'confirmado', confirmado_at = coalesce(confirmado_at, now()), updated_at = now()
   where anio = p_anio and mes = p_mes and estado = 'borrador'
  returning * into v_mes;

  if v_mes.id is null then
    select * into v_mes from public.cronograma_meses where anio = p_anio and mes = p_mes;
    if v_mes.id is null then
      raise exception 'mes_inexistente' using errcode = 'P0002';
    end if;
    return v_mes; -- ya estaba confirmado
  end if;

  insert into public.cronograma_historial (mes_id, tipo, despues)
  values (v_mes.id, 'mes_confirmado', jsonb_build_object('estado','confirmado'));
  return v_mes;
end;
$$;

revoke all on function public.cronograma_crear_borrador(int, int) from public, anon, authenticated;
revoke all on function public.cronograma_guardar_dia(int, int, date, boolean, time, time, jsonb) from public, anon, authenticated;
revoke all on function public.cronograma_confirmar(int, int) from public, anon, authenticated;
grant execute on function public.cronograma_crear_borrador(int, int) to service_role;
grant execute on function public.cronograma_guardar_dia(int, int, date, boolean, time, time, jsonb) to service_role;
grant execute on function public.cronograma_confirmar(int, int) to service_role;

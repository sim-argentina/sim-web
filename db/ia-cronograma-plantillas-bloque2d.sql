-- ============================================================================
-- IA SIM · Bloque 2D — Copiar semanas/meses + Plantillas
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Agrega: plantillas (snapshot JSONB) + su historial; RPC atómica multi-mes para
-- aplicar días (copia/plantilla), que crea borradores donde haga falta, reactiva
-- meses descartados, RECHAZA meses confirmados, registra historial y NUNCA confirma.
-- Amplía cronograma_historial (superset). NO toca empleados ni el importador.
-- ============================================================================

-- ── cronograma_plantillas ─────────────────────────────────────────────────────
create table if not exists public.cronograma_plantillas (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null,
  nombre              text not null,
  nombre_normalizado  text not null,
  contenido           jsonb not null,          -- snapshot (semana/mes) sin fallback ni horas
  activo              boolean not null default true,
  actor               text not null default 'Administrador',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint cronograma_plantillas_tipo_chk   check (tipo in ('semanal','mensual')),
  constraint cronograma_plantillas_nombre_chk check (char_length(btrim(nombre)) between 1 and 80)
);
-- No dos plantillas ACTIVAS del mismo tipo con igual nombre normalizado.
create unique index if not exists cronograma_plantillas_activa_uq
  on public.cronograma_plantillas (tipo, nombre_normalizado) where activo;
create index if not exists cronograma_plantillas_tipo_idx on public.cronograma_plantillas (tipo, activo);
alter table public.cronograma_plantillas enable row level security;

-- ── cronograma_plantilla_historial (append-only) ─────────────────────────────
create table if not exists public.cronograma_plantilla_historial (
  id           uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references public.cronograma_plantillas(id) on delete cascade,
  tipo         text not null,
  actor        text not null default 'Administrador',
  antes        jsonb,
  despues      jsonb,
  created_at   timestamptz not null default now(),
  constraint cronograma_plantilla_historial_tipo_chk check (tipo in
    ('plantilla_creada','plantilla_renombrada','plantilla_actualizada','plantilla_archivada','plantilla_reactivada'))
);
create index if not exists cronograma_plantilla_historial_idx on public.cronograma_plantilla_historial (plantilla_id, created_at);
alter table public.cronograma_plantilla_historial enable row level security;

-- ── Ampliar historial de cronograma con eventos de copia/aplicación ───────────
alter table public.cronograma_historial drop constraint if exists cronograma_historial_tipo_chk;
alter table public.cronograma_historial add constraint cronograma_historial_tipo_chk
  check (tipo in ('mes_creado','dia_guardado','mes_confirmado','correccion_confirmado',
                  'importacion_aplicada','mes_reabierto','borrador_descartado',
                  'semana_copiada','mes_copiado','plantilla_aplicada'));

-- ── RPC: aplicar días (copia/plantilla) ATÓMICA y multi-mes ───────────────────
-- p_dias: [{anio,mes,fecha,cerrado,apertura,cierre,jornadas:[{empleado_id,hora_inicio,hora_fin}]}]
-- p_evento: 'semana_copiada' | 'mes_copiado' | 'plantilla_aplicada'
-- p_meta: resumen (origen/plantilla/decisiones) para el historial mensual.
create or replace function public.cronograma_aplicar_dias(p_dias jsonb, p_evento text, p_meta jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_mes   public.cronograma_meses;
  v_dia   public.cronograma_dias;
  v_fecha date;
  v_anio  int;
  v_mesn  int;
  v_cerrado boolean;
  v_ap time;
  v_ci time;
  v_jornadas jsonb;
  v_antes jsonb;
  v_despues jsonb;
  v_aplicados int := 0;
  m record;
  d record;
  r record;
  v_mes_ids uuid[] := '{}';
begin
  if p_evento not in ('semana_copiada','mes_copiado','plantilla_aplicada') then
    raise exception 'evento_invalido' using errcode = '22023';
  end if;

  -- 1) Resolver/crear los meses destino (rechazar confirmados; reactivar descartados).
  for m in select distinct (value->>'anio')::int as anio, (value->>'mes')::int as mes
           from jsonb_array_elements(coalesce(p_dias, '[]'::jsonb)) loop
    select * into v_mes from public.cronograma_meses where anio = m.anio and mes = m.mes;
    if v_mes.id is not null and v_mes.estado = 'confirmado' then
      raise exception 'mes_confirmado:%-%', m.anio, m.mes using errcode = '22023';
    end if;
    if v_mes.id is null then
      insert into public.cronograma_meses (anio, mes) values (m.anio, m.mes) returning * into v_mes;
      insert into public.cronograma_historial (mes_id, tipo, despues)
      values (v_mes.id, 'mes_creado', jsonb_build_object('estado','borrador','anio',m.anio,'mes',m.mes,'origen',p_evento));
    elsif v_mes.estado = 'descartado' then
      delete from public.cronograma_dias where mes_id = v_mes.id;
      update public.cronograma_meses set estado = 'borrador', updated_at = now() where id = v_mes.id returning * into v_mes;
      insert into public.cronograma_historial (mes_id, tipo, despues)
      values (v_mes.id, 'mes_creado', jsonb_build_object('estado','borrador','anio',m.anio,'mes',m.mes,'origen',p_evento||'_reactivacion'));
    end if;
    v_mes_ids := array_append(v_mes_ids, v_mes.id);
  end loop;

  -- 2) Aplicar cada día (upsert + reemplazo de jornadas + historial por día).
  for d in select value from jsonb_array_elements(coalesce(p_dias, '[]'::jsonb)) loop
    v_anio := (d.value->>'anio')::int;
    v_mesn := (d.value->>'mes')::int;
    v_fecha := (d.value->>'fecha')::date;
    v_cerrado := coalesce((d.value->>'cerrado')::boolean, false);
    v_ap := (d.value->>'apertura')::time;
    v_ci := (d.value->>'cierre')::time;
    v_jornadas := coalesce(d.value->'jornadas', '[]'::jsonb);

    if extract(year from v_fecha)::int <> v_anio or extract(month from v_fecha)::int <> v_mesn then
      raise exception 'fecha_fuera_de_mes' using errcode = '22007';
    end if;
    select * into v_mes from public.cronograma_meses where anio = v_anio and mes = v_mesn;
    if v_mes.id is null then raise exception 'mes_inexistente' using errcode = 'P0002'; end if;

    for r in select (value->>'empleado_id')::uuid as emp from jsonb_array_elements(v_jornadas) loop
      if not exists (select 1 from public.empleados where id = r.emp and activo) then
        raise exception 'integrante_inactivo' using errcode = '23514';
      end if;
    end loop;

    select * into v_dia from public.cronograma_dias where mes_id = v_mes.id and fecha = v_fecha;
    if v_dia.id is not null then
      v_antes := jsonb_build_object('cerrado', v_dia.cerrado, 'apertura', v_dia.apertura, 'cierre', v_dia.cierre,
        'jornadas', (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', j.empleado_id, 'hora_inicio', j.hora_inicio, 'hora_fin', j.hora_fin) order by j.hora_inicio), '[]'::jsonb)
                     from public.cronograma_jornadas j where j.dia_id = v_dia.id and j.activo));
    else
      v_antes := null;
    end if;

    if v_dia.id is null then
      insert into public.cronograma_dias (mes_id, fecha, cerrado, apertura, cierre)
      values (v_mes.id, v_fecha, v_cerrado, v_ap, v_ci) returning * into v_dia;
    else
      update public.cronograma_dias set cerrado = v_cerrado, apertura = v_ap, cierre = v_ci, updated_at = now()
       where id = v_dia.id returning * into v_dia;
    end if;

    update public.cronograma_jornadas set activo = false, updated_at = now() where dia_id = v_dia.id and activo;
    if not v_cerrado then
      for r in select value->>'empleado_id' as emp, value->>'hora_inicio' as ini, value->>'hora_fin' as fin
               from jsonb_array_elements(v_jornadas) loop
        insert into public.cronograma_jornadas (dia_id, empleado_id, hora_inicio, hora_fin)
        values (v_dia.id, r.emp::uuid, r.ini::time, r.fin::time);
      end loop;
    end if;

    v_despues := jsonb_build_object('cerrado', v_dia.cerrado, 'apertura', v_dia.apertura, 'cierre', v_dia.cierre,
      'jornadas', (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', j.empleado_id, 'hora_inicio', j.hora_inicio, 'hora_fin', j.hora_fin) order by j.hora_inicio), '[]'::jsonb)
                   from public.cronograma_jornadas j where j.dia_id = v_dia.id and j.activo));

    insert into public.cronograma_historial (mes_id, fecha, tipo, antes, despues)
    values (v_mes.id, v_fecha, 'dia_guardado', v_antes, v_despues);
    v_aplicados := v_aplicados + 1;
  end loop;

  -- 3) Un evento mensual por cada mes afectado (con el resumen p_meta).
  for r in select distinct unnest(v_mes_ids) as mid loop
    update public.cronograma_meses set updated_at = now() where id = r.mid;
    insert into public.cronograma_historial (mes_id, tipo, despues)
    values (r.mid, p_evento, coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('dias_aplicados', v_aplicados));
  end loop;

  return jsonb_build_object('dias_aplicados', v_aplicados, 'meses', array_length(v_mes_ids, 1));
end;
$$;

-- ── RPCs de plantillas (atómicas: mutación + historial en una transacción) ────
create or replace function public.cronograma_plantilla_crear(p_tipo text, p_nombre text, p_nombre_norm text, p_contenido jsonb)
returns public.cronograma_plantillas
language plpgsql security definer set search_path = public
as $$
declare v_pl public.cronograma_plantillas;
begin
  insert into public.cronograma_plantillas (tipo, nombre, nombre_normalizado, contenido)
  values (p_tipo, p_nombre, p_nombre_norm, p_contenido) returning * into v_pl;
  insert into public.cronograma_plantilla_historial (plantilla_id, tipo, despues)
  values (v_pl.id, 'plantilla_creada', jsonb_build_object('nombre', p_nombre, 'tipo', p_tipo));
  return v_pl;
end;
$$;

create or replace function public.cronograma_plantilla_renombrar(p_id uuid, p_nombre text, p_nombre_norm text)
returns public.cronograma_plantillas
language plpgsql security definer set search_path = public
as $$
declare v_pl public.cronograma_plantillas; v_antes text;
begin
  select nombre into v_antes from public.cronograma_plantillas where id = p_id;
  if v_antes is null then raise exception 'plantilla_inexistente' using errcode = 'P0002'; end if;
  update public.cronograma_plantillas set nombre = p_nombre, nombre_normalizado = p_nombre_norm, updated_at = now()
    where id = p_id returning * into v_pl;
  insert into public.cronograma_plantilla_historial (plantilla_id, tipo, antes, despues)
  values (p_id, 'plantilla_renombrada', jsonb_build_object('nombre', v_antes), jsonb_build_object('nombre', p_nombre));
  return v_pl;
end;
$$;

create or replace function public.cronograma_plantilla_actualizar(p_id uuid, p_contenido jsonb)
returns public.cronograma_plantillas
language plpgsql security definer set search_path = public
as $$
declare v_pl public.cronograma_plantillas;
begin
  update public.cronograma_plantillas set contenido = p_contenido, updated_at = now()
    where id = p_id returning * into v_pl;
  if v_pl.id is null then raise exception 'plantilla_inexistente' using errcode = 'P0002'; end if;
  insert into public.cronograma_plantilla_historial (plantilla_id, tipo, despues)
  values (p_id, 'plantilla_actualizada', jsonb_build_object('actualizado_at', now()));
  return v_pl;
end;
$$;

create or replace function public.cronograma_plantilla_estado(p_id uuid, p_activo boolean)
returns public.cronograma_plantillas
language plpgsql security definer set search_path = public
as $$
declare v_pl public.cronograma_plantillas;
begin
  update public.cronograma_plantillas set activo = p_activo, updated_at = now()
    where id = p_id returning * into v_pl;
  if v_pl.id is null then raise exception 'plantilla_inexistente' using errcode = 'P0002'; end if;
  insert into public.cronograma_plantilla_historial (plantilla_id, tipo)
  values (p_id, case when p_activo then 'plantilla_reactivada' else 'plantilla_archivada' end);
  return v_pl;
end;
$$;

revoke all on function public.cronograma_aplicar_dias(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.cronograma_plantilla_crear(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cronograma_plantilla_renombrar(uuid, text, text) from public, anon, authenticated;
revoke all on function public.cronograma_plantilla_actualizar(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cronograma_plantilla_estado(uuid, boolean) from public, anon, authenticated;
grant execute on function public.cronograma_aplicar_dias(jsonb, text, jsonb) to service_role;
grant execute on function public.cronograma_plantilla_crear(text, text, text, jsonb) to service_role;
grant execute on function public.cronograma_plantilla_renombrar(uuid, text, text) to service_role;
grant execute on function public.cronograma_plantilla_actualizar(uuid, jsonb) to service_role;
grant execute on function public.cronograma_plantilla_estado(uuid, boolean) to service_role;

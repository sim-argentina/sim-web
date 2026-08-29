-- ============================================================================
-- IA SIM · Bloque 2B — Importación de cronogramas PDF/Canva
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- NO almacena el binario del PDF: solo metadata, hash, extracción necesaria y
-- auditoría. NO toca las tablas de empleados (Bloque 1) ni recrea las del Bloque 2.
-- Amplía cronograma_historial de forma aditiva (superset del CHECK).
-- ============================================================================

-- ── cronograma_importaciones ─────────────────────────────────────────────────
create table if not exists public.cronograma_importaciones (
  id             uuid primary key default gen_random_uuid(),
  anio           smallint not null,
  mes            smallint not null,
  mes_id         uuid references public.cronograma_meses(id) on delete set null,
  archivo_nombre text not null,
  archivo_tamano integer not null,
  archivo_hash   text not null,            -- sha256 hex
  paginas        smallint,
  estado         text not null default 'pendiente',
  bloquea_confirmacion boolean not null default false,
  propuesta      jsonb,                     -- días propuestos + correcciones + decisiones de conflicto
  incidencias    jsonb,                     -- incidencias con sus resoluciones
  resumen        jsonb,                     -- resumen final aplicado
  actor          text not null default 'Administrador',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cronograma_importaciones_anio_chk   check (anio between 2020 and 2100),
  constraint cronograma_importaciones_mes_chk    check (mes between 1 and 12),
  constraint cronograma_importaciones_estado_chk check (estado in
    ('pendiente','pendiente_correcciones','aplicada','descartada','rechazada'))
);
create index if not exists cronograma_importaciones_mes_idx on public.cronograma_importaciones (anio, mes);
create index if not exists cronograma_importaciones_bloqueo_idx on public.cronograma_importaciones (anio, mes) where bloquea_confirmacion;
alter table public.cronograma_importaciones enable row level security;
-- Deny-by-default: SIN policies (solo service_role).

-- ── Ampliar el historial (aditivo/idempotente): nuevo tipo importacion_aplicada ──
alter table public.cronograma_historial drop constraint if exists cronograma_historial_tipo_chk;
alter table public.cronograma_historial add constraint cronograma_historial_tipo_chk
  check (tipo in ('mes_creado','dia_guardado','mes_confirmado','correccion_confirmado','importacion_aplicada'));

-- ── RPC: aplicar importación (ATÓMICA) ───────────────────────────────────────
-- Crea el mes como borrador si no existe; aplica SOLO los días recibidos (los que
-- el admin decidió conservar no se envían); guarda jornadas validadas; registra
-- historial con snapshots por día + un evento importacion_aplicada. Nunca confirma.
-- Falla completa (rollback) si cualquier día es inválido. Rechaza si el mes está
-- confirmado o si la importación aún tiene incidencias bloqueantes.
create or replace function public.cronograma_aplicar_importacion(p_import_id uuid, p_dias jsonb)
returns public.cronograma_importaciones
language plpgsql security definer set search_path = public
as $$
declare
  v_imp  public.cronograma_importaciones;
  v_mes  public.cronograma_meses;
  v_dia  public.cronograma_dias;
  v_fecha date;
  v_cerrado boolean;
  v_ap time;
  v_ci time;
  v_jornadas jsonb;
  v_antes jsonb;
  v_despues jsonb;
  v_correccion boolean;
  v_aplicados int := 0;
  d record;
  r record;
begin
  select * into v_imp from public.cronograma_importaciones where id = p_import_id for update;
  if v_imp.id is null then
    raise exception 'importacion_inexistente' using errcode = 'P0002';
  end if;
  if v_imp.estado not in ('pendiente','pendiente_correcciones') then
    raise exception 'importacion_estado_invalido' using errcode = '22023';
  end if;
  if v_imp.bloquea_confirmacion then
    raise exception 'importacion_bloqueante_pendiente' using errcode = '23514';
  end if;

  -- Mes: crear borrador si no existe; rechazar si está confirmado.
  select * into v_mes from public.cronograma_meses where anio = v_imp.anio and mes = v_imp.mes;
  if v_mes.id is not null and v_mes.estado = 'confirmado' then
    raise exception 'mes_confirmado' using errcode = '22023';
  end if;
  if v_mes.id is null then
    insert into public.cronograma_meses (anio, mes) values (v_imp.anio, v_imp.mes) returning * into v_mes;
    insert into public.cronograma_historial (mes_id, tipo, despues)
    values (v_mes.id, 'mes_creado', jsonb_build_object('estado','borrador','anio',v_imp.anio,'mes',v_imp.mes,'origen','importacion'));
  end if;

  for d in select value from jsonb_array_elements(coalesce(p_dias, '[]'::jsonb)) loop
    v_fecha := (d.value->>'fecha')::date;
    v_cerrado := coalesce((d.value->>'cerrado')::boolean, false);
    v_ap := (d.value->>'apertura')::time;
    v_ci := (d.value->>'cierre')::time;
    v_jornadas := coalesce(d.value->'jornadas', '[]'::jsonb);

    if extract(year from v_fecha)::int <> v_imp.anio or extract(month from v_fecha)::int <> v_imp.mes then
      raise exception 'fecha_fuera_de_mes' using errcode = '22007';
    end if;

    -- Solo integrantes activos.
    for r in select (value->>'empleado_id')::uuid as emp from jsonb_array_elements(v_jornadas) loop
      if not exists (select 1 from public.empleados where id = r.emp and activo) then
        raise exception 'integrante_inactivo' using errcode = '23514';
      end if;
    end loop;

    -- Snapshot ANTES.
    select * into v_dia from public.cronograma_dias where mes_id = v_mes.id and fecha = v_fecha;
    if v_dia.id is not null then
      v_antes := jsonb_build_object('cerrado', v_dia.cerrado, 'apertura', v_dia.apertura, 'cierre', v_dia.cierre,
        'jornadas', (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', j.empleado_id, 'hora_inicio', j.hora_inicio, 'hora_fin', j.hora_fin) order by j.hora_inicio), '[]'::jsonb)
                     from public.cronograma_jornadas j where j.dia_id = v_dia.id and j.activo));
    else
      v_antes := null;
    end if;

    -- Upsert del día.
    if v_dia.id is null then
      insert into public.cronograma_dias (mes_id, fecha, cerrado, apertura, cierre)
      values (v_mes.id, v_fecha, v_cerrado, v_ap, v_ci) returning * into v_dia;
    else
      update public.cronograma_dias set cerrado = v_cerrado, apertura = v_ap, cierre = v_ci, updated_at = now()
       where id = v_dia.id returning * into v_dia;
    end if;

    -- Reemplazo de jornadas (baja lógica + alta).
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

    v_correccion := (v_mes.estado = 'confirmado'); -- siempre false aquí (confirmado ya se rechazó)
    insert into public.cronograma_historial (mes_id, fecha, tipo, antes, despues)
    values (v_mes.id, v_fecha, case when v_correccion then 'correccion_confirmado' else 'dia_guardado' end, v_antes, v_despues);

    v_aplicados := v_aplicados + 1;
  end loop;

  update public.cronograma_meses set updated_at = now() where id = v_mes.id;

  update public.cronograma_importaciones
     set estado = 'aplicada', bloquea_confirmacion = false, mes_id = v_mes.id,
         resumen = jsonb_build_object('dias_aplicados', v_aplicados, 'aplicada_at', now()),
         updated_at = now()
   where id = v_imp.id
  returning * into v_imp;

  insert into public.cronograma_historial (mes_id, tipo, despues)
  values (v_mes.id, 'importacion_aplicada',
          jsonb_build_object('import_id', v_imp.id, 'archivo', v_imp.archivo_nombre, 'dias_aplicados', v_aplicados));

  return v_imp;
end;
$$;

-- ── Actualizar cronograma_confirmar: bloquear si hay importación con incidencias bloqueantes ──
create or replace function public.cronograma_confirmar(p_anio int, p_mes int)
returns public.cronograma_meses
language plpgsql security definer set search_path = public
as $$
declare v_mes public.cronograma_meses;
begin
  if exists (select 1 from public.cronograma_importaciones i
             where i.anio = p_anio and i.mes = p_mes and i.bloquea_confirmacion) then
    raise exception 'importacion_bloqueante_pendiente' using errcode = '23514';
  end if;

  update public.cronograma_meses
     set estado = 'confirmado', confirmado_at = coalesce(confirmado_at, now()), updated_at = now()
   where anio = p_anio and mes = p_mes and estado = 'borrador'
  returning * into v_mes;

  if v_mes.id is null then
    select * into v_mes from public.cronograma_meses where anio = p_anio and mes = p_mes;
    if v_mes.id is null then
      raise exception 'mes_inexistente' using errcode = 'P0002';
    end if;
    return v_mes;
  end if;

  insert into public.cronograma_historial (mes_id, tipo, despues)
  values (v_mes.id, 'mes_confirmado', jsonb_build_object('estado','confirmado'));
  return v_mes;
end;
$$;

revoke all on function public.cronograma_aplicar_importacion(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cronograma_aplicar_importacion(uuid, jsonb) to service_role;

-- ============================================================================
-- IA SIM · Bloque 2B (corrección) — Transiciones de estado del cronograma
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO/IDEMPOTENTE.
-- Agrega: estado 'descartado' + reabierto_at; eventos de historial mes_reabierto /
-- borrador_descartado; RPC reabrir / descartar_borrador; reset de 'descartado' en
-- crear_borrador y aplicar_importacion. NO toca empleados ni datos existentes.
--
-- Transiciones permitidas:
--   Sin cronograma → Borrador   (crear_borrador; reactiva 'descartado' vacío)
--   Borrador → Confirmado       (confirmar)
--   Confirmado → Borrador        (reabrir, conserva datos)
--   Borrador → Sin cronograma    (descartar_borrador; desactiva días/jornadas)
--   (Confirmado → Sin cronograma directo NO se permite)
-- ============================================================================

-- Estado 'descartado' = equivalente a "Sin cronograma" para consultas normales,
-- pero conserva la fila (auditoría, unicidad por mes, historial).
alter table public.cronograma_meses drop constraint if exists cronograma_meses_estado_chk;
alter table public.cronograma_meses add constraint cronograma_meses_estado_chk
  check (estado in ('borrador','confirmado','descartado'));

-- Evidencia de la última reapertura (sin borrar confirmado_at).
alter table public.cronograma_meses add column if not exists reabierto_at timestamptz;

-- Nuevos eventos de historial (superset aditivo).
alter table public.cronograma_historial drop constraint if exists cronograma_historial_tipo_chk;
alter table public.cronograma_historial add constraint cronograma_historial_tipo_chk
  check (tipo in ('mes_creado','dia_guardado','mes_confirmado','correccion_confirmado',
                  'importacion_aplicada','mes_reabierto','borrador_descartado'));

-- ── crear_borrador: crea vacío, o REACTIVA un mes 'descartado' como borrador vacío ──
create or replace function public.cronograma_crear_borrador(p_anio int, p_mes int)
returns public.cronograma_meses
language plpgsql security definer set search_path = public
as $$
declare v_mes public.cronograma_meses;
begin
  select * into v_mes from public.cronograma_meses where anio = p_anio and mes = p_mes for update;

  if v_mes.id is null then
    insert into public.cronograma_meses (anio, mes) values (p_anio, p_mes) returning * into v_mes;
    insert into public.cronograma_historial (mes_id, tipo, despues)
    values (v_mes.id, 'mes_creado', jsonb_build_object('estado','borrador','anio',p_anio,'mes',p_mes));
    return v_mes;
  end if;

  if v_mes.estado = 'descartado' then
    -- Garantiza que comienza VACÍO (no reaparecen datos del borrador anterior).
    delete from public.cronograma_dias where mes_id = v_mes.id;
    update public.cronograma_meses set estado = 'borrador', updated_at = now()
      where id = v_mes.id returning * into v_mes;
    insert into public.cronograma_historial (mes_id, tipo, despues)
    values (v_mes.id, 'mes_creado', jsonb_build_object('estado','borrador','anio',p_anio,'mes',p_mes,'origen','reactivacion'));
  end if;

  return v_mes; -- borrador/confirmado existente: sin cambios
end;
$$;

-- ── reabrir: Confirmado → Borrador (conserva días/horarios/jornadas) ──────────
create or replace function public.cronograma_reabrir(p_anio int, p_mes int)
returns public.cronograma_meses
language plpgsql security definer set search_path = public
as $$
declare v_mes public.cronograma_meses;
begin
  update public.cronograma_meses
     set estado = 'borrador', reabierto_at = now(), updated_at = now()
   where anio = p_anio and mes = p_mes and estado = 'confirmado'
  returning * into v_mes;

  if v_mes.id is null then
    select * into v_mes from public.cronograma_meses where anio = p_anio and mes = p_mes;
    if v_mes.id is null then
      raise exception 'mes_inexistente' using errcode = 'P0002';
    end if;
    raise exception 'transicion_invalida' using errcode = '22023'; -- no estaba confirmado
  end if;

  insert into public.cronograma_historial (mes_id, tipo, antes, despues)
  values (v_mes.id, 'mes_reabierto',
          jsonb_build_object('estado','confirmado','confirmado_at', v_mes.confirmado_at),
          jsonb_build_object('estado','borrador','reabierto_at', v_mes.reabierto_at));
  return v_mes;
end;
$$;

-- ── descartar_borrador: Borrador → Sin cronograma (desactiva días/jornadas) ────
create or replace function public.cronograma_descartar_borrador(p_anio int, p_mes int)
returns public.cronograma_meses
language plpgsql security definer set search_path = public
as $$
declare v_mes public.cronograma_meses; v_dias int; v_jorn int; v_imps int;
begin
  select * into v_mes from public.cronograma_meses where anio = p_anio and mes = p_mes for update;
  if v_mes.id is null then
    raise exception 'mes_inexistente' using errcode = 'P0002';
  end if;
  if v_mes.estado <> 'borrador' then
    raise exception 'transicion_invalida' using errcode = '22023'; -- solo desde borrador
  end if;

  select count(*) into v_dias from public.cronograma_dias where mes_id = v_mes.id;
  select count(*) into v_jorn from public.cronograma_jornadas j
    join public.cronograma_dias d on d.id = j.dia_id where d.mes_id = v_mes.id and j.activo;

  -- Descartar lógicamente importaciones pendientes vinculadas (liberan el bloqueo).
  update public.cronograma_importaciones
     set estado = 'descartada', bloquea_confirmacion = false, updated_at = now()
   where anio = p_anio and mes = p_mes and estado in ('pendiente','pendiente_correcciones');
  get diagnostics v_imps = row_count;

  -- Desactivar los datos del borrador (cascade elimina jornadas).
  delete from public.cronograma_dias where mes_id = v_mes.id;

  update public.cronograma_meses set estado = 'descartado', updated_at = now()
    where id = v_mes.id returning * into v_mes;

  insert into public.cronograma_historial (mes_id, tipo, antes, despues)
  values (v_mes.id, 'borrador_descartado',
          jsonb_build_object('estado','borrador','dias', v_dias, 'jornadas', v_jorn, 'importaciones_descartadas', v_imps),
          jsonb_build_object('estado','descartado'));
  return v_mes;
end;
$$;

-- ── aplicar_importacion: manejar mes 'descartado' (reactivar a borrador vacío) ──
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
  v_aplicados int := 0;
  d record;
  r record;
begin
  select * into v_imp from public.cronograma_importaciones where id = p_import_id for update;
  if v_imp.id is null then raise exception 'importacion_inexistente' using errcode = 'P0002'; end if;
  if v_imp.estado not in ('pendiente','pendiente_correcciones') then
    raise exception 'importacion_estado_invalido' using errcode = '22023';
  end if;
  if v_imp.bloquea_confirmacion then
    raise exception 'importacion_bloqueante_pendiente' using errcode = '23514';
  end if;

  select * into v_mes from public.cronograma_meses where anio = v_imp.anio and mes = v_imp.mes;
  if v_mes.id is not null and v_mes.estado = 'confirmado' then
    raise exception 'mes_confirmado' using errcode = '22023';
  end if;
  if v_mes.id is null then
    insert into public.cronograma_meses (anio, mes) values (v_imp.anio, v_imp.mes) returning * into v_mes;
    insert into public.cronograma_historial (mes_id, tipo, despues)
    values (v_mes.id, 'mes_creado', jsonb_build_object('estado','borrador','anio',v_imp.anio,'mes',v_imp.mes,'origen','importacion'));
  elsif v_mes.estado = 'descartado' then
    delete from public.cronograma_dias where mes_id = v_mes.id;
    update public.cronograma_meses set estado = 'borrador', updated_at = now() where id = v_mes.id returning * into v_mes;
    insert into public.cronograma_historial (mes_id, tipo, despues)
    values (v_mes.id, 'mes_creado', jsonb_build_object('estado','borrador','anio',v_imp.anio,'mes',v_imp.mes,'origen','importacion_reactivacion'));
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

  update public.cronograma_meses set updated_at = now() where id = v_mes.id;

  update public.cronograma_importaciones
     set estado = 'aplicada', bloquea_confirmacion = false, mes_id = v_mes.id,
         resumen = jsonb_build_object('dias_aplicados', v_aplicados, 'aplicada_at', now()), updated_at = now()
   where id = v_imp.id returning * into v_imp;

  insert into public.cronograma_historial (mes_id, tipo, despues)
  values (v_mes.id, 'importacion_aplicada',
          jsonb_build_object('import_id', v_imp.id, 'archivo', v_imp.archivo_nombre, 'dias_aplicados', v_aplicados));
  return v_imp;
end;
$$;

revoke all on function public.cronograma_reabrir(int, int) from public, anon, authenticated;
revoke all on function public.cronograma_descartar_borrador(int, int) from public, anon, authenticated;
grant execute on function public.cronograma_reabrir(int, int) to service_role;
grant execute on function public.cronograma_descartar_borrador(int, int) to service_role;

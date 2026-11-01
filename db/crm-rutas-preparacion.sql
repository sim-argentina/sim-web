-- ============================================================================
-- CRM B2B · Preparación de rutas — negocios importados para visitar.
-- ----------------------------------------------------------------------------
-- Necesita B0–B3 (db/orden.txt). Aditivo e idempotente.
--
-- Qué agrega:
--   · crm_empresas.recorrido_tramo / recorrido_orden: tramo y parada del
--     documento de ruta (la ruta es la zona). Orden de recorrido propuesto, no una
--     jornada ni una agenda.
--   · crm_empresas.notas_preparacion: lo que la investigación aporta y el CRM no
--     tiene como campo propio (ID de investigación, fuente, fecha de consulta,
--     enlaces, rubro de la fuente, cuenta o vínculo sugerido, «Para la visita» y
--     advertencias). Texto de preparación: no es visita, contacto, interés,
--     necesidad ni presupuesto.
--   · crm_empresa_importar: alta de Administración con origen 'importacion' y
--     origen_ref = ID de investigación (índice único existente desde B1). Usa las
--     mismas validaciones de crm_empresa_insertar y crm_contacto_insertar; si el
--     ID ya fue importado devuelve 'ya_aplicado' sin tocar nada (reejecución).
--
-- Qué NO hace: no crea jornadas, visitas, oportunidades, tareas ni gestiones; no
-- modifica negocios existentes ni los fusiona; no marca decisores (los contactos
-- quedan es_decisor = 'no_sabe'); no escribe fuera de crm_*.
-- ============================================================================

alter table public.crm_empresas add column if not exists recorrido_tramo text;
alter table public.crm_empresas add column if not exists recorrido_orden integer;
alter table public.crm_empresas add column if not exists notas_preparacion text;

alter table public.crm_empresas drop constraint if exists crm_empresas_recorrido_chk;
alter table public.crm_empresas add constraint crm_empresas_recorrido_chk check (
  (recorrido_tramo is null or (recorrido_tramo = btrim(recorrido_tramo) and char_length(recorrido_tramo) between 1 and 120))
  and (recorrido_orden is null or recorrido_orden between 1 and 10000)
  and (notas_preparacion is null or char_length(notas_preparacion) between 1 and 4000));

create index if not exists crm_empresas_recorrido_idx on public.crm_empresas (zona_id, recorrido_orden) where archivada_en is null;

comment on column public.crm_empresas.notas_preparacion is
  'Preparación de la visita (importación): fuente, fecha, enlaces y advertencias. No acredita contacto, interés ni presupuesto.';

create or replace function public.crm_empresa_importar(p_lote text, p_ref text, p_datos jsonb, p_contactos jsonb,
  p_actor_rol text, p_actor_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lote text := nullif(btrim(coalesce(p_lote, '')), '');
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_existente uuid;
  v_responsable uuid;
  v_tramo text;
  v_orden numeric;
  v_notas text;
  v_res jsonb;
  v_id uuid;
  v_c jsonb;
  v_n integer := 0;
begin
  perform public.crm_exigir_admin(p_actor_rol, p_actor_usuario);
  if v_lote is null or char_length(v_lote) > 60 then
    raise exception 'datos_invalidos:lote' using errcode = '22023';
  end if;
  if v_ref is null or char_length(v_ref) > 200 then
    raise exception 'datos_invalidos:ref' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_importacion:' || v_ref, 0));
  select id into v_existente from public.crm_empresas where origen = 'importacion' and origen_ref = v_ref;
  if found then
    return jsonb_build_object('resultado', 'ya_aplicado', 'id', v_existente);
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos_invalidos:empresa' using errcode = '22023';
  end if;
  perform public.crm_claves_permitidas(p_datos, array['nombre_comercial', 'rubro_id', 'rubro_detalle', 'direccion', 'zona_id', 'instagram', 'web',
    'prioridad', 'responsable_id', 'recorrido_tramo', 'recorrido_orden', 'notas_preparacion']);
  if p_contactos is not null and (jsonb_typeof(p_contactos) <> 'array' or jsonb_array_length(p_contactos) > 5) then
    raise exception 'datos_invalidos:contactos' using errcode = '22023';
  end if;
  v_responsable := public.crm_uuid(p_datos, 'responsable_id');
  if v_responsable is not null and not exists (select 1 from public.crm_usuarios where id = v_responsable and activo) then
    raise exception 'datos_invalidos:responsable_id' using errcode = '22023';
  end if;
  v_tramo := public.crm_texto(p_datos, 'recorrido_tramo', 120);
  v_orden := public.crm_numero(p_datos, 'recorrido_orden', 10000);
  if v_orden is not null and (v_orden <> trunc(v_orden) or v_orden < 1) then
    raise exception 'datos_invalidos:recorrido_orden' using errcode = '22023';
  end if;
  -- Las notas conservan sus saltos de línea (crm_texto los colapsa): se normalizan los
  -- espacios dentro de cada línea y las líneas vacías, con el mismo tope de 4000.
  if p_datos ? 'notas_preparacion' and jsonb_typeof(p_datos -> 'notas_preparacion') not in ('string', 'null') then
    raise exception 'datos_invalidos:notas_preparacion' using errcode = '22023';
  end if;
  v_notas := nullif(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_datos ->> 'notas_preparacion', ''),
    '[ \t\r\f\v]+', ' ', 'g'), ' *\n *', E'\n', 'g'), E'\n{2,}', E'\n', 'g'), E' \n'), '');
  if v_notas is not null and char_length(v_notas) > 4000 then
    raise exception 'datos_invalidos:notas_preparacion' using errcode = '22023';
  end if;

  -- Mismas validaciones y aviso de parecidos que un alta manual; los parecidos se
  -- confirman (quedan en similar_a para revisión) porque una sucursal es otro punto.
  v_res := public.crm_empresa_insertar(p_datos - 'responsable_id' - 'recorrido_tramo' - 'recorrido_orden' - 'notas_preparacion', true,
    p_actor_rol, p_actor_usuario, v_responsable, 'importacion', false);
  v_id := (v_res ->> 'id')::uuid;
  update public.crm_empresas
     set origen_ref = v_ref, recorrido_tramo = v_tramo, recorrido_orden = v_orden::integer, notas_preparacion = v_notas
   where id = v_id;

  for v_c in select * from jsonb_array_elements(coalesce(p_contactos, '[]'::jsonb)) loop
    perform public.crm_claves_permitidas(v_c, array['nombre', 'cargo', 'telefono', 'tiene_whatsapp']);
    perform public.crm_contacto_insertar(v_id, v_c, p_actor_rol, p_actor_usuario);
    v_n := v_n + 1;
  end loop;

  perform public.crm_auditar_entidad(p_actor_rol, p_actor_usuario, 'crm_empresas', v_id, 'registro',
    jsonb_build_object('lote', v_lote, 'origen_ref', v_ref, 'contactos', v_n));
  return jsonb_build_object('resultado', 'ok', 'id', v_id, 'contactos', v_n,
    'similares', (select cardinality(similar_a) from public.crm_empresas where id = v_id));
end
$fn$;

revoke all on function public.crm_empresa_importar(text, text, jsonb, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_empresa_importar(text, text, jsonb, jsonb, text, uuid) to service_role;

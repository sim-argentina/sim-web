-- ============================================================================
-- Verificación del CRM B2B · Bloque 1 (prospección y visitas).
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un bloque que termina en RAISE: se deshace entero. Para
-- el entorno LOCAL del CRM, como postgres:
--   node scripts/pruebas/crm-local.mjs sql db/crm-b1-prospeccion.verificacion.sql
-- Resultado: "RESULTADO CRM-B1|OK n" o la lista de "FALLA:".
-- ============================================================================
do $crmb1$
declare
  v_fallas text := '';
  v_ok integer := 0;
  h text := 'scrypt$17$8$1$' || repeat('A', 22) || '$' || repeat('B', 43);
  hu text := repeat('a', 64);
  hu2 text := repeat('b', 64);
  u_tob uuid; u_otro uuid;
  z uuid; r uuid;
  e1 uuid; e2 uuid; e_ajena uuid;
  c1 uuid; c_ajeno uuid;
  j1 uuid; j2 uuid; j_ajena uuid; j_ayer uuid;
  v1 uuid; v2 uuid; v3 uuid;
  o1 uuid;
  x jsonb; y jsonb;
  n integer; t text; b boolean;
  rpcs text[] := array['crm_catalogo_guardar(text,uuid,integer,jsonb,text,uuid)', 'crm_empresa_crear(jsonb,boolean,text,uuid)',
    'crm_empresa_actualizar(uuid,integer,jsonb,text,uuid)', 'crm_empresa_archivar(uuid,integer,boolean,text,text,uuid)',
    'crm_contacto_crear(uuid,jsonb,text,uuid)', 'crm_contacto_actualizar(uuid,integer,jsonb,text,uuid)', 'crm_jornada_crear(jsonb,text,uuid)',
    'crm_jornada_actualizar(uuid,integer,jsonb,boolean,text,uuid)', 'crm_visita_registrar(uuid,text,jsonb,text,uuid)',
    'crm_visita_corregir(uuid,integer,jsonb,text,text,uuid)', 'crm_visita_anular(uuid,integer,text,text,uuid,text,uuid)',
    'crm_visita_nota_agregar(uuid,text,text,uuid)', 'crm_tarea_actualizar(uuid,integer,text,date,text,text,uuid)'];
  internas text[] := array['crm_normalizar_texto(text)', 'crm_normalizar_telefono(text)', 'crm_fecha_sim(timestamptz)', 'crm_texto(jsonb,text,integer)',
    'crm_uuid(jsonb,text)', 'crm_bool(jsonb,text)', 'crm_numero(jsonb,text,numeric)', 'crm_fecha(jsonb,text)', 'crm_claves_permitidas(jsonb,text[])',
    'crm_actor_validar(text,uuid)', 'crm_exigir_admin(text,uuid)', 'crm_auditar_entidad(text,uuid,text,uuid,text,jsonb)',
    'crm_empresa_para_actor(uuid,text,uuid)', 'crm_empresas_similares(text,text,uuid)', 'crm_empresa_insertar(jsonb,boolean,text,uuid,uuid,text,boolean)',
    'crm_contacto_insertar(uuid,jsonb,text,uuid)', 'crm_oportunidad_recalcular(uuid)', 'crm_visita_resultado(uuid,boolean)'];
  tablas text[] := array['crm_rubros', 'crm_zonas', 'crm_empresas', 'crm_contactos', 'crm_jornadas', 'crm_visitas', 'crm_oportunidades', 'crm_visita_notas', 'crm_tareas'];
  f text; rol text;
begin
  -- ── T1. Tablas: RLS, sin policies, privilegios ────────────────────────────
  foreach t in array tablas loop
    select c.relrowsecurity into b from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname = t;
    if b and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T1 rls ' || t; end if;
    foreach rol in array array['anon', 'authenticated'] loop
      if has_table_privilege(rol, 'public.' || t, 'select, insert, update, delete, truncate, references, trigger') then v_fallas := v_fallas || ' FALLA:T1 ' || rol || ' en ' || t; else v_ok := v_ok + 1; end if;
    end loop;
    if has_table_privilege('service_role', 'public.' || t, 'select') and not has_table_privilege('service_role', 'public.' || t, 'insert, update, delete, truncate') then v_ok := v_ok + 1;
    else v_fallas := v_fallas || ' FALLA:T1 service_role en ' || t; end if;
  end loop;

  -- ── T2. Funciones: definer, search_path y EXECUTE ─────────────────────────
  foreach f in array rpcs loop
    select p.prosecdef and coalesce('search_path=public' = any (p.proconfig), false) into b from pg_proc p where p.oid = ('public.' || f)::regprocedure;
    if b and has_function_privilege('service_role', 'public.' || f, 'execute') and not has_function_privilege('anon', 'public.' || f, 'execute')
       and not has_function_privilege('authenticated', 'public.' || f, 'execute')
       and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = ('public.' || f)::regprocedure and a.grantee = 0)
    then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 ' || f; end if;
  end loop;
  foreach f in array internas loop
    select not p.prosecdef and coalesce('search_path=public' = any (p.proconfig), false) into b from pg_proc p where p.oid = ('public.' || f)::regprocedure;
    if b and not has_function_privilege('service_role', 'public.' || f, 'execute') and not has_function_privilege('anon', 'public.' || f, 'execute')
       and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = ('public.' || f)::regprocedure and a.grantee = 0)
    then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 interna ' || f; end if;
  end loop;

  -- ── T3. Catálogo inicial y normalización ──────────────────────────────────
  if (select count(*) from public.crm_rubros where activo) >= 14 and exists (select 1 from public.crm_rubros where nombre = 'Peluquerías') then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T3 rubros iniciales'; end if;
  if public.crm_normalizar_texto('  Lubricentro  Ñandú S.A. ') = 'lubricentro nandu s a' and public.crm_normalizar_texto('ÓPTICA ÑANDÚ') = 'optica nandu'
     and public.crm_normalizar_telefono('0351 15-555-1234') = '54351155551234'
     and public.crm_normalizar_telefono('+54 9 351 555-1234') = '5493515551234' and public.crm_normalizar_telefono('(351) 555-1234') = '543515551234'
     and public.crm_normalizar_telefono('abc') is null then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T3 normalización'; end if;
  if public.crm_fecha_sim('2026-10-30 02:59:59+00') = '2026-10-29' and public.crm_fecha_sim('2026-10-30 03:00:00+00') = '2026-10-30' then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T3 medianoche de Córdoba'; end if;

  -- ── Fixtures (todo se revierte) ───────────────────────────────────────────
  u_tob := (public.crm_usuario_crear('zzcrmb1.tob', 'Tob', h, 'admin') ->> 'id')::uuid;
  u_otro := (public.crm_usuario_crear('zzcrmb1.otro', 'Otro', h, 'admin') ->> 'id')::uuid;
  z := (public.crm_catalogo_guardar('zona', null, null, '{"nombre":"ZZ Centro B1"}', 'admin', null) ->> 'id')::uuid;
  select id into r from public.crm_rubros where nombre = 'Peluquerías';

  -- ── T4. Negocios: alta sin visita, rubro no listado, duplicados, alcance ──
  x := public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZ Peluquería Norte', 'zona_id', z, 'rubro_id', r), false, 'admin', null);
  e1 := (x ->> 'id')::uuid;
  update public.crm_empresas set responsable_id = u_tob where id = e1;
  if x ->> 'resultado' = 'ok' and not exists (select 1 from public.crm_visitas where empresa_id = e1) and not exists (select 1 from public.crm_oportunidades where empresa_id = e1)
     and not exists (select 1 from public.crm_jornadas where usuario_id = u_tob) then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T4 alta sin visita'; end if;
  x := public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZ Vivero Las Rosas', 'rubro_detalle', 'Vivero y paisajismo'), false, 'comercial', u_tob);
  e2 := (x ->> 'id')::uuid;
  if (select rubro_id is null and rubro_detalle = 'Vivero y paisajismo' and responsable_id = u_tob and not cliente_previo from public.crm_empresas where id = e2) then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T4 rubro no listado / asignación propia'; end if;
  begin
    perform public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZ Otra', 'responsable_id', u_otro), false, 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T4 comercial fijó responsable';
  exception when others then if sqlerrm = 'no_autorizado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T4 ' || sqlerrm; end if; end;
  e_ajena := (public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZ Gimnasio Ajeno', 'direccion', 'Av. Siempre Viva 742', 'responsable_id', u_otro), false, 'admin', null) ->> 'id')::uuid;
  x := public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'zz gimnasio ajeno'), false, 'comercial', u_tob);
  if x ->> 'resultado' = 'posible_duplicado' and not ((x -> 'candidatos' -> 0) ? 'id') and not ((x -> 'candidatos' -> 0) ? 'direccion')
     and x -> 'candidatos' -> 0 ->> 'asignacion' = 'otra_persona' then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T4 duplicado ajeno sin datos privados ' || x::text; end if;
  x := public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZ Gimnasio Ajeno', 'direccion', 'Otra calle 1'), true, 'comercial', u_tob);
  if x ->> 'resultado' = 'ok' and (select e_ajena = any (similar_a) from public.crm_empresas where id = (x ->> 'id')::uuid) then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T4 sucursal confirmada'; end if;
  begin
    perform public.crm_empresa_actualizar(e_ajena, 1, '{"prioridad":"A"}', 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T4 editó negocio ajeno';
  exception when others then if sqlerrm = 'empresa_no_encontrada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T4 ' || sqlerrm; end if; end;

  -- ── T5. Contactos: teléfono compartido, incompleto, IDs cruzados ─────────
  c1 := (public.crm_contacto_crear(e1, '{"nombre":"Encargada","telefono":"351 555 1234"}', 'comercial', u_tob) ->> 'id')::uuid;
  perform public.crm_contacto_crear(e1, '{"nombre":"Dueño","telefono":"(351) 555-1234","es_decisor":"si"}', 'comercial', u_tob);
  perform public.crm_contacto_crear(e1, '{"nombre":"Sin teléfono"}', 'comercial', u_tob);
  if (select count(*) from public.crm_contactos where empresa_id = e1 and telefono_normalizado = '543515551234') = 2 then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 teléfono compartido'; end if;
  c_ajeno := (public.crm_contacto_crear(e_ajena, '{"nombre":"Ajeno","telefono":"3515550000"}', 'admin', null) ->> 'id')::uuid;
  begin
    perform public.crm_contacto_crear(e_ajena, '{"nombre":"Intruso"}', 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T5 contacto en negocio ajeno';
  exception when others then if sqlerrm = 'empresa_no_encontrada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 ' || sqlerrm; end if; end;
  begin
    perform public.crm_contacto_actualizar(c_ajeno, 1, '{"cargo":"x"}', 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T5 editó contacto ajeno';
  exception when others then if sqlerrm = 'contacto_no_encontrado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 ' || sqlerrm; end if; end;

  -- ── T6. Jornadas: una abierta, varias por día, km y gastos ───────────────
  j1 := (public.crm_jornada_crear('{"nombre":"Mañana"}', 'comercial', u_tob) ->> 'id')::uuid;
  begin
    perform public.crm_jornada_crear('{}', 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T6 dos abiertas';
  exception when others then if sqlerrm = 'jornada_abierta' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T6 ' || sqlerrm; end if; end;
  begin
    perform public.crm_jornada_actualizar(j1, 1, '{"km_inicial":100,"km_final":90}', false, 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T6 km final menor';
  exception when others then if sqlerrm = 'km_final_menor' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T6 ' || sqlerrm; end if; end;
  begin
    perform public.crm_jornada_actualizar(j1, 1, '{"peajes_importe":-1}', false, 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T6 importe negativo';
  exception when others then if sqlerrm like 'datos_invalidos:%' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T6 ' || sqlerrm; end if; end;
  perform public.crm_jornada_actualizar(j1, 1, '{"km_inicial":1000,"estacionamiento_importe":0}', true, 'comercial', u_tob);
  select * into x from (select to_jsonb(j) from public.crm_jornadas j where id = j1) s;
  if x ->> 'km_recorridos' is null and x ->> 'estacionamiento_importe' = '0.00' and x ->> 'peajes_importe' is null and x ->> 'cerrada_en' is not null then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T6 pendientes vs cero ' || x::text; end if;
  j2 := (public.crm_jornada_crear('{"nombre":"Tarde"}', 'comercial', u_tob) ->> 'id')::uuid;
  if (select count(*) from public.crm_jornadas where usuario_id = u_tob and fecha = public.crm_fecha_sim(now())) = 2 then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T6 varias por día'; end if;
  j_ajena := (public.crm_jornada_crear('{}', 'comercial', u_otro) ->> 'id')::uuid;

  -- ── T7. Visitas: empleado entrega el teléfono del dueño (contacto útil sin decisor) ──
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e1, 'hablo_con_empleado', true,
    'responsable_ausente', true, 'contacto_nuevo', jsonb_build_object('nombre', 'Dueño Real', 'telefono', '+54 9 351 444-1111', 'es_decisor', 'si'),
    'contacto_obtenido', true, 'necesidades', '["fidelizacion","sorteos"]'::jsonb, 'pack_potencial', '10'), 'comercial', u_tob);
  v1 := (x -> 'visita' ->> 'id')::uuid;
  o1 := (x -> 'oportunidad' ->> 'id')::uuid;
  if (x -> 'visita' ->> 'contacto_util')::boolean and not (x -> 'visita' ->> 'decisor_contactado')::boolean and x -> 'visita' ->> 'interes' is null
     and x -> 'oportunidad' ->> 'estado' = 'contacto' and (x -> 'oportunidad' ->> 'creada')::boolean
     and (select origen_visita_id = v1 and origen_usuario_id = u_tob from public.crm_oportunidades where id = o1) then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T7 contacto útil sin decisor ' || x::text; end if;

  -- Reintento: misma clave y huella → mismo resultado; otra huella → rechazo.
  y := public.crm_visita_registrar((select clave from public.crm_visitas where id = v1), hu, '{}', 'comercial', u_tob);
  if (y ->> 'repetida')::boolean and (y -> 'visita' ->> 'id')::uuid = v1 and (select count(*) from public.crm_visitas where empresa_id = e1) = 1 then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T7 reintento'; end if;
  begin
    perform public.crm_visita_registrar((select clave from public.crm_visitas where id = v1), hu2, '{}', 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T7 misma clave otro contenido';
  exception when others then if sqlerrm = 'clave_reutilizada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 ' || sqlerrm; end if; end;
  begin
    perform public.crm_visita_registrar((select clave from public.crm_visitas where id = v1), hu, '{}', 'comercial', u_otro);
    v_fallas := v_fallas || ' FALLA:T7 clave de otro actor';
  exception when others then if sqlerrm = 'clave_reutilizada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 ' || sqlerrm; end if; end;

  -- Visita posterior caliente → interesado; sin interés evaluado → no retrocede; atribución intacta.
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e1, 'hablo_con_responsable', true,
    'interes', 'caliente', 'volver_otro_dia', true), 'comercial', u_tob);
  v2 := (x -> 'visita' ->> 'id')::uuid;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e1, 'cerrado', true), 'comercial', u_tob);
  v3 := (x -> 'visita' ->> 'id')::uuid;
  if (select estado = 'interesado' and origen_visita_id = v1 from public.crm_oportunidades where id = o1)
     and (select count(*) from public.crm_oportunidades where empresa_id = e1) = 1
     and (select count(*) from public.crm_contactos where empresa_id = e1) = 4
     and (select estado from public.crm_tareas where origen_visita_id = v2) = 'hecha' then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T7 avance, sin retroceso, cerrado sin borrar, revisita resuelta'; end if;

  -- Cerrado con interés → rechazo; sin resultado → rechazo; interés no evaluado ≠ sin interés.
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e1, 'cerrado', true, 'interes', 'frio'), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T7 cerrado con interés';
  exception when others then if sqlerrm = 'datos_invalidos:cerrado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 ' || sqlerrm; end if; end;
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e1), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T7 sin resultado';
  exception when others then if sqlerrm = 'datos_invalidos:resultado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 ' || sqlerrm; end if; end;
  if (select interes is null from public.crm_visitas where id = v3) then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 interés inventado'; end if;

  -- Contacto existente sin marcar obtenido → no crea oportunidad (en un negocio sin oportunidad).
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e2, 'hablo_con_empleado', true,
    'contacto_nuevo', jsonb_build_object('nombre', 'Vendedor', 'telefono', '3515559999')), 'comercial', u_tob);
  if x -> 'oportunidad' = 'null'::jsonb and not exists (select 1 from public.crm_oportunidades where empresa_id = e2) then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T7 contacto sin marcar creó oportunidad'; end if;
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e2, 'hablo_con_empleado', true,
      'contacto_nuevo', jsonb_build_object('nombre', 'Sin canal'), 'contacto_obtenido', true), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T7 contacto útil sin canal';
  exception when others then if sqlerrm = 'contacto_sin_canal' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 ' || sqlerrm; end if; end;
  if not exists (select 1 from public.crm_contactos where nombre = 'Sin canal') then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 contacto a medias'; end if;

  -- Atomicidad: negocio nuevo + contacto inválido → no queda el negocio.
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_nueva', jsonb_build_object('nombre_comercial', 'ZZ Atomico B1'),
      'hablo_con_empleado', true, 'contacto_nuevo', jsonb_build_object('nombre', 'X', 'telefono', '12')), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T8 teléfono inválido aceptado';
  exception when others then null; end;
  if not exists (select 1 from public.crm_empresas where nombre_comercial = 'ZZ Atomico B1') then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 negocio a medias'; end if;

  -- ── T8. IDs cruzados y alcance ───────────────────────────────────────────
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j_ajena, 'empresa_id', e1, 'cerrado', true), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T8 jornada ajena';
  exception when others then if sqlerrm = 'jornada_no_encontrada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 ' || sqlerrm; end if; end;
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e_ajena, 'cerrado', true), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T8 negocio ajeno';
  exception when others then if sqlerrm = 'empresa_no_encontrada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 ' || sqlerrm; end if; end;
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e1, 'hablo_con_empleado', true,
      'contacto_id', c_ajeno, 'contacto_obtenido', true), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T8 contacto de otro negocio';
  exception when others then if sqlerrm = 'contacto_no_encontrado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 ' || sqlerrm; end if; end;
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j2, 'empresa_id', e1, 'cerrado', true, 'realizada_por', u_otro), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T8 comercial eligió autor';
  exception when others then if sqlerrm = 'no_autorizado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 ' || sqlerrm; end if; end;
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j1, 'empresa_id', e1, 'cerrado', true), 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T8 jornada cerrada';
  exception when others then if sqlerrm = 'jornada_cerrada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 ' || sqlerrm; end if; end;

  -- ── T9. Medianoche y carga administrativa (realizada por ≠ cargada por) ──
  j_ayer := (public.crm_jornada_crear(jsonb_build_object('usuario_id', u_tob, 'fecha', public.crm_fecha_sim(now()) - 3), 'admin', null) ->> 'id')::uuid;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j_ayer, 'empresa_id', e2, 'cerrado', true, 'realizada_por', u_tob,
    'ocurrida_en', ((public.crm_fecha_sim(now()) - 2)::timestamp + interval '0 hours 10 minutes') at time zone 'America/Argentina/Cordoba'), 'admin', null);
  if (select realizada_por_usuario = u_tob and registrada_por_rol = 'admin' and fecha = public.crm_fecha_sim(now()) - 2 from public.crm_visitas where id = (x -> 'visita' ->> 'id')::uuid)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T9 cruce de medianoche'; end if;
  begin
    perform public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j_ayer, 'empresa_id', e2, 'cerrado', true, 'realizada_por', u_tob,
      'ocurrida_en', ((public.crm_fecha_sim(now()) - 1)::timestamp + interval '10 minutes') at time zone 'America/Argentina/Cordoba'), 'admin', null);
    v_fallas := v_fallas || ' FALLA:T9 dos días después';
  exception when others then if sqlerrm = 'jornada_de_otra_fecha' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T9 ' || sqlerrm; end if; end;

  -- ── T10. Anulación: la visita origen exige resolución explícita ───────────
  begin
    perform public.crm_visita_anular(v1, 1, 'Cargada por error', null, null, 'admin', null);
    v_fallas := v_fallas || ' FALLA:T10 anuló origen sin resolver';
  exception when others then if sqlerrm = 'resolucion_requerida' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 ' || sqlerrm; end if; end;
  begin
    perform public.crm_visita_anular(v1, 1, 'x', 'reasignar_origen', v2, 'admin', null);
    v_fallas := v_fallas || ' FALLA:T10 reasignó a una visita sin contacto útil';
  exception when others then if sqlerrm = 'datos_invalidos:nuevo_origen' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 ' || sqlerrm; end if; end;
  begin
    perform public.crm_visita_anular(v1, 1, 'x', 'cerrar_oportunidad', null, 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T10 comercial anuló';
  exception when others then if sqlerrm = 'no_autorizado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 ' || sqlerrm; end if; end;
  perform public.crm_visita_anular(v1, 1, 'Cargada por error', 'cerrar_oportunidad', null, 'admin', null);
  if (select cerrada_en is not null and cierre_motivo = 'origen_anulado' from public.crm_oportunidades where id = o1)
     and (select anulada_en is not null and oportunidad_id = o1 from public.crm_visitas where id = v1)
     and exists (select 1 from public.crm_auditoria where entidad_id = v1 and accion = 'anulacion') then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T10 cierre por anulación'; end if;
  -- Corrección con motivo; el comercial no corrige.
  begin
    perform public.crm_visita_corregir(v2, 1, '{"interes":"tibio"}', 'x', 'comercial', u_tob);
    v_fallas := v_fallas || ' FALLA:T10 comercial corrigió';
  exception when others then if sqlerrm = 'no_autorizado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 ' || sqlerrm; end if; end;
  perform public.crm_visita_nota_agregar(v2, 'Me olvidé: pidió precio por WhatsApp', 'comercial', u_tob);
  if (select count(*) from public.crm_visita_notas where visita_id = v2) = 1 and (select interes from public.crm_visitas where id = v2) = 'caliente' then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T10 nota no reemplaza'; end if;

  -- ── T11. Auditoría sin material sensible ─────────────────────────────────
  select count(*) into n from public.crm_auditoria a where a.datos::text like '%scrypt%' or a.datos::text like '%555-1234%' or a.datos::text like '%444-1111%';
  if n = 0 then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 auditoría con datos sensibles'; end if;

  if v_fallas = '' then
    raise exception 'RESULTADO CRM-B1|OK %', v_ok;
  end if;
  raise exception 'RESULTADO CRM-B1|% bien;%', v_ok, v_fallas;
end
$crmb1$;

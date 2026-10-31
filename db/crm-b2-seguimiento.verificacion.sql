-- ============================================================================
-- Verificación del CRM B2B · Bloque 2 (seguimiento comercial de Administración).
-- ----------------------------------------------------------------------------
-- Las auxiliares viven en pg_temp (mueren con la sesión) y las pruebas corren
-- dentro de un bloque que termina en RAISE: se deshace entero. Para el entorno
-- LOCAL del CRM, como postgres:
--   node scripts/pruebas/crm-local.mjs sql db/crm-b2-seguimiento.verificacion.sql
-- Resultado: "RESULTADO CRM-B2|OK n" o la lista de "FALLA:".
-- ============================================================================
create or replace function pg_temp.gest(p_op uuid, p_accion text, p_datos jsonb)
returns jsonb language plpgsql as $f$
begin
  return public.crm_oportunidad_gestionar(gen_random_uuid(), encode(sha256(convert_to(random()::text, 'UTF8')), 'hex'), p_op,
    (select version from public.crm_oportunidades where id = p_op), p_accion, p_datos, 'admin', null);
end $f$;

create or replace function pg_temp.falla(p_op uuid, p_accion text, p_datos jsonb)
returns text language plpgsql as $f$
begin
  perform pg_temp.gest(p_op, p_accion, p_datos);
  return 'sin error';
exception when others then
  return sqlerrm;
end $f$;

do $crmb2$
declare
  v_fallas text := '';
  v_ok integer := 0;
  h text := 'scrypt$17$8$1$' || repeat('A', 22) || '$' || repeat('B', 43);
  hu text := repeat('a', 64);
  hoy date := public.crm_fecha_sim(now());
  u uuid; e uuid; e2 uuid; j uuid; c uuid; v1 uuid; v2 uuid; o uuid; o2 uuid; s1 uuid; s2 uuid; k uuid;
  x jsonb; y jsonb; n integer; t text; ver integer; tarea_b1 uuid;
begin
  -- ── T1. Privilegios y estructura ──────────────────────────────────────────
  if not has_function_privilege('service_role', 'public.crm_rango_estado(text)', 'EXECUTE')
     and not has_function_privilege('service_role', 'public.crm_oportunidad_recalcular(uuid)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.crm_oportunidad_gestionar(uuid,text,uuid,integer,text,jsonb,text,uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.crm_oportunidad_gestionar(uuid,text,uuid,integer,text,jsonb,text,uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.crm_oportunidad_gestionar(uuid,text,uuid,integer,text,jsonb,text,uuid)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.crm_visita_registrar(uuid,text,jsonb,text,uuid)', 'EXECUTE')
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T1 funciones'; end if;
  if has_table_privilege('service_role', 'public.crm_actividades', 'SELECT') and has_table_privilege('service_role', 'public.crm_seguimientos', 'SELECT')
     and not has_table_privilege('service_role', 'public.crm_actividades', 'INSERT') and not has_table_privilege('service_role', 'public.crm_seguimientos', 'UPDATE')
     and not has_table_privilege('service_role', 'public.crm_operaciones', 'SELECT') and not has_table_privilege('anon', 'public.crm_actividades', 'SELECT')
     and (select bool_and(relrowsecurity) from pg_class where relname in ('crm_actividades', 'crm_seguimientos', 'crm_operaciones', 'crm_oportunidad_ciclos'))
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T1 tablas'; end if;
  if exists (select 1 from pg_indexes where indexname = 'crm_seguimientos_un_pendiente_uidx')
     and exists (select 1 from pg_indexes where indexname = 'crm_oportunidades_una_abierta_uidx')
     and not exists (select 1 from pg_constraint where conname in ('crm_oportunidades_estado_chk', 'crm_oportunidades_cierre_chk'))
     and (select convalidated from pg_constraint where conname = 'crm_auditoria_accion_chk')
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T1 índices y restricciones'; end if;

  -- ── Fixtures (todo se revierte) ───────────────────────────────────────────
  u := (public.crm_usuario_crear('zzcrmb2v.tob', 'Tob', h, 'admin') ->> 'id')::uuid;
  e := (public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZB2V Barbería Centro', 'responsable_id', u), false, 'admin', null) ->> 'id')::uuid;
  j := (public.crm_jornada_crear('{}', 'comercial', u) ->> 'id')::uuid;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j, 'empresa_id', e, 'hablo_con_responsable', true,
    'contacto_nuevo', jsonb_build_object('nombre', 'Dueño', 'telefono', '+54 9 351 555-0101', 'es_decisor', 'si'), 'contacto_obtenido', true,
    'hablo_con_contacto', true, 'volver_otro_dia', true, 'revisita_para', hoy + 5), 'comercial', u);
  v1 := (x -> 'visita' ->> 'id')::uuid;
  o := (x -> 'oportunidad' ->> 'id')::uuid;
  c := (x ->> 'contacto_id')::uuid;
  -- Todo corre en una transacción (now() fijo): el lead se corre un día atrás para
  -- poder registrar actividades con un momento anterior al registro.
  update public.crm_oportunidades set lead_en = lead_en - interval '1 day', ciclo_inicio_en = ciclo_inicio_en - interval '1 day' where id = o;
  select id into tarea_b1 from public.crm_tareas where empresa_id = e and estado = 'pendiente';

  -- ── T2. Lead de B1: ciclo 1, sin gestión; consultar no gestiona ──────────
  if (select estado = 'contacto' and ciclo = 1 and ciclo_inicio_en = lead_en and ciclo_estado_inicial = 'contacto' and gestionada_en is null
        from public.crm_oportunidades where id = o) and tarea_b1 is not null
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 lead inicial'; end if;

  -- ── T3. Actividades: WhatsApp no cambia el estado; Respondió avanza a conversación ──
  ver := (select version from public.crm_oportunidades where id = o);
  x := pg_temp.gest(o, 'gestion', jsonb_build_object('tipo', 'whatsapp_enviado', 'contacto_id', c, 'observacion', 'Primer mensaje'));
  if x ->> 'resultado' = 'ok' and (select estado = 'contacto' and gestionada_en is not null and version = ver + 1 from public.crm_oportunidades where id = o)
     and (select count(*) from public.crm_actividades where oportunidad_id = o and tipo = 'whatsapp_enviado' and contacto_id = c and registrada_en >= ocurrida_en) = 1
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 whatsapp'; end if;
  x := pg_temp.gest(o, 'gestion', jsonb_build_object('tipo', 'respondio', 'ocurrida_en', now() - interval '10 minutes'));
  if (select estado = 'conversacion' and conversacion_en = (select ocurrida_en from public.crm_actividades where id = (x ->> 'actividad_id')::uuid)
        and interesado_en is null from public.crm_oportunidades where id = o)
     and (select estado_antes = 'contacto' and estado_despues = 'conversacion' from public.crm_actividades where id = (x ->> 'actividad_id')::uuid)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 respondió'; end if;
  t := pg_temp.falla(o, 'gestion', jsonb_build_object('tipo', 'llamada', 'ocurrida_en', now() + interval '1 hour'));
  if t = 'datos_invalidos:ocurrida_en' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 futura ' || t; end if;
  t := pg_temp.falla(o, 'gestion', jsonb_build_object('tipo', 'nota'));
  if t = 'datos_invalidos:observacion' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 nota vacía ' || t; end if;

  -- ── T4. Idempotencia y versión ────────────────────────────────────────────
  k := gen_random_uuid();
  ver := (select version from public.crm_oportunidades where id = o);
  x := public.crm_oportunidad_gestionar(k, hu, o, ver, 'gestion', '{"tipo":"llamada"}', 'admin', null);
  y := public.crm_oportunidad_gestionar(k, hu, o, ver, 'gestion', '{"tipo":"llamada"}', 'admin', null);
  if (y ->> 'repetida')::boolean and y ->> 'actividad_id' = x ->> 'actividad_id'
     and (select count(*) from public.crm_actividades where operacion_clave = k) = 1 then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T4 reintento'; end if;
  begin
    perform public.crm_oportunidad_gestionar(k, repeat('b', 64), o, ver, 'gestion', '{"tipo":"nota","observacion":"x"}', 'admin', null);
    v_fallas := v_fallas || ' FALLA:T4 clave reutilizada';
  exception when others then if sqlerrm = 'clave_reutilizada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T4 ' || sqlerrm; end if; end;
  begin
    perform public.crm_oportunidad_gestionar(gen_random_uuid(), hu, o, ver, 'gestion', '{"tipo":"llamada"}', 'admin', null);
    v_fallas := v_fallas || ' FALLA:T4 versión vieja';
  exception when others then if sqlerrm = 'version_desactualizada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T4 ' || sqlerrm; end if; end;
  begin
    perform public.crm_oportunidad_gestionar(gen_random_uuid(), hu, o, ver + 1, 'gestion', '{"tipo":"llamada"}', 'comercial', u);
    v_fallas := v_fallas || ' FALLA:T4 comercial';
  exception when others then if sqlerrm = 'no_autorizado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T4 ' || sqlerrm; end if; end;

  -- ── T5. Próxima acción: una sola pendiente; nota no completa; propuesta sin negociación ──
  x := pg_temp.gest(o, 'programar', jsonb_build_object('vence_el', hoy + 1, 'descripcion', 'Llamar para enviar propuesta'));
  s1 := (x -> 'seguimiento' ->> 'id')::uuid;
  t := pg_temp.falla(o, 'programar', jsonb_build_object('vence_el', hoy + 2));
  if s1 is not null and t = 'seguimiento_pendiente' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 una pendiente ' || t; end if;
  t := pg_temp.falla(o, 'gestion', jsonb_build_object('tipo', 'nota', 'observacion', 'x', 'resolver', s1));
  if t = 'datos_invalidos:resolver' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 nota resuelve ' || t; end if;
  x := pg_temp.gest(o, 'gestion', jsonb_build_object('tipo', 'nota', 'observacion', 'Pidió precios por mail'));
  if (select estado from public.crm_seguimientos where id = s1) = 'pendiente' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 nota completó'; end if;
  t := pg_temp.falla(o, 'gestion', jsonb_build_object('tipo', 'llamada', 'proxima', jsonb_build_object('vence_el', hoy + 3)));
  if t = 'seguimiento_pendiente' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 segunda sin resolver ' || t; end if;
  x := pg_temp.gest(o, 'gestion', jsonb_build_object('tipo', 'propuesta_enviada', 'resolver', s1, 'proxima', jsonb_build_object('vence_el', hoy + 3)));
  s2 := (x -> 'seguimiento' ->> 'id')::uuid;
  if (select estado = 'hecha' and resuelta_por_actividad_id = (x ->> 'actividad_id')::uuid from public.crm_seguimientos where id = s1)
     and s2 is not null and s2 <> s1
     and (select estado = 'conversacion' and propuesta_en is not null and negociacion_en is null from public.crm_oportunidades where id = o)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 propuesta'; end if;
  x := pg_temp.gest(o, 'reprogramar', jsonb_build_object('vence_el', hoy + 4, 'motivo', 'Pidió esperar'));
  if (select estado from public.crm_seguimientos where id = s2) = 'reprogramada'
     and (select anterior_id = s2 and vence_el = hoy + 4 from public.crm_seguimientos where oportunidad_id = o and estado = 'pendiente')
     and (select count(*) from public.crm_seguimientos where oportunidad_id = o and estado = 'pendiente') = 1
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 reprogramar'; end if;
  t := pg_temp.falla(o, 'reprogramar', jsonb_build_object('vence_el', hoy - 1));
  if t = 'datos_invalidos:vence_el' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 fecha pasada ' || t; end if;

  -- ── T6. Estados: avance, retroceso con motivo, visitas que no retroceden ──
  t := pg_temp.falla(o, 'gestion', jsonb_build_object('tipo', 'cambio_estado', 'estado', 'contacto'));
  if t = 'datos_invalidos:motivo' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T6 retroceso sin motivo ' || t; end if;
  x := pg_temp.gest(o, 'gestion', jsonb_build_object('tipo', 'inicio_negociacion'));
  if (select estado = 'negociacion' and negociacion_en is not null from public.crm_oportunidades where id = o) then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T6 negociación'; end if;
  x := pg_temp.gest(o, 'gestion', jsonb_build_object('tipo', 'respondio'));
  if (select estado from public.crm_oportunidades where id = o) = 'negociacion' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T6 respondió retrocede'; end if;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j, 'empresa_id', e, 'hablo_con_responsable', true,
    'contacto_id', c, 'contacto_obtenido', true, 'interes', 'sin_interes'), 'comercial', u);
  v2 := (x -> 'visita' ->> 'id')::uuid;
  if x -> 'oportunidad' ->> 'id' = o::text and (select estado from public.crm_oportunidades where id = o) = 'negociacion' then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T6 visita retrocede'; end if;
  x := pg_temp.gest(o, 'gestion', jsonb_build_object('tipo', 'cambio_estado', 'estado', 'interesado', 'motivo', 'Frenó la negociación'));
  if (select estado = 'interesado' and negociacion_en is not null from public.crm_oportunidades where id = o)
     and exists (select 1 from public.crm_auditoria where entidad_id = o and accion = 'retroceso' and datos ->> 'motivo' = 'Frenó la negociación')
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T6 retroceso'; end if;

  -- ── T7. B1 sobre una oportunidad gestionada: corregir no recalcula; anular el origen no la cierra ──
  perform public.crm_visita_corregir(v2, (select version from public.crm_visitas where id = v2), '{"interes":"caliente"}', 'Prueba', 'admin', null);
  if (select estado from public.crm_oportunidades where id = o) = 'interesado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 corregir'; end if;
  begin
    perform public.crm_visita_anular(v1, (select version from public.crm_visitas where id = v1), 'Prueba', 'cerrar_oportunidad', null, 'admin', null);
    v_fallas := v_fallas || ' FALLA:T7 cerró una gestionada';
  exception when others then
    if sqlerrm = 'oportunidad_gestionada' and (select anulada_en is null from public.crm_visitas where id = v1)
       and (select cerrada_en is null from public.crm_oportunidades where id = o) then v_ok := v_ok + 1;
    else v_fallas := v_fallas || ' FALLA:T7 ' || sqlerrm; end if;
  end;

  -- ── T8. Pausa, visita durante la pausa y retomar ──────────────────────────
  t := pg_temp.falla(o, 'pausar', jsonb_build_object('retomar_el', hoy));
  if t = 'datos_invalidos:retomar_el' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 pausa hoy ' || t; end if;
  s2 := (select id from public.crm_seguimientos where oportunidad_id = o and estado = 'pendiente');
  x := pg_temp.gest(o, 'pausar', jsonb_build_object('retomar_el', hoy + 10, 'motivo', 'Temporada alta'));
  if (select estado = 'pausada' and estado_previo = 'interesado' and retomar_el = hoy + 10 from public.crm_oportunidades where id = o)
     and (select estado = 'cancelada' and cancelada_motivo = 'pausa' from public.crm_seguimientos where id = s2)
     and (select tipo = 'retomar' and vence_el = hoy + 10 from public.crm_seguimientos where oportunidad_id = o and estado = 'pendiente')
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 pausar'; end if;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j, 'empresa_id', e, 'hablo_con_responsable', true,
    'interes', 'caliente', 'volver_otro_dia', true, 'revisita_para', hoy + 7), 'comercial', u);
  if (select estado = 'pausada' and estado_previo = 'interesado' from public.crm_oportunidades where id = o) then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T8 visita saca de pausa'; end if;
  t := pg_temp.falla(o, 'gestion', jsonb_build_object('tipo', 'inicio_negociacion'));
  if t = 'oportunidad_pausada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 negociar en pausa ' || t; end if;
  x := pg_temp.gest(o, 'retomar', jsonb_build_object('proxima', jsonb_build_object('vence_el', hoy + 1)));
  if (select estado = 'interesado' and estado_previo is null and retomar_el is null from public.crm_oportunidades where id = o)
     and (select count(*) from public.crm_seguimientos where oportunidad_id = o and tipo = 'retomar' and estado = 'hecha') = 1
     and (select tipo = 'seguimiento' from public.crm_seguimientos where oportunidad_id = o and estado = 'pendiente')
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 retomar'; end if;

  -- ── T9. Pérdida: motivo, solo sus seguimientos, revisitas de B1 intactas ──
  t := pg_temp.falla(o, 'perder', jsonb_build_object('motivo', 'otro'));
  if t = 'datos_invalidos:detalle' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T9 otro sin detalle ' || t; end if;
  x := pg_temp.gest(o, 'perder', jsonb_build_object('motivo', 'precio', 'detalle', 'Le pareció caro'));
  if (select estado = 'perdida' and estado_al_perder = 'interesado' and cerrada_en is not null and cierre_motivo = 'perdida' and perdida_motivo = 'precio'
        from public.crm_oportunidades where id = o)
     and not exists (select 1 from public.crm_seguimientos where oportunidad_id = o and estado = 'pendiente')
     and exists (select 1 from public.crm_tareas where empresa_id = e and estado = 'pendiente')
     and (select count(*) from public.crm_actividades where oportunidad_id = o) >= 10
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T9 perder'; end if;
  t := pg_temp.falla(o, 'gestion', jsonb_build_object('tipo', 'llamada'));
  if t = 'oportunidad_perdida' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T9 gestionar perdida ' || t; end if;

  -- ── T10. Visitas después de la pérdida ─────────────────────────────────────
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j, 'empresa_id', e, 'hablo_con_responsable', true,
    'contacto_id', c, 'contacto_obtenido', true, 'interes', 'caliente'), 'comercial', u);
  if x -> 'oportunidad' ->> 'id' = o::text and x -> 'oportunidad' ->> 'estado' = 'perdida' and not (x -> 'oportunidad' ->> 'creada')::boolean
     and (select count(*) from public.crm_oportunidades where empresa_id = e) = 1
     and (select estado from public.crm_oportunidades where id = o) = 'perdida'
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 contacto precargado'; end if;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j, 'empresa_id', e, 'hablo_con_responsable', true,
    'contacto_nuevo', jsonb_build_object('nombre', 'Nueva encargada', 'telefono', '+54 9 351 555-0202'), 'contacto_obtenido', true), 'comercial', u);
  o2 := (x -> 'oportunidad' ->> 'id')::uuid;
  if o2 is not null and o2 <> o and (x -> 'oportunidad' ->> 'creada')::boolean
     and exists (select 1 from public.crm_auditoria where entidad_id = o2 and accion = 'creacion' and datos ->> 'tras_perdida' = o::text)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 contacto nuevo'; end if;

  -- ── T11. Reapertura: conflicto sin cambios parciales; luego ciclo 2 ───────
  t := pg_temp.falla(o, 'reabrir', jsonb_build_object('motivo', 'Volvió a escribir'));
  if t = 'otra_oportunidad_abierta' and (select estado = 'perdida' and ciclo = 1 from public.crm_oportunidades where id = o)
     and not exists (select 1 from public.crm_oportunidad_ciclos where oportunidad_id = o) then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T11 conflicto ' || t; end if;
  perform pg_temp.gest(o2, 'perder', jsonb_build_object('motivo', 'dejo_de_responder'));
  t := pg_temp.falla(o, 'reabrir', '{}');
  if t = 'datos_invalidos:motivo' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 sin motivo ' || t; end if;
  x := pg_temp.gest(o, 'reabrir', jsonb_build_object('motivo', 'Volvió a escribir'));
  if (select estado = 'interesado' and ciclo = 2 and ciclo_estado_inicial = 'interesado' and cerrada_en is null and perdida_motivo is null
        and interesado_en is null and propuesta_en is null and negociacion_en is null and conversacion_en is null
        and lead_en < ciclo_inicio_en and origen_usuario_id = u and origen_visita_id = v1 from public.crm_oportunidades where id = o)
     and (select ciclo = 1 and perdida_motivo = 'precio' and propuesta_en is not null and negociacion_en is not null and estado_al_perder = 'interesado'
            and reapertura_motivo = 'Volvió a escribir' from public.crm_oportunidad_ciclos where oportunidad_id = o)
     and exists (select 1 from public.crm_actividades where oportunidad_id = o and ciclo = 2 and estado_antes = 'perdida' and estado_despues = 'interesado')
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 reabrir'; end if;
  t := pg_temp.falla(o, 'gestion', jsonb_build_object('tipo', 'llamada', 'ocurrida_en', now() - interval '1 day'));
  if t = 'datos_invalidos:ocurrida_en' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 actividad anterior al ciclo ' || t; end if;

  -- ── T12. Contacto principal y auditoría sin teléfonos ─────────────────────
  e2 := (public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZB2V Otro negocio'), false, 'admin', null) ->> 'id')::uuid;
  t := pg_temp.falla(o, 'contacto_principal', jsonb_build_object('contacto_id', (public.crm_contacto_crear(e2, '{"nombre":"Ajeno"}', 'admin', null) ->> 'id')));
  if t = 'contacto_no_encontrado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T12 contacto ajeno ' || t; end if;
  select count(*) into n from public.crm_auditoria a where a.entidad in ('crm_oportunidades', 'crm_actividades', 'crm_seguimientos')
    and a.datos::text ~ '555-?010|5550101|5550202';
  if n = 0 and (select count(*) from public.crm_auditoria where entidad_id = o and accion in ('pausa', 'reanudacion', 'perdida', 'reapertura')) = 4
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T12 auditoría'; end if;

  if v_fallas = '' then
    raise exception 'RESULTADO CRM-B2|OK %', v_ok;
  end if;
  raise exception 'RESULTADO CRM-B2|% bien;%', v_ok, v_fallas;
end
$crmb2$;

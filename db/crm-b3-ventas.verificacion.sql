-- ============================================================================
-- Verificación del CRM B2B · Bloque 3 (ventas, cobros, comisiones y recompras).
-- ----------------------------------------------------------------------------
-- Auxiliares en pg_temp; las pruebas corren dentro de un bloque que termina en
-- RAISE: se deshace entero (también la campaña de Empresas ficticia que se crea).
--   node scripts/pruebas/crm-local.mjs sql db/crm-b3-ventas.verificacion.sql
-- Resultado: "RESULTADO CRM-B3|OK n" o la lista de "FALLA:".
-- ============================================================================
create or replace function pg_temp.vender(p_op uuid, p_datos jsonb)
returns jsonb language plpgsql as $f$
begin
  return public.crm_venta_registrar(gen_random_uuid(), encode(sha256(convert_to(random()::text, 'UTF8')), 'hex'), p_op,
    (select version from public.crm_oportunidades where id = p_op), p_datos, 'admin', null);
end $f$;
create or replace function pg_temp.op(p_venta uuid, p_accion text, p_datos jsonb)
returns jsonb language plpgsql as $f$
begin
  return public.crm_venta_gestionar(gen_random_uuid(), encode(sha256(convert_to(random()::text, 'UTF8')), 'hex'), p_venta,
    (select version from public.crm_ventas where id = p_venta), p_accion, p_datos, 'admin', null);
end $f$;
create or replace function pg_temp.falla_vender(p_op uuid, p_datos jsonb)
returns text language plpgsql as $f$
begin
  perform pg_temp.vender(p_op, p_datos);
  return 'sin error';
exception when others then
  return sqlerrm;
end $f$;
create or replace function pg_temp.falla_op(p_venta uuid, p_accion text, p_datos jsonb)
returns text language plpgsql as $f$
begin
  perform pg_temp.op(p_venta, p_accion, p_datos);
  return 'sin error';
exception when others then
  return sqlerrm;
end $f$;

do $crmb3$
declare
  v_fallas text := '';
  v_ok integer := 0;
  h text := 'scrypt$17$8$1$' || repeat('A', 22) || '$' || repeat('B', 43);
  hu text := repeat('a', 64);
  hoy date := public.crm_fecha_sim(now());
  u uuid; u2 uuid; e uuid; j uuid; c uuid; o1 uuid; o2 uuid; o3 uuid; v1 uuid; v2 uuid; v3 uuid; vis uuid; camp uuid; k uuid; cob uuid; pag uuid;
  x jsonb; y jsonb; t text; n integer;
  pack10 jsonb;
begin
  -- ── T1. Privilegios, catálogo y estructura ───────────────────────────────
  if has_function_privilege('service_role', 'public.crm_venta_registrar(uuid,text,uuid,integer,jsonb,text,uuid)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.crm_venta_gestionar(uuid,text,uuid,integer,text,jsonb,text,uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.crm_venta_registrar(uuid,text,uuid,integer,jsonb,text,uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.crm_venta_gestionar(uuid,text,uuid,integer,text,jsonb,text,uuid)', 'EXECUTE')
     and not has_function_privilege('service_role', 'public.crm_importe(jsonb,text,numeric,numeric)', 'EXECUTE')
     and not has_function_privilege('service_role', 'public.crm_operacion_previa(uuid,text,text)', 'EXECUTE')
     and has_table_privilege('service_role', 'public.crm_ventas', 'SELECT') and not has_table_privilege('service_role', 'public.crm_ventas', 'INSERT')
     and not has_table_privilege('service_role', 'public.crm_cobros', 'UPDATE') and not has_table_privilege('anon', 'public.crm_cobros', 'SELECT')
     and (select bool_and(relrowsecurity) from pg_class where relname in ('crm_productos', 'crm_ventas', 'crm_cobros', 'crm_comision_pagos'))
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T1 privilegios'; end if;
  if (select precio = 150000.00 and comision_estandar = 40000.00 and experiencias = 10 and duracion_minutos = 20 from public.crm_productos where codigo = 'pack_10')
     and (select precio = 360000.00 and comision_estandar = 90000.00 and experiencias = 25 from public.crm_productos where codigo = 'pack_25')
     and (select precio is null and comision_estandar is null and minimo_experiencias = 26 from public.crm_productos where codigo = 'personalizado')
     and pg_typeof((select importe from public.crm_ventas limit 1))::text = 'numeric'
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T1 catálogo'; end if;

  -- ── Fixtures ──────────────────────────────────────────────────────────────
  u := (public.crm_usuario_crear('zzcrmb3v.tob', 'Tob', h, 'admin') ->> 'id')::uuid;
  u2 := (public.crm_usuario_crear('zzcrmb3v.otro', 'Otro', h, 'admin') ->> 'id')::uuid;
  e := (public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZB3V Gimnasio', 'responsable_id', u), false, 'admin', null) ->> 'id')::uuid;
  j := (public.crm_jornada_crear('{}', 'comercial', u) ->> 'id')::uuid;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j, 'empresa_id', e, 'hablo_con_responsable', true,
    'contacto_nuevo', jsonb_build_object('nombre', 'Dueña', 'telefono', '+54 9 351 555-0301', 'es_decisor', 'si'), 'contacto_obtenido', true), 'comercial', u);
  o1 := (x -> 'oportunidad' ->> 'id')::uuid;
  c := (x ->> 'contacto_id')::uuid;
  update public.crm_oportunidades set lead_en = lead_en - interval '3 days', ciclo_inicio_en = ciclo_inicio_en - interval '3 days' where id = o1;
  perform public.crm_oportunidad_gestionar(gen_random_uuid(), hu, o1, (select version from public.crm_oportunidades where id = o1), 'programar',
    jsonb_build_object('vence_el', hoy + 2), 'admin', null);
  -- El responsable actual cambia: la comisión sigue siendo de quien originó el lead.
  perform public.crm_empresa_actualizar(e, (select version from public.crm_empresas where id = e), jsonb_build_object('responsable_id', u2), 'admin', null);
  pack10 := jsonb_build_object('producto', 'pack_10', 'fecha_acuerdo', hoy - 1,
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial', 'importe', '40000.00', 'beneficiario_id', u));

  -- ── T2. Validaciones antes de vender ──────────────────────────────────────
  t := pg_temp.falla_vender(o1, pack10 || jsonb_build_object('comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial',
    'importe', '40000.00', 'beneficiario_id', u2)));
  if t = 'comision_origen' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 comisión al responsable actual ' || t; end if;
  t := pg_temp.falla_vender(o1, pack10 || jsonb_build_object('importe', '140000.00'));
  if t = 'confirmar_importe' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 importe sin confirmar ' || t; end if;
  t := pg_temp.falla_vender(o1, pack10 || jsonb_build_object('importe', '140000.00', 'importe_confirmado', true));
  if t = 'confirmar_comision' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 descuento sin confirmar comisión ' || t; end if;
  t := pg_temp.falla_vender(o1, pack10 || jsonb_build_object('importe', '150000.123'));
  if t = 'datos_invalidos:importe' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 centavos ' || t; end if;
  t := pg_temp.falla_vender(o1, pack10 || jsonb_build_object('experiencias', 12));
  if t = 'datos_invalidos:experiencias' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 pack con otra cantidad ' || t; end if;
  t := pg_temp.falla_vender(o1, pack10 || jsonb_build_object('comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial',
    'importe', '0', 'beneficiario_id', u)));
  if t = 'datos_invalidos:comision_importe' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 comisión cero como pactada ' || t; end if;
  perform public.crm_oportunidad_gestionar(gen_random_uuid(), hu, o1, (select version from public.crm_oportunidades where id = o1), 'pausar',
    jsonb_build_object('retomar_el', hoy + 5), 'admin', null);
  t := pg_temp.falla_vender(o1, pack10);
  if t = 'oportunidad_pausada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T2 vender en pausa ' || t; end if;
  perform public.crm_oportunidad_gestionar(gen_random_uuid(), hu, o1, (select version from public.crm_oportunidades where id = o1), 'retomar',
    jsonb_build_object('proxima', jsonb_build_object('vence_el', hoy + 1)), 'admin', null);

  -- ── T3. Venta Pack 10 desde "contacto" (sin recorrer etapas) ──────────────
  x := pg_temp.vender(o1, pack10 || jsonb_build_object('observacion', 'Cierre de Ramiro'));
  v1 := (x -> 'venta' ->> 'id')::uuid;
  if (select estado = 'ganada' and estado_al_ganar = 'contacto' and cerrada_en is not null and cierre_motivo = 'ganada' and ganada_en is not null
        and origen_usuario_id = u from public.crm_oportunidades where id = o1)
     and (select importe = 150000.00 and precio_catalogo = 150000.00 and comision_catalogo = 40000.00 and comision_importe = 40000.00
        and comision_beneficiario_id = u and not es_recompra and fecha_acuerdo = hoy - 1 from public.crm_ventas where id = v1)
     and not exists (select 1 from public.crm_seguimientos where oportunidad_id = o1 and estado = 'pendiente')
     and exists (select 1 from public.crm_seguimientos where oportunidad_id = o1 and cancelada_motivo = 'ganada')
     and exists (select 1 from public.crm_actividades where oportunidad_id = o1 and estado_despues = 'ganada')
     and exists (select 1 from public.crm_auditoria where entidad_id = o1 and accion = 'ganada')
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 venta pack 10'; end if;
  t := pg_temp.falla_vender(o1, pack10);
  if t = 'version_desactualizada' or t = 'oportunidad_ganada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 segunda venta ' || t; end if;
  begin
    perform public.crm_oportunidad_gestionar(gen_random_uuid(), hu, o1, (select version from public.crm_oportunidades where id = o1), 'pausar',
      jsonb_build_object('retomar_el', hoy + 5), 'admin', null);
    v_fallas := v_fallas || ' FALLA:T3 pausó una ganada';
  exception when others then if sqlerrm = 'oportunidad_ganada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 ' || sqlerrm; end if; end;
  -- Idempotencia de la venta: misma clave y huella → mismo resultado, sin otra fila.
  k := gen_random_uuid();
  begin
    perform public.crm_venta_registrar(k, hu, o1, (select version from public.crm_oportunidades where id = o1), pack10, 'admin', null);
    v_fallas := v_fallas || ' FALLA:T3 vendió dos veces';
  exception when others then if sqlerrm = 'oportunidad_ganada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T3 ' || sqlerrm; end if; end;

  -- ── T4. Invariantes (los triggers diferidos, en modo inmediato) ──────────
  begin
    set constraints all immediate;
    update public.crm_ventas set anulada_en = now(), anulada_motivo = 'directo' where id = v1;
    v_fallas := v_fallas || ' FALLA:T4 ganada sin venta';
  exception when others then if sqlerrm = 'integridad_ventas:ganada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T4 ' || sqlerrm; end if; end;
  begin
    set constraints all immediate;
    insert into public.crm_cobros (venta_id, fecha_efectiva, importe, medio, concepto, operacion_clave) values (v1, hoy, 150000.01, 'efectivo', 'otro', gen_random_uuid());
    v_fallas := v_fallas || ' FALLA:T4 cobro mayor al importe';
  exception when others then if sqlerrm = 'integridad_ventas:cobros' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T4 ' || sqlerrm; end if; end;
  set constraints all deferred;

  -- ── T5. Cobros: anticipo, saldo, tope, duplicado, fechas ─────────────────
  t := pg_temp.falla_op(v1, 'pago_comision', jsonb_build_object('fecha', hoy, 'importe', '40000.00'));
  if t = 'comision_no_generada' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 pagar sin cobrar ' || t; end if;
  x := pg_temp.op(v1, 'cobro', jsonb_build_object('fecha_efectiva', hoy - 1, 'importe', '75000.00', 'medio', 'transferencia', 'concepto', 'anticipo'));
  cob := (x ->> 'id')::uuid;
  if (x -> 'venta' ->> 'cobrado')::numeric = 75000.00 then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 anticipo'; end if;
  x := pg_temp.op(v1, 'cobro', jsonb_build_object('fecha_efectiva', hoy - 1, 'importe', '75000.00', 'medio', 'transferencia', 'concepto', 'saldo'));
  if x ->> 'resultado' = 'posible_duplicado' and public.crm_venta_cobrado(v1) = 75000.00 then v_ok := v_ok + 1;
  else v_fallas := v_fallas || ' FALLA:T5 duplicado sin aviso'; end if;
  t := pg_temp.falla_op(v1, 'cobro', jsonb_build_object('fecha_efectiva', hoy, 'importe', '75000.01', 'medio', 'efectivo', 'concepto', 'saldo'));
  if t = 'cobro_excede_saldo' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 tope ' || t; end if;
  t := pg_temp.falla_op(v1, 'cobro', jsonb_build_object('fecha_efectiva', hoy - 5, 'importe', '10.00', 'medio', 'efectivo', 'concepto', 'otro'));
  if t = 'datos_invalidos:fecha_efectiva' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 antes del acuerdo ' || t; end if;
  x := pg_temp.op(v1, 'cobro', jsonb_build_object('fecha_efectiva', hoy - 1, 'importe', '75000.00', 'medio', 'transferencia', 'concepto', 'saldo',
    'confirmar_duplicado', true));
  if public.crm_venta_cobrado(v1) = 150000.00 and (select count(*) from public.crm_cobros where venta_id = v1) = 2
     and (select registrado_en::date >= fecha_efectiva from public.crm_cobros where id = cob)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 saldo'; end if;
  t := pg_temp.falla_op(v1, 'corregir', jsonb_build_object('motivo', 'x', 'cambios', jsonb_build_object('importe', '140000.00', 'importe_confirmado', true,
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial', 'importe', '40000.00', 'beneficiario_id', u, 'confirmada', true))));
  if t = 'importe_menor_que_cobrado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T5 bajar por debajo de lo cobrado ' || t; end if;

  -- ── T6. Comisión: generada → pagos parciales → pagada; tope ──────────────
  x := pg_temp.op(v1, 'pago_comision', jsonb_build_object('fecha', hoy, 'importe', '15000.00', 'referencia', 'Transf. 1'));
  pag := (x ->> 'id')::uuid;
  t := pg_temp.falla_op(v1, 'pago_comision', jsonb_build_object('fecha', hoy, 'importe', '25000.01'));
  if t = 'pago_excede_comision' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T6 tope de comisión ' || t; end if;
  x := pg_temp.op(v1, 'pago_comision', jsonb_build_object('fecha', hoy, 'importe', '25000.00'));
  if public.crm_venta_comision_pagada(v1) = 40000.00 and (select beneficiario_id = u from public.crm_comision_pagos where id = pag)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T6 pagos'; end if;

  -- ── T7. Corrección y anulación de la venta ───────────────────────────────
  t := pg_temp.falla_op(v1, 'anular', jsonb_build_object('motivo', 'Error de carga'));
  if t = 'venta_con_cobros' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 anular con cobros ' || t; end if;
  perform pg_temp.op(v1, 'anular_cobro', jsonb_build_object('cobro_id', cob, 'motivo', 'Cargado dos veces'));
  t := pg_temp.falla_op(v1, 'pago_comision', jsonb_build_object('fecha', hoy, 'importe', '1.00'));
  if t = 'comision_no_generada' and (select anulado_en is not null and anulado_motivo = 'Cargado dos veces' from public.crm_cobros where id = cob)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 anular cobro ' || t; end if;
  for y in select to_jsonb(cp) from public.crm_comision_pagos cp where venta_id = v1 loop
    perform pg_temp.op(v1, 'anular_pago_comision', jsonb_build_object('pago_id', y ->> 'id', 'motivo', 'Prueba'));
  end loop;
  for y in select to_jsonb(cb) from public.crm_cobros cb where venta_id = v1 and anulado_en is null loop
    perform pg_temp.op(v1, 'anular_cobro', jsonb_build_object('cobro_id', y ->> 'id', 'motivo', 'Prueba'));
  end loop;
  x := pg_temp.op(v1, 'anular', jsonb_build_object('motivo', 'Venta cargada en el negocio equivocado'));
  if (select estado = 'contacto' and cerrada_en is null and ganada_en is null from public.crm_oportunidades where id = o1)
     and (select anulada_en is not null from public.crm_ventas where id = v1)
     and (select count(*) from public.crm_cobros where venta_id = v1) = 2 and (select count(*) from public.crm_comision_pagos where venta_id = v1) = 2
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 anular venta'; end if;
  x := pg_temp.vender(o1, pack10);
  v1 := (x -> 'venta' ->> 'id')::uuid;
  if v1 is not null then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T7 volver a vender'; end if;

  -- ── T8. Catálogo: cambiarlo no toca ventas anteriores ─────────────────────
  perform public.crm_producto_actualizar('pack_10', (select version from public.crm_productos where codigo = 'pack_10'),
    jsonb_build_object('precio', '165000.00', 'comision_estandar', '45000.00'), 'admin', null);
  if (select importe = 150000.00 and precio_catalogo = 150000.00 and comision_catalogo = 40000.00 from public.crm_ventas where id = v1)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T8 snapshot'; end if;

  -- ── T9. Visitas y gestión sobre una ganada ────────────────────────────────
  begin
    perform public.crm_visita_anular((select origen_visita_id from public.crm_oportunidades where id = o1), 1, 'x', null, null, 'admin', null);
    v_fallas := v_fallas || ' FALLA:T9 anuló el origen de una venta';
  exception when others then if sqlerrm in ('visita_con_venta', 'version_desactualizada') then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T9 ' || sqlerrm; end if; end;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', (public.crm_jornada_crear('{}', 'comercial', u2) ->> 'id')::uuid,
    'empresa_id', e, 'hablo_con_responsable', true, 'contacto_id', c, 'contacto_obtenido', true, 'interes', 'tibio'), 'comercial', u2);
  o2 := (x -> 'oportunidad' ->> 'id')::uuid;
  vis := (x -> 'visita' ->> 'id')::uuid;
  if o2 is not null and o2 <> o1 and (select estado from public.crm_oportunidades where id = o1) = 'ganada'
     and (select origen_tipo = 'visita' and origen_usuario_id = u2 from public.crm_oportunidades where id = o2)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T9 visita a un cliente abre recompra'; end if;

  -- ── T10. Recompras: trabajada con intervención; espontánea sin comisión ──
  t := pg_temp.falla_vender(o2, jsonb_build_object('producto', 'pack_25',
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial', 'importe', '90000.00', 'beneficiario_id', u2)));
  if t = 'comision_recompra' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 origen en recompra ' || t; end if;
  t := pg_temp.falla_vender(o2, jsonb_build_object('producto', 'pack_25',
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'recompra_trabajada', 'importe', '90000.00', 'beneficiario_id', u2)));
  if t = 'datos_invalidos:comision_intervencion' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 sin intervención ' || t; end if;
  t := pg_temp.falla_vender(o2, jsonb_build_object('producto', 'pack_25',
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'recompra_trabajada', 'importe', '90000.00', 'beneficiario_id', u,
      'intervencion_visita_id', vis)));
  if t = 'datos_invalidos:comision_intervencion' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 visita de otro comercial ' || t; end if;
  x := pg_temp.vender(o2, jsonb_build_object('producto', 'pack_25',
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'recompra_trabajada', 'importe', '90000.00', 'beneficiario_id', u2,
      'intervencion_visita_id', vis)));
  v2 := (x -> 'venta' ->> 'id')::uuid;
  if (select es_recompra and importe = 360000.00 and comision_importe = 90000.00 and comision_beneficiario_id = u2 from public.crm_ventas where id = v2)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 recompra trabajada'; end if;
  t := 'sin error';
  begin
    perform public.crm_oportunidad_recompra(gen_random_uuid(), hu, e, jsonb_build_object('contacto_id', gen_random_uuid()), 'admin', null);
  exception when others then t := sqlerrm; end;
  if t = 'contacto_no_encontrado' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 contacto ajeno ' || t; end if;
  x := public.crm_oportunidad_recompra(gen_random_uuid(), hu, e, jsonb_build_object('contacto_id', c, 'observacion', 'Llamó para repetir'), 'admin', null);
  o3 := (x -> 'oportunidad' ->> 'id')::uuid;
  begin
    perform public.crm_oportunidad_recompra(gen_random_uuid(), hu, e, jsonb_build_object('contacto_id', c), 'admin', null);
    v_fallas := v_fallas || ' FALLA:T10 dos abiertas';
  exception when others then if sqlerrm = 'otra_oportunidad_abierta' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 ' || sqlerrm; end if; end;
  x := pg_temp.vender(o3, jsonb_build_object('producto', 'pack_10',
    'comision', jsonb_build_object('tipo', 'no_corresponde', 'fundamento', 'recompra_espontanea')));
  v3 := (x -> 'venta' ->> 'id')::uuid;
  if (select es_recompra and comision_tipo = 'no_corresponde' and comision_importe is null and importe = 165000.00 and precio_catalogo = 165000.00
        from public.crm_ventas where id = v3)
     and (select origen_tipo = 'recompra_admin' and origen_usuario_id is null and contacto_id = c from public.crm_oportunidades where id = o3)
     and (select count(*) from public.crm_contactos where empresa_id = e) = 1
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 recompra espontánea'; end if;
  t := pg_temp.falla_op(v3, 'pago_comision', jsonb_build_object('fecha', hoy, 'importe', '1.00'));
  if t = 'comision_no_corresponde' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T10 pagar sin comisión ' || t; end if;

  -- ── T11. Personalizado ───────────────────────────────────────────────────
  e := (public.crm_empresa_crear(jsonb_build_object('nombre_comercial', 'ZZB3V Concesionaria', 'responsable_id', u), false, 'admin', null) ->> 'id')::uuid;
  x := public.crm_visita_registrar(gen_random_uuid(), hu, jsonb_build_object('jornada_id', j, 'empresa_id', e, 'hablo_con_responsable', true,
    'contacto_nuevo', jsonb_build_object('nombre', 'Gerente', 'telefono', '+54 9 351 555-0302'), 'contacto_obtenido', true), 'comercial', u);
  o1 := (x -> 'oportunidad' ->> 'id')::uuid;
  t := pg_temp.falla_vender(o1, jsonb_build_object('producto', 'personalizado', 'experiencias', 40, 'importe', '520000.00',
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial', 'importe', '120000.00', 'beneficiario_id', u)));
  if t = 'confirmar_comision' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 personalizado sin confirmar ' || t; end if;
  t := pg_temp.falla_vender(o1, jsonb_build_object('producto', 'personalizado', 'experiencias', 40, 'importe', '520000.00',
    'comision', jsonb_build_object('tipo', 'no_corresponde', 'fundamento', 'acuerdo_especial', 'detalle', 'Canje por publicidad')));
  if t = 'confirmar_comision' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 acuerdo especial sin confirmar ' || t; end if;
  t := pg_temp.falla_vender(o1, jsonb_build_object('producto', 'personalizado', 'experiencias', 40, 'importe', '520000.00',
    'comision', jsonb_build_object('tipo', 'no_corresponde', 'fundamento', 'acuerdo_especial', 'confirmada', true)));
  if t = 'datos_invalidos:comision_detalle' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 acuerdo especial sin detalle ' || t; end if;
  t := pg_temp.falla_vender(o1, jsonb_build_object('producto', 'personalizado', 'experiencias', 25, 'importe', '520000.00',
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial', 'importe', '120000.00', 'beneficiario_id', u, 'confirmada', true)));
  if t = 'datos_invalidos:experiencias' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 menos de 26 ' || t; end if;
  t := pg_temp.falla_vender(o1, jsonb_build_object('producto', 'personalizado', 'experiencias', 40.5, 'importe', '520000.00',
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial', 'importe', '120000.00', 'beneficiario_id', u, 'confirmada', true)));
  if t = 'datos_invalidos:experiencias' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 cantidad con decimales ' || t; end if;
  x := pg_temp.vender(o1, jsonb_build_object('producto', 'personalizado', 'experiencias', 40, 'duracion_minutos', 20, 'importe', '520000.00',
    'comision', jsonb_build_object('tipo', 'pactada', 'fundamento', 'origen_comercial', 'importe', '120000.00', 'beneficiario_id', u, 'confirmada', true)));
  v1 := (x -> 'venta' ->> 'id')::uuid;
  if (select experiencias = 40 and importe = 520000.00 and comision_importe = 120000.00 and precio_catalogo is null from public.crm_ventas where id = v1)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T11 personalizado'; end if;

  -- ── T12. Entrega y campaña de Empresas (solo lectura) ────────────────────
  t := pg_temp.falla_op(v1, 'entrega', jsonb_build_object('estado', 'entregada'));
  if t = 'datos_invalidos:fecha' then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T12 entrega sin fecha ' || t; end if;
  perform pg_temp.op(v1, 'entrega', jsonb_build_object('estado', 'entregada', 'fecha', hoy));
  insert into public.empresa_campanias (empresa, cantidad_contratada, duracion_minutos, estado) values ('ZZB3V Concesionaria', 40, 20, 'borrador') returning id into camp;
  perform pg_temp.op(v1, 'vincular_campania', jsonb_build_object('campania_id', camp));
  t := pg_temp.falla_op(v2, 'vincular_campania', jsonb_build_object('campania_id', camp));
  if (select entrega_estado = 'entregada' and entrega_fecha = hoy and campania_id = camp from public.crm_ventas where id = v1)
     and t = 'campania_vinculada'
     and (select estado = 'borrador' and estado_pago = 'pendiente' and not codigos_generados from public.empresa_campanias where id = camp)
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T12 campaña ' || t; end if;

  -- ── T13. Auditoría ────────────────────────────────────────────────────────
  if (select count(distinct accion) from public.crm_auditoria where entidad in ('crm_ventas', 'crm_cobros', 'crm_comision_pagos')
        and accion in ('creacion', 'cobro', 'pago_comision', 'anulacion', 'entrega', 'vinculo_campania')) = 6
     and not exists (select 1 from public.crm_auditoria where entidad in ('crm_ventas', 'crm_cobros', 'crm_comision_pagos') and datos::text ~ '555-?030')
  then v_ok := v_ok + 1; else v_fallas := v_fallas || ' FALLA:T13 auditoría'; end if;

  if v_fallas = '' then
    raise exception 'RESULTADO CRM-B3|OK %', v_ok;
  end if;
  raise exception 'RESULTADO CRM-B3|% bien;%', v_ok, v_fallas;
end
$crmb3$;

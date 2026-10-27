-- ============================================================================
-- Verificación de campañas de Marketing (simulación persistente), SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: se deshace entero.
-- Teléfonos sintéticos 35199800NN, texto 'zz-campanias'. Resultado en el
-- mensaje final: "RESULTADO MARKETING-CAMPANIAS|K1 K2 ..."; "FALLA:" marca lo
-- que no se cumplió y "ABORTO:" un error inesperado. Secuencial: la concurrencia
-- real se prueba por las rutas (lib/marketing/campanias.integration.ts).
--
-- Solo para el stack LOCAL: node scripts/pruebas/marketing-campanias.mjs
-- ============================================================================
do $mcamp$
declare
  v_log       text := '';
  v_resultado text;
  v_j         jsonb;
  v_j2        jsonb;
  v_c         uuid;
  v_c2        uuid;
  v_k         uuid := gen_random_uuid();
  v_e1        uuid := gen_random_uuid();
  v_e2        uuid := gen_random_uuid();
  v_d         uuid;
  v_d2        uuid;
  v_r         text;
  v_r2        text;
  v_n         integer;
  v_datos     jsonb;
  v_lista     jsonb;
  v_aud       jsonb := '{"calculado_en": "verificacion"}'::jsonb;
begin
  begin
    -- ── Utilidades temporales (se van con el ROLLBACK) ─────────────────────
    create function pg_temp.intentar(p_sql text) returns text language plpgsql as $f$
    begin
      execute p_sql;
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.alta(p_tel text) returns void language plpgsql as $f$
    begin
      perform public.mkt_consentimiento_registrar(gen_random_uuid(), jsonb_build_object(
        'tipo', 'alta', 'fuente', 'admin_evidencia', 'telefono', p_tel, 'texto_version', 'zz-campanias',
        'evidencia', jsonb_build_object('tipo', 'papel_firmado', 'referencia', 'Planilla sintética'),
        'ocurrido_en', to_char((clock_timestamp() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'admin');
    end $f$;

    create function pg_temp.baja(p_tel text) returns void language plpgsql as $f$
    begin
      perform public.mkt_consentimiento_registrar(gen_random_uuid(), jsonb_build_object(
        'tipo', 'baja', 'fuente', 'admin_pedido', 'telefono', p_tel, 'evidencia', jsonb_build_object('canal', 'presencial')), 'admin');
    end $f$;

    create function pg_temp.dest(p_tel text) returns jsonb language sql as $f$
      select jsonb_build_object('telefono', p_tel, 'nombre', 'Sintético', 'indicativo', '351',
                                'ultima_visita', to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date - 3, 'YYYY-MM-DD'), 'turno_id', '1');
    $f$;

    create function pg_temp.estado_de(p_c uuid, p_tel text) returns text language sql as $f$
      select estado || '|' || coalesce(motivo, '') from public.mkt_campania_destinatarios where campania_id = p_c and telefono = p_tel;
    $f$;

    insert into public.mkt_textos_consentimiento (version, titulo, texto, huella)
    values ('zz-campanias', 'Prueba campañas', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp. Verificación de campañas.', '');
    perform public.mkt_texto_publicar('zz-campanias', 'admin');
    for v_n in 1 .. 8 loop perform pg_temp.alta('35199800' || lpad(v_n::text, 2, '0')); end loop;

    v_datos := jsonb_build_object(
      'nombre', 'Verificación', 'objetivo', 'Volver al stand', 'ventana_dias', 14, 'mensaje', 'Hola {nombre}, tu código {codigo}',
      'productos', jsonb_build_array('reserva', 'gift_card'), 'indicativos', '[]'::jsonb,
      'beneficio_tipo', 'porcentaje', 'beneficio_valor', 10, 'beneficio_vigencia_dias', 5,
      'limite_destinatarios', 3, 'tarifa', 0.05, 'moneda', 'usd', 'presupuesto_maximo', 1);

    -- K1 · crear: solo admin; la misma clave devuelve la misma campaña (doble clic).
    v_r := pg_temp.intentar(format('select public.mkt_campania_guardar(null, null, %L, %L, %L)', v_k, v_datos, 'staff'));
    v_j := public.mkt_campania_guardar(null, null, v_k, v_datos, 'admin');
    v_c := (v_j -> 'campania' ->> 'id')::uuid;
    v_j2 := public.mkt_campania_guardar(null, null, v_k, v_datos, 'admin');
    v_log := v_log || case when v_r like '42501:solo_admin%' and not (v_j ->> 'repetida')::boolean and (v_j2 ->> 'repetida')::boolean
                              and (v_j2 -> 'campania' ->> 'id')::uuid = v_c and v_j -> 'campania' ->> 'moneda' = 'USD'
                              and v_j -> 'campania' ->> 'estado' = 'borrador' and v_j -> 'campania' ->> 'modo' = 'simulacion'
                              and (select count(*) from public.mkt_campanias where clave_creacion = v_k) = 1
                           then 'K1 ' else 'FALLA:K1 ' end;

    -- K2 · editar: versión optimista; la base rechaza valores fuera de rango.
    v_r := pg_temp.intentar(format('select public.mkt_campania_guardar(%L, 7, null, %L, %L)', v_c, v_datos, 'admin'));
    v_r2 := pg_temp.intentar(format('select public.mkt_campania_guardar(%L, 1, null, %L, %L)', v_c, v_datos || '{"ventana_dias": 30}', 'admin'));
    v_j := public.mkt_campania_guardar(v_c, 1, null, v_datos || '{"nombre": "Verificación editada"}', 'admin');
    v_n := 0;
    if pg_temp.intentar(format('select public.mkt_campania_guardar(%L, 2, null, %L, %L)', v_c, v_datos || '{"beneficio_valor": 150}', 'admin')) like '23514:%mkt_campanias_beneficio%' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('select public.mkt_campania_guardar(%L, 2, null, %L, %L)', v_c, v_datos || '{"productos": ["stand"]}', 'admin')) like '23514:%mkt_campanias_productos%' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('select public.mkt_campania_guardar(%L, 2, null, %L, %L)', v_c, v_datos || '{"mensaje": "corto"}', 'admin')) like '23514:%mkt_campanias_mensaje%' then v_n := v_n + 1; end if;
    v_log := v_log || case when v_r like '40001:version_desactualizada%' and v_r2 like '23514:%mkt_campanias_ventana%' and v_n = 3
                              and (v_j -> 'campania' ->> 'version')::integer = 2 and v_j -> 'campania' ->> 'nombre' = 'Verificación editada'
                           then 'K2 ' else 'FALLA:K2 ' end;

    -- K3 · preparar: topes de límite y presupuesto, duplicados y teléfonos no canónicos se rechazan sin cambios.
    v_lista := jsonb_build_array(pg_temp.dest('3519980001'), pg_temp.dest('3519980002'), pg_temp.dest('3519980003'), pg_temp.dest('3519980004'));
    v_n := 0;
    if pg_temp.intentar(format('select public.mkt_campania_preparar(%L, 2, %L, %L, %L)', v_c, v_aud, v_lista, 'admin')) like '22023:tope_excedido:limite%' then v_n := v_n + 1; end if;
    perform public.mkt_campania_guardar(v_c, 2, null, v_datos || '{"limite_destinatarios": null, "presupuesto_maximo": 0.1}', 'admin');
    if pg_temp.intentar(format('select public.mkt_campania_preparar(%L, 3, %L, %L, %L)', v_c, v_aud, v_lista, 'admin')) like '22023:tope_excedido:presupuesto%' then v_n := v_n + 1; end if;
    perform public.mkt_campania_guardar(v_c, 3, null, v_datos, 'admin');
    if pg_temp.intentar(format('select public.mkt_campania_preparar(%L, 4, %L, %L, %L)', v_c, v_aud,
         jsonb_build_array(pg_temp.dest('3519980001'), pg_temp.dest('3519980001')), 'admin')) like '23505:destinatario_duplicado%' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('select public.mkt_campania_preparar(%L, 4, %L, %L, %L)', v_c, v_aud,
         jsonb_build_array(pg_temp.dest('+54 9 351 998-0001')), 'admin')) like '22023:datos_invalidos:telefono%' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('select public.mkt_campania_preparar(%L, 4, %L, %L, %L)', v_c, v_aud, v_lista, 'staff')) like '42501:solo_admin%' then v_n := v_n + 1; end if;
    v_log := v_log || case when v_n = 5 and (select count(*) from public.mkt_campania_destinatarios where campania_id = v_c) = 0
                              and (select estado from public.mkt_campanias where id = v_c) = 'borrador'
                           then 'K3 ' else 'FALLA:K3 ' end;

    -- K4 · preparar: revisa consentimiento otra vez; beneficios ficticios únicos y estables; doble clic = repetida.
    perform pg_temp.baja('3519980003');
    v_lista := jsonb_build_array(pg_temp.dest('3519980001'), pg_temp.dest('3519980002'), pg_temp.dest('3519980003'));
    v_j := public.mkt_campania_preparar(v_c, 4, v_aud, v_lista, 'admin');
    v_j2 := public.mkt_campania_preparar(v_c, 4, v_aud, v_lista, 'admin');
    v_log := v_log || case when not (v_j ->> 'repetida')::boolean and (v_j2 ->> 'repetida')::boolean
                              and v_j -> 'campania' ->> 'estado' = 'preparada' and (v_j -> 'campania' ->> 'seleccionados')::integer = 2
                              and (v_j -> 'campania' -> 'audiencia' -> 'al_preparar' ->> 'sin_consentimiento')::integer = 1
                              and (v_j -> 'campania' ->> 'costo_maximo')::numeric = 0.10
                              and (select count(*) from public.mkt_campania_destinatarios where campania_id = v_c) = 2
                              and (select count(distinct beneficio_codigo) from public.mkt_campania_destinatarios where campania_id = v_c) = 2
                              and not exists (select 1 from public.mkt_campania_destinatarios d join public.codigos_descuento cd on cd.codigo = d.beneficio_codigo)
                              and (select bool_and(beneficio_codigo ~ '^SIMU-[A-HJ-NP-Z2-9]{8}$' and codigo_id is null) from public.mkt_campania_destinatarios where campania_id = v_c)
                              and pg_temp.intentar(format('select public.mkt_campania_guardar(%L, 5, null, %L, %L)', v_c, v_datos, 'admin')) like '55000:no_editable:preparada%'
                           then 'K4 ' else 'FALLA:K4 ' end;

    -- K5 · otra campaña no toma un teléfono que ya está en curso; audiencia vacía no se prepara.
    v_j := public.mkt_campania_guardar(null, null, gen_random_uuid(), v_datos || '{"nombre": "Otra campaña"}', 'admin');
    v_c2 := (v_j -> 'campania' ->> 'id')::uuid;
    v_r := pg_temp.intentar(format('select public.mkt_campania_preparar(%L, 1, %L, %L, %L)', v_c2, v_aud, jsonb_build_array(pg_temp.dest('3519980001')), 'admin'));
    v_j := public.mkt_campania_preparar(v_c2, 1, v_aud, jsonb_build_array(pg_temp.dest('3519980002'), pg_temp.dest('3519980005')), 'admin');
    v_log := v_log || case when v_r like '22023:audiencia_vacia%'
                              and (v_j -> 'campania' ->> 'seleccionados')::integer = 1
                              and (v_j -> 'campania' -> 'audiencia' -> 'al_preparar' ->> 'en_otra_campania')::integer = 1
                              and pg_temp.estado_de(v_c2, '3519980005') = 'pendiente|'
                           then 'K5 ' else 'FALLA:K5 ' end;

    -- K6 · transiciones: solo desde el estado correcto, repetirlas no cambia nada.
    v_r := pg_temp.intentar(format('select public.mkt_campania_cambiar(%L, %L, %L)', v_c, 'pausar', 'admin'));
    v_j := public.mkt_campania_cambiar(v_c, 'iniciar', 'admin');
    v_j2 := public.mkt_campania_cambiar(v_c, 'iniciar', 'admin');
    v_log := v_log || case when v_r like '55000:transicion_invalida:preparada%' and v_j -> 'campania' ->> 'estado' = 'ejecutando'
                              and (v_j2 ->> 'repetida')::boolean
                              and pg_temp.intentar(format('select public.mkt_campania_cambiar(%L, %L, %L)', v_c, 'iniciar', 'staff')) like '42501:%'
                              and (select count(*) from public.mkt_campania_eventos where campania_id = v_c and tipo = 'iniciar') = 1
                           then 'K6 ' else 'FALLA:K6 ' end;

    -- K7 · una baja posterior a preparar excluye al destinatario EN EL ACTO (antes de cualquier lote);
    -- cada uno lo toma un solo ejecutor.
    perform pg_temp.baja('3519980002');
    v_r := pg_temp.estado_de(v_c, '3519980002');
    v_j := public.mkt_campania_tomar_lote(v_c, v_e1, 10, 60);
    v_j2 := public.mkt_campania_tomar_lote(v_c, v_e2, 10, 60);
    v_d := (select id from public.mkt_campania_destinatarios where campania_id = v_c and telefono = '3519980001');
    v_log := v_log || case when v_r = 'excluido|baja_posterior'
                              and jsonb_array_length(v_j -> 'tomados') = 1 and v_j -> 'tomados' -> 0 ->> 'telefono' = '3519980001'
                              and (v_j -> 'excluidos' ->> 'baja_posterior')::integer = 0
                              and jsonb_array_length(v_j2 -> 'tomados') = 0
                              and pg_temp.estado_de(v_c, '3519980002') = 'excluido|baja_posterior'
                              and (select estado || '|' || tomado_por || '|' || intentos from public.mkt_campania_destinatarios where id = v_d) = 'enviando|' || v_e1 || '|1'
                           then 'K7 ' else 'FALLA:K7 ' end;

    -- K8 · resultado: solo el ejecutor que lo tomó; aceptado repetido = repetida; entrega con costo = tarifa.
    v_j := public.mkt_campania_registrar_envio(v_d, v_e2, 'aceptado', '{"wamid": "wamid.X"}');
    v_j2 := public.mkt_campania_registrar_envio(v_d, v_e1, 'aceptado', '{"wamid": "wamid.SIM.1"}');
    v_r := public.mkt_campania_registrar_envio(v_d, v_e1, 'aceptado', '{"wamid": "wamid.SIM.1"}') ->> 'repetida';
    v_r2 := public.mkt_campania_registrar_entrega(v_d, 'entregado', null) ->> 'estado';
    v_log := v_log || case when v_j ->> 'motivo' = 'no_es_del_ejecutor' and v_j2 ->> 'estado' = 'aceptado' and v_r = 'true' and v_r2 = 'entregado'
                              and (public.mkt_campania_registrar_entrega(v_d, 'entregado', null) ->> 'repetida')::boolean
                              and (select costo from public.mkt_campania_destinatarios where id = v_d) = 0.05
                              and (select estado from public.mkt_campanias where id = v_c) = 'ejecutando'
                              and (public.mkt_campania_verificar_fin(v_c) ->> 'estado') = 'completada'
                           then 'K8 ' else 'FALLA:K8 ' end;

    -- K9 · reintentos: transitorio vuelve a la cola con espera; al tercero, fallido.
    perform public.mkt_campania_cambiar(v_c2, 'iniciar', 'admin');
    v_d2 := (select id from public.mkt_campania_destinatarios where campania_id = v_c2 and telefono = '3519980005');
    perform public.mkt_campania_tomar_lote(v_c2, v_e1, 5, 60);
    v_r := public.mkt_campania_registrar_envio(v_d2, v_e1, 'transitorio', '{"codigo": "130429", "reintentar_en_s": 1}') ->> 'estado';
    v_n := jsonb_array_length(public.mkt_campania_tomar_lote(v_c2, v_e1, 5, 60) -> 'tomados');
    update public.mkt_campania_destinatarios set proximo_intento_en = now() - interval '1 second' where id = v_d2;
    perform public.mkt_campania_tomar_lote(v_c2, v_e1, 5, 60);
    perform public.mkt_campania_registrar_envio(v_d2, v_e1, 'transitorio', '{"codigo": "130429"}');
    update public.mkt_campania_destinatarios set proximo_intento_en = now() - interval '1 second' where id = v_d2;
    perform public.mkt_campania_tomar_lote(v_c2, v_e1, 5, 60);
    v_r2 := public.mkt_campania_registrar_envio(v_d2, v_e1, 'transitorio', '{"codigo": "130429"}') ->> 'estado';
    v_log := v_log || case when v_r = 'pendiente' and v_n = 0 and v_r2 = 'fallido'
                              and pg_temp.estado_de(v_c2, '3519980005') = 'fallido|reintentos_agotados'
                              and (select intentos || '|' || ultimo_codigo from public.mkt_campania_destinatarios where id = v_d2) = '3|130429'
                           then 'K9 ' else 'FALLA:K9 ' end;

    -- K10 · turno vencido (reinicio del ejecutor) → incierto; la respuesta tardía del mismo ejecutor lo resuelve;
    -- un incierto informado no se reintenta solo y lo decide un admin.
    v_j := public.mkt_campania_guardar(null, null, gen_random_uuid(), v_datos || '{"nombre": "Incierta", "limite_destinatarios": null, "presupuesto_maximo": null}', 'admin');
    v_c2 := (v_j -> 'campania' ->> 'id')::uuid;
    perform public.mkt_campania_preparar(v_c2, 1, v_aud, jsonb_build_array(pg_temp.dest('3519980006'), pg_temp.dest('3519980007')), 'admin');
    perform public.mkt_campania_cambiar(v_c2, 'iniciar', 'admin');
    perform public.mkt_campania_tomar_lote(v_c2, v_e1, 5, 60);
    update public.mkt_campania_destinatarios set tomado_hasta = now() - interval '1 second' where campania_id = v_c2;
    v_j := public.mkt_campania_tomar_lote(v_c2, v_e2, 5, 60);
    v_d := (select id from public.mkt_campania_destinatarios where campania_id = v_c2 and telefono = '3519980006');
    v_d2 := (select id from public.mkt_campania_destinatarios where campania_id = v_c2 and telefono = '3519980007');
    v_r := public.mkt_campania_registrar_envio(v_d, v_e1, 'aceptado', '{"wamid": "wamid.TARDE"}') ->> 'estado';
    v_n := 0;
    if pg_temp.estado_de(v_c2, '3519980007') = 'incierto|ejecutor_interrumpido' then v_n := v_n + 1; end if;
    if (v_j ->> 'interrumpidos')::integer = 2 and (v_j ->> 'completada')::boolean then v_n := v_n + 1; end if;
    if (select estado from public.mkt_campanias where id = v_c2) = 'completada' then v_n := v_n + 1; end if;
    v_r2 := public.mkt_campania_resolver_incierto(v_d2, 'reintentar', 'admin') ->> 'estado';
    if (select estado from public.mkt_campanias where id = v_c2) = 'ejecutando' then v_n := v_n + 1; end if;
    perform public.mkt_campania_tomar_lote(v_c2, v_e1, 5, 60);
    perform public.mkt_campania_registrar_envio(v_d2, v_e1, 'incierto', '{"codigo": "sin_respuesta"}');
    if jsonb_array_length(public.mkt_campania_tomar_lote(v_c2, v_e1, 5, 60) -> 'tomados') = 0 then v_n := v_n + 1; end if;
    if public.mkt_campania_registrar_envio(v_d2, v_e1, 'aceptado', '{"wamid": "wamid.Y"}') ->> 'motivo' = 'estado_incierto' then v_n := v_n + 1; end if;
    if public.mkt_campania_resolver_incierto(v_d2, 'fallido', 'admin') ->> 'estado' = 'fallido' then v_n := v_n + 1; end if;
    v_log := v_log || case when v_r = 'aceptado' and v_r2 = 'pendiente' and v_n = 7
                              and pg_temp.estado_de(v_c2, '3519980007') = 'fallido|incierto_descartado'
                           then 'K10 ' else 'FALLA:K10 ' end;

    -- K11 · pausa y cancelación: en pausa no se toma nada; cancelar pasa los pendientes a 'cancelado' sin borrar.
    v_j := public.mkt_campania_guardar(null, null, gen_random_uuid(), v_datos || '{"nombre": "Cancelable", "limite_destinatarios": null, "presupuesto_maximo": null}', 'admin');
    v_c2 := (v_j -> 'campania' ->> 'id')::uuid;
    perform public.mkt_campania_preparar(v_c2, 1, v_aud, jsonb_build_array(pg_temp.dest('3519980008'), pg_temp.dest('3519980004')), 'admin');
    perform public.mkt_campania_cambiar(v_c2, 'iniciar', 'admin');
    perform public.mkt_campania_cambiar(v_c2, 'pausar', 'admin');
    v_j := public.mkt_campania_tomar_lote(v_c2, v_e1, 5, 60);
    v_j2 := public.mkt_campania_cambiar(v_c2, 'cancelar', 'admin');
    v_log := v_log || case when not (v_j ->> 'ok')::boolean and v_j ->> 'motivo' = 'pausada'
                              and (v_j2 ->> 'pendientes_cancelados')::integer = 2
                              and (select count(*) from public.mkt_campania_destinatarios where campania_id = v_c2 and estado = 'cancelado') = 2
                              and (public.mkt_campania_cambiar(v_c2, 'cancelar', 'admin') ->> 'repetida')::boolean
                              and pg_temp.intentar(format('select public.mkt_campania_cambiar(%L, %L, %L)', v_c2, 'reanudar', 'admin')) like '55000:transicion_invalida:cancelada%'
                           then 'K11 ' else 'FALLA:K11 ' end;

    -- K12 · historial: no se borra ni se reescribe; los beneficios no pueden ser códigos reales.
    v_n := 0;
    if pg_temp.intentar(format('delete from public.mkt_campanias where id = %L', v_c2)) like '55000:historial_inmutable%' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('delete from public.mkt_campania_destinatarios where campania_id = %L', v_c2)) like '55000:historial_inmutable%' then v_n := v_n + 1; end if;
    if pg_temp.intentar('update public.mkt_campania_eventos set tipo = ''x''') like '55000:historial_inmutable%' then v_n := v_n + 1; end if;
    if pg_temp.intentar($q$insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, activo, creado_para)
                           values ('simu-ABCDEFGH', 'x', 'porcentaje', 10, true, 'zz')$q$) like '23514:%prefijo_simulacion%' then v_n := v_n + 1; end if;
    v_log := v_log || case when v_n = 4 then 'K12 ' else 'FALLA:K12 ' end;

    -- K13 · atribución: con un código real (stage futuro) la compra pagada se separa por producto, y el regreso al stand por teléfono.
    insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, creado_para)
    values ('ZZCAMP-ATRIB', 'verificación', 'porcentaje', 10, 1, 0, true, 'zz');
    v_d := (select id from public.mkt_campania_destinatarios where campania_id = v_c and telefono = '3519980001');
    execute 'set local session_replication_role = replica';
    update public.mkt_campania_destinatarios set codigo_id = (select id from public.codigos_descuento where codigo = 'ZZCAMP-ATRIB') where id = v_d;
    execute 'set local session_replication_role = origin';
    insert into public.gift_cards (codigo_unico, comprador_nombre, comprador_telefono, duracion_minutos, monto, estado_pago, fecha_pago, codigo_descuento, grupo_compra_id, canal)
    values ('ZZGC-CAMP-1', 'zz', '3519980001', 20, 9000, 'pagado', now(), 'ZZCAMP-ATRIB', gen_random_uuid(), 'web');
    insert into public.turnos_stand (id, nombre, telefono, fecha, hora, estado, total, metodo_pago)
    values ((select coalesce(max(id), 0) + 1 from public.turnos_stand), 'zz', '351 998-0001', (now() at time zone 'America/Argentina/Buenos_Aires')::date, '18:00', 'confirmado', 10000, 'efectivo');
    select to_jsonb(a) into v_j from public.mkt_campania_atribucion a where a.destinatario_id = v_d;
    select to_jsonb(a) into v_j2 from public.mkt_campania_atribucion a
     where a.campania_id = v_c and a.telefono = '3519980002';
    v_log := v_log || case when v_j ->> 'grupo_compra_id' is not null and v_j ->> 'reserva_id' is null
                              and (v_j ->> 'gift_card_tarjetas')::integer = 1 and v_j ->> 'regreso_turno_id' is not null
                              and not (v_j ->> 'beneficio_ficticio')::boolean
                              and v_j2 ->> 'regreso_turno_id' is null and (v_j2 ->> 'beneficio_ficticio')::boolean
                           then 'K13 ' else 'FALLA:K13 ' end;

    -- K15 · intentos: cada resultado queda por destinatario e intento (simulado); un turno vencido deja su
    -- intento 'incierto'; la respuesta tardía actualiza ESE intento; la entrega simulada lo marca cobrable.
    v_n := 0;
    if (select count(*) from public.mkt_whatsapp_envios where origen <> 'simulado') = 0 then v_n := v_n + 1; end if;
    if (select resultado || '|' || estado_meta || '|' || cobrable from public.mkt_whatsapp_envios
          where destinatario_id = (select id from public.mkt_campania_destinatarios where campania_id = v_c and telefono = '3519980001')) = 'aceptado|entregado|true' then v_n := v_n + 1; end if;
    if (select string_agg(intento || ':' || resultado, ',' order by intento) from public.mkt_whatsapp_envios e
          join public.mkt_campania_destinatarios d on d.id = e.destinatario_id where d.telefono = '3519980005') = '1:transitorio,2:transitorio,3:transitorio' then v_n := v_n + 1; end if;
    if (select string_agg(e.resultado || '|' || coalesce(e.wamid, '-'), ',' order by d.telefono, e.intento) from public.mkt_whatsapp_envios e
          join public.mkt_campania_destinatarios d on d.id = e.destinatario_id where d.telefono in ('3519980006', '3519980007'))
       = 'aceptado|wamid.TARDE,incierto|-,incierto|-' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('delete from public.mkt_whatsapp_envios where destinatario_id = %L', v_d)) like '55000:historial_inmutable%' then v_n := v_n + 1; end if;
    v_log := v_log || case when v_n = 5 then 'K15 ' else 'FALLA:K15:' || v_n || ' ' end;

    -- K16 · una baja excluye los PENDIENTES de todas las campañas y no toca lo ya enviado; un alta no excluye.
    v_j := public.mkt_campania_guardar(null, null, gen_random_uuid(), v_datos || '{"nombre": "Baja inmediata", "limite_destinatarios": null, "presupuesto_maximo": null}', 'admin');
    v_c2 := (v_j -> 'campania' ->> 'id')::uuid;
    perform pg_temp.alta('3519980009');
    perform pg_temp.alta('3519980010');
    perform public.mkt_campania_preparar(v_c2, 1, v_aud, jsonb_build_array(pg_temp.dest('3519980009'), pg_temp.dest('3519980010')), 'admin');
    v_r := pg_temp.estado_de(v_c2, '3519980009');
    perform pg_temp.baja('3519980009');
    perform pg_temp.baja('3519980001');
    v_log := v_log || case when v_r = 'pendiente|' and pg_temp.estado_de(v_c2, '3519980009') = 'excluido|baja_posterior'
                              and pg_temp.estado_de(v_c2, '3519980010') = 'pendiente|'
                              and pg_temp.estado_de(v_c, '3519980001') = 'entregado|'
                           then 'K16 ' else 'FALLA:K16 ' end;

    -- K14 · permisos: service_role solo lee; anon no ve ni ejecuta nada.
    execute 'set local role service_role';
    v_n := 0;
    if pg_temp.intentar('select count(*) from public.mkt_campania_destinatarios') = 'ok' then v_n := v_n + 1; end if;
    if pg_temp.intentar('select count(*) from public.mkt_campania_atribucion') = 'ok' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('update public.mkt_campania_destinatarios set estado = %L', 'entregado')) like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('insert into public.mkt_campania_eventos (campania_id, tipo, actor) values (%L, %L, %L)', v_c, 'x', 'admin')) like '42501:%' then v_n := v_n + 1; end if;
    execute 'reset role';
    execute 'set local role anon';
    if pg_temp.intentar('select count(*) from public.mkt_campanias') like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar(format('select public.mkt_campania_tomar_lote(%L, %L, 5, 60)', v_c, v_e1)) like '42501:%' then v_n := v_n + 1; end if;
    execute 'reset role';
    v_log := v_log || case when v_n = 6 then 'K14 ' else 'FALLA:K14 ' end;

    raise exception 'MARKETING-CAMPANIAS|%', v_log;
  exception when others then
    v_resultado := case when sqlerrm like 'MARKETING-CAMPANIAS|%' then sqlerrm
                        else 'MARKETING-CAMPANIAS|' || v_log || 'ABORTO:' || sqlstate || ':' || sqlerrm end;
  end;
  raise exception 'RESULTADO %', v_resultado;
end $mcamp$;

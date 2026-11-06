-- ============================================================================
-- Verificación de la bandeja del webhook de WhatsApp (Marketing), SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: se deshace entero.
-- Teléfonos sintéticos 35199700NN, wamids 'wamid.ZZ…'. Resultado:
-- "RESULTADO MARKETING-WHATSAPP|W1 W2 ..."; "FALLA:" / "ABORTO:" como siempre.
-- Los envíos 'real' se insertan a mano (como postgres): ninguna RPC de esta
-- etapa crea envíos reales.
--
-- Solo para el stack LOCAL: node scripts/pruebas/marketing-whatsapp.mjs
-- ============================================================================
do $mwa$
declare
  v_log       text := '';
  v_resultado text;
  v_j         jsonb;
  v_r         text;
  v_n         integer;
  v_c         uuid;
  v_c2        uuid;
  v_d         uuid;
  v_d2        uuid;
  v_d3        uuid;
  v_ahora     timestamptz := clock_timestamp();
  v_aud       jsonb := '{"calculado_en": "verificacion"}'::jsonb;
  v_datos     jsonb;
begin
  begin
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
        'tipo', 'alta', 'fuente', 'admin_evidencia', 'telefono', p_tel, 'texto_version', 'zz-wa',
        'evidencia', jsonb_build_object('tipo', 'papel_firmado', 'referencia', 'Planilla sintética'),
        'ocurrido_en', to_char((clock_timestamp() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'admin');
    end $f$;

    create function pg_temp.dest(p_tel text) returns jsonb language sql as $f$
      select jsonb_build_object('telefono', p_tel, 'nombre', null, 'indicativo', '351',
                                'ultima_visita', to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date - 3, 'YYYY-MM-DD'), 'turno_id', '1');
    $f$;

    create function pg_temp.ev(p_clave text, p_tipo text, p jsonb) returns jsonb language sql as $f$
      select jsonb_build_object('clave', p_clave, 'tipo', p_tipo, 'ocurrido_en', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) || p;
    $f$;

    create function pg_temp.estado(p_tel text) returns text language sql as $f$
      select coalesce((select estado from public.mkt_consentimiento_estado where telefono = p_tel), 'sin_registro');
    $f$;

    insert into public.mkt_textos_consentimiento (version, titulo, texto, huella)
    values ('zz-wa', 'Prueba WhatsApp', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp. Verificación del webhook.', '');
    perform public.mkt_texto_publicar('zz-wa', 'admin');
    for v_n in 1 .. 6 loop perform pg_temp.alta('35199700' || lpad(v_n::text, 2, '0')); end loop;

    v_datos := jsonb_build_object('nombre', 'Verificación WA', 'objetivo', 'Webhook', 'ventana_dias', 14,
      'mensaje', 'Hola {nombre} {codigo}', 'productos', jsonb_build_array('reserva', 'gift_card'), 'indicativos', '[]'::jsonb,
      'beneficio_tipo', 'porcentaje', 'beneficio_valor', 10, 'beneficio_vigencia_dias', 5, 'tarifa', 0.05, 'moneda', 'USD');
    v_c := (public.mkt_campania_guardar(null, null, gen_random_uuid(), v_datos, 'admin') -> 'campania' ->> 'id')::uuid;
    perform public.mkt_campania_preparar(v_c, 1, v_aud, jsonb_build_array(pg_temp.dest('3519970001'), pg_temp.dest('3519970002'), pg_temp.dest('3519970003')), 'admin');
    v_d := (select id from public.mkt_campania_destinatarios where campania_id = v_c and telefono = '3519970001');
    v_d2 := (select id from public.mkt_campania_destinatarios where campania_id = v_c and telefono = '3519970002');
    v_d3 := (select id from public.mkt_campania_destinatarios where campania_id = v_c and telefono = '3519970003');
    -- Envíos 'real' sintéticos: dos aceptados y uno incierto sin wamid.
    update public.mkt_campania_destinatarios set estado = 'aceptado', wamid = 'wamid.ZZ1', aceptado_en = v_ahora, intentos = 1 where id = v_d;
    update public.mkt_campania_destinatarios set estado = 'aceptado', wamid = 'wamid.ZZ2', aceptado_en = v_ahora, intentos = 1 where id = v_d2;
    update public.mkt_campania_destinatarios set estado = 'incierto', motivo = 'respuesta_incierta', intentos = 1 where id = v_d3;
    insert into public.mkt_whatsapp_envios (destinatario_id, campania_id, intento, origen, resultado, wamid, aceptado_en) values
      (v_d, v_c, 1, 'real', 'aceptado', 'wamid.ZZ1', v_ahora),
      (v_d2, v_c, 1, 'real', 'aceptado', 'wamid.ZZ2', v_ahora),
      (v_d3, v_c, 1, 'real', 'incierto', null, null);

    -- W1 · guardar es idempotente por clave; un lote con una fila inválida no guarda nada.
    v_j := public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('estado:wamid.ZZ1:sent', 'estado', '{"wamid": "wamid.ZZ1", "estado_meta": "sent", "wa_id": "5493519970001"}')));
    v_r := public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('estado:wamid.ZZ1:sent', 'estado', '{"wamid": "wamid.ZZ1", "estado_meta": "sent", "wa_id": "5493519970001"}'))) ->> 'repetidos';
    v_log := v_log || case when (v_j ->> 'nuevos')::integer = 1 and v_r = '1'
                              and pg_temp.intentar($q$select public.mkt_wa_registrar_eventos(jsonb_build_array(
                                    jsonb_build_object('clave', 'estado:wamid.ZZX:sent', 'tipo', 'estado', 'wamid', 'wamid.ZZX', 'estado_meta', 'sent', 'ocurrido_en', now()),
                                    jsonb_build_object('clave', 'estado:wamid.ZZY:raro', 'tipo', 'estado', 'wamid', 'wamid.ZZY', 'estado_meta', 'raro', 'ocurrido_en', now())))$q$) like '23514:%'
                              and (select count(*) from public.mkt_whatsapp_eventos where wamid in ('wamid.ZZX', 'wamid.ZZY')) = 0
                              and (select ultimo_evento_firmado_en is not null from public.mkt_whatsapp_estado)
                           then 'W1 ' else 'FALLA:W1 ' end;

    -- W2 · en orden: enviado → entregado (cobrable) → leído; el destinatario queda entregado y leído.
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('estado:wamid.ZZ1:delivered', 'estado', '{"wamid": "wamid.ZZ1", "estado_meta": "delivered", "pricing": {"type": "regular", "category": "marketing", "billable": true, "pricing_model": "PMP"}}'),
      pg_temp.ev('estado:wamid.ZZ1:read', 'estado', '{"wamid": "wamid.ZZ1", "estado_meta": "read"}')));
    v_j := public.mkt_wa_procesar_eventos(50);
    v_log := v_log || case when (v_j ->> 'procesados')::integer = 3 and (v_j ->> 'pendientes')::integer = 0
                              and (select estado_meta || '|' || cobrable || '|' || pricing_categoria || '|' || (enviado_en is not null) || (entregado_en is not null) || (leido_en is not null)
                                     from public.mkt_whatsapp_envios where wamid = 'wamid.ZZ1') = 'leido|true|marketing|truetruetrue'
                              and (select estado || '|' || (leido_en is not null) || '|' || costo from public.mkt_campania_destinatarios where id = v_d) = 'entregado|true|0.050000'
                           then 'W2 ' else 'FALLA:W2 ' end;

    -- W3 · fuera de orden: leído antes que entregado y enviado no retrocede; las fechas que faltaban se completan.
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('estado:wamid.ZZ2:read', 'estado', '{"wamid": "wamid.ZZ2", "estado_meta": "read"}')));
    perform public.mkt_wa_procesar_eventos(50);
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('estado:wamid.ZZ2:delivered', 'estado', '{"wamid": "wamid.ZZ2", "estado_meta": "delivered"}'),
      pg_temp.ev('estado:wamid.ZZ2:sent', 'estado', '{"wamid": "wamid.ZZ2", "estado_meta": "sent"}'),
      pg_temp.ev('estado:wamid.ZZ2:failed', 'estado', '{"wamid": "wamid.ZZ2", "estado_meta": "failed", "error_codigo": "131026"}')));
    perform public.mkt_wa_procesar_eventos(50);
    v_log := v_log || case when (select estado_meta || '|' || (enviado_en is not null) || '|' || coalesce(error_codigo, '-') from public.mkt_whatsapp_envios where wamid = 'wamid.ZZ2') = 'leido|true|-'
                              and (select estado from public.mkt_campania_destinatarios where id = v_d2) = 'entregado'
                           then 'W3 ' else 'FALLA:W3 ' end;

    -- W4 · el incierto sin wamid se resuelve por biz_opaque_callback_data ("<destinatario>:<intento>").
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('estado:wamid.ZZ3:delivered', 'estado', jsonb_build_object('wamid', 'wamid.ZZ3', 'estado_meta', 'delivered', 'biz_opaque', v_d3 || ':1'))));
    perform public.mkt_wa_procesar_eventos(50);
    v_log := v_log || case when (select wamid || '|' || estado_meta from public.mkt_whatsapp_envios where destinatario_id = v_d3) = 'wamid.ZZ3|entregado'
                              and (select estado || '|' || wamid || '|' || coalesce(motivo, '-') from public.mkt_campania_destinatarios where id = v_d3) = 'entregado|wamid.ZZ3|-'
                           then 'W4 ' else 'FALLA:W4 ' end;

    -- W5 · un estado de un wamid que no es un envío real (simulado o ajeno) no toca nada.
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('estado:wamid.SIMULADO.abc:delivered', 'estado', '{"wamid": "wamid.SIMULADO.abc", "estado_meta": "delivered"}')));
    perform public.mkt_wa_procesar_eventos(50);
    v_log := v_log || case when (select resultado from public.mkt_whatsapp_eventos where clave = 'estado:wamid.SIMULADO.abc:delivered') = 'sin_envio'
                           then 'W5 ' else 'FALLA:W5 ' end;

    -- W6 · 131050 (frenó el marketing): no_entregado + baja de WhatsApp, que excluye sus pendientes de otra campaña.
    v_c2 := (public.mkt_campania_guardar(null, null, gen_random_uuid(), v_datos || '{"nombre": "Otra WA"}', 'admin') -> 'campania' ->> 'id')::uuid;
    perform public.mkt_campania_preparar(v_c2, 1, v_aud, jsonb_build_array(pg_temp.dest('3519970004')), 'admin');
    update public.mkt_campania_destinatarios set estado = 'aceptado', wamid = 'wamid.ZZ4', intentos = 1 where campania_id = v_c and telefono = '3519970001' and false;
    insert into public.mkt_whatsapp_envios (destinatario_id, campania_id, intento, origen, resultado, wamid, aceptado_en)
    select id, campania_id, 2, 'real', 'aceptado', 'wamid.ZZ4', v_ahora from public.mkt_campania_destinatarios where campania_id = v_c2 and telefono = '3519970004';
    update public.mkt_campania_destinatarios set estado = 'aceptado', wamid = 'wamid.ZZ4', intentos = 2 where campania_id = v_c2 and telefono = '3519970004';
    -- y el mismo teléfono pendiente en una tercera campaña
    v_j := public.mkt_campania_guardar(null, null, gen_random_uuid(), v_datos || '{"nombre": "Tercera WA"}', 'admin');
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('estado:wamid.ZZ4:failed', 'estado', '{"wamid": "wamid.ZZ4", "estado_meta": "failed", "error_codigo": "131050"}')));
    perform public.mkt_wa_procesar_eventos(50);
    v_log := v_log || case when (select resultado from public.mkt_whatsapp_eventos where clave = 'estado:wamid.ZZ4:failed') = 'estado_fallido_baja'
                              and (select estado || '|' || ultimo_codigo from public.mkt_campania_destinatarios where campania_id = v_c2 and telefono = '3519970004') = 'no_entregado|131050'
                              and pg_temp.estado('3519970004') = 'baja'
                              and (select fuente || '|' || (evidencia ->> 'origen') from public.mkt_consentimiento_eventos where telefono = '3519970004' and tipo = 'baja') = 'whatsapp|error_131050'
                           then 'W6 ' else 'FALLA:W6 ' end;

    -- W7 · mensaje inequívoco de baja (texto o botón) registra la baja y excluye pendientes; repetirlo no duplica.
    v_c2 := (public.mkt_campania_guardar(null, null, gen_random_uuid(), v_datos || '{"nombre": "Pendiente WA"}', 'admin') -> 'campania' ->> 'id')::uuid;
    perform public.mkt_campania_preparar(v_c2, 1, v_aud, jsonb_build_array(pg_temp.dest('3519970005')), 'admin');
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('mensaje:wamid.ZZIN5', 'mensaje', '{"wamid": "wamid.ZZIN5", "wa_id": "5493519970005", "intencion": "baja_texto"}'),
      pg_temp.ev('mensaje:wamid.ZZIN6', 'mensaje', '{"wamid": "wamid.ZZIN6", "wa_id": "5493519970006", "intencion": "baja_boton", "contexto_wamid": "wamid.ZZ1"}')));
    perform public.mkt_wa_procesar_eventos(50);
    v_r := public.mkt_wa_registrar_baja('5493519970005', 'texto', 'wamid.ZZIN5', v_ahora) ->> 'repetida';
    v_log := v_log || case when pg_temp.estado('3519970005') = 'baja' and pg_temp.estado('3519970006') = 'baja' and v_r = 'true'
                              and (select estado || '|' || motivo from public.mkt_campania_destinatarios where campania_id = v_c2) = 'excluido|baja_posterior'
                              and (select count(*) from public.mkt_consentimiento_eventos where telefono = '3519970005' and tipo = 'baja') = 1
                              and (select string_agg(resultado, ',' order by clave) from public.mkt_whatsapp_eventos where tipo = 'mensaje') = 'baja_registrada,baja_registrada'
                           then 'W7 ' else 'FALLA:W7 ' end;

    -- W8 · un mensaje común se ignora: no es alta ni baja; un número extranjero no se puede registrar.
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      pg_temp.ev('mensaje:wamid.ZZIN7', 'mensaje', '{"wamid": "wamid.ZZIN7", "wa_id": "5493519970007", "intencion": "otro"}'),
      pg_temp.ev('mensaje:wamid.ZZIN8', 'mensaje', '{"wamid": "wamid.ZZIN8", "wa_id": "34600111222", "intencion": "baja_texto"}')));
    perform public.mkt_wa_procesar_eventos(50);
    v_log := v_log || case when pg_temp.estado('3519970007') = 'sin_registro'
                              and (select string_agg(resultado, ',' order by clave) from public.mkt_whatsapp_eventos where clave in ('mensaje:wamid.ZZIN7', 'mensaje:wamid.ZZIN8')) = 'ignorado,telefono_no_normalizable'
                           then 'W8 ' else 'FALLA:W8 ' end;

    -- W9 · preferencias de Meta: stop = baja; resume queda registrado APARTE y no revierte la baja local.
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      jsonb_build_object('clave', 'preferencia:5493519970003:stop:1790000000', 'tipo', 'preferencia', 'wa_id', '5493519970003', 'preferencia', 'stop',
                         'ocurrido_en', to_char((clock_timestamp() - interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      jsonb_build_object('clave', 'preferencia:5493519970003:resume:1790000100', 'tipo', 'preferencia', 'wa_id', '5493519970003', 'preferencia', 'resume',
                         'ocurrido_en', to_char((clock_timestamp() - interval '10 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
    perform public.mkt_wa_procesar_eventos(50);
    v_log := v_log || case when pg_temp.estado('3519970003') = 'baja'
                              and (select string_agg(resultado, ',' order by ocurrido_en) from public.mkt_whatsapp_eventos where tipo = 'preferencia') = 'baja_registrada,reanudacion_registrada'
                              and (select ultima_preferencia || '|' || estado_local from public.mkt_whatsapp_preferencia_meta where wa_id = '5493519970003') = 'resume|baja'
                              and (select count(*) from public.mkt_consentimiento_eventos where telefono = '3519970003' and tipo = 'alta') = 1
                           then 'W9 ' else 'FALLA:W9 ' end;

    -- W10 · una baja VIEJA que llega tarde no pisa un alta posterior del propio titular (formulario web).
    insert into public.mkt_consentimiento_eventos (idempotency_key, huella, telefono, tipo, fuente, actor_rol, texto_version, texto_huella, evidencia, ocurrido_en, solicitado_en)
    select gen_random_uuid(), 'zz', '3519970008', 'alta', 'formulario_web', 'publico', 'zz-wa', t.huella, '{}'::jsonb,
           v_ahora - interval '1 day', v_ahora - interval '1 day'
      from public.mkt_textos_consentimiento t where t.version = 'zz-wa';
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      jsonb_build_object('clave', 'preferencia:5493519970008:stop:1789000000', 'tipo', 'preferencia', 'wa_id', '5493519970008', 'preferencia', 'stop',
                         'ocurrido_en', to_char((clock_timestamp() - interval '6 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
    perform public.mkt_wa_procesar_eventos(50);
    v_log := v_log || case when pg_temp.estado('3519970008') = 'alta'
                              and (select count(*) from public.mkt_consentimiento_eventos where telefono = '3519970008' and tipo = 'baja' and fuente = 'whatsapp') = 1
                           then 'W10 ' else 'FALLA:W10 ' end;

    -- W11 · un evento que falla al procesar queda pendiente con su error y se reintenta; a los 5, 'error'.
    perform public.mkt_wa_registrar_eventos(jsonb_build_array(
      jsonb_build_object('clave', 'mensaje:wamid.ZZVIEJO', 'tipo', 'mensaje', 'wamid', 'wamid.ZZVIEJO', 'wa_id', '5493519970009', 'intencion', 'baja_texto',
                         'ocurrido_en', to_char((clock_timestamp() - interval '60 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
    v_j := public.mkt_wa_procesar_eventos(50);
    v_r := (select intentos || '|' || (procesado_en is null) || '|' || (ultimo_error like '22023:%') from public.mkt_whatsapp_eventos where clave = 'mensaje:wamid.ZZVIEJO');
    for v_n in 1 .. 4 loop perform public.mkt_wa_procesar_eventos(50); end loop;
    v_log := v_log || case when (v_j ->> 'con_error')::integer = 1 and v_r = '1|true|true'
                              and (select intentos || '|' || resultado || '|' || (procesado_en is not null) from public.mkt_whatsapp_eventos where clave = 'mensaje:wamid.ZZVIEJO') = '5|error|true'
                              and (select ultimo_error is not null from public.mkt_whatsapp_estado)
                           then 'W11 ' else 'FALLA:W11 ' end;

    -- W12 · diagnóstico: rechazos por motivo y verificación del webhook; un motivo raro se rechaza.
    perform public.mkt_wa_anotar('rechazo:firma_invalida', null);
    perform public.mkt_wa_anotar('rechazo:firma_invalida', null);
    perform public.mkt_wa_anotar('rechazo:cuenta_ajena', null);
    perform public.mkt_wa_anotar('webhook_verificado', null);
    v_log := v_log || case when (select (rechazos -> 'firma_invalida' ->> 'n') || '|' || (rechazos -> 'cuenta_ajena' ->> 'n') || '|' || (webhook_verificado_en is not null) from public.mkt_whatsapp_estado) = '2|1|true'
                              and pg_temp.intentar($q$select public.mkt_wa_anotar('rechazo:Raro Motivo!', null)$q$) like '22023:%'
                           then 'W12 ' else 'FALLA:W12 ' end;

    -- W13 · permisos: service_role solo lee y llama las RPCs públicas; no procesa uno a mano ni escribe tablas.
    execute 'set local role service_role';
    v_n := 0;
    if pg_temp.intentar('select count(*) from public.mkt_whatsapp_eventos') = 'ok' then v_n := v_n + 1; end if;
    if pg_temp.intentar($q$insert into public.mkt_whatsapp_eventos (clave, tipo, wamid, estado_meta, ocurrido_en) values ('estado:x:sent', 'estado', 'x', 'sent', now())$q$) like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar('select public.mkt_wa_procesar_uno(1)') like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar('update public.mkt_whatsapp_envios set estado_meta = ''leido''') like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar('select public.mkt_wa_procesar_eventos(1)') = 'ok' then v_n := v_n + 1; end if;
    execute 'reset role';
    execute 'set local role anon';
    if pg_temp.intentar('select public.mkt_wa_registrar_eventos(''[]''::jsonb)') like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar($q$select public.mkt_wa_registrar_baja('5493519970001', 'texto', 'x', now())$q$) like '42501:%' then v_n := v_n + 1; end if;
    execute 'reset role';
    v_log := v_log || case when v_n = 7 then 'W13 ' else 'FALLA:W13:' || v_n || ' ' end;

    raise exception 'MARKETING-WHATSAPP|%', v_log;
  exception when others then
    v_resultado := case when sqlerrm like 'MARKETING-WHATSAPP|%' then sqlerrm
                        else 'MARKETING-WHATSAPP|' || v_log || 'ABORTO:' || sqlstate || ':' || sqlerrm end;
  end;
  raise exception 'RESULTADO %', v_resultado;
end $mwa$;

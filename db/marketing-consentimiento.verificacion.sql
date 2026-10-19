-- ============================================================================
-- Verificación de Marketing · consentimiento y bajas, SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: se deshace entero
-- (textos de prueba, eventos y la publicación del borrador incluidos).
-- Teléfonos sintéticos 351999xxxx. Resultado en el mensaje final:
-- "RESULTADO MKT-CONSENTIMIENTO|C1 C2 ..."; "FALLA:" marca lo que no se
-- cumplió y "ABORTO:" un error inesperado.
--
-- Solo para el stack LOCAL: node scripts/pruebas/marketing-consentimiento.mjs
-- ============================================================================
do $mkc$
declare
  v_log       text := '';
  v_resultado text;
  v_r         text;
  v_r2        text;
  v_k         uuid;
  v_k2        uuid;
  v_h1        text;
  v_h2        text;
  v_n         integer;
  v_t         timestamptz;
  v_j         jsonb;
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

    -- ok|estado|repetida|telefono  o  sqlstate:mensaje
    create function pg_temp.reg(p_key uuid, p_datos jsonb, p_rol text) returns text language plpgsql as $f$
    declare v jsonb;
    begin
      v := public.mkt_consentimiento_registrar(p_key, p_datos, p_rol);
      return 'ok|' || (v ->> 'estado') || '|' || (v ->> 'repetida') || '|' || (v ->> 'telefono');
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.estado(p_tel text) returns text language sql as $f$
      select coalesce((select estado from public.mkt_consentimiento_estado where telefono = p_tel), 'sin_registro');
    $f$;

    create function pg_temp.web_alta(p_tel text, p_version text, p_huella text, p_extra jsonb default '{}') returns jsonb
    language sql as $f$
      select jsonb_build_object('tipo', 'alta', 'fuente', 'formulario_web', 'telefono', p_tel,
                                'texto_version', p_version, 'texto_huella', p_huella) || p_extra;
    $f$;

    create function pg_temp.web_baja(p_tel text) returns jsonb language sql as $f$
      select jsonb_build_object('tipo', 'baja', 'fuente', 'formulario_web', 'telefono', p_tel);
    $f$;

    -- Punto de partida: ningún texto vigente (se deshace al final).
    update public.mkt_textos_consentimiento set estado = 'retirado', retirado_en = now(), retirado_por_rol = 'admin'
     where estado = 'vigente';

    -- C1 · el borrador semilla existe, nace borrador y su huella es el sha256 del texto.
    v_log := v_log || case when exists (
        select 1 from public.mkt_textos_consentimiento
         where version = 'promos-v1' and huella = encode(sha256(convert_to(texto, 'UTF8')), 'hex'))
      then 'C1 ' else 'FALLA:C1 ' end;

    -- C2 · un texto nace borrador; corregir un borrador recalcula la huella; no se borra.
    v_r := pg_temp.intentar($q$insert into public.mkt_textos_consentimiento (version, titulo, texto, huella, estado, publicado_en, publicado_por_rol)
                              values ('zz-vigente', 'Prueba', repeat('x', 60), '', 'vigente', now(), 'admin')$q$);
    insert into public.mkt_textos_consentimiento (version, titulo, texto, huella)
    values ('zz-uno', 'Prueba uno', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp. Versión uno.', '');
    select huella into v_h1 from public.mkt_textos_consentimiento where version = 'zz-uno';
    update public.mkt_textos_consentimiento set texto = texto || ' Corregido.' where version = 'zz-uno';
    select huella into v_h2 from public.mkt_textos_consentimiento where version = 'zz-uno';
    v_log := v_log || case when v_r like '%texto_nace_borrador%' and v_h1 <> v_h2
                              and v_h2 = (select encode(sha256(convert_to(texto, 'UTF8')), 'hex') from public.mkt_textos_consentimiento where version = 'zz-uno')
                              and pg_temp.intentar($q$delete from public.mkt_textos_consentimiento where version = 'zz-uno'$q$) like '%texto_inmutable%'
                           then 'C2 ' else 'FALLA:C2 ' end;

    -- C3 · sin texto vigente no hay altas públicas (las bajas sí).
    v_r := pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990001', 'zz-uno', v_h2), 'publico');
    v_r2 := pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('3519990009'), 'publico');
    v_log := v_log || case when v_r like '%consentimiento_no_habilitado%' and v_r2 = 'ok|baja|false|3519990009'
                           then 'C3 ' else 'FALLA:C3 ' end;

    -- C4 · publicar: solo admin, idempotente; publicar otro retira el anterior; uno solo vigente.
    v_r := pg_temp.intentar($q$select public.mkt_texto_publicar('zz-uno', 'staff')$q$);
    v_j := public.mkt_texto_publicar('zz-uno', 'admin');
    v_log := v_log || case when v_r like '%solo_admin%' and v_j ->> 'estado' = 'vigente' and (v_j ->> 'sin_cambios')::boolean = false
                              and (public.mkt_texto_publicar('zz-uno', 'admin') ->> 'sin_cambios')::boolean
                              and (select count(*) from public.mkt_textos_consentimiento where estado = 'vigente') = 1
                           then 'C4 ' else 'FALLA:C4 ' end;

    -- C5 · publicado = inmutable; las transiciones van solo hacia adelante.
    v_log := v_log || case when pg_temp.intentar($q$update public.mkt_textos_consentimiento set texto = texto || '!' where version = 'zz-uno'$q$) like '%texto_inmutable%'
                              and pg_temp.intentar($q$update public.mkt_textos_consentimiento set estado = 'borrador', publicado_en = null, publicado_por_rol = null where version = 'zz-uno'$q$) like '%transicion_invalida%'
                           then 'C5 ' else 'FALLA:C5 ' end;

    -- C6 · alta pública con la versión y huella vigentes: normaliza el teléfono y queda en alta.
    v_k := gen_random_uuid();
    v_r := pg_temp.reg(v_k, pg_temp.web_alta('+54 9 351 999-0001', 'zz-uno', v_h2,
                         '{"nombre": "  Ana   Prueba ", "localidad": " Córdoba ", "evidencia": {"pagina": "/promos", "ip_hash": "0123456789abcdef"}}'), 'publico');
    v_log := v_log || case when v_r = 'ok|alta|false|3519990001'
                              and (select nombre = 'Ana Prueba' and localidad = 'Córdoba' and alta_fuente = 'formulario_web' and alta_texto_version = 'zz-uno'
                                     from public.mkt_consentimiento_estado where telefono = '3519990001')
                              and (select texto_huella = v_h2 and actor_rol = 'publico' and evidencia ->> 'pagina' = '/promos'
                                     from public.mkt_consentimiento_eventos where idempotency_key = v_k)
                           then 'C6 ' else 'FALLA:C6 ' end;

    -- C7 · huella o versión que no son las vigentes → texto_desactualizado.
    v_r := pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990002', 'zz-uno', v_h1), 'publico');
    v_r2 := pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990002', 'promos-v1', v_h2), 'publico');
    v_log := v_log || case when v_r like '%texto_desactualizado%' and v_r2 like '%texto_desactualizado%' and pg_temp.estado('3519990002') = 'sin_registro'
                           then 'C7 ' else 'FALLA:C7 ' end;

    -- C8 · idempotencia: mismo pedido = mismo evento (aunque el texto cambie después); otra cosa con la misma clave = conflicto.
    select count(*) into v_n from public.mkt_consentimiento_eventos;
    v_r := pg_temp.reg(v_k, pg_temp.web_alta('351 999 0001', 'zz-uno', v_h2,
                         '{"nombre": "Ana Prueba", "localidad": "Córdoba", "evidencia": {"pagina": "/promos", "ip_hash": "0123456789abcdef"}}'), 'publico');
    v_r2 := pg_temp.reg(v_k, pg_temp.web_alta('3519990003', 'zz-uno', v_h2), 'publico');
    -- El mismo pedido desde otra red (otra huella de IP) sigue siendo el mismo pedido.
    v_h1 := pg_temp.reg(v_k, pg_temp.web_alta('3519990001', 'zz-uno', v_h2,
                         '{"nombre": "Ana Prueba", "localidad": "Córdoba", "evidencia": {"pagina": "/promos", "ip_hash": "fedcba9876543210"}}'), 'publico');
    v_log := v_log || case when v_r = 'ok|alta|true|3519990001' and v_r2 like '23505:idempotency_key_con_otro_payload%'
                              and v_h1 = 'ok|alta|true|3519990001'
                              and (select count(*) from public.mkt_consentimiento_eventos) = v_n
                           then 'C8 ' else 'FALLA:C8 ' end;

    -- C9 · teléfonos que no normalizan, campos desconocidos y campos que no aplican.
    v_log := v_log || case when pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('12345'), 'publico') like '%telefono_invalido%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('+1 305 555 0101'), 'publico') like '%telefono_invalido%'
                              and pg_temp.reg(gen_random_uuid(), '{"tipo":"baja","fuente":"formulario_web","telefono":3519990004}', 'publico') like '%telefono_invalido%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('3519990004') || '{"extra": 1}', 'publico') like '%campo_desconocido:extra%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('3519990004') || '{"nombre": "Ana"}', 'publico') like '%campo_no_aplica:nombre%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990004', 'zz-uno', v_h2, '{"ocurrido_en": "2026-09-15T00:00:00Z"}'), 'publico') like '%campo_no_aplica:ocurrido_en%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990004', 'zz-uno', v_h2, '{"evidencia": {"canal": "presencial"}}'), 'publico') like '%campo_desconocido:evidencia.canal%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990004', 'zz-uno', v_h2, '{"evidencia": {"ip_hash": "no-hex"}}'), 'publico') like '%campo_invalido:evidencia.ip_hash%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990004', 'zz-uno', null), 'publico') like '%campo_invalido:texto_huella%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990004', 'zz-uno', v_h2, jsonb_build_object('nombre', repeat('n', 81))), 'publico') like '%campo_invalido:nombre%'
                              and pg_temp.estado('3519990004') = 'sin_registro'
                           then 'C9 ' else 'FALLA:C9 ' end;

    -- C10 · quién puede qué: público solo formulario; staff solo bajas; nadie más.
    v_log := v_log || case when pg_temp.reg(gen_random_uuid(), '{"tipo":"alta","fuente":"admin_evidencia","telefono":"3519990005","texto_version":"zz-uno"}', 'publico') like '42501:fuente_no_permitida%'
                              and pg_temp.reg(gen_random_uuid(), '{"tipo":"alta","fuente":"admin_evidencia","telefono":"3519990005","texto_version":"zz-uno"}', 'staff') like '42501:fuente_no_permitida%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990005', 'zz-uno', v_h2), 'admin') like '42501:fuente_no_permitida%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('3519990005'), 'otro') like '42501:actor_invalido%'
                              and pg_temp.reg(gen_random_uuid(), '{"tipo":"baja","fuente":"admin_pedido","telefono":"3519990005","evidencia":{"canal":"presencial"}}', 'staff') = 'ok|baja|false|3519990005'
                           then 'C10 ' else 'FALLA:C10 ' end;

    -- C11 · baja después de un alta → baja; un alta posterior del propio titular → alta otra vez.
    -- (Cada escritura en su propia sentencia: una subconsulta no ve lo que escribió
    -- una función llamada en la misma sentencia.)
    v_r := pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('3519990001'), 'publico');
    v_r2 := pg_temp.estado('3519990001');
    v_h1 := pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990001', 'zz-uno', v_h2), 'publico');
    v_log := v_log || case when v_r = 'ok|baja|false|3519990001' and v_r2 = 'baja' and v_h1 = 'ok|alta|false|3519990001'
                              and (select bajas = 1 and eventos = 3 from public.mkt_consentimiento_estado where telefono = '3519990001')
                           then 'C11 ' else 'FALLA:C11 ' end;

    -- C12 · un alta del panel exige evidencia y un texto publicado, y no revierte una baja.
    v_j := jsonb_build_object('tipo', 'alta', 'fuente', 'admin_evidencia', 'telefono', '3519990006', 'texto_version', 'zz-uno',
                              'evidencia', jsonb_build_object('tipo', 'papel_firmado', 'referencia', 'Planilla stand 18/10'),
                              'ocurrido_en', to_char((clock_timestamp() - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    v_r := case when pg_temp.reg(gen_random_uuid(), v_j - 'evidencia', 'admin') like '%campo_invalido:evidencia.tipo%'
                     and pg_temp.reg(gen_random_uuid(), v_j || '{"evidencia": {"tipo": "papel_firmado"}}', 'admin') like '%campo_invalido:evidencia.referencia%'
                     and pg_temp.reg(gen_random_uuid(), v_j || '{"texto_version": "promos-v1"}', 'admin') like '%texto_no_publicado%'
                     and pg_temp.reg(gen_random_uuid(), v_j || '{"ocurrido_en": "2099-01-01T00:00:00Z"}', 'admin') like '%campo_invalido:ocurrido_en%'
                     and pg_temp.reg(gen_random_uuid(), v_j || '{"ocurrido_en": "2020-01-01T00:00:00Z"}', 'admin') like '%campo_invalido:ocurrido_en%'
                     and pg_temp.reg(gen_random_uuid(), v_j || '{"telefono": "3519990005"}', 'admin') like '55000:baja_vigente%'
                     and pg_temp.reg(gen_random_uuid(), v_j || '{"telefono": "3519990009"}', 'admin') like '55000:baja_vigente%'
                then 'rechazos_ok' else 'rechazos_mal' end;
    v_r2 := pg_temp.reg(gen_random_uuid(), v_j, 'admin');
    v_log := v_log || case when v_r = 'rechazos_ok' and v_r2 = 'ok|alta|false|3519990006'
                              and pg_temp.estado('3519990005') = 'baja'
                              and (select count(*) from public.mkt_consentimiento_eventos where telefono in ('3519990005', '3519990009') and tipo = 'alta') = 0
                              and (select texto_huella from public.mkt_consentimiento_eventos where telefono = '3519990006') = v_h2
                           then 'C12 ' else 'FALLA:C12 ' end;

    -- C13 · el orden es el de la fecha de origen. Frente a un alta del propio titular, una baja
    --       pedida ANTES no la tapa y una con la MISMA fecha gana (empate → baja). Un alta
    --       cargada desde el panel, en cambio, no sobrevive a ninguna baja.
    select alta_en into v_t from public.mkt_consentimiento_estado where telefono = '3519990001';
    v_r := pg_temp.reg(gen_random_uuid(), jsonb_build_object('tipo', 'baja', 'fuente', 'admin_pedido', 'telefono', '3519990001',
                         'evidencia', jsonb_build_object('canal', 'whatsapp'),
                         'ocurrido_en', to_char((v_t - interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'admin');
    v_r2 := pg_temp.reg(gen_random_uuid(), jsonb_build_object('tipo', 'baja', 'fuente', 'admin_pedido', 'telefono', '3519990006',
                         'evidencia', jsonb_build_object('canal', 'telefono'),
                         'ocurrido_en', to_char((clock_timestamp() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'staff');
    v_log := v_log || case when v_r = 'ok|alta|false|3519990001' and v_r2 = 'ok|baja|false|3519990006'
                              and pg_temp.reg(gen_random_uuid(), jsonb_build_object('tipo', 'baja', 'fuente', 'admin_pedido', 'telefono', '3519990001',
                                    'evidencia', jsonb_build_object('canal', 'presencial', 'nota', 'pidió no recibir'),
                                    'ocurrido_en', to_char(v_t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'staff') = 'ok|baja|false|3519990001'
                           then 'C13 ' else 'FALLA:C13 ' end;

    -- C14 · cambiar el texto vigente: un reintento idéntico devuelve el original; un alta nueva con el texto viejo, no.
    insert into public.mkt_textos_consentimiento (version, titulo, texto, huella)
    values ('zz-dos', 'Prueba dos', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp. Versión dos.', '');
    v_j := public.mkt_texto_publicar('zz-dos', 'admin');
    v_log := v_log || case when v_j ->> 'retirado' = 'zz-uno'
                              and (select estado from public.mkt_textos_consentimiento where version = 'zz-uno') = 'retirado'
                              and pg_temp.reg(v_k, pg_temp.web_alta('3519990001', 'zz-uno', v_h2,
                                    '{"nombre": "Ana Prueba", "localidad": "Córdoba", "evidencia": {"pagina": "/promos", "ip_hash": "0123456789abcdef"}}'), 'publico') like 'ok|%|true|3519990001'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990007', 'zz-uno', v_h2), 'publico') like '%texto_desactualizado%'
                              and pg_temp.reg(gen_random_uuid(), '{"tipo":"alta","fuente":"admin_evidencia","telefono":"3519990007","texto_version":"zz-uno","evidencia":{"tipo":"mensaje_del_titular","referencia":"WhatsApp 17/10"}}', 'admin') = 'ok|alta|false|3519990007'
                           then 'C14 ' else 'FALLA:C14 ' end;

    -- C15 · retirar cierra las altas públicas al instante; las bajas siguen.
    v_j := public.mkt_texto_retirar('zz-dos', 'admin');
    v_log := v_log || case when v_j ->> 'estado' = 'retirado'
                              and (public.mkt_texto_retirar('zz-dos', 'admin') ->> 'sin_cambios')::boolean
                              and pg_temp.intentar($q$select public.mkt_texto_publicar('zz-dos', 'admin')$q$) like '%texto_no_borrador%'
                              and pg_temp.intentar($q$select public.mkt_texto_retirar('promos-v1', 'admin')$q$) like '%texto_no_vigente%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_alta('3519990008', 'zz-dos',
                                    (select huella from public.mkt_textos_consentimiento where version = 'zz-dos')), 'publico') like '%consentimiento_no_habilitado%'
                              and pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('3519990008'), 'publico') = 'ok|baja|false|3519990008'
                           then 'C15 ' else 'FALLA:C15 ' end;

    -- C16 · el historial no se modifica ni se borra por ningún camino, tampoco el dueño.
    v_log := v_log || case when pg_temp.intentar($q$update public.mkt_consentimiento_eventos set tipo = 'alta' where telefono = '3519990009'$q$) like '%evento_inmutable%'
                              and pg_temp.intentar($q$delete from public.mkt_consentimiento_eventos where telefono = '3519990009'$q$) like '%evento_inmutable%'
                              and pg_temp.intentar($q$truncate public.mkt_consentimiento_eventos$q$) like '%evento_inmutable%'
                           then 'C16 ' else 'FALLA:C16 ' end;

    -- C17 · la base rechaza combinaciones imposibles aunque se escriba sin la RPC.
    v_log := v_log || case when pg_temp.intentar($q$insert into public.mkt_consentimiento_eventos (idempotency_key, huella, telefono, tipo, fuente, actor_rol, ocurrido_en)
                                                    values (gen_random_uuid(), 'x', '3519990010', 'alta', 'admin_pedido', 'staff', now())$q$) like '23514:%'
                              and pg_temp.intentar($q$insert into public.mkt_consentimiento_eventos (idempotency_key, huella, telefono, tipo, fuente, actor_rol, ocurrido_en)
                                                    values (gen_random_uuid(), 'x', '0351999001', 'baja', 'formulario_web', 'publico', now())$q$) like '23514:%'
                              and pg_temp.intentar($q$insert into public.mkt_consentimiento_eventos (idempotency_key, huella, telefono, tipo, fuente, actor_rol, ocurrido_en, nombre)
                                                    values (gen_random_uuid(), 'x', '3519990010', 'baja', 'formulario_web', 'publico', now(), 'Ana')$q$) like '23514:%'
                           then 'C17 ' else 'FALLA:C17 ' end;

    -- C18 · permisos: service_role solo lee y llama a las RPCs; anon y authenticated, nada.
    execute 'set local role service_role';
    v_r := pg_temp.intentar($q$insert into public.mkt_consentimiento_eventos (idempotency_key, huella, telefono, tipo, fuente, actor_rol, ocurrido_en)
                              values (gen_random_uuid(), 'x', '3519990011', 'baja', 'formulario_web', 'publico', now())$q$);
    v_r2 := pg_temp.intentar($q$update public.mkt_textos_consentimiento set titulo = 'x' where version = 'promos-v1'$q$);
    select count(*) into v_n from public.mkt_consentimiento_estado;
    v_h1 := pg_temp.reg(gen_random_uuid(), pg_temp.web_baja('3519990011'), 'publico');
    execute 'reset role';
    v_log := v_log || case when v_r like '42501:%' and v_r2 like '42501:%' and v_n > 0 and v_h1 = 'ok|baja|false|3519990011'
                           then 'C18a ' else 'FALLA:C18a ' end;
    execute 'set local role anon';
    v_r := pg_temp.intentar($q$select count(*) from public.mkt_consentimiento_estado$q$);
    v_r2 := pg_temp.intentar($q$select public.mkt_consentimiento_registrar(gen_random_uuid(), '{"tipo":"baja","fuente":"formulario_web","telefono":"3519990012"}', 'publico')$q$);
    execute 'reset role';
    execute 'set local role authenticated';
    v_h1 := pg_temp.intentar($q$select count(*) from public.mkt_textos_consentimiento$q$);
    v_h2 := pg_temp.intentar($q$select public.mkt_texto_publicar('promos-v1', 'admin')$q$);
    execute 'reset role';
    v_log := v_log || case when v_r like '42501:%' and v_r2 like '42501:%' and v_h1 like '42501:%' and v_h2 like '42501:%'
                              and pg_temp.estado('3519990012') = 'sin_registro'
                           then 'C18b ' else 'FALLA:C18b ' end;

    -- C19 · el resumen cuadra con la vista y no trae teléfonos.
    v_j := public.mkt_consentimiento_resumen(now() - interval '1 day');
    v_log := v_log || case when (v_j ->> 'telefonos')::integer = (select count(*) from public.mkt_consentimiento_estado)
                              and (v_j ->> 'altas_vigentes')::integer + (v_j ->> 'bajas_vigentes')::integer = (v_j ->> 'telefonos')::integer
                              and coalesce((v_j -> 'altas_por_fuente' ->> 'admin_evidencia')::integer, 0) = (select count(*) from public.mkt_consentimiento_estado where estado = 'alta' and alta_fuente = 'admin_evidencia')
                              and coalesce((v_j -> 'altas_por_fuente' ->> 'formulario_web')::integer, 0) = (select count(*) from public.mkt_consentimiento_estado where estado = 'alta' and alta_fuente = 'formulario_web')
                              and (v_j ->> 'altas_desde')::integer = (select count(*) from public.mkt_consentimiento_eventos where tipo = 'alta' and registrado_en >= now() - interval '1 day')
                              and (v_j ->> 'bajas_desde')::integer = (select count(*) from public.mkt_consentimiento_eventos where tipo = 'baja' and registrado_en >= now() - interval '1 day')
                              and v_j::text !~ '35199900'
                           then 'C19 ' else 'FALLA:C19 ' end;

    raise exception 'MKT-CONSENTIMIENTO|%', v_log;
  exception when others then
    v_resultado := case when sqlerrm like 'MKT-CONSENTIMIENTO|%' then sqlerrm
                        else 'MKT-CONSENTIMIENTO|' || v_log || 'ABORTO:' || sqlstate || ':' || sqlerrm end;
  end;
  raise exception 'RESULTADO %', v_resultado;
end $mkc$;

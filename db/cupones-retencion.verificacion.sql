-- ============================================================================
-- Verificación de cupones · retención compartida Reservas / Gift Cards, SIN HUELLA.
-- ----------------------------------------------------------------------------
-- Todo corre dentro de un sub-bloque que termina en RAISE: se deshace entero.
-- Códigos sintéticos ZZRET-*. Resultado en el mensaje final:
-- "RESULTADO CUPONES-RETENCION|R1 R2 ..."; "FALLA:" marca lo que no se cumplió
-- y "ABORTO:" un error inesperado. Es secuencial: la concurrencia real se prueba
-- por las rutas (lib/cuponesRetencion.integration.ts).
--
-- Solo para el stack LOCAL: node scripts/pruebas/cupones-retencion.mjs
-- ============================================================================
do $cret$
declare
  v_log       text := '';
  v_resultado text;
  v_j         jsonb;
  v_j2        jsonb;
  v_a         uuid;
  v_b         uuid;
  v_x         uuid;
  v_ia        uuid := gen_random_uuid();
  v_ib        uuid := gen_random_uuid();
  v_r         text;
  v_r2        text;
  v_n         integer;
  v_t1        uuid := gen_random_uuid();
  v_t2        uuid := gen_random_uuid();
  v_res       bigint;
  v_res2      bigint;
  v_res3      bigint;
  v_g         uuid := gen_random_uuid();
  v_g2        uuid := gen_random_uuid();
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

    create function pg_temp.retener(p_intento uuid, p_codigo text, p_producto text, p_huella text) returns jsonb language plpgsql as $f$
    begin
      return public.codigo_retener(p_intento, p_codigo, p_producto, p_huella);
    exception when others then
      return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
    end $f$;

    create function pg_temp.vincular(p_id uuid, p_datos jsonb) returns text language plpgsql as $f$
    begin
      perform public.codigo_retencion_vincular(p_id, p_datos);
      return 'ok';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.liberar(p_id uuid, p_motivo text) returns text language plpgsql as $f$
    begin
      return public.codigo_retencion_liberar(p_id, p_motivo) ->> 'resultado';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.consumir(p_id uuid, p_pago text) returns text language plpgsql as $f$
    begin
      return public.codigo_retencion_consumir(p_id, p_pago, '{}'::jsonb) ->> 'resultado';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end $f$;

    create function pg_temp.usos(p_codigo text) returns text language sql as $f$
      select usos_actuales || '|' || activo from public.codigos_descuento where codigo = p_codigo;
    $f$;

    insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, creado_para, fecha_fin)
    values ('ZZRET-UNO', 'verificación', 'porcentaje', 15, 1, 0, true, 'zz', null),
           ('ZZRET-DOS', 'verificación', 'porcentaje', 15, 2, 0, true, 'zz', null),
           ('ZZRET-LIBRE', 'verificación', 'porcentaje', 15, null, 0, true, 'zz', null),
           ('ZZRET-VENCIDO', 'verificación', 'porcentaje', 15, 1, 0, true, 'zz', (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1),
           ('ZZRET-BORRADO', 'verificación', 'porcentaje', 15, 1, 0, true, 'zz', null);
    update public.codigos_descuento set deleted_at = now() where codigo = 'ZZRET-BORRADO';

    -- R1 · la primera retención entra, con gracia de 2 minutos y sin oportunidad de pago.
    v_j := pg_temp.retener(v_ia, ' zzret-uno ', 'gift_card', 'h-a');
    v_a := (v_j -> 'retencion' ->> 'id')::uuid;
    v_log := v_log || case when (v_j ->> 'ok')::boolean and not (v_j ->> 'reutilizada')::boolean
                              and v_j -> 'retencion' ->> 'estado' = 'retenido' and v_j -> 'retencion' ->> 'codigo' = 'ZZRET-UNO'
                              and (v_j -> 'retencion' ->> 'vence_en')::timestamptz > clock_timestamp() + interval '1 minute'
                              and not (v_j -> 'retencion' ->> 'con_pago')::boolean
                              and v_j -> 'codigo' ->> 'tipo_descuento' = 'porcentaje'
                           then 'R1 ' else 'FALLA:R1 ' end;

    -- R2 · el mismo intento devuelve la misma retención; con otro pedido, conflicto.
    v_j2 := pg_temp.retener(v_ia, 'ZZRET-UNO', 'gift_card', 'h-a');
    v_r := pg_temp.retener(v_ia, 'ZZRET-UNO', 'gift_card', 'h-otro') ->> 'error';
    v_r2 := pg_temp.retener(v_ia, 'ZZRET-UNO', 'reserva', 'h-a') ->> 'error';
    v_log := v_log || case when (v_j2 ->> 'reutilizada')::boolean and (v_j2 -> 'retencion' ->> 'id')::uuid = v_a
                              and v_r like '23505:intento_con_otro_pedido%' and v_r2 like '23505:intento_con_otro_pedido%'
                              and (select count(*) from public.codigo_retenciones where intento = v_ia) = 1
                           then 'R2 ' else 'FALLA:R2 ' end;

    -- R3 · otro intento no entra mientras dura la retención; tampoco el consumo de siempre.
    v_j := pg_temp.retener(v_ib, 'ZZRET-UNO', 'reserva', 'h-b');
    v_log := v_log || case when not (v_j ->> 'ok')::boolean and v_j ->> 'motivo' = 'en_uso' and v_j -> 'vencidas' = '[]'::jsonb
                              and public.consumir_codigo_descuento('ZZRET-UNO') = false
                              and pg_temp.usos('ZZRET-UNO') = '0|true'
                           then 'R3 ' else 'FALLA:R3 ' end;

    -- R4 · vincular: la oportunidad de pago se marca con su vencimiento y lo fija.
    v_r := pg_temp.vincular(v_a, jsonb_build_object('con_pago', true, 'expira', clock_timestamp() + interval '30 minutes'));
    v_r2 := pg_temp.vincular(v_a, jsonb_build_object('reserva_id', 1));
    perform public.codigo_retencion_vincular(v_a, jsonb_build_object('grupo_compra_id', '00000000-0000-4000-8000-000000000001',
             'external_reference', 'gift_card_00000000-0000-4000-8000-000000000001', 'total_original', 20000, 'descuento', 3000, 'total_final', 17000));
    perform public.codigo_retencion_vincular(v_a, jsonb_build_object('con_pago', true, 'expira', clock_timestamp() + interval '30 minutes'));
    v_log := v_log || case when v_r like '22023:falta_external_reference%' and v_r2 like '22023:campo_no_aplica:reserva_id%'
                              and (select con_pago and vence_en > clock_timestamp() + interval '34 minutes' from public.codigo_retenciones where id = v_a)
                              and pg_temp.vincular(v_a, jsonb_build_object('descuento', 2999)) like '55000:retencion_ya_vinculada%'
                              and pg_temp.vincular(v_a, jsonb_build_object('grupo_compra_id', '00000000-0000-4000-8000-000000000002')) like '55000:retencion_ya_vinculada%'
                              and pg_temp.vincular(v_a, jsonb_build_object('estado', 'liberado')) like '22023:campo_desconocido:estado%'
                           then 'R4a ' else 'FALLA:R4a ' end;
    -- Guardar el link exige el turno de preparación (y lo devuelve).
    v_r := pg_temp.vincular(v_a, jsonb_build_object('preferencia_id', 'pref-1', 'init_point', 'https://mp.invalid/1'));
    v_r2 := pg_temp.vincular(v_a, jsonb_build_object('preparar', jsonb_build_object('token', v_t1, 'segundos', 30)));
    v_j := to_jsonb(pg_temp.vincular(v_a, jsonb_build_object('preferencia_id', 'pref-1', 'init_point', 'https://mp.invalid/1', 'preparacion', v_t1)));
    v_log := v_log || case when v_r like '55000:preparacion_perdida%' and v_r2 = 'ok' and v_j = '"ok"'::jsonb
                              and (select preferencia_id || '|' || coalesce(preparando_por::text, 'libre') from public.codigo_retenciones where id = v_a) = 'pref-1|libre'
                           then 'R4b ' else 'FALLA:R4b ' end;

    -- R5 · con oportunidad de pago no se libera antes de vence_en, por ningún motivo.
    v_log := v_log || case when pg_temp.liberar(v_a, 'sin_oportunidad_de_pago') like '55000:retencion_con_pago%'
                              and pg_temp.liberar(v_a, 'sin_pago_tras_vencer') like '55000:retencion_vigente%'
                              and pg_temp.liberar(v_a, 'porque_si') like '22023:motivo_invalido%'
                              and (select estado from public.codigo_retenciones where id = v_a) = 'retenido'
                           then 'R5 ' else 'FALLA:R5 ' end;

    -- R6 · vencida: otro intento la recibe para verificarla; liberada, entra el otro.
    update public.codigo_retenciones set vence_en = clock_timestamp() - interval '1 second' where id = v_a;
    v_j := pg_temp.retener(v_ib, 'ZZRET-UNO', 'reserva', 'h-b');
    v_r := pg_temp.liberar(v_a, 'sin_pago_tras_vencer');
    v_j2 := pg_temp.retener(v_ib, 'ZZRET-UNO', 'reserva', 'h-b');
    v_b := (v_j2 -> 'retencion' ->> 'id')::uuid;
    v_log := v_log || case when v_j ->> 'motivo' = 'en_uso' and v_j -> 'vencidas' = to_jsonb(array[v_a])
                              and v_r = 'liberada' and pg_temp.liberar(v_a, 'sin_pago_tras_vencer') = 'ya_liberada'
                              and (select motivo_liberacion from public.codigo_retenciones where id = v_a) = 'sin_pago_tras_vencer'
                              and (v_j2 ->> 'ok')::boolean and not (v_j2 ->> 'reutilizada')::boolean
                              and pg_temp.vincular(v_a, jsonb_build_object('descuento', 1)) like '55000:retencion_no_retenida%'
                           then 'R6 ' else 'FALLA:R6 ' end;

    -- R7 · consumir: suma un uso, apaga el código al llegar al límite, registra el uso; idempotente.
    v_r := pg_temp.consumir(v_b, 'PAGO-B');
    v_r2 := pg_temp.consumir(v_b, 'PAGO-B');
    v_log := v_log || case when v_r = 'consumida' and v_r2 = 'ya_consumida'
                              and pg_temp.usos('ZZRET-UNO') = '1|false'
                              and (select count(*) from public.usos_codigos_descuento where codigo = 'ZZRET-UNO' and mercado_pago_payment_id = 'PAGO-B') = 1
                              and (select estado || '|' || pago_id from public.codigo_retenciones where id = v_b) = 'consumido|PAGO-B'
                              and pg_temp.liberar(v_b, 'sin_pago_tras_vencer') = 'consumida'
                              and (select estado from public.codigo_retenciones where id = v_b) = 'consumido'
                           then 'R7 ' else 'FALLA:R7 ' end;

    -- R8 · pago aprobado de una retención liberada sin cupo: no supera el límite, queda anotado.
    v_r := pg_temp.consumir(v_a, 'PAGO-A');
    v_log := v_log || case when v_r = 'sin_cupo' and pg_temp.usos('ZZRET-UNO') = '1|false'
                              and (select estado || '|' || nota || '|' || pago_id from public.codigo_retenciones where id = v_a) = 'liberado|aprobado_sin_cupo|PAGO-A'
                              and (select motivo from (select (pg_temp.retener(gen_random_uuid(), 'ZZRET-UNO', 'reserva', 'h-c') ->> 'motivo') as motivo) s) = 'agotado'
                           then 'R8 ' else 'FALLA:R8 ' end;

    -- R9 · con cupo, una liberada que igual se paga se consume (consumida_tras_liberar).
    v_j := pg_temp.retener(gen_random_uuid(), 'ZZRET-DOS', 'reserva', 'h-d');
    v_x := (v_j -> 'retencion' ->> 'id')::uuid;
    v_r := pg_temp.liberar(v_x, 'sin_oportunidad_de_pago');
    v_r2 := pg_temp.consumir(v_x, 'PAGO-X');
    v_log := v_log || case when v_r = 'liberada' and v_r2 = 'consumida_tras_liberar' and pg_temp.usos('ZZRET-DOS') = '1|true'
                              and (select estado || '|' || nota from public.codigo_retenciones where id = v_x) = 'consumido|consumida_tras_liberar'
                           then 'R9 ' else 'FALLA:R9 ' end;

    -- R10 · límite 2: dos retenciones entran, la tercera no; el consumo de siempre tampoco.
    v_j := pg_temp.retener(gen_random_uuid(), 'ZZRET-DOS', 'gift_card', 'h-e');
    v_j2 := pg_temp.retener(gen_random_uuid(), 'ZZRET-DOS', 'gift_card', 'h-f');
    v_log := v_log || case when (v_j ->> 'ok')::boolean and v_j2 ->> 'motivo' = 'en_uso'
                              and public.consumir_codigo_descuento('ZZRET-DOS') = false
                           then 'R10 ' else 'FALLA:R10 ' end;

    -- R11 · códigos sin límite, vencidos o eliminados no se retienen.
    v_log := v_log || case when pg_temp.retener(gen_random_uuid(), 'ZZRET-LIBRE', 'reserva', 'h') ->> 'motivo' = 'sin_limite'
                              and pg_temp.retener(gen_random_uuid(), 'ZZRET-VENCIDO', 'reserva', 'h') ->> 'motivo' = 'vencido'
                              and pg_temp.retener(gen_random_uuid(), 'ZZRET-BORRADO', 'reserva', 'h') ->> 'motivo' = 'inexistente'
                              and pg_temp.retener(gen_random_uuid(), 'ZZRET-NADA', 'reserva', 'h') ->> 'motivo' = 'inexistente'
                              and pg_temp.retener(gen_random_uuid(), 'ZZRET-UNO', 'otro', 'h') ->> 'error' like '22023:datos_invalidos%'
                              and public.consumir_codigo_descuento('ZZRET-LIBRE') = true
                              and pg_temp.usos('ZZRET-LIBRE') = '1|true'
                           then 'R11 ' else 'FALLA:R11 ' end;

    -- R12 · la tabla es coherente: no se puede dejar una liberada sin motivo ni dos retenciones por compra.
    v_log := v_log || case when pg_temp.intentar(format($q$update public.codigo_retenciones set estado = 'liberado', liberado_en = now() where id = %L$q$,
                                                         (v_j -> 'retencion' ->> 'id'))) like '23514:%'
                              and pg_temp.intentar(format($q$insert into public.codigo_retenciones (intento, huella, codigo_id, codigo, producto, grupo_compra_id)
                                                             select gen_random_uuid(), 'h', id, codigo, 'gift_card', '00000000-0000-4000-8000-000000000001'
                                                               from public.codigos_descuento where codigo = 'ZZRET-DOS'$q$)) like '23505:%'
                           then 'R12 ' else 'FALLA:R12 ' end;

    -- R14 · turno de preparación: uno a la vez; guardar el link exige el turno; soltar lo devuelve.
    insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, creado_para)
    values ('ZZRET-TURNO', 'verificación', 'porcentaje', 10, 1, 0, true, 'zz');
    v_x := (pg_temp.retener(gen_random_uuid(), 'ZZRET-TURNO', 'gift_card', 'h-t') -> 'retencion' ->> 'id')::uuid;
    perform public.codigo_retencion_vincular(v_x, jsonb_build_object('grupo_compra_id', v_g, 'external_reference', 'gift_card_' || v_g,
             'con_pago', true, 'expira', clock_timestamp() + interval '30 minutes', 'preparar', jsonb_build_object('token', v_t1, 'segundos', 60)));
    v_r := pg_temp.vincular(v_x, jsonb_build_object('preparar', jsonb_build_object('token', v_t2, 'segundos', 60)));
    v_r2 := pg_temp.vincular(v_x, jsonb_build_object('preferencia_id', 'pref-t2', 'init_point', 'https://mp.invalid/t2', 'preparacion', v_t2));
    update public.codigo_retenciones set vence_en = clock_timestamp() - interval '1 second' where id = v_x;
    v_log := v_log || case when v_r like '55000:preparacion_en_curso%' and v_r2 like '55000:preparacion_perdida%'
                              and pg_temp.liberar(v_x, 'sin_pago_tras_vencer') like '55000:retencion_vigente%'
                              and pg_temp.vincular(v_x, jsonb_build_object('soltar', v_t2)) = 'ok'
                              and (select preparando_por from public.codigo_retenciones where id = v_x) = v_t1
                              and pg_temp.vincular(v_x, jsonb_build_object('soltar', v_t1)) = 'ok'
                              and pg_temp.vincular(v_x, jsonb_build_object('preparar', jsonb_build_object('token', v_t2, 'segundos', 60))) = 'ok'
                              and pg_temp.vincular(v_x, jsonb_build_object('preparar', jsonb_build_object('token', v_t2, 'segundos', 999))) like '22023:campo_invalido:preparar%'
                              and pg_temp.vincular(v_x, jsonb_build_object('soltar', v_t2)) = 'ok'
                              and pg_temp.liberar(v_x, 'sin_pago_tras_vencer') = 'liberada'
                           then 'R14 ' else 'FALLA:R14 ' end;

    -- R15 · compras anteriores sin retención: se cubren (una vez) al retener ese código.
    insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, creado_para)
    values ('ZZRET-LEGADO', 'verificación', 'porcentaje', 10, 1, 0, true, 'zz'),
           ('ZZRET-LEGADO-GC', 'verificación', 'porcentaje', 10, 1, 0, true, 'zz');
    insert into public.reservas (nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, total_original, descuento_aplicado, estado, codigo_descuento, created_at)
    values ('zz verificación', '3519990000', '2026-12-01', '10:00', '[]'::jsonb, 1, 9000, 10000, 1000, 'pendiente_pago', 'zzret-legado', now() - interval '1 hour')
    returning id into v_res;
    insert into public.reservas (nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, total_original, descuento_aplicado, estado, codigo_descuento)
    values ('zz verificación', '3519990000', '2026-12-01', '11:00', '[]'::jsonb, 1, 9000, 10000, 1000, 'pendiente_pago', 'ZZRET-LEGADO')
    returning id into v_res2;
    insert into public.reservas (nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, total_original, descuento_aplicado, estado, codigo_descuento, mercado_pago_payment_id, created_at)
    values ('zz verificación', '3519990000', '2026-12-01', '12:00', '[]'::jsonb, 1, 9000, 10000, 1000, 'activa', 'ZZRET-LEGADO', 'PAGO-VIEJO', now() - interval '1 hour')
    returning id into v_res3;
    insert into public.gift_cards (codigo_unico, comprador_nombre, comprador_telefono, duracion_minutos, monto, monto_original, descuento_aplicado,
                                   estado_pago, codigo_descuento, grupo_compra_id, mercado_pago_preference_id, created_at)
    values ('ZZRET-GC-1', 'zz verificación', '3519990000', 20, 9000, 10000, 1000, 'rechazado', 'ZZRET-LEGADO-GC', v_g2, 'pref-vieja', now() - interval '1 hour'),
           ('ZZRET-GC-2', 'zz verificación', '3519990000', 20, 9000, 10000, 1000, 'rechazado', 'ZZRET-LEGADO-GC', v_g2, 'pref-vieja', now() - interval '1 hour');
    v_j := pg_temp.retener(gen_random_uuid(), 'ZZRET-LEGADO', 'reserva', 'h-l');
    v_j2 := pg_temp.retener(gen_random_uuid(), 'ZZRET-LEGADO-GC', 'gift_card', 'h-l');
    v_log := v_log || case when v_j ->> 'motivo' = 'en_uso' and jsonb_array_length(v_j -> 'vencidas') = 1
                              and (select nota || '|' || con_pago || '|' || external_reference from public.codigo_retenciones where reserva_id = v_res) = 'legado|true|reserva_' || v_res
                              and not exists (select 1 from public.codigo_retenciones where reserva_id in (v_res2, v_res3))
                              and v_j2 ->> 'motivo' = 'en_uso'
                              and (select count(*) || '|' || max(preferencia_id) || '|' || max(total_final) from public.codigo_retenciones where grupo_compra_id = v_g2 and nota = 'legado') = '1|pref-vieja|18000'
                              and public.codigo_retenciones_cubrir_legado((select id from public.codigos_descuento where codigo = 'ZZRET-LEGADO'), interval '0') = 1
                              and public.codigo_retenciones_cubrir_legado((select id from public.codigos_descuento where codigo = 'ZZRET-LEGADO'), interval '0') = 0
                           then 'R15 ' else 'FALLA:R15 ' end;

    -- R16 · el uso que ya contó el camino anterior (mismo pago o misma reserva) no se suma dos veces.
    insert into public.codigos_descuento (codigo, descripcion, tipo_descuento, valor_descuento, usos_maximos, usos_actuales, activo, creado_para)
    values ('ZZRET-DOBLE', 'verificación', 'porcentaje', 10, 2, 1, true, 'zz');
    v_x := (pg_temp.retener(gen_random_uuid(), 'ZZRET-DOBLE', 'gift_card', 'h-d') -> 'retencion' ->> 'id')::uuid;
    insert into public.usos_codigos_descuento (codigo_id, codigo, mercado_pago_payment_id)
    select id, codigo, 'PAGO-YA-CONTADO' from public.codigos_descuento where codigo = 'ZZRET-DOBLE';
    v_r := pg_temp.consumir(v_x, 'PAGO-YA-CONTADO');
    v_log := v_log || case when v_r = 'ya_contado' and pg_temp.usos('ZZRET-DOBLE') = '1|true'
                              and (select estado || '|' || nota || '|' || pago_id from public.codigo_retenciones where id = v_x) = 'consumido|ya_contado|PAGO-YA-CONTADO'
                              and (select count(*) from public.usos_codigos_descuento where codigo = 'ZZRET-DOBLE') = 1
                              and pg_temp.consumir(v_x, 'PAGO-YA-CONTADO') = 'ya_consumida'
                           then 'R16 ' else 'FALLA:R16 ' end;

    -- R17 · registro de revisión: suma y anota, sin cambiar el estado.
    perform public.codigo_retencion_anotar_revision(v_x, 'retenida', 'pago_abierto');
    perform public.codigo_retencion_anotar_revision(v_x, 'retenida', 'mercado_pago_no_responde');
    v_log := v_log || case when (select revisiones || '|' || revision_resultado || '|' || revision_motivo || '|' || estado || '|' || (revisada_en is not null)
                                   from public.codigo_retenciones where id = v_x) = '2|retenida|mercado_pago_no_responde|consumido|true'
                              and pg_temp.intentar(format($q$select public.codigo_retencion_anotar_revision(%L, 'inventado', 'x')$q$, v_x)) like '22023:resultado_invalido%'
                           then 'R17 ' else 'FALLA:R17 ' end;

    -- R13 · permisos: service_role solo lee la tabla; anon no ejecuta nada.
    execute 'set local role service_role';
    v_r := pg_temp.intentar($q$update public.codigo_retenciones set estado = 'consumido'$q$);
    v_r2 := pg_temp.intentar($q$select count(*) from public.codigo_retenciones$q$);
    execute 'reset role';
    execute 'set local role anon';
    v_n := 0;
    if pg_temp.intentar($q$select public.codigo_retener(gen_random_uuid(), 'ZZRET-DOS', 'reserva', 'h')$q$) like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar($q$select count(*) from public.codigo_retenciones$q$) like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar($q$select public.consumir_codigo_descuento('ZZRET-DOS')$q$) like '42501:%' then v_n := v_n + 1; end if;
    if pg_temp.intentar($q$select public.codigo_retencion_anotar_revision(gen_random_uuid(), 'retenida', 'x')$q$) like '42501:%' then v_n := v_n + 1; end if;
    execute 'reset role';
    execute 'set local role service_role';
    if pg_temp.intentar($q$select public.codigo_retenciones_cubrir_legado(1, interval '0')$q$) like '42501:%' then v_n := v_n + 1; end if;
    execute 'reset role';
    v_log := v_log || case when v_r like '42501:%' and v_r2 = 'ok' and v_n = 5 then 'R13 ' else 'FALLA:R13 ' end;

    raise exception 'CUPONES-RETENCION|%', v_log;
  exception when others then
    v_resultado := case when sqlerrm like 'CUPONES-RETENCION|%' then sqlerrm
                        else 'CUPONES-RETENCION|' || v_log || 'ABORTO:' || sqlstate || ':' || sqlerrm end;
  end;
  raise exception 'RESULTADO %', v_resultado;
end $cret$;

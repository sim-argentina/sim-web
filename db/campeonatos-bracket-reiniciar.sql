-- ============================================================================
-- Campeonatos · REINICIAR el estado deportivo de un bracket de eliminación
-- ----------------------------------------------------------------------------
-- Fuente de verdad. Aplicado a SIM WEB (bcmoewwhsyxsiyvroarj). ADITIVO.
-- No crea tablas ni columnas: solo una función. No modifica ningún dato existente
-- al aplicarse.
--
-- PARA QUÉ
--   "Reabrir clasificación" es —y sigue siendo— una operación segura: se niega si
--   alguna carrera ya arrancó, para no dejar el cuadro inconsistente. Pero el owner
--   necesita además poder volver un campeonato a CERO aunque haya carreras en
--   curso, finalizadas, clasificados o podio (típicamente para probar).
--
-- QUÉ BORRA
--   Absolutamente todo el estado DEPORTIVO, que cuelga de campeonato_bracket:
--     · campeonato_bracket_participantes       (seeds, mejor_ms, presencia, estado)
--     · campeonato_bracket_rondas              (rondas generadas)
--     · campeonato_bracket_carreras            (carreras, BYEs, estados, tiempos)
--     · campeonato_bracket_carrera_participantes (posiciones, DNF/DSQ, clasifica)
--     · campeonato_bracket                     (estado, cerrada/generado/finalizado, podio)
--   Las cuatro primeras tienen FK ... ON DELETE CASCADE contra campeonato_bracket,
--   así que borrar la fila raíz las arrastra en la MISMA sentencia: no hay orden
--   de borrado que pueda quedar a medias.
--
-- QUÉ NO TOCA
--   · campeonato_inscripciones  → pilotos, pagos, payment_id, estado_pago, montos,
--     eliminada_at, fechas. La FK inscripcion_id apunta DESDE el bracket HACIA la
--     inscripción: borrar participantes nunca borra inscriptos.
--   · campeonato_checkouts, cupos, precios, Mercado Pago, webhook.
--   · campeonato_registros / campeonato_penalizaciones → son el circuito de LIGA
--     (Fecha 0, ranking, puntos). La modalidad eliminación no escribe ahí: el mejor
--     tiempo de quali vive en campeonato_bracket_participantes.mejor_ms.
--
-- ESTADO RESULTANTE
--   Sin fila en campeonato_bracket. El read-model (lib/bracketServer.obtenerEstado)
--   es READ-ONLY y ya contempla ese caso: estado "clasificacion", sin rondas, sin
--   carreras, sin seeds ni tiempos, y los pilotos se muestran DERIVADOS de las
--   inscripciones pagadas. Es exactamente el estado de un campeonato que todavía no
--   se operó, sin necesidad de reconstruir filas.
-- ============================================================================

create or replace function public.campeonato_bracket_reiniciar(
  p_campeonato_id uuid
) returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $fn$
declare
  v_modalidad   text;
  v_br          public.campeonato_bracket%rowtype;
  v_participantes integer;
  v_rondas        integer;
  v_carreras      integer;
  v_carrera_part  integer;
begin
  -- 1) El campeonato tiene que existir y no estar archivado.
  select modalidad into v_modalidad
    from public.campeonatos
   where id = p_campeonato_id and deleted_at is null;
  if not found then
    return jsonb_build_object('resultado', 'campeonato_inexistente');
  end if;

  -- 2) Solo tiene sentido en eliminación: una liga no tiene bracket que reiniciar.
  if coalesce(v_modalidad, 'liga') <> 'eliminacion' then
    return jsonb_build_object('resultado', 'modalidad_invalida', 'modalidad', v_modalidad);
  end if;

  -- 3) Lock por campeonato, en un namespace propio para no pelear con el lock del
  --    checkout de inscripciones (que usa otra clave sobre el mismo campeonato).
  perform pg_advisory_xact_lock(hashtextextended('campeonato_bracket_reset:' || p_campeonato_id::text, 0));

  -- 4) Bracket actual. Si no hay, ya está en cero: idempotente, sin error.
  select * into v_br from public.campeonato_bracket
    where campeonato_id = p_campeonato_id
    for update;
  if not found then
    return jsonb_build_object(
      'resultado', 'ya_en_cero',
      'estado_previo', null,
      'participantes', 0, 'rondas', 0, 'carreras', 0, 'carrera_participantes', 0,
      'tenia_podio', false
    );
  end if;

  -- 5) Resumen ANTES de borrar (para la respuesta y la auditoría).
  select count(*) into v_participantes from public.campeonato_bracket_participantes where bracket_id = v_br.id;
  select count(*) into v_rondas        from public.campeonato_bracket_rondas        where bracket_id = v_br.id;
  select count(*) into v_carreras      from public.campeonato_bracket_carreras      where bracket_id = v_br.id;
  select count(*) into v_carrera_part  from public.campeonato_bracket_carrera_participantes where bracket_id = v_br.id;

  -- 6) Un solo DELETE: el cascade se lleva participantes, rondas, carreras y
  --    participantes de carrera. Todo o nada, dentro de esta transacción.
  delete from public.campeonato_bracket where id = v_br.id;

  return jsonb_build_object(
    'resultado', 'reiniciado',
    'estado_previo', v_br.estado,
    'participantes', v_participantes,
    'rondas', v_rondas,
    'carreras', v_carreras,
    'carrera_participantes', v_carrera_part,
    'tenia_podio', v_br.podio is not null
  );
end;
$fn$;

revoke all on function public.campeonato_bracket_reiniciar(uuid) from public, anon, authenticated;
grant execute on function public.campeonato_bracket_reiniciar(uuid) to service_role;

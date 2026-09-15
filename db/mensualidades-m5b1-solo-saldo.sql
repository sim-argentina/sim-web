-- ============================================================================
-- MENSUALIDADES SIM · BLOQUE M5B.1
-- Retirar las reservas mixtas y continuar solo con saldo.
-- ----------------------------------------------------------------------------
-- Migración HACIA ADELANTE e idempotente. NO edita ni "desaplica" la migración
-- histórica de M5B (20260907164850): esa quedó aplicada y así se queda.
--
-- POR QUÉ SE RETIRA M5B
-- El plan de Vercel es Hobby, y Hobby solo admite crons de UNA ejecución diaria.
-- El barrido de retenciones necesitaba `*/10 * * * *`, que Vercel rechaza en el
-- deployment. Sin barrido no hay forma segura de liberar una retención
-- abandonada, y sin liberación segura no puede existir la retención. La decisión
-- de producto es no contratar Pro por ahora, así que el flujo mixto se retira
-- entero en vez de degradarlo.
--
-- QUÉ SE HACE Y QUÉ NO
--   · SE RETIRAN las 4 funciones exclusivas de M5B. Ninguna tiene consumidores:
--     la aplicación nunca las llamó en producción (el código de M5B jamás llegó
--     a la rama que alimenta producción) y M5A no las usa.
--   · SE CONSERVAN la tabla mensualidad_reserva_pagos, las columnas nuevas de
--     `reservas` (cobertura, importe_complementario, …), sus constraints e
--     índices. No cuestan nada, mantienen el historial estructural y evitan un
--     rollback destructivo. Quedan SIN USO y SIN forma de escribirse: `reservas`
--     y `mensualidad_reserva_pagos` son service_role-only, no hay endpoint que
--     las toque y ya no existe ninguna RPC que pueda crear una fila mixta.
--   · NO se toca `crear_reserva_mensualidad` (M5A), que sigue siendo el ÚNICO
--     camino para crear una reserva de Mensualidad, y solo cuando el saldo
--     alcanza para la totalidad de los minutos.
--   · NO se toca el índice único de slots, el trigger de bloqueos, la compra y
--     renovación de M2/M3, las sesiones de M4 ni la disponibilidad de M6.
--   · NO se otorga ningún permiso nuevo. RLS sigue deny-by-default.
--
-- PRECONDICIÓN VERIFICADA ANTES DE APLICAR: 0 pagos complementarios,
-- 0 retenciones vivas, 0 reservas con cobertura 'mixta'. No hay nada operativo
-- que dependa de estas funciones.
-- ============================================================================

-- ── 1) Retirar las RPC exclusivas de M5B ────────────────────────────────────
-- Se listan con su firma completa para no borrar por accidente un homónimo.

-- Creaba la reserva pendiente + slots + retención de saldo + snapshot de precios.
drop function if exists public.crear_retencion_reserva_mensualidad(
  uuid, date, text, integer, text[], text[], text, text, numeric, numeric, text, text, text, integer);

-- Confirmaba la reserva cuando Mercado Pago aprobaba el complemento.
drop function if exists public.confirmar_reserva_mensualidad_pagada(
  text, text, numeric, numeric, numeric, timestamptz);

-- Liberaba la retención vencida (slots + devolución de minutos). Era lo que
-- disparaba el cron `*/10 * * * *` que Hobby no admite.
drop function if exists public.liberar_retencion_reserva_mensualidad(uuid);

-- Guard que impedía renovar mientras hubiera una retención viva. Sin retenciones
-- posibles, el invariante de carry-over vuelve a estar garantizado solo por M2.
drop function if exists public.mensualidad_tiene_retencion_viva(uuid);

-- ── 2) Reafirmar el cierre de la tabla que queda sin uso ────────────────────
-- Idempotente y sin conceder nada nuevo: deja constancia de que la tabla sigue
-- existiendo pero inalcanzable desde cualquier cliente.

alter table if exists public.mensualidad_reserva_pagos enable row level security;
revoke all on public.mensualidad_reserva_pagos from public, anon, authenticated;

comment on table public.mensualidad_reserva_pagos is
  'INACTIVA desde M5B.1. Guardaba el complemento en dinero de una reserva mixta. '
  'El flujo mixto se retiró porque el plan Hobby de Vercel no admite el cron de '
  'liberación (solo una ejecución diaria). La tabla se conserva vacía y sin uso '
  'para no hacer un rollback destructivo; no existe RPC ni endpoint que pueda '
  'escribirla. Las reservas de Mensualidad se crean solo con crear_reserva_mensualidad.';

comment on column public.reservas.cobertura is
  'saldo (M5A). El valor mixta existe en el CHECK por historial de M5B, pero desde '
  'M5B.1 ninguna RPC ni endpoint puede producirlo: una reserva de Mensualidad se '
  'confirma unicamente cuando el saldo cubre el total de los minutos.';

comment on column public.reservas.importe_complementario is
  'Siempre 0 desde M5B.1: no existe pago complementario. Se conserva por historial estructural.';

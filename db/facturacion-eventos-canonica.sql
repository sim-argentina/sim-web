-- ============================================================================
-- Fuente CANÓNICA de los eventos de facturación de SIM (IA SIM 5A.1)
-- ----------------------------------------------------------------------------
-- Problema que resuelve: la composición de "facturación" estaba enumerada DOS
-- veces — en fin_ingresos_por_mes (SQL) y a mano en lib/ia/analisis/
-- ejecutorAnalitico.ts (TypeScript). Divergieron: cuando Mensualidades entró a
-- Finanzas, la herramienta analítica siguió con cuatro fuentes y nunca vio ni
-- las mensualidades ni los ingresos manuales.
--
-- Acá queda la enumeración CANÓNICA, a nivel EVENTO (día). La herramienta
-- analítica interna no enumera nada: lee esta función.
--
-- fin_ingresos_por_mes NO se reescribe a propósito: la consumen Finanzas y las
-- pruebas de Gift Cards, Mensualidades, Reservas y Empresas, y emite una fila
-- en cero para meses sin reservas que esos consumidores ya descartan. Cambiarla
-- sería tocar cuatro módulos ajenos sin necesidad. La divergencia la impide una
-- PRUEBA CONTRACTUAL (lib/facturacionEventos.contrato.integration.ts): compara
-- mes a mes, fuente a fuente, método a método y cantidad a cantidad, y además
-- revisa por introspección que ninguna de las dos definiciones tenga una fuente
-- que la otra no conozca. Si alguien agrega una fuente a una sola, falla.
--
-- Reglas de fecha contable (las YA vigentes, no se inventa ninguna):
--   turnero         -> fecha de SERVICIO (turnos_stand.fecha)
--   reservas_online -> fecha de PAGO (created_at en Argentina)
--   gift_cards      -> fecha de PAGO (fecha_pago en Argentina)
--   campeonatos     -> fecha de PAGO (created_at en Argentina)
--   mensualidades   -> fecha de PAGO aprobado (cobrado_at, si no aprobado_at)
--   manuales        -> fecha contable del movimiento (fecha, acotada a su
--                      mes_contable: Finanzas imputa por mes_contable, así que
--                      el mes SIEMPRE coincide y dentro del mes se usa su día)
--
-- Clase: 'automatico' son las fuentes operativas que Finanzas ya llamaba
-- "ingresos automáticos"; 'manual' son los movimientos de ingreso operativo
-- cargados a mano. fin_ingresos_por_mes agrega SOLO las automáticas, porque
-- resumirMes() suma los manuales por su cuenta — mezclarlas duplicaría.
--
-- QUEDA AFUERA SIEMPRE: transferencias entre cuentas (tipo transferencia),
-- préstamos/financiamiento (clasificacion financiamiento), ajustes de saldo
-- (tipo ajuste y origen ajuste_inicial), egresos, el Colectivo (se administra
-- aparte y ninguna consulta financiera lo toca) y todo registro cancelado,
-- anulado o no pagado según la regla de su fuente.
--
-- Solo lectura, STABLE, sin SECURITY DEFINER (corre con los permisos de quien
-- llama). Idempotente: create or replace.
-- ============================================================================

create or replace function public.fin_eventos_facturacion(p_desde date, p_hasta date)
returns table (
  fuente         text,
  clase          text,
  fecha_contable date,
  metodo         text,
  monto          numeric,
  cantidad       numeric,
  evento_id      text
)
language sql
stable
as $fn$
  -- Turnero del stand: por fecha de SERVICIO, excluye cancelados.
  with ts as (
    select t.*
    from turnos_stand t
    where t.fecha between p_desde and p_hasta
      and (t.estado is null or t.estado <> 'cancelado')
  ),
  ts_eventos as (
    select
      t.id,
      t.fecha,
      t.cantidad_turnos,
      p.idx,
      case
        when jsonb_typeof(t.pagos_detalle) = 'array' and jsonb_array_length(t.pagos_detalle) > 0
          then coalesce(nullif(trim(p.value->>'metodo_pago'), ''), 'desconocido')
        else coalesce(nullif(trim(t.metodo_pago), ''), 'desconocido')
      end as metodo,
      case
        when jsonb_typeof(t.pagos_detalle) = 'array' and jsonb_array_length(t.pagos_detalle) > 0
          then coalesce((p.value->>'monto')::numeric, 0)
        else coalesce(t.total, 0)
      end as monto
    from ts t
    left join lateral (
      select e.value, (e.ordinality - 1) as idx
      from jsonb_array_elements(
        case when jsonb_typeof(t.pagos_detalle) = 'array' then t.pagos_detalle else '[]'::jsonb end
      ) with ordinality as e(value, ordinality)
    ) p on jsonb_typeof(t.pagos_detalle) = 'array' and jsonb_array_length(t.pagos_detalle) > 0
  )
  -- Los turnos del turno van en el PRIMER pago y 0 en el resto: así la suma de
  -- `cantidad` es exactamente sum(coalesce(cantidad_turnos,1)) del período, sin
  -- multiplicarse por la cantidad de pagos de un mismo turno.
  select 'turnero'::text, 'automatico'::text, e.fecha, e.metodo, e.monto,
         case when coalesce(e.idx, 0) = 0 then coalesce(e.cantidad_turnos, 1)::numeric else 0::numeric end,
         'turnero:' || e.id::text || ':' || coalesce(e.idx, 0)::text
  from ts_eventos e

  union all

  -- Reservas web pagadas: por fecha de PAGO.
  select 'reservas_online'::text, 'automatico'::text,
         (r.created_at at time zone 'America/Argentina/Buenos_Aires')::date,
         'mercadopago'::text, coalesce(r.total, 0), 1::numeric,
         'reservas_online:' || r.id::text
  from reservas r
  where (r.created_at at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
    and r.estado in ('activa', 'reembolsada')
    and (r.origen is null or r.origen not in ('empresa', 'mensualidad'))

  union all

  -- Gift cards pagadas: por fecha de PAGO (las emitidas por admin, con su medio).
  select 'gift_cards'::text, 'automatico'::text,
         (g.fecha_pago at time zone 'America/Argentina/Buenos_Aires')::date,
         case when g.canal = 'admin'
              then coalesce(nullif(trim(g.medio_pago), ''), 'desconocido')
              else 'mercadopago' end,
         coalesce(g.monto, 0), 1::numeric,
         'gift_cards:' || g.id::text
  from gift_cards g
  where g.estado_pago = 'pagado'
    and g.fecha_pago is not null
    and (g.fecha_pago at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta

  union all

  -- Inscripciones a campeonatos pagadas: por fecha de PAGO.
  select 'campeonatos'::text, 'automatico'::text,
         (ci.created_at at time zone 'America/Argentina/Buenos_Aires')::date,
         coalesce(nullif(trim(ci.metodo_pago), ''), 'mercadopago'),
         coalesce(ci.monto, 0), 1::numeric,
         'campeonatos:' || ci.id::text
  from campeonato_inscripciones ci
  where ci.estado_pago = 'pagado'
    and ci.eliminada_at is null
    and (ci.created_at at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta

  union all

  -- Mensualidades aplicadas: por fecha de PAGO aprobado.
  select 'mensualidades'::text, 'automatico'::text,
         (coalesce(c.cobrado_at, c.aprobado_at) at time zone 'America/Argentina/Buenos_Aires')::date,
         case when c.canal = 'web' then 'mercadopago'
              else coalesce(nullif(trim(c.medio_pago), ''), 'desconocido') end,
         coalesce(c.importe_bruto, 0), 1::numeric,
         'mensualidades:' || c.id::text
  from mensualidad_compras c
  where c.procesamiento = 'aplicado'
    and c.canal in ('web', 'admin_venta')
    and (coalesce(c.cobrado_at, c.aprobado_at) at time zone 'America/Argentina/Buenos_Aires')::date
        between p_desde and p_hasta

  union all

  -- Ingresos MANUALES operativos: por fecha contable del movimiento.
  -- Misma regla que resumirMes(): tipo ingreso, sin financiamiento (préstamos)
  -- y sin el ajuste inicial de saldo. Transferencias y ajustes no son tipo
  -- ingreso, así que no entran por definición.
  select 'manuales'::text, 'manual'::text, m.fecha_contable,
         'manual'::text, m.monto, 1::numeric,
         'manual:' || m.id::text
  from (
    select mv.id,
           coalesce(mv.monto, 0) as monto,
           least(
             greatest(mv.fecha, ((mv.mes_contable || '-01')::date)),
             (((mv.mes_contable || '-01')::date + interval '1 month') - interval '1 day')::date
           ) as fecha_contable
    from fin_movimientos mv
    where mv.tipo = 'ingreso'
      and coalesce(mv.clasificacion, '') <> 'financiamiento'
      and coalesce(mv.origen, '') <> 'ajuste_inicial'
      and mv.mes_contable is not null
  ) m
  where m.fecha_contable between p_desde and p_hasta;
$fn$;

comment on function public.fin_eventos_facturacion(date, date) is
  'IA SIM 5A.1 - fuente canonica de eventos de facturacion de SIM, a nivel dia. Solo lectura. fin_ingresos_por_mes agrega las filas clase=automatico; la herramienta analitica interna usa todas (facturacion total operativa bruta). Agregar una fuente nueva se hace SOLO aca.';

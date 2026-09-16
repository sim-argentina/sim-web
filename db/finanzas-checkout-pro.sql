-- Finanzas · Comisiones reales de Mercado Pago Checkout Pro (cobros web)
--
-- Problema: los cobros web (campeonatos, reservas online, gift cards) se
-- contabilizaban por su BRUTO completo en el saldo de Mercado Pago, pero MP
-- descuenta sus cargos antes de acreditar. El saldo teórico quedaba inflado.
--
-- Este bloque NO estima con una tasa fija: guarda, por pago, los números reales
-- que devuelve Mercado Pago (`fee_details` y `transaction_details
-- .net_received_amount`). Aditivo e idempotente; no toca ninguna tabla operativa.

-- ── 1) Foto financiera de cada cobro web ────────────────────────────────────
-- Una fila por payment_id. Deliberadamente NO guarda el pago completo de MP:
-- ese objeto trae datos personales del pagador que Finanzas no necesita.
create table if not exists public.fin_pagos_web (
  payment_id            text primary key,
  producto              text not null check (producto in ('campeonatos', 'reservas_online', 'gift_cards')),
  referencia_externa    text,

  -- Las tres cifras del contrato:  bruto − cargos = neto
  bruto                 numeric(14,2),
  cargos                numeric(14,2),
  neto                  numeric(14,2),

  -- Trazabilidad de las dos vías de cálculo, para poder auditar la diferencia.
  cargos_fee_details    numeric(14,2),   -- Σ fee_details donde fee_payer = collector
  -- charges_details incluye la comisión Y las retenciones impositivas (SIRTAC,
  -- IIBB…), que fee_details NO trae pero net_received_amount sí descuenta.
  cargos_charges_details numeric(14,2),
  neto_mp               numeric(14,2),   -- transaction_details.net_received_amount
  fee_details           jsonb not null default '[]'::jsonb,
  charges_details       jsonb not null default '[]'::jsonb,
  diferencia_redondeo   numeric(14,2),   -- cargos − desglose conocido (debe ser ~0)
  conciliado            boolean not null default false,

  -- MP no dio ni fee_details ni net_received_amount. NO se asume comisión 0:
  -- el pago queda marcado y Finanzas lo muestra como advertencia.
  incompleto            boolean not null default false,
  motivo_incompleto     text,

  moneda                text,
  mp_status             text,
  mp_status_detail      text,
  date_approved         timestamptz,
  date_last_updated     timestamptz,
  money_release_date    timestamptz,
  money_release_status  text,
  metodo_pago           text,
  tipo_pago             text,

  origen                text not null default 'webhook' check (origen in ('webhook', 'reconciliacion', 'backfill')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists fin_pagos_web_producto_idx on public.fin_pagos_web (producto);
create index if not exists fin_pagos_web_date_approved_idx on public.fin_pagos_web (date_approved);
create index if not exists fin_pagos_web_incompleto_idx on public.fin_pagos_web (incompleto) where incompleto;

-- Patrón de tablas admin del proyecto: RLS habilitado con 0 policies
-- (deny-by-default; solo service_role vía supabaseAdmin accede).
alter table public.fin_pagos_web enable row level security;

comment on table public.fin_pagos_web is
  'Cargos reales de Mercado Pago por cobro web (Checkout Pro). bruto − cargos = neto. Solo lectura desde Finanzas; no afecta el flujo operativo de compra.';

-- ── 2) Comisiones web del mes ───────────────────────────────────────────────
-- Replica EXACTAMENTE el criterio de mes de fin_ingresos_por_mes para que el
-- bruto y su cargo caigan siempre en el mismo mes contable: ningún cargo queda
-- huérfano ni se imputa a un mes donde el ingreso no está.
--
-- Un pago sin fila en fin_pagos_web sale como incompleto = true: es "comisión no
-- disponible", nunca comisión 0.
create or replace function public.fin_comisiones_web_por_mes(p_mes text)
returns table(
  producto text,
  payment_id text,
  referencia text,
  bruto_operacion numeric,
  bruto numeric,
  cargos numeric,
  neto numeric,
  incompleto boolean,
  conciliado boolean,
  motivo_incompleto text,
  mp_status text,
  date_approved timestamptz,
  money_release_status text
)
language sql
stable
set search_path = public
as $fn$
  with pagos_mes as (
    -- Campeonatos: mismo criterio que fin_ingresos_por_mes (created_at AR).
    select 'campeonatos'::text as producto,
           ci.payment_id as payment_id,
           ci.id::text as referencia,
           coalesce(ci.monto, 0) as bruto_operacion
    from campeonato_inscripciones ci
    where ci.estado_pago = 'pagado'
      and ci.eliminada_at is null
      and ci.payment_id is not null
      and to_char(ci.created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes

    union all

    -- Reservas online (excluye empresa y mensualidad, igual que el ingreso).
    select 'reservas_online'::text,
           r.mercado_pago_payment_id,
           r.id::text,
           coalesce(r.total, 0)
    from reservas r
    where r.estado in ('activa', 'reembolsada')
      and (r.origen is null or r.origen not in ('empresa', 'mensualidad'))
      and r.mercado_pago_payment_id is not null
      and to_char(r.created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes

    union all

    -- Gift cards: por fecha_pago. Una compra puede generar varias filas con el
    -- MISMO payment_id; el agrupado de abajo hace que el cargo se cuente una vez.
    select 'gift_cards'::text,
           g.mercado_pago_payment_id,
           g.id::text,
           coalesce(g.monto, 0)
    from gift_cards g
    where g.estado_pago = 'pagado'
      and g.fecha_pago is not null
      and g.mercado_pago_payment_id is not null
      and to_char(g.fecha_pago at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
  ),
  -- Un payment_id se cuenta UNA sola vez, sin importar cuántas filas operativas
  -- cubra. Es lo que evita descontar el mismo cargo dos veces.
  unicos as (
    select producto,
           payment_id,
           min(referencia) as referencia,
           sum(bruto_operacion) as bruto_operacion
    from pagos_mes
    group by producto, payment_id
  )
  select u.producto,
         u.payment_id,
         u.referencia,
         u.bruto_operacion,
         p.bruto,
         p.cargos,
         p.neto,
         coalesce(p.incompleto, true),
         coalesce(p.conciliado, false),
         coalesce(p.motivo_incompleto, 'sin_registro_financiero'),
         p.mp_status,
         p.date_approved,
         p.money_release_status
  from unicos u
  left join fin_pagos_web p on p.payment_id = u.payment_id
  order by u.producto, u.payment_id;
$fn$;

revoke all on function public.fin_comisiones_web_por_mes(text) from public, anon, authenticated;
grant execute on function public.fin_comisiones_web_por_mes(text) to service_role;

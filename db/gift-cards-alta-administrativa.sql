-- ════════════════════════════════════════════════════════════════════════════
-- Gift Cards SIM · alta administrativa (emisión manual desde el panel)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un administrador puede emitir una Gift Card desde /admin/gift-cards sin pasar
-- por Mercado Pago. NO es un segundo sistema de Gift Cards: es la MISMA tabla,
-- el MISMO generador de código, el MISMO estado y el MISMO canje. Lo único que
-- cambia es de dónde vino la plata.
--
-- Esta migración es ADITIVA: agrega cuatro columnas con default compatible,
-- agrega constraints que las filas viejas ya cumplen, rellena una columna que
-- nunca se había calculado y reemplaza UNA rama de fin_ingresos_por_mes. No
-- edita ninguna migración histórica ni toca el flujo público de compra.
--
-- ── ORIGEN ──────────────────────────────────────────────────────────────────
-- Mismo patrón que Mensualidades M7.4: el origen NO es un estado. Una Gift Card
-- manual queda 'pagado'/'pendiente' igual que una comprada por web; lo que la
-- distingue es la columna `canal`. Así ninguna consulta que filtre por estado
-- tiene que aprender un valor nuevo, y Finanzas puede separar por canal sin
-- mirar el importe.
--
-- ── FINANZAS ────────────────────────────────────────────────────────────────
-- fin_ingresos_por_mes ya contaba las Gift Cards pagadas por fecha_pago, pero
-- imputaba TODAS a 'mercadopago' porque hasta hoy no había otra forma de pagar
-- una. Una Gift Card cobrada en efectivo en el mostrador habría inflado el saldo
-- de Mercado Pago y vaciado el de Efectivo. Se agrupa por canal con el mismo
-- criterio que ya usa la rama de mensualidades. El ingreso sigue entrando UNA
-- sola vez y desde la misma fuente: no se inserta ningún fin_movimientos.
--
-- fin_comisiones_web_por_mes NO se toca: su rama de gift_cards exige
-- mercado_pago_payment_id is not null, y una Gift Card manual nunca lo tiene.
-- Queda fuera sola, que es lo correcto: no hubo cobro de Checkout Pro.

-- ── 1) Origen y cobro de la Gift Card ───────────────────────────────────────
-- canal 'web' como default deja todas las filas históricas exactamente donde
-- estaban: compradas por Mercado Pago.
alter table public.gift_cards
  add column if not exists canal          text not null default 'web',
  add column if not exists medio_pago     text,
  add column if not exists procesador     text,
  add column if not exists registrado_por text;

comment on column public.gift_cards.canal is
  'Origen de la emisión: web (Checkout Pro) o admin (emitida a mano desde el panel). NO es un estado: el estado funcional sigue siendo estado_pago/estado_uso.';
comment on column public.gift_cards.medio_pago is
  'Solo canal admin: cómo se cobró en el mostrador (efectivo|qr|debito|credito). Null en el canal web, donde el medio lo define Mercado Pago.';
comment on column public.gift_cards.procesador is
  'Solo canal admin y solo cuando el medio no es efectivo: mercado_pago. Es lo que decide a qué cuenta imputa Finanzas.';
comment on column public.gift_cards.registrado_por is
  'Rol de la sesión administrativa que emitió la Gift Card. Sale de la cookie firmada, nunca del navegador.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gift_cards_canal_chk') then
    alter table public.gift_cards
      add constraint gift_cards_canal_chk check (canal in ('web', 'admin'));
  end if;

  -- Mismos medios que Mensualidades M7.4: los únicos con cuenta inequívoca en
  -- el modelo financiero vigente. Transferencia y Payway quedan afuera a
  -- propósito hasta que exista una regla de imputación para ellos.
  if not exists (select 1 from pg_constraint where conname = 'gift_cards_medio_pago_chk') then
    alter table public.gift_cards
      add constraint gift_cards_medio_pago_chk
      check (medio_pago is null or medio_pago in ('efectivo', 'qr', 'debito', 'credito'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'gift_cards_procesador_chk') then
    alter table public.gift_cards
      add constraint gift_cards_procesador_chk
      check (procesador is null or procesador in ('mercado_pago'));
  end if;

  -- Coherencia por canal. Es lo que impide que una Gift Card web tenga medio de
  -- pago de mostrador, y que una manual arrastre identificadores de Mercado Pago
  -- que jamás existieron. Las filas históricas (canal 'web', las tres columnas
  -- nuevas en null) ya la cumplen.
  if not exists (select 1 from pg_constraint where conname = 'gift_cards_canal_coherencia_chk') then
    alter table public.gift_cards
      add constraint gift_cards_canal_coherencia_chk
      check (
        case canal
          when 'web' then
            medio_pago is null and procesador is null and registrado_por is null
          when 'admin' then
            medio_pago is not null
            and (procesador is null) = (medio_pago = 'efectivo')
            and mercado_pago_payment_id is null
            and mercado_pago_preference_id is null
          else false
        end
      );
  end if;
end $$;

create index if not exists gift_cards_canal_idx
  on public.gift_cards (canal, fecha_pago desc);

-- ── 2) Vigencia: 30 días desde el pago ──────────────────────────────────────
-- fecha_vencimiento existía desde siempre pero NADIE la calculaba: quedaba en
-- null y la única forma de llenarla era la acción "Renovar" del panel. La regla
-- comercial publicada (condiciones impresas en la Gift Card y Términos §9) dice
-- 30 días desde la compra; a partir de acá esa regla se escribe en la fila.
--
-- El cálculo vive en la aplicación (lib/giftCards.ts · GIFT_CARD_VIGENCIA_DIAS)
-- y lo usan los DOS caminos de emisión con la misma función. Acá solo se rellena
-- lo histórico para que no queden dos poblaciones distintas.
update public.gift_cards
   set fecha_vencimiento = fecha_pago + interval '30 days'
 where estado_pago = 'pagado'
   and fecha_pago is not null
   and fecha_vencimiento is null;

-- ── 3) Finanzas: el método de cobro sale del canal ──────────────────────────
-- Copia EXACTA de fin_ingresos_por_mes con una sola rama modificada, la de
-- gift_cards. Todo lo demás queda igual carácter por carácter.
create or replace function public.fin_ingresos_por_mes(p_mes text)
returns table(fuente text, metodo text, total numeric, cantidad numeric)
language sql
stable
as $function$
  with ts as (
    select * from turnos_stand
    where to_char(fecha, 'YYYY-MM') = p_mes
      and (estado is null or estado <> 'cancelado')
  ),
  ts_montos as (
    select
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
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(t.pagos_detalle) = 'array' then t.pagos_detalle else '[]'::jsonb end
    ) p on jsonb_typeof(t.pagos_detalle) = 'array' and jsonb_array_length(t.pagos_detalle) > 0
  ),
  ts_turnos as (
    select coalesce(sum(coalesce(cantidad_turnos, 1)), 0) as turnos from ts
  )
  select 'turnero'::text, m.metodo, coalesce(sum(m.monto), 0), (select turnos from ts_turnos)
  from ts_montos m group by m.metodo
  union all
  select 'reservas_online'::text, 'mercadopago'::text,
         coalesce(sum(total), 0), count(*)::numeric
  from reservas
  where to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
    and estado in ('activa','reembolsada')
    and (origen is null or origen not in ('empresa','mensualidad'))
  union all
  -- Gift cards: una emitida por web se cobró por Checkout Pro; una emitida desde
  -- el panel se cobró en el mostrador y su medio real manda. El criterio de mes
  -- (fecha_pago en hora argentina) es el mismo para las dos, así que el ingreso
  -- sigue entrando UNA sola vez y en el mismo mes que antes.
  select 'gift_cards'::text,
         case when g.canal = 'admin'
              then coalesce(nullif(trim(g.medio_pago), ''), 'desconocido')
              else 'mercadopago' end,
         coalesce(sum(g.monto), 0), count(*)::numeric
  from gift_cards g
  where g.estado_pago = 'pagado'
    and g.fecha_pago is not null
    and to_char(g.fecha_pago at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
  group by 2
  union all
  select 'campeonatos'::text,
         coalesce(nullif(trim(metodo_pago), ''), 'mercadopago'),
         coalesce(sum(monto), 0), count(*)::numeric
  from campeonato_inscripciones
  where estado_pago = 'pagado'
    and eliminada_at is null
    and to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
  group by 2
  union all
  select 'mensualidades'::text,
         case when c.canal = 'web' then 'mercadopago'
              else coalesce(nullif(trim(c.medio_pago), ''), 'desconocido') end,
         coalesce(sum(c.importe_bruto), 0), count(*)::numeric
  from mensualidad_compras c
  where c.procesamiento = 'aplicado'
    and c.canal in ('web', 'admin_venta')
    and to_char(coalesce(c.cobrado_at, c.aprobado_at) at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = p_mes
  group by 2;
$function$;

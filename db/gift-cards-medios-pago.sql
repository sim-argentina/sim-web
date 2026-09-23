-- ════════════════════════════════════════════════════════════════════════════
-- Gift Cards SIM · medios de cobro reales de la emisión manual
-- ════════════════════════════════════════════════════════════════════════════
--
-- La primera versión de la emisión manual (db/gift-cards-alta-administrativa.sql)
-- aceptaba solo efectivo|qr|debito|credito y forzaba procesador = mercado_pago.
-- Eso dejaba afuera dos cosas que Finanzas SÍ modela desde siempre:
--
--   · transferencia — medio sin comisión, junto con efectivo
--     (lib/finanzasComisiones.ts · METODOS_SIN_COMISION);
--   · payway — segundo procesador con posnet en el local, con sus propias tasas
--     en fin_comisiones_cobro, igual de vigente que Mercado Pago.
--
-- Esta migración alinea la Gift Card manual con ese modelo. Es ADITIVA sobre el
-- bloque anterior: reemplaza dos constraints por versiones MÁS PERMISIVAS y una
-- tercera por la regla correcta. Ninguna fila existente deja de cumplirlas.
--
-- LA REGLA, UNA SOLA VEZ
-- Un cobro lleva procesador exactamente cuando pasa por posnet: qr, débito y
-- crédito lo llevan; efectivo y transferencia no. Antes esa condición estaba
-- escrita como `(procesador is null) = (medio_pago = 'efectivo')`, que era
-- correcta solo mientras efectivo fuera el único medio sin comisión.
--
-- COMISIONES
-- No se guarda ninguna comisión en la fila y no se crea ninguna tabla de tasas
-- para Gift Cards. La comisión se calcula al leer, con la MISMA configuración
-- (fin_comisiones_cobro) y el MISMO helper (calcularComisionesPagos) que usa el
-- turnero. Ver lib/finanzas.ts · getComisionesGiftCardsManualesMes.

do $$
begin
  -- ── Medios: se suma transferencia ─────────────────────────────────────────
  alter table public.gift_cards drop constraint if exists gift_cards_medio_pago_chk;
  alter table public.gift_cards
    add constraint gift_cards_medio_pago_chk
    check (medio_pago is null
           or medio_pago in ('efectivo', 'transferencia', 'qr', 'debito', 'credito'));

  -- ── Procesadores: se suma payway ──────────────────────────────────────────
  alter table public.gift_cards drop constraint if exists gift_cards_procesador_chk;
  alter table public.gift_cards
    add constraint gift_cards_procesador_chk
    check (procesador is null or procesador in ('mercado_pago', 'payway'));

  -- ── Coherencia por canal, con la regla correcta ───────────────────────────
  -- El canal web sigue exactamente igual. En el canal admin, el procesador ya no
  -- se ata a "no es efectivo" sino a "es un medio con posnet".
  alter table public.gift_cards drop constraint if exists gift_cards_canal_coherencia_chk;
  alter table public.gift_cards
    add constraint gift_cards_canal_coherencia_chk
    check (
      case canal
        when 'web' then
          medio_pago is null and procesador is null and registrado_por is null
        when 'admin' then
          medio_pago is not null
          and (procesador is not null) = (medio_pago in ('qr', 'debito', 'credito'))
          and mercado_pago_payment_id is null
          and mercado_pago_preference_id is null
        else false
      end
    );
end $$;

comment on column public.gift_cards.medio_pago is
  'Solo canal admin: como se cobro en el mostrador. Mismos medios que modela Finanzas (efectivo|transferencia|qr|debito|credito). Null en el canal web, donde el medio lo define Mercado Pago.';
comment on column public.gift_cards.procesador is
  'Solo canal admin y solo para los medios con posnet (qr|debito|credito): mercado_pago o payway. Decide con que tasa de fin_comisiones_cobro se calcula la comision y a que cuenta imputa Finanzas.';

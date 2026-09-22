import { randomInt } from "crypto";

// Catálogo de Gift Cards y helpers compartidos.
// El precio se define acá (server-side) para que el monto no dependa del cliente.

export type GiftCardProducto = {
  duracion: number;
  monto: number;
  titulo: string;
  descripcion: string;
};

export const GIFT_CARD_PRODUCTOS: GiftCardProducto[] = [
  {
    duracion: 15,
    monto: 12000,
    titulo: "Gift Card · 15 min",
    descripcion: "Una sesión de simulador de Fórmula 1 de 15 minutos.",
  },
  {
    duracion: 30,
    monto: 20000,
    titulo: "Gift Card · 30 min",
    descripcion: "Una sesión doble de 30 minutos (dos turnos consecutivos).",
  },
];

export function getProductoPorDuracion(duracion: number): GiftCardProducto | null {
  return GIFT_CARD_PRODUCTOS.find((p) => p.duracion === Number(duracion)) ?? null;
}

export const GIFT_CARD_MAX_CANTIDAD = 10;
export type ModoUso = "juntas" | "separadas";

// Medios con los que se puede cobrar una Gift Card emitida desde el panel.
// Mismos que Mensualidades M7.4: los únicos con cuenta inequívoca en el modelo
// financiero vigente (efectivo → Efectivo; qr/débito/crédito → procesador
// Mercado Pago → cuenta Mercado Pago). Transferencia y Payway quedan afuera a
// propósito hasta que exista una regla de imputación para ellos.
//
// Viven acá, y no en el módulo de alta, porque el formulario del panel es un
// componente de cliente y el módulo de alta es solo-servidor: una sola lista
// para los dos lados, sin arrastrar supabaseAdmin al navegador.
export const MEDIOS_PAGO_GIFT_CARD = ["efectivo", "qr", "debito", "credito"] as const;
export type MedioPagoGiftCard = (typeof MEDIOS_PAGO_GIFT_CARD)[number];

export const MEDIO_PAGO_GIFT_CARD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  qr: "QR",
  debito: "Débito",
  credito: "Crédito",
};

export const GIFT_CARD_OBSERVACIONES_MAX = 500;

// Reparte un total en enteros entre n filas (el resto se suma a la primera),
// de modo que la suma sea exactamente el total.
export function repartirMonto(total: number, n: number): number[] {
  if (n <= 1) return [total];
  const base = Math.floor(total / n);
  const resto = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? resto : 0));
}

// Código único legible: SIM-XXXX-XXXX (entropía criptográfica, no Math.random).
export function generarCodigoGiftCard(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I
  const bloque = () =>
    Array.from({ length: 4 }, () => alfabeto[randomInt(alfabeto.length)]).join("");
  return `SIM-${bloque()}-${bloque()}`;
}

// Vigencia comercial de una Gift Card, en días desde que el pago queda
// confirmado. Es la MISMA para las dos formas de emitirla (compra web y alta
// administrativa) y la única fuente de esa regla: la condición impresa en la
// Gift Card se arma con esta constante, así el papel que recibe el cliente y la
// fecha guardada en la base no pueden divergir. También está publicada en los
// Términos y Condiciones (§9): cambiarla acá obliga a cambiarla allá.
export const GIFT_CARD_VIGENCIA_DIAS = 30;

// Vencimiento de una Gift Card a partir de su fecha de pago. Server-side y
// compartida: la usan el webhook de Mercado Pago, la gift card 100% bonificada
// y el alta desde el panel. No hay una segunda fórmula en ningún lado.
export function calcularVencimientoGiftCard(fechaPagoIso: string): string | null {
  const base = new Date(fechaPagoIso);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(
    base.getTime() + GIFT_CARD_VIGENCIA_DIAS * 24 * 60 * 60 * 1000
  ).toISOString();
}

export const GIFT_CARD_CONDICIONES = [
  `Válida por ${GIFT_CARD_VIGENCIA_DIAS} días desde la fecha de compra.`,
  "Canjeable por una sesión en SIM Argentina presentando este código.",
  "Altura mínima para usar los simuladores: 1,40 m.",
  "Peso máximo permitido: 110 kg.",
  "No reembolsable en efectivo. Sujeta a disponibilidad de turnos.",
];

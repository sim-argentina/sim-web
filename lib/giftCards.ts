import { randomInt } from "crypto";
import type { MetodoPago, Procesador } from "@/lib/finanzasComisiones";
import { productoGiftCard, productosGiftCard, type Modalidad } from "@/lib/catalogoComercial";

// Catálogo de Gift Cards y helpers compartidos.
//
// (B5) Duraciones y montos salen del catálogo comercial VERSIONADO
// (lib/catalogoComercial.ts): legacy 15/30 a $12.000/$20.000, v2_10 10/20/30 a
// $10.000/$17.000/$23.000. Acá solo se les agregan los textos. Qué modalidad
// rige para una Gift Card NUEVA lo decide el servidor en cada request
// (lib/giftCardsComercial.ts); una Gift Card ya emitida no vuelve a mirar el
// catálogo: su duración y su monto son los de su fila.

export type GiftCardProducto = {
  duracion: number;
  monto: number;
  titulo: string;
  descripcion: string;
};

// Legacy conserva EXACTAMENTE los textos de siempre. v2 (y cualquier otra
// duración) usa el genérico: nada de "dos turnos" ni de sesiones de 15.
const DESCRIPCION_LEGACY: Readonly<Record<number, string>> = {
  15: "Una sesión de simulador de Fórmula 1 de 15 minutos.",
  30: "Una sesión doble de 30 minutos (dos turnos consecutivos).",
};

function descripcionGiftCard(modalidad: Modalidad, duracion: number): string {
  return (modalidad === "legacy" ? DESCRIPCION_LEGACY[duracion] : undefined)
    ?? `Una sesión de simulador de Fórmula 1 de ${duracion} minutos.`;
}

/** Los productos de Gift Card que se venden en esa modalidad, con sus textos. */
export function productosGiftCardDe(modalidad: Modalidad): GiftCardProducto[] {
  return productosGiftCard(modalidad).map(({ duracion, monto }) => ({
    duracion,
    monto,
    titulo: `Gift Card · ${duracion} min`,
    descripcion: descripcionGiftCard(modalidad, duracion),
  }));
}

/** El producto de esa duración en esa modalidad, o null si esa modalidad no lo vende. */
export function productoGiftCardDe(modalidad: Modalidad, duracion: unknown): GiftCardProducto | null {
  const p = productoGiftCard(modalidad, duracion);
  return p ? productosGiftCardDe(modalidad).find((x) => x.duracion === p.duracion) ?? null : null;
}

export const GIFT_CARD_MAX_CANTIDAD = 10;
export type ModoUso = "juntas" | "separadas";

// Medios y procesadores con los que se puede cobrar una Gift Card emitida desde
// el panel. NO son una lista propia de Gift Cards: son exactamente los que
// modela Finanzas para cualquier cobro presencial (lib/finanzasComisiones.ts),
// que es también la fuente de la regla de qué medio lleva procesador.
//
// Se re-exportan desde acá porque el formulario del panel es un componente de
// cliente: finanzasComisiones es un módulo puro sin acceso a base, así que
// viaja al navegador sin arrastrar nada del servidor.
export {
  METODOS_PAGO as MEDIOS_PAGO_GIFT_CARD,
  METODO_PAGO_LABEL as MEDIO_PAGO_GIFT_CARD_LABEL,
  PROCESADORES as PROCESADORES_GIFT_CARD,
  PROCESADOR_LABEL as PROCESADOR_GIFT_CARD_LABEL,
  requiereProcesador,
} from "@/lib/finanzasComisiones";
export type MedioPagoGiftCard = MetodoPago;
export type ProcesadorGiftCard = Procesador;

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

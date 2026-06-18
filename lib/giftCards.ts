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

export const GIFT_CARD_CONDICIONES = [
  "Válida por 30 días desde la fecha de compra.",
  "Canjeable por una sesión en SIM Argentina presentando este código.",
  "Altura mínima para usar los simuladores: 1,40 m.",
  "Peso máximo permitido: 110 kg.",
  "No reembolsable en efectivo. Sujeta a disponibilidad de turnos.",
];

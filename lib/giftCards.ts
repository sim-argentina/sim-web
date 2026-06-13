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

// Código único legible: SIM-XXXX-XXXX
export function generarCodigoGiftCard(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I
  const bloque = () =>
    Array.from(
      { length: 4 },
      () => alfabeto[Math.floor(Math.random() * alfabeto.length)]
    ).join("");
  return `SIM-${bloque()}-${bloque()}`;
}

export const GIFT_CARD_CONDICIONES = [
  "Válida por 6 meses desde la fecha de compra.",
  "Canjeable por una sesión en SIM Argentina presentando este código.",
  "No acumulable con otras promociones. No reembolsable en efectivo.",
  "Sujeta a disponibilidad de turnos. Coordiná tu visita por WhatsApp.",
];

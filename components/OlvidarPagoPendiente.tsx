"use client";

import { useEffect } from "react";
import { olvidarIntento, olvidarPagoPendiente } from "@/lib/intentoCompra";

/** En la página de éxito: el pago ya se hizo, no hay nada que continuar. */
export default function OlvidarPagoPendiente({ flujo }: { flujo: "reserva" | "gift_card" }) {
  useEffect(() => {
    olvidarPagoPendiente(flujo);
    olvidarIntento(flujo);
  }, [flujo]);
  return null;
}

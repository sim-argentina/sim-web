// ============================================================================
// Clave del intento de compra en el NAVEGADOR (Reservas y Gift Cards).
// ----------------------------------------------------------------------------
// La misma clave para el mismo pedido aunque la página se recargue o la persona
// vuelva desde Mercado Pago (sessionStorage: solo esta pestaña, se borra al
// cerrarla); una nueva en cuanto cambia algo del pedido. Se guarda la clave y un
// resumen (hash) del pedido, nunca el pedido: ni nombre ni teléfono quedan en el
// navegador. La clave sola no sirve para nada: el servidor la ata a la huella
// completa del pedido (lib/cuponesRetencion.ts).
// ============================================================================

/** Hash corto y estable (cyrb53): solo para comparar pedidos, no es secreto. */
function resumen(texto: string): string {
  let h1 = 0xdeadbeef ^ texto.length;
  let h2 = 0x41c6ce57 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const clave = (flujo: string) => `sim:intento-compra:${flujo}`;

/** La clave del intento para este pedido (la guardada si es el mismo pedido, o una nueva). */
export function intentoParaPedido(flujo: "reserva" | "gift_card", pedido: unknown): string {
  const huella = resumen(JSON.stringify(pedido));
  try {
    const guardado = JSON.parse(sessionStorage.getItem(clave(flujo)) || "null") as { id?: unknown; huella?: unknown } | null;
    if (guardado && typeof guardado.id === "string" && guardado.huella === huella) return guardado.id;
  } catch {
    /* sin almacenamiento: una clave nueva, sin reintento entre recargas */
  }
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(clave(flujo), JSON.stringify({ id, huella }));
  } catch {
    /* idem */
  }
  return id;
}

/** El intento terminó (compra hecha) o el servidor dijo que ya no sirve. */
export function olvidarIntento(flujo: "reserva" | "gift_card"): void {
  try {
    sessionStorage.removeItem(clave(flujo));
  } catch {
    /* nada que borrar */
  }
}

// ── Pago ya iniciado en esta pestaña ───────────────────────────────────────
// Al volver desde Mercado Pago (atrás o recarga) la compra sigue pendiente y,
// con un cupón limitado, el cupón sigue apartado por ESA compra: la página
// ofrece continuar ese mismo pago en vez de armar otro. Se guarda el link de la
// propia persona, una descripción corta (sin nombre ni teléfono) y hasta cuándo
// mostrarlo; nada de esto autoriza nada en el servidor.
const VIDA_PAGO_PENDIENTE_MS = 30 * 60_000;
const clavePago = (flujo: string) => `sim:pago-pendiente:${flujo}`;

export type PagoPendiente = { link: string; descripcion: string; hasta: number; conCupon: boolean };

export function guardarPagoPendiente(flujo: "reserva" | "gift_card", p: { link: string; descripcion: string; conCupon: boolean }, ahora = Date.now()): void {
  try {
    sessionStorage.setItem(clavePago(flujo), JSON.stringify({ ...p, hasta: ahora + VIDA_PAGO_PENDIENTE_MS }));
  } catch {
    /* sin almacenamiento: no se ofrece continuar */
  }
}

export function leerPagoPendiente(flujo: "reserva" | "gift_card", ahora = Date.now()): PagoPendiente | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(clavePago(flujo)) || "null") as PagoPendiente | null;
    if (!p || typeof p.link !== "string" || typeof p.hasta !== "number") return null;
    // Solo links propios del checkout (Mercado Pago o la página simulada local).
    if (!/^(https:\/\/[a-z0-9.-]*mercadopago\.com(\.ar)?\/|\/pruebas\/mercadopago\?)/i.test(p.link)) return null;
    if (p.hasta <= ahora) {
      sessionStorage.removeItem(clavePago(flujo));
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function olvidarPagoPendiente(flujo: "reserva" | "gift_card"): void {
  try {
    sessionStorage.removeItem(clavePago(flujo));
  } catch {
    /* nada */
  }
}

/** Respuestas del servidor después de las cuales la clave no se vuelve a usar. */
export function intentoTerminado(codigo: unknown): boolean {
  return codigo === "intento_vencido" || codigo === "intento_con_otro_pedido" || codigo === "compra_ya_pagada";
}

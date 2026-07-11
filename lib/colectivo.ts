// Lógica y constantes compartidas del módulo Colectivo (eventos itinerantes con
// turnero + venta de productos). Reutilizadas por las rutas admin y el frontend.
// Puras (sin acceso a DB) para poder importarse desde cliente y servidor.
//
// IMPORTANTE: la recaudación del colectivo se administra por separado y NO forma
// parte de Finanzas SIM. El módulo Colectivo maneja sus propios importes (solo
// informativos/operativos dentro de /admin/colectivo). Ninguna consulta financiera
// debe incluir tablas colectivo_*.

// Los 6 simuladores del colectivo (distintos a los del stand).
export const SIMULADORES_COLECTIVO = [
  "Aston Martin 1",
  "McLaren",
  "Mercedes",
  "Aston Martin 2",
  "Red Bull",
  "Ferrari",
] as const;

export const METODOS_PAGO_COLECTIVO = [
  { value: "qr", label: "QR" },
  { value: "efectivo", label: "Efectivo" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "transferencia", label: "Transferencia" },
] as const;

export const POSNETS_COLECTIVO = ["MP", "PayWay"] as const;

export const ESTADOS_EVENTO = ["proximo", "activo", "finalizado", "cancelado"] as const;
export type EstadoEvento = (typeof ESTADOS_EVENTO)[number];

export const ESTADO_EVENTO_LABEL: Record<string, string> = {
  proximo: "Próximo",
  activo: "Activo",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

export const DURACIONES_SUGERIDAS = [10, 20, 30] as const;
export const DURACION_DEFAULT = 10;

export type PagoDetalleColectivo = {
  metodo_pago: string;
  monto: number;
  posnet_pago: string | null;
};

export function metodoUsaPosnet(metodo: string): boolean {
  return metodo === "debito" || metodo === "credito" || metodo === "qr";
}

// Normaliza y valida los pagos: descarta montos <= 0, limpia posnet cuando el
// método no lo usa. Igual criterio que el turnero del stand.
export function limpiarPagosColectivo(pagos: unknown): PagoDetalleColectivo[] {
  if (!Array.isArray(pagos)) return [];
  const out: PagoDetalleColectivo[] = [];
  for (const p of pagos) {
    if (!p || typeof p !== "object") continue;
    const metodo = String((p as Record<string, unknown>).metodo_pago ?? "qr").trim() || "qr";
    const monto = Number((p as Record<string, unknown>).monto) || 0;
    if (!Number.isFinite(monto) || monto <= 0) continue;
    const posnetRaw = (p as Record<string, unknown>).posnet_pago;
    const posnet = metodoUsaPosnet(metodo) && typeof posnetRaw === "string" && posnetRaw.trim()
      ? posnetRaw.trim()
      : null;
    out.push({ metodo_pago: metodo, monto: Math.round(monto), posnet_pago: posnet });
  }
  return out;
}

// Resumen de pagos → método de pago principal, posnets y total.
export function resumirPagos(pagos: PagoDetalleColectivo[]): {
  metodo_pago: string;
  posnet_pago: string | null;
  total: number;
} {
  const total = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);
  const posnets = pagos.map((p) => p.posnet_pago).filter(Boolean).join(" + ");
  const metodo = pagos.length > 1 ? "mixto" : pagos[0]?.metodo_pago || "qr";
  return { metodo_pago: metodo, posnet_pago: posnets || null, total };
}

export function esSimuladorColectivo(s: unknown): boolean {
  return typeof s === "string" && (SIMULADORES_COLECTIVO as readonly string[]).includes(s);
}

// Simuladores válidos (solo los del colectivo), sin duplicados.
export function normalizarSimuladoresColectivo(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const s of input) if (esSimuladorColectivo(s)) set.add(s);
  return [...set];
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
export function esFechaValida(f: unknown): f is string {
  return typeof f === "string" && FECHA_RE.test(f);
}

// ¿La fecha está dentro del rango del evento (inclusive)?
export function fechaDentroDelEvento(fecha: string, inicio: string, fin: string): boolean {
  return esFechaValida(fecha) && fecha >= inicio && fecha <= fin;
}

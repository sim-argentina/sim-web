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

// Columnas que devuelven las APIs. En turnos, las legacy (nombre, telefono,
// hora_estimada_subida) quedan en la base por compatibilidad histórica, pero el
// turnero ya no las pide, ni las escribe ni las muestra. Las ventas conservan su
// comprador y teléfono opcionales.
export const COLUMNAS_TURNO_COLECTIVO =
  "id, evento_id, fecha, hora, hora_subida, hora_bajada, simuladores, cantidad_simuladores, cantidad_personas, cantidad_minutos, cantidad_turnos, metodo_pago, posnet_pago, pagos_detalle, turno_listo, total, estado, observaciones, created_by, created_at, updated_at";
export const COLUMNAS_VENTA_COLECTIVO =
  "id, evento_id, producto_id, producto_nombre, fecha, fecha_hora, cantidad, precio_unitario, total, cliente, telefono, observaciones, metodo_pago, posnet_pago, pagos_detalle, estado, created_by, created_at, updated_at";

export const DURACIONES_SUGERIDAS = [10, 20, 30] as const;
export const DURACION_DEFAULT = 10;

// Personas por turno: selector cerrado de 1 a 6.
export const PERSONAS_COLECTIVO = [1, 2, 3, 4, 5, 6] as const;
const PERSONAS_MAX = PERSONAS_COLECTIVO[PERSONAS_COLECTIVO.length - 1];

// En el Colectivo cada persona es un turno, sin importar la duración:
// 4 personas × 30' = 4 turnos (no 12). Solo aplica al Colectivo: el Turnero del
// Stand tiene su propia equivalencia y no usa esta función.
export function turnosColectivo(personas: number): number {
  return personas;
}

// Personas válidas: entero de 1 a 6. Un turno cargado antes del selector puede
// tener más (8, 12); al editarlo se acepta ese valor SOLO si no cambia, para no
// obligar a reescribir el histórico. Devuelve null si no es válido.
export function normalizarPersonasColectivo(input: unknown, personasGuardadas?: number | null): number | null {
  return enteroDeSelector(input, PERSONAS_MAX, personasGuardadas);
}

// Cantidad por venta de productos: selector cerrado de 1 a 20.
export const CANTIDADES_VENTA_COLECTIVO: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1);
const CANTIDAD_VENTA_MAX = CANTIDADES_VENTA_COLECTIVO[CANTIDADES_VENTA_COLECTIVO.length - 1];

// Cantidad válida de una venta: entero de 1 a 20. Una venta registrada antes del
// selector con más unidades se puede editar si la cantidad no cambia; no se
// recorta ni se reescribe. Devuelve null si no es válida.
export function normalizarCantidadVentaColectivo(input: unknown, cantidadGuardada?: number | null): number | null {
  return enteroDeSelector(input, CANTIDAD_VENTA_MAX, cantidadGuardada);
}

// Entero de 1 a `max` (acepta el string de un <select>). Por encima de `max`,
// solo el valor ya guardado: compatibilidad con registros anteriores al selector.
function enteroDeSelector(input: unknown, max: number, guardado?: number | null): number | null {
  const n = typeof input === "string" && input.trim() ? Number(input) : input;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return null;
  if (n <= max) return n;
  return guardado != null && n === guardado ? n : null;
}

// Hora opcional (subida/bajada): vacía → null; "HH:MM" o "HH:MM:SS" → "HH:MM".
// Cualquier otra cosa es inválida: se rechaza, no se descarta en silencio.
export function normalizarHoraOpcional(v: unknown): { ok: true; hora: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, hora: null };
  if (typeof v !== "string") return { ok: false };
  const s = v.trim();
  if (!s) return { ok: true, hora: null };
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(s);
  return m ? { ok: true, hora: `${m[1]}:${m[2]}` } : { ok: false };
}

// Un producto se vende en un evento solo si está activo en el catálogo Y
// habilitado en ese evento (colectivo_evento_productos).
export function esVendibleEnEvento(p: { activo: boolean; habilitado: boolean }): boolean {
  return p.activo && p.habilitado;
}

// Resumen de ventas por producto, armado con lo que dice cada venta (su propio
// nombre, cantidad y total), no con el catálogo: un producto desactivado o con
// otro precio sigue sumando lo que realmente se vendió. Activas suman unidades y
// facturación; bonificadas solo unidades; anuladas no cuentan.
export function resumirVentasPorProducto(
  ventas: { producto_nombre: string | null; cantidad: number; total: number; estado: string }[],
): { nombre: string; unidades: number; total: number }[] {
  const por = new Map<string, { nombre: string; unidades: number; total: number }>();
  for (const v of ventas) {
    if (v.estado !== "activa" && v.estado !== "bonificada") continue;
    const nombre = (v.producto_nombre || "").trim() || "Sin producto";
    const r = por.get(nombre) ?? { nombre, unidades: 0, total: 0 };
    r.unidades += Number(v.cantidad) || 0;
    if (v.estado === "activa") r.total += Number(v.total) || 0;
    por.set(nombre, r);
  }
  return [...por.values()].sort((a, b) => b.total - a.total || b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, "es"));
}

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

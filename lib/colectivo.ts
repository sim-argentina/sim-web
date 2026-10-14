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

// Columnas que devuelven las APIs. Los datos que identificaban a la persona
// (turnos: nombre, telefono, hora_estimada_subida; ventas: cliente, telefono)
// quedan en la base por compatibilidad histórica, pero el Colectivo ya no los
// pide, ni los escribe ni los muestra: una venta o un turno viejo que los tenga
// los conserva intactos.
export const COLUMNAS_TURNO_COLECTIVO =
  "id, evento_id, fecha, hora, hora_subida, hora_bajada, simuladores, cantidad_simuladores, cantidad_personas, cantidad_minutos, cantidad_turnos, metodo_pago, posnet_pago, pagos_detalle, turno_listo, total, estado, observaciones, created_by, created_at, updated_at";
// Gastos de la caja: sin eliminado_at/eliminado_por (solo se listan los vigentes).
export const COLUMNAS_GASTO_COLECTIVO =
  "id, evento_id, fecha, categoria, concepto, monto, medio_pago, observaciones, created_by, created_at, updated_at";
export const COLUMNAS_VENTA_COLECTIVO =
  "id, evento_id, producto_id, producto_nombre, fecha, fecha_hora, cantidad, precio_unitario, total, observaciones, metodo_pago, posnet_pago, pagos_detalle, estado, created_by, created_at, updated_at";

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

// ── Caja del evento ─────────────────────────────────────────────────────────
// La caja del Colectivo es interna al evento y no forma parte de Finanzas SIM:
// no alimenta fin_*, saldos, cierres ni reportes financieros de SIM, y no
// aparece en /admin/finanzas. Es solo una herramienta operativa del Colectivo
// para registrar los gastos de un evento y ver cuánto quedó realmente.

// Listas fijas del bloque 1 (la tabla las valida con un CHECK igual).
export const CATEGORIAS_GASTO_COLECTIVO = [
  { value: "combustible", label: "Combustible" },
  { value: "peajes", label: "Peajes" },
  { value: "comida", label: "Comida" },
  { value: "insumos", label: "Insumos" },
  { value: "estacionamiento", label: "Estacionamiento" },
  { value: "otros", label: "Otros" },
] as const;
export const MEDIOS_PAGO_GASTO_COLECTIVO = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
] as const;
const CONCEPTO_MAX = 120;
const OBSERVACIONES_MAX = 500;
// Tope de sanidad para un gasto: frena un dedo de más, no es una regla de negocio.
export const GASTO_MONTO_MAX = 100_000_000;

export type GastoColectivoNormalizado = {
  fecha: string;
  categoria: string;
  concepto: string;
  monto: number;
  medio_pago: string;
  observaciones: string | null;
};

// Fecha de calendario real (rechaza 2026-02-31).
function esFechaCalendario(f: unknown): f is string {
  if (!esFechaValida(f)) return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

// Valida y normaliza un gasto (alta o edición): fecha, categoría, concepto,
// monto (> 0, hasta 2 decimales) y medio de pago obligatorios; observaciones opcional.
export function normalizarGastoColectivo(body: unknown):
  | { ok: true; gasto: GastoColectivoNormalizado }
  | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!esFechaCalendario(b.fecha)) return { ok: false, error: "Elegí la fecha del gasto" };
  const categoria = typeof b.categoria === "string" ? b.categoria : "";
  if (!CATEGORIAS_GASTO_COLECTIVO.some((c) => c.value === categoria)) return { ok: false, error: "Elegí una categoría" };
  const concepto = typeof b.concepto === "string" ? b.concepto.trim().replace(/\s+/g, " ") : "";
  if (!concepto) return { ok: false, error: "Escribí el concepto del gasto" };
  if (concepto.length > CONCEPTO_MAX) return { ok: false, error: `El concepto admite hasta ${CONCEPTO_MAX} caracteres` };
  const crudo = typeof b.monto === "string" && b.monto.trim() ? Number(b.monto) : b.monto;
  if (typeof crudo !== "number" || !Number.isFinite(crudo) || crudo <= 0) return { ok: false, error: "El monto debe ser mayor a 0" };
  const monto = Math.round(crudo * 100) / 100;
  if (monto <= 0) return { ok: false, error: "El monto debe ser mayor a 0" };
  if (monto > GASTO_MONTO_MAX) return { ok: false, error: "Monto fuera de rango" };
  const medio_pago = typeof b.medio_pago === "string" ? b.medio_pago : "";
  if (!MEDIOS_PAGO_GASTO_COLECTIVO.some((m) => m.value === medio_pago)) return { ok: false, error: "Elegí el medio de pago" };
  const obs = typeof b.observaciones === "string" ? b.observaciones.trim() : "";
  if (obs.length > OBSERVACIONES_MAX) return { ok: false, error: `Las observaciones admiten hasta ${OBSERVACIONES_MAX} caracteres` };
  return { ok: true, gasto: { fecha: b.fecha, categoria, concepto, monto, medio_pago, observaciones: obs || null } };
}

// Resultado de la caja de un evento.
//   ingresos = turnos válidos + ventas de productos válidas (la misma facturación
//              que muestra el resumen del evento): sin turnos cancelados ni
//              gratuitos, sin ventas bonificadas ni anuladas.
//   gastos   = gastos de la caja no eliminados.
//   neto     = ingresos − gastos (puede ser negativo).
export function calcularCajaEvento(datos: {
  turnos: { total: number | string | null; estado?: string | null; metodo_pago?: string | null }[];
  ventas: { total: number | string | null; estado: string }[];
  gastos: { monto: number | string; eliminado_at?: string | null }[];
}): { ingresosTurnos: number; ingresosProductos: number; ingresos: number; gastos: number; cantidadGastos: number; neto: number } {
  const redondear = (n: number) => Math.round(n * 100) / 100;
  const ingresosTurnos = datos.turnos
    .filter((t) => t.estado !== "cancelado" && t.metodo_pago !== "gratis")
    .reduce((a, t) => a + (Number(t.total) || 0), 0);
  const ingresosProductos = datos.ventas
    .filter((v) => v.estado === "activa")
    .reduce((a, v) => a + (Number(v.total) || 0), 0);
  const vigentes = datos.gastos.filter((g) => !g.eliminado_at);
  const gastos = redondear(vigentes.reduce((a, g) => a + (Number(g.monto) || 0), 0));
  const ingresos = redondear(ingresosTurnos + ingresosProductos);
  return {
    ingresosTurnos: redondear(ingresosTurnos),
    ingresosProductos: redondear(ingresosProductos),
    ingresos,
    gastos,
    cantidadGastos: vigentes.length,
    neto: redondear(ingresos - gastos),
  };
}

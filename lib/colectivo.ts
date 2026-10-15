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
// Movimientos de la caja: sin eliminado_at/eliminado_por (solo se listan los
// vigentes) ni la columna vieja `categoria` del bloque 1.
export const COLUMNAS_GASTO_COLECTIVO =
  "id, evento_id, fecha, categoria_id, categoria_nombre, tipo, concepto, monto, medio_pago, observaciones, created_by, created_at, updated_at";
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
// para registrar los costos y gastos de un evento y ver cuánto quedó realmente.
//
// Cada movimiento de la caja (tabla colectivo_gastos) pertenece a una categoría
// administrable (colectivo_caja_categorias) y es COSTO o GASTO según la categoría
// al momento de registrarlo: el movimiento guarda ese tipo y el nombre de la
// categoría, así cambiar el catálogo después no reescribe lo que pasó.

export const TIPOS_CAJA = [
  { value: "costo", label: "Costo" },
  { value: "gasto", label: "Gasto" },
] as const;
export type TipoCaja = (typeof TIPOS_CAJA)[number]["value"];
export function esTipoCaja(v: unknown): v is TipoCaja {
  return v === "costo" || v === "gasto";
}
// Pill del tipo (misma en la caja y en la administración de categorías).
export const PILL_TIPO_CAJA: Record<TipoCaja, string> = {
  costo: "bg-amber-900/70 text-amber-300",
  gasto: "bg-sky-900/70 text-sky-300",
};

export const MEDIOS_PAGO_GASTO_COLECTIVO = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
] as const;
const CONCEPTO_MAX = 120;
const OBSERVACIONES_MAX = 500;
export const CATEGORIA_CAJA_NOMBRE_MAX = 60;
// Tope de sanidad para un movimiento: frena un dedo de más, no es una regla de negocio.
export const GASTO_MONTO_MAX = 100_000_000;

// Nombre de categoría tal como se guarda: sin espacios en los bordes ni repetidos.
export function normalizarNombreCategoriaCaja(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s && s.length <= CATEGORIA_CAJA_NOMBRE_MAX ? s : null;
}
// Clave para detectar duplicados: igual que el índice único de la base
// (sin mayúsculas ni espacios repetidos).
export function claveCategoriaCaja(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ").toLowerCase();
}

export type MovimientoCajaNormalizado = {
  fecha: string;
  categoria_id: string;
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida y normaliza un movimiento (alta o edición): fecha, categoría, concepto,
// monto (> 0, hasta 2 decimales) y medio de pago obligatorios; observaciones
// opcional. Que la categoría exista y esté activa lo comprueba el servidor; el
// tipo (costo/gasto) no se recibe: sale de la categoría.
export function normalizarMovimientoCaja(body: unknown):
  | { ok: true; movimiento: MovimientoCajaNormalizado }
  | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!esFechaCalendario(b.fecha)) return { ok: false, error: "Elegí la fecha del movimiento" };
  const categoria_id = typeof b.categoria_id === "string" ? b.categoria_id : "";
  if (!UUID_RE.test(categoria_id)) return { ok: false, error: "Elegí una categoría" };
  const concepto = typeof b.concepto === "string" ? b.concepto.trim().replace(/\s+/g, " ") : "";
  if (!concepto) return { ok: false, error: "Escribí el concepto del movimiento" };
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
  return { ok: true, movimiento: { fecha: b.fecha, categoria_id, concepto, monto, medio_pago, observaciones: obs || null } };
}

export type ResumenCajaEvento = {
  ingresosTurnos: number;
  ingresosProductos: number;
  ingresos: number;
  costos: number;
  cantidadCostos: number;
  gastos: number;
  cantidadGastos: number;
  cantidadMovimientos: number;
  neto: number;
};

// Resultado de la caja de un evento.
//   ingresos = turnos válidos + ventas de productos válidas (la misma facturación
//              que muestra el resumen del evento): sin turnos cancelados ni
//              gratuitos, sin ventas bonificadas ni anuladas.
//   costos   = movimientos vigentes registrados como COSTO.
//   gastos   = movimientos vigentes registrados como GASTO.
//   neto     = ingresos − costos − gastos (puede ser negativo).
// Cada movimiento cuenta con el tipo que guardó al registrarse, no con el tipo
// actual de su categoría.
export function calcularCajaEvento(datos: {
  turnos: { total: number | string | null; estado?: string | null; metodo_pago?: string | null }[];
  ventas: { total: number | string | null; estado: string }[];
  movimientos: { monto: number | string; tipo: string | null; eliminado_at?: string | null }[];
}): ResumenCajaEvento {
  const ingresosTurnos = datos.turnos
    .filter(turnoFacturable)
    .reduce((a, t) => a + (Number(t.total) || 0), 0);
  const ingresosProductos = datos.ventas
    .filter(ventaFacturable)
    .reduce((a, v) => a + (Number(v.total) || 0), 0);
  const vigentes = datos.movimientos.filter(movimientoVigente);
  const costosMov = vigentes.filter(esCosto);
  const gastosMov = vigentes.filter((m) => !esCosto(m));
  const suma = (l: { monto: number | string }[]) => redondear(l.reduce((a, m) => a + (Number(m.monto) || 0), 0));
  const ingresos = redondear(ingresosTurnos + ingresosProductos);
  const costos = suma(costosMov);
  const gastos = suma(gastosMov);
  return {
    ingresosTurnos: redondear(ingresosTurnos),
    ingresosProductos: redondear(ingresosProductos),
    ingresos,
    costos,
    cantidadCostos: costosMov.length,
    gastos,
    cantidadGastos: gastosMov.length,
    cantidadMovimientos: vigentes.length,
    neto: redondear(ingresos - costos - gastos),
  };
}

// ── Reglas únicas de la caja y del informe ──────────────────────────────────
// Caja, Informe y cualquier resumen económico del evento usan estas mismas
// reglas: no hay una versión paralela.
//   · turno facturable: no cancelado y no gratuito.
//   · venta facturable: activa (no bonificada ni anulada).
//   · movimiento vigente: no eliminado; COSTO o GASTO según el tipo guardado.
export function turnoFacturable(t: { estado?: string | null; metodo_pago?: string | null }): boolean {
  return t.estado !== "cancelado" && t.metodo_pago !== "gratis";
}
export function ventaFacturable(v: { estado: string }): boolean {
  return v.estado === "activa";
}
export function movimientoVigente(m: { eliminado_at?: string | null }): boolean {
  return !m.eliminado_at;
}
function esCosto(m: { tipo: string | null }): boolean {
  return m.tipo === "costo";
}
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Informe del evento ──────────────────────────────────────────────────────
// Resumen ejecutivo del evento, calculado en el momento desde los registros
// (turnos, ventas y movimientos de caja): no hay copias ni tablas propias. Es
// interno del Colectivo y no forma parte de Finanzas SIM.
//
// Las cifras principales SON las de la caja (calcularCajaEvento); los desgloses
// salen de los mismos registros con las mismas reglas, así que cierran:
//   turnos + productos = ingresos = Σ por método de cobro
//   Σ costos por categoría = costos · Σ gastos por categoría = gastos
//   costos + gastos = egresos = Σ egresos por medio de pago
//   ingresos − egresos = resultado neto
// Los movimientos se agrupan por el tipo y el nombre de categoría que guardaron
// al registrarse (no por el catálogo de hoy), y las ventas por su propio nombre
// y total, así un evento viejo no cambia si después cambia el catálogo.

export const SIN_DETALLE_PAGO = "sin_detalle";
const ETIQUETA_COBRO: Record<string, string> = { qr: "QR / MP", mixto: "Mixto", [SIN_DETALLE_PAGO]: "Sin detalle de pago" };
export function etiquetaMetodoCobro(metodo: string): string {
  return ETIQUETA_COBRO[metodo] ?? METODOS_PAGO_COLECTIVO.find((m) => m.value === metodo)?.label ?? metodo;
}
export function etiquetaMedioEgreso(medio: string): string {
  return MEDIOS_PAGO_GASTO_COLECTIVO.find((m) => m.value === medio)?.label ?? medio;
}

// Cobros de un turno o venta facturable por método. Si los pagos registrados
// cierran con el total, se usan (pagos divididos incluidos). Si no hay pagos, el
// total va al método principal. Si hay pagos que no cierran, el total va a "sin
// detalle": el total es lo que suma a ingresos y no se inventa un reparto.
function cobrosPorMetodo(total: number, metodo: string | null | undefined, pagos: unknown): { metodo: string; monto: number }[] {
  let lista: unknown = pagos;
  if (typeof lista === "string") { try { lista = JSON.parse(lista); } catch { lista = []; } }
  const validos = (Array.isArray(lista) ? lista : [])
    .map((p) => ({ metodo: String((p as Record<string, unknown>)?.metodo_pago ?? "").trim(), monto: Number((p as Record<string, unknown>)?.monto) || 0 }))
    .filter((p) => p.monto > 0);
  if (validos.length === 0) return total > 0 ? [{ metodo: metodo || SIN_DETALLE_PAGO, monto: total }] : [];
  const suma = validos.reduce((a, p) => a + p.monto, 0);
  if (Math.abs(suma - total) > 0.005) return total > 0 ? [{ metodo: SIN_DETALLE_PAGO, monto: total }] : [];
  return validos.map((p) => ({ metodo: p.metodo || SIN_DETALLE_PAGO, monto: p.monto }));
}

type TurnoInforme = {
  total: number | string | null; estado?: string | null; metodo_pago?: string | null; pagos_detalle?: unknown;
  cantidad_turnos?: number | null; cantidad_personas?: number | null; cantidad_minutos?: number | null;
};
type VentaInforme = {
  total: number | string | null; estado: string; metodo_pago?: string | null; pagos_detalle?: unknown;
  producto_nombre: string | null; cantidad: number;
};
type MovimientoInforme = {
  monto: number | string; tipo: string | null; eliminado_at?: string | null;
  categoria_nombre: string | null; medio_pago: string;
};
export type LineaInforme = { clave: string; etiqueta: string; total: number; cantidad: number };

export type InformeEvento = {
  resumen: ResumenCajaEvento;
  egresos: number;
  margen: number | null; // % con 1 decimal; null si no hubo ingresos
  ingresosPorMetodo: LineaInforme[];
  turnos: {
    facturacion: number; cantidad: number; gratis: number; personas: number; minutos: number;
    porDuracion: { minutos: number; turnos: number }[];
  };
  productos: {
    items: { nombre: string; unidades: number; bonificadas: number; total: number }[];
    unidades: number; bonificadas: number; facturacion: number;
  };
  costosPorCategoria: LineaInforme[];
  gastosPorCategoria: LineaInforme[];
  egresosPorMedio: LineaInforme[];
};

function agrupar<T>(items: T[], clave: (x: T) => string, etiqueta: (k: string) => string, monto: (x: T) => number): LineaInforme[] {
  const por = new Map<string, LineaInforme>();
  for (const x of items) {
    const k = clave(x);
    const l = por.get(k) ?? { clave: k, etiqueta: etiqueta(k), total: 0, cantidad: 0 };
    l.total += monto(x);
    l.cantidad += 1;
    por.set(k, l);
  }
  return [...por.values()]
    .map((l) => ({ ...l, total: redondear(l.total) }))
    .sort((a, b) => b.total - a.total || a.etiqueta.localeCompare(b.etiqueta, "es"));
}

export function armarInformeEvento(datos: {
  turnos: TurnoInforme[];
  ventas: VentaInforme[];
  movimientos: MovimientoInforme[];
}): InformeEvento {
  const resumen = calcularCajaEvento(datos);
  const egresos = redondear(resumen.costos + resumen.gastos);
  const margen = resumen.ingresos > 0 ? Math.round((resumen.neto / resumen.ingresos) * 1000) / 10 : null;

  const turnosFact = datos.turnos.filter(turnoFacturable);
  const ventasFact = datos.ventas.filter(ventaFacturable);
  const cobros = [
    ...turnosFact.flatMap((t) => cobrosPorMetodo(Number(t.total) || 0, t.metodo_pago, t.pagos_detalle)),
    ...ventasFact.flatMap((v) => cobrosPorMetodo(Number(v.total) || 0, v.metodo_pago, v.pagos_detalle)),
  ];
  const ingresosPorMetodo = agrupar(cobros, (c) => c.metodo, etiquetaMetodoCobro, (c) => c.monto);

  // Actividad: todos los turnos no cancelados (los gratuitos también se
  // jugaron), con el mismo criterio que el resumen general del evento.
  const jugados = datos.turnos.filter((t) => t.estado !== "cancelado");
  const cant = (t: TurnoInforme) => Number(t.cantidad_turnos) || 1;
  const porDur = new Map<number, number>();
  for (const t of jugados) {
    const m = Number(t.cantidad_minutos) || DURACION_DEFAULT;
    porDur.set(m, (porDur.get(m) ?? 0) + cant(t));
  }
  const turnos = {
    facturacion: resumen.ingresosTurnos,
    cantidad: jugados.reduce((a, t) => a + cant(t), 0),
    gratis: jugados.filter((t) => t.metodo_pago === "gratis").reduce((a, t) => a + cant(t), 0),
    personas: jugados.reduce((a, t) => a + (Number(t.cantidad_personas) || 1), 0),
    minutos: jugados.reduce((a, t) => a + (Number(t.cantidad_minutos) || DURACION_DEFAULT) * cant(t), 0),
    porDuracion: [...porDur.entries()].sort((a, b) => a[0] - b[0]).map(([minutos, turnos]) => ({ minutos, turnos })),
  };

  // Productos: unidades vendidas y facturación de las ventas activas; las
  // bonificadas se cuentan aparte (unidades entregadas, sin ingreso).
  const porProd = new Map<string, { nombre: string; unidades: number; bonificadas: number; total: number }>();
  for (const v of datos.ventas) {
    const bonificada = v.estado === "bonificada";
    if (!ventaFacturable(v) && !bonificada) continue;
    const nombre = (v.producto_nombre || "").trim() || "Sin producto";
    const p = porProd.get(nombre) ?? { nombre, unidades: 0, bonificadas: 0, total: 0 };
    if (bonificada) p.bonificadas += Number(v.cantidad) || 0;
    else { p.unidades += Number(v.cantidad) || 0; p.total += Number(v.total) || 0; }
    porProd.set(nombre, p);
  }
  const items = [...porProd.values()]
    .map((p) => ({ ...p, total: redondear(p.total) }))
    .sort((a, b) => b.total - a.total || b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, "es"));
  const productos = {
    items,
    unidades: items.reduce((a, p) => a + p.unidades, 0),
    bonificadas: items.reduce((a, p) => a + p.bonificadas, 0),
    facturacion: resumen.ingresosProductos,
  };

  const vigentes = datos.movimientos.filter(movimientoVigente);
  const nombreCat = (m: MovimientoInforme) => (m.categoria_nombre || "").trim() || "Sin categoría";
  const porCategoria = (lista: MovimientoInforme[]) => agrupar(lista, nombreCat, (k) => k, (m) => Number(m.monto) || 0);

  return {
    resumen,
    egresos,
    margen,
    ingresosPorMetodo,
    turnos,
    productos,
    costosPorCategoria: porCategoria(vigentes.filter(esCosto)),
    gastosPorCategoria: porCategoria(vigentes.filter((m) => !esCosto(m))),
    egresosPorMedio: agrupar(vigentes, (m) => m.medio_pago, etiquetaMedioEgreso, (m) => Number(m.monto) || 0),
  };
}

// Lógica pura del módulo Códigos para Empresas (campañas prepagas). Sin
// dependencias de servidor: la usan las APIs, el admin, los informes y los tests.
// Dominio SEPARADO de codigos_descuento (promocionales).

export type Modalidad = "unica" | "mensual";

// Vigencia por modalidad: compra única 60 días, pack mensual 30 días (§6, §36-37).
export const VIGENCIA_DIAS: Record<Modalidad, number> = { unica: 60, mensual: 30 };
export function vigenciaDias(modalidad: string): number {
  return modalidad === "mensual" ? VIGENCIA_DIAS.mensual : VIGENCIA_DIAS.unica;
}

// ── Fechas (día calendario exacto, sin corrimiento por zona horaria) ──────────
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function diaIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}
function isoDeIndex(idx: number): string {
  const d = new Date(idx * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function sumarDias(fechaIso: string, dias: number): string {
  return isoDeIndex(diaIndex(fechaIso) + dias);
}
// Vencimiento = fecha_inicio + vigencia(modalidad). null si la fecha es inválida.
export function calcularVencimiento(fechaInicio: string | null | undefined, modalidad: string): string | null {
  if (!fechaInicio || !FECHA_RE.test(fechaInicio.slice(0, 10))) return null;
  return sumarDias(fechaInicio.slice(0, 10), vigenciaDias(modalidad));
}
// La fecha de inicio no puede ser más de 30 días después del pago (§4).
export function inicioValido(fechaPago: string | null | undefined, fechaInicio: string | null | undefined): boolean {
  if (!fechaInicio || !FECHA_RE.test(fechaInicio.slice(0, 10))) return false;
  if (!fechaPago || !FECHA_RE.test(fechaPago.slice(0, 10))) return true; // sin pago aún, no se restringe acá
  const diff = diaIndex(fechaInicio.slice(0, 10)) - diaIndex(fechaPago.slice(0, 10));
  return diff >= 0 && diff <= 30;
}

// ── IVA / precios ─────────────────────────────────────────────────────────────
export function ivaDesglose(neto: number, ivaPorcentaje: number): { neto: number; iva: number; total: number } {
  const n = Number.isFinite(neto) ? neto : 0;
  const p = Number.isFinite(ivaPorcentaje) ? ivaPorcentaje : 0;
  const iva = Math.round(n * (p / 100) * 100) / 100;
  return { neto: n, iva, total: Math.round((n + iva) * 100) / 100 };
}

// ── Estados ───────────────────────────────────────────────────────────────────
export type EstadoEfectivo =
  | "borrador" | "pendiente_pago" | "programada" | "activa" | "vencida" | "finalizada" | "cancelada";

export type CampaniaEstadoInput = {
  estado?: string | null;
  estado_pago?: string | null;
  fecha_inicio?: string | null;
  fecha_vencimiento?: string | null;
  deleted_at?: string | null;
};

// Estado EFECTIVO de una campaña respecto de `hoy` (YYYY-MM-DD). Es la fuente de
// verdad para "¿se puede canjear?" (solo cuando es 'activa'). El RPC de canje
// replica estas reglas en SQL.
export function estadoEfectivo(c: CampaniaEstadoInput, hoy: string): EstadoEfectivo {
  if (c.deleted_at) return "cancelada";
  if (c.estado === "cancelada") return "cancelada";
  if (c.estado === "borrador") return "borrador";
  if (c.estado_pago !== "pagado") return "pendiente_pago";
  if (!c.fecha_inicio || diaIndex(c.fecha_inicio.slice(0, 10)) > diaIndex(hoy)) return "programada";
  if (c.fecha_vencimiento && diaIndex(c.fecha_vencimiento.slice(0, 10)) < diaIndex(hoy)) return "vencida";
  if (c.estado === "finalizada") return "finalizada";
  return "activa";
}
export function puedeCanjear(c: CampaniaEstadoInput, hoy: string): boolean {
  return estadoEfectivo(c, hoy) === "activa";
}

// Estado EFECTIVO de un código, considerando el vencimiento de su campaña.
export type CodigoInput = { estado?: string | null; usos_actuales?: number; usos_maximos?: number };
export function estadoCodigoEfectivo(cod: CodigoInput, estadoCampania: EstadoEfectivo): string {
  if (cod.estado === "utilizado" || cod.estado === "cancelado" || cod.estado === "bloqueado") return cod.estado!;
  if (estadoCampania === "vencida" || estadoCampania === "cancelada") return "vencido";
  return "disponible";
}

// ── Métricas de campaña (derivadas de datos reales) ──────────────────────────
export type MetricasInput = {
  campania: CampaniaEstadoInput & { cantidad_contratada?: number; duracion_minutos?: number };
  codigos: CodigoInput[];
  usos: unknown[];
  hoy: string;
};
export function metricasCampania({ campania, codigos, usos, hoy }: MetricasInput) {
  const est = estadoEfectivo(campania, hoy);
  let disponibles = 0, utilizados = 0, vencidos = 0, cancelados = 0;
  for (const c of codigos) {
    const e = estadoCodigoEfectivo(c, est);
    if (e === "utilizado") utilizados++;
    else if (e === "vencido") vencidos++;
    else if (e === "cancelado" || e === "bloqueado") cancelados++;
    else disponibles++;
  }
  const generados = codigos.length;
  const contratados = Number(campania.cantidad_contratada) || 0;
  const duracion = Number(campania.duracion_minutos) || 0;
  const usados = usos.length; // canjes reales
  const pctUtilizacion = generados > 0 ? Math.round((utilizados / generados) * 1000) / 10 : 0;
  return {
    estado: est,
    generados,
    disponibles,
    utilizados,
    vencidos,
    cancelados,
    usados,
    pctUtilizacion,
    turnos_contratados: contratados,
    turnos_utilizados: usados,
    turnos_restantes: Math.max(0, contratados - usados),
    minutos_contratados: contratados * duracion,
    minutos_utilizados: usados * duracion,
    minutos_restantes: Math.max(0, (contratados - usados) * duracion),
  };
}

// ── Generación de códigos (cripto-segura, no secuencial) ─────────────────────
// Alfabeto sin caracteres ambiguos (0/O, 1/I). El formateo es puro y testeable;
// los bytes aleatorios los provee el servidor (crypto.randomBytes).
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function formatearCodigo(bytes: Uint8Array, largo = 10, prefijo = "EMP"): string {
  let s = "";
  for (let i = 0; i < largo; i++) s += ALFABETO[bytes[i % bytes.length] % ALFABETO.length];
  return `${prefijo}-${s.slice(0, 4)}-${s.slice(4, largo)}`;
}

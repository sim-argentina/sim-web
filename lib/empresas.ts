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

// ── Cupo y códigos (B8) ──────────────────────────────────────────────────────
// El cupo de una campaña son sus EXPERIENCIAS contratadas (cantidad_contratada):
// cada simulador reservado en un canje consume una. Dos formas de emitirlas:
//   · código común: UN código para todas las tarjetas del pack, con
//     usos_maximos = cantidad_contratada;
//   · códigos individuales: cantidad_contratada códigos de un uso cada uno.
// usos_por_codigo > 1 sin código común multiplicaba el cupo (N códigos × M usos)
// y ya no se acepta en campañas nuevas.
export type PlanCodigosInput = { codigo_comun?: boolean | null; cantidad_contratada?: number; usos_por_codigo?: number };
export function planDeCodigos(c: PlanCodigosInput): { codigos: number; usosPorCodigo: number } {
  const cantidad = Math.max(0, Math.trunc(Number(c.cantidad_contratada) || 0));
  if (c.codigo_comun === true) return { codigos: cantidad > 0 ? 1 : 0, usosPorCodigo: cantidad };
  return { codigos: cantidad, usosPorCodigo: Math.max(1, Math.trunc(Number(c.usos_por_codigo) || 1)) };
}
export const MENSAJE_USOS_POR_CODIGO =
  "Con códigos individuales cada código es una experiencia (1 uso). Para que todas las tarjetas del pack compartan un código, marcá «Código común».";
export function errorConfiguracionCupo(c: PlanCodigosInput): string | null {
  if (c.codigo_comun !== true && Math.trunc(Number(c.usos_por_codigo) || 1) !== 1) return MENSAJE_USOS_POR_CODIGO;
  return null;
}
// Un pack con código común se activa al ENTREGAR las tarjetas con el 100% cobrado: su
// fecha de inicio (desde la que corren los 60 días) se carga recién con la campaña
// pagada. Así el código, que existe antes para imprimir las tarjetas, no queda
// habilitado por una fecha cargada de antemano.
export const MENSAJE_INICIO_PACK =
  "En un pack con código común, la fecha de inicio es la de la entrega de las tarjetas: se carga con la campaña pagada (100% cobrado).";
export function errorInicioPack(c: { codigo_comun?: boolean | null; fecha_inicio?: string | null; estado_pago?: string | null }): string | null {
  if (c.codigo_comun === true && c.fecha_inicio && c.estado_pago !== "pagado") return MENSAJE_INICIO_PACK;
  return null;
}

// ── Métricas de campaña (derivadas de datos reales) ──────────────────────────
export type MetricasInput = {
  campania: CampaniaEstadoInput & { cantidad_contratada?: number; duracion_minutos?: number };
  codigos: CodigoInput[];
  // Canjes. Cada uno consumió `experiencias` (una por simulador; sin el dato, 1) y las
  // sigue descontando del cupo mientras no se libere:
  //   · reserva vigente → usadas;
  //   · reserva cancelada SIN liberar (el uso sigue 'consumido') → usadas y, además,
  //     «retenidas»: descuentan cupo aunque nadie vaya a usarlas;
  //   · reserva cancelada liberando el código (el uso pasa a 'cancelado') → no cuenta.
  // Para separar las retenidas, el uso trae su reserva (`reserva.estado`).
  usos: unknown[];
  hoy: string;
};
type UsoLectura = { estado?: unknown; experiencias?: unknown; reserva?: { estado?: unknown } | null } | null | undefined;
export const experienciasDeUso = (u: unknown): number => {
  const x = u as UsoLectura;
  if (x?.estado === "cancelado") return 0;
  const n = Math.trunc(Number(x?.experiencias));
  return n >= 1 ? n : 1;
};
/** Experiencias que un canje descuenta del cupo con su reserva ya cancelada sin liberar. */
export const experienciasRetenidasDeUso = (u: unknown): number =>
  (u as UsoLectura)?.reserva?.estado === "cancelada" ? experienciasDeUso(u) : 0;
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
  // Experiencias descontadas del cupo: reservas vigentes + canceladas sin liberar.
  const usados = usos.reduce<number>((s, u) => s + experienciasDeUso(u), 0);
  const retenidos = usos.reduce<number>((s, u) => s + experienciasRetenidasDeUso(u), 0);
  // Sobre las experiencias contratadas, no sobre códigos agotados: con un código
  // común, «1 de 1 código» no dice cuántas tarjetas se usaron.
  const pctUtilizacion = contratados > 0 ? Math.round((usados / contratados) * 1000) / 10 : 0;
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
    // De las utilizadas, las que retiene una reserva cancelada sin liberar el código.
    turnos_retenidos: retenidos,
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

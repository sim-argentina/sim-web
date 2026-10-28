// ============================================================================
// Dashboard del Stand (Métricas → Stand). FUENTE ÚNICA de cada métrica.
// ----------------------------------------------------------------------------
// Módulo PURO: sin base, sin red, sin reloj propio (el "ahora" se pasa). Lo usan
// la API del resumen, la API del detalle paginado, la página y las pruebas. Una
// tarjeta, su gráfico, su comparación y su detalle salen de las MISMAS funciones,
// así que no pueden dar números distintos.
//
// DEFINICIONES
//   · Operación: una fila del Turnero (turnos_stand) o de un Excel histórico
//     (turnos_historicos), deduplicada como siempre (crearHashTurno) y sin las
//     anuladas/canceladas. Una operación puede tener varias personas.
//   · Cortesía: operación con medio "gratis" o importe 0. No es venta comercial.
//   · Venta comercial: operación que no es cortesía.
//   · Facturación comercial: Σ importe de las ventas comerciales. Para el Turnero
//     coincide al peso con la fuente `turnero` de fin_eventos_facturacion
//     (Σ total = Σ pagos_detalle). No es rentabilidad: no descuenta costos.
//   · Personas registradas: Σ personas de las operaciones. NO son clientes únicos
//     (una persona que vuelve cuenta dos veces; no hay identificación fiable).
//   · Personas con subida confirmada: Σ personas de operaciones con hora de subida.
//   · Ticket promedio: facturación comercial / ventas comerciales.
//   · Ingreso por persona: facturación comercial / personas de ventas comerciales.
//   · Duración comprada: minutos por persona de la operación (Turnero:
//     cantidad_minutos; Excel: "Tiempo (Min)"). 10/15/20/30 son las duraciones
//     del catálogo (15/30 hasta el 30/09/2026, 10/20/30 desde el 01/10/2026);
//     cualquier otra es "Otra" y la ausencia es "Sin dato".
//   · Duración promedio por persona: Σ(minutos × personas) / Σ personas con dato.
//   · Momento de VENTA = hora de toma del turno. Momento de SUBIDA = hora de subida.
//   · Espera: subida − toma, en minutos. Válida entre 0 y 240; fuera de ese rango
//     (subida anterior a la toma o lapso inverosímil) se excluye y se informa.
//
// LO QUE NO SE CALCULA (no es defendible con los datos de hoy)
//   · Duración realizada: el Turnero guarda la bajada como subida + duración
//     comprada (coincide en el 100 % de los registros), no la mide.
//   · Ocupación: no hay capacidad disponible ni horarios de apertura registrados.
// ============================================================================

import { crearHashTurno, normalizarMetodoPago, normalizeText } from "@/lib/historicosStand";
import { ZONA_SIM } from "@/lib/agenda";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type ClaseDuracion = "10" | "15" | "20" | "30" | "otra" | "sin_dato";
export const CLASES_DURACION: readonly ClaseDuracion[] = ["10", "15", "20", "30", "otra", "sin_dato"];
export const ETIQUETA_DURACION: Record<ClaseDuracion, string> = {
  "10": "10 min",
  "15": "15 min",
  "20": "20 min",
  "30": "30 min",
  otra: "Otra duración",
  sin_dato: "Sin dato",
};

/** Lunes = 0 … domingo = 6 (semana argentina). */
export const DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
export const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

export type Fuente = "turnero" | "excel";
export type Pago = { metodo: string; monto: number };

export type OperacionStand = {
  /** "t:<id>" (Turnero) o "x:<id>" (Excel). */
  id: string;
  fuente: Fuente;
  idOrigen: number;
  fecha: string;
  /** Lunes = 0 … domingo = 6. */
  diaSemana: number;
  /** Minutos desde la medianoche, o null si no hay hora válida. */
  horaVenta: number | null;
  horaSubida: number | null;
  horaEstimada: number | null;
  personas: number;
  minutosPorPersona: number | null;
  clase: ClaseDuracion;
  modalidad: "legacy" | "v2_10";
  importe: number;
  cortesia: boolean;
  /** Medios canónicos (normalizarMetodoPago). Un pago mixto trae varios. */
  pagos: Pago[];
  cliente: string | null;
  archivo: string | null;
};

// ── Fechas y horas ───────────────────────────────────────────────────────────

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function esFecha(v: unknown): v is string {
  if (typeof v !== "string" || !FECHA_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function aUTC(fecha: string) {
  const [y, m, d] = fecha.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function deUTC(ms: number) {
  const r = new Date(ms);
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

export function sumarDiasFecha(fecha: string, dias: number) {
  return deUTC(aUTC(fecha) + dias * 86_400_000);
}

/** Días entre dos fechas, ambas incluidas. */
export function diasEntre(desde: string, hasta: string) {
  return Math.round((aUTC(hasta) - aUTC(desde)) / 86_400_000) + 1;
}

/** Lunes = 0 … domingo = 6. */
export function diaSemanaDe(fecha: string) {
  return (new Date(aUTC(fecha)).getUTCDay() + 6) % 7;
}

/** Minuto del día en la hora de SIM (Argentina) para el instante dado. */
export function minutoEnSim(ahora: Date): number {
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_SIM, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ahora);
  const h = Number(partes.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(partes.find((x) => x.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** "HH:MM" (o "H:MM", con segundos opcionales) → minutos desde la medianoche. */
export function minutosDeHora(valor: unknown): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(valor ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function horaTexto(minutos: number | null) {
  if (minutos == null) return null;
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

/** Cuántos lunes, martes… hay entre dos fechas (ambas incluidas). */
export function ocurrenciasDiaSemana(desde: string, hasta: string): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const n = diasEntre(desde, hasta);
  if (n <= 0) return out;
  const completas = Math.floor(n / 7);
  for (let i = 0; i < 7; i++) out[i] = completas;
  const primero = diaSemanaDe(desde);
  for (let i = 0; i < n % 7; i++) out[(primero + i) % 7] += 1;
  return out;
}

// ── Normalización de filas ───────────────────────────────────────────────────

function claseDe(minutos: number | null): ClaseDuracion {
  if (minutos == null || !(minutos > 0)) return "sin_dato";
  if (minutos === 10 || minutos === 15 || minutos === 20 || minutos === 30) return String(minutos) as ClaseDuracion;
  return "otra";
}

function numero(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function esAnulada(estado: unknown) {
  const e = normalizeText(estado);
  return e === "anulado" || e === "cancelado";
}

export type FilaTurnero = {
  id: number;
  fecha: string;
  hora?: string | null;
  hora_subida?: string | null;
  hora_estimada_subida?: string | null;
  cantidad_personas?: number | null;
  cantidad_simuladores?: number | null;
  cantidad_minutos?: number | null;
  cantidad_turnos?: number | null;
  total?: number | string | null;
  metodo_pago?: string | null;
  pagos_detalle?: unknown;
  estado?: string | null;
  modalidad?: string | null;
  nombre?: string | null;
};

export type FilaExcel = {
  id: number;
  fecha: string;
  archivo_key?: string | null;
  archivo_nombre?: string | null;
  hora_tomado?: string | null;
  hora_subida?: string | null;
  hora_bajada?: string | null;
  metodo_pago?: string | null;
  total?: number | string | null;
  cantidad_simuladores?: number | null;
  cantidad_turnos?: number | null;
  duracion?: number | null;
  escuderia?: string | null;
  origen?: string | null;
};

function pagosDeTurnero(f: FilaTurnero, importe: number): Pago[] {
  const det = Array.isArray(f.pagos_detalle) ? (f.pagos_detalle as Record<string, unknown>[]) : [];
  if (det.length > 0) {
    return det.map((p) => ({ metodo: normalizarMetodoPago(p?.metodo_pago) || "SIN DATO", monto: numero(p?.monto) }));
  }
  return [{ metodo: normalizarMetodoPago(f.metodo_pago) || "SIN DATO", monto: importe }];
}

export function operacionDeTurnero(f: FilaTurnero): OperacionStand {
  const importe = numero(f.total);
  const minutos = numero(f.cantidad_minutos) > 0 ? numero(f.cantidad_minutos) : null;
  const metodo = normalizarMetodoPago(f.metodo_pago);
  return {
    id: `t:${f.id}`,
    fuente: "turnero",
    idOrigen: f.id,
    fecha: f.fecha,
    diaSemana: diaSemanaDe(f.fecha),
    horaVenta: minutosDeHora(f.hora),
    horaSubida: minutosDeHora(f.hora_subida),
    horaEstimada: minutosDeHora(f.hora_estimada_subida),
    personas: numero(f.cantidad_personas) || numero(f.cantidad_simuladores) || 1,
    minutosPorPersona: minutos,
    clase: claseDe(minutos),
    modalidad: f.modalidad === "v2_10" ? "v2_10" : "legacy",
    importe,
    cortesia: metodo === "GRATIS" || importe <= 0,
    pagos: pagosDeTurnero(f, importe),
    cliente: f.nombre?.trim() || null,
    archivo: null,
  };
}

export function operacionDeExcel(f: FilaExcel): OperacionStand {
  const importe = numero(f.total);
  const minutos = numero(f.duracion) > 0 ? numero(f.duracion) : null;
  const metodo = normalizarMetodoPago(f.metodo_pago);
  return {
    id: `x:${f.id}`,
    fuente: "excel",
    idOrigen: f.id,
    fecha: f.fecha,
    diaSemana: diaSemanaDe(f.fecha),
    horaVenta: minutosDeHora(f.hora_tomado),
    horaSubida: minutosDeHora(f.hora_subida),
    horaEstimada: null,
    personas: numero(f.cantidad_simuladores) || 1,
    minutosPorPersona: minutos,
    clase: claseDe(minutos),
    modalidad: "legacy",
    importe,
    cortesia: metodo === "GRATIS" || importe <= 0,
    pagos: [{ metodo: metodo || "SIN DATO", monto: importe }],
    cliente: null,
    archivo: f.archivo_nombre ?? null,
  };
}

/**
 * Turnero + Excel → operaciones, con la MISMA deduplicación que usaba la página
 * (crearHashTurno: filas del Turnero por id, Excel por contenido) y sin anuladas.
 */
export function operacionesDeFilas(turnero: FilaTurnero[], excel: FilaExcel[]): OperacionStand[] {
  const vistos = new Set<string>();
  const out: OperacionStand[] = [];
  for (const f of turnero) {
    if (!esFecha(f.fecha) || esAnulada(f.estado)) continue;
    const clave = crearHashTurno({ ...f, origen: "turnero" });
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(operacionDeTurnero(f));
  }
  for (const f of excel) {
    if (!esFecha(f.fecha)) continue;
    const clave = crearHashTurno({ ...f, origen: "excel" }, f.archivo_key ?? "");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(operacionDeExcel(f));
  }
  return out;
}

// ── Criterios (filtros del dashboard y selección del detalle) ────────────────

export type Tipo = "todas" | "comerciales" | "cortesias";

export type Criterios = {
  duraciones?: ClaseDuracion[];
  /** Lunes = 0 … domingo = 6. */
  dias?: number[];
  /** Hora (0–23) del momento de VENTA. */
  horas?: number[];
  /** Hora (0–23) del momento de SUBIDA. */
  horasSubida?: number[];
  tipo?: Tipo;
  fuente?: "todas" | Fuente;
  // ── Solo para el detalle (no filtran el dashboard) ──
  fecha?: string;
  /** Subrango de fechas dentro del período (una semana o un mes del gráfico de evolución). */
  fechaDesde?: string;
  fechaHasta?: string;
  /** Tamaño del grupo; 4 = 4 o más personas. */
  grupo?: number;
  medio?: string;
  conSubida?: boolean;
  /** Operaciones con espera válida ≥ este valor (minutos). */
  esperaMin?: number;
  /** …y < este valor (tramo del histograma). */
  esperaMax?: number;
  /** Una operación puntual ("t:123" o "x:456"). */
  id?: string;
  /** Criterios contradictorios (p. ej. filtro 20 min y selección 30 min): ninguna operación. */
  nada?: boolean;
};

const vacio = <T,>(a: T[] | undefined): a is undefined => !a || a.length === 0;

export function cumple(op: OperacionStand, c: Criterios): boolean {
  if (c.nada) return false;
  if (!vacio(c.duraciones) && !c.duraciones!.includes(op.clase)) return false;
  if (!vacio(c.dias) && !c.dias!.includes(op.diaSemana)) return false;
  if (!vacio(c.horas) && (op.horaVenta == null || !c.horas!.includes(Math.floor(op.horaVenta / 60)))) return false;
  if (!vacio(c.horasSubida) && (op.horaSubida == null || !c.horasSubida!.includes(Math.floor(op.horaSubida / 60)))) return false;
  if (c.tipo === "comerciales" && op.cortesia) return false;
  if (c.tipo === "cortesias" && !op.cortesia) return false;
  if (c.fuente && c.fuente !== "todas" && op.fuente !== c.fuente) return false;
  if (c.fecha && op.fecha !== c.fecha) return false;
  if (c.fechaDesde && op.fecha < c.fechaDesde) return false;
  if (c.fechaHasta && op.fecha > c.fechaHasta) return false;
  if (c.grupo != null && (c.grupo >= 4 ? op.personas < 4 : op.personas !== c.grupo)) return false;
  if (c.medio && !op.pagos.some((p) => p.metodo === c.medio)) return false;
  if (c.conSubida === true && op.horaSubida == null) return false;
  if (c.conSubida === false && op.horaSubida != null) return false;
  if (c.esperaMin != null || c.esperaMax != null) {
    const e = esperaDe(op);
    if (e == null) return false;
    if (c.esperaMin != null && e < c.esperaMin) return false;
    if (c.esperaMax != null && e >= c.esperaMax) return false;
  }
  if (c.id && op.id !== c.id) return false;
  return true;
}

export function filtrar(ops: OperacionStand[], c: Criterios) {
  return ops.filter((o) => cumple(o, c));
}

export const ESPERA_MAXIMA_VALIDA = 240;

/** Espera válida entre toma y subida, o null (sin dato o fuera de rango). */
export function esperaDe(op: OperacionStand): number | null {
  if (op.horaVenta == null || op.horaSubida == null) return null;
  const e = op.horaSubida - op.horaVenta;
  return e >= 0 && e <= ESPERA_MAXIMA_VALIDA ? e : null;
}

// ── Rangos y comparación ─────────────────────────────────────────────────────

export type Preset = "hoy" | "ayer" | "7d" | "30d" | "semana" | "mes" | "mes_anterior" | "anio" | "todo" | "personalizado";
export type ModoComparacion = "anterior" | "anio" | "ninguna";

export type Rango = {
  desde: string;
  hasta: string;
  /** El período incluye hoy y todavía no terminó. */
  incompleto: boolean;
  /**
   * Minuto del día (hora argentina) hasta el que se cuenta el ÚLTIMO día, o null
   * (día completo). Solo lo usa el período de comparación: el actual cuenta todo
   * lo registrado hasta ahora, así que coincide con Finanzas.
   */
  corteMinuto: number | null;
  /** Minuto actual cuando el período está en curso (para el corte de la comparación). */
  minutoAhora: number | null;
};

/** Primera fecha que puede tener datos del Stand (Excel históricos desde oct-2025). */
export const FECHA_MINIMA = "2025-01-01";

function primeroDeMes(f: string) {
  return `${f.slice(0, 8)}01`;
}

function ultimoDeMes(f: string) {
  const [y, m] = f.split("-").map(Number);
  return deUTC(Date.UTC(y, m, 0));
}

function menosUnAnio(f: string) {
  const [y, m, d] = f.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

function menosUnMes(f: string) {
  const [y, m, d] = f.split("-").map(Number);
  const yy = m === 1 ? y - 1 : y;
  const mm = m === 1 ? 12 : m - 1;
  const ultimo = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

/** El período cubre hasta hoy: incompleto, con el corte en el minuto actual. */
function cerrar(desde: string, hasta: string, hoy: string, minutoAhora: number): Rango {
  const h = hasta > hoy ? hoy : hasta;
  const incompleto = h === hoy;
  return { desde, hasta: h, incompleto, corteMinuto: null, minutoAhora: incompleto ? minutoAhora : null };
}

export function rangoDePreset(preset: Preset, hoy: string, minutoAhora: number, personalizado?: { desde: string; hasta: string }): Rango {
  switch (preset) {
    case "hoy":
      return cerrar(hoy, hoy, hoy, minutoAhora);
    case "ayer": {
      const a = sumarDiasFecha(hoy, -1);
      return cerrar(a, a, hoy, minutoAhora);
    }
    case "7d":
      return cerrar(sumarDiasFecha(hoy, -6), hoy, hoy, minutoAhora);
    case "30d":
      return cerrar(sumarDiasFecha(hoy, -29), hoy, hoy, minutoAhora);
    case "semana":
      return cerrar(sumarDiasFecha(hoy, -diaSemanaDe(hoy)), hoy, hoy, minutoAhora);
    case "mes":
      return cerrar(primeroDeMes(hoy), hoy, hoy, minutoAhora);
    case "mes_anterior": {
      const ref = menosUnMes(primeroDeMes(hoy));
      return cerrar(ref, ultimoDeMes(ref), hoy, minutoAhora);
    }
    case "anio":
      return cerrar(`${hoy.slice(0, 4)}-01-01`, hoy, hoy, minutoAhora);
    case "todo":
      return cerrar(FECHA_MINIMA, hoy, hoy, minutoAhora);
    case "personalizado": {
      const d = personalizado && esFecha(personalizado.desde) ? personalizado.desde : primeroDeMes(hoy);
      let h = personalizado && esFecha(personalizado.hasta) ? personalizado.hasta : hoy;
      if (h < d) h = d;
      return cerrar(d, h, hoy, minutoAhora);
    }
  }
}

/**
 * Período de comparación EQUIVALENTE:
 *   · "anterior": meses calendario contra el mes anterior (un mes en curso,
 *     contra los mismos días del mes anterior); semanas contra la semana anterior;
 *     cualquier otro rango, contra los mismos días inmediatamente anteriores;
 *   · "anio": las mismas fechas un año antes.
 * Si el período actual está en curso, el último día de la comparación se corta en
 * el mismo minuto (corte equivalente). Un mes en curso nunca se compara con un
 * mes completo.
 */
export function rangoComparacion(actual: Rango, preset: Preset, modo: ModoComparacion): Rango | null {
  if (modo === "ninguna" || preset === "todo") return null;
  const corte = actual.incompleto ? actual.minutoAhora : null;
  if (modo === "anio") {
    return { desde: menosUnAnio(actual.desde), hasta: menosUnAnio(actual.hasta), incompleto: false, corteMinuto: corte, minutoAhora: null };
  }
  const esMes =
    (preset === "mes" || preset === "mes_anterior") && actual.desde === primeroDeMes(actual.desde);
  if (esMes) {
    const desde = menosUnMes(actual.desde);
    const completo = actual.hasta === ultimoDeMes(actual.hasta);
    const hasta = completo ? ultimoDeMes(desde) : menosUnMes(actual.hasta);
    return { desde, hasta, incompleto: false, corteMinuto: completo ? null : corte, minutoAhora: null };
  }
  if (preset === "anio") {
    return { desde: menosUnAnio(actual.desde), hasta: menosUnAnio(actual.hasta), incompleto: false, corteMinuto: corte, minutoAhora: null };
  }
  // Una semana (de lunes a hoy) se compara con los mismos días de la semana anterior.
  const n = preset === "semana" ? 7 : diasEntre(actual.desde, actual.hasta);
  return { desde: sumarDiasFecha(actual.desde, -n), hasta: sumarDiasFecha(actual.hasta, -n), incompleto: false, corteMinuto: corte, minutoAhora: null };
}

/** Operaciones del rango, con el corte del último día si corresponde. */
export function enRango(ops: OperacionStand[], r: Rango): OperacionStand[] {
  return ops.filter((o) => {
    if (o.fecha < r.desde || o.fecha > r.hasta) return false;
    if (r.corteMinuto != null && o.fecha === r.hasta) {
      return o.horaVenta != null && o.horaVenta <= r.corteMinuto;
    }
    return true;
  });
}

// ── Agregación ───────────────────────────────────────────────────────────────

export type Totales = {
  operaciones: number;
  ventas: number;
  cortesias: number;
  facturacion: number;
  personas: number;
  personasComerciales: number;
  personasCortesia: number;
  personasConSubida: number;
  operacionesConSubida: number;
  /** Σ minutos × personas de las operaciones con duración conocida. */
  minutosPersona: number;
  personasConDuracion: number;
  ticketPromedio: number | null;
  ingresoPorPersona: number | null;
  personasPorOperacion: number | null;
  duracionPromedioPersona: number | null;
  /** Facturación comercial / minutos-persona comerciales con duración conocida. */
  ingresoPorMinuto: number | null;
};

export function totalesDe(ops: OperacionStand[]): Totales {
  let ventas = 0, cortesias = 0, facturacion = 0, personas = 0, personasComerciales = 0, personasCortesia = 0;
  let personasConSubida = 0, operacionesConSubida = 0, minutosPersona = 0, personasConDuracion = 0, minutosComerciales = 0, facturacionConDuracion = 0;
  for (const o of ops) {
    personas += o.personas;
    if (o.cortesia) {
      cortesias += 1;
      personasCortesia += o.personas;
    } else {
      ventas += 1;
      facturacion += o.importe;
      personasComerciales += o.personas;
    }
    if (o.horaSubida != null) {
      operacionesConSubida += 1;
      personasConSubida += o.personas;
    }
    if (o.minutosPorPersona != null) {
      minutosPersona += o.minutosPorPersona * o.personas;
      personasConDuracion += o.personas;
      if (!o.cortesia) {
        minutosComerciales += o.minutosPorPersona * o.personas;
        facturacionConDuracion += o.importe;
      }
    }
  }
  return {
    operaciones: ops.length,
    ventas,
    cortesias,
    facturacion,
    personas,
    personasComerciales,
    personasCortesia,
    personasConSubida,
    operacionesConSubida,
    minutosPersona,
    personasConDuracion,
    ticketPromedio: ventas ? facturacion / ventas : null,
    ingresoPorPersona: personasComerciales ? facturacion / personasComerciales : null,
    personasPorOperacion: ops.length ? personas / ops.length : null,
    duracionPromedioPersona: personasConDuracion ? minutosPersona / personasConDuracion : null,
    ingresoPorMinuto: minutosComerciales ? facturacionConDuracion / minutosComerciales : null,
  };
}

export type Metricas3 = { operaciones: number; ventas: number; personas: number; facturacion: number };

function vacio3(): Metricas3 {
  return { operaciones: 0, ventas: 0, personas: 0, facturacion: 0 };
}

function sumar3(m: Metricas3, o: OperacionStand) {
  m.operaciones += 1;
  m.personas += o.personas;
  if (!o.cortesia) {
    m.ventas += 1;
    m.facturacion += o.importe;
  }
}

export type FilaDuracion = Metricas3 & {
  clase: ClaseDuracion;
  cortesias: number;
  minutosPersona: number;
  /** Participación sobre el total del período (0–1). */
  participacionPersonas: number;
  participacionVentas: number;
  participacionFacturacion: number;
  ticketPromedio: number | null;
};

export type FilaGrupo = Metricas3 & { grupo: number; participacionOperaciones: number };

export type DiaSerie = Metricas3 & { fecha: string; cortesias: number };

export type CeldaCalor = Metricas3 & { dia: number; hora: number };

export type FilaDiaSemana = Metricas3 & {
  dia: number;
  /** Cuántas veces aparece ese día de la semana en el período. */
  ocurrencias: number;
};

export type FilaHora = Metricas3 & { hora: number };

export type FilaPago = { metodo: string; monto: number; operaciones: number; participacion: number };

export type EsperaTop = {
  id: string;
  fecha: string;
  horaVenta: string | null;
  horaSubida: string | null;
  espera: number;
  personas: number;
  conDemoraAnunciada: boolean;
};

export type Espera = {
  validas: number;
  sinDato: number;
  fueraDeRango: number;
  promedio: number | null;
  mediana: number | null;
  p90: number | null;
  maxima: number | null;
  /** Histograma de esperas válidas: [0–5), [5–10), [10–20), [20–30), [30–60), ≥ 60. */
  tramos: Array<{ desde: number; hasta: number | null; operaciones: number; personas: number }>;
  top: EsperaTop[];
  /** Operaciones con hora estimada de subida cargada (el personal anunció demora). */
  conDemoraAnunciada: { operaciones: number; promedioEspera: number | null };
};

export type Resumen = {
  rango: Rango;
  totales: Totales;
  duraciones: FilaDuracion[];
  grupos: FilaGrupo[];
  serie: DiaSerie[];
  calorVenta: CeldaCalor[];
  calorSubida: CeldaCalor[];
  diasSemana: FilaDiaSemana[];
  horasVenta: FilaHora[];
  pagos: FilaPago[];
  espera: Espera;
  cobertura: { operaciones: number; conHoraVenta: number; conHoraSubida: number; conDuracion: number; conEsperaValida: number };
  fuentes: { turnero: number; excel: number };
  modalidades: { legacy: number; v2_10: number };
};

export const TRAMOS_ESPERA: Array<[number, number | null]> = [[0, 5], [5, 10], [10, 20], [20, 30], [30, 60], [60, null]];

function percentil(ordenados: number[], p: number) {
  if (!ordenados.length) return null;
  const i = Math.ceil(p * ordenados.length) - 1;
  return ordenados[Math.min(Math.max(i, 0), ordenados.length - 1)];
}

function mediana(ordenados: number[]) {
  const n = ordenados.length;
  if (!n) return null;
  return n % 2 ? ordenados[(n - 1) / 2] : (ordenados[n / 2 - 1] + ordenados[n / 2]) / 2;
}

export function resumir(ops: OperacionStand[], rango: Rango, hoy: string): Resumen {
  const totales = totalesDe(ops);

  // Duraciones.
  const porClase = new Map<ClaseDuracion, FilaDuracion>();
  for (const c of CLASES_DURACION) {
    porClase.set(c, { clase: c, ...vacio3(), cortesias: 0, minutosPersona: 0, participacionPersonas: 0, participacionVentas: 0, participacionFacturacion: 0, ticketPromedio: null });
  }
  // Grupos (1, 2, 3, 4 o más), serie diaria, calor, días, horas, pagos.
  const grupos = [1, 2, 3, 4].map((g) => ({ grupo: g, ...vacio3(), participacionOperaciones: 0 }));
  const serie = new Map<string, DiaSerie>();
  for (let f = rango.desde; f <= rango.hasta; f = sumarDiasFecha(f, 1)) serie.set(f, { fecha: f, ...vacio3(), cortesias: 0 });
  const calorV = new Map<number, CeldaCalor>();
  const calorS = new Map<number, CeldaCalor>();
  const dias = DIAS_SEMANA.map((_, i) => ({ dia: i, ...vacio3(), ocurrencias: 0 }));
  const horas = new Map<number, FilaHora>();
  const pagos = new Map<string, FilaPago>();
  const esperas: Array<{ op: OperacionStand; e: number }> = [];
  let sinDatoEspera = 0, fueraDeRango = 0, conHoraVenta = 0, conDuracion = 0;
  let demoraOps = 0, demoraSuma = 0, demoraN = 0;
  let turnero = 0, excel = 0, legacy = 0, v2 = 0;

  for (const o of ops) {
    const fd = porClase.get(o.clase)!;
    sumar3(fd, o);
    if (o.cortesia) fd.cortesias += 1;
    if (o.minutosPorPersona != null) {
      fd.minutosPersona += o.minutosPorPersona * o.personas;
      conDuracion += 1;
    }
    sumar3(grupos[Math.min(o.personas, 4) - 1], o);

    const d = serie.get(o.fecha);
    if (d) {
      sumar3(d, o);
      if (o.cortesia) d.cortesias += 1;
    }
    if (o.horaVenta != null) {
      conHoraVenta += 1;
      const h = Math.floor(o.horaVenta / 60);
      const k = o.diaSemana * 24 + h;
      if (!calorV.has(k)) calorV.set(k, { dia: o.diaSemana, hora: h, ...vacio3() });
      sumar3(calorV.get(k)!, o);
      if (!horas.has(h)) horas.set(h, { hora: h, ...vacio3() });
      sumar3(horas.get(h)!, o);
    }
    if (o.horaSubida != null) {
      const h = Math.floor(o.horaSubida / 60);
      const k = o.diaSemana * 24 + h;
      if (!calorS.has(k)) calorS.set(k, { dia: o.diaSemana, hora: h, ...vacio3() });
      sumar3(calorS.get(k)!, o);
    }
    sumar3(dias[o.diaSemana], o);

    for (const p of o.pagos) {
      if (!pagos.has(p.metodo)) pagos.set(p.metodo, { metodo: p.metodo, monto: 0, operaciones: 0, participacion: 0 });
      const fp = pagos.get(p.metodo)!;
      fp.monto += p.monto;
      fp.operaciones += 1;
    }

    if (o.horaVenta == null || o.horaSubida == null) sinDatoEspera += 1;
    else {
      const e = esperaDe(o);
      if (e == null) fueraDeRango += 1;
      else esperas.push({ op: o, e });
    }
    if (o.horaEstimada != null) {
      demoraOps += 1;
      const e = esperaDe(o);
      if (e != null) {
        demoraSuma += e;
        demoraN += 1;
      }
    }
    if (o.fuente === "turnero") turnero += 1;
    else excel += 1;
    if (o.modalidad === "v2_10") v2 += 1;
    else legacy += 1;
  }

  const duraciones = [...porClase.values()]
    .filter((d) => d.operaciones > 0 || d.clase === "10" || d.clase === "15" || d.clase === "20" || d.clase === "30")
    .map((d) => ({
      ...d,
      participacionPersonas: totales.personas ? d.personas / totales.personas : 0,
      participacionVentas: totales.ventas ? d.ventas / totales.ventas : 0,
      participacionFacturacion: totales.facturacion ? d.facturacion / totales.facturacion : 0,
      ticketPromedio: d.ventas ? d.facturacion / d.ventas : null,
    }));

  const ocurr = ocurrenciasDiaSemana(rango.desde, rango.hasta > hoy ? hoy : rango.hasta);
  for (const d of dias) d.ocurrencias = ocurr[d.dia];

  const totalPagos = [...pagos.values()].reduce((s, p) => s + p.monto, 0);
  const listaPagos = [...pagos.values()]
    .map((p) => ({ ...p, participacion: totalPagos ? p.monto / totalPagos : 0 }))
    .sort((a, b) => b.monto - a.monto);

  const ordenadas = esperas.map((x) => x.e).sort((a, b) => a - b);
  const tramos = TRAMOS_ESPERA.map(([desde, hasta]) => ({ desde, hasta, operaciones: 0, personas: 0 }));
  for (const { op, e } of esperas) {
    const t = tramos.find((x) => e >= x.desde && (x.hasta == null || e < x.hasta))!;
    t.operaciones += 1;
    t.personas += op.personas;
  }
  const top = [...esperas]
    .sort((a, b) => b.e - a.e || (a.op.fecha < b.op.fecha ? 1 : -1))
    .slice(0, 10)
    .map(({ op, e }) => ({
      id: op.id,
      fecha: op.fecha,
      horaVenta: horaTexto(op.horaVenta),
      horaSubida: horaTexto(op.horaSubida),
      espera: e,
      personas: op.personas,
      conDemoraAnunciada: op.horaEstimada != null,
    }));

  return {
    rango,
    totales,
    duraciones,
    grupos: grupos.map((g) => ({ ...g, participacionOperaciones: totales.operaciones ? g.operaciones / totales.operaciones : 0 })),
    serie: [...serie.values()],
    calorVenta: [...calorV.values()],
    calorSubida: [...calorS.values()],
    diasSemana: dias,
    horasVenta: [...horas.values()].sort((a, b) => a.hora - b.hora),
    pagos: listaPagos,
    espera: {
      validas: ordenadas.length,
      sinDato: sinDatoEspera,
      fueraDeRango,
      promedio: ordenadas.length ? ordenadas.reduce((s, x) => s + x, 0) / ordenadas.length : null,
      mediana: mediana(ordenadas),
      p90: percentil(ordenadas, 0.9),
      maxima: ordenadas.length ? ordenadas[ordenadas.length - 1] : null,
      tramos,
      top,
      conDemoraAnunciada: { operaciones: demoraOps, promedioEspera: demoraN ? demoraSuma / demoraN : null },
    },
    cobertura: { operaciones: ops.length, conHoraVenta, conHoraSubida: totales.operacionesConSubida, conDuracion, conEsperaValida: ordenadas.length },
    fuentes: { turnero, excel },
    modalidades: { legacy, v2_10: v2 },
  };
}

// ── Comparación y lectura del período ────────────────────────────────────────

export type Variacion = { actual: number | null; anterior: number | null; diferencia: number | null; porcentaje: number | null };

export function variacion(actual: number | null, anterior: number | null): Variacion {
  if (actual == null || anterior == null) return { actual, anterior, diferencia: null, porcentaje: null };
  return { actual, anterior, diferencia: actual - anterior, porcentaje: anterior !== 0 ? (actual - anterior) / anterior : null };
}

export type Comparacion = {
  facturacion: Variacion;
  ventas: Variacion;
  cortesias: Variacion;
  personas: Variacion;
  personasConSubida: Variacion;
  ticketPromedio: Variacion;
  ingresoPorPersona: Variacion;
  personasPorOperacion: Variacion;
  duracionPromedioPersona: Variacion;
  medianaEspera: Variacion;
  /**
   * Descomposición EXACTA de la variación de facturación (F = V × T):
   *   ΔF = (V₁ − V₀) · T₀  +  V₁ · (T₁ − T₀)
   * efecto de la cantidad de ventas + efecto del ticket promedio.
   */
  efectoVentas: number | null;
  efectoTicket: number | null;
  /** Cambio de participación de personas por duración, en puntos porcentuales. */
  participacionDuracion: Array<{ clase: ClaseDuracion; actual: number; anterior: number; puntos: number }>;
  /** El cambio de modalidad (15/30 → 10/20/30) cruza los dos períodos. */
  modalidadesDistintas: boolean;
};

export function comparar(a: Resumen, b: Resumen): Comparacion {
  const ta = a.totales, tb = b.totales;
  const clases = new Set<ClaseDuracion>([...a.duraciones, ...b.duraciones].filter((d) => d.personas > 0).map((d) => d.clase));
  const part = (r: Resumen, c: ClaseDuracion) => r.duraciones.find((d) => d.clase === c)?.participacionPersonas ?? 0;
  const domina = (r: Resumen) => (r.modalidades.v2_10 >= r.modalidades.legacy ? "v2_10" : "legacy");
  const hay = (r: Resumen) => r.totales.operaciones > 0;
  return {
    facturacion: variacion(ta.facturacion, tb.facturacion),
    ventas: variacion(ta.ventas, tb.ventas),
    cortesias: variacion(ta.cortesias, tb.cortesias),
    personas: variacion(ta.personas, tb.personas),
    personasConSubida: variacion(ta.personasConSubida, tb.personasConSubida),
    ticketPromedio: variacion(ta.ticketPromedio, tb.ticketPromedio),
    ingresoPorPersona: variacion(ta.ingresoPorPersona, tb.ingresoPorPersona),
    personasPorOperacion: variacion(ta.personasPorOperacion, tb.personasPorOperacion),
    duracionPromedioPersona: variacion(ta.duracionPromedioPersona, tb.duracionPromedioPersona),
    medianaEspera: variacion(a.espera.mediana, b.espera.mediana),
    efectoVentas: ta.ticketPromedio != null && tb.ticketPromedio != null ? (ta.ventas - tb.ventas) * tb.ticketPromedio : null,
    efectoTicket: ta.ticketPromedio != null && tb.ticketPromedio != null ? ta.ventas * (ta.ticketPromedio - tb.ticketPromedio) : null,
    participacionDuracion: CLASES_DURACION.filter((c) => clases.has(c)).map((c) => ({
      clase: c,
      actual: part(a, c),
      anterior: part(b, c),
      puntos: (part(a, c) - part(b, c)) * 100,
    })),
    modalidadesDistintas: hay(a) && hay(b) && domina(a) !== domina(b),
  };
}

export type Hallazgo = { id: string; titulo: string; texto: string };

const pesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
const pct = (x: number, dec = 1) => `${(x * 100).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;
const num = (x: number, dec = 0) => x.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const signo = (x: number, f: (n: number) => string) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${f(Math.abs(x))}`;

/**
 * Lectura breve del período: solo hechos calculados, con su respaldo numérico.
 * No atribuye causas (promociones, disponibilidad, demanda): describe qué cambió.
 */
export function hallazgos(a: Resumen, b: Resumen | null, c: Comparacion | null): Hallazgo[] {
  const out: Hallazgo[] = [];
  const t = a.totales;
  if (t.operaciones === 0) return out;

  if (b && c && b.totales.ventas > 0 && c.efectoVentas != null && c.efectoTicket != null && c.facturacion.diferencia != null) {
    const f0 = b.totales.facturacion;
    const dir = c.facturacion.diferencia > 0 ? "subió" : c.facturacion.diferencia < 0 ? "bajó" : "no cambió";
    const partes = [
      `${signo(c.efectoVentas, pesos)} por cantidad de ventas (${num(b.totales.ventas)} → ${num(t.ventas)})`,
      `${signo(c.efectoTicket, pesos)} por ticket promedio (${pesos(b.totales.ticketPromedio ?? 0)} → ${pesos(t.ticketPromedio ?? 0)})`,
    ];
    const mayor = Math.abs(c.efectoVentas) >= Math.abs(c.efectoTicket) ? "la cantidad de ventas" : "el ticket promedio";
    const ambos = Math.sign(c.efectoVentas) === Math.sign(c.efectoTicket) && c.efectoVentas !== 0 && c.efectoTicket !== 0;
    out.push({
      id: "facturacion",
      titulo: `La facturación comercial ${dir}${c.facturacion.porcentaje != null && c.facturacion.diferencia !== 0 ? ` ${pct(Math.abs(c.facturacion.porcentaje))}` : ""}`,
      texto: `${pesos(f0)} → ${pesos(t.facturacion)}. ${partes.join("; ")}. ${
        c.facturacion.diferencia === 0 ? "" : ambos ? `Los dos factores van en el mismo sentido; pesa más ${mayor}.` : `Los factores van en sentido contrario; pesa más ${mayor}.`
      }`.trim(),
    });
  }

  if (b && c && b.totales.operaciones > 0 && c.personasPorOperacion.actual != null && c.personasPorOperacion.anterior != null) {
    const dif = c.personasPorOperacion.actual - c.personasPorOperacion.anterior;
    out.push({
      id: "grupos",
      titulo: Math.abs(dif) < 0.05 ? "El tamaño de los grupos se mantuvo" : dif > 0 ? "Subieron las personas por operación" : "Bajaron las personas por operación",
      texto: `${num(c.personasPorOperacion.anterior, 2)} → ${num(c.personasPorOperacion.actual, 2)} personas por operación. Personas registradas: ${num(b.totales.personas)} → ${num(t.personas)}${
        c.personas.porcentaje != null ? ` (${signo(c.personas.porcentaje, (x) => pct(x))})` : ""
      }.`,
    });
  }

  const conPersonas = a.duraciones.filter((d) => d.personas > 0).sort((x, y) => y.personas - x.personas);
  if (conPersonas.length) {
    const top = conPersonas[0];
    let texto = `${ETIQUETA_DURACION[top.clase]} concentró el ${pct(top.participacionPersonas)} de las personas (${num(top.personas)} de ${num(t.personas)}).`;
    if (t.duracionPromedioPersona != null) texto += ` Duración promedio por persona: ${num(t.duracionPromedioPersona, 1)} min.`;
    if (c && b && b.totales.personas > 0) {
      if (c.modalidadesDistintas) {
        texto += " Las duraciones no son comparables 1 a 1 con el período anterior: cruza el cambio de catálogo del 01/10/2026 (15/30 min → 10/20/30 min).";
      } else {
        const mov = [...c.participacionDuracion].sort((x, y) => Math.abs(y.puntos) - Math.abs(x.puntos))[0];
        if (mov && Math.abs(mov.puntos) >= 0.5) {
          texto += ` Frente al período anterior, ${ETIQUETA_DURACION[mov.clase]} ${mov.puntos > 0 ? "ganó" : "perdió"} ${num(Math.abs(mov.puntos), 1)} p.p. de participación (${pct(mov.anterior)} → ${pct(mov.actual)}).`;
        } else {
          texto += " La participación de cada duración casi no cambió frente al período anterior.";
        }
      }
    }
    out.push({ id: "duraciones", titulo: "Preferencia de duración", texto });
  }

  const diasConDatos = a.diasSemana.filter((d) => d.ocurrencias > 0 && d.personas > 0);
  const celdas = [...a.calorVenta].sort((x, y) => y.personas - x.personas);
  if (diasConDatos.length && celdas.length) {
    const mejorDia = [...diasConDatos].sort((x, y) => y.personas / y.ocurrencias - x.personas / x.ocurrencias)[0];
    const totalHora = new Map<number, number>();
    for (const h of a.horasVenta) totalHora.set(h.hora, h.personas);
    const horasOrden = [...totalHora.entries()].sort((x, y) => y[1] - x[1]);
    const conHora = a.horasVenta.reduce((s, h) => s + h.personas, 0);
    const pico = celdas[0];
    out.push({
      id: "demanda",
      titulo: "Dónde se concentra la actividad",
      texto: `Por día promedio, el ${DIAS_SEMANA[mejorDia.dia]} es el más activo: ${num(mejorDia.personas / mejorDia.ocurrencias, 1)} personas por ${DIAS_SEMANA[mejorDia.dia]} (${mejorDia.ocurrencias} en el período). La franja con más personas por momento de venta es ${String(horasOrden[0][0]).padStart(2, "0")}–${String(horasOrden[0][0] + 1).padStart(2, "0")} h (${pct(conHora ? horasOrden[0][1] / conHora : 0)} de las personas con hora). El pico día × hora: ${DIAS_SEMANA[pico.dia]} ${String(pico.hora).padStart(2, "0")} h, con ${num(pico.personas)} personas en total.`,
    });
  }

  if (a.espera.validas > 0 && a.espera.mediana != null) {
    let texto = `Mediana ${num(a.espera.mediana, 1)} min, promedio ${num(a.espera.promedio ?? 0, 1)} min y 9 de cada 10 operaciones suben en ${num(a.espera.p90 ?? 0)} min o menos. Calculado sobre ${num(a.espera.validas)} de ${num(t.operaciones)} operaciones.`;
    if (c && c.medianaEspera.anterior != null && c.medianaEspera.diferencia != null) {
      texto += ` Período anterior: mediana ${num(c.medianaEspera.anterior, 1)} min.`;
    }
    out.push({ id: "espera", titulo: "Espera entre la toma y la subida", texto });
  }

  if (t.cortesias > 0) {
    out.push({
      id: "cortesias",
      titulo: "Cortesías",
      texto: `${num(t.cortesias)} ${t.cortesias === 1 ? "operación" : "operaciones"} sin cargo (${num(t.personasCortesia)} personas). Cuentan en personas, no en facturación ni en ticket.`,
    });
  }
  return out;
}

// ── Detalle paginado ─────────────────────────────────────────────────────────

export type OrdenDetalle = "reciente" | "antiguo" | "importe" | "personas" | "espera";

export type FilaDetalle = {
  id: string;
  fuente: Fuente;
  idOrigen: number;
  fecha: string;
  dia: string;
  horaVenta: string | null;
  horaSubida: string | null;
  espera: number | null;
  personas: number;
  duracion: string;
  minutosPorPersona: number | null;
  tipo: "Comercial" | "Cortesía";
  medios: string;
  importe: number;
  origen: string;
  cliente: string | null;
};

export function filaDetalle(o: OperacionStand): FilaDetalle {
  const medios = [...new Set(o.pagos.map((p) => p.metodo))];
  return {
    id: o.id,
    fuente: o.fuente,
    idOrigen: o.idOrigen,
    fecha: o.fecha,
    dia: DIAS_CORTOS[o.diaSemana],
    horaVenta: horaTexto(o.horaVenta),
    horaSubida: horaTexto(o.horaSubida),
    espera: esperaDe(o),
    personas: o.personas,
    duracion: o.minutosPorPersona != null ? `${o.minutosPorPersona} min` : "Sin dato",
    minutosPorPersona: o.minutosPorPersona,
    tipo: o.cortesia ? "Cortesía" : "Comercial",
    medios: medios.join(" + "),
    importe: o.importe,
    origen: o.fuente === "turnero" ? `Turnero #${o.idOrigen}` : `Excel · ${o.archivo ?? "sin nombre"} #${o.idOrigen}`,
    cliente: o.cliente,
  };
}

export function ordenar(ops: OperacionStand[], orden: OrdenDetalle) {
  const clave = (o: OperacionStand) => `${o.fecha} ${String(o.horaVenta ?? -1).padStart(5, "0")} ${o.id}`;
  const lista = [...ops];
  switch (orden) {
    case "antiguo":
      return lista.sort((a, b) => (clave(a) < clave(b) ? -1 : 1));
    case "importe":
      return lista.sort((a, b) => b.importe - a.importe || (clave(a) < clave(b) ? 1 : -1));
    case "personas":
      return lista.sort((a, b) => b.personas - a.personas || (clave(a) < clave(b) ? 1 : -1));
    case "espera":
      return lista.sort((a, b) => (esperaDe(b) ?? -1) - (esperaDe(a) ?? -1) || (clave(a) < clave(b) ? 1 : -1));
    default:
      return lista.sort((a, b) => (clave(a) < clave(b) ? 1 : -1));
  }
}

export const POR_PAGINA = 25;

export type PaginaDetalle = {
  contexto: Totales & { importeMedio: number | null };
  filas: FilaDetalle[];
  pagina: number;
  paginas: number;
  total: number;
};

export function paginaDetalle(ops: OperacionStand[], orden: OrdenDetalle, pagina: number, medio?: string): PaginaDetalle {
  const total = ops.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const p = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas);
  const filas = ordenar(ops, orden).slice((p - 1) * POR_PAGINA, p * POR_PAGINA).map(filaDetalle);
  const importeMedio = medio ? ops.reduce((s, o) => s + o.pagos.filter((x) => x.metodo === medio).reduce((t, x) => t + x.monto, 0), 0) : null;
  return { contexto: { ...totalesDe(ops), importeMedio }, filas, pagina: p, paginas, total };
}

// ── Parámetros de URL (compartidos por la página y las APIs) ─────────────────

export type ParametrosStand = {
  preset: Preset;
  desde?: string;
  hasta?: string;
  comparar: ModoComparacion;
  filtros: Criterios;
};

const PRESETS: Preset[] = ["hoy", "ayer", "7d", "30d", "semana", "mes", "mes_anterior", "anio", "todo", "personalizado"];

function lista(v: string | null, valido: (x: string) => boolean) {
  return (v ?? "").split(",").map((x) => x.trim()).filter((x) => x && valido(x));
}

export function leerParametros(sp: URLSearchParams): ParametrosStand {
  const preset = (PRESETS as string[]).includes(sp.get("p") ?? "") ? (sp.get("p") as Preset) : "mes";
  const comparar = (["anterior", "anio", "ninguna"] as const).find((m) => m === sp.get("cmp")) ?? "anterior";
  const filtros: Criterios = {};
  const dur = lista(sp.get("dur"), (x) => (CLASES_DURACION as readonly string[]).includes(x)) as ClaseDuracion[];
  if (dur.length) filtros.duraciones = dur;
  const dias = lista(sp.get("dias"), (x) => /^[0-6]$/.test(x)).map(Number);
  if (dias.length) filtros.dias = dias;
  const horas = lista(sp.get("horas"), (x) => /^\d{1,2}$/.test(x) && Number(x) < 24).map(Number);
  if (horas.length) filtros.horas = horas;
  const horasS = lista(sp.get("horasSubida"), (x) => /^\d{1,2}$/.test(x) && Number(x) < 24).map(Number);
  if (horasS.length) filtros.horasSubida = horasS;
  const tipo = sp.get("tipo");
  if (tipo === "comerciales" || tipo === "cortesias") filtros.tipo = tipo;
  return {
    preset,
    desde: esFecha(sp.get("desde")) ? sp.get("desde")! : undefined,
    hasta: esFecha(sp.get("hasta")) ? sp.get("hasta")! : undefined,
    comparar,
    filtros,
  };
}

export function escribirParametros(p: ParametrosStand, sp = new URLSearchParams()): URLSearchParams {
  sp.set("p", p.preset);
  if (p.preset === "personalizado" && p.desde && p.hasta) {
    sp.set("desde", p.desde);
    sp.set("hasta", p.hasta);
  } else {
    sp.delete("desde");
    sp.delete("hasta");
  }
  sp.set("cmp", p.comparar);
  const f = p.filtros;
  const poner = (k: string, v: unknown[] | undefined) => (v && v.length ? sp.set(k, v.join(",")) : sp.delete(k));
  poner("dur", f.duraciones);
  poner("dias", f.dias);
  poner("horas", f.horas);
  poner("horasSubida", f.horasSubida);
  if (f.tipo && f.tipo !== "todas") sp.set("tipo", f.tipo);
  else sp.delete("tipo");
  return sp;
}

/** Selección del detalle (además de los filtros), en parámetros `s_*`. */
export function leerSeleccion(sp: URLSearchParams): Criterios {
  const s: Criterios = {};
  const dur = lista(sp.get("s_dur"), (x) => (CLASES_DURACION as readonly string[]).includes(x)) as ClaseDuracion[];
  if (dur.length) s.duraciones = dur;
  const dias = lista(sp.get("s_dias"), (x) => /^[0-6]$/.test(x)).map(Number);
  if (dias.length) s.dias = dias;
  const horas = lista(sp.get("s_horas"), (x) => /^\d{1,2}$/.test(x) && Number(x) < 24).map(Number);
  if (horas.length) s.horas = horas;
  const horasS = lista(sp.get("s_horasSubida"), (x) => /^\d{1,2}$/.test(x) && Number(x) < 24).map(Number);
  if (horasS.length) s.horasSubida = horasS;
  const tipo = sp.get("s_tipo");
  if (tipo === "comerciales" || tipo === "cortesias") s.tipo = tipo;
  if (esFecha(sp.get("s_fecha"))) s.fecha = sp.get("s_fecha")!;
  if (esFecha(sp.get("s_desde"))) s.fechaDesde = sp.get("s_desde")!;
  if (esFecha(sp.get("s_hasta"))) s.fechaHasta = sp.get("s_hasta")!;
  const grupo = Number(sp.get("s_grupo"));
  if (Number.isInteger(grupo) && grupo >= 1 && grupo <= 4) s.grupo = grupo;
  const medio = sp.get("s_medio");
  if (medio && medio.length <= 40) s.medio = medio;
  if (sp.get("s_subida") === "1") s.conSubida = true;
  if (sp.get("s_subida") === "0") s.conSubida = false;
  const espera = Number(sp.get("s_espera"));
  if (sp.has("s_espera") && Number.isFinite(espera) && espera >= 0 && espera <= ESPERA_MAXIMA_VALIDA) s.esperaMin = espera;
  const esperaMax = Number(sp.get("s_esperaMax"));
  if (sp.has("s_esperaMax") && Number.isFinite(esperaMax) && esperaMax > 0 && esperaMax <= ESPERA_MAXIMA_VALIDA + 1) s.esperaMax = esperaMax;
  const id = sp.get("s_id");
  if (id && /^[tx]:[0-9]{1,12}$/.test(id)) s.id = id;
  return s;
}

export function escribirSeleccion(s: Criterios, sp = new URLSearchParams()): URLSearchParams {
  const poner = (k: string, v: unknown[] | undefined) => (v && v.length ? sp.set(k, v.join(",")) : null);
  poner("s_dur", s.duraciones);
  poner("s_dias", s.dias);
  poner("s_horas", s.horas);
  poner("s_horasSubida", s.horasSubida);
  if (s.tipo && s.tipo !== "todas") sp.set("s_tipo", s.tipo);
  if (s.fecha) sp.set("s_fecha", s.fecha);
  if (s.fechaDesde) sp.set("s_desde", s.fechaDesde);
  if (s.fechaHasta) sp.set("s_hasta", s.fechaHasta);
  if (s.grupo != null) sp.set("s_grupo", String(s.grupo));
  if (s.medio) sp.set("s_medio", s.medio);
  if (s.conSubida != null) sp.set("s_subida", s.conSubida ? "1" : "0");
  if (s.esperaMin != null) sp.set("s_espera", String(s.esperaMin));
  if (s.esperaMax != null) sp.set("s_esperaMax", String(s.esperaMax));
  if (s.id) sp.set("s_id", s.id);
  return sp;
}

/** Intersección de dos criterios (filtros del dashboard ∧ selección del detalle). */
export function combinar(f: Criterios, s: Criterios): Criterios {
  let nada = Boolean(f.nada || s.nada);
  const inter = <T,>(a?: T[], b?: T[]): T[] | undefined => {
    if (vacio(a)) return b;
    if (vacio(b)) return a;
    const r = a!.filter((x) => b!.includes(x));
    if (!r.length) nada = true;
    return r;
  };
  const tf = f.tipo && f.tipo !== "todas" ? f.tipo : undefined;
  const ts = s.tipo && s.tipo !== "todas" ? s.tipo : undefined;
  if (tf && ts && tf !== ts) nada = true;
  const out: Criterios = {
    ...f,
    ...s,
    duraciones: inter(f.duraciones, s.duraciones),
    dias: inter(f.dias, s.dias),
    horas: inter(f.horas, s.horas),
    horasSubida: inter(f.horasSubida, s.horasSubida),
    tipo: tf ?? ts,
  };
  if (nada) out.nada = true;
  return out;
}

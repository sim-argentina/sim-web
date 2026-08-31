// IA SIM · Bloque 3B — Motor DETERMINÍSTICO de atribución por integrante (núcleo PURO).
// Sin acceso a DB: acá viven la fórmula de turnos, el reparto entre integrantes
// simultáneos, la clasificación del motivo de no-atribución y la reconciliación.
// El acceso a datos y el ensamblado del reporte viven en lib/metricasEquipoServer.ts.
//
// Reglas canónicas reutilizadas (una sola fuente de verdad):
//  · Presencia: resolverPresencia (lib/cronograma) — [inicio, fin), fallback Ramiro,
//    solo 'confirmado' es oficial.
//  · Turnos: 1 turno = 15 min de uso por 1 persona/simulador (= metricasStand).
//  · Comisiones: calcularComisionesPagos (lib/finanzasComisiones) — se aplican en el
//    server por pago; acá solo se transportan y reparten.

import { horaAMinutos, resolverPresencia, type EstadoMes, type DiaResol } from "@/lib/cronograma";

export const MINUTOS_POR_TURNO = 15;

// Paquete de métricas atribuibles de una operación (o de un acumulado).
export type Metricas = {
  turnos: number;
  personas: number;
  operaciones: number;
  minutos: number;
  bruto: number;
  comision: number;
  neto: number;
};

export const CERO: Metricas = { turnos: 0, personas: 0, operaciones: 0, minutos: 0, bruto: 0, comision: 0, neto: 0 };

export function sumarMetricas(a: Metricas, b: Metricas): Metricas {
  return {
    turnos: a.turnos + b.turnos,
    personas: a.personas + b.personas,
    operaciones: a.operaciones + b.operaciones,
    minutos: a.minutos + b.minutos,
    bruto: a.bruto + b.bruto,
    comision: a.comision + b.comision,
    neto: a.neto + b.neto,
  };
}

// Reparto EN PARTES IGUALES entre N integrantes simultáneos. Divide TODO (incluye
// operaciones y personas → pueden quedar fraccionarios; se acumulan con precisión y
// se redondean solo para presentar). n<=0 se trata como 1 (defensivo).
export function repartirMetricas(m: Metricas, n: number): Metricas {
  const d = n > 0 ? n : 1;
  return {
    turnos: m.turnos / d,
    personas: m.personas / d,
    operaciones: m.operaciones / d,
    minutos: m.minutos / d,
    bruto: m.bruto / d,
    comision: m.comision / d,
    neto: m.neto / d,
  };
}

// Fórmula canónica de turnos: personas × (minutos / 15). Ej: 3 personas × 30 min = 6.
export function calcularTurnos(personas: number, minutos: number): number {
  const p = Number(personas) || 0;
  const min = Number(minutos) || 0;
  if (p <= 0 || min <= 0) return 0;
  return (p * min) / MINUTOS_POR_TURNO;
}

// ── Atribución de UNA operación (por fecha+hora de inicio del servicio) ────────
export type MotivoNoAtribuir =
  | "cronograma_no_confirmado"
  | "dia_cerrado"
  | "fuera_horario"
  | "fecha_hora_invalida"
  | "datos_fuente_incompletos";

export type Atribuido = { atribuido: true; presentes: string[]; oficial: boolean; fuentePresencia: "manual" | "fallback" };
export type NoAtribuido = { atribuido: false; motivo: MotivoNoAtribuir };
export type Atribucion = Atribuido | NoAtribuido;

export type ResolverAtribucionInput = {
  estado: EstadoMes; // estado del mes de cronograma (solo 'confirmado' es oficial)
  dia: DiaResol | null; // día del cronograma para esa fecha (null = sin datos)
  hora: string | null; // hora de INICIO del servicio ("HH:MM")
  fallbackEmpleadoId: string; // Ramiro (desde la DB, nunca hardcodeado)
};

// Determinístico: dado el mes/día del cronograma y la hora de inicio, devuelve los
// integrantes presentes o el motivo exacto de no-atribución. NO convierte
// automáticamente en Ramiro los casos sin cobertura oficial.
export function resolverAtribucion(input: ResolverAtribucionInput): Atribucion {
  const t = horaAMinutos(input.hora ?? "");
  if (t === null) return { atribuido: false, motivo: "fecha_hora_invalida" };

  // Solo un cronograma CONFIRMADO es oficial (borrador/reabierto/descartado/inexistente no).
  if (input.estado !== "confirmado") return { atribuido: false, motivo: "cronograma_no_confirmado" };
  if (!input.dia) return { atribuido: false, motivo: "cronograma_no_confirmado" };
  if (input.dia.cerrado) return { atribuido: false, motivo: "dia_cerrado" };

  const ap = horaAMinutos(input.dia.apertura);
  const ci = horaAMinutos(input.dia.cierre);
  if (ap === null || ci === null) return { atribuido: false, motivo: "datos_fuente_incompletos" };
  if (t < ap || t >= ci) return { atribuido: false, motivo: "fuera_horario" };

  const res = resolverPresencia({
    estado: input.estado,
    dia: input.dia,
    hora: input.hora as string,
    fallbackEmpleadoId: input.fallbackEmpleadoId,
  });
  if (res.presentes.length === 0 || res.fuente === "ninguno") {
    return { atribuido: false, motivo: "cronograma_no_confirmado" };
  }
  return { atribuido: true, presentes: res.presentes, oficial: res.oficial, fuentePresencia: res.fuente };
}

// ── Acumulador por integrante + sin-atribuir, con reconciliación ──────────────
export type AcumEquipo = {
  porEmpleado: Map<string, { stand: Metricas; reservas: Metricas }>;
  sinAtribuir: Map<MotivoNoAtribuir, Metricas>;
  totalOrigen: Metricas; // suma de TODA la actividad efectiva válida (atribuida o no)
};

export function nuevoAcum(): AcumEquipo {
  return { porEmpleado: new Map(), sinAtribuir: new Map(), totalOrigen: CERO };
}

export type Fuente = "stand" | "reservas";

// Imputa una operación efectiva: reparte entre presentes o la manda a sin-atribuir.
export function imputar(acum: AcumEquipo, fuente: Fuente, m: Metricas, atrib: Atribucion): void {
  acum.totalOrigen = sumarMetricas(acum.totalOrigen, m);
  if (!atrib.atribuido) {
    acum.sinAtribuir.set(atrib.motivo, sumarMetricas(acum.sinAtribuir.get(atrib.motivo) ?? CERO, m));
    return;
  }
  const parte = repartirMetricas(m, atrib.presentes.length);
  for (const id of atrib.presentes) {
    const cur = acum.porEmpleado.get(id) ?? { stand: CERO, reservas: CERO };
    if (fuente === "stand") cur.stand = sumarMetricas(cur.stand, parte);
    else cur.reservas = sumarMetricas(cur.reservas, parte);
    acum.porEmpleado.set(id, cur);
  }
}

// Reconciliación: total de origen ≈ atribuido + sin-atribuir (por métrica).
export type Reconciliacion = { metrica: keyof Metricas; origen: number; atribuido: number; sinAtribuir: number; diff: number; ok: boolean };

export function reconciliar(acum: AcumEquipo, tolerancia = 0.01): { ok: boolean; filas: Reconciliacion[] } {
  let atribuido = CERO;
  for (const v of acum.porEmpleado.values()) atribuido = sumarMetricas(atribuido, sumarMetricas(v.stand, v.reservas));
  let sin = CERO;
  for (const v of acum.sinAtribuir.values()) sin = sumarMetricas(sin, v);

  const metricas: Array<keyof Metricas> = ["turnos", "personas", "operaciones", "minutos", "bruto", "comision", "neto"];
  const filas = metricas.map((k) => {
    const origen = acum.totalOrigen[k];
    const diff = origen - (atribuido[k] + sin[k]);
    return { metrica: k, origen, atribuido: atribuido[k], sinAtribuir: sin[k], diff, ok: Math.abs(diff) <= tolerancia };
  });
  return { ok: filas.every((f) => f.ok), filas };
}

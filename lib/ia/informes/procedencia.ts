// IA SIM · Bloque 4C.2 — Procedencia SEMÁNTICA. No alcanza con encontrar "el mismo
// número" en cualquier parte del snapshot: cada valor debe validarse contra su propio
// integrante + origen + métrica + unidad. Así las horas de Federico no pueden validarse
// con las de Francisco, ni un valor de Reservas con uno de Stand, ni minutos con horas,
// ni bruto con neto.

export type IndiceProcedencia = Record<string, number>; // "integrante|origen|metrica" → valor

// Unidad esperada por métrica (para bloquear min↔horas, etc.).
const UNIDAD_METRICA: Record<string, string> = {
  horas_minutos: "min", turnos: "turnos", personas: "personas", operaciones: "operaciones",
  minutos: "min", bruto: "ars", comision: "ars", neto: "ars",
};

const TOL = 0.01;

export function clave(integrante: string, origen: "total" | "stand" | "reservas", metrica: string): string {
  return `${integrante}|${origen}|${metrica}`;
}

type MetricasP = { turnos: number; personas: number; operaciones: number; minutos: number; bruto: number; comision: number; neto: number };
// Construye el índice de procedencia desde los datos de un integrante (total/stand/reservas + horas).
export function indiceDesdeDatos(nombre: string, datos: { total: MetricasP; stand: MetricasP; reservas: MetricasP; horas_minutos: number }): IndiceProcedencia {
  const idx: IndiceProcedencia = {};
  const put = (origen: "total" | "stand" | "reservas", m: MetricasP) => {
    for (const k of ["turnos", "personas", "operaciones", "minutos", "bruto", "comision", "neto"] as const) idx[clave(nombre, origen, k)] = m[k];
  };
  put("total", datos.total); put("stand", datos.stand); put("reservas", datos.reservas);
  idx[clave(nombre, "total", "horas_minutos")] = Math.round(datos.horas_minutos);
  return idx;
}

export type Consulta = { integrante: string; origen: "total" | "stand" | "reservas"; metrica: string; unidad?: string; valor: number };

export function validarProcedencia(indice: IndiceProcedencia, c: Consulta): { ok: boolean; motivo?: string } {
  const k = clave(c.integrante, c.origen, c.metrica);
  if (!(k in indice)) return { ok: false, motivo: `No existe dato para ${c.integrante}/${c.origen}/${c.metrica}.` };
  // Unidad debe coincidir con la de la métrica (minutos ≠ horas, bruto ≠ neto conceptualmente
  // ya se separan por métrica; la unidad refuerza min↔horas).
  if (c.unidad && UNIDAD_METRICA[c.metrica] && c.unidad !== UNIDAD_METRICA[c.metrica]) {
    return { ok: false, motivo: `Unidad ${c.unidad} no corresponde a la métrica ${c.metrica} (${UNIDAD_METRICA[c.metrica]}).` };
  }
  const esperado = indice[k];
  if (Math.abs(esperado - c.valor) > TOL + Math.abs(esperado) * 1e-6) {
    return { ok: false, motivo: `El valor ${c.valor} no coincide con ${c.integrante}/${c.origen}/${c.metrica} (${esperado}).` };
  }
  return { ok: true };
}

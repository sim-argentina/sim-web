// IA SIM · Bloque 4E — Períodos equivalentes. Puro (sin DB). Construido sobre
// lib/ia/periodo.ts (estadoPeriodoCalendario), no lo duplica.

import { estadoPeriodoCalendario } from "@/lib/ia/periodo";

export type VentanaPeriodo = { desde: string; hasta: string }; // 'YYYY-MM-DD' inclusive

const mm = (m: number) => String(m).padStart(2, "0");
export function diasEnMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}
export function ventanaMes(anio: number, mes: number): VentanaPeriodo {
  return { desde: `${anio}-${mm(mes)}-01`, hasta: `${anio}-${mm(mes)}-${mm(diasEnMes(anio, mes))}` };
}

// Ventana de un mes de REFERENCIA recortada a los mismos N días transcurridos que el mes en
// curso (clamp a la cantidad real de días del mes de referencia, nunca se pasa de su fin).
export function ventanaEquivalente(anioRef: number, mesRef: number, diasTranscurridos: number): VentanaPeriodo {
  const dias = Math.max(1, Math.min(diasTranscurridos, diasEnMes(anioRef, mesRef)));
  return { desde: `${anioRef}-${mm(mesRef)}-01`, hasta: `${anioRef}-${mm(mesRef)}-${mm(dias)}` };
}

export type ModoComparacion = "completos" | "equivalente";

export type ResolucionPeriodos = {
  modo: ModoComparacion;
  // Ventana REAL a usar para cada lado en la comparación principal (equivalente si alguno está
  // en curso; completa si ambos finalizaron).
  ventanaA: VentanaPeriodo;
  ventanaB: VentanaPeriodo;
  aEnCurso: boolean;
  bEnCurso: boolean;
  diasTranscurridos: number | null; // solo si modo==="equivalente"
  // Ventana del mes en curso PARA REFERENCIA COMPLETA (histórico), siempre que exactamente uno
  // de los dos lados esté en curso: es la ventana completa del OTRO mes (el finalizado), que ya
  // coincide con ventanaA/ventanaB del lado finalizado — se expone aparte para dejar explícito
  // que es una referencia histórica completa, no parte de la comparación equivalente.
  referenciaCompletaLado: "A" | "B" | null;
};

// Resuelve qué ventanas comparar dado un mes A y un mes B (en Córdoba). No decide si es
// financiero/operativo: eso lo aplica el llamador sobre las ventanas devueltas.
export function resolverPeriodos(a: { anio: number; mes: number }, b: { anio: number; mes: number }, ahora: Date = new Date()): ResolucionPeriodos {
  const estA = estadoPeriodoCalendario(a.anio, a.mes, ahora);
  const estB = estadoPeriodoCalendario(b.anio, b.mes, ahora);
  const aEnCurso = estA.periodo_calendario === "en_curso";
  const bEnCurso = estB.periodo_calendario === "en_curso";

  if (!aEnCurso && !bEnCurso) {
    return { modo: "completos", ventanaA: ventanaMes(a.anio, a.mes), ventanaB: ventanaMes(b.anio, b.mes), aEnCurso, bEnCurso, diasTranscurridos: null, referenciaCompletaLado: null };
  }
  // Exactamente uno (o ambos, caso degenerado) en curso: se usa el día del mes ya transcurrido
  // del lado en curso como referencia para recortar el otro lado.
  const hoyCba = ahora.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
  const diaHoy = Number(hoyCba.slice(8, 10));
  if (aEnCurso && !bEnCurso) {
    return { modo: "equivalente", ventanaA: { desde: ventanaMes(a.anio, a.mes).desde, hasta: hoyCba }, ventanaB: ventanaEquivalente(b.anio, b.mes, diaHoy), aEnCurso, bEnCurso, diasTranscurridos: diaHoy, referenciaCompletaLado: "B" };
  }
  if (bEnCurso && !aEnCurso) {
    return { modo: "equivalente", ventanaA: ventanaEquivalente(a.anio, a.mes, diaHoy), ventanaB: { desde: ventanaMes(b.anio, b.mes).desde, hasta: hoyCba }, aEnCurso, bEnCurso, diasTranscurridos: diaHoy, referenciaCompletaLado: "A" };
  }
  // Ambos "en curso" (caso degenerado: a lo sumo puede pasar si se pide comparar el mes actual
  // contra sí mismo, o un error de params). Se comparan ambos hasta hoy, sin referencia completa.
  return { modo: "equivalente", ventanaA: { desde: ventanaMes(a.anio, a.mes).desde, hasta: hoyCba }, ventanaB: { desde: ventanaMes(b.anio, b.mes).desde, hasta: hoyCba }, aEnCurso, bEnCurso, diasTranscurridos: diaHoy, referenciaCompletaLado: null };
}

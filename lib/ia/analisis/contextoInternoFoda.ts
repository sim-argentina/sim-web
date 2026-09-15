// IA SIM · Bloque 4E — Contexto interno ESTRUCTURADO para el FODA (interno o mixto). Mismo
// patrón que contextoInternoEstructurado.ts (4D.5.2/4D.5.3): cada dato interno se prepara con
// un id y procedencia real; el modelo solo puede CITARLO, nunca reescribirlo ni inventarlo.
// Más amplio que el de análisis competitivo: incluye también un resumen financiero (fortalezas/
// debilidades de un FODA suelen apoyarse en rentabilidad, no solo en volumen).

import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";
import { calcularMes, getCierreMes } from "@/lib/finanzas";
import { getMesVista } from "@/lib/cronogramaServer";
import { SIM_IDENTIDAD } from "@/lib/ia/entidad";
import type { FuenteInternaDisponible } from "@/lib/ia/web/analisisWebSchema";

function ahoraISO(): string { return new Date().toISOString(); }

export async function construirContextoInternoFoda(): Promise<FuenteInternaDisponible[]> {
  const out: FuenteInternaDisponible[] = [];
  const ahora = ahoraISO();

  out.push({
    id: "int-1",
    texto: `${SIM_IDENTIDAD.nombre_canonico} opera en ${SIM_IDENTIDAD.ciudad}, ${SIM_IDENTIDAD.pais}, simuladores de automovilismo. "${SIM_IDENTIDAD.denominaciones_historicas[0]}" es una denominación HISTÓRICA de la misma empresa (no un competidor).`,
    modulo: "Identidad SIM", actualizado: ahora,
  });
  out.push({
    id: "int-2",
    texto: "Dos canales de atención: presencial por turnero (Stand) y reservas online (Reservas web).",
    modulo: "Canales SIM", actualizado: ahora,
  });

  const hoyCba = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
  const [anioStr, mesStr] = hoyCba.split("-");
  const anio = Number(anioStr), mes = Number(mesStr);
  const mesC = `${anioStr}-${mesStr}`;

  try {
    const desde = `${anioStr}-${mesStr}-01`;
    const hasta = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
    const r = await consultarMetricasEquipo({ desde, hasta });
    const t = r.totalesAtribuidos;
    out.push({
      id: "int-3",
      texto: `Actividad de ${mesC} (mes vigente, hasta ${r.corte.slice(0, 16).replace("T", " ")} hora Córdoba): ${t.turnos} turnos, ${t.personas} personas, facturación bruta $${t.bruto.toLocaleString("es-AR")} ARS.`,
      modulo: "Métricas Equipo (mes vigente)", periodo: mesC, actualizado: ahora,
    });
  } catch { /* degradación limpia: sin esta fuente si falla */ }

  try {
    const { resumen } = await calcularMes(mesC);
    const cierre = await getCierreMes(mesC);
    const gananciaSim = resumen.ingresos - resumen.costos - resumen.gastos - resumen.inversiones - resumen.sueldoAsignado;
    out.push({
      id: "int-4",
      texto: `Finanzas de ${mesC} (excluye Colectivo, estado ${cierre ? cierre.estado : "abierto"}): ingresos netos $${Math.round(resumen.ingresos).toLocaleString("es-AR")} ARS, costos $${Math.round(resumen.costos).toLocaleString("es-AR")}, gastos $${Math.round(resumen.gastos).toLocaleString("es-AR")}, ganancia SIM $${Math.round(gananciaSim).toLocaleString("es-AR")} ARS.`,
      modulo: "Finanzas SIM (mes vigente)", periodo: mesC, actualizado: ahora,
    });
  } catch { /* degradación limpia */ }

  try {
    const vista = await getMesVista(anio, mes);
    out.push({
      id: "int-5",
      texto: `Cronograma de ${mesC}: estado ${vista.estado}${vista.estado === "confirmado" ? " (oficial)" : " (no oficial/borrador)"}.`,
      modulo: "Cronograma (mes vigente)", periodo: mesC, actualizado: ahora,
    });
  } catch { /* degradación limpia */ }

  return out;
}

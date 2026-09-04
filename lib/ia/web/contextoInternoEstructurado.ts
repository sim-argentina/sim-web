// IA SIM · Corrección 4D.5.2 — Contexto interno ESTRUCTURADO para el análisis competitivo/mixto.
// Reemplaza el resumen "compacto" en JSON libre de 4D.5.1 (lib/ia/web/resumenInterno.ts, ahora
// retirado): cada dato interno se prepara con un id ("int-N") y procedencia real, para que el
// modelo pueda CITARLO (datos_internos_ids) sin poder reescribirlo ni inventar cifras. Acotado
// por relevancia: no consulta empleados si la pregunta no trata de ellos; no carga Finanzas ni
// otros meses salvo que la pregunta los pida.

import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";
import { formatHoras } from "@/lib/cronograma";
import { estadoPeriodoCalendario } from "@/lib/ia/periodo";
import { SIM_IDENTIDAD } from "@/lib/ia/entidad";
import type { FuenteInternaDisponible } from "@/lib/ia/web/analisisWebSchema";

const RE_EMPLEADOS = /\b(empleado|empleados|equipo|federico|francisco|ramiro|fede|fran|rami)\b/i;

function ahoraISO(): string { return new Date().toISOString(); }

// Devuelve los datos internos DISPONIBLES para esta pregunta (con id + procedencia real). El
// modelo elige cuáles citar (datos_internos_ids); el servidor arma el texto final, siempre desde
// acá — nunca desde una reescritura del modelo.
export async function construirContextoInternoEstructurado(pregunta: string): Promise<FuenteInternaDisponible[]> {
  const out: FuenteInternaDisponible[] = [];
  const ahora = ahoraISO();

  // int-1: identidad (siempre pertinente para "diferencias con SIM").
  out.push({
    id: "int-1",
    texto: `${SIM_IDENTIDAD.nombre_canonico} opera en ${SIM_IDENTIDAD.ciudad}, ${SIM_IDENTIDAD.pais}. "${SIM_IDENTIDAD.denominaciones_historicas[0]}" es una denominación HISTÓRICA de la misma empresa (no un competidor ni un negocio separado; hoy no hay bar).`,
    modulo: "Identidad SIM", actualizado: ahora,
  });
  // int-2: modalidad y canales (siempre pertinente).
  out.push({
    id: "int-2",
    texto: "SIM opera simuladores de automovilismo con dos canales: atención presencial por turnero (Stand) y reservas online (Reservas web).",
    modulo: "Canales SIM (Turnero Stand + Reservas web)", actualizado: ahora,
  });

  // int-3: métricas agregadas del mes vigente (SIEMPRE pertinentes para comparar volumen con
  // el mercado), y opcionalmente el desglose por integrante SOLO si la pregunta lo pide.
  const hoyCba = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
  const [anioStr, mesStr] = hoyCba.split("-");
  const anio = Number(anioStr), mes = Number(mesStr);
  try {
    const desde = `${anioStr}-${mesStr}-01`;
    const hasta = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
    const r = await consultarMetricasEquipo({ desde, hasta });
    const cal = estadoPeriodoCalendario(anio, mes);
    const cronoEstado = r.cronograma.cobertura[0]?.estado ?? "inexistente";
    const t = r.totalesAtribuidos;
    out.push({
      id: "int-3",
      texto: `Período ${anioStr}-${mesStr} (${cal.periodo_calendario === "finalizado" ? "finalizado" : "en curso"}, cronograma ${cronoEstado}, datos hasta ${r.corte.slice(0, 16).replace("T", " ")} hora Córdoba): ${t.turnos} turnos, ${t.personas} personas, facturación bruta $${t.bruto.toLocaleString("es-AR")} ARS (neta $${t.neto.toLocaleString("es-AR")} ARS).`,
      modulo: "Métricas Equipo (mes vigente)", periodo: `${anioStr}-${mesStr}`, actualizado: ahora,
    });

    if (RE_EMPLEADOS.test(pregunta)) {
      let n = 4;
      for (const integ of r.integrantes) {
        if (integ.archivado || integ.total.turnos === 0) continue;
        out.push({
          id: `int-${n++}`,
          texto: `${integ.nombre}: ${formatHoras(integ.horas_minutos)} de cronograma, ${integ.total.turnos} turnos, facturación bruta $${integ.total.bruto.toLocaleString("es-AR")} ARS este período.`,
          modulo: "Métricas Equipo · por integrante", periodo: `${anioStr}-${mesStr}`, actualizado: ahora,
        });
        if (n > 6) break; // hasta 3 integrantes con actividad, además de los 3 datos base
      }
    }
  } catch {
    // Degradación limpia: sin métricas del período, el análisis sigue solo con identidad/canales.
  }

  return out;
}

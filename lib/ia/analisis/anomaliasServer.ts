// IA SIM · Bloque 4E — Ensamblado server-side de detección de anomalías. Combina la serie
// diaria real (Stand+Reservas) con el detector robusto (MAD) y los avisos que ya calcula el
// motor de métricas (reconciliación, cronograma incompleto, Stand sin hora de inicio).

import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";
import { ventanaMes } from "@/lib/ia/analisis/periodos";
import { construirSerieDiaria, type PuntoDiario } from "@/lib/ia/analisis/serieDiaria";
import { detectarAnomaliasSerie, detectarDivergenciaEntreSeries, MUESTRA_MINIMA_ANOMALIAS, type AnomaliaDetectada } from "@/lib/ia/analisis/anomalias";

export type ParamsAnomalias = { anio: number; mes: number };

export type ResultadoAnomalias = {
  ok: true;
  periodo: string;
  diasAnalizados: number;
  muestraSuficiente: boolean;
  anomalias: AnomaliaDetectada[];
  avisosMotor: Array<{ tipo: string; gravedad: "info" | "warn"; mensaje: string }>;
};

// Analiza el mes (anio,mes) buscando anomalías de turnos y facturación día a día, y divergencias
// atípicas entre Stand y Reservas. Reutiliza consultar_metricas_equipo para los avisos que ya
// calcula el motor (reconciliación/cronograma), sin duplicar esa lógica.
export async function ejecutarDeteccionAnomalias(p: ParamsAnomalias): Promise<ResultadoAnomalias> {
  const ventana = ventanaMes(p.anio, p.mes);
  const [serie, reporte] = await Promise.all([
    construirSerieDiaria(ventana.desde, ventana.hasta),
    consultarMetricasEquipo({ desde: ventana.desde, hasta: ventana.hasta }),
  ]);

  const puntosTurnos = serie.map((d) => ({ etiqueta: d.fecha, valor: d.turnos, periodo: d.fecha }));
  const puntosFacturacion = serie.map((d) => ({ etiqueta: d.fecha, valor: d.facturacion, periodo: d.fecha }));
  const anomaliasTurnos = detectarAnomaliasSerie(puntosTurnos, { tipo: "turnos_diarios_atipicos" });
  const anomaliasFacturacion = detectarAnomaliasSerie(puntosFacturacion, { tipo: "facturacion_diaria_atipica", etiquetaUnidad: "ARS" });

  // Divergencia Stand vs Reservas: reconstruye ambas series por separado para el mismo rango
  // (la serie combinada de arriba no distingue fuente).
  const [serieStandSolo, serieReservasSolo] = await Promise.all([
    construirSerieFuente(ventana.desde, ventana.hasta, "stand"),
    construirSerieFuente(ventana.desde, ventana.hasta, "reservas"),
  ]);
  const divergencia = detectarDivergenciaEntreSeries(
    serieStandSolo.map((d) => ({ etiqueta: d.fecha, valor: d.facturacion, periodo: d.fecha })),
    serieReservasSolo.map((d) => ({ etiqueta: d.fecha, valor: d.facturacion, periodo: d.fecha })),
    "divergencia_stand_reservas", "ARS"
  );

  const avisosMotor = reporte.anomalias.map((a) => ({ tipo: a.tipo, gravedad: a.gravedad, mensaje: a.mensaje }));

  const anomalias = [...anomaliasTurnos, ...anomaliasFacturacion, ...divergencia].sort((a, b) => b.desviacion - a.desviacion);
  return {
    ok: true, periodo: `${p.anio}-${String(p.mes).padStart(2, "0")}`,
    diasAnalizados: serie.length, muestraSuficiente: serie.length >= MUESTRA_MINIMA_ANOMALIAS,
    anomalias, avisosMotor,
  };
}

// Serie diaria de UNA sola fuente (para la divergencia Stand vs Reservas). Duplica la consulta
// mínima necesaria en vez de importar internals de serieDiaria.ts (mantiene ese módulo simple).
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { turnosDeFila, personasDeFila, totalDeFila } from "@/lib/metricasStand";
import { idsReembolsadas } from "@/lib/reservasReembolsos";

async function construirSerieFuente(desde: string, hasta: string, fuente: "stand" | "reservas"): Promise<PuntoDiario[]> {
  const porFecha = new Map<string, { turnos: number; personas: number; facturacion: number; operaciones: number }>();
  const acc = (fecha: string) => { let e = porFecha.get(fecha); if (!e) { e = { turnos: 0, personas: 0, facturacion: 0, operaciones: 0 }; porFecha.set(fecha, e); } return e; };
  if (fuente === "stand") {
    const { data } = await supabaseAdmin.from("turnos_stand").select("fecha, estado, total, cantidad_personas, cantidad_simuladores, cantidad_turnos").gte("fecha", desde).lte("fecha", hasta);
    for (const t of data ?? []) {
      const estado = String(t.estado ?? "").toLowerCase();
      if (estado === "anulado" || estado === "cancelado") continue;
      const e = acc(String(t.fecha));
      e.turnos += turnosDeFila(t as never); e.personas += personasDeFila(t as never); e.facturacion += totalDeFila(t as never); e.operaciones += 1;
    }
  } else {
    const { data } = await supabaseAdmin.from("reservas").select("id, fecha, estado, total, cantidad_turnos, simuladores").gte("fecha", desde).lte("fecha", hasta);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const reemb = await idsReembolsadas(rows.map((r) => Number(r.id)));
    for (const r of rows) {
      if (String(r.estado) !== "activa" || reemb.has(Number(r.id))) continue;
      const e = acc(String(r.fecha));
      e.turnos += Number(r.cantidad_turnos) || 0;
      e.personas += Array.isArray(r.simuladores) ? (r.simuladores as unknown[]).length : 0;
      e.facturacion += Number(r.total) || 0;
      e.operaciones += 1;
    }
  }
  const diaSemanaDe = (f: string) => { const [y, m, d] = f.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
  return [...porFecha.entries()].map(([fecha, v]) => ({ fecha, diaSemana: diaSemanaDe(fecha), ...v })).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

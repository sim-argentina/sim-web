// IA SIM · Bloque 4E — Serie DIARIA real de actividad (Stand + Reservas), server-side. No existe
// hoy en el sistema (el motor de métricas solo agrega por mes); la usan detectar_anomalias y
// proyectar_periodo. Reutiliza las MISMAS reglas de exclusión que metricasEquipoServer.ts:
// Stand anulado/cancelado se descarta; Reservas se cuenta solo 'activa' y NUNCA reembolsada.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { turnosDeFila, personasDeFila, totalDeFila } from "@/lib/metricasStand";
import { idsReembolsadas } from "@/lib/reservasReembolsos";

export type PuntoDiario = { fecha: string; diaSemana: number; turnos: number; personas: number; facturacion: number; operaciones: number };

function diaSemanaDe(fechaISO: string): number {
  // Evita corrimiento de huso horario: parsea como fecha local (no Date(fecha) que asume UTC).
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

// Serie diaria combinada (Stand + Reservas) entre `desde` y `hasta` (inclusive, 'YYYY-MM-DD').
export async function construirSerieDiaria(desde: string, hasta: string): Promise<PuntoDiario[]> {
  const porFecha = new Map<string, { turnos: number; personas: number; facturacion: number; operaciones: number }>();
  const acc = (fecha: string) => {
    let e = porFecha.get(fecha);
    if (!e) { e = { turnos: 0, personas: 0, facturacion: 0, operaciones: 0 }; porFecha.set(fecha, e); }
    return e;
  };

  const { data: standRows } = await supabaseAdmin.from("turnos_stand").select("fecha, estado, total, cantidad_personas, cantidad_simuladores, cantidad_turnos").gte("fecha", desde).lte("fecha", hasta);
  for (const t of standRows ?? []) {
    const estado = String(t.estado ?? "").toLowerCase();
    if (estado === "anulado" || estado === "cancelado") continue;
    const e = acc(String(t.fecha));
    e.turnos += turnosDeFila(t as never); e.personas += personasDeFila(t as never); e.facturacion += totalDeFila(t as never); e.operaciones += 1;
  }

  const { data: resRows } = await supabaseAdmin.from("reservas").select("id, fecha, estado, total, cantidad_turnos, simuladores").gte("fecha", desde).lte("fecha", hasta);
  const rows = (resRows ?? []) as Array<Record<string, unknown>>;
  const reemb = await idsReembolsadas(rows.map((r) => Number(r.id)));
  for (const r of rows) {
    if (String(r.estado) !== "activa" || reemb.has(Number(r.id))) continue;
    const e = acc(String(r.fecha));
    e.turnos += Number(r.cantidad_turnos) || 0;
    e.personas += Array.isArray(r.simuladores) ? (r.simuladores as unknown[]).length : 0;
    e.facturacion += Number(r.total) || 0;
    e.operaciones += 1;
  }

  return [...porFecha.entries()].map(([fecha, v]) => ({ fecha, diaSemana: diaSemanaDe(fecha), ...v })).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// IA SIM · Bloque 5A — EJECUTOR del plan analítico interno. Solo lectura, parametrizado.
//
// Reutiliza las definiciones YA vigentes, sin crear una segunda versión de nada:
//  · facturacion_bruta → misma composición que Finanzas (fin_ingresos_por_mes): Turnero del
//    stand por fecha de SERVICIO + Reservas online, Gift cards y Campeonatos por fecha de PAGO.
//    La paridad con Finanzas está cubierta por prueba (mismo total mensual, al peso).
//  · turnos/personas/operaciones/minutos → Stand + Reservas por fecha de servicio, con los
//    mismos helpers canónicos de Métricas Stand (turnosDeFila/personasDeFila/calcularTurnos).
//
// El modelo nunca llega hasta acá con texto libre: llega un PlanAnalitico ya validado.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { FUENTES_LABEL } from "@/lib/finanzas";
import { turnosDeFila, personasDeFila, totalDeFila, type FilaStand } from "@/lib/metricasStand";
import { calcularTurnos } from "@/lib/metricasEquipo";
import { METRICAS, type PlanAnalitico } from "@/lib/ia/analisis/planAnalitico";

const TZ = "America/Argentina/Cordoba";
const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_ISO = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export type FilaAnalitica = {
  clave: string;
  etiqueta: string;
  detalle: string;
  fechas: string[];
  dias: number;
  valor: number;
};

export type ResultadoAnalitico =
  | {
      ok: true;
      metrica: string;
      etiquetaMetrica: string;
      unidad: string;
      ventana: { desde: string; hasta: string };
      filtros: { diasSemana: number[] | null; fuentes: string[] | null; metodosPago: string[] | null };
      agruparPor: string;
      filas: FilaAnalitica[];
      total: number;
      totalDias: number;
      porFuente: Array<{ fuente: string; etiqueta: string; valor: number }>;
      fuentesInternas: string[];
      advertencias: string[];
      truncado: boolean;
    }
  | { ok: false; motivo: string };

// ── Utilidades de fecha (día calendario de Córdoba, sin depender de un offset hardcodeado) ──
function diaCordobaDeTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}
function isoDow(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}
function sumarDias(fecha: string, delta: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + delta)).toISOString().slice(0, 10);
}
function diaDelMes(fecha: string): number { return Number(fecha.slice(8, 10)); }
function nombreMes(fecha: string): string { return MESES[Number(fecha.slice(5, 7))]; }

// Ventana UTC ampliada un día por lado: se consulta de más y después se filtra por el día
// calendario REAL de Córdoba, así no se pierde ni se cuela nada por el borde del huso.
function ventanaUtcAmplia(desde: string, hasta: string): { desdeUtc: string; hastaUtc: string } {
  return { desdeUtc: `${sumarDias(desde, -1)}T00:00:00.000Z`, hastaUtc: `${sumarDias(hasta, 2)}T00:00:00.000Z` };
}

type FilaDia = { dia: string; fuente: string; metodo: string; valor: number; turnos: number; personas: number; operaciones: number; minutos: number };

// ── Recolección CONTABLE (paridad con fin_ingresos_por_mes) ─────────────────────────────────
async function filasContables(p: PlanAnalitico, advertencias: string[]): Promise<FilaDia[]> {
  const { desde, hasta } = p.ventana;
  const { desdeUtc, hastaUtc } = ventanaUtcAmplia(desde, hasta);
  const quiere = (f: string) => !p.filtros.fuentes || p.filtros.fuentes.includes(f);
  const filas: FilaDia[] = [];
  const base = { turnos: 0, personas: 0, operaciones: 0, minutos: 0 };

  if (quiere("turnero")) {
    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .select("fecha, estado, total, metodo_pago, pagos_detalle")
      .gte("fecha", desde).lte("fecha", hasta);
    if (error) throw error;
    for (const t of (data ?? []) as Array<Record<string, unknown>>) {
      const estado = String(t.estado ?? "").toLowerCase();
      if (estado === "cancelado") continue; // misma exclusión que Finanzas
      const dia = String(t.fecha).slice(0, 10);
      const pagos = t.pagos_detalle;
      if (Array.isArray(pagos) && pagos.length > 0) {
        for (const pago of pagos as Array<Record<string, unknown>>) {
          const metodo = String(pago.metodo_pago ?? "").trim() || "desconocido";
          filas.push({ ...base, dia, fuente: "turnero", metodo, valor: Number(pago.monto) || 0 });
        }
      } else {
        const metodo = String(t.metodo_pago ?? "").trim() || "desconocido";
        filas.push({ ...base, dia, fuente: "turnero", metodo, valor: Number(t.total) || 0 });
      }
    }
  }

  if (quiere("reservas_online")) {
    const { data, error } = await supabaseAdmin
      .from("reservas")
      .select("created_at, estado, total, origen")
      .gte("created_at", desdeUtc).lt("created_at", hastaUtc);
    if (error) throw error;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const estado = String(r.estado ?? "");
      if (estado !== "activa" && estado !== "reembolsada") continue;
      const origen = r.origen == null ? null : String(r.origen);
      if (origen === "empresa" || origen === "mensualidad") continue;
      const dia = diaCordobaDeTimestamp(String(r.created_at));
      if (dia < desde || dia > hasta) continue;
      filas.push({ ...base, dia, fuente: "reservas_online", metodo: "mercadopago", valor: Number(r.total) || 0 });
    }
  }

  if (quiere("gift_cards")) {
    const { data, error } = await supabaseAdmin
      .from("gift_cards")
      .select("fecha_pago, estado_pago, monto")
      .gte("fecha_pago", desdeUtc).lt("fecha_pago", hastaUtc);
    if (error) throw error;
    for (const g of (data ?? []) as Array<Record<string, unknown>>) {
      if (String(g.estado_pago ?? "") !== "pagado" || !g.fecha_pago) continue;
      const dia = diaCordobaDeTimestamp(String(g.fecha_pago));
      if (dia < desde || dia > hasta) continue;
      filas.push({ ...base, dia, fuente: "gift_cards", metodo: "mercadopago", valor: Number(g.monto) || 0 });
    }
  }

  if (quiere("campeonatos")) {
    const { data, error } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .select("created_at, estado_pago, monto, metodo_pago, eliminada_at")
      .gte("created_at", desdeUtc).lt("created_at", hastaUtc);
    if (error) throw error;
    for (const c of (data ?? []) as Array<Record<string, unknown>>) {
      if (String(c.estado_pago ?? "") !== "pagado" || c.eliminada_at != null) continue;
      const dia = diaCordobaDeTimestamp(String(c.created_at));
      if (dia < desde || dia > hasta) continue;
      const metodo = String(c.metodo_pago ?? "").trim() || "mercadopago";
      filas.push({ ...base, dia, fuente: "campeonatos", metodo, valor: Number(c.monto) || 0 });
    }
  }

  if (filas.length === 0) advertencias.push("No hay ingresos registrados en el período y los filtros pedidos.");
  return filas;
}

// ── Recolección de ACTIVIDAD (Stand + Reservas por fecha de servicio, base de 4E) ────────────
async function filasActividad(p: PlanAnalitico, advertencias: string[]): Promise<FilaDia[]> {
  const { desde, hasta } = p.ventana;
  const quiere = (f: string) => !p.filtros.fuentes || p.filtros.fuentes.includes(f);
  const filas: FilaDia[] = [];

  if (quiere("stand")) {
    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .select("fecha, estado, total, metodo_pago, cantidad_personas, cantidad_simuladores, cantidad_turnos, cantidad_minutos")
      .gte("fecha", desde).lte("fecha", hasta);
    if (error) throw error;
    for (const t of (data ?? []) as Array<Record<string, unknown>>) {
      const estado = String(t.estado ?? "").toLowerCase();
      if (estado === "anulado" || estado === "cancelado") continue; // regla canónica de Métricas Stand
      const turnos = turnosDeFila(t as unknown as FilaStand);
      filas.push({
        dia: String(t.fecha).slice(0, 10), fuente: "stand", metodo: "", valor: totalDeFila(t as unknown as FilaStand),
        turnos, personas: personasDeFila(t as unknown as FilaStand), operaciones: 1, minutos: turnos * 15,
      });
    }
  }

  if (quiere("reservas")) {
    const { data, error } = await supabaseAdmin
      .from("reservas")
      .select("fecha, estado, total, cantidad_turnos, duracion_minutos, simuladores, origen")
      .gte("fecha", desde).lte("fecha", hasta);
    if (error) throw error;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      if (String(r.estado ?? "") !== "activa") continue; // igual que 4E: solo actividad efectiva
      const origen = r.origen == null ? null : String(r.origen);
      if (origen === "empresa" || origen === "mensualidad") continue;
      const sims = Array.isArray(r.simuladores) ? (r.simuladores as unknown[]).length : 0;
      const personas = Math.max(1, sims);
      const durMin = Number(r.duracion_minutos) || 15;
      const turnos = Number(r.cantidad_turnos) || calcularTurnos(personas, durMin);
      filas.push({
        dia: String(r.fecha).slice(0, 10), fuente: "reservas", metodo: "", valor: Number(r.total) || 0,
        turnos, personas, operaciones: 1, minutos: turnos * 15,
      });
    }
  }

  if (filas.length === 0) advertencias.push("No hay actividad registrada en el período y los filtros pedidos.");
  return filas;
}

// ── Agrupación ──────────────────────────────────────────────────────────────────────────────
function claveDeAgrupacion(f: FilaDia, agruparPor: PlanAnalitico["agruparPor"]): string {
  switch (agruparPor) {
    case "dia": return f.dia;
    case "semana": return sumarDias(f.dia, -(isoDow(f.dia) - 1)); // lunes de esa semana
    case "mes": return f.dia.slice(0, 7);
    case "dia_semana": return String(isoDow(f.dia));
    case "fuente": return f.fuente;
    case "metodo_pago": return f.metodo || "desconocido";
    default: return "total";
  }
}

function etiquetaDeGrupo(clave: string, fechas: string[], agruparPor: PlanAnalitico["agruparPor"]): { etiqueta: string; detalle: string } {
  const orden = [...fechas].sort();
  const primera = orden[0] ?? clave;
  const ultima = orden[orden.length - 1] ?? primera;
  const dows = [...new Set(orden.map(isoDow))].sort((a, b) => a - b);
  const detalleDias = dows.length === 0 ? ""
    : dows.length === 1 ? DIAS_ISO[dows[0]]
    : dows.length === dows[dows.length - 1] - dows[0] + 1 ? `${DIAS_ISO[dows[0]]} a ${DIAS_ISO[dows[dows.length - 1]]}`
    : dows.map((d) => DIAS_ISO[d]).join(", ");

  switch (agruparPor) {
    case "dia": return { etiqueta: `${diaDelMes(primera)} de ${nombreMes(primera)}`, detalle: DIAS_ISO[isoDow(primera)] };
    case "semana": {
      const mismoMes = primera.slice(0, 7) === ultima.slice(0, 7);
      const etiqueta = primera === ultima
        ? `${diaDelMes(primera)} de ${nombreMes(primera)}`
        : mismoMes
          ? `${diaDelMes(primera)}–${diaDelMes(ultima)} de ${nombreMes(primera)}`
          : `${diaDelMes(primera)} de ${nombreMes(primera)} – ${diaDelMes(ultima)} de ${nombreMes(ultima)}`;
      return { etiqueta, detalle: detalleDias };
    }
    case "mes": {
      const [a, m] = clave.split("-").map(Number);
      return { etiqueta: `${MESES[m]} ${a}`, detalle: `${orden.length} días con datos` };
    }
    case "dia_semana": return { etiqueta: DIAS_ISO[Number(clave)], detalle: `${orden.length} fechas` };
    case "fuente": return { etiqueta: FUENTES_LABEL[clave] ?? clave, detalle: `${orden.length} días con datos` };
    case "metodo_pago": return { etiqueta: clave, detalle: `${orden.length} días con datos` };
    default: return { etiqueta: "Total", detalle: detalleDias };
  }
}

const valorDe = (f: FilaDia, metrica: PlanAnalitico["metrica"]): number => {
  switch (metrica) {
    case "facturacion_bruta": return f.valor;
    case "turnos": return f.turnos;
    case "personas": return f.personas;
    case "operaciones": return f.operaciones;
    case "minutos_actividad": return f.minutos;
    default: return 0;
  }
};

export async function ejecutarPlanAnalitico(p: PlanAnalitico): Promise<ResultadoAnalitico> {
  const advertencias: string[] = [];
  const familia = METRICAS[p.metrica].familia;

  let filas: FilaDia[];
  try {
    filas = familia === "contable" ? await filasContables(p, advertencias) : await filasActividad(p, advertencias);
  } catch {
    return { ok: false, motivo: "No se pudieron leer los datos internos para este período." };
  }

  // Filtros de día de la semana y método de pago (el de fuente ya se aplicó al consultar).
  if (p.filtros.diasSemana) {
    const permitidos = new Set(p.filtros.diasSemana);
    filas = filas.filter((f) => permitidos.has(isoDow(f.dia)));
  }
  if (p.filtros.metodosPago) {
    const permitidos = new Set(p.filtros.metodosPago.map((m) => m.toLowerCase()));
    filas = filas.filter((f) => permitidos.has((f.metodo || "").toLowerCase()));
  }

  // Agrupación.
  const grupos = new Map<string, { valor: number; fechas: Set<string> }>();
  for (const f of filas) {
    const clave = claveDeAgrupacion(f, p.agruparPor);
    const g = grupos.get(clave) ?? { valor: 0, fechas: new Set<string>() };
    g.valor += valorDe(f, p.metrica);
    g.fechas.add(f.dia);
    grupos.set(clave, g);
  }

  let armadas: FilaAnalitica[] = [...grupos.entries()].map(([clave, g]) => {
    const fechas = [...g.fechas].sort();
    const { etiqueta, detalle } = etiquetaDeGrupo(clave, fechas, p.agruparPor);
    return { clave, etiqueta, detalle, fechas, dias: fechas.length, valor: Math.round(g.valor * 100) / 100 };
  });

  const temporal = p.agruparPor === "dia" || p.agruparPor === "semana" || p.agruparPor === "mes";
  armadas.sort((a, b) =>
    p.orden === "mayor_a_menor" ? b.valor - a.valor
      : temporal ? a.clave.localeCompare(b.clave)
      : p.agruparPor === "dia_semana" ? Number(a.clave) - Number(b.clave)
      : b.valor - a.valor,
  );

  const truncado = armadas.length > p.limite;
  if (truncado) {
    armadas = armadas.slice(0, p.limite);
    advertencias.push(`Se muestran las primeras ${p.limite} filas de ${grupos.size}.`);
  }

  // Total y días SIEMPRE sobre el universo filtrado completo (no sobre las filas truncadas).
  const total = Math.round(filas.reduce((a, f) => a + valorDe(f, p.metrica), 0) * 100) / 100;
  const totalDias = new Set(filas.map((f) => f.dia)).size;

  const porFuenteMap = new Map<string, number>();
  for (const f of filas) porFuenteMap.set(f.fuente, (porFuenteMap.get(f.fuente) ?? 0) + valorDe(f, p.metrica));
  const porFuente = [...porFuenteMap.entries()]
    .map(([fuente, valor]) => ({ fuente, etiqueta: FUENTES_LABEL[fuente] ?? (fuente === "stand" ? "Turnero del stand" : fuente === "reservas" ? "Reservas online" : fuente), valor: Math.round(valor * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor);

  const fuentesInternas = familia === "contable"
    ? ["Finanzas SIM · ingresos por fuente (Turnero por fecha de servicio; Reservas, Gift cards y Campeonatos por fecha de pago)"]
    : ["Métricas Stand y Reservas web (por fecha de servicio)"];

  return {
    ok: true,
    metrica: p.metrica,
    etiquetaMetrica: METRICAS[p.metrica].etiqueta,
    unidad: METRICAS[p.metrica].unidad,
    ventana: p.ventana,
    filtros: p.filtros,
    agruparPor: p.agruparPor,
    filas: armadas,
    total,
    totalDias,
    porFuente,
    fuentesInternas,
    advertencias,
    truncado,
  };
}

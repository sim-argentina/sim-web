// IA SIM · Bloque 5A — EJECUTOR del plan analítico interno. Solo lectura, parametrizado.
//
// Reutiliza las definiciones YA vigentes, sin crear una segunda versión de nada:
//  · facturacion_bruta → facturación TOTAL OPERATIVA BRUTA, leída de la fuente canónica
//    fin_eventos_facturacion (lib/facturacionEventos.ts). Este archivo no enumera fuentes:
//    las que Finanzas reconozca hoy o incorpore mañana entran solas. La paridad con Finanzas
//    está cubierta por una prueba contractual.
//  · turnos/personas/operaciones/minutos → Stand + Reservas por fecha de servicio, con los
//    mismos helpers canónicos de Métricas Stand (turnosDeFila/personasDeFila) y, desde B8,
//    los minutos y turnos comerciales por la modalidad de cada fila (lib/minutosComerciales:
//    legacy igual que siempre; v2 duración × personas, sin buffer).
//
// El modelo nunca llega hasta acá con texto libre: llega un PlanAnalitico ya validado.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { FUENTES_LABEL } from "@/lib/finanzas";
import { minutosComercialesStand, turnosDeFila, personasDeFila, totalDeFila, type FilaStand } from "@/lib/metricasStand";
import { minutosComercialesReserva, turnosComercialesReserva } from "@/lib/minutosComerciales";
import { leerEventosFacturacion, fuentesPresentes } from "@/lib/facturacionEventos";
import { METRICAS, type PlanAnalitico } from "@/lib/ia/analisis/planAnalitico";

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

type FilaDia = { dia: string; fuente: string; metodo: string; valor: number; turnos: number; personas: number; operaciones: number; minutos: number };

// ── Recolección CONTABLE: la composición NO se enumera acá ──────────────────────────────────
// Se lee la fuente canónica (fin_eventos_facturacion). Cualquier fuente que Finanzas incorpore
// a esa función —mensualidades, ingresos manuales operativos o una futura— entra sola, sin
// tocar este archivo. Antes esto era una copia a mano de cuatro fuentes, y divergió.
async function filasContables(p: PlanAnalitico, advertencias: string[]): Promise<FilaDia[]> {
  const eventos = await leerEventosFacturacion(p.ventana.desde, p.ventana.hasta);
  const base = { turnos: 0, personas: 0, operaciones: 0, minutos: 0 };

  const pedidas = p.filtros.fuentes;
  const elegidos = pedidas ? eventos.filter((e) => pedidas.includes(e.fuente)) : eventos;

  if (eventos.length === 0) {
    advertencias.push("No hay ingresos registrados en el período y los filtros pedidos.");
  } else if (pedidas && elegidos.length === 0) {
    // El modelo pidió filtrar por una fuente que en este período no tiene movimientos: se le
    // dice cuáles sí los tienen, sin mantener ninguna lista fija de fuentes.
    advertencias.push(
      `No hay ingresos de ${pedidas.join(", ")} en el período. Las fuentes con movimientos son: ${fuentesPresentes(eventos).join(", ")}.`,
    );
  }

  return elegidos.map((e) => ({ ...base, dia: e.fechaContable, fuente: e.fuente, metodo: e.metodo, valor: e.monto }));
}

// ── Recolección de ACTIVIDAD (Stand + Reservas por fecha de servicio, base de 4E) ────────────
async function filasActividad(p: PlanAnalitico, advertencias: string[]): Promise<FilaDia[]> {
  const { desde, hasta } = p.ventana;
  const quiere = (f: string) => !p.filtros.fuentes || p.filtros.fuentes.includes(f);
  const filas: FilaDia[] = [];

  if (quiere("stand")) {
    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .select("fecha, estado, total, metodo_pago, cantidad_personas, cantidad_simuladores, cantidad_turnos, cantidad_minutos, modalidad")
      .gte("fecha", desde).lte("fecha", hasta);
    if (error) throw error;
    for (const t of (data ?? []) as Array<Record<string, unknown>>) {
      const estado = String(t.estado ?? "").toLowerCase();
      if (estado === "anulado" || estado === "cancelado") continue; // regla canónica de Métricas Stand
      const turnos = turnosDeFila(t as unknown as FilaStand);
      filas.push({
        dia: String(t.fecha).slice(0, 10), fuente: "stand", metodo: "", valor: totalDeFila(t as unknown as FilaStand),
        turnos, personas: personasDeFila(t as unknown as FilaStand), operaciones: 1, minutos: minutosComercialesStand(t as unknown as FilaStand),
      });
    }
  }

  if (quiere("reservas")) {
    const { data, error } = await supabaseAdmin
      .from("reservas")
      .select("fecha, estado, total, cantidad_turnos, duracion_minutos, simuladores, origen, modalidad")
      .gte("fecha", desde).lte("fecha", hasta);
    if (error) throw error;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      if (String(r.estado ?? "") !== "activa") continue; // igual que 4E: solo actividad efectiva
      const origen = r.origen == null ? null : String(r.origen);
      if (origen === "empresa" || origen === "mensualidad") continue;
      const sims = Array.isArray(r.simuladores) ? (r.simuladores as unknown[]).length : 0;
      const personas = Math.max(1, sims);
      const turnos = turnosComercialesReserva(r, "calcular");
      filas.push({
        dia: String(r.fecha).slice(0, 10), fuente: "reservas", metodo: "", valor: Number(r.total) || 0,
        turnos, personas, operaciones: 1, minutos: minutosComercialesReserva(r, "calcular"),
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
    ? ["Finanzas SIM · facturación total operativa bruta, composición canónica (Turnero por fecha de servicio; lo web, Gift cards, Campeonatos y Mensualidades por fecha de pago; ingresos manuales por su fecha contable)"]
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

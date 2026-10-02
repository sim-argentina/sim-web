// IA SIM · Bloque 5B — EJECUTOR del plan analítico interno. Solo lectura, parametrizado.
//
// Reutiliza las definiciones YA vigentes, sin crear una segunda versión de nada:
//  · universo FACTURACIÓN → fuente canónica fin_eventos_facturacion (lib/facturacionEventos.ts).
//    Este archivo no enumera fuentes: las que Finanzas reconozca hoy o incorpore mañana entran
//    solas. La paridad con Finanzas está cubierta por una prueba contractual.
//  · universo ACTIVIDAD → Stand + Reservas por fecha de SERVICIO, con los helpers canónicos de
//    Métricas Stand y los minutos/turnos comerciales de la modalidad PERSISTIDA de cada fila
//    (lib/minutosComerciales: legacy conserva su fórmula; v2 usa la duración real por persona).
//    Nunca se hardcodean 15 ni 30 minutos.
//
// El modelo nunca llega hasta acá con texto libre: llega un PlanAnalitico ya validado.
//
// Los días sin movimientos EXISTEN: en una agrupación temporal se materializa todo el calendario
// del período (respetando el filtro de días), así el promedio por día calendario y el peor día
// no mienten por omisión.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { FUENTES_LABEL } from "@/lib/finanzas";
import { minutosComercialesStand, turnosDeFila, personasDeFila, numeroStand, type FilaStand } from "@/lib/metricasStand";
import { minutosComercialesReserva, turnosComercialesReserva, modalidadDeFila, simuladoresDeReserva, etiquetaDuracion } from "@/lib/minutosComerciales";
import { leerEventosFacturacion, fuentesPresentes } from "@/lib/facturacionEventos";
import { METRICAS_SEMANTICAS, DIMENSIONES, type Dimension } from "@/lib/ia/analisis/catalogoSemantico";
import type { PlanAnalitico, SegmentacionPlan } from "@/lib/ia/analisis/planAnalitico";

const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_ISO = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const conMayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type ValorMetrica = { metrica: string; etiqueta: string; unidad: string; valor: number };

export type FilaAnalitica = {
  claves: string[];
  etiquetas: string[];
  detalle: string;
  fechas: string[];
  dias: number;
  valores: ValorMetrica[];
  /** Participación sobre el total del período, por métrica, cuando se pidió el cálculo. */
  participacion: number[] | null;
  /** Hay otra fila con el mismo valor en la métrica principal. */
  empate: boolean;
};

export type Extremo = { etiqueta: string; detalle: string; valores: ValorMetrica[] } | null;

export type ResumenGrupo = {
  etiqueta: string;
  diasCalendario: number;
  diasConDatos: number;
  totales: ValorMetrica[];
  promedioDiaCalendario: ValorMetrica[];
  mejor: Extremo;
  peor: Extremo;
  porFuente: Array<{ fuente: string; etiqueta: string; valores: ValorMetrica[] }>;
};

export type Comparacion = {
  etiquetaBase: string;
  etiquetaComparado: string;
  diferencia: ValorMetrica[];
  variacionPct: Array<{ metrica: string; etiqueta: string; valor: number | null; motivo?: string }>;
};

export type ResultadoAnalitico =
  | {
      ok: true;
      universo: string;
      metricas: Array<{ id: string; etiqueta: string; unidad: string; definicion: string }>;
      ventana: { desde: string; hasta: string };
      filtros: PlanAnalitico["filtros"];
      dimensiones: Dimension[];
      etiquetasDimensiones: string[];
      calculos: string[];
      filas: FilaAnalitica[];
      resumen: ResumenGrupo;
      segmentos: ResumenGrupo[] | null;
      comparacion: Comparacion | null;
      ranking: { sentido: string; n: number } | null;
      fuentesInternas: string[];
      criterio: string;
      advertencias: string[];
      truncado: boolean;
    }
  | { ok: false; motivo: string };

// ── Fechas ──────────────────────────────────────────────────────────────────────
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

/** Todos los días calendario del período que cumplen el filtro de días (los ceros incluidos). */
function diasDelPeriodo(desde: string, hasta: string, diasSemana: number[] | null): string[] {
  const out: string[] = [];
  const permitidos = diasSemana ? new Set(diasSemana) : null;
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    if (!permitidos || permitidos.has(isoDow(f))) out.push(f);
  }
  return out;
}

// ── Hechos ──────────────────────────────────────────────────────────────────────
type Hecho = {
  dia: string;
  fuente: string;
  clase: string;
  metodo: string;
  modalidad: string;
  duracion: string;
  simuladores: number;
  valores: Record<string, number>;
};

async function hechosFacturacion(p: PlanAnalitico, advertencias: string[]): Promise<Hecho[]> {
  const eventos = await leerEventosFacturacion(p.ventana.desde, p.ventana.hasta);
  if (eventos.length === 0) {
    advertencias.push("No hay ingresos registrados en el período pedido.");
    return [];
  }
  // Las métricas de importe salen de la DECLARACIÓN del catálogo: si una métrica restringe su
  // clase, se respeta sola. Así la regla vive en un solo lugar y no se repite acá.
  const metricasImporte = Object.values(METRICAS_SEMANTICAS).filter((m) => m.universo === "facturacion" && m.unidad === "ars");
  const hechos: Hecho[] = eventos.map((e) => {
    const valores: Record<string, number> = { cobros: 1 };
    for (const m of metricasImporte) valores[m.id] = !m.claseFacturacion || m.claseFacturacion === e.clase ? e.monto : 0;
    return { dia: e.fechaContable, fuente: e.fuente, clase: e.clase, metodo: e.metodo, modalidad: "", duracion: "", simuladores: 0, valores };
  });
  if (p.filtros.fuentes && !hechos.some((h) => p.filtros.fuentes!.includes(h.fuente))) {
    advertencias.push(`No hay ingresos de ${p.filtros.fuentes.join(", ")} en el período. Las fuentes con movimientos son: ${fuentesPresentes(eventos).join(", ")}.`);
  }
  return hechos;
}

async function hechosActividad(p: PlanAnalitico, advertencias: string[]): Promise<Hecho[]> {
  const { desde, hasta } = p.ventana;
  const quiere = (f: string) => !p.filtros.fuentes || p.filtros.fuentes.includes(f);
  const hechos: Hecho[] = [];

  if (quiere("stand")) {
    const { data, error } = await supabaseAdmin
      .from("turnos_stand")
      .select("fecha, estado, total, metodo_pago, cantidad_personas, cantidad_simuladores, cantidad_turnos, cantidad_minutos, modalidad")
      .gte("fecha", desde).lte("fecha", hasta);
    if (error) throw error;
    for (const t of (data ?? []) as Array<Record<string, unknown>>) {
      const estado = String(t.estado ?? "").toLowerCase();
      if (estado === "anulado" || estado === "cancelado") continue; // regla canónica de Métricas Stand
      const fila = t as unknown as FilaStand;
      const modalidad = modalidadDeFila(t.modalidad);
      hechos.push({
        dia: String(t.fecha).slice(0, 10),
        fuente: "stand",
        clase: "",
        metodo: "",
        modalidad,
        duracion: etiquetaDuracion(modalidad, t.cantidad_minutos),
        simuladores: numeroStand(t.cantidad_simuladores) || personasDeFila(fila),
        valores: {
          turnos: turnosDeFila(fila),
          personas: personasDeFila(fila),
          operaciones: 1,
          minutos_actividad: minutosComercialesStand(fila),
        },
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
      const modalidad = modalidadDeFila(r.modalidad);
      const sims = Math.max(1, simuladoresDeReserva(r));
      hechos.push({
        dia: String(r.fecha).slice(0, 10),
        fuente: "reservas",
        clase: "",
        metodo: "",
        modalidad,
        duracion: etiquetaDuracion(modalidad, r.duracion_minutos),
        simuladores: sims,
        valores: {
          turnos: turnosComercialesReserva(r, "calcular"),
          personas: sims,
          operaciones: 1,
          minutos_actividad: minutosComercialesReserva(r, "calcular"),
        },
      });
    }
  }

  if (hechos.length === 0) advertencias.push("No hay actividad registrada en el período pedido.");
  return hechos;
}

// ── Filtros ─────────────────────────────────────────────────────────────────────
function aplicarFiltros(hechos: Hecho[], f: PlanAnalitico["filtros"]): Hecho[] {
  let out = hechos;
  if (f.diasSemana) { const s = new Set(f.diasSemana); out = out.filter((h) => s.has(isoDow(h.dia))); }
  if (f.fuentes) { const s = new Set(f.fuentes); out = out.filter((h) => s.has(h.fuente)); }
  if (f.clases) { const s = new Set(f.clases); out = out.filter((h) => s.has(h.clase)); }
  if (f.metodosPago) { const s = new Set(f.metodosPago.map((m) => m.toLowerCase())); out = out.filter((h) => s.has(h.metodo.toLowerCase())); }
  if (f.modalidades) { const s = new Set(f.modalidades); out = out.filter((h) => s.has(h.modalidad)); }
  if (f.duraciones) { const s = new Set(f.duraciones.map((d) => `${d} min`)); out = out.filter((h) => s.has(h.duracion)); }
  if (f.simuladores) { const s = new Set(f.simuladores); out = out.filter((h) => s.has(h.simuladores)); }
  return out;
}

// ── Dimensiones ─────────────────────────────────────────────────────────────────
function claveDim(h: Hecho, dim: Dimension): string {
  switch (dim) {
    case "dia": return h.dia;
    case "semana": return sumarDias(h.dia, -(isoDow(h.dia) - 1)); // lunes de esa semana
    case "mes": return h.dia.slice(0, 7);
    case "dia_semana": return String(isoDow(h.dia));
    case "fuente": return h.fuente;
    case "clase": return h.clase || "—";
    case "metodo_pago": return h.metodo || "desconocido";
    case "modalidad": return h.modalidad || "—";
    case "duracion": return h.duracion || "—";
    case "simuladores": return String(h.simuladores);
  }
}

function etiquetaDim(clave: string, dim: Dimension, fechas: string[]): string {
  switch (dim) {
    case "dia": return `${diaDelMes(clave)} de ${nombreMes(clave)}`;
    case "semana": {
      const orden = [...fechas].sort();
      const primera = orden[0] ?? clave;
      const ultima = orden[orden.length - 1] ?? primera;
      if (primera === ultima) return `${diaDelMes(primera)} de ${nombreMes(primera)}`;
      return primera.slice(0, 7) === ultima.slice(0, 7)
        ? `${diaDelMes(primera)}–${diaDelMes(ultima)} de ${nombreMes(primera)}`
        : `${diaDelMes(primera)} de ${nombreMes(primera)} – ${diaDelMes(ultima)} de ${nombreMes(ultima)}`;
    }
    case "mes": { const [a, m] = clave.split("-").map(Number); return `${MESES[m]} ${a}`; }
    case "dia_semana": return conMayuscula(DIAS_ISO[Number(clave)]);
    case "fuente": return FUENTES_LABEL[clave] ?? (clave === "stand" ? "Turnero del stand" : clave === "reservas" ? "Reservas online" : clave);
    case "clase": return clave === "automatico" ? "Automático" : clave === "manual" ? "Manual" : clave;
    case "metodo_pago": return clave;
    case "modalidad": return clave === "v2_10" ? "v2 (10/20/30)" : "Legacy";
    case "duracion": return clave;
    case "simuladores": return `${clave} simulador${clave === "1" ? "" : "es"}`;
  }
}

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function valoresDe(hechos: Hecho[], metricas: string[]): ValorMetrica[] {
  return metricas.map((id) => {
    const def = METRICAS_SEMANTICAS[id];
    return { metrica: id, etiqueta: def.etiqueta, unidad: def.unidad, valor: redondear(hechos.reduce((a, h) => a + (h.valores[id] ?? 0), 0)) };
  });
}

// ── Resumen de un grupo (todo el período, o un segmento) ────────────────────────
function resumirGrupo(etiqueta: string, hechos: Hecho[], diasCalendario: string[], metricas: string[]): ResumenGrupo {
  const totales = valoresDe(hechos, metricas);
  const nDias = diasCalendario.length;

  const porDia = new Map<string, Hecho[]>();
  for (const d of diasCalendario) porDia.set(d, []); // los días sin movimientos EXISTEN
  for (const h of hechos) { const arr = porDia.get(h.dia); if (arr) arr.push(h); }

  const dias = [...porDia.entries()].map(([dia, hs]) => ({ dia, valores: valoresDe(hs, metricas) }));
  const principal = metricas[0];
  const valorPrincipal = (x: { valores: ValorMetrica[] }) => x.valores.find((v) => v.metrica === principal)?.valor ?? 0;
  const ordenados = [...dias].sort((a, b) => valorPrincipal(b) - valorPrincipal(a) || a.dia.localeCompare(b.dia));

  const extremo = (x: { dia: string; valores: ValorMetrica[] } | undefined): Extremo =>
    x ? { etiqueta: `${diaDelMes(x.dia)} de ${nombreMes(x.dia)}`, detalle: DIAS_ISO[isoDow(x.dia)], valores: x.valores } : null;

  const porFuenteMap = new Map<string, Hecho[]>();
  for (const h of hechos) {
    const arr = porFuenteMap.get(h.fuente) ?? [];
    arr.push(h);
    porFuenteMap.set(h.fuente, arr);
  }
  const porFuente = [...porFuenteMap.entries()]
    .map(([fuente, hs]) => ({ fuente, etiqueta: etiquetaDim(fuente, "fuente", []), valores: valoresDe(hs, metricas) }))
    .sort((a, b) => (b.valores[0]?.valor ?? 0) - (a.valores[0]?.valor ?? 0) || a.fuente.localeCompare(b.fuente));

  return {
    etiqueta,
    diasCalendario: nDias,
    diasConDatos: new Set(hechos.map((h) => h.dia)).size,
    totales,
    promedioDiaCalendario: totales.map((t) => ({ ...t, valor: nDias > 0 ? redondear(t.valor / nDias) : 0 })),
    mejor: extremo(ordenados[0]),
    peor: extremo(ordenados[ordenados.length - 1]),
    porFuente,
  };
}

// ── Segmentación ────────────────────────────────────────────────────────────────
function pertenece(h: Hecho, seg: SegmentacionPlan, grupo: "A" | "B"): boolean {
  const valores = grupo === "A" ? seg.grupoA : seg.grupoB;
  if (seg.tipo === "dias_semana") return valores.includes(String(isoDow(h.dia)));
  if (seg.tipo === "clase") return valores.includes(h.clase);
  return valores.includes(h.fuente);
}

function diasDelSegmento(desde: string, hasta: string, diasSemana: number[] | null, seg: SegmentacionPlan, grupo: "A" | "B"): string[] {
  const base = diasDelPeriodo(desde, hasta, diasSemana);
  if (seg.tipo !== "dias_semana") return base; // segmentar por clase o fuente no recorta el calendario
  const permitidos = new Set((grupo === "A" ? seg.grupoA : seg.grupoB).map(Number));
  return base.filter((f) => permitidos.has(isoDow(f)));
}

// ── Criterio declarado ──────────────────────────────────────────────────────────
function criterioDe(p: PlanAnalitico): string {
  if (p.universo === "facturacion") {
    return "Facturación total operativa bruta, con la composición canónica de Finanzas: el Turnero del stand se imputa por fecha de servicio; Reservas online, Gift cards, Campeonatos y Mensualidades por fecha de pago; los ingresos manuales por su fecha contable. No incluye transferencias entre cuentas, préstamos, ajustes de saldo ni el Colectivo.";
  }
  return "Actividad del Turnero del stand y de las reservas web por fecha de servicio. Los turnos y los minutos se calculan con la modalidad persistida de cada operación (legacy conserva su fórmula histórica; v2 usa la duración real por persona) y nunca incluyen el buffer de agenda.";
}

// ── Ejecución ───────────────────────────────────────────────────────────────────
export async function ejecutarPlanAnalitico(p: PlanAnalitico): Promise<ResultadoAnalitico> {
  const advertencias: string[] = [];

  let hechos: Hecho[];
  try {
    hechos = p.universo === "facturacion" ? await hechosFacturacion(p, advertencias) : await hechosActividad(p, advertencias);
  } catch {
    return { ok: false, motivo: "No se pudieron leer los datos internos para este período." };
  }
  hechos = aplicarFiltros(hechos, p.filtros);

  const diasCalendario = diasDelPeriodo(p.ventana.desde, p.ventana.hasta, p.filtros.diasSemana);
  const resumen = resumirGrupo("Total del período", hechos, diasCalendario, p.metricas);

  // ── Filas por dimensión ───────────────────────────────────────────────────────
  const dims = p.dimensiones;
  let filas: FilaAnalitica[] = [];
  let totalGrupos = 0;

  if (dims.length > 0) {
    const grupos = new Map<string, { claves: string[]; hechos: Hecho[]; fechas: Set<string> }>();

    // Con UNA dimensión temporal se materializa todo el calendario: un día en cero es un dato,
    // y sin él el promedio y el peor día saldrían mal.
    if (dims.length === 1 && DIMENSIONES[dims[0]].temporal) {
      for (const d of diasCalendario) {
        const clave = claveDim({ dia: d, fuente: "", clase: "", metodo: "", modalidad: "", duracion: "", simuladores: 0, valores: {} }, dims[0]);
        const g = grupos.get(clave) ?? { claves: [clave], hechos: [], fechas: new Set<string>() };
        g.fechas.add(d);
        grupos.set(clave, g);
      }
    }

    for (const h of hechos) {
      const claves = dims.map((d) => claveDim(h, d));
      const clave = claves.join(" | ");
      const g = grupos.get(clave) ?? { claves, hechos: [], fechas: new Set<string>() };
      g.hechos.push(h);
      g.fechas.add(h.dia);
      grupos.set(clave, g);
    }

    filas = [...grupos.values()].map((g) => {
      const fechas = [...g.fechas].sort();
      const valores = valoresDe(g.hechos, p.metricas);
      const unaTemporal = dims.length === 1 && DIMENSIONES[dims[0]].temporal;
      return {
        claves: g.claves,
        etiquetas: g.claves.map((c, i) => etiquetaDim(c, dims[i], fechas)),
        detalle: unaTemporal && dims[0] === "dia"
          ? DIAS_ISO[isoDow(fechas[0] ?? g.claves[0])]
          : `${fechas.length} día${fechas.length === 1 ? "" : "s"}${unaTemporal ? "" : " con datos"}`,
        fechas,
        dias: fechas.length,
        valores,
        participacion: p.calculos.includes("participacion")
          ? valores.map((v) => {
              const total = resumen.totales.find((t) => t.metrica === v.metrica)?.valor ?? 0;
              return total === 0 ? 0 : redondear((v.valor / total) * 100);
            })
          : null,
        empate: false,
      };
    });

    // Orden determinístico: por valor o cronológico, y SIEMPRE con la clave como desempate.
    const vp = (f: FilaAnalitica) => f.valores.find((v) => v.metrica === p.metricas[0])?.valor ?? 0;
    const claveOrden = (f: FilaAnalitica) => f.claves.join(" | ");
    if (p.orden === "cronologico") filas.sort((a, b) => claveOrden(a).localeCompare(claveOrden(b)));
    else if (p.orden === "menor_a_mayor") filas.sort((a, b) => vp(a) - vp(b) || claveOrden(a).localeCompare(claveOrden(b)));
    else filas.sort((a, b) => vp(b) - vp(a) || claveOrden(a).localeCompare(claveOrden(b)));

    // Empates visibles: si dos filas valen lo mismo en la métrica principal, se marca.
    const conteo = new Map<number, number>();
    for (const f of filas) conteo.set(vp(f), (conteo.get(vp(f)) ?? 0) + 1);
    for (const f of filas) f.empate = (conteo.get(vp(f)) ?? 0) > 1;

    totalGrupos = filas.length;

    if (p.ranking) {
      const asc = p.ranking.sentido === "peores";
      filas = [...filas]
        .sort((a, b) => (asc ? vp(a) - vp(b) : vp(b) - vp(a)) || claveOrden(a).localeCompare(claveOrden(b)))
        .slice(0, p.ranking.n);
    }
  }

  const truncado = filas.length > p.limite;
  if (truncado) {
    advertencias.push(`Se muestran las primeras ${p.limite} filas de ${totalGrupos}.`);
    filas = filas.slice(0, p.limite);
  }

  // ── Segmentación en dos grupos ────────────────────────────────────────────────
  let segmentos: ResumenGrupo[] | null = null;
  let comparacion: Comparacion | null = null;
  if (p.segmentacion) {
    const seg = p.segmentacion;
    const rA = resumirGrupo(seg.etiquetaA, hechos.filter((h) => pertenece(h, seg, "A")), diasDelSegmento(p.ventana.desde, p.ventana.hasta, p.filtros.diasSemana, seg, "A"), p.metricas);
    const rB = resumirGrupo(seg.etiquetaB, hechos.filter((h) => pertenece(h, seg, "B")), diasDelSegmento(p.ventana.desde, p.ventana.hasta, p.filtros.diasSemana, seg, "B"), p.metricas);
    segmentos = [rA, rB];

    if (p.calculos.includes("diferencia") || p.calculos.includes("variacion_pct")) {
      // Base = primer grupo, comparado = segundo. Diferencia = comparado − base.
      comparacion = {
        etiquetaBase: rA.etiqueta,
        etiquetaComparado: rB.etiqueta,
        diferencia: rB.totales.map((t, i) => ({ ...t, valor: redondear(t.valor - (rA.totales[i]?.valor ?? 0)) })),
        variacionPct: rB.totales.map((t, i) => {
          const base = rA.totales[i]?.valor ?? 0;
          if (base === 0) return { metrica: t.metrica, etiqueta: t.etiqueta, valor: null, motivo: "la base es cero: la variación porcentual no es calculable" };
          return { metrica: t.metrica, etiqueta: t.etiqueta, valor: redondear(((t.valor - base) / Math.abs(base)) * 100) };
        }),
      };
    }
  }

  return {
    ok: true,
    universo: p.universo,
    metricas: p.metricas.map((id) => ({ id, etiqueta: METRICAS_SEMANTICAS[id].etiqueta, unidad: METRICAS_SEMANTICAS[id].unidad, definicion: METRICAS_SEMANTICAS[id].definicion })),
    ventana: p.ventana,
    filtros: p.filtros,
    dimensiones: dims,
    etiquetasDimensiones: dims.map((d) => DIMENSIONES[d].etiqueta),
    calculos: p.calculos,
    filas,
    resumen,
    segmentos,
    comparacion,
    ranking: p.ranking,
    fuentesInternas: p.universo === "facturacion"
      ? ["Finanzas SIM · facturación total operativa bruta, composición canónica"]
      : ["Métricas Stand y Reservas web (por fecha de servicio, con la modalidad persistida de cada fila)"],
    criterio: criterioDe(p),
    advertencias,
    truncado,
  };
}

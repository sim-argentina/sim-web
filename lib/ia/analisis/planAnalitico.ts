// IA SIM · Bloque 5A — Contrato y VALIDACIÓN del plan analítico interno. Puro (sin DB).
//
// El modelo nunca escribe SQL ni nombra tablas/columnas: solo propone un plan con valores de
// listas CERRADAS. Este módulo lo valida y lo normaliza; el ejecutor recién trabaja sobre un
// plan ya validado. Si el plan es inválido se devuelve un error ESTRUCTURADO (reparable), nunca
// una ejecución parcial.

import { resolverMesRelativo, ventanaHoy, ventanaAyer, ventanaEstaSemana, ventanaSemanaPasada, ventanaEsteAnio, ventanaAnioPasado } from "@/lib/ia/analisis/periodoRelativo";
import { ventanaMes } from "@/lib/ia/analisis/periodos";

// ── Métricas ────────────────────────────────────────────────────────────────────
// Dos familias, cada una con su base de imputación YA vigente en el sistema:
//  · contable  → definición de Finanzas (fin_ingresos_por_mes): 4 fuentes, lo web por fecha de PAGO.
//  · actividad → Stand + Reservas por fecha de SERVICIO (misma base que métricas de equipo/4E).
// No se inventa una tercera definición de "facturación".
export const METRICAS = {
  facturacion_bruta: { familia: "contable", etiqueta: "Facturación bruta", unidad: "ars" },
  turnos: { familia: "actividad", etiqueta: "Turnos", unidad: "turnos" },
  personas: { familia: "actividad", etiqueta: "Personas", unidad: "personas" },
  operaciones: { familia: "actividad", etiqueta: "Operaciones", unidad: "cantidad" },
  minutos_actividad: { familia: "actividad", etiqueta: "Minutos de actividad", unidad: "minutos" },
} as const;
export type Metrica = keyof typeof METRICAS;
export const METRICAS_VALIDAS = Object.keys(METRICAS) as Metrica[];

// Métricas que existen en SIM pero que esta herramienta NO puede calcular por día: se informa
// con claridad a qué herramienta ir, en vez de inventar una definición diaria.
export const METRICAS_DERIVADAS_A_OTRA_HERRAMIENTA: Record<string, string> = {
  facturacion_neta: "La facturación NETA se calcula con el motor de comisiones por mes: pedila con consultar_finanzas (o comparar_periodos para dos meses).",
  ingresos_netos: "Los ingresos netos son mensuales (descuentan comisiones): usá consultar_finanzas.",
  ganancia: "La ganancia es mensual (ingresos − costos − gastos − inversiones − sueldo): usá consultar_finanzas.",
  horas_cronograma: "Las horas de cronograma se atribuyen por jornada/empleado, no por fecha de cobro: usá consultar_metricas_equipo o consultar_cronograma.",
};

export const FUENTES_CONTABLES = ["turnero", "reservas_online", "gift_cards", "campeonatos"] as const;
export const FUENTES_ACTIVIDAD = ["stand", "reservas"] as const;
export type FuenteContable = (typeof FUENTES_CONTABLES)[number];
export type FuenteActividad = (typeof FUENTES_ACTIVIDAD)[number];

export const AGRUPACIONES = ["ninguno", "dia", "semana", "mes", "dia_semana", "fuente", "metodo_pago"] as const;
export type Agrupacion = (typeof AGRUPACIONES)[number];

export const ORDENES = ["cronologico", "mayor_a_menor"] as const;
export type Orden = (typeof ORDENES)[number];

export const LIMITE_MAX = 200;
export const LIMITE_DEFAULT = 100;
export const RANGO_MAX_DIAS = 750; // ~2 años: suficiente para interanual, acotado para el motor.

export type VentanaPlan = { desde: string; hasta: string };

export type PlanAnalitico = {
  metrica: Metrica;
  ventana: VentanaPlan;
  filtros: {
    diasSemana: number[] | null; // ISO 1=lunes .. 7=domingo
    fuentes: string[] | null;
    metodosPago: string[] | null;
  };
  agruparPor: Agrupacion;
  orden: Orden;
  limite: number;
};

export type PlanInvalido = { ok: false; error: string; campo?: string };
export type PlanValido = { ok: true; plan: PlanAnalitico };

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_MES = /^\d{4}-\d{2}$/;
// Método de pago: texto corto y acotado; nunca se interpola en SQL (va parametrizado), pero se
// valida igual para no arrastrar basura ni intentos de inyección a los filtros.
const RE_METODO = /^[a-zA-Z0-9 _\-áéíóúñÁÉÍÓÚÑ]{1,40}$/;

const DIAS_TEXTO: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6, domingo: 7,
};

function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(5, 7)) - 1, Number(desde.slice(8, 10)));
  const b = Date.UTC(Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7)) - 1, Number(hasta.slice(8, 10)));
  return Math.round((b - a) / 86_400_000) + 1;
}

function fechaValida(f: unknown): f is string {
  if (typeof f !== "string" || !RE_FECHA.test(f)) return false;
  const [a, m, d] = f.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(a, m - 1, d));
  return probe.getUTCFullYear() === a && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// Resuelve el período pedido a una ventana concreta de fechas (Córdoba, reloj inyectable).
export function resolverVentana(periodo: Record<string, unknown> | undefined, ahora: Date = new Date()): PlanValido["plan"]["ventana"] | PlanInvalido {
  const p = periodo ?? {};
  const tipo = typeof p.tipo === "string" ? p.tipo : undefined;

  if (tipo === "mes" || (typeof p.mes === "string" && !tipo)) {
    const mes = String(p.mes ?? "");
    if (!RE_MES.test(mes)) return { ok: false, error: `Mes inválido: "${mes}". Usá "YYYY-MM".`, campo: "periodo.mes" };
    const [anio, m] = mes.split("-").map(Number);
    if (m < 1 || m > 12 || anio < 2020 || anio > 2100) return { ok: false, error: `Mes fuera de rango: "${mes}".`, campo: "periodo.mes" };
    return ventanaMes(anio, m);
  }

  if (tipo === "relativo" || typeof p.relativo === "string") {
    const token = String(p.relativo ?? "");
    if (token === "este_mes" || token === "mes_pasado" || token === "mismo_mes_anio_pasado") {
      const { anio, mes } = resolverMesRelativo(token, ahora);
      return ventanaMes(anio, mes);
    }
    if (token === "hoy") return ventanaHoy(ahora);
    if (token === "ayer") return ventanaAyer(ahora);
    if (token === "esta_semana") return ventanaEstaSemana(ahora);
    if (token === "semana_pasada") return ventanaSemanaPasada(ahora);
    if (token === "este_anio") return ventanaEsteAnio(ahora);
    if (token === "anio_pasado") return ventanaAnioPasado(ahora);
    return { ok: false, error: `Período relativo desconocido: "${token}".`, campo: "periodo.relativo" };
  }

  if (fechaValida(p.desde) && fechaValida(p.hasta)) {
    const desde = String(p.desde), hasta = String(p.hasta);
    if (hasta < desde) return { ok: false, error: "El fin del rango es anterior al inicio.", campo: "periodo" };
    const n = diasEntre(desde, hasta);
    if (n > RANGO_MAX_DIAS) return { ok: false, error: `El rango pedido (${n} días) supera el máximo de ${RANGO_MAX_DIAS} días.`, campo: "periodo" };
    return { desde, hasta };
  }

  return { ok: false, error: 'Falta el período: usá {"mes":"YYYY-MM"}, {"desde":"YYYY-MM-DD","hasta":"YYYY-MM-DD"} o {"relativo":"este_mes"}.', campo: "periodo" };
}

function normalizarDiasSemana(raw: unknown): number[] | null | PlanInvalido {
  if (raw == null) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  if (arr.length === 0) return null;
  const out: number[] = [];
  for (const v of arr) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7) { out.push(v); continue; }
    if (typeof v === "string") {
      const clave = v.trim().toLowerCase();
      if (DIAS_TEXTO[clave] != null) { out.push(DIAS_TEXTO[clave]); continue; }
      const n = Number(clave);
      if (Number.isInteger(n) && n >= 1 && n <= 7) { out.push(n); continue; }
    }
    return { ok: false, error: `Día de la semana inválido: ${JSON.stringify(v)}. Usá 1..7 (1=lunes) o el nombre del día.`, campo: "filtros.dias_semana" };
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function normalizarLista(raw: unknown, permitidos: readonly string[] | null, campo: string): string[] | null | PlanInvalido {
  if (raw == null) return null;
  const arr = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim()).filter(Boolean);
  if (arr.length === 0) return null;
  for (const v of arr) {
    if (permitidos && !permitidos.includes(v)) {
      return { ok: false, error: `Valor no permitido en ${campo}: "${v}". Permitidos: ${permitidos.join(", ")}.`, campo };
    }
    if (!permitidos && !RE_METODO.test(v)) {
      return { ok: false, error: `Valor inválido en ${campo}: "${v}".`, campo };
    }
  }
  return [...new Set(arr)];
}

const esInvalido = (x: unknown): x is PlanInvalido => typeof x === "object" && x !== null && (x as PlanInvalido).ok === false;

// Valida y normaliza el plan propuesto. NUNCA acepta tablas, columnas ni SQL del modelo.
export function validarPlan(input: Record<string, unknown>, ahora: Date = new Date()): PlanValido | PlanInvalido {
  const metricaRaw = String(input.metrica ?? "").trim();
  if (!metricaRaw) return { ok: false, error: `Falta la métrica. Disponibles: ${METRICAS_VALIDAS.join(", ")}.`, campo: "metrica" };
  if (!METRICAS_VALIDAS.includes(metricaRaw as Metrica)) {
    const alternativa = METRICAS_DERIVADAS_A_OTRA_HERRAMIENTA[metricaRaw];
    if (alternativa) return { ok: false, error: alternativa, campo: "metrica" };
    return { ok: false, error: `Métrica no disponible: "${metricaRaw}". Disponibles: ${METRICAS_VALIDAS.join(", ")}.`, campo: "metrica" };
  }
  const metrica = metricaRaw as Metrica;

  const ventana = resolverVentana(input.periodo as Record<string, unknown> | undefined, ahora);
  if (esInvalido(ventana)) return ventana;

  const filtrosRaw = (input.filtros ?? {}) as Record<string, unknown>;
  const diasSemana = normalizarDiasSemana(filtrosRaw.dias_semana);
  if (esInvalido(diasSemana)) return diasSemana;

  const fuentesPermitidas = METRICAS[metrica].familia === "contable" ? FUENTES_CONTABLES : FUENTES_ACTIVIDAD;
  const fuentes = normalizarLista(filtrosRaw.fuente, fuentesPermitidas, "filtros.fuente");
  if (esInvalido(fuentes)) return fuentes;

  const metodosPago = normalizarLista(filtrosRaw.metodo_pago, null, "filtros.metodo_pago");
  if (esInvalido(metodosPago)) return metodosPago;

  if (metodosPago && METRICAS[metrica].familia !== "contable") {
    return { ok: false, error: "El filtro por método de pago solo aplica a métricas de facturación.", campo: "filtros.metodo_pago" };
  }

  const agruparRaw = String(input.agrupar_por ?? "ninguno").trim() || "ninguno";
  if (!AGRUPACIONES.includes(agruparRaw as Agrupacion)) {
    return { ok: false, error: `Agrupación no permitida: "${agruparRaw}". Permitidas: ${AGRUPACIONES.join(", ")}.`, campo: "agrupar_por" };
  }
  const agruparPor = agruparRaw as Agrupacion;
  if (agruparPor === "metodo_pago" && METRICAS[metrica].familia !== "contable") {
    return { ok: false, error: "Agrupar por método de pago solo aplica a métricas de facturación.", campo: "agrupar_por" };
  }

  const ordenRaw = String(input.orden ?? "cronologico").trim() || "cronologico";
  if (!ORDENES.includes(ordenRaw as Orden)) {
    return { ok: false, error: `Orden no permitido: "${ordenRaw}". Permitidos: ${ORDENES.join(", ")}.`, campo: "orden" };
  }

  let limite = LIMITE_DEFAULT;
  if (input.limite != null) {
    const n = Number(input.limite);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "El límite debe ser un entero positivo.", campo: "limite" };
    if (n > LIMITE_MAX) return { ok: false, error: `El límite máximo es ${LIMITE_MAX} filas.`, campo: "limite" };
    limite = n;
  }

  return {
    ok: true,
    plan: {
      metrica,
      ventana: ventana as VentanaPlan,
      filtros: { diasSemana: diasSemana as number[] | null, fuentes: fuentes as string[] | null, metodosPago: metodosPago as string[] | null },
      agruparPor,
      orden: ordenRaw as Orden,
      limite,
    },
  };
}

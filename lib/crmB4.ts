// ============================================================================
// CRM B2B · B4 — Métricas. FUENTE ÚNICA de cada métrica.
// ----------------------------------------------------------------------------
// Módulo PURO: sin base, sin red y sin reloj propio (el "ahora" se pasa). Lo usan
// la API, la pantalla y las pruebas. Cada cifra sale de un CONJUNTO DE FILAS
// (visitas, negocios, oportunidades, ventas, cobros, pagos, jornadas, episodios);
// el valor de la tarjeta es el conteo o la suma de ese conjunto y su detalle es
// ese mismo conjunto, así que no pueden diferir. Nada se calcula sobre una página
// visible ni sobre un límite de filas: el servidor carga todo (lib/crmB4Server.ts).
//
// Reglas generales (docs/crm/b4-metricas.md):
//   · Fecha de negocio de SIM (Córdoba). Los instantes se pasan a ese día.
//   · Registros VIGENTES hoy: visitas, ventas, cobros y pagos anulados no cuentan.
//     Una consulta de meses anteriores refleja los registros vigentes de hoy (una
//     anulación o corrección posterior también la cambia): no es un cierre.
//   · Flujos del período (cada hecho por su fecha) ≠ lecturas actuales (estado de
//     hoy). Cada métrica declara cuál es.
//   · Una razón sin denominador es "Sin datos" (null), nunca 0 %.
//   · Importes en centavos (enteros).
// ============================================================================

import { NECESIDADES, texto as textoOpcion, INTERESES, PACKS } from "@/lib/crmB1";
import { ESTADOS_OPORTUNIDAD, MOTIVOS_PERDIDA } from "@/lib/crmB2";
import type { Centavos } from "@/lib/crmB3";

// ── Fechas (día de negocio de SIM) ──────────────────────────────────────────
export const ZONA_SIM = "America/Argentina/Cordoba";
const F_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_SIM, year: "numeric", month: "2-digit", day: "2-digit" });
/** Instante → "YYYY-MM-DD" en Córdoba. */
export const fechaSim = (instante: string | Date) => F_DIA.format(typeof instante === "string" ? new Date(instante) : instante);

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
export function esFecha(v: unknown): v is string {
  if (typeof v !== "string" || !FECHA_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const aUTC = (f: string) => { const [y, m, d] = f.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const deUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const sumarDias = (f: string, n: number) => deUTC(aUTC(f) + n * 86_400_000);
/** Días de `desde` a `hasta`, ambos incluidos. */
export const diasEntre = (desde: string, hasta: string) => Math.round((aUTC(hasta) - aUTC(desde)) / 86_400_000) + 1;
const primeroDeMes = (f: string) => `${f.slice(0, 8)}01`;
const ultimoDeMes = (f: string) => { const [y, m] = f.split("-").map(Number); return deUTC(Date.UTC(y, m, 0)); };
const enRango = (f: string | null, desde: string, hasta: string) => !!f && f >= desde && f <= hasta;
/** "YYYY-MM-DD" → "DD/MM/AAAA" (para textos armados acá). */
export const fechaTexto = (f: string) => f.split("-").reverse().join("/");

// ── Período ────────────────────────────────────────────────────────────────
export const PRESETS = [
  { valor: "90d", texto: "Últimos 90 días" },
  { valor: "30d", texto: "Últimos 30 días" },
  { valor: "mes", texto: "Este mes" },
  { valor: "mes_anterior", texto: "Mes anterior" },
  { valor: "anio", texto: "Este año" },
  { valor: "todo", texto: "Todo" },
  { valor: "personalizado", texto: "Personalizado" },
] as const;
export type Preset = (typeof PRESETS)[number]["valor"];
/** Período inicial: 90 días dan tiempo a que los leads tengan resultados sin mezclar demasiada historia. */
export const PRESET_INICIAL: Preset = "90d";
/** Primer día que puede tener datos del CRM. */
export const FECHA_MINIMA = "2026-01-01";

export type Periodo = { preset: Preset; desde: string; hasta: string; dias: number; incompleto: boolean };

export function periodoDe(preset: Preset, hoy: string, personalizado?: { desde?: string | null; hasta?: string | null }): Periodo {
  const armar = (desde: string, hasta: string): Periodo => {
    const h = hasta > hoy ? hoy : hasta;
    const d = desde > h ? h : desde;
    return { preset, desde: d, hasta: h, dias: diasEntre(d, h), incompleto: h === hoy };
  };
  switch (preset) {
    case "30d": return armar(sumarDias(hoy, -29), hoy);
    case "90d": return armar(sumarDias(hoy, -89), hoy);
    case "mes": return armar(primeroDeMes(hoy), hoy);
    case "mes_anterior": { const ref = primeroDeMes(sumarDias(primeroDeMes(hoy), -1)); return armar(ref, ultimoDeMes(ref)); }
    case "anio": return armar(`${hoy.slice(0, 4)}-01-01`, hoy);
    case "todo": return armar(FECHA_MINIMA, hoy);
    case "personalizado": {
      const d = esFecha(personalizado?.desde) ? personalizado!.desde! : primeroDeMes(hoy);
      const h = esFecha(personalizado?.hasta) ? personalizado!.hasta! : hoy;
      return armar(d, h < d ? d : h);
    }
  }
}

// ── Datos de entrada (los arma el servidor; todo, sin límite de filas) ─────
export type Empresa = {
  id: string; nombre: string; rubro_id: string | null; rubro: string | null; zona_id: string | null; zona: string | null;
  cliente_previo: boolean; archivada: boolean;
};
export type Usuario = { id: string; nombre: string };
export type Jornada = {
  id: string; usuario_id: string; fecha: string; zona_id: string | null; zona: string | null; cerrada: boolean;
  /** Km recorridos (los dos extremos cargados) o null si falta alguno. */
  km: number | null;
  /** Combustible, estacionamiento, peajes y otros: null = sin cargar; 0 = no hubo gasto. */
  gastos: [Centavos | null, Centavos | null, Centavos | null, Centavos | null];
};
export type Visita = {
  id: string; empresa_id: string; jornada_id: string; oportunidad_id: string | null; usuario_id: string; fecha: string; ocurrida_en: string;
  responsable: boolean; decisor: boolean; contacto_util: boolean; interes: string | null; necesidades: string[]; pack: string | null; anulada: boolean;
};
export type Oportunidad = {
  id: string; empresa_id: string; origen_tipo: "visita" | "recompra_admin"; origen_visita_id: string | null; origen_usuario_id: string | null;
  lead_en: string; estado: string; cierre_motivo: string | null; interesado_en: string | null; negociacion_en: string | null;
  perdida_en: string | null; perdida_motivo: string | null;
};
export type Ciclo = { oportunidad_id: string; ciclo: number; interesado_en: string | null; negociacion_en: string | null; perdida_en: string; perdida_motivo: string };
export type Venta = {
  id: string; oportunidad_id: string; empresa_id: string; es_recompra: boolean; fecha_acuerdo: string; producto_codigo: string; producto_nombre: string;
  experiencias: number; importe: Centavos; comision_tipo: "pactada" | "no_corresponde"; comision_importe: Centavos | null;
  beneficiario_id: string | null; fundamento: string; intervencion_visita_id: string | null; anulada: boolean;
};
export type Cobro = { id: string; venta_id: string; fecha: string; importe: Centavos; concepto: string; registrado_en: string; anulado: boolean };
export type Pago = { id: string; venta_id: string; fecha: string; importe: Centavos; beneficiario_id: string; registrado_en: string; anulado: boolean };
export type DatosCrm = {
  empresas: Empresa[]; usuarios: Usuario[]; jornadas: Jornada[]; visitas: Visita[]; oportunidades: Oportunidad[]; ciclos: Ciclo[];
  ventas: Venta[]; cobros: Cobro[]; pagos: Pago[]; zonas: Array<{ id: string; nombre: string }>; rubros: Array<{ id: string; nombre: string }>;
};

// ── Filtros ────────────────────────────────────────────────────────────────
export type Filtros = { comercial: string | null; zona: string | null; rubro: string | null; necesidad: string | null };
export const SIN_ZONA = "sin_zona";
export const SIN_RUBRO = "sin_clasificar";
export const SIN_FILTROS: Filtros = { comercial: null, zona: null, rubro: null, necesidad: null };
/** Filtros que describen al negocio o a la oportunidad: no reparten gastos de una jornada. */
export const hayFiltroDeNegocio = (f: Filtros) => !!(f.zona || f.rubro || f.necesidad);
export const NO_APLICA_NEGOCIO = "No aplica con filtros de zona, rubro o necesidad: los km y gastos son de la jornada entera y no se reparten entre negocios.";

/** Semántica de cada filtro (se muestra en la pantalla). */
export const SEMANTICA_FILTROS = {
  comercial: "Visitas y jornadas: quien las hizo. Leads: comercial de origen. Ventas y cobros: el comercial de la jornada atribuida. Comisiones: el beneficiario.",
  zona: "Zona actual del NEGOCIO (no la de la jornada).",
  rubro: "Rubro actual del negocio.",
  necesidad: "Visitas: la necesidad anotada en esa visita. Oportunidades y ventas: alguna de las necesidades anotadas en sus visitas.",
} as const;

// ── Definiciones (una por métrica) ─────────────────────────────────────────
export type Lectura = "periodo" | "actual" | "cohorte";
export type Seccion = "tarjetas" | "prospeccion" | "jornadas" | "segmentos" | "economico";
export type Definicion = {
  nombre: string; ayuda: string; fuente: string; fecha: string; unidad: string; exclusiones: string; formula: string; lectura: Lectura;
};

export const DEFINICIONES = {
  negocios_visitados: {
    nombre: "Negocios visitados", ayuda: "Negocios distintos con al menos una visita en el período. Diez visitas al mismo local cuentan como un negocio.",
    fuente: "Visitas (B1)", fecha: "Día de la visita (SIM)", unidad: "negocios", lectura: "periodo",
    exclusiones: "Visitas anuladas. Un negocio cargado a mano o importado sin visita no cuenta.", formula: "Negocios únicos de las visitas válidas del período.",
  },
  leads: {
    nombre: "Leads obtenidos", ayuda: "Oportunidades que nacieron de una visita en el período. Reabrir una oportunidad no crea un lead nuevo.",
    fuente: "Oportunidades (B1/B2)", fecha: "Momento del lead (SIM)", unidad: "oportunidades", lectura: "periodo",
    exclusiones: "Oportunidades cerradas porque se anuló su visita de origen; las recompras creadas por Administración (van aparte).",
    formula: "Oportunidades con origen en una visita y lead en el período (nuevas + de clientes).",
  },
  ventas: {
    nombre: "Ventas", ayuda: "Ventas vigentes cuyo acuerdo se cerró en el período, vengan del lead que vengan.",
    fuente: "Ventas (B3)", fecha: "Fecha del acuerdo", unidad: "ventas", lectura: "periodo", exclusiones: "Ventas anuladas.", formula: "Conteo de ventas vigentes.",
  },
  importe_acordado: {
    nombre: "Importe acordado", ayuda: "Suma de lo acordado en las ventas del período. Acuerdo comercial: sin IVA y no es facturación.",
    fuente: "Ventas (B3)", fecha: "Fecha del acuerdo", unidad: "pesos", lectura: "periodo", exclusiones: "Ventas anuladas.", formula: "Σ importe acordado.",
  },
  cobrado: {
    nombre: "Cobrado según CRM", ayuda: "Cobros registrados con fecha efectiva en el período, de cualquier venta. No es Finanzas.",
    fuente: "Cobros (B3)", fecha: "Fecha efectiva del cobro", unidad: "pesos", lectura: "periodo", exclusiones: "Cobros anulados.", formula: "Σ importe de los cobros vigentes.",
  },
  comision_generada: {
    nombre: "Comisión comercial generada", ayuda: "Comisiones que se generaron en el período: el día en que la venta quedó cobrada por completo. Sigue contando aunque después se pague.",
    fuente: "Ventas y cobros (B3)", fecha: "Fecha efectiva del cobro que completó la venta", unidad: "pesos", lectura: "periodo",
    exclusiones: "Ventas anuladas, cobros anulados y ventas sin comisión.", formula: "Σ comisión pactada de las ventas cuya generación cae en el período.",
  },
  visitas: {
    nombre: "Visitas registradas", ayuda: "Todas las visitas válidas del período, aunque sean al mismo negocio.",
    fuente: "Visitas (B1)", fecha: "Día de la visita (SIM)", unidad: "visitas", lectura: "periodo", exclusiones: "Visitas anuladas.", formula: "Conteo de visitas válidas.",
  },
  responsables: {
    nombre: "Responsables contactados", ayuda: "Negocios donde en el período se habló con el responsable del local.",
    fuente: "Visitas (B1)", fecha: "Día de la visita (SIM)", unidad: "negocios", lectura: "periodo", exclusiones: "Visitas anuladas.",
    formula: "Negocios únicos con una visita marcada «habló con el responsable».",
  },
  decisores: {
    nombre: "Decisores contactados", ayuda: "Negocios donde se habló con alguien que decide la compra. Conseguir su teléfono por un empleado no cuenta.",
    fuente: "Visitas (B1)", fecha: "Día de la visita (SIM)", unidad: "negocios", lectura: "periodo", exclusiones: "Visitas anuladas.",
    formula: "Negocios únicos con una visita donde se habló con el contacto y ese contacto decide (decisor_contactado).",
  },
  interesados: {
    nombre: "Interesados", ayuda: "Oportunidades cuya primera señal de interés registrada cayó en el período: interés tibio o caliente en una visita o pase a «Interesado» en el seguimiento.",
    fuente: "Visitas (B1) y seguimiento (B2)", fecha: "Primera señal de interés", unidad: "oportunidades", lectura: "periodo",
    exclusiones: "«No evaluado» no es «sin interés» y tampoco cuenta. Saltar a negociación o vender sin señal de interés no se convierte en interés.",
    formula: "Oportunidades con primera señal en el período.",
  },
  recompras_admin: {
    nombre: "Recompras creadas por Administración", ayuda: "Oportunidades de recompra abiertas por Administración con un contacto existente. No son leads de calle.",
    fuente: "Oportunidades (B3)", fecha: "Momento de creación (SIM)", unidad: "oportunidades", lectura: "periodo", exclusiones: "—", formula: "Conteo.",
  },
  visitas_con_lead: {
    nombre: "Visitas que generaron un lead", ayuda: "De las visitas del período, cuántas son el origen de una oportunidad. Se mide por visita, no por negocio.",
    fuente: "Visitas y oportunidades", fecha: "Día de la visita", unidad: "visitas", lectura: "periodo",
    exclusiones: "Visitas anuladas; oportunidades cerradas por anulación del origen.", formula: "Visitas del período que originaron una oportunidad ÷ visitas válidas del período.",
  },
  cohorte_interesados: {
    nombre: "Leads → interesados", ayuda: "De los leads del período, cuántos mostraron interés registrado (en cualquier momento hasta hoy).",
    fuente: "Oportunidades, visitas y seguimiento", fecha: "Momento del lead (cohorte); resultados hasta hoy", unidad: "oportunidades", lectura: "cohorte",
    exclusiones: "Lo mismo que «Leads obtenidos».", formula: "Leads del período con alguna señal de interés ÷ leads del período.",
  },
  cohorte_ventas: {
    nombre: "Leads → ventas", ayuda: "De los leads del período, cuántos terminaron en una venta vigente hasta hoy. Cada oportunidad cuenta una vez.",
    fuente: "Oportunidades y ventas", fecha: "Momento del lead (cohorte); ventas hasta hoy", unidad: "oportunidades", lectura: "cohorte",
    exclusiones: "Ventas anuladas (si se volvió a vender, cuenta la vigente).", formula: "Leads del período con venta vigente ÷ leads del período.",
  },
  negocios_compradores: {
    nombre: "Negocios visitados → compradores", ayuda: "De los negocios visitados por primera vez en el período, cuántos compraron después. Se mide por negocio, no por visita.",
    fuente: "Visitas y ventas", fecha: "Primera visita del negocio (cohorte); ventas hasta hoy", unidad: "negocios", lectura: "cohorte",
    exclusiones: "Visitas anuladas; ventas anuladas; compras anteriores a la primera visita.",
    formula: "Negocios con primera visita en el período y una venta vigente con acuerdo desde esa fecha ÷ negocios con primera visita en el período.",
  },
  jornadas: {
    nombre: "Jornadas", ayuda: "Jornadas de calle del período, también las que no tuvieron visitas.",
    fuente: "Jornadas (B1)", fecha: "Día de la jornada", unidad: "jornadas", lectura: "periodo", exclusiones: "—", formula: "Conteo.",
  },
  km: {
    nombre: "Km registrados", ayuda: "Km de las jornadas con los km iniciales y finales cargados. Las demás se informan como pendientes, no como 0.",
    fuente: "Jornadas (B1)", fecha: "Día de la jornada", unidad: "km", lectura: "periodo", exclusiones: "Jornadas sin uno de los dos extremos.", formula: "Σ km recorridos.",
  },
  movilidad: {
    nombre: "Movilidad registrada", ayuda: "Combustible, estacionamiento, peajes y otros de las jornadas con los cuatro gastos cargados. Quién los paga todavía no está definido: no es un egreso de SIM.",
    fuente: "Jornadas (B1)", fecha: "Día de la jornada", unidad: "pesos", lectura: "periodo",
    exclusiones: "Jornadas con algún gasto sin cargar (se informan aparte, con lo ya cargado).", formula: "Σ de los cuatro gastos de las jornadas completas.",
  },
  visitas_por_jornada: {
    nombre: "Visitas por jornada", ayuda: "Promedio de visitas por jornada, contando las jornadas sin visitas.",
    fuente: "Jornadas y visitas", fecha: "Día de la jornada", unidad: "visitas por jornada", lectura: "periodo", exclusiones: "Visitas anuladas.",
    formula: "Visitas de las jornadas del período ÷ jornadas del período.",
  },
  km_por_visita: {
    nombre: "Km por visita", ayuda: "Solo jornadas con km cargados: numerador y denominador salen del mismo grupo.",
    fuente: "Jornadas y visitas", fecha: "Día de la jornada", unidad: "km por visita", lectura: "periodo", exclusiones: "Jornadas con km pendientes.",
    formula: "Σ km ÷ visitas, sobre las jornadas con km.",
  },
  km_por_lead: {
    nombre: "Km por lead", ayuda: "Solo jornadas con km cargados.", fuente: "Jornadas y oportunidades", fecha: "Día de la jornada", unidad: "km por lead", lectura: "periodo",
    exclusiones: "Jornadas con km pendientes.", formula: "Σ km ÷ leads originados en esas jornadas.",
  },
  movilidad_por_visita: {
    nombre: "Movilidad por visita", ayuda: "Solo jornadas con los cuatro gastos cargados.", fuente: "Jornadas y visitas", fecha: "Día de la jornada", unidad: "pesos por visita",
    lectura: "periodo", exclusiones: "Jornadas con gastos pendientes.", formula: "Σ movilidad ÷ visitas, sobre las jornadas completas.",
  },
  movilidad_por_lead: {
    nombre: "Movilidad por lead", ayuda: "Solo jornadas con los cuatro gastos cargados.", fuente: "Jornadas y oportunidades", fecha: "Día de la jornada", unidad: "pesos por lead",
    lectura: "periodo", exclusiones: "Jornadas con gastos pendientes.", formula: "Σ movilidad ÷ leads originados en esas jornadas.",
  },
  movilidad_por_venta: {
    nombre: "Movilidad por venta", ayuda: "Solo jornadas completas; ventas atribuidas a esas jornadas hasta hoy.", fuente: "Jornadas y ventas", fecha: "Día de la jornada",
    unidad: "pesos por venta", lectura: "periodo", exclusiones: "Jornadas con gastos pendientes; ventas anuladas.", formula: "Σ movilidad ÷ ventas atribuidas a esas jornadas.",
  },
  ventas_por_jornada: {
    nombre: "Ventas por jornada", ayuda: "Ventas atribuidas (hasta hoy) a las jornadas del período, por jornada.", fuente: "Jornadas y ventas", fecha: "Día de la jornada",
    unidad: "ventas por jornada", lectura: "periodo", exclusiones: "Ventas anuladas.", formula: "Ventas atribuidas a las jornadas del período ÷ jornadas del período.",
  },
  importe_por_jornada: {
    nombre: "Importe acordado por jornada", ayuda: "Importe de las ventas atribuidas (hasta hoy) a las jornadas del período, por jornada.", fuente: "Jornadas y ventas",
    fecha: "Día de la jornada", unidad: "pesos por jornada", lectura: "periodo", exclusiones: "Ventas anuladas.",
    formula: "Σ importe de las ventas atribuidas ÷ jornadas del período.",
  },
  ventas_jornadas: {
    nombre: "Ventas obtenidas hasta hoy por jornadas del período", ayuda: "Ventas atribuidas a una jornada del período, cerradas en cualquier fecha hasta hoy. No es lo mismo que las ventas cerradas en el período.",
    fuente: "Ventas y jornadas", fecha: "Día de la jornada atribuida", unidad: "ventas", lectura: "cohorte",
    exclusiones: "Ventas anuladas; ventas sin jornada atribuible.", formula: "Ventas vigentes cuya jornada atribuida está en el período.",
  },
  perdidas: {
    nombre: "Episodios de pérdida", ayuda: "Cada vez que una oportunidad se marcó perdida en el período. Si se perdió dos veces, son dos episodios de una oportunidad.",
    fuente: "Seguimiento (B2): ciclos", fecha: "Momento de la pérdida", unidad: "episodios", lectura: "periodo", exclusiones: "—",
    formula: "Pérdidas de ciclos anteriores (reabiertos) + pérdida vigente.",
  },
  experiencias: {
    nombre: "Experiencias vendidas", ayuda: "Experiencias de las ventas del período.", fuente: "Ventas (B3)", fecha: "Fecha del acuerdo", unidad: "experiencias",
    lectura: "periodo", exclusiones: "Ventas anuladas.", formula: "Σ experiencias.",
  },
  saldo_actual: {
    nombre: "Saldo actual de las ventas del período", ayuda: "Lo que HOY falta cobrar de las ventas acordadas en el período. Es una lectura de hoy, no el saldo al cierre del período.",
    fuente: "Ventas y cobros (B3)", fecha: "Fecha del acuerdo; saldo a hoy", unidad: "pesos", lectura: "actual", exclusiones: "Ventas y cobros anulados.",
    formula: "Σ (importe − cobros vigentes hasta hoy) de las ventas del período.",
  },
  comision_prevista: {
    nombre: "Comisión prevista (hoy)", ayuda: "Comisión pactada de las ventas del período que hoy todavía no está generada (la venta no está cobrada por completo).",
    fuente: "Ventas y cobros (B3)", fecha: "Fecha del acuerdo; estado a hoy", unidad: "pesos", lectura: "actual", exclusiones: "Ventas anuladas y sin comisión.",
    formula: "Σ comisión pactada sin generar.",
  },
  comision_a_pagar: {
    nombre: "Comisión a pagar (hoy)", ayuda: "De las ventas del período con la comisión ya generada, lo que hoy falta pagar.", fuente: "Ventas, cobros y pagos (B3)",
    fecha: "Fecha del acuerdo; estado a hoy", unidad: "pesos", lectura: "actual", exclusiones: "Ventas, cobros y pagos anulados.",
    formula: "Σ (comisión pactada − pagado) de las ventas con comisión generada.",
  },
  comision_pagada: {
    nombre: "Comisión pagada", ayuda: "Pagos de comisión registrados con fecha en el período.", fuente: "Pagos de comisión (B3)", fecha: "Fecha del pago", unidad: "pesos",
    lectura: "periodo", exclusiones: "Pagos anulados.", formula: "Σ pagos vigentes.",
  },
  cobros_menos_comisiones: {
    nombre: "Cobros menos comisiones pagadas", ayuda: "Cobrado según CRM menos comisiones pagadas, ambos del período. No descuenta movilidad, prestación de las experiencias, impuestos ni gastos fijos: no es ganancia.",
    fuente: "Cobros y pagos de comisión (B3)", fecha: "Fecha efectiva del cobro y fecha del pago", unidad: "pesos", lectura: "periodo",
    exclusiones: "Cobros y pagos anulados. No usa comisiones devengadas.", formula: "Cobrado según CRM − comisión pagada.",
  },
} as const satisfies Record<string, Definicion>;
export type IdMetrica = keyof typeof DEFINICIONES;

// ── Valores ─────────────────────────────────────────────────────────────────
export type Valor =
  | { tipo: "conteo"; n: number }
  | { tipo: "dinero"; c: Centavos }
  | { tipo: "km"; v: number }
  /** Razón (num ÷ den). `v` null = sin datos. `porcentaje`: se muestra como %. */
  | { tipo: "razon"; num: number; den: number; v: number | null; porcentaje: boolean; dinero: boolean }
  | { tipo: "no_aplica"; motivo: string }
  /** No hay ningún registro completo con el que calcular (no es 0). */
  | { tipo: "sin_datos"; motivo: string };
export const razon = (num: number, den: number, porcentaje = false, dinero = false): Valor =>
  ({ tipo: "razon", num, den, v: den > 0 ? num / den : null, porcentaje, dinero });

/** Datos complementarios: jornadas fuera por información pendiente, lo cargado en ellas, etc. */
export type Extra = { pendientes?: number; parcial?: Centavos; importe?: Centavos; oportunidades?: number; nuevas?: number; clientes?: number };
export type ResultadoMetrica = { id: IdMetrica; valor: Valor; extra: Extra };

// ── Contexto: índices y hechos derivados (una sola vez por consulta) ───────
export type ClaseOportunidad = "nueva" | "cliente" | "recompra_admin";
export const TEXTO_CLASE: Record<ClaseOportunidad, string> = {
  nueva: "Lead nuevo (de calle)", cliente: "Lead de un cliente (de calle)", recompra_admin: "Recompra creada por Administración",
};

type InfoOportunidad = {
  o: Oportunidad; fechaLead: string; clase: ClaseOportunidad; valida: boolean; necesidades: string[]; interes: string | null; pack: string | null;
  senal: string | null; venta: Venta | null; jornadaOrigen: string | null;
};
type InfoVenta = {
  v: Venta; op: InfoOportunidad | null; cobrado: Centavos; pagado: Centavos; generadaEl: string | null; jornada: string | null; comercial: string | null;
};

export type Contexto = {
  hoy: string; datos: DatosCrm;
  empresa: Map<string, Empresa>; usuario: Map<string, string>; jornada: Map<string, Jornada>; visita: Map<string, Visita>;
  visitas: Visita[]; oportunidades: InfoOportunidad[]; oportunidad: Map<string, InfoOportunidad>; ventas: InfoVenta[];
  cobros: Cobro[]; pagos: Pago[]; primeraVisita: Map<string, string>; ventaDe: Map<string, InfoVenta>;
};

const porFechaYRegistro = <T extends { fecha: string; registrado_en: string }>(a: T, b: T) => a.fecha.localeCompare(b.fecha) || a.registrado_en.localeCompare(b.registrado_en);
const INTERES_POSITIVO = new Set(["tibio", "caliente"]);

export function preparar(datos: DatosCrm, ahora: Date): Contexto {
  const hoy = fechaSim(ahora);
  const empresa = new Map(datos.empresas.map((e) => [e.id, e]));
  const usuario = new Map(datos.usuarios.map((u) => [u.id, u.nombre]));
  const jornada = new Map(datos.jornadas.map((j) => [j.id, j]));
  const visita = new Map(datos.visitas.map((v) => [v.id, v]));
  const visitas = datos.visitas.filter((v) => !v.anulada);
  const visitasDeOpp = new Map<string, Visita[]>();
  for (const v of visitas) if (v.oportunidad_id) visitasDeOpp.set(v.oportunidad_id, [...(visitasDeOpp.get(v.oportunidad_id) ?? []), v]);
  const ciclosDe = new Map<string, Ciclo[]>();
  for (const c of datos.ciclos) ciclosDe.set(c.oportunidad_id, [...(ciclosDe.get(c.oportunidad_id) ?? []), c]);
  const ventasVig = datos.ventas.filter((v) => !v.anulada);
  const ventaDeOpp = new Map(ventasVig.map((v) => [v.oportunidad_id, v]));
  const cobros = datos.cobros.filter((c) => !c.anulado);
  const pagos = datos.pagos.filter((p) => !p.anulado);
  const primeraVisita = new Map<string, string>();
  for (const v of visitas) if (!primeraVisita.has(v.empresa_id) || v.fecha < primeraVisita.get(v.empresa_id)!) primeraVisita.set(v.empresa_id, v.fecha);
  // Compras vigentes anteriores, por negocio (para saber si un lead de calle es de un cliente).
  const comprasDe = new Map<string, Venta[]>();
  for (const v of ventasVig) comprasDe.set(v.empresa_id, [...(comprasDe.get(v.empresa_id) ?? []), v]);

  const oportunidades: InfoOportunidad[] = datos.oportunidades.map((o) => {
    const vs = (visitasDeOpp.get(o.id) ?? []).sort((a, b) => a.ocurrida_en.localeCompare(b.ocurrida_en));
    const fechaLead = fechaSim(o.lead_en);
    const venta = ventaDeOpp.get(o.id) ?? null;
    const e = empresa.get(o.empresa_id);
    const clase: ClaseOportunidad = o.origen_tipo === "recompra_admin" ? "recompra_admin"
      : (venta ? venta.es_recompra : !!e?.cliente_previo || (comprasDe.get(o.empresa_id) ?? []).some((x) => x.oportunidad_id !== o.id && x.fecha_acuerdo <= fechaLead))
        ? "cliente" : "nueva";
    const senales = [
      ...vs.filter((v) => v.interes && INTERES_POSITIVO.has(v.interes)).map((v) => v.fecha),
      ...[o.interesado_en, ...(ciclosDe.get(o.id) ?? []).map((c) => c.interesado_en)].filter((x): x is string => !!x).map((x) => fechaSim(x)),
    ].sort();
    const conInteres = [...vs].reverse().find((v) => v.interes);
    const conPack = [...vs].reverse().find((v) => v.pack && v.pack !== "no_determinado");
    const origen = o.origen_visita_id ? visita.get(o.origen_visita_id) : undefined;
    return {
      o, fechaLead, clase, valida: o.cierre_motivo !== "origen_anulado",
      necesidades: [...new Set(vs.flatMap((v) => v.necesidades))].sort(),
      interes: conInteres?.interes ?? null, pack: conPack?.pack ?? null, senal: senales[0] ?? null, venta,
      jornadaOrigen: o.origen_tipo === "visita" && origen && !origen.anulada ? origen.jornada_id : null,
    };
  });
  const oportunidad = new Map(oportunidades.map((x) => [x.o.id, x]));

  const cobrosDe = new Map<string, Cobro[]>();
  for (const c of cobros) cobrosDe.set(c.venta_id, [...(cobrosDe.get(c.venta_id) ?? []), c]);
  const pagosDe = new Map<string, Pago[]>();
  for (const p of pagos) pagosDe.set(p.venta_id, [...(pagosDe.get(p.venta_id) ?? []), p]);
  const ventas: InfoVenta[] = ventasVig.map((v) => {
    const cs = (cobrosDe.get(v.id) ?? []).sort(porFechaYRegistro);
    let acumulado = 0;
    let generadaEl: string | null = null;
    for (const c of cs) {
      acumulado += c.importe;
      if (generadaEl === null && acumulado >= v.importe) generadaEl = c.fecha;
    }
    const op = oportunidad.get(v.oportunidad_id) ?? null;
    // Atribución: la visita de origen de la oportunidad; si no tiene (recompra de
    // Administración), la visita de intervención de una recompra trabajada; si no, sin jornada.
    const intervencion = v.intervencion_visita_id ? visita.get(v.intervencion_visita_id) : undefined;
    const j = op?.jornadaOrigen ?? (intervencion && !intervencion.anulada ? intervencion.jornada_id : null);
    return {
      v, op, cobrado: acumulado, pagado: (pagosDe.get(v.id) ?? []).reduce((s, p) => s + p.importe, 0),
      generadaEl: v.comision_tipo === "pactada" ? generadaEl : null, jornada: j, comercial: j ? jornada.get(j)?.usuario_id ?? null : null,
    };
  });
  return { hoy, datos, empresa, usuario, jornada, visita, visitas, oportunidades, oportunidad, ventas, cobros, pagos, primeraVisita,
    ventaDe: new Map(ventas.map((x) => [x.v.id, x])) };
}

// ── Predicados de filtro ───────────────────────────────────────────────────
function negocioCumple(ctx: Contexto, empresaId: string, f: Filtros): boolean {
  const e = ctx.empresa.get(empresaId);
  if (!e) return false;
  if (f.zona && (f.zona === SIN_ZONA ? e.zona_id !== null : e.zona_id !== f.zona)) return false;
  if (f.rubro && (f.rubro === SIN_RUBRO ? e.rubro_id !== null : e.rubro_id !== f.rubro)) return false;
  return true;
}
const visitaCumple = (ctx: Contexto, v: Visita, f: Filtros) =>
  negocioCumple(ctx, v.empresa_id, f) && (!f.comercial || v.usuario_id === f.comercial) && (!f.necesidad || v.necesidades.includes(f.necesidad));
const oppCumple = (ctx: Contexto, x: InfoOportunidad, f: Filtros) =>
  negocioCumple(ctx, x.o.empresa_id, f) && (!f.comercial || x.o.origen_usuario_id === f.comercial) && (!f.necesidad || x.necesidades.includes(f.necesidad));
const ventaCumple = (ctx: Contexto, x: InfoVenta, f: Filtros, porBeneficiario = false) =>
  negocioCumple(ctx, x.v.empresa_id, f)
  && (!f.comercial || (porBeneficiario ? x.v.beneficiario_id : x.comercial) === f.comercial)
  && (!f.necesidad || !!x.op?.necesidades.includes(f.necesidad));

// ── Conjuntos de filas (la base de cada métrica y de su detalle) ───────────
export type Conjuntos = ReturnType<typeof conjuntos>;

export function conjuntos(ctx: Contexto, desde: string, hasta: string, f: Filtros) {
  const visitas = ctx.visitas.filter((v) => enRango(v.fecha, desde, hasta) && visitaCumple(ctx, v, f));
  const unicos = (vs: Visita[]) => [...new Set(vs.map((v) => v.empresa_id))];
  const validas = ctx.oportunidades.filter((x) => x.valida && oppCumple(ctx, x, f));
  const leads = validas.filter((x) => x.o.origen_tipo === "visita" && enRango(x.fechaLead, desde, hasta));
  const recomprasAdmin = ctx.oportunidades.filter((x) => x.clase === "recompra_admin" && enRango(x.fechaLead, desde, hasta) && oppCumple(ctx, x, f));
  const origenes = new Set(ctx.oportunidades.filter((x) => x.valida && x.o.origen_visita_id).map((x) => x.o.origen_visita_id!));
  const ventas = ctx.ventas.filter((x) => enRango(x.v.fecha_acuerdo, desde, hasta) && ventaCumple(ctx, x, f));
  /** Ventas del período con el filtro de comercial aplicado al BENEFICIARIO (para las comisiones). */
  const ventasComision = ctx.ventas.filter((x) => enRango(x.v.fecha_acuerdo, desde, hasta) && x.v.comision_tipo === "pactada" && ventaCumple(ctx, x, f, true));
  const cobros = ctx.cobros.filter((c) => enRango(c.fecha, desde, hasta) && !!ctx.ventaDe.get(c.venta_id) && ventaCumple(ctx, ctx.ventaDe.get(c.venta_id)!, f));
  const pagos = ctx.pagos.filter((p) => enRango(p.fecha, desde, hasta) && !!ctx.ventaDe.get(p.venta_id) && ventaCumple(ctx, ctx.ventaDe.get(p.venta_id)!, { ...f, comercial: null })
    && (!f.comercial || p.beneficiario_id === f.comercial));
  const generadas = ctx.ventas.filter((x) => enRango(x.generadaEl, desde, hasta) && ventaCumple(ctx, x, f, true));
  const cohorteNegocios = [...ctx.primeraVisita.entries()].filter(([id, fecha]) => {
    if (!enRango(fecha, desde, hasta) || !negocioCumple(ctx, id, f)) return false;
    const primeras = ctx.visitas.filter((v) => v.empresa_id === id && v.fecha === fecha);
    return (!f.comercial || primeras.some((v) => v.usuario_id === f.comercial)) && (!f.necesidad || primeras.some((v) => v.necesidades.includes(f.necesidad!)));
  }).map(([id, fecha]) => ({ id, fecha, compro: ctx.ventas.some((x) => x.v.empresa_id === id && x.v.fecha_acuerdo >= fecha) }));
  const episodios = [
    ...ctx.datos.ciclos.map((c) => ({ oportunidad_id: c.oportunidad_id, ciclo: c.ciclo, en: c.perdida_en, motivo: c.perdida_motivo, vigente: false })),
    ...ctx.oportunidades.filter((x) => x.o.estado === "perdida" && x.o.perdida_en)
      .map((x) => ({ oportunidad_id: x.o.id, ciclo: 0, en: x.o.perdida_en!, motivo: x.o.perdida_motivo ?? "otro", vigente: true })),
  ].filter((e) => enRango(fechaSim(e.en), desde, hasta) && !!ctx.oportunidad.get(e.oportunidad_id) && oppCumple(ctx, ctx.oportunidad.get(e.oportunidad_id)!, f));
  const interesados = validas.filter((x) => enRango(x.senal, desde, hasta));
  return {
    visitas, negocios: unicos(visitas), responsables: unicos(visitas.filter((v) => v.responsable)), decisores: unicos(visitas.filter((v) => v.decisor)),
    visitasConLead: visitas.filter((v) => origenes.has(v.id)), leads, recomprasAdmin, interesados, ventas, ventasComision, cobros, pagos, generadas, cohorteNegocios, episodios,
  };
}

// ── Jornadas ───────────────────────────────────────────────────────────────
export type FilaJornada = {
  id: string; fecha: string; comercial: { id: string; nombre: string }; zona: string | null; cerrada: boolean;
  visitas: number; negocios: number; responsables: number; decisores: number; leads: number; interesados: number;
  /** Ventas vigentes atribuidas a esta jornada, cerradas en cualquier fecha hasta hoy. */
  ventas: number; importe: Centavos;
  km: number | null; movilidad: Centavos | null; movilidad_parcial: Centavos; pendientes: string[];
};

export function filasJornadas(ctx: Contexto, desde: string, hasta: string, f: Filtros): FilaJornada[] {
  const js = ctx.datos.jornadas.filter((j) => enRango(j.fecha, desde, hasta) && (!f.comercial || j.usuario_id === f.comercial))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.id.localeCompare(b.id));
  const negocio = hayFiltroDeNegocio(f);
  return js.map((j) => {
    const vs = ctx.visitas.filter((v) => v.jornada_id === j.id && visitaCumple(ctx, v, { ...f, comercial: null }));
    const unicos = (xs: Visita[]) => new Set(xs.map((v) => v.empresa_id)).size;
    const leads = ctx.oportunidades.filter((x) => x.valida && x.o.origen_tipo === "visita" && x.jornadaOrigen === j.id && oppCumple(ctx, x, { ...f, comercial: null }));
    const ventas = ctx.ventas.filter((x) => x.jornada === j.id && ventaCumple(ctx, x, { ...f, comercial: null }));
    const completos = j.gastos.every((g) => g !== null);
    const pendientes = [
      ...(j.km === null ? ["km sin cargar"] : []),
      ...(completos ? [] : ["gastos sin cargar"]),
      ...(j.cerrada ? [] : ["jornada abierta"]),
    ];
    return {
      id: j.id, fecha: j.fecha, comercial: { id: j.usuario_id, nombre: ctx.usuario.get(j.usuario_id) ?? "Comercial" }, zona: j.zona, cerrada: j.cerrada,
      visitas: vs.length, negocios: unicos(vs), responsables: unicos(vs.filter((v) => v.responsable)), decisores: unicos(vs.filter((v) => v.decisor)),
      leads: leads.length, interesados: unicos(vs.filter((v) => v.interes && INTERES_POSITIVO.has(v.interes))),
      ventas: ventas.length, importe: ventas.reduce((s, x) => s + x.v.importe, 0),
      km: negocio ? null : j.km, movilidad: negocio || !completos ? null : j.gastos.reduce<number>((s, g) => s + (g ?? 0), 0),
      movilidad_parcial: negocio || completos ? 0 : j.gastos.reduce<number>((s, g) => s + (g ?? 0), 0), pendientes,
    };
  });
}

// ── Tablero ────────────────────────────────────────────────────────────────
export type Cohorte = {
  /** Resultados observados hasta esta fecha (hoy). */
  observado_hasta: string; leads: number; interesados: number; ventas: number; abiertas: number; perdidas: number; ganadas: number;
  /** Días desde el lead más reciente y desde el más antiguo de la cohorte hasta hoy. */
  antiguedad: { minima: number; maxima: number } | null;
  por_clase: Array<{ clase: ClaseOportunidad; leads: number; interesados: number; ventas: number }>;
};

export type Dimension = "rubro" | "zona" | "necesidad" | "pack" | "estado" | "interes" | "comercial" | "mes" | "clase";
export const DIMENSIONES: ReadonlyArray<{ valor: Dimension; texto: string; lectura: string; sumable: boolean }> = [
  { valor: "rubro", texto: "Rubro", lectura: "Dato actual del negocio (no hay foto histórica).", sumable: true },
  { valor: "zona", texto: "Zona del negocio", lectura: "Dato actual del negocio (no hay foto histórica). No es la zona de la jornada.", sumable: true },
  { valor: "necesidad", texto: "Necesidad", lectura: "Anotadas en las visitas. Una oportunidad puede tener varias: las filas se superponen y NO se suman.", sumable: false },
  { valor: "pack", texto: "Pack potencial", lectura: "El último pack potencial anotado en sus visitas.", sumable: true },
  { valor: "estado", texto: "Estado actual", lectura: "Estado de hoy de la oportunidad (no el que tenía en el período).", sumable: true },
  { valor: "interes", texto: "Interés", lectura: "El último interés anotado en sus visitas; «No evaluado» si nunca se evaluó.", sumable: true },
  { valor: "comercial", texto: "Comercial de origen", lectura: "Quien originó el lead (fijo). No es el responsable actual del negocio.", sumable: true },
  { valor: "mes", texto: "Mes del lead", lectura: "Mes en que nació el lead (histórico).", sumable: true },
  { valor: "clase", texto: "Tipo de lead", lectura: "Nuevo o de un cliente que ya había comprado.", sumable: true },
];
export type FilaSegmento = { valor: string; texto: string; oportunidades: number; interesados: number; ventas: number; conversion: Valor; importe: Centavos };
export type TablaSegmento = { dimension: Dimension; sumable: boolean; lectura: string; filas: FilaSegmento[]; total: Omit<FilaSegmento, "valor" | "texto"> };

function valoresDe(ctx: Contexto, x: InfoOportunidad, d: Dimension): Array<[string, string]> {
  const e = ctx.empresa.get(x.o.empresa_id);
  switch (d) {
    case "rubro": return [[e?.rubro_id ?? SIN_RUBRO, e?.rubro ?? "Sin rubro de la lista"]];
    case "zona": return [[e?.zona_id ?? SIN_ZONA, e?.zona ?? "Sin zona"]];
    case "necesidad": return x.necesidades.length ? x.necesidades.map((n) => [n, textoOpcion(NECESIDADES, n) ?? n]) : [["sin_necesidad", "Sin necesidad anotada"]];
    case "pack": return [[x.pack ?? "sin_pack", x.pack ? textoOpcion(PACKS, x.pack) ?? x.pack : "Sin pack anotado"]];
    case "estado": return [[x.o.estado, ESTADOS_OPORTUNIDAD.find((s) => s.valor === x.o.estado)?.texto ?? x.o.estado]];
    case "interes": return [[x.interes ?? "no_evaluado", x.interes ? textoOpcion(INTERESES, x.interes) ?? x.interes : "No evaluado"]];
    case "comercial": return [[x.o.origen_usuario_id ?? "admin", x.o.origen_usuario_id ? ctx.usuario.get(x.o.origen_usuario_id) ?? "Comercial" : "Administración"]];
    case "mes": return [[x.fechaLead.slice(0, 7), x.fechaLead.slice(0, 7)]];
    case "clase": return [[x.clase, TEXTO_CLASE[x.clase]]];
  }
}

function resumenOpps(xs: InfoOportunidad[]): Omit<FilaSegmento, "valor" | "texto"> {
  const ventas = xs.filter((x) => x.venta);
  return {
    oportunidades: xs.length, interesados: xs.filter((x) => x.senal).length, ventas: ventas.length,
    conversion: razon(ventas.length, xs.length, true), importe: ventas.reduce((s, x) => s + x.venta!.importe, 0),
  };
}

export function segmento(ctx: Contexto, leads: InfoOportunidad[], d: Dimension): TablaSegmento {
  const def = DIMENSIONES.find((x) => x.valor === d)!;
  const grupos = new Map<string, { texto: string; xs: InfoOportunidad[] }>();
  for (const x of leads) for (const [v, t] of valoresDe(ctx, x, d)) {
    const g = grupos.get(v) ?? { texto: t, xs: [] };
    g.xs.push(x);
    grupos.set(v, g);
  }
  const filas = [...grupos.entries()].map(([valor, g]) => ({ valor, texto: g.texto, ...resumenOpps(g.xs) }))
    .sort((a, b) => (d === "mes" ? a.valor.localeCompare(b.valor) : b.oportunidades - a.oportunidades || a.texto.localeCompare(b.texto)));
  return { dimension: d, sumable: def.sumable, lectura: def.lectura, filas, total: resumenOpps(leads) };
}

export type FilaMotivo = { motivo: string; texto: string; episodios: number; oportunidades: number };
export type TablaPerdidas = { filas: FilaMotivo[]; episodios: number; oportunidades: number; reabiertas: number };

export type FilaProducto = { codigo: string; nombre: string; ventas: number; experiencias: number; importe: Centavos };

export type Tablero = {
  consultado_en: string; hoy: string; periodo: Periodo; filtros: Filtros; filtro_negocio: boolean;
  metricas: Record<IdMetrica, ResultadoMetrica>;
  leads_desglose: { nuevas: number; clientes: number };
  cohorte: Cohorte;
  jornadas: FilaJornada[];
  /** Ventas cerradas en el período sin una jornada atribuible (recompras de Administración espontáneas, etc.). */
  sin_jornada: { ventas: number; importe: Centavos };
  segmentos: Record<Dimension, TablaSegmento>;
  perdidas: TablaPerdidas;
  productos: FilaProducto[];
  opciones: {
    comerciales: Array<{ id: string; nombre: string }>; zonas: Array<{ id: string; nombre: string }>; rubros: Array<{ id: string; nombre: string }>;
    necesidades: Array<{ id: string; nombre: string }>;
  };
};

const suma = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

export function tablero(ctx: Contexto, periodo: Periodo, f: Filtros, ahora: Date): Tablero {
  const { desde, hasta } = periodo;
  const c = conjuntos(ctx, desde, hasta, f);
  const negocio = hayFiltroDeNegocio(f);
  const js = filasJornadas(ctx, desde, hasta, f);
  const conKm = js.filter((j) => j.km !== null);
  const completas = js.filter((j) => j.movilidad !== null);
  const noAplica: Valor = { tipo: "no_aplica", motivo: NO_APLICA_NEGOCIO };
  const m = (id: IdMetrica, valor: Valor, extra: Extra = {}): ResultadoMetrica => ({ id, valor, extra });
  const dinero = (cc: number): Valor => ({ tipo: "dinero", c: cc });
  const conteo = (n: number): Valor => ({ tipo: "conteo", n });
  const fueraKm = js.length - conKm.length;
  const fueraMov = js.length - completas.length;
  const cobrado = suma(c.cobros, (x) => x.importe);
  const pagado = suma(c.pagos, (x) => x.importe);
  const ventasJornadas = ctx.ventas.filter((x) => !!x.jornada && js.some((j) => j.id === x.jornada) && ventaCumple(ctx, x, { ...f, comercial: null }));
  const metricas: Record<IdMetrica, ResultadoMetrica> = {
    negocios_visitados: m("negocios_visitados", conteo(c.negocios.length)),
    leads: m("leads", conteo(c.leads.length), { nuevas: c.leads.filter((x) => x.clase === "nueva").length, clientes: c.leads.filter((x) => x.clase === "cliente").length }),
    ventas: m("ventas", conteo(c.ventas.length)),
    importe_acordado: m("importe_acordado", dinero(suma(c.ventas, (x) => x.v.importe))),
    cobrado: m("cobrado", dinero(cobrado)),
    comision_generada: m("comision_generada", dinero(suma(c.generadas, (x) => x.v.comision_importe ?? 0))),
    visitas: m("visitas", conteo(c.visitas.length)),
    responsables: m("responsables", conteo(c.responsables.length)),
    decisores: m("decisores", conteo(c.decisores.length)),
    interesados: m("interesados", conteo(c.interesados.length)),
    recompras_admin: m("recompras_admin", f.comercial ? { tipo: "no_aplica", motivo: "No tienen comercial de origen." } : conteo(c.recomprasAdmin.length)),
    visitas_con_lead: m("visitas_con_lead", razon(c.visitasConLead.length, c.visitas.length, true)),
    cohorte_interesados: m("cohorte_interesados", razon(c.leads.filter((x) => x.senal).length, c.leads.length, true)),
    cohorte_ventas: m("cohorte_ventas", razon(c.leads.filter((x) => x.venta).length, c.leads.length, true)),
    negocios_compradores: m("negocios_compradores", razon(c.cohorteNegocios.filter((x) => x.compro).length, c.cohorteNegocios.length, true)),
    jornadas: m("jornadas", conteo(js.length)),
    // Sin ninguna jornada con el dato completo, la suma es desconocida: «Sin datos», nunca 0.
    km: m("km", negocio ? noAplica : conKm.length ? { tipo: "km", v: suma(conKm, (j) => j.km!) } : { tipo: "sin_datos", motivo: "Ninguna jornada del período tiene los km cargados." },
      negocio ? {} : { pendientes: fueraKm }),
    movilidad: m("movilidad", negocio ? noAplica : completas.length ? dinero(suma(completas, (j) => j.movilidad!)) : { tipo: "sin_datos", motivo: "Ninguna jornada del período tiene los cuatro gastos cargados." },
      negocio ? {} : { pendientes: fueraMov, parcial: suma(js, (j) => j.movilidad_parcial) }),
    visitas_por_jornada: m("visitas_por_jornada", negocio ? noAplica : razon(suma(js, (j) => j.visitas), js.length)),
    km_por_visita: m("km_por_visita", negocio ? noAplica : razon(suma(conKm, (j) => j.km!), suma(conKm, (j) => j.visitas)), negocio ? {} : { pendientes: fueraKm }),
    km_por_lead: m("km_por_lead", negocio ? noAplica : razon(suma(conKm, (j) => j.km!), suma(conKm, (j) => j.leads)), negocio ? {} : { pendientes: fueraKm }),
    movilidad_por_visita: m("movilidad_por_visita", negocio ? noAplica : razon(suma(completas, (j) => j.movilidad!), suma(completas, (j) => j.visitas), false, true),
      negocio ? {} : { pendientes: fueraMov }),
    movilidad_por_lead: m("movilidad_por_lead", negocio ? noAplica : razon(suma(completas, (j) => j.movilidad!), suma(completas, (j) => j.leads), false, true),
      negocio ? {} : { pendientes: fueraMov }),
    movilidad_por_venta: m("movilidad_por_venta", negocio ? noAplica : razon(suma(completas, (j) => j.movilidad!), suma(completas, (j) => j.ventas), false, true),
      negocio ? {} : { pendientes: fueraMov }),
    ventas_por_jornada: m("ventas_por_jornada", negocio ? noAplica : razon(suma(js, (j) => j.ventas), js.length)),
    importe_por_jornada: m("importe_por_jornada", negocio ? noAplica : razon(suma(js, (j) => j.importe), js.length, false, true)),
    ventas_jornadas: m("ventas_jornadas", conteo(ventasJornadas.length), { importe: suma(ventasJornadas, (x) => x.v.importe) }),
    perdidas: m("perdidas", conteo(c.episodios.length), { oportunidades: new Set(c.episodios.map((e) => e.oportunidad_id)).size }),
    experiencias: m("experiencias", conteo(suma(c.ventas, (x) => x.v.experiencias))),
    saldo_actual: m("saldo_actual", dinero(suma(c.ventas, (x) => x.v.importe - x.cobrado))),
    comision_prevista: m("comision_prevista", dinero(suma(c.ventasComision.filter((x) => !x.generadaEl), (x) => x.v.comision_importe ?? 0))),
    comision_a_pagar: m("comision_a_pagar", dinero(suma(c.ventasComision.filter((x) => x.generadaEl), (x) => Math.max(0, (x.v.comision_importe ?? 0) - x.pagado)))),
    comision_pagada: m("comision_pagada", dinero(pagado)),
    cobros_menos_comisiones: m("cobros_menos_comisiones", dinero(cobrado - pagado)),
  };

  const leadsTodas = c.leads;
  const edades = leadsTodas.map((x) => diasEntre(x.fechaLead, ctx.hoy) - 1);
  const cohorte: Cohorte = {
    observado_hasta: ctx.hoy, leads: leadsTodas.length, interesados: leadsTodas.filter((x) => x.senal).length, ventas: leadsTodas.filter((x) => x.venta).length,
    abiertas: leadsTodas.filter((x) => x.o.estado !== "perdida" && x.o.estado !== "ganada" && !x.o.cierre_motivo).length,
    perdidas: leadsTodas.filter((x) => x.o.estado === "perdida").length, ganadas: leadsTodas.filter((x) => x.o.estado === "ganada").length,
    antiguedad: edades.length ? { minima: Math.min(...edades), maxima: Math.max(...edades) } : null,
    por_clase: [
      ...(["nueva", "cliente"] as const).map((k) => {
        const xs = leadsTodas.filter((x) => x.clase === k);
        return { clase: k, leads: xs.length, interesados: xs.filter((x) => x.senal).length, ventas: xs.filter((x) => x.venta).length };
      }),
      { clase: "recompra_admin" as const, leads: c.recomprasAdmin.length, interesados: c.recomprasAdmin.filter((x) => x.senal).length, ventas: c.recomprasAdmin.filter((x) => x.venta).length },
    ],
  };

  const motivos = new Map<string, { episodios: number; opps: Set<string> }>();
  for (const e of c.episodios) {
    const g = motivos.get(e.motivo) ?? { episodios: 0, opps: new Set<string>() };
    g.episodios++;
    g.opps.add(e.oportunidad_id);
    motivos.set(e.motivo, g);
  }
  const oppsPerdidas = new Set(c.episodios.map((e) => e.oportunidad_id));
  const perdidas: TablaPerdidas = {
    filas: [...motivos.entries()].map(([motivo, g]) => ({ motivo, texto: MOTIVOS_PERDIDA.find((x) => x.valor === motivo)?.texto ?? motivo, episodios: g.episodios, oportunidades: g.opps.size }))
      .sort((a, b) => b.episodios - a.episodios || a.texto.localeCompare(b.texto)),
    episodios: c.episodios.length, oportunidades: oppsPerdidas.size,
    reabiertas: [...oppsPerdidas].filter((id) => ctx.oportunidad.get(id)!.o.estado !== "perdida").length,
  };

  const prods = new Map<string, FilaProducto>();
  for (const x of c.ventas) {
    const p = prods.get(x.v.producto_codigo) ?? { codigo: x.v.producto_codigo, nombre: x.v.producto_nombre, ventas: 0, experiencias: 0, importe: 0 };
    p.ventas++;
    p.experiencias += x.v.experiencias;
    p.importe += x.v.importe;
    prods.set(x.v.producto_codigo, p);
  }
  const sinJ = c.ventas.filter((x) => !x.jornada);
  const usados = new Set(ctx.datos.jornadas.map((j) => j.usuario_id));
  return {
    consultado_en: ahora.toISOString(), hoy: ctx.hoy, periodo, filtros: f, filtro_negocio: negocio, metricas,
    leads_desglose: { nuevas: c.leads.filter((x) => x.clase === "nueva").length, clientes: c.leads.filter((x) => x.clase === "cliente").length },
    cohorte, jornadas: js, sin_jornada: { ventas: sinJ.length, importe: suma(sinJ, (x) => x.v.importe) },
    segmentos: Object.fromEntries(DIMENSIONES.map((d) => [d.valor, segmento(ctx, c.leads, d.valor)])) as Record<Dimension, TablaSegmento>,
    perdidas, productos: [...prods.values()].sort((a, b) => b.importe - a.importe),
    opciones: {
      comerciales: ctx.datos.usuarios.filter((u) => usados.has(u.id) || ctx.datos.oportunidades.some((o) => o.origen_usuario_id === u.id)).map((u) => ({ id: u.id, nombre: u.nombre })),
      zonas: [...ctx.datos.zonas, { id: SIN_ZONA, nombre: "Sin zona" }], rubros: [...ctx.datos.rubros, { id: SIN_RUBRO, nombre: "Sin rubro de la lista" }],
      necesidades: NECESIDADES.map((n) => ({ id: n.valor, nombre: n.texto })),
    },
  };
}

// ── Detalle (el MISMO conjunto que la cifra) ───────────────────────────────
/** `soloTotal`: columna de conteo (1 por fila) que existe para el total; no se muestra en cada fila. */
export type Columna = { titulo: string; tipo: "texto" | "fecha" | "dinero" | "numero"; soloTotal?: boolean };
export type FilaDetalle = { id: string; href: string | null; celdas: Array<string | number | null> };
export type Detalle = {
  id: string; titulo: string; definicion: Definicion | null; columnas: Columna[]; filas: FilaDetalle[];
  /** Totales de las columnas numéricas o de dinero (null en las demás): coinciden con la cifra. */
  totales: Array<number | null>; nota: string | null;
};

const nombreNegocio = (ctx: Contexto, id: string) => {
  const e = ctx.empresa.get(id);
  return e ? `${e.nombre}${e.archivada ? " (archivado)" : ""}` : "Negocio";
};
const hrefNegocio = (id: string) => `/admin/crm/negocios/${id}`;
const hrefVenta = (id: string) => `/admin/crm/ventas/${id}`;
const hrefOpp = (id: string) => `/admin/crm/seguimiento?op=${id}`;
function totalesDe(cols: Columna[], filas: FilaDetalle[]): Array<number | null> {
  return cols.map((c, i) => (c.tipo === "dinero" || c.tipo === "numero" ? filas.reduce((s, f) => s + (typeof f.celdas[i] === "number" ? (f.celdas[i] as number) : 0), 0) : null));
}

export const DETALLES_EXTRA = ["segmento", "jornada"] as const;

export function detalle(ctx: Contexto, periodo: Periodo, f: Filtros, id: string, extra: { dimension?: string; valor?: string; jornada?: string } = {}): Detalle | null {
  const { desde, hasta } = periodo;
  const c = conjuntos(ctx, desde, hasta, f);
  const def = (DEFINICIONES as Record<string, Definicion>)[id] ?? null;
  const armar = (titulo: string, columnas: Columna[], filas: FilaDetalle[], nota: string | null = null): Detalle =>
    ({ id, titulo, definicion: def, columnas, filas, totales: totalesDe(columnas, filas), nota });
  const colVisitas: Columna[] = [{ titulo: "Fecha", tipo: "fecha" }, { titulo: "Negocio", tipo: "texto" }, { titulo: "Comercial", tipo: "texto" },
    { titulo: "Responsable", tipo: "texto" }, { titulo: "Decisor", tipo: "texto" }, { titulo: "Interés", tipo: "texto" }, { titulo: "Originó lead", tipo: "texto" }, { titulo: "Visitas", tipo: "numero", soloTotal: true }];
  const origenes = new Set(c.visitasConLead.map((v) => v.id));
  const filaVisita = (v: Visita): FilaDetalle => ({
    id: v.id, href: hrefNegocio(v.empresa_id), celdas: [v.fecha, nombreNegocio(ctx, v.empresa_id), ctx.usuario.get(v.usuario_id) ?? "Comercial",
      v.responsable ? "Sí" : "No", v.decisor ? "Sí" : "No", v.interes ? textoOpcion(INTERESES, v.interes) ?? v.interes : "No evaluado", origenes.has(v.id) ? "Sí" : "No", 1],
  });
  const colNegocios: Columna[] = [{ titulo: "Negocio", tipo: "texto" }, { titulo: "Rubro", tipo: "texto" }, { titulo: "Zona del negocio", tipo: "texto" },
    { titulo: "Visitas en el período", tipo: "numero" }, { titulo: "Negocios", tipo: "numero", soloTotal: true }];
  const filaNegocio = (id: string): FilaDetalle => {
    const e = ctx.empresa.get(id);
    return { id, href: hrefNegocio(id), celdas: [nombreNegocio(ctx, id), e?.rubro ?? "—", e?.zona ?? "—", c.visitas.filter((v) => v.empresa_id === id).length, 1] };
  };
  const colOpps: Columna[] = [{ titulo: "Lead", tipo: "fecha" }, { titulo: "Negocio", tipo: "texto" }, { titulo: "Tipo", tipo: "texto" }, { titulo: "Comercial de origen", tipo: "texto" },
    { titulo: "Estado actual", tipo: "texto" }, { titulo: "Primera señal de interés", tipo: "fecha" }, { titulo: "Venta (acuerdo)", tipo: "fecha" }, { titulo: "Importe de la venta", tipo: "dinero" },
    { titulo: "Oportunidades", tipo: "numero", soloTotal: true }];
  const filaOpp = (x: InfoOportunidad): FilaDetalle => ({
    id: x.o.id, href: hrefOpp(x.o.id), celdas: [x.fechaLead, nombreNegocio(ctx, x.o.empresa_id), TEXTO_CLASE[x.clase],
      x.o.origen_usuario_id ? ctx.usuario.get(x.o.origen_usuario_id) ?? "Comercial" : "Administración",
      ESTADOS_OPORTUNIDAD.find((s) => s.valor === x.o.estado)?.texto ?? x.o.estado, x.senal, x.venta?.fecha_acuerdo ?? null, x.venta?.importe ?? null, 1],
  });
  const colVentas: Columna[] = [{ titulo: "Acuerdo", tipo: "fecha" }, { titulo: "Negocio", tipo: "texto" }, { titulo: "Producto", tipo: "texto" }, { titulo: "Jornada atribuida", tipo: "texto" },
    { titulo: "Ventas", tipo: "numero", soloTotal: true }, { titulo: "Experiencias", tipo: "numero" }, { titulo: "Importe acordado", tipo: "dinero" }, { titulo: "Saldo hoy", tipo: "dinero" },
    { titulo: "Comisión generada el", tipo: "fecha" }];
  const textoJornada = (j: string | null) => {
    if (!j) return "Sin jornada";
    const jj = ctx.jornada.get(j);
    return jj ? `${fechaTexto(jj.fecha)} · ${ctx.usuario.get(jj.usuario_id) ?? "Comercial"}` : "Sin jornada";
  };
  const filaVenta = (x: InfoVenta): FilaDetalle => ({
    id: x.v.id, href: hrefVenta(x.v.id), celdas: [x.v.fecha_acuerdo, nombreNegocio(ctx, x.v.empresa_id), x.v.producto_nombre, textoJornada(x.jornada), 1, x.v.experiencias,
      x.v.importe, x.v.importe - x.cobrado, x.generadaEl],
  });
  const colComision: Columna[] = [{ titulo: "Generada el", tipo: "fecha" }, { titulo: "Negocio", tipo: "texto" }, { titulo: "Beneficiario", tipo: "texto" },
    { titulo: "Comisión pactada", tipo: "dinero" }, { titulo: "Pagado hasta hoy", tipo: "dinero" }, { titulo: "A pagar hoy", tipo: "dinero" }];
  const filaComision = (x: InfoVenta, fecha: string | null): FilaDetalle => ({
    id: x.v.id, href: hrefVenta(x.v.id), celdas: [fecha, nombreNegocio(ctx, x.v.empresa_id), x.v.beneficiario_id ? ctx.usuario.get(x.v.beneficiario_id) ?? "Comercial" : "—",
      x.v.comision_importe ?? 0, x.pagado, x.generadaEl ? Math.max(0, (x.v.comision_importe ?? 0) - x.pagado) : 0],
  });
  const colJornadas: Columna[] = [{ titulo: "Fecha", tipo: "fecha" }, { titulo: "Comercial", tipo: "texto" }, { titulo: "Zona de la jornada", tipo: "texto" },
    { titulo: "Visitas", tipo: "numero" }, { titulo: "Leads", tipo: "numero" }, { titulo: "Ventas atribuidas", tipo: "numero" }, { titulo: "Km", tipo: "numero" },
    { titulo: "Movilidad", tipo: "dinero" }, { titulo: "Pendiente", tipo: "texto" }, { titulo: "Jornadas", tipo: "numero", soloTotal: true }];
  const js = filasJornadas(ctx, desde, hasta, f);
  const filaJornada = (j: FilaJornada): FilaDetalle => ({
    id: j.id, href: `/admin/crm/jornadas/${j.id}`, celdas: [j.fecha, j.comercial.nombre, j.zona ?? "—", j.visitas, j.leads, j.ventas, j.km, j.movilidad, j.pendientes.join(", ") || "—", 1],
  });

  switch (id) {
    case "visitas": case "visitas_con_lead":
      return armar(def!.nombre, colVisitas, c.visitas.map(filaVisita), id === "visitas_con_lead" ? `Originaron un lead: ${c.visitasConLead.length} de ${c.visitas.length}.` : null);
    case "negocios_visitados": return armar(def!.nombre, colNegocios, c.negocios.map(filaNegocio));
    case "responsables": return armar(def!.nombre, colNegocios, c.responsables.map(filaNegocio));
    case "decisores": return armar(def!.nombre, colNegocios, c.decisores.map(filaNegocio));
    case "leads": case "cohorte_interesados": case "cohorte_ventas":
      return armar(def!.nombre, colOpps, c.leads.map(filaOpp), id === "leads" ? null
        : id === "cohorte_interesados" ? `Con señal de interés: ${c.leads.filter((x) => x.senal).length} de ${c.leads.length}. Observado hasta ${ctx.hoy}.`
          : `Con venta vigente: ${c.leads.filter((x) => x.venta).length} de ${c.leads.length}. Observado hasta ${ctx.hoy}.`);
    case "interesados": return armar(def!.nombre, colOpps, c.interesados.map(filaOpp));
    case "recompras_admin": return armar(def!.nombre, colOpps, c.recomprasAdmin.map(filaOpp));
    case "negocios_compradores":
      return armar(def!.nombre, [{ titulo: "Primera visita", tipo: "fecha" }, { titulo: "Negocio", tipo: "texto" }, { titulo: "Compró después", tipo: "texto" }, { titulo: "Negocios", tipo: "numero", soloTotal: true }],
        c.cohorteNegocios.map((x) => ({ id: x.id, href: hrefNegocio(x.id), celdas: [x.fecha, nombreNegocio(ctx, x.id), x.compro ? "Sí" : "No", 1] })),
        `Compraron: ${c.cohorteNegocios.filter((x) => x.compro).length} de ${c.cohorteNegocios.length}. Observado hasta ${ctx.hoy}.`);
    case "ventas": case "importe_acordado": case "experiencias": case "saldo_actual":
      return armar(def!.nombre, colVentas, c.ventas.map(filaVenta));
    case "comision_prevista":
      return armar(def!.nombre, colComision, c.ventasComision.filter((x) => !x.generadaEl).map((x) => filaComision(x, null)));
    case "comision_a_pagar":
      return armar(def!.nombre, colComision, c.ventasComision.filter((x) => x.generadaEl).map((x) => filaComision(x, x.generadaEl)));
    case "comision_generada": return armar(def!.nombre, colComision, c.generadas.map((x) => filaComision(x, x.generadaEl)));
    case "cobrado": case "comision_pagada": case "cobros_menos_comisiones": {
      const filas: FilaDetalle[] = [
        ...(id !== "comision_pagada" ? c.cobros.map((x) => ({ id: x.id, href: hrefVenta(x.venta_id), celdas: [x.fecha, nombreNegocio(ctx, ctx.ventaDe.get(x.venta_id)!.v.empresa_id), "Cobro", x.importe] as Array<string | number | null> })) : []),
        ...(id !== "cobrado" ? c.pagos.map((x) => ({ id: x.id, href: hrefVenta(x.venta_id), celdas: [x.fecha, nombreNegocio(ctx, ctx.ventaDe.get(x.venta_id)!.v.empresa_id),
          `Pago de comisión a ${ctx.usuario.get(x.beneficiario_id) ?? "Comercial"}`, id === "cobros_menos_comisiones" ? -x.importe : x.importe] as Array<string | number | null> })) : []),
      ].sort((a, b) => String(a.celdas[0]).localeCompare(String(b.celdas[0])));
      return armar(def!.nombre, [{ titulo: "Fecha", tipo: "fecha" }, { titulo: "Negocio", tipo: "texto" }, { titulo: "Movimiento", tipo: "texto" }, { titulo: "Importe", tipo: "dinero" }], filas,
        id === "cobros_menos_comisiones" ? "Los pagos de comisión van en negativo. No descuenta movilidad, experiencias, impuestos ni gastos fijos." : null);
    }
    case "jornadas": case "km": case "movilidad": case "visitas_por_jornada": case "km_por_visita": case "km_por_lead": case "movilidad_por_visita":
    case "movilidad_por_lead": case "movilidad_por_venta": case "ventas_por_jornada": case "importe_por_jornada":
      return armar(def!.nombre, colJornadas, js.map(filaJornada), hayFiltroDeNegocio(f) ? NO_APLICA_NEGOCIO : "Km y movilidad vacíos = sin cargar (no son 0).");
    case "ventas_jornadas": {
      const ids = new Set(js.map((j) => j.id));
      return armar(def!.nombre, colVentas, ctx.ventas.filter((x) => !!x.jornada && ids.has(x.jornada) && ventaCumple(ctx, x, { ...f, comercial: null })).map(filaVenta));
    }
    case "perdidas":
      return armar(def!.nombre, [{ titulo: "Fecha", tipo: "fecha" }, { titulo: "Negocio", tipo: "texto" }, { titulo: "Motivo", tipo: "texto" }, { titulo: "Ciclo", tipo: "texto" }, { titulo: "Episodios", tipo: "numero", soloTotal: true }],
        c.episodios.sort((a, b) => a.en.localeCompare(b.en)).map((e) => {
          const x = ctx.oportunidad.get(e.oportunidad_id)!;
          return { id: `${e.oportunidad_id}-${e.ciclo}`, href: hrefOpp(e.oportunidad_id), celdas: [fechaSim(e.en), nombreNegocio(ctx, x.o.empresa_id),
            MOTIVOS_PERDIDA.find((mm) => mm.valor === e.motivo)?.texto ?? e.motivo, e.vigente ? "Vigente" : `Ciclo ${e.ciclo} (reabierta)`, 1] };
        }), `${new Set(c.episodios.map((e) => e.oportunidad_id)).size} oportunidad(es) distinta(s).`);
    case "segmento": {
      const d = DIMENSIONES.find((x) => x.valor === extra.dimension);
      if (!d) return null;
      const xs = c.leads.filter((x) => valoresDe(ctx, x, d.valor).some(([v]) => v === extra.valor));
      const t = (xs[0] ? valoresDe(ctx, xs[0], d.valor).find(([v]) => v === extra.valor)?.[1] : null) ?? extra.valor ?? "";
      return { ...armar(`${d.texto}: ${t}`, colOpps, xs.map(filaOpp), d.lectura), definicion: null };
    }
    case "jornada": {
      const j = js.find((x) => x.id === extra.jornada);
      if (!j) return null;
      const vs = ctx.visitas.filter((v) => v.jornada_id === j.id && visitaCumple(ctx, v, { ...f, comercial: null }));
      return { ...armar(`Jornada del ${fechaTexto(j.fecha)} · ${j.comercial.nombre}`, colVisitas, vs.map(filaVisita)), definicion: null };
    }
    default: return null;
  }
}

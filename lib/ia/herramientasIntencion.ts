// IA SIM · Bloque 4D.2 — Selección de herramientas por INTENCIÓN. No se ofrecen las ~10
// herramientas en cada request (cada schema cuesta tokens): solo las que la consulta puede
// necesitar. Determinístico y testeable. Reduce el contexto facturable sin perder capacidad.

// Núcleo de datos internos (siempre disponible: son la base de cualquier análisis de SIM).
// Bloque 5A — consulta_analitica_interna entra al núcleo: es la que resuelve las preguntas con
// métrica + período + filtros + agrupación que antes no tenían ninguna herramienta capaz.
const NUCLEO_INTERNO = ["consultar_metricas_equipo", "consultar_cronograma", "consultar_finanzas", "consultar_metricas_stand_reservas", "consultar_empleados", "consulta_analitica_interna"];
const CONOCIMIENTO = ["buscar_conocimiento_sim", "obtener_fragmento_documento", "listar_documentos_conocimiento"];
const COLECTIVO = ["consultar_colectivo"];
const INFORME = ["preparar_informe"];
// Bloque 4E — comparaciones/anomalías/proyecciones (determinístico; FODA no pasa por acá, ver
// server.ts: usa su propio flujo de síntesis estructurada terminal).
const ANALISIS = ["comparar_periodos", "detectar_anomalias", "proyectar_periodo"];

const RE_INFORME = /\b(informe|pdf|excel|word|docx|xlsx|csv|planilla|descarg|archivo|reporte|gr[áa]fico|documento para)\b/i;
const RE_COLECTIVO = /\bcolectiv/i;
const RE_CONOCIMIENTO = /\b(document|archivo|manual|pol[ií]tica|conocimiento|reglament|versi[oó]n|categor[ií]a|seg[uú]n el|lo que guard[eé]|la imagen que sub[ií]|adjunt|pdf|excel|planilla)\b/i;
const RE_ANALISIS = /\b(compar|versus|\bvs\b|diferencia|variaci[oó]n|anomal[ií]a|anomal[ií]as|at[ií]pic|inusual|proyec|estima|pronostic|tendencia|escenario|cierre del mes|conservador|optimista)\b/i;

export type IntencionOpts = { conocimientoRelevante?: boolean; disponibles?: string[] };

// Devuelve los NOMBRES de herramientas a ofrecer para esta consulta.
export function seleccionarHerramientas(pregunta: string, opts?: IntencionOpts): string[] {
  const t = pregunta || "";
  const set = new Set<string>(NUCLEO_INTERNO);
  if (RE_COLECTIVO.test(t)) COLECTIVO.forEach((n) => set.add(n));
  if (RE_INFORME.test(t)) INFORME.forEach((n) => set.add(n));
  if (RE_ANALISIS.test(t)) ANALISIS.forEach((n) => set.add(n));
  // Conocimiento: solo si el pedido lo sugiere o ya se recuperó contexto documental relevante.
  if (opts?.conocimientoRelevante || RE_CONOCIMIENTO.test(t)) CONOCIMIENTO.forEach((n) => set.add(n));
  // Filtrar a las realmente registradas (por si cambia el registro).
  const disponibles = opts?.disponibles;
  const nombres = [...set];
  return disponibles ? nombres.filter((n) => disponibles.includes(n)) : nombres;
}

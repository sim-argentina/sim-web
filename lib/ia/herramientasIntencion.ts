// IA SIM · Bloque 4D.2 — Selección de herramientas por INTENCIÓN. No se ofrecen las ~10
// herramientas en cada request (cada schema cuesta tokens): solo las que la consulta puede
// necesitar. Determinístico y testeable. Reduce el contexto facturable sin perder capacidad.

// Núcleo de datos internos (siempre disponible: son la base de cualquier análisis de SIM).
const NUCLEO_INTERNO = ["consultar_metricas_equipo", "consultar_cronograma", "consultar_finanzas", "consultar_metricas_stand_reservas", "consultar_empleados"];
const CONOCIMIENTO = ["buscar_conocimiento_sim", "obtener_fragmento_documento", "listar_documentos_conocimiento"];
const COLECTIVO = ["consultar_colectivo"];
const INFORME = ["preparar_informe"];

const RE_INFORME = /\b(informe|pdf|excel|word|docx|xlsx|csv|planilla|descarg|archivo|reporte|gr[áa]fico|documento para)\b/i;
const RE_COLECTIVO = /\bcolectiv/i;
const RE_CONOCIMIENTO = /\b(document|archivo|manual|pol[ií]tica|conocimiento|reglament|versi[oó]n|categor[ií]a|seg[uú]n el|lo que guard[eé]|la imagen que sub[ií]|adjunt|pdf|excel|planilla)\b/i;

export type IntencionOpts = { conocimientoRelevante?: boolean; disponibles?: string[] };

// Devuelve los NOMBRES de herramientas a ofrecer para esta consulta.
export function seleccionarHerramientas(pregunta: string, opts?: IntencionOpts): string[] {
  const t = pregunta || "";
  const set = new Set<string>(NUCLEO_INTERNO);
  if (RE_COLECTIVO.test(t)) COLECTIVO.forEach((n) => set.add(n));
  if (RE_INFORME.test(t)) INFORME.forEach((n) => set.add(n));
  // Conocimiento: solo si el pedido lo sugiere o ya se recuperó contexto documental relevante.
  if (opts?.conocimientoRelevante || RE_CONOCIMIENTO.test(t)) CONOCIMIENTO.forEach((n) => set.add(n));
  // Filtrar a las realmente registradas (por si cambia el registro).
  const disponibles = opts?.disponibles;
  const nombres = [...set];
  return disponibles ? nombres.filter((n) => disponibles.includes(n)) : nombres;
}

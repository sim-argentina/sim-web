// IA SIM · Corrección 4D.5.2 — Esquema ESTRUCTURADO y TERMINAL para el análisis competitivo/
// mixto (interno + web). Reemplaza la síntesis en Markdown libre (4D.1-4D.5.1, que dependía de
// un presupuesto de tokens de salida no acotable de forma confiable) por una herramienta forzada
// (`tool_choice`) con campos y longitudes máximas conocidas de antemano. El servidor arma el
// Markdown final de forma DETERMINÍSTICA (ver renderAnalisisWeb.ts); el modelo nunca redacta la
// presentación, solo completa esta estructura citando SOLO los IDs de fuente que el servidor le
// ofreció (nunca URLs/nombres de fuente inventados).

import { clasificarEntidad, type ClaseEntidad } from "@/lib/ia/entidad";

export const NOMBRE_EMITIR_ANALISIS_WEB = "emitir_analisis_web";

// Límites SERVER-SIDE (§5 de la corrección). No son sugerencias: se aplican con recorte/rechazo.
export const LIMITES_ANALISIS_WEB = {
  respuestaDirectaLen: 700,
  datosInternosMax: 4,
  actoresMin: 1,
  actoresMax: 5,
  evidenciaLen: 300,
  fuenteIdsPorActorMax: 2,
  comparacionMax: 6,
  celdaComparacionLen: 220,
  aspectoLen: 80,
  noDeterminableMax: 4,
  noDeterminableLen: 200,
  conclusionLen: 700,
  nombreActorLen: 120,
};

const L = LIMITES_ANALISIS_WEB;

export const DESCRIPCION_EMITIR_ANALISIS_WEB =
  "Emite el análisis competitivo final (interno + externo) en una estructura acotada. Es la ÚNICA forma de responder a esta consulta: no generes texto libre aparte, el servidor arma la presentación a partir de estos campos. " +
  "Citá SOLO ids de 'datos_internos_disponibles' y 'fuentes_externas_disponibles' que te dio el servidor (nunca inventes URLs, nombres de fuente ni ids). " +
  "Priorizá los 3 a 5 actores más relevantes. Si algo no se puede determinar con las fuentes disponibles, listalo en no_determinable en vez de inventarlo. " +
  "Mantené cada campo dentro de su longitud: preferí una frase breve y cerrada antes que una más larga.";

// ── Esquema JSON que ve el proveedor (Anthropic tool input_schema) ──────────────────────────
export const SCHEMA_EMITIR_ANALISIS_WEB: Record<string, unknown> = {
  type: "object",
  properties: {
    respuesta_directa: { type: "string", description: `Respuesta directa a la pregunta, máx ${L.respuestaDirectaLen} caracteres.` },
    datos_internos_ids: {
      type: "array", items: { type: "string" }, maxItems: L.datosInternosMax,
      description: `IDs (de 'datos_internos_disponibles') de los datos internos de SIM relevantes para esta comparación, máx ${L.datosInternosMax}. No reescribas el texto: el servidor ya lo tiene.`,
    },
    actores_externos: {
      type: "array", minItems: L.actoresMin, maxItems: L.actoresMax,
      description: "Actores externos encontrados en las fuentes, del más al menos relevante.",
      items: {
        type: "object",
        properties: {
          nombre: { type: "string", description: `Nombre del actor, máx ${L.nombreActorLen} caracteres.` },
          evidencia: { type: "string", description: `Qué encontraste sobre este actor y por qué, máx ${L.evidenciaLen} caracteres.` },
          fuente_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: L.fuenteIdsPorActorMax, description: "1 a 2 ids de 'fuentes_externas_disponibles' que respaldan este actor." },
          actividad_comparable: { type: "boolean", description: "¿Ofrece una experiencia/servicio comparable a simuladores de SIM?" },
          ubicacion_cordoba: { type: "boolean", description: "¿Sede física confirmada en Córdoba, según la fuente?" },
          vigencia_reciente: { type: "boolean", description: "¿Hay evidencia de que opera actualmente (no solo un anuncio viejo o cerrado)?" },
          es_fabricante: { type: "boolean", description: "¿Vende equipamiento/hardware (cabinas, butacas) en vez de operar un local?" },
          es_red_nacional: { type: "boolean", description: "¿Es una red/plataforma nacional SIN sede local confirmada en Córdoba?" },
          es_evento: { type: "boolean", description: "¿Es un evento/feria puntual, no un operador permanente?" },
        },
        required: ["nombre", "evidencia", "fuente_ids", "actividad_comparable", "ubicacion_cordoba", "vigencia_reciente", "es_fabricante", "es_red_nacional", "es_evento"],
        additionalProperties: false,
      },
    },
    comparacion: {
      type: "array", maxItems: L.comparacionMax,
      description: `Tabla comparativa SIM vs. mercado, máx ${L.comparacionMax} filas, solo dimensiones genuinamente comparables.`,
      items: {
        type: "object",
        properties: {
          aspecto: { type: "string", description: `Qué se compara (ej: 'Ubicación', 'Modalidad'), máx ${L.aspectoLen} caracteres.` },
          sim: { type: "string", description: `Dato de SIM para este aspecto, máx ${L.celdaComparacionLen} caracteres.` },
          mercado: { type: "string", description: `Dato del mercado para este aspecto, máx ${L.celdaComparacionLen} caracteres. Si no hay evidencia comparable, escribí "No disponible en las fuentes consultadas".` },
          fuente_ids: { type: "array", items: { type: "string" }, maxItems: 2, description: "Hasta 2 ids (internos y/o externos) que respaldan esta fila. Vacío si no hay evidencia comparable." },
        },
        required: ["aspecto", "sim", "mercado", "fuente_ids"],
        additionalProperties: false,
      },
    },
    no_determinable: {
      type: "array", items: { type: "string" }, maxItems: L.noDeterminableMax,
      description: `Información pedida o relevante que NO se puede determinar con lo disponible, máx ${L.noDeterminableMax} ítems.`,
    },
    conclusion: { type: "string", description: `Conclusión prudente, máx ${L.conclusionLen} caracteres.` },
  },
  required: ["respuesta_directa", "datos_internos_ids", "actores_externos", "comparacion", "no_determinable", "conclusion"],
  additionalProperties: false,
};

// ── Fuentes que el SERVIDOR ofrece (el modelo solo puede citar estos ids) ───────────────────
export type FuenteInternaDisponible = { id: string; texto: string; modulo: string; periodo?: string | null; actualizado: string };
export type FuenteExternaDisponible = { id: string; titulo: string | null; url: string; dominio: string | null; fechaPublicada: string | null; fragmento: string | null };

// ── Estructura VALIDADA (post server-side) ───────────────────────────────────────────────────
export type ActorExternoValidado = {
  nombre: string; evidencia: string; fuenteIds: string[];
  clase: ClaseEntidad; motivoClasificacion: string;
};
export type FilaComparacionValidada = { aspecto: string; sim: string; mercado: string; fuenteIds: string[] };
export type AnalisisWebValidado = {
  respuestaDirecta: string;
  datosInternosIds: string[];
  actoresExternos: ActorExternoValidado[];
  comparacion: FilaComparacionValidada[];
  noDeterminable: string[];
  conclusion: string;
};

export type ResultadoValidacionAnalisis = { ok: true; spec: AnalisisWebValidado } | { ok: false; errores: string[] };

function esObj(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function esStr(v: unknown): v is string { return typeof v === "string"; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
// Una sola línea: evita que el modelo inyecte saltos que rompan listas/tablas/encabezados
// al insertarse en el Markdown construido por el servidor.
function unaLinea(v: unknown, max: number): string { return esStr(v) ? v.replace(/\s*\r?\n\s*/g, " ").trim().slice(0, max) : ""; }
function soloBool(v: unknown): boolean { return v === true; }

// Valida y NORMALIZA la salida estructurada del modelo. RECHAZA (no publica nada parcial) ante:
// ids de fuente inexistentes, ausencia de campos obligatorios o cero actores. RECORTA longitudes
// y cantidades por encima del límite (no es "inventar datos", es acotar presentación).
export function validarAnalisisWeb(entrada: unknown, ctx: { internas: FuenteInternaDisponible[]; externas: FuenteExternaDisponible[] }): ResultadoValidacionAnalisis {
  const errores: string[] = [];
  const o = esObj(entrada) ? entrada : {};
  const idsInternos = new Set(ctx.internas.map((f) => f.id));
  const idsExternos = new Set(ctx.externas.map((f) => f.id));

  const respuestaDirecta = unaLinea(o.respuesta_directa, L.respuestaDirectaLen);
  if (!respuestaDirecta) errores.push("Falta respuesta_directa.");

  const datosInternosIdsRaw = arr(o.datos_internos_ids).map((x) => String(x)).slice(0, L.datosInternosMax);
  for (const id of datosInternosIdsRaw) if (!idsInternos.has(id)) errores.push(`datos_internos_ids referencia un id inexistente: "${id}".`);
  const datosInternosIds = [...new Set(datosInternosIdsRaw)];

  const actoresRaw = arr(o.actores_externos);
  if (actoresRaw.length < L.actoresMin) errores.push("Debe haber al menos un actor externo (o declarar en no_determinable que no se encontraron).");
  const actoresExternos: ActorExternoValidado[] = actoresRaw.slice(0, L.actoresMax).map((a, i) => {
    const aa = esObj(a) ? a : {};
    const nombre = unaLinea(aa.nombre, L.nombreActorLen);
    if (!nombre) errores.push(`actores_externos[${i}] sin nombre.`);
    const evidencia = unaLinea(aa.evidencia, L.evidenciaLen);
    if (!evidencia) errores.push(`actores_externos[${i}] sin evidencia.`);
    const fuenteIdsRaw = arr(aa.fuente_ids).map((x) => String(x)).slice(0, L.fuenteIdsPorActorMax);
    if (fuenteIdsRaw.length === 0) errores.push(`actores_externos[${i}] ("${nombre}") sin fuente_ids: todo actor externo debe citar al menos una fuente.`);
    for (const id of fuenteIdsRaw) if (!idsExternos.has(id)) errores.push(`actores_externos[${i}] referencia una fuente externa inexistente: "${id}".`);
    const senales = {
      nombre,
      actividadComparable: soloBool(aa.actividad_comparable),
      ubicacionCordoba: soloBool(aa.ubicacion_cordoba),
      vigenciaReciente: soloBool(aa.vigencia_reciente),
      tieneFuente: fuenteIdsRaw.length > 0,
      esFabricante: soloBool(aa.es_fabricante),
      esRedNacional: soloBool(aa.es_red_nacional),
      esEvento: soloBool(aa.es_evento),
    };
    // Clasificación DETERMINÍSTICA server-side (lib/ia/entidad.ts): el modelo aporta señales
    // observadas, nunca la etiqueta final — así "confirmado" nunca depende de que el modelo se
    // autoevalúe de forma optimista.
    const { clase, motivo } = clasificarEntidad(senales);
    return { nombre, evidencia, fuenteIds: [...new Set(fuenteIdsRaw)], clase, motivoClasificacion: motivo };
  });

  const comparacionRaw = arr(o.comparacion).slice(0, L.comparacionMax);
  const comparacion: FilaComparacionValidada[] = comparacionRaw.map((f, i) => {
    const ff = esObj(f) ? f : {};
    const aspecto = unaLinea(ff.aspecto, L.aspectoLen) || `Aspecto ${i + 1}`;
    const fuenteIdsRaw = arr(ff.fuente_ids).map((x) => String(x)).slice(0, 2);
    for (const id of fuenteIdsRaw) {
      if (!idsInternos.has(id) && !idsExternos.has(id)) errores.push(`comparacion[${i}] ("${aspecto}") referencia una fuente inexistente: "${id}".`);
    }
    const fuenteIds = [...new Set(fuenteIdsRaw)];
    const SIN_EVIDENCIA = "No disponible en las fuentes consultadas.";
    // Sin fuente_ids → no hay evidencia comparable: la fila NO puede inventar una comparación,
    // sin importar lo que haya escrito el modelo en sim/mercado (§6).
    const sim = fuenteIds.length > 0 ? (unaLinea(ff.sim, L.celdaComparacionLen) || SIN_EVIDENCIA) : SIN_EVIDENCIA;
    const mercado = fuenteIds.length > 0 ? (unaLinea(ff.mercado, L.celdaComparacionLen) || SIN_EVIDENCIA) : SIN_EVIDENCIA;
    return { aspecto, sim, mercado, fuenteIds };
  });

  const noDeterminable = arr(o.no_determinable).map((x) => unaLinea(x, L.noDeterminableLen)).filter(Boolean).slice(0, L.noDeterminableMax);

  const conclusion = unaLinea(o.conclusion, L.conclusionLen);
  if (!conclusion) errores.push("Falta conclusion.");

  if (errores.length > 0) return { ok: false, errores };
  return { ok: true, spec: { respuestaDirecta, datosInternosIds, actoresExternos, comparacion, noDeterminable, conclusion } };
}

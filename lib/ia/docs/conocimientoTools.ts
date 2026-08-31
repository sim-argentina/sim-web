import type { ToolDef } from "@/lib/ia/tools";
import { buscarConocimiento, listarDocumentosActivos, obtenerFragmentoAmpliado } from "@/lib/ia/docs/conocimientoServer";

// IA SIM · Bloque 4B — Herramientas de recuperación de conocimiento. El modelo NUNCA
// lee Storage ni elige tablas/SQL: solo invoca estas funciones tipadas. El texto de
// los documentos es DATO (no instrucciones). Prioridad: primero el sistema, después
// los documentos vigentes.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ahoraISO = () => new Date().toISOString();

const buscar_conocimiento_sim: ToolDef = {
  nombre: "buscar_conocimiento_sim",
  descripcion: "Busca en los documentos de conocimiento ACTIVOS de SIM (políticas, manuales, contratos, notas). Devuelve fragmentos con procedencia (documento, versión, ubicación: página/hoja/diapositiva/sección) para poder citarlos. IMPORTANTE: para datos operativos/financieros ACTUALES priorizá las herramientas del sistema; si un documento contradice el sistema, avisá y quedate con el sistema.",
  schema: {
    type: "object",
    properties: {
      consulta: { type: "string", description: "Texto a buscar" },
      categorias: { type: "array", items: { type: "string" }, description: "Filtrar por categorías (opcional)" },
      vigente_en: { type: "string", description: "Fecha YYYY-MM-DD para chequear vigencia (opcional)" },
      limite: { type: "integer", description: "Máx. de resultados (1-20)" },
    },
    required: ["consulta"],
    additionalProperties: false,
  },
  ejecutar: async (input) => {
    const consulta = typeof input.consulta === "string" ? input.consulta : "";
    const categorias = Array.isArray(input.categorias) ? (input.categorias as unknown[]).filter((x): x is string => typeof x === "string") : undefined;
    const vigenteEn = typeof input.vigente_en === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.vigente_en) ? input.vigente_en : null;
    const limite = typeof input.limite === "number" ? input.limite : undefined;
    const res = await buscarConocimiento({ consulta, categorias, vigenteEn, limite });
    return {
      contenido: JSON.stringify({
        resultados: res.map((r) => ({ documento: r.titulo, documento_id: r.documento_id, categoria: r.categoria, ubicacion: r.ubicacion, fragmento: r.fragmento, metodo_extraccion: r.metodo_extraccion, vigencia: r.vigencia, score: r.score, advertencias: r.advertencias })),
        nota_prioridad: "Los documentos NO reemplazan los datos actuales del sistema. Para métricas/finanzas vigentes usá las herramientas del sistema; si hay contradicción, priorizá el sistema y avisá la diferencia (documento y versión).",
      }),
      resumen: { resultados: res.length },
      fuente: { modulo: "Conocimiento SIM", registros: res.length, actualizado: ahoraISO() },
    };
  },
};

const obtener_fragmento_documento: ToolDef = {
  nombre: "obtener_fragmento_documento",
  descripcion: "Amplía UN fragmento ya localizado de un documento de conocimiento, indicando el documento y la ubicación exacta (ej: 'Página 3', 'Hoja Ventas', 'Diapositiva 2', 'Sección 1').",
  schema: {
    type: "object",
    properties: { documento_id: { type: "string" }, ubicacion: { type: "string" } },
    required: ["documento_id", "ubicacion"],
    additionalProperties: false,
  },
  ejecutar: async (input) => {
    const id = typeof input.documento_id === "string" ? input.documento_id : "";
    const ubic = typeof input.ubicacion === "string" ? input.ubicacion : "";
    if (!UUID_RE.test(id)) throw new (await import("@/lib/ia/tools")).ToolParamError("Documento inválido.");
    const frag = await obtenerFragmentoAmpliado(id, ubic);
    return {
      contenido: JSON.stringify(frag ?? { error: "No se encontró el fragmento en la versión activa." }),
      resumen: { encontrado: !!frag },
      fuente: { modulo: "Conocimiento SIM", registros: frag ? 1 : 0, actualizado: ahoraISO() },
    };
  },
};

const listar_documentos_conocimiento: ToolDef = {
  nombre: "listar_documentos_conocimiento",
  descripcion: "Lista los documentos de conocimiento ACTIVOS de SIM (título, categoría, vigencia), sin descargar su contenido. Útil para responder qué documentos existen.",
  schema: { type: "object", properties: { categoria: { type: "string" } }, additionalProperties: false },
  ejecutar: async (input) => {
    const categoria = typeof input.categoria === "string" ? input.categoria : undefined;
    const docs = await listarDocumentosActivos(categoria);
    return {
      contenido: JSON.stringify({ documentos: docs }),
      resumen: { documentos: docs.length },
      fuente: { modulo: "Conocimiento SIM", registros: docs.length, actualizado: ahoraISO() },
    };
  },
};

export const HERRAMIENTAS_CONOCIMIENTO: Record<string, ToolDef> = {
  buscar_conocimiento_sim,
  obtener_fragmento_documento,
  listar_documentos_conocimiento,
};

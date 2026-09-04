// IA SIM · Bloque 4A — Abstracción de proveedor de IA (intercambiable).
// La interfaz es NEUTRAL: cada proveedor traduce a/desde su formato. Así se puede
// agregar OpenAI/Gemini sin tocar las herramientas de SIM ni la UI del chat.

import type { FuenteWeb } from "@/lib/ia/web/fuentes";

export type Uso = { tokensIn: number; tokensOut: number };

export type LlamadaHerramienta = { id: string; nombre: string; input: Record<string, unknown> };

export type ResultadoHerramienta = { id: string; nombre: string; contenido: string; ok: boolean };

// Datos de la búsqueda web SERVER-SIDE de Anthropic dentro de un turno (Bloque 4D):
// cantidad FACTURABLE de búsquedas, fuentes citadas y error normalizado si lo hubo.
export type WebTurno = { busquedasFacturables: number; fuentes: FuenteWeb[]; error?: string; consultas?: string[] };

// Un turno del proveedor: o produce texto final, o pide ejecutar herramientas.
// Ambos pueden traer `web` cuando el modelo usó la búsqueda web oficial (server tool).
// `rawContent` son los bloques CRUDOS del proveedor (opacos): se conservan para poder
// continuar el turno del asistente sin perder bloques cifrados (server_tool_use /
// web_search_tool_result / citas) cuando además hay herramientas internas.
// `stopReason` del proveedor (p. ej. "end_turn", "max_tokens", "tool_use", "pause_turn"):
// permite detectar truncamiento por límite de salida ANTES de publicar (Bloque 4D.3).
export type TurnoProveedor =
  | { tipo: "texto"; texto: string; uso: Uso; web?: WebTurno; rawContent?: unknown[]; stopReason?: string }
  | { tipo: "herramientas"; texto?: string; llamadas: LlamadaHerramienta[]; uso: Uso; web?: WebTurno; rawContent?: unknown[]; stopReason?: string };

// Historial neutral que el orquestador mantiene y pasa al proveedor.
export type HistorialTurno =
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto?: string; llamadas?: LlamadaHerramienta[]; rawContent?: unknown[] }
  | { rol: "tool"; resultados: ResultadoHerramienta[] };

export type HerramientaDef = { nombre: string; descripcion: string; schema: Record<string, unknown> };

// Habilitación de búsqueda web (Bloque 4D). La DECISIÓN es determinística y externa
// al proveedor; acá solo se le indica si puede usar la herramienta y con qué tope.
export type WebSearchParam = {
  habilitado: boolean; maxUsos: number; version: string;
  // Bloque 4D.3 — capacidades modernas (solo si el modelo/config las soportan).
  filtradoDinamico?: boolean; responseInclusionExcluded?: boolean;
  ubicacion?: { type: "approximate"; city?: string; region?: string; country?: string; timezone?: string };
};

// Bloque 4D.5.2 — fuerza al proveedor a usar UNA herramienta específica (tool_choice) en vez de
// dejarlo elegir libremente entre texto u herramientas. Se usa para la síntesis estructurada
// terminal del análisis web (nunca texto libre, nunca otra herramienta).
export type ToolChoiceParam = { nombre: string };

export type GenerarParams = {
  modelo: string;
  system: string;
  historial: HistorialTurno[];
  herramientas: HerramientaDef[];
  maxTokensSalida: number;
  timeoutMs: number;
  webSearch?: WebSearchParam;
  toolChoice?: ToolChoiceParam;
};

// ── Visión / OCR (Bloque 4B.1) ────────────────────────────────────────────────
export type ContenidoVisual =
  | { tipo: "imagen"; media_type: string; dataBase64: string }
  | { tipo: "pdf"; dataBase64: string };

export type ResultadoVisual = {
  texto_detectado: string;
  descripcion_visual: string;
  tablas: string;
  confianza: "alta" | "media" | "baja";
  advertencias: string[];
  paginas_o_imagenes: number;
  uso: Uso;
  crudo?: string; // respuesta cruda si no se pudo parsear JSON
};

export type AnalizarVisualParams = {
  modelo: string;
  contenidos: ContenidoVisual[];
  instruccion: string;
  maxTokensSalida: number;
  timeoutMs: number;
};

export interface IAProvider {
  nombre: string;
  generar(params: GenerarParams): Promise<TurnoProveedor>;
  // Opcional: OCR/visión. Si el proveedor/modelo no lo soporta, lanza IAProviderError.
  analizarVisual?(params: AnalizarVisualParams): Promise<ResultadoVisual>;
}

export class IAProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "IAProviderError";
  }
}

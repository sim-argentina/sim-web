// IA SIM · Bloque 4A — Abstracción de proveedor de IA (intercambiable).
// La interfaz es NEUTRAL: cada proveedor traduce a/desde su formato. Así se puede
// agregar OpenAI/Gemini sin tocar las herramientas de SIM ni la UI del chat.

export type Uso = { tokensIn: number; tokensOut: number };

export type LlamadaHerramienta = { id: string; nombre: string; input: Record<string, unknown> };

export type ResultadoHerramienta = { id: string; nombre: string; contenido: string; ok: boolean };

// Un turno del proveedor: o produce texto final, o pide ejecutar herramientas.
export type TurnoProveedor =
  | { tipo: "texto"; texto: string; uso: Uso }
  | { tipo: "herramientas"; texto?: string; llamadas: LlamadaHerramienta[]; uso: Uso };

// Historial neutral que el orquestador mantiene y pasa al proveedor.
export type HistorialTurno =
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto?: string; llamadas?: LlamadaHerramienta[] }
  | { rol: "tool"; resultados: ResultadoHerramienta[] };

export type HerramientaDef = { nombre: string; descripcion: string; schema: Record<string, unknown> };

export type GenerarParams = {
  modelo: string;
  system: string;
  historial: HistorialTurno[];
  herramientas: HerramientaDef[];
  maxTokensSalida: number;
  timeoutMs: number;
};

export interface IAProvider {
  nombre: string;
  generar(params: GenerarParams): Promise<TurnoProveedor>;
}

export class IAProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "IAProviderError";
  }
}

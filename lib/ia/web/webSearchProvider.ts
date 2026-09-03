// IA SIM · Bloque 4D.5 — Abstracción de proveedor de BÚSQUEDA WEB, independiente del
// proveedor de IA. Permite reemplazar Tavily por otro proveedor sin tocar el resto del
// sistema. Los resultados vienen NORMALIZADOS (nunca HTML crudo ni estructuras del proveedor).

export type ResultadoWebNormalizado = {
  titulo?: string;
  url: string;
  dominio?: string;
  fechaPublicada?: string | null;
  fragmento?: string;
  posicion: number;
};

export type BusquedaWebSalida = {
  ok: boolean;
  estado: "ok" | "vacio" | "error";
  resultados: ResultadoWebNormalizado[];
  consulta: string;
  proveedor: string;
  duracionMs: number;
  creditos: number; // uso/créditos consumidos según la regla VERSIONADA del proveedor
  errorCodigo?: string; // normalizado, sin secretos ni cuerpo crudo
};

export interface WebSearchProvider {
  nombre: string;
  buscar(params: { consulta: string; maxResultados: number; timeoutMs: number }): Promise<BusquedaWebSalida>;
}

export class WebSearchProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "WebSearchProviderError";
  }
}

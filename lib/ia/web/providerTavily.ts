// IA SIM · Bloque 4D.5 — Proveedor Tavily (https://docs.tavily.com/). Búsqueda básica, sin
// respuesta generativa, sin imágenes, sin contenido crudo ilimitado. La API key vive solo en
// el entorno server-side y NUNCA se loguea ni se serializa en errores.

import type { WebSearchProvider, BusquedaWebSalida, ResultadoWebNormalizado } from "@/lib/ia/web/webSearchProvider";
import { WebSearchProviderError } from "@/lib/ia/web/webSearchProvider";

const API_URL = "https://api.tavily.com/search";
// Regla de créditos VERSIONADA de nuestro lado (Tavily no expone saldo en la respuesta de
// búsqueda): 1 búsqueda básica = 1 crédito, según su documentación de precios/créditos.
// No es una consulta al saldo real de la cuenta; es la contabilidad interna auditable.
export const TAVILY_CREDITOS_VERSION = "2026-08";
export function creditosPorBusquedaBasica(): number { return 1; }

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type RespuestaTavily = {
  results?: Array<{ title?: string; url?: string; content?: string; published_date?: string | null }>;
};

export class TavilyWebSearchProvider implements WebSearchProvider {
  nombre = "tavily";
  constructor(private apiKey: string, private fetchImpl?: FetchLike) {}

  async buscar(params: { consulta: string; maxResultados: number; timeoutMs: number }): Promise<BusquedaWebSalida> {
    const doFetch = this.fetchImpl ?? (fetch as unknown as FetchLike);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), params.timeoutMs);
    const t0 = Date.now();
    let res: Response;
    try {
      res = await doFetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          query: params.consulta,
          search_depth: "basic",
          max_results: params.maxResultados,
          include_answer: false,
          include_images: false,
          include_raw_content: false,
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      const abortado = (e as Error)?.name === "AbortError";
      throw new WebSearchProviderError(abortado ? "La búsqueda web tardó demasiado (timeout)." : "No se pudo contactar al proveedor de búsqueda web.", abortado ? 504 : 502);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // Solo el status; nunca el cuerpo (podría reflejar la consulta o datos sensibles).
      throw new WebSearchProviderError(`El proveedor de búsqueda respondió con estado ${res.status}.`, res.status === 429 ? 429 : res.status === 401 ? 401 : 502);
    }
    const json = (await res.json()) as RespuestaTavily;
    const resultados: ResultadoWebNormalizado[] = (json.results ?? []).map((r, i) => ({
      titulo: r.title || undefined,
      url: String(r.url || ""),
      fechaPublicada: r.published_date || null,
      fragmento: r.content || undefined,
      posicion: i,
    })).filter((r) => r.url);
    return {
      ok: true,
      estado: resultados.length > 0 ? "ok" : "vacio",
      resultados,
      consulta: params.consulta,
      proveedor: this.nombre,
      duracionMs: Date.now() - t0,
      creditos: creditosPorBusquedaBasica(),
    };
  }
}

// IA SIM · Bloque 4D.5 — Proveedor de búsqueda web FALSO, determinístico, para tests. No llama
// a ninguna API externa. Registra las consultas recibidas (para verificar "una sola búsqueda").

import type { WebSearchProvider, BusquedaWebSalida, ResultadoWebNormalizado } from "@/lib/ia/web/webSearchProvider";
import { WebSearchProviderError } from "@/lib/ia/web/webSearchProvider";

export type GuionWeb =
  | { tipo: "ok"; resultados: ResultadoWebNormalizado[]; creditos?: number }
  | { tipo: "vacio" }
  | { tipo: "error"; mensaje: string; status?: number }
  | { tipo: "timeout" };

export class FakeWebSearchProvider implements WebSearchProvider {
  nombre = "tavily-fake";
  private i = 0;
  llamadas: string[] = []; // consultas recibidas, en orden (para probar "1 búsqueda como máximo")

  constructor(private guion: GuionWeb[]) {}

  async buscar(params: { consulta: string; maxResultados: number; timeoutMs: number }): Promise<BusquedaWebSalida> {
    this.llamadas.push(params.consulta);
    const paso = this.guion[this.i] ?? { tipo: "vacio" as const };
    this.i++;
    if (paso.tipo === "error") throw new WebSearchProviderError(paso.mensaje, paso.status ?? 502);
    if (paso.tipo === "timeout") { await new Promise((r) => setTimeout(r, Math.min(params.timeoutMs + 20, 200))); throw new WebSearchProviderError("La búsqueda web tardó demasiado (timeout).", 504); }
    if (paso.tipo === "vacio") return { ok: true, estado: "vacio", resultados: [], consulta: params.consulta, proveedor: this.nombre, duracionMs: 5, creditos: 1 };
    return { ok: true, estado: "ok", resultados: paso.resultados.slice(0, params.maxResultados), consulta: params.consulta, proveedor: this.nombre, duracionMs: 5, creditos: paso.creditos ?? 1 };
  }
}

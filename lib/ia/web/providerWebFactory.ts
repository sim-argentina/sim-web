// IA SIM · Bloque 4D.5 — Selección del proveedor de búsqueda web según configuración.
import type { WebSearchProvider } from "@/lib/ia/web/webSearchProvider";
import { TavilyWebSearchProvider } from "@/lib/ia/web/providerTavily";
import { getTavilyApiKey } from "@/lib/ia/web/config";

export function crearWebSearchProvider(): WebSearchProvider | null {
  const key = getTavilyApiKey();
  if (!key) return null;
  return new TavilyWebSearchProvider(key);
}

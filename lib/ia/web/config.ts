// IA SIM · Bloque 4D — Configuración de la búsqueda web (server-side).
// Centralizada y configurable por entorno; con valores iniciales seguros. La versión de
// la herramienta se elige compatible con los modelos reales (ver providerAnthropic).

function num(name: string, def: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// Máximo de búsquedas web por respuesta. Inicial 3, configurable, sin aumento silencioso.
export function getMaxBusquedasWeb(): number {
  return Math.max(1, Math.min(10, num("IA_WEB_MAX_BUSQUEDAS", 3)));
}

// Versión estable de la herramienta oficial `web_search` de Anthropic (Messages API).
// Configurable por si cambia; default a la versión GA documentada.
export function getWebToolVersion(): string {
  const v = (process.env.IA_WEB_TOOL_VERSION || "").trim();
  return v || "web_search_20250305";
}

// ¿La búsqueda web está habilitada globalmente? (interruptor de emergencia).
export function webHabilitadaGlobal(): boolean {
  return (process.env.IA_WEB_HABILITADA ?? "1") !== "0";
}

// ── Bloque 4D.5 — Proveedor de búsqueda web ──────────────────────────────────────────────
// Default TAVILY (económico, acotado, con caché). "anthropic" conserva el flujo nativo de 4D
// solo para auditoría histórica o activación MANUAL futura (nunca default, nunca fallback).
export type WebProveedor = "tavily" | "anthropic" | "off";
export function getWebProveedor(): WebProveedor {
  const v = (process.env.IA_WEB_PROVEEDOR || "tavily").trim().toLowerCase();
  if (v === "anthropic") return "anthropic";
  if (v === "off" || v === "none" || v === "ninguno") return "off";
  return "tavily";
}

export function getTavilyApiKey(): string | null {
  const k = process.env.TAVILY_API_KEY;
  return k && k.trim() ? k.trim() : null;
}
export function tavilyConfigurado(): boolean {
  return Boolean(getTavilyApiKey());
}

// Límites de la búsqueda Tavily por request (§5/§12). Timeout breve y propio (10-20s).
export const LIMITES_TAVILY = {
  maxResultados: 5,
  timeoutMs: Math.max(5000, Math.min(30000, num("IA_TAVILY_TIMEOUT_MS", 15000))),
};

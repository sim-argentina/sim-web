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

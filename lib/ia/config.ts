// IA SIM · Bloque 4A — Configuración server-side (NUNCA se expone al cliente).
// Los secretos (ANTHROPIC_API_KEY) se leen solo acá y jamás se loguean/serializan.

export type ModeloClase = "economico" | "potente";

export type IALimites = {
  mensajesPorMinuto: number;
  solicitudesDia: number;
  tokensEntradaMax: number; // por solicitud
  tokensSalidaMax: number; // por solicitud
  rondasHerramientasMax: number;
  herramientasPorRespuestaMax: number;
  tiempoEjecucionMsMax: number;
  // Presupuesto de tiempo del PROVEEDOR para consultas con búsqueda web (Bloque 4D.4). Debe ser
  // MENOR que el máximo de la ruta/Vercel para dejar margen a persistencia, validación y respuesta.
  webTimeoutMs: number;
  tokensMesMax: number; // presupuesto mensual (input+output)
};

function num(name: string, def: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function getLimites(): IALimites {
  return {
    mensajesPorMinuto: num("IA_MSG_POR_MINUTO", 6),
    solicitudesDia: num("IA_SOLICITUDES_DIA", 100),
    tokensEntradaMax: num("IA_TOKENS_ENTRADA_MAX", 60000),
    tokensSalidaMax: num("IA_TOKENS_SALIDA_MAX", 2000),
    rondasHerramientasMax: num("IA_RONDAS_MAX", 6),
    herramientasPorRespuestaMax: num("IA_HERRAMIENTAS_MAX", 8),
    tiempoEjecucionMsMax: num("IA_TIEMPO_MS_MAX", 60000),
    // 50s deja ~10s dentro del máximo de 60s de la función (plan Hobby) para persistir el
    // resultado (incluido el estado de timeout) y responder por HTTP sin que Vercel corte antes.
    webTimeoutMs: num("IA_WEB_TIMEOUT_MS", 50000),
    tokensMesMax: num("IA_TOKENS_MES_MAX", 5_000_000),
  };
}

// Identificadores de modelo CONFIGURABLES (no se hardcodean modelos obsoletos).
// Defaults a la familia vigente de Anthropic; se pueden sobreescribir por entorno.
export function getModelos(): Record<ModeloClase, string> {
  return {
    economico: process.env.IA_MODEL_ECONOMICO || "claude-haiku-4-5-20251001",
    potente: process.env.IA_MODEL_POTENTE || "claude-sonnet-5",
  };
}

export function getProveedor(): string {
  return (process.env.IA_PROVIDER || "anthropic").toLowerCase();
}

// ¿Está configurada la IA para uso REAL? (el proveedor 'fake' es solo para tests).
export function iaEstaConfigurada(): boolean {
  if (getProveedor() === "fake") return true;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Qué variables faltan (para el mensaje "IA SIM todavía no está configurada").
export function variablesFaltantes(): string[] {
  const faltan: string[] = [];
  if (getProveedor() === "anthropic" && !process.env.ANTHROPIC_API_KEY) faltan.push("ANTHROPIC_API_KEY");
  return faltan;
}

// Tabla de precios VERSIONADA (USD por millón de tokens). SOLO para estimar costo,
// no es facturación exacta de Anthropic. Se busca por prefijo del id de modelo.
export const PRECIOS_VERSION = "2026-08";
const PRECIOS: Array<{ prefijo: string; inUSD: number; outUSD: number }> = [
  { prefijo: "claude-haiku-4-5", inUSD: 1.0, outUSD: 5.0 },
  { prefijo: "claude-sonnet-5", inUSD: 3.0, outUSD: 15.0 },
  { prefijo: "claude-opus-5", inUSD: 15.0, outUSD: 75.0 },
  { prefijo: "claude-opus-4", inUSD: 15.0, outUSD: 75.0 },
];

export function estimarCostoUSD(modelo: string, tokensIn: number, tokensOut: number): number | null {
  const p = PRECIOS.find((x) => (modelo || "").startsWith(x.prefijo));
  if (!p) return null;
  return (tokensIn / 1_000_000) * p.inUSD + (tokensOut / 1_000_000) * p.outUSD;
}

// Identidad interna estable del administrador principal. La sesión actual solo
// distingue ROL (admin/staff), no persona; se usa un owner fijo para el admin.
// LIMITACIÓN documentada: para multi-administrador habrá que emitir identidad por persona.
export const IA_OWNER_ADMIN = "admin:ramiro";

// ── IA SIM · Bloque 4B.5 — Sincronización de costos OFICIALES (Cost Report) ──
// Credencial ADMINISTRATIVA distinta de ANTHROPIC_API_KEY. Formato oficial de
// Anthropic: Admin API key `sk-ant-admin01-...`. Se lee SOLO server-side; nunca
// se expone al cliente, nunca se guarda en Supabase, nunca se loguea.
export const IA_ADMIN_KEY_VAR = "ANTHROPIC_ADMIN_KEY";

export function getAdminKey(): string | null {
  const k = process.env[IA_ADMIN_KEY_VAR];
  return k && k.trim() ? k.trim() : null;
}
export function costoOficialConfigurado(): boolean {
  return Boolean(getAdminKey());
}

// Fecha de inicio del rango histórico para el Cost Report (configurable). El
// costo oficial acumulado se recalcula desde acá hasta hoy en cada sync.
export function getCostosDesdeISO(): string {
  const v = process.env.IA_COSTOS_DESDE;
  if (v && /^\d{4}-\d{2}-\d{2}/.test(v)) return `${v.slice(0, 10)}T00:00:00Z`;
  return "2025-01-01T00:00:00Z";
}

// Umbrales de alerta del saldo (USD) y de antigüedad de la sincronización (días).
export function getAlertasSaldo(): { bajo1: number; bajo2: number; syncStaleDias: number } {
  return {
    bajo1: num("IA_SALDO_ALERTA_1", 1),
    bajo2: num("IA_SALDO_ALERTA_2", 2),
    syncStaleDias: num("IA_SYNC_STALE_DIAS", 2),
  };
}

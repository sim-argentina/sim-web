// IA SIM · Bloque 4D.5 — Vigencia (TTL) de la caché de búsqueda web, por temática. Reutiliza la
// categoría ya detectada por `decidirWeb` (lib/ia/web/decision.ts), sin duplicar clasificación.

export const TTL_VERSION = "2026-08";

const SEG = { hora: 3600, dia: 86400 };

// Vigencia en SEGUNDOS según el motivo devuelto por decidirWeb (p.ej. "tema_externo:precios_externos").
export function ttlSegundosPorMotivo(motivo: string): number {
  const m = (motivo || "").toLowerCase();
  if (m.includes("competencia") || m.includes("mercado_local") || m.includes("oferta_externa")) return 7 * SEG.dia;
  if (m.includes("precios_externos")) return SEG.dia;
  if (m.includes("normativa")) return SEG.dia;
  if (m.includes("indicadores")) return 6 * SEG.hora;
  if (m.includes("noticias_tendencias")) return 2 * SEG.hora;
  // Explícito/comparación/información cambiante sin categoría específica → 1 día (conservador).
  return SEG.dia;
}

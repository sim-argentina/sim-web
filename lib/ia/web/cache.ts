// IA SIM · Bloque 4D.5 — Clave de caché de búsqueda web, PURA y determinística. La clave incluye
// consulta normalizada + proveedor + localización + parámetros relevantes + versión del
// normalizador (para poder invalidar toda la caché subiendo esta versión).

import { createHash } from "node:crypto";

// 4D.5.3 — auditado: NO es la causa del cache miss real de esta corrección (fue la limpieza de
// un fixture de test que reutilizaba el texto exacto de la consulta de producción; ver
// servidor4d52.integration.ts). Queda documentado como mejora pendiente, NO aplicada ahora: la
// puntuación final (. , ; : ! ¿¡) todavía puede generar una clave distinta para una consulta
// equivalente. No se corrige en esta pasada porque haría exactamente lo que se busca evitar —
// invalidar la entrada real y vigente de esta consulta (termina en un punto) y forzar un
// crédito Tavily más la próxima vez que se repita. Espacios/mayúsculas/acentos SÍ ya se
// normalizan correctamente (sin cambios acá, sin bump de versión).
export const NORMALIZADOR_VERSION = "1";

export function normalizarConsultaCache(consulta: string): string {
  return (consulta || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function claveCacheWeb(params: { consulta: string; proveedor: string; localizacion?: string; maxResultados: number }): string {
  const norm = normalizarConsultaCache(params.consulta);
  const base = JSON.stringify({ norm, proveedor: params.proveedor, loc: params.localizacion ?? "", max: params.maxResultados, v: NORMALIZADOR_VERSION });
  return createHash("sha256").update(base).digest("hex");
}

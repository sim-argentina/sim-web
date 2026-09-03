// IA SIM · Bloque 4D.5 — Clave de caché de búsqueda web, PURA y determinística. La clave incluye
// consulta normalizada + proveedor + localización + parámetros relevantes + versión del
// normalizador (para poder invalidar toda la caché subiendo esta versión).

import { createHash } from "node:crypto";

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

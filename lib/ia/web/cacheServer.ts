// IA SIM · Bloque 4D.5 — Caché PERSISTENTE de búsqueda web (Supabase, tabla ia_web_cache).
// Evita pagar de nuevo la misma búsqueda dentro de la vigencia. Escritura idempotente por
// clave (una sola fila por clave_hash; una carrera concurrente no duplica).

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ResultadoWebNormalizado } from "@/lib/ia/web/webSearchProvider";

export type CacheHit = { hit: true; resultados: ResultadoWebNormalizado[]; creditos: number; fecha: string };
export type CacheMiss = { hit: false };

export async function buscarEnCacheWeb(claveHash: string): Promise<CacheHit | CacheMiss> {
  const { data } = await supabaseAdmin.from("ia_web_cache").select("resultados, creditos, created_at, vence_at, estado").eq("clave_hash", claveHash).maybeSingle();
  if (!data) return { hit: false };
  if (data.estado !== "ok") return { hit: false };
  if (new Date(data.vence_at as string).getTime() <= Date.now()) return { hit: false };
  return { hit: true, resultados: (data.resultados as ResultadoWebNormalizado[]) ?? [], creditos: Number(data.creditos ?? 0), fecha: data.created_at as string };
}

export async function guardarEnCacheWeb(input: {
  claveHash: string; consultaSaneada: string; proveedor: string; resultados: ResultadoWebNormalizado[]; creditos: number; vigenciaSeg: number; estado: "ok" | "vacio" | "error";
}): Promise<void> {
  const venceAt = new Date(Date.now() + input.vigenciaSeg * 1000).toISOString();
  const hashContenido = createHash("sha256").update(JSON.stringify(input.resultados)).digest("hex").slice(0, 16);
  // Upsert idempotente: una carrera concurrente sobre la MISMA clave no duplica fila (constraint
  // única en clave_hash); ignoreDuplicates evita sobreescribir si otra request ya la guardó.
  await supabaseAdmin.from("ia_web_cache").upsert({
    clave_hash: input.claveHash, consulta_saneada: input.consultaSaneada, proveedor: input.proveedor,
    resultados: input.resultados, n_resultados: input.resultados.length, creditos: input.creditos,
    hash_contenido: hashContenido, estado: input.estado, vence_at: venceAt,
  }, { onConflict: "clave_hash", ignoreDuplicates: true });
}

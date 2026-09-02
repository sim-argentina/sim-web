import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { FormatoArchivo } from "@/lib/ia/informes/limites";

// IA SIM · Bloque 4C — Storage PRIVADO de archivos generados (bucket separado
// `ia-sim-informes`). El nombre FÍSICO lo genera el servidor (UUID, sin PII); nunca
// se confía en rutas del cliente. Descarga solo por URL firmada corta.

export const BUCKET_INFORMES = "ia-sim-informes";

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

// Ruta física server-side. Sin PII: informes/<conversacionId>/<informeId>/v<version>/<uuid>.<ext>
export function rutaArchivo(conversacionId: string, informeId: string, version: number, formato: FormatoArchivo): string {
  return `informes/${conversacionId}/${informeId}/v${version}/${randomUUID()}.${formato}`;
}

export async function subirArchivo(path: string, buf: Uint8Array, contentType: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.storage.from(BUCKET_INFORMES).upload(path, buf, { contentType, upsert: false });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function urlFirmadaArchivo(path: string, nombreDescarga: string, segundos = 60): Promise<string | null> {
  const { data } = await supabaseAdmin.storage.from(BUCKET_INFORMES).createSignedUrl(path, segundos, { download: nombreDescarga });
  return data?.signedUrl ?? null;
}

export async function descargarArchivo(path: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET_INFORMES).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function borrarArchivos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  // Borrar en lotes para no exceder límites.
  for (let i = 0; i < paths.length; i += 100) {
    await supabaseAdmin.storage.from(BUCKET_INFORMES).remove(paths.slice(i, i + 100));
  }
}

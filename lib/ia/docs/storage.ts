import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// IA SIM · Bloque 4B — Storage PRIVADO. El nombre físico lo genera el servidor;
// nunca se confía en el nombre original como ruta. Acceso solo server-side; para
// mostrar el original se emite una URL firmada de vida corta.

export const BUCKET = "ia-sim-docs";

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function extSegura(nombre: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec((nombre || "").toLowerCase());
  return m ? `.${m[1]}` : "";
}

export function rutaAdjunto(conversacionId: string, nombreOriginal: string): string {
  return `adjuntos/${conversacionId}/${randomUUID()}${extSegura(nombreOriginal)}`;
}
export function rutaDocumento(documentoId: string, nombreOriginal: string): string {
  return `documentos/${documentoId}/${randomUUID()}${extSegura(nombreOriginal)}`;
}

export async function subir(path: string, buf: Uint8Array, contentType: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType, upsert: false });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function urlFirmada(path: string, segundos = 60): Promise<string | null> {
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, segundos);
  return data?.signedUrl ?? null;
}

export async function descargar(path: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function borrar(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabaseAdmin.storage.from(BUCKET).remove(paths);
}

// Copia un objeto a una ruta nueva (para que el conocimiento sea independiente del adjunto).
export async function copiar(origen: string, destino: string, contentType: string): Promise<{ ok: boolean; error?: string }> {
  const buf = await descargar(origen);
  if (!buf) return { ok: false, error: "no_se_pudo_descargar" };
  return subir(destino, buf, contentType);
}

import { randomBytes } from "crypto";

// Helpers de validación / sanitización server-side.

// Sanitiza un término de búsqueda para usarlo dentro de filtros PostgREST
// (.or / .ilike). Evita inyección de operadores y limita longitud.
export function sanitizeSearchTerm(q: string | null | undefined, maxLen = 40): string {
  return String(q ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} @._-]/gu, "")
    .trim()
    .slice(0, maxLen);
}

// Devuelve solo los campos permitidos de un objeto (anti mass-assignment).
export function pickFields<T extends Record<string, unknown>>(
  body: unknown,
  fields: readonly (keyof T)[]
): Partial<T> {
  const out: Partial<T> = {};
  if (!body || typeof body !== "object") return out;
  const obj = body as Record<string, unknown>;
  for (const f of fields) {
    const k = f as string;
    if (k in obj && obj[k] !== undefined) out[f] = obj[k] as T[keyof T];
  }
  return out;
}

export function cleanString(v: unknown, maxLen = 200): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

export function isValidDateStr(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + "T00:00:00").getTime());
}

// ── Validación de imágenes (por magic bytes, no por file.type) ──────────────
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

function detectImageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (
    b.length > 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
    return "image/webp";
  return null;
}

export type ImageValidationOk = {
  ok: true;
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
};
export type ImageValidationFail = { ok: false; error: string; status: number };

// Valida tamaño + tipo real. Rechaza svg/html/js y cualquier no-imagen.
// El nombre y el contentType se derivan server-side, nunca del cliente.
export async function validateImageUpload(
  file: File | null
): Promise<ImageValidationOk | ImageValidationFail> {
  if (!file) return { ok: false, error: "No se recibió archivo", status: 400 };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "El archivo supera el máximo de 5MB", status: 413 };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectImageType(buffer);
  if (!type) {
    return { ok: false, error: "Solo se permiten imágenes JPG, PNG o WEBP", status: 415 };
  }
  const ext = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
  return { ok: true, buffer, contentType: type, ext };
}

export function safeUploadName(ext: string): string {
  return `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
}

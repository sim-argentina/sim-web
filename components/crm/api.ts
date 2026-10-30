// Cliente HTTP de las pantallas del CRM. Distingue un error conocido (el servidor
// respondió y dijo por qué) de un resultado INCIERTO (sin respuesta o 5xx): en ese
// caso no se sabe si la escritura llegó y la pantalla tiene que reintentar con la
// misma clave, nunca crear otra.

import type { CandidatoDuplicado } from "@/lib/crmB1";

export type Respuesta<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; codigo?: string; campo?: string; candidatos?: CandidatoDuplicado[]; incierto: boolean };

export async function pedir<T>(url: string, init?: RequestInit): Promise<Respuesta<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, status: 0, error: "No hay conexión con el servidor.", incierto: true };
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; codigo?: string; campo?: string; candidatos?: CandidatoDuplicado[] }) | null;
  if (res.ok) return { ok: true, status: res.status, data: data as T };
  return {
    ok: false, status: res.status, error: data?.error ?? "No se pudo completar la acción.", codigo: data?.codigo, campo: data?.campo,
    candidatos: data?.candidatos, incierto: res.status >= 500,
  };
}

export const enviar = <T,>(url: string, metodo: "POST" | "PATCH", cuerpo: unknown) => pedir<T>(url, { method: metodo, body: JSON.stringify(cuerpo) });

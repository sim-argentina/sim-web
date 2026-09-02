// IA SIM · Bloque 4D — Fuentes externas: normalización de URL/dominio y separación
// interna vs externa. Solo se aceptan http(s). Nunca se muestran tokens del proveedor.

export type FuenteWeb = {
  url: string;
  titulo?: string;
  dominio?: string;
  fragmento?: string; // cited_text acotado (no la página entera)
  fecha_pagina?: string; // page_age / antigüedad cuando exista
  claim?: string; // tramo de respuesta respaldado, si la API lo provee
  orden: number;
};

// Valida y normaliza una URL externa. Devuelve null si no es http(s) seguro.
export function normalizarUrl(url: unknown): string | null {
  const u = (typeof url === "string" ? url : "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function dominioDe(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

// Recorta un fragmento citado a un largo razonable (no se guardan páginas completas).
export function recortarFragmento(texto: unknown, max = 300): string | undefined {
  const s = (typeof texto === "string" ? texto : "").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Deduplica fuentes por URL, conservando el primer orden de aparición.
export function dedupFuentesWeb(fuentes: FuenteWeb[]): FuenteWeb[] {
  const vistas = new Set<string>();
  const out: FuenteWeb[] = [];
  for (const f of fuentes) {
    const key = f.url.replace(/#.*$/, "");
    if (vistas.has(key)) continue;
    vistas.add(key);
    out.push(f);
  }
  return out;
}

// Una fuente es EXTERNA (internet) si tiene URL http(s); si no, es INTERNA (herramientas SIM).
export function esFuenteExterna(f: { url?: unknown }): boolean {
  return typeof f.url === "string" && /^https?:\/\//i.test(f.url);
}

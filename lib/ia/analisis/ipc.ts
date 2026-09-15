// IA SIM · Bloque 4E — Serie IPC oficial: lectura y carga auditable. Nunca se hardcodea un
// índice en el código ni se consulta a internet en cada respuesta; el admin la carga/actualiza
// por un endpoint dedicado (admin-only) y queda auditado (fuente, URL, fecha, quién la cargó).

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sanitizeUrl } from "@/lib/ia/markdown";

export type PuntoIpcDB = { periodo: string; indice: number; fuente: string; url: string | null; fecha_publicacion: string | null; fecha_consulta: string; version: string };

export async function leerSerieIpc(periodos: string[]): Promise<Map<string, number>> {
  const unicos = [...new Set(periodos)];
  if (unicos.length === 0) return new Map();
  const { data } = await supabaseAdmin.from("ia_ipc_indice").select("periodo, indice").in("periodo", unicos);
  return new Map((data ?? []).map((r) => [r.periodo as string, Number(r.indice)]));
}

export async function listarSerieIpc(): Promise<PuntoIpcDB[]> {
  const { data } = await supabaseAdmin.from("ia_ipc_indice").select("periodo, indice, fuente, url, fecha_publicacion, fecha_consulta, version").order("periodo", { ascending: true });
  return (data ?? []) as PuntoIpcDB[];
}

export type CargaIpcEntrada = { periodo: string; indice: number; fuente?: string; url?: string; fecha_publicacion?: string };

export function validarEntradaIpc(e: unknown): { ok: true; entrada: CargaIpcEntrada } | { ok: false; motivo: string } {
  if (!e || typeof e !== "object") return { ok: false, motivo: "Entrada inválida." };
  const o = e as Record<string, unknown>;
  const periodo = typeof o.periodo === "string" ? o.periodo.trim() : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return { ok: false, motivo: `Período inválido: "${periodo}" (formato esperado YYYY-MM).` };
  const indice = Number(o.indice);
  if (!Number.isFinite(indice) || indice <= 0) return { ok: false, motivo: `Índice inválido para ${periodo}.` };
  const fuente = typeof o.fuente === "string" && o.fuente.trim() ? o.fuente.trim().slice(0, 120) : "INDEC";
  const urlCruda = typeof o.url === "string" ? o.url.trim() : "";
  const url = urlCruda ? sanitizeUrl(urlCruda) ?? undefined : undefined;
  if (urlCruda && !url) return { ok: false, motivo: `URL inválida para ${periodo} (solo http/https).` };
  const fecha_publicacion = typeof o.fecha_publicacion === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.fecha_publicacion) ? o.fecha_publicacion : undefined;
  return { ok: true, entrada: { periodo, indice, fuente, url, fecha_publicacion } };
}

export async function cargarPuntoIpc(entrada: CargaIpcEntrada, owner: string): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { error } = await supabaseAdmin.from("ia_ipc_indice").upsert(
    { periodo: entrada.periodo, indice: entrada.indice, fuente: entrada.fuente ?? "INDEC", url: entrada.url ?? null, fecha_publicacion: entrada.fecha_publicacion ?? null, fecha_consulta: new Date().toISOString(), cargado_por: owner, updated_at: new Date().toISOString() },
    { onConflict: "periodo" }
  );
  if (error) return { ok: false, motivo: "No se pudo guardar el índice." };
  return { ok: true };
}

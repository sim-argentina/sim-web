// IA SIM · Bloque 4C — Nombres de archivo. El nombre FÍSICO (Storage) lo genera el
// servidor con UUID (ver storage). El nombre de DESCARGA es determinístico y SIN PII:
// deriva de tipo + período + versión + formato, nunca de texto libre con nombres.

import type { FormatoArchivo } from "@/lib/ia/informes/limites";

// Slug ASCII seguro: minúsculas, guiones bajos, sin acentos ni caracteres raros.
export function slugSeguro(s: string, max = 40): string {
  return (s || "")
    .normalize("NFD").replace(new RegExp("[\u0300-\u036f]","g"), "") // saca acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max) || "informe";
}

// Nombre de descarga: informe_<tipo>_<periodo>_v<version>.<ext>. Sin PII.
export function nombreDescarga(opts: { tipoInforme: string; periodo?: string | null; version: number; formato: FormatoArchivo }): string {
  const tipo = slugSeguro(opts.tipoInforme, 30);
  const periodo = opts.periodo ? "_" + slugSeguro(opts.periodo, 20) : "";
  return `informe_${tipo}${periodo}_v${opts.version}.${opts.formato}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Nombre de descarga AMIGABLE: informe-metricas-<sujeto>-<mes>-<anio>-v<version>.<ext>
// Determinístico, breve, sin enums técnicos, sin IDs, sin repetir fechas, sin PII sensible.
export function nombreDescargaAmigable(opts: { tipoInforme: string; sujeto?: string | null; periodo?: string | null; version: number; formato: FormatoArchivo }): string {
  const partes = ["informe"];
  if (opts.sujeto) partes.push("metricas", slugSeguro(opts.sujeto, 24));
  else partes.push(slugSeguro(opts.tipoInforme.replace(/_/g, "-"), 30));
  const m = /(\d{4})-(\d{2})/.exec(opts.periodo ?? "");
  if (m) partes.push(MESES[Number(m[2]) - 1] ?? m[2], m[1]);
  partes.push(`v${opts.version}`);
  return `${partes.join("-")}.${opts.formato}`;
}

const MIME: Record<FormatoArchivo, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  png: "image/png",
};
export function mimeDe(formato: FormatoArchivo): string { return MIME[formato]; }

// IA SIM · Bloque 4B — Detección de tipo real y SEGURIDAD de carga.
// Se decide por magic bytes + extensión, NUNCA por el nombre/MIME que envía el cliente.
// Rechaza ejecutables, scripts, instaladores y archivos comprimidos inseguros.

export type Formato =
  | "pdf" | "docx" | "xlsx" | "pptx" | "csv" | "tsv" | "txt" | "md"
  | "json" | "xml" | "rtf" | "imagen" | "legacy_office" | "desconocido" | "rechazado";

export type Deteccion = {
  seguro: boolean;
  formato: Formato;
  mime: string;
  extension: string;
  motivo?: string; // por qué se rechazó (si seguro=false)
};

function ext(nombre: string): string {
  const m = /\.([a-z0-9]+)$/i.exec((nombre || "").toLowerCase());
  return m ? m[1] : "";
}
function empieza(buf: Uint8Array, sig: number[], offset = 0): boolean {
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false;
  return true;
}
const asciiAt = (buf: Uint8Array, off: number, s: string) => {
  for (let i = 0; i < s.length; i++) if (buf[off + i] !== s.charCodeAt(i)) return false;
  return true;
};

const IMAGEN_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp"]);
const MIME: Record<Formato, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", tsv: "text/tab-separated-values", txt: "text/plain", md: "text/markdown",
  json: "application/json", xml: "application/xml", rtf: "application/rtf",
  imagen: "image/*", legacy_office: "application/x-ole-storage", desconocido: "application/octet-stream", rechazado: "application/octet-stream",
};

export function detectar(buf: Uint8Array, nombre: string): Deteccion {
  const e = ext(nombre);
  const rechazo = (motivo: string): Deteccion => ({ seguro: false, formato: "rechazado", mime: "application/octet-stream", extension: e, motivo });

  // ── Ejecutables / binarios peligrosos → RECHAZO ─────────────────────────────
  if (empieza(buf, [0x4d, 0x5a])) return rechazo("Ejecutable de Windows (MZ/PE) no permitido.");
  if (empieza(buf, [0x7f, 0x45, 0x4c, 0x46])) return rechazo("Ejecutable ELF no permitido.");
  if (empieza(buf, [0xfe, 0xed, 0xfa, 0xce]) || empieza(buf, [0xcf, 0xfa, 0xed, 0xfe])) return rechazo("Binario Mach-O no permitido.");
  if (empieza(buf, [0x23, 0x21])) return rechazo("Script con shebang (#!) no permitido.");
  if (empieza(buf, [0xca, 0xfe, 0xba, 0xbe])) return rechazo("Bytecode/JAR no permitido.");
  // Extensiones ejecutables/instaladores/scripts.
  if (["exe", "dll", "msi", "bat", "cmd", "com", "scr", "ps1", "sh", "js", "mjs", "vbs", "jar", "app", "apk", "deb", "rpm", "bin"].includes(e)) return rechazo("Tipo de archivo ejecutable/instalador no permitido.");

  // ── Archivos comprimidos INSEGUROS (riesgo de bomba) → RECHAZO ───────────────
  if (empieza(buf, [0x52, 0x61, 0x72, 0x21])) return rechazo("Archivo RAR no permitido.");
  if (empieza(buf, [0x37, 0x7a, 0xbc, 0xaf])) return rechazo("Archivo 7z no permitido.");
  if (empieza(buf, [0x1f, 0x8b])) return rechazo("Archivo GZIP no permitido.");
  if (asciiAt(buf, 257, "ustar")) return rechazo("Archivo TAR no permitido.");

  // ── PDF ──────────────────────────────────────────────────────────────────────
  if (empieza(buf, [0x25, 0x50, 0x44, 0x46])) return { seguro: true, formato: "pdf", mime: MIME.pdf, extension: e };

  // ── ZIP (OOXML: docx/xlsx/pptx). Un .zip genérico se rechaza. ────────────────
  if (empieza(buf, [0x50, 0x4b, 0x03, 0x04]) || empieza(buf, [0x50, 0x4b, 0x05, 0x06])) {
    if (e === "docx") return { seguro: true, formato: "docx", mime: MIME.docx, extension: e };
    if (e === "xlsx") return { seguro: true, formato: "xlsx", mime: MIME.xlsx, extension: e };
    if (e === "pptx") return { seguro: true, formato: "pptx", mime: MIME.pptx, extension: e };
    return rechazo("Archivo ZIP genérico no permitido (solo se aceptan documentos Office).");
  }

  // ── OLE (Office legacy / cifrado). .xls lo lee SheetJS; .doc/.ppt no. ─────────
  if (empieza(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (e === "xls") return { seguro: true, formato: "xlsx", mime: "application/vnd.ms-excel", extension: e };
    return { seguro: true, formato: "legacy_office", mime: MIME.legacy_office, extension: e };
  }

  // ── RTF ──────────────────────────────────────────────────────────────────────
  if (asciiAt(buf, 0, "{\\rtf")) return { seguro: true, formato: "rtf", mime: MIME.rtf, extension: e };

  // ── Imágenes ──────────────────────────────────────────────────────────────────
  if (empieza(buf, [0xff, 0xd8, 0xff])) return { seguro: true, formato: "imagen", mime: "image/jpeg", extension: e };
  if (empieza(buf, [0x89, 0x50, 0x4e, 0x47])) return { seguro: true, formato: "imagen", mime: "image/png", extension: e };
  if (empieza(buf, [0x47, 0x49, 0x46, 0x38])) return { seguro: true, formato: "imagen", mime: "image/gif", extension: e };
  if (empieza(buf, [0x42, 0x4d])) return { seguro: true, formato: "imagen", mime: "image/bmp", extension: e };
  if (empieza(buf, [0x52, 0x49, 0x46, 0x46]) && asciiAt(buf, 8, "WEBP")) return { seguro: true, formato: "imagen", mime: "image/webp", extension: e };

  // ── Texto / estructurado (por extensión + contenido imprimible) ──────────────
  const esTextoPlano = pareceTexto(buf);
  if (e === "csv") return { seguro: true, formato: "csv", mime: MIME.csv, extension: e };
  if (e === "tsv") return { seguro: true, formato: "tsv", mime: MIME.tsv, extension: e };
  if (e === "md" || e === "markdown") return { seguro: true, formato: "md", mime: MIME.md, extension: e };
  if (e === "json") return { seguro: true, formato: "json", mime: MIME.json, extension: e };
  if (e === "xml") return { seguro: true, formato: "xml", mime: MIME.xml, extension: e };
  if (e === "txt" || (esTextoPlano && (e === "" || IMAGEN_EXT.has(e) === false))) {
    // Texto imprimible sin firma binaria conocida.
    if (esTextoPlano) return { seguro: true, formato: e === "txt" ? "txt" : "txt", mime: MIME.txt, extension: e };
  }

  // ── Seguro pero sin extractor (se puede almacenar; contenido manual). ────────
  return { seguro: true, formato: "desconocido", mime: MIME.desconocido, extension: e };
}

// Heurística: ¿los primeros bytes parecen texto imprimible (UTF-8) y no binario?
function pareceTexto(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 4096);
  if (n === 0) return false;
  let sospechosos = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false; // NUL → binario
    if (b < 9 || (b > 13 && b < 32)) sospechosos++;
  }
  return sospechosos / n < 0.05;
}

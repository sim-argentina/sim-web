import { leerEntradasZip, xmlATexto } from "@/lib/ia/docs/zip";
import type { Deteccion, Formato } from "@/lib/ia/docs/deteccion";

// IA SIM · Bloque 4B — Extractores tipados por formato. Extracción LOCAL y
// determinística cuando es posible; nunca se ejecuta contenido (macros, JS de PDF,
// fórmulas externas, enlaces). Los formatos sin extractor se marcan para carga manual.

export type Fragmento = { ordinal: number; ubicacion: string; texto: string };
export type EstadoExtraccion = "listo" | "necesita_correccion" | "sin_extractor" | "error";
export type ResultadoExtraccion = {
  metodo: string;
  estado: EstadoExtraccion;
  contenido: string;
  fragmentos: Fragmento[];
  paginas?: number; hojas?: number; diapositivas?: number; filas?: number;
  advertencias: string[];
  error?: string;
};

export type LimitesExtraccion = {
  maxPaginas: number; maxHojas: number; maxFilas: number; maxDiapositivas: number; maxCaracteres: number;
};
export const LIMITES_DEFAULT: LimitesExtraccion = { maxPaginas: 200, maxHojas: 50, maxFilas: 20000, maxDiapositivas: 300, maxCaracteres: 400000 };

function texto(buf: Uint8Array): string { return Buffer.from(buf).toString("utf8"); }

// Corta texto largo en fragmentos con procedencia, sin partir palabras bruscamente.
function chunk(str: string, ubicacionBase: string, maxChars = 1500): Fragmento[] {
  const limpio = str.replace(/\r\n/g, "\n").trim();
  if (!limpio) return [];
  const out: Fragmento[] = [];
  const parrafos = limpio.split(/\n{2,}/);
  let acc = ""; let n = 1;
  const push = () => { if (acc.trim()) { out.push({ ordinal: n, ubicacion: `${ubicacionBase}${out.length > 0 || acc.length < limpio.length ? ` (bloque ${n})` : ""}`, texto: acc.trim() }); n++; acc = ""; } };
  for (const p of parrafos) {
    if ((acc + "\n\n" + p).length > maxChars && acc) push();
    acc += (acc ? "\n\n" : "") + p;
    if (acc.length > maxChars) push();
  }
  push();
  return out;
}

// ── PDF (capa de texto; reutiliza la LIBRERÍA pdfjs, no el parser del cronograma) ─
type PdfPage = { getTextContent: () => Promise<{ items: Array<{ str?: unknown }> }>; };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfjsLike = { getDocument: (o: Record<string, unknown>) => { promise: Promise<PdfDoc> } };

async function extraerPdf(buf: Uint8Array, lim: LimitesExtraccion): Promise<ResultadoExtraccion> {
  const advertencias: string[] = [];
  let doc: PdfDoc | null = null;
  try {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false }).promise;
    const paginas = doc.numPages;
    const usar = Math.min(paginas, lim.maxPaginas);
    if (paginas > lim.maxPaginas) advertencias.push(`El PDF tiene ${paginas} páginas; se procesaron las primeras ${usar}.`);
    const fragmentos: Fragmento[] = [];
    let total = "";
    for (let p = 1; p <= usar; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const t = tc.items.map((i) => (typeof i.str === "string" ? i.str : "")).join(" ").replace(/\s+/g, " ").trim();
      if (t) { fragmentos.push({ ordinal: p, ubicacion: `Página ${p}`, texto: t }); total += (total ? "\n\n" : "") + t; }
      if (total.length > lim.maxCaracteres) { advertencias.push("Se alcanzó el límite de caracteres extraídos."); break; }
    }
    if (!total.trim()) {
      return { metodo: "texto_pdf", estado: "sin_extractor", contenido: "", fragmentos: [], paginas, advertencias: ["El PDF no tiene capa de texto (parece escaneado). Requiere OCR/visión o carga manual del contenido."] };
    }
    return { metodo: "texto_pdf", estado: "listo", contenido: total, fragmentos, paginas, advertencias };
  } catch (e) {
    return { metodo: "texto_pdf", estado: "error", contenido: "", fragmentos: [], advertencias: [], error: `pdf: ${(e as Error).message}` };
  } finally { try { await doc?.destroy(); } catch { /* noop */ } }
}

// ── Hojas de cálculo (xlsx/xls/csv/tsv) vía SheetJS ───────────────────────────
async function extraerHojas(buf: Uint8Array, formato: Formato, lim: LimitesExtraccion): Promise<ResultadoExtraccion> {
  const advertencias: string[] = [];
  try {
    const XLSX = (await import("xlsx")) as typeof import("xlsx");
    const wb = XLSX.read(buf, { type: "array", cellFormula: false, cellHTML: false });
    const nombres = wb.SheetNames.slice(0, lim.maxHojas);
    if (wb.SheetNames.length > lim.maxHojas) advertencias.push(`El archivo tiene ${wb.SheetNames.length} hojas; se procesaron ${nombres.length}.`);
    const fragmentos: Fragmento[] = []; let total = ""; let filas = 0; let ord = 1;
    for (const nombre of nombres) {
      const ws = wb.Sheets[nombre];
      const filasArr = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
      const usar = filasArr.slice(0, lim.maxFilas);
      filas += usar.length;
      const csv = usar.map((r) => r.map((c) => (c == null ? "" : String(c))).join(" | ")).join("\n");
      const encabezado = `Hoja: ${nombre}`;
      for (const f of chunk(`${encabezado}\n${csv}`, `Hoja ${nombre}`, 2000)) { fragmentos.push({ ...f, ordinal: ord++ }); }
      total += (total ? "\n\n" : "") + `${encabezado}\n${csv}`;
      if (total.length > lim.maxCaracteres) { advertencias.push("Se alcanzó el límite de caracteres extraídos."); break; }
    }
    return { metodo: formato === "csv" ? "csv" : formato === "tsv" ? "csv" : "xlsx", estado: "listo", contenido: total.slice(0, lim.maxCaracteres), fragmentos, hojas: nombres.length, filas, advertencias };
  } catch (e) {
    return { metodo: "xlsx", estado: "error", contenido: "", fragmentos: [], advertencias: [], error: `xlsx: ${(e as Error).message}` };
  }
}

// ── DOCX (word/document.xml) ──────────────────────────────────────────────────
function extraerDocx(buf: Uint8Array, lim: LimitesExtraccion): ResultadoExtraccion {
  try {
    const ent = leerEntradasZip(buf, (n) => n === "word/document.xml");
    if (ent.length === 0) return { metodo: "docx", estado: "sin_extractor", contenido: "", fragmentos: [], advertencias: ["No se encontró el documento Word; se puede cargar el contenido manualmente."] };
    const t = xmlATexto(ent[0].datos.toString("utf8"), ["w:p", "w:br", "w:tab"]).slice(0, lim.maxCaracteres);
    const fragmentos = chunk(t, "Sección");
    return { metodo: "docx", estado: t.trim() ? "listo" : "necesita_correccion", contenido: t, fragmentos, advertencias: t.trim() ? [] : ["El documento no arrojó texto legible."] };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "bomba_descompresion") return { metodo: "docx", estado: "error", contenido: "", fragmentos: [], advertencias: [], error: "docx: descompresión insegura" };
    return { metodo: "docx", estado: "error", contenido: "", fragmentos: [], advertencias: [], error: `docx: ${msg}` };
  }
}

// ── PPTX (ppt/slides/slideN.xml) ──────────────────────────────────────────────
function extraerPptx(buf: Uint8Array, lim: LimitesExtraccion): ResultadoExtraccion {
  try {
    const ent = leerEntradasZip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    ent.sort((a, b) => Number(/slide(\d+)\.xml/.exec(a.nombre)![1]) - Number(/slide(\d+)\.xml/.exec(b.nombre)![1]));
    const usar = ent.slice(0, lim.maxDiapositivas);
    const fragmentos: Fragmento[] = []; let total = "";
    usar.forEach((e, i) => {
      const t = xmlATexto(e.datos.toString("utf8"), ["a:p", "a:br"]);
      if (t.trim()) { fragmentos.push({ ordinal: i + 1, ubicacion: `Diapositiva ${i + 1}`, texto: t.slice(0, 4000) }); total += (total ? "\n\n" : "") + `[Diapositiva ${i + 1}] ${t}`; }
    });
    const adv: string[] = [];
    if (ent.length > usar.length) adv.push(`La presentación tiene ${ent.length} diapositivas; se procesaron ${usar.length}.`);
    adv.push("No se interpretaron imágenes de las diapositivas.");
    return { metodo: "pptx", estado: total.trim() ? "listo" : "necesita_correccion", contenido: total.slice(0, lim.maxCaracteres), fragmentos, diapositivas: ent.length, advertencias: adv };
  } catch (e) {
    return { metodo: "pptx", estado: "error", contenido: "", fragmentos: [], advertencias: [], error: `pptx: ${(e as Error).message}` };
  }
}

function extraerRtf(buf: Uint8Array): ResultadoExtraccion {
  let s = texto(buf);
  s = s.replace(/\\'[0-9a-fA-F]{2}/g, " ").replace(/\\[a-zA-Z]+-?\d* ?/g, "").replace(/[{}]/g, "").replace(/\\\n/g, "\n");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { metodo: "rtf", estado: s ? "listo" : "necesita_correccion", contenido: s, fragmentos: chunk(s, "Bloque"), advertencias: ["Extracción de RTF básica (texto plano)."] };
}

function extraerTextoPlano(buf: Uint8Array, formato: Formato, lim: LimitesExtraccion): ResultadoExtraccion {
  const s = texto(buf).slice(0, lim.maxCaracteres);
  if (formato === "json") {
    try { JSON.parse(s); } catch { return { metodo: "json", estado: "necesita_correccion", contenido: s, fragmentos: chunk(s, "Bloque"), advertencias: ["El JSON no es válido; revisá el contenido."] }; }
  }
  const metodo = formato === "md" ? "texto_plano" : formato === "json" ? "json" : formato === "xml" ? "xml" : "texto_plano";
  return { metodo, estado: s.trim() ? "listo" : "necesita_correccion", contenido: s, fragmentos: chunk(s, "Bloque"), advertencias: [] };
}

// ── Interfaz de extractor + orquestador ───────────────────────────────────────
export async function extraer(buf: Uint8Array, det: Deteccion, lim: LimitesExtraccion = LIMITES_DEFAULT): Promise<ResultadoExtraccion> {
  switch (det.formato) {
    case "pdf": return extraerPdf(buf, lim);
    case "xlsx": case "csv": case "tsv": return extraerHojas(buf, det.formato, lim);
    case "docx": return extraerDocx(buf, lim);
    case "pptx": return extraerPptx(buf, lim);
    case "rtf": return extraerRtf(buf);
    case "txt": case "md": case "json": case "xml": return extraerTextoPlano(buf, det.formato, lim);
    case "imagen":
      return { metodo: "ocr_vision", estado: "sin_extractor", contenido: "", fragmentos: [], advertencias: ["Imagen almacenada. El texto no se extrajo automáticamente: se puede usar OCR/visión (con consumo) o cargar el contenido manualmente."] };
    case "legacy_office":
      return { metodo: "sin_extractor", estado: "sin_extractor", contenido: "", fragmentos: [], advertencias: ["Formato Office antiguo (.doc/.ppt) o archivo cifrado: se almacenó, pero su contenido no pudo extraerse. Cargá el contenido manualmente."] };
    default:
      return { metodo: "sin_extractor", estado: "sin_extractor", contenido: "", fragmentos: [], advertencias: ["Este archivo fue almacenado, pero su contenido no pudo extraerse. Cargá el contenido representativo manualmente."] };
  }
}

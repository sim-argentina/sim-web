import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { parseCronogramaPdf, type ParseResult, type TextItem } from "@/lib/cronogramaPdf";

// Extracción de texto POSICIONADO con pdfjs (server-only, runtime Node.js) y
// validaciones del archivo. No envía el PDF a ningún servicio externo, no ejecuta
// contenido embebido y no expone errores internos. Ante una excepción inesperada
// registra un log estructurado server-side (sin binario ni PII) y devuelve un
// código de diagnóstico para correlacionar.

export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PAGINAS = 3; // un cronograma mensual es 1 página; el parser exige exactamente 1

export type ExtractFail = { ok: false; status: number; error: string; codigo?: string };
export type ExtractOk = { ok: true; parse: ParseResult; paginas: number };

type RawItem = { str?: unknown; transform?: number[]; width?: number };
type Fase = "carga_libreria" | "get_document" | "get_page" | "get_text_content" | "desconocida";

// Interfaz mínima que usamos de pdfjs (evita depender de tipos internos).
type PageLike = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: unknown[] }>;
};
type DocLike = { numPages: number; getPage: (n: number) => Promise<PageLike>; destroy: () => Promise<void> };
type PdfjsLike = {
  getDocument: (o: Record<string, unknown>) => { promise: Promise<DocLike> };
};

function versionPdfjs(): string {
  try {
    const req = createRequire(import.meta.url);
    return (req("pdfjs-dist/package.json") as { version?: string }).version ?? "?";
  } catch {
    return "?";
  }
}

// Carga pdfjs de forma diferida (dynamic import) para que un fallo de carga sea
// capturable como excepción (JSON), no un 500 de módulo.
async function cargarPdfjs(): Promise<PdfjsLike> {
  const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;
  return mod;
}

export async function analizarBuffer(buf: Buffer): Promise<ExtractOk | ExtractFail> {
  // Firma %PDF real (no confiar en la extensión).
  if (buf.length < 5 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { ok: false, status: 415, error: "El archivo no es un PDF válido." };
  }
  if (buf.length > MAX_PDF_BYTES) {
    return { ok: false, status: 413, error: "El PDF supera el máximo de 10 MB." };
  }

  let fase: Fase = "carga_libreria";
  let doc: DocLike | null = null;
  try {
    const pdfjs = await cargarPdfjs();

    fase = "get_document";
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false, // sin worker ni canvas: solo extracción de texto
    }).promise;

    const numPages = doc.numPages;
    if (numPages > MAX_PAGINAS) {
      return { ok: false, status: 422, error: "El PDF tiene demasiadas páginas para un cronograma mensual." };
    }

    fase = "get_page";
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });

    fase = "get_text_content";
    const tc = await page.getTextContent();
    const items: TextItem[] = (tc.items as RawItem[])
      .filter((i) => typeof i.str === "string" && Array.isArray(i.transform))
      .map((i) => ({
        str: i.str as string,
        x: (i.transform as number[])[4],
        y: vp.height - (i.transform as number[])[5],
        width: typeof i.width === "number" ? i.width : 0,
      }));

    const parse = parseCronogramaPdf(items, { numPages, width: vp.width, height: vp.height });
    return { ok: true, parse, paginas: numPages };
  } catch (e) {
    // Log estructurado server-side (sin binario ni PII) + código de correlación.
    const codigo = randomBytes(4).toString("hex").toUpperCase();
    const err = e as { name?: string; message?: string; stack?: string };
    const hash8 = createHash("sha256").update(buf).digest("hex").slice(0, 8);
    console.error(
      `[pdf-extract] PDF_PARSE_FAILED ref=${codigo} fase=${fase} ` +
        `err=${err?.name ?? "Error"} msg=${(err?.message ?? "").slice(0, 300)} ` +
        `node=${process.version} pdfjs=${versionPdfjs()} bytes=${buf.length} hash8=${hash8}`,
    );
    if (err?.stack) console.error(`[pdf-extract] ref=${codigo} stack=${err.stack.split("\n").slice(0, 6).join(" | ")}`);
    return { ok: false, status: 500, error: `El servidor no pudo procesar el PDF · referencia ${codigo}`, codigo };
  } finally {
    try {
      await doc?.destroy();
    } catch {
      /* noop */
    }
  }
}

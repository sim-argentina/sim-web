import "@/lib/ensureWithResolvers"; // debe ir ANTES de pdfjs (polyfill Node <22)
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseCronogramaPdf, type ParseResult, type TextItem } from "@/lib/cronogramaPdf";

// Extracción de texto POSICIONADO con pdfjs (server-only, runtime Node.js) y
// validaciones del archivo. No envía el PDF a ningún servicio externo, no ejecuta
// contenido embebido y no expone errores internos.

export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PAGINAS = 3; // un cronograma mensual es 1 página; el parser exige exactamente 1

export type ExtractFail = { ok: false; status: number; error: string };
export type ExtractOk = { ok: true; parse: ParseResult; paginas: number };

type RawItem = { str?: unknown; transform?: number[]; width?: number };

export async function analizarBuffer(buf: Buffer): Promise<ExtractOk | ExtractFail> {
  // Firma %PDF real (no confiar en la extensión).
  if (buf.length < 5 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { ok: false, status: 415, error: "El archivo no es un PDF válido." };
  }
  if (buf.length > MAX_PDF_BYTES) {
    return { ok: false, status: 413, error: "El PDF supera el máximo de 10 MB." };
  }

  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]> | null = null;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    }).promise;

    const numPages = doc.numPages;
    if (numPages > MAX_PAGINAS) {
      return { ok: false, status: 422, error: "El PDF tiene demasiadas páginas para un cronograma mensual." };
    }

    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: TextItem[] = (tc.items as RawItem[])
      .filter((i) => typeof i.str === "string" && Array.isArray(i.transform))
      .map((i) => ({
        str: i.str as string,
        x: (i.transform as number[])[4],
        y: vp.height - (i.transform as number[])[5], // origen arriba-izquierda
        width: typeof i.width === "number" ? i.width : 0,
      }));

    const parse = parseCronogramaPdf(items, { numPages, width: vp.width, height: vp.height });
    return { ok: true, parse, paginas: numPages };
  } catch {
    return { ok: false, status: 400, error: "No se pudo leer el PDF." };
  } finally {
    try {
      await doc?.destroy();
    } catch {
      /* noop */
    }
  }
}

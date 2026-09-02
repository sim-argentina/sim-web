// IA SIM · Bloque 4C — Punto único de render. Genera un formato desde el MISMO
// snapshot (ContextoRender). Determinístico y local: no consume tokens de Claude.

import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import type { FormatoArchivo } from "@/lib/ia/informes/limites";
import { renderPDF } from "@/lib/ia/informes/render/pdf";
import { renderDOCX } from "@/lib/ia/informes/render/docx";
import { renderXLSX } from "@/lib/ia/informes/render/xlsx";
import { renderCSV } from "@/lib/ia/informes/render/csv";
import { renderPNG } from "@/lib/ia/informes/render/png";

export type { ContextoRender };

export async function renderFormato(formato: FormatoArchivo, ctx: ContextoRender): Promise<Buffer> {
  switch (formato) {
    case "pdf": return renderPDF(ctx);
    case "docx": return renderDOCX(ctx);
    case "xlsx": return renderXLSX(ctx);
    case "csv": return renderCSV(ctx);
    case "png": return renderPNG(ctx);
  }
}

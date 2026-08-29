import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { analizarImportacion } from "@/lib/cronogramaImportServer";
import { MAX_PDF_BYTES } from "@/lib/cronogramaPdfExtract";

// Análisis de un PDF de cronograma (SOLO admin). Runtime Node.js (pdfjs). Valida
// contenido real (%PDF) y tamaño; no envía el archivo a servicios externos ni lo
// almacena como binario.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  if (!(await rateLimit(`cronograma-import:${clientIp(req)}`, 20, 60_000))) {
    return tooManyResponse();
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba un archivo (multipart/form-data)." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Adjuntá un archivo PDF." }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "El PDF supera el máximo de 10 MB." }, { status: 413 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const res = await analizarImportacion(buf, file.name);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ importacion: res.data }, { status: 201 });
  } catch (error) {
    return failResponse(500, "No se pudo analizar el PDF", { logContext: "importar analizar", error });
  }
}

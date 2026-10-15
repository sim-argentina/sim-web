import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { cargarInformeEvento } from "@/lib/colectivoInforme";
import { generarPdfInformeEvento, nombreArchivoInformePdf } from "@/lib/colectivoInformePdf";

// PDF del Informe del evento del Colectivo (admin y staff). Se genera en el
// momento, no se guarda en ningún lado. Usa exactamente los mismos datos que la
// pestaña Informe (cargarInformeEvento): no hay una segunda lógica de cálculo.
// El informe del Colectivo es interno y no forma parte de Finanzas SIM.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });

  const r = await cargarInformeEvento(id);
  if (!r.ok) {
    if (r.status === 500) return failResponse(500, r.error, { logContext: "colectivo/informe/pdf datos", error: r.detalle });
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  let pdf: Buffer;
  try {
    pdf = generarPdfInformeEvento(r.valor);
  } catch (error) {
    return failResponse(500, "No se pudo generar el PDF", { logContext: "colectivo/informe/pdf render", error });
  }
  const nombre = nombreArchivoInformePdf(r.valor.evento);
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}

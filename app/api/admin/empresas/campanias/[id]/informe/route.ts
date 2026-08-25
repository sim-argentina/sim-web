import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { logSecurityEvent } from "@/lib/apiError";
import { datosInforme } from "@/lib/empresasServer";

type RouteContext = { params: Promise<{ id: string }> };

// Dataset agregado del informe de una campaña (el PDF/Excel lo arma el cliente).
// ?tipo=parcial|definitivo. Admin. No guarda binarios; registra la generación.
export async function GET(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const tipo = new URL(req.url).searchParams.get("tipo") === "definitivo" ? "definitivo" : "parcial";
  const res = await datosInforme(id, tipo);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logSecurityEvent("empresa_informe_generado", { id, tipo, role: auth.role });
  return NextResponse.json(res.data);
}

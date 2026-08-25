import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generarCodigos } from "@/lib/empresasServer";
import { estadoEfectivo, estadoCodigoEfectivo } from "@/lib/empresas";

type RouteContext = { params: Promise<{ id: string }> };

// Lista de códigos de una campaña (para copiar/exportar). Admin.
export async function GET(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const { data: campania } = await supabaseAdmin.from("empresa_campanias").select("*").eq("id", id).maybeSingle();
  if (!campania) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const { data: codigos } = await supabaseAdmin.from("empresa_codigos").select("*").eq("campania_id", id).order("created_at");
  const est = estadoEfectivo(campania, new Date().toISOString().slice(0, 10));
  return NextResponse.json({
    codigos: (codigos ?? []).map((c) => ({ ...c, estado_efectivo: estadoCodigoEfectivo(c, est) })),
  });
}

// Generar los códigos contratados (≠ exportar). Admin. Idempotente por bandera.
export async function POST(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  const res = await generarCodigos(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logSecurityEvent("empresa_codigos_generados", { id, role: auth.role });
  return NextResponse.json(res.data);
}

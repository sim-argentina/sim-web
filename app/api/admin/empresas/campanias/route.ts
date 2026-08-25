import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { logSecurityEvent } from "@/lib/apiError";
import { listarCampanias, crearCampania } from "@/lib/empresasServer";

// Campañas Empresa: acciones comerciales → SOLO admin (server-side).
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const res = await listarCampanias({
    q: url.searchParams.get("q"),
    estado: url.searchParams.get("estado"),
    incluirArchivadas: url.searchParams.get("archivadas") === "1",
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ campanias: res.data });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const res = await crearCampania(body, auth.role);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logSecurityEvent("empresa_campania_creada", { role: auth.role });
  return NextResponse.json({ campania: res.data }, { status: 201 });
}

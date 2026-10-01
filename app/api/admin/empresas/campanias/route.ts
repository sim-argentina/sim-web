import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { logSecurityEvent } from "@/lib/apiError";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { listarCampanias, crearCampania } from "@/lib/empresasServer";
import { catalogoEmpresasVigente } from "@/lib/empresasComercial";

// Campañas Empresa: acciones comerciales → SOLO admin (server-side).
//
// (B7) El listado trae además el catálogo VIGENTE para una campaña nueva
// (modalidad y duraciones), resuelto en este request y sin caché. El alta lo
// vuelve a resolver: si el formulario se armó con otro, 409 sin escribir.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const [res, catalogo] = await Promise.all([
    listarCampanias({
      q: url.searchParams.get("q"),
      estado: url.searchParams.get("estado"),
      incluirArchivadas: url.searchParams.get("archivadas") === "1",
    }),
    catalogoEmpresasVigente(),
  ]);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: sinCache });
  return NextResponse.json({ campanias: res.data, catalogo }, { headers: sinCache });
}

export async function POST(req: Request) {
  // La cookie administrativa es SameSite=strict: esto es la segunda cerradura.
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const res = await crearCampania(body, auth.role);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, ...(res.codigo ? { codigo: res.codigo } : {}), ...(res.catalogo ? { catalogo: res.catalogo } : {}) },
      { status: res.status, headers: sinCache },
    );
  }
  logSecurityEvent("empresa_campania_creada", { role: auth.role });
  return NextResponse.json({ campania: res.data }, { status: 201 });
}

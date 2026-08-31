import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { obtenerDocumento, archivarDocumento, nuevaVersion, restaurarVersion } from "@/lib/ia/docs/documentosServer";
import { activarVersion } from "@/lib/ia/docs/conocimientoServer";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Detalle del documento + su historial de versiones.
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const d = await obtenerDocumento(id);
  if (!d) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json(d);
}

// Acciones: archivar/reactivar, activar versión, restaurar, subir nueva versión (JSON o multipart).
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("archivo");
    if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
    const r = await nuevaVersion({ documentoId: id, buf: new Uint8Array(await file.arrayBuffer()), nombre: file.name || "doc", actor: IA_OWNER_ADMIN });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ version_id: r.versionId, resultado: r.resultado }, { status: 201 });
  }

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accion = b.accion;
  if (accion === "archivar" || accion === "reactivar") {
    await archivarDocumento(id, accion === "archivar" ? "archivado" : "activo");
    return NextResponse.json({ ok: true });
  }
  if (accion === "activar" && typeof b.version_id === "string" && UUID_RE.test(b.version_id)) {
    const r = await activarVersion(id, b.version_id);
    return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : r.status });
  }
  if (accion === "restaurar" && typeof b.version_base_id === "string" && UUID_RE.test(b.version_base_id)) {
    const r = await restaurarVersion({ documentoId: id, versionBaseId: b.version_base_id, actor: IA_OWNER_ADMIN });
    return NextResponse.json(r.ok ? { ok: true, version_id: r.versionId } : { error: r.error }, { status: r.ok ? 200 : r.status });
  }
  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}

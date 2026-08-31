import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { contenidoVersion, corregirVersion } from "@/lib/ia/docs/documentosServer";
import { urlFirmada } from "@/lib/ia/docs/storage";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Contenido de una versión (para vista previa/comparación) + URL firmada del original.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const v = await contenidoVersion(id);
  if (!v) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const firmar = new URL(req.url).searchParams.get("archivo") === "1";
  const url = firmar && v.storage_path ? await urlFirmada(v.storage_path as string, 60) : null;
  return NextResponse.json({ id: v.id, numero: v.numero, nombre_original: v.nombre_original, contenido: v.contenido_corregido ?? v.contenido_extraido, contenido_extraido: v.contenido_extraido, archivo_url: url });
}

// Guardar corrección de la vista previa de una versión (no borra la extracción original).
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contenido = typeof b.contenido === "string" ? b.contenido : "";
  await corregirVersion(id, contenido);
  return NextResponse.json({ ok: true });
}

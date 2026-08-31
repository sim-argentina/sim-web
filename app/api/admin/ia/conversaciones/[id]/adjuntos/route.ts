import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { getLimitesDocs } from "@/lib/ia/docs/config";
import { crearAdjunto, listarAdjuntos } from "@/lib/ia/docs/adjuntosServer";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function conversacionPropia(id: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").select("owner, estado").eq("id", id).maybeSingle();
  return !!data && data.owner === IA_OWNER_ADMIN;
}

// Listar adjuntos de la conversación.
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id) || !(await conversacionPropia(id))) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  return NextResponse.json({ adjuntos: await listarAdjuntos(id) });
}

// Subir uno o varios archivos (multipart). Valida cantidad/tamaño/tipo real server-side.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id) || !(await conversacionPropia(id))) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const lim = getLimitesDocs();
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Formato de carga inválido." }, { status: 400 }); }
  const files = form.getAll("archivos").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  if (files.length > lim.maxArchivosPorMensaje) return NextResponse.json({ error: `Máximo ${lim.maxArchivosPorMensaje} archivos por mensaje.` }, { status: 400 });

  const resultados: unknown[] = [];
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    const r = await crearAdjunto({ conversacionId: id, buf, nombreOriginal: f.name || "archivo", actor: IA_OWNER_ADMIN });
    if (!r.ok) resultados.push({ ok: false, nombre: f.name, error: r.error });
    else resultados.push({ ok: true, duplicado: r.duplicado ?? false, adjunto: r.adjunto });
  }
  return NextResponse.json({ resultados }, { status: 201 });
}

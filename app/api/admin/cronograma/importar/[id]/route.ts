import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isValidUuid } from "@/lib/security";
import { getImportacion, guardarCorrecciones, type DiaProp } from "@/lib/cronogramaImportServer";

type Ctx = { params: Promise<{ id: string }> };

// GET: reabrir una importación (SOLO admin).
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  try {
    const imp = await getImportacion(id);
    if (!imp) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
    return NextResponse.json({ importacion: imp });
  } catch (error) {
    return failResponse(500, "Error cargando la importación", { logContext: "importar GET", error });
  }
}

// PUT: guardar correcciones y decisiones de conflicto (SOLO admin). Whitelist.
export async function PUT(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`cronograma-import:${clientIp(req)}`, 40, 60_000))) return tooManyResponse();

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const entrada: { aliases?: Record<string, string | null>; dias?: DiaProp[]; decisiones?: Record<string, "pdf" | "actual" | null> } = {};
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.aliases && typeof b.aliases === "object") entrada.aliases = b.aliases as Record<string, string | null>;
    if (Array.isArray(b.dias)) entrada.dias = b.dias as DiaProp[];
    if (b.decisiones && typeof b.decisiones === "object") entrada.decisiones = b.decisiones as Record<string, "pdf" | "actual" | null>;
  }

  const res = await guardarCorrecciones(id, entrada);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ importacion: res.data });
}

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isValidUuid } from "@/lib/security";
import { aplicarImportacion } from "@/lib/cronogramaImportServer";

type Ctx = { params: Promise<{ id: string }> };

// Aplicar la importación como BORRADOR (atómica). SOLO admin. Nunca confirma.
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit(`cronograma-import:${clientIp(_req)}`, 20, 60_000))) return tooManyResponse();

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const res = await aplicarImportacion(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ importacion: res.data.importacion });
}

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";
import { listarSerieIpc, validarEntradaIpc, cargarPuntoIpc } from "@/lib/ia/analisis/ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// IA SIM · Bloque 4E — Serie IPC oficial. Admin-only. Carga/actualiza manual y auditable (nunca
// hardcodeada en el código, nunca consultada a internet en cada respuesta del chat).

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const serie = await listarSerieIpc();
  return NextResponse.json({ serie }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!(await rateLimit("ia:inflacion:indice", 20, 60_000))) return tooManyResponse();

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const entradas = Array.isArray((body as { puntos?: unknown })?.puntos) ? (body as { puntos: unknown[] }).puntos : [body];
  if (entradas.length === 0 || entradas.length > 60) return NextResponse.json({ error: "Enviá entre 1 y 60 puntos (periodo, indice, fuente, url, fecha_publicacion)." }, { status: 400 });

  const cargados: string[] = [];
  const errores: string[] = [];
  for (const e of entradas) {
    const val = validarEntradaIpc(e);
    if (!val.ok) { errores.push(val.motivo); continue; }
    const r = await cargarPuntoIpc(val.entrada, IA_OWNER_ADMIN);
    if (!r.ok) { errores.push(`${val.entrada.periodo}: ${r.motivo}`); continue; }
    cargados.push(val.entrada.periodo);
  }
  if (cargados.length === 0) return NextResponse.json({ error: "Ningún punto válido.", errores }, { status: 400 });
  return NextResponse.json({ ok: true, cargados, errores: errores.length ? errores : undefined }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

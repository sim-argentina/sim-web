import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { logSecurityEvent } from "@/lib/apiError";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { conciliarRetenciones } from "@/lib/cuponesRetencion";

// Conciliación de retenciones de cupones limitados. PROTEGIDO:
//   · GET: el Cron de Vercel, con `Authorization: Bearer ${CRON_SECRET}`.
//     Revisa las retenciones que ya pasaron su vence_en (las más viejas primero).
//   · POST: un admin con sesión desde el panel (o el mismo secreto). Cuerpo
//     opcional { retencion_id } o { codigo_id } para revisar solo esas.
// Nunca libera "a mano": cada retención pasa por resolverRetencion, que solo
// libera si Mercado Pago confirma (consultas completas) que no queda nada
// pagable. Repetirlo es seguro. Cada revisión queda anotada en la retención
// (revisiones, revisada_en, resultado, motivo) y en el registro de seguridad.

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tieneSecretoCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const dado = Buffer.from(req.headers.get("authorization") || "");
  const esperado = Buffer.from(`Bearer ${secret}`);
  return dado.length === esperado.length && timingSafeEqual(dado, esperado);
}

async function conciliar(o: { ids?: string[]; codigoId?: number; origen: string; limite: number }) {
  try {
    const r = await conciliarRetenciones(o);
    const cuenta = (res: string) => r.resultados.filter((x) => x.resultado === res).length;
    const resumen = { revisadas: r.revisadas, liberadas: cuenta("liberada"), consumidas: cuenta("consumida"), retenidas: cuenta("retenida") };
    logSecurityEvent("cupones_conciliacion", { origen: o.origen, ...resumen });
    return NextResponse.json({ ok: true, instaladas: r.instaladas, ...resumen, resultados: r.resultados }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("cupones conciliar:", (error as Error)?.message);
    return NextResponse.json({ error: "No se pudo conciliar. Probá de nuevo: es seguro repetirlo." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!tieneSecretoCron(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return conciliar({ origen: "cron", limite: 50 });
}

export async function POST(req: Request) {
  const cron = tieneSecretoCron(req);
  if (!cron) {
    if (!isAllowedOrigin(req)) return forbiddenOrigin();
    const rol = await getCurrentAdminRole();
    if (rol !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: rol ? 403 : 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { retencion_id?: unknown; codigo_id?: unknown };
  if (body.retencion_id !== undefined && !(typeof body.retencion_id === "string" && UUID_RE.test(body.retencion_id))) {
    return NextResponse.json({ error: "Retención inválida" }, { status: 400 });
  }
  if (body.codigo_id !== undefined && !(Number.isInteger(body.codigo_id) && Number(body.codigo_id) > 0)) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }
  return conciliar({
    ids: typeof body.retencion_id === "string" ? [body.retencion_id] : undefined,
    codigoId: typeof body.codigo_id === "number" ? body.codigo_id : undefined,
    origen: cron ? "cron" : "panel",
    limite: 25,
  });
}

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { logSecurityEvent } from "@/lib/apiError";
import { ejecutarPendientes } from "@/lib/marketing/campaniasServer";

// Marketing · disparador de SERVIDOR del ejecutor de campañas (simulación).
// Un lote de cada campaña en 'ejecutando'. Protegido con
// `Authorization: Bearer ${CRON_SECRET}` (comparado en tiempo constante).
// NO está programado: el plan Hobby de Vercel solo admite crons diarios, que no
// sirven para una campaña. Queda listo para el mecanismo que se elija en la
// etapa real (ver docs/marketing/campanias.md, "Ejecución desde el servidor").
// Como todo el ejecutor, solo escribe en la base local de pruebas.

export const dynamic = "force-dynamic";

function tieneSecreto(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const dado = Buffer.from(req.headers.get("authorization") || "");
  const esperado = Buffer.from(`Bearer ${secret}`);
  return dado.length === esperado.length && timingSafeEqual(dado, esperado);
}

export async function POST(req: Request) {
  if (!tieneSecreto(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    const r = await ejecutarPendientes();
    if (!r.ok) {
      const status = r.e?.status ?? 500;
      return NextResponse.json({ error: r.e?.error ?? "No se pudo ejecutar.", codigo: r.e?.codigo }, { status, headers: { "Cache-Control": "no-store" } });
    }
    logSecurityEvent("campanias_lote_servidor", { campanias: r.valor.length });
    return NextResponse.json({ ok: true, campanias: r.valor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("campanias ejecutar:", (error as Error)?.message);
    return NextResponse.json({ error: "No se pudo ejecutar. Es seguro repetirlo." }, { status: 500 });
  }
}

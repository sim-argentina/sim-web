import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { logSecurityEvent } from "@/lib/apiError";
import { marketingCampaniasHabilitadas } from "@/lib/featureFlags";
import { ejecutarPendientes } from "@/lib/marketing/campaniasServer";
import { campaniasDeshabilitadas } from "@/lib/marketing/http";
import { procesarEventos } from "@/lib/marketing/whatsappServer";

// Marketing · disparador de SERVIDOR del ejecutor de campañas (simulación).
// Procesa la bandeja del webhook de WhatsApp y corre un lote de cada campaña en
// 'ejecutando'. Protegido con
// `Authorization: Bearer ${CRON_SECRET}` (comparado en tiempo constante).
// NO está programado: el plan Hobby de Vercel solo admite crons diarios, que no
// sirven para una campaña. Queda listo para el mecanismo que se elija en la
// etapa real (ver docs/marketing/campanias.md, "Ejecución desde el servidor").
// Como todo el ejecutor, solo escribe en la base local de pruebas. Con la llave
// maestra apagada (MARKETING_CAMPANIAS_ENABLED) responde 503 "Deshabilitado" sin
// tocar la bandeja ni las campañas.

export const dynamic = "force-dynamic";

function tieneSecreto(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const dado = Buffer.from(req.headers.get("authorization") || "");
  const esperado = Buffer.from(`Bearer ${secret}`);
  return dado.length === esperado.length && timingSafeEqual(dado, esperado);
}

export async function POST(req: Request) {
  if (!marketingCampaniasHabilitadas()) return campaniasDeshabilitadas();
  if (!tieneSecreto(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    // Primero la bandeja del webhook de WhatsApp (bajas y estados que hayan
    // quedado sin procesar por un corte): corre aunque los envíos estén apagados.
    const wa = await procesarEventos(200);
    const r = await ejecutarPendientes();
    const whatsapp = wa.ok ? wa.valor : { error: wa.instalado ? "no se pudo procesar" : "no instalado" };
    if (!r.ok && r.e?.codigo === "solo_simulacion_local") {
      // Fuera de la base local las campañas no corren, pero la bandeja sí se procesó.
      return NextResponse.json({ ok: true, whatsapp, campanias: [], campanias_omitidas: r.e.error }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!r.ok) {
      const status = r.e?.status ?? 500;
      return NextResponse.json({ error: r.e?.error ?? "No se pudo ejecutar.", codigo: r.e?.codigo, whatsapp }, { status, headers: { "Cache-Control": "no-store" } });
    }
    logSecurityEvent("campanias_lote_servidor", { campanias: r.valor.length });
    return NextResponse.json({ ok: true, whatsapp, campanias: r.valor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("campanias ejecutar:", (error as Error)?.message);
    return NextResponse.json({ error: "No se pudo ejecutar. Es seguro repetirlo." }, { status: 500 });
  }
}

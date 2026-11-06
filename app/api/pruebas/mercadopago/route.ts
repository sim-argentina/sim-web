import { NextResponse } from "next/server";
import { createHmac, randomUUID } from "node:crypto";
import { modoSimulado, simulador, type ModoCrear } from "@/lib/mercadoPagoSimulado";

// Mercado Pago SIMULADO · acciones de la página de pago de prueba. Solo en el
// entorno local de pruebas (lib/mercadoPagoSimulado.ts); en cualquier otro
// lado responde 404 como si no existiera. Hace lo que haría Mercado Pago: crea
// el pago y avisa al webhook REAL de la app (firmado si hay secreto), y
// devuelve a dónde vuelve la persona (back_urls de la preferencia).

export const dynamic = "force-dynamic";

const noExiste = () => NextResponse.json({ error: "No encontrado" }, { status: 404 });

/** Avisa al webhook de la app, como Mercado Pago (POST con type=payment y data.id). */
async function notificar(origen: string, notificationUrl: string | null, pagoId: string): Promise<number> {
  if (!notificationUrl) return 0;
  const ruta = new URL(notificationUrl).pathname; // siempre al mismo servidor local
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secreto = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (secreto) {
    const ts = String(Date.now());
    const rid = randomUUID();
    const v1 = createHmac("sha256", secreto).update(`id:${pagoId.toLowerCase()};request-id:${rid};ts:${ts};`).digest("hex");
    Object.assign(headers, { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid });
  }
  const res = await fetch(`${origen}${ruta}`, { method: "POST", headers, body: JSON.stringify({ type: "payment", data: { id: pagoId } }) });
  return res.status;
}

/** A dónde vuelve la persona, en el mismo servidor local, con los parámetros que agrega Mercado Pago. */
function vuelta(backUrls: Record<string, string>, estado: string, pago: { id: string; external_reference: string; preference_id: string }) {
  const clave = estado === "approved" ? "success" : estado === "rejected" ? "failure" : "pending";
  const destino = backUrls[clave] ? new URL(backUrls[clave]) : null;
  if (!destino) return "/";
  const q = new URLSearchParams(destino.search);
  q.set("payment_id", pago.id);
  q.set("status", estado);
  q.set("external_reference", pago.external_reference);
  q.set("preference_id", pago.preference_id);
  return `${destino.pathname}?${q.toString()}`;
}

export async function GET() {
  if (!modoSimulado()) return noExiste();
  return NextResponse.json(simulador.estado(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!modoSimulado()) return noExiste();
  const origen = new URL(req.url).origin;
  const b = (await req.json().catch(() => ({}))) as { accion?: string; pref?: string; estado?: string; modo?: string; pago?: string };
  try {
    if (b.accion === "modo") {
      if (!["ok", "falla", "sin_respuesta", "falla_busqueda"].includes(String(b.modo))) return NextResponse.json({ error: "modo inválido" }, { status: 400 });
      return NextResponse.json({ modo: simulador.modo(b.modo as ModoCrear) });
    }
    if (b.accion === "vencer") {
      simulador.vencer(String(b.pref));
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "pagar") {
      if (!["approved", "rejected", "in_process"].includes(String(b.estado))) return NextResponse.json({ error: "estado inválido" }, { status: 400 });
      const pref = simulador.obtenerPreferencia(String(b.pref));
      const pago = simulador.pagar(pref.id, b.estado as "approved" | "rejected" | "in_process");
      const webhook = await notificar(origen, pref.notification_url, pago.id);
      return NextResponse.json({ ok: true, pago: { id: pago.id, status: pago.status }, webhook, redirect: vuelta(pref.back_urls, pago.status, pago) });
    }
    if (b.accion === "cambiar_pago") {
      if (!["approved", "rejected"].includes(String(b.estado))) return NextResponse.json({ error: "estado inválido" }, { status: 400 });
      const pago = simulador.cambiarPago(String(b.pago), b.estado as "approved" | "rejected");
      const pref = simulador.obtenerPreferencia(pago.preference_id);
      const webhook = await notificar(origen, pref.notification_url, pago.id);
      return NextResponse.json({ ok: true, pago: { id: pago.id, status: pago.status }, webhook });
    }
    return NextResponse.json({ error: "acción inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: Number((e as { status?: number }).status) || 400 });
  }
}

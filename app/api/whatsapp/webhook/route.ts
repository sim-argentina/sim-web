import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/apiError";
import {
  isWhatsappConfigured,
  whatsappVerifyToken,
  esNumeroAutorizado,
  verificarFirma,
  enviarTexto,
} from "@/lib/whatsapp";
import { interpretarMensaje, resumenPlan, guardarPlan, type Plan } from "@/lib/finanzasWhatsapp";

// Webhook de WhatsApp Cloud API para carga de Finanzas por texto (MVP).
// GET: verificación de Meta. POST: recepción de mensajes con confirmación OK/CANCELAR.
// Si faltan variables, el módulo queda desactivado sin romper la app.

const RE_OK = /^(ok|s[ií]|dale|confirmar|guardar|guarda)\b/i;
const RE_CANCEL = /^(cancelar|cancela|no|cancel)\b/i;

// ── GET: verificación del webhook (Meta) ──────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (!isWhatsappConfigured()) {
    return NextResponse.json({ error: "WhatsApp no configurado" }, { status: 503 });
  }
  if (mode === "subscribe" && token && token === whatsappVerifyToken()) {
    return new Response(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Token de verificación inválido" }, { status: 403 });
}

// ── POST: mensajes entrantes ──────────────────────────────────────────────────
export async function POST(req: Request) {
  // Meta reintenta si no recibe 200: respondemos 200 salvo firma inválida.
  if (!(await rateLimit(`wa:${clientIp(req)}`, 120, 60_000))) {
    return NextResponse.json({ error: "rate limit" }, { status: 429 });
  }

  const raw = await req.text();

  if (!isWhatsappConfigured()) {
    // Módulo desactivado: no procesamos, pero no rompemos.
    return NextResponse.json({ ok: false, disabled: true }, { status: 200 });
  }

  // Validación de firma (si hay APP_SECRET). null = no configurada → se omite.
  const firma = verificarFirma(raw, req.headers.get("x-hub-signature-256"));
  if (firma === false) {
    logSecurityEvent("whatsapp_firma_invalida", { ip: clientIp(req) });
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const mensajes = extraerMensajes(body);
    for (const m of mensajes) {
      await procesarMensaje(m.from, m.id, m.text, m.type);
    }
  } catch (e) {
    console.error("[whatsapp] error procesando", e);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type Entrante = { from: string; id: string; text: string; type: string };

function extraerMensajes(body: unknown): Entrante[] {
  const out: Entrante[] = [];
  const entry = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entry)) return out;
  for (const e of entry) {
    const changes = (e as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const value = (c as { value?: { messages?: unknown[] } })?.value;
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const msg of messages) {
        const mm = msg as { from?: string; id?: string; type?: string; text?: { body?: string } };
        out.push({
          from: String(mm.from || ""),
          id: String(mm.id || ""),
          type: String(mm.type || ""),
          text: String(mm.text?.body || "").trim(),
        });
      }
    }
  }
  return out;
}

async function procesarMensaje(from: string, messageId: string, texto: string, type: string) {
  if (!from || !messageId) return;

  // Solo números autorizados. Cualquier otro se ignora en silencio.
  if (!esNumeroAutorizado(from)) {
    logSecurityEvent("whatsapp_numero_no_autorizado", { from: from.slice(-4) });
    return;
  }

  // Dedup por message_id: insertamos la fila; si ya existe (unique), ya se procesó.
  const { data: fila, error: insErr } = await supabaseAdmin
    .from("fin_whatsapp_pendientes")
    .insert([{ phone: from, message_id: messageId, texto_original: texto.slice(0, 500), estado: "pendiente" }])
    .select()
    .single();
  if (insErr) {
    // 23505 = unique_violation → mensaje repetido, no reprocesar.
    return;
  }

  // MVP: solo texto.
  if (type !== "text" || texto.length < 2) {
    await marcar(fila.id, "no_entendido");
    await enviarTexto(from, "Por ahora solo entiendo texto. Ej: \"8500 nafta mp\".");
    return;
  }

  // Confirmación / cancelación de un pendiente anterior.
  if (RE_OK.test(texto)) {
    await confirmar(from, fila.id);
    return;
  }
  if (RE_CANCEL.test(texto)) {
    await cancelar(from, fila.id);
    return;
  }

  // Mensaje nuevo → interpretar.
  let plan: Plan | null = null;
  try {
    plan = await interpretarMensaje(texto);
  } catch (e) {
    console.error("[whatsapp] interpretar", e);
  }

  if (!plan) {
    await marcar(fila.id, "no_entendido");
    await enviarTexto(
      from,
      "No entendí el mensaje. Reescribilo, ej: \"8500 nafta mp\", \"ingreso 50000 efectivo venta\" o \"transferi 30000 efectivo a mp\"."
    );
    return;
  }

  // Expira pendientes previos de este teléfono (queda uno activo por vez).
  await supabaseAdmin
    .from("fin_whatsapp_pendientes")
    .update({ estado: "expirado", updated_at: new Date().toISOString() })
    .eq("phone", from)
    .eq("estado", "pendiente")
    .not("interpretacion_json", "is", null)
    .neq("id", fila.id);

  await supabaseAdmin
    .from("fin_whatsapp_pendientes")
    .update({ interpretacion_json: plan, updated_at: new Date().toISOString() })
    .eq("id", fila.id);

  const resumen = await resumenPlan(plan);
  await enviarTexto(from, resumen);
}

async function confirmar(from: string, filaOkId: string) {
  const ahora = new Date().toISOString();
  const { data: pend } = await supabaseAdmin
    .from("fin_whatsapp_pendientes")
    .select("*")
    .eq("phone", from)
    .eq("estado", "pendiente")
    .not("interpretacion_json", "is", null)
    .gt("expires_at", ahora)
    .neq("id", filaOkId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await marcar(filaOkId, "confirmado");

  if (!pend) {
    await enviarTexto(from, "No hay nada pendiente para confirmar. Mandá el movimiento primero.");
    return;
  }

  const res = await guardarPlan(pend.interpretacion_json as Plan);
  if (!res.ok) {
    await marcar(pend.id, "error");
    await enviarTexto(from, `No pude guardarlo: ${res.error || "error"}. Probá de nuevo.`);
    return;
  }
  await supabaseAdmin
    .from("fin_whatsapp_pendientes")
    .update({ estado: "guardado", resultado_id: res.id, updated_at: ahora })
    .eq("id", pend.id);
  await enviarTexto(from, "✅ Guardado en Finanzas.");
}

async function cancelar(from: string, filaCancelId: string) {
  const ahora = new Date().toISOString();
  await marcar(filaCancelId, "cancelado");
  const { data: pend } = await supabaseAdmin
    .from("fin_whatsapp_pendientes")
    .select("id")
    .eq("phone", from)
    .eq("estado", "pendiente")
    .not("interpretacion_json", "is", null)
    .gt("expires_at", ahora)
    .neq("id", filaCancelId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pend) await marcar(pend.id, "cancelado");
  await enviarTexto(from, "Cancelado. No se guardó nada.");
}

async function marcar(id: string, estado: string) {
  await supabaseAdmin
    .from("fin_whatsapp_pendientes")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", id);
}

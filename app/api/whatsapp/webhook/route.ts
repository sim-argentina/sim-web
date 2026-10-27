import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/apiError";
import { isWhatsappConfigured, whatsappVerifyToken, esNumeroAutorizado, enviarTexto } from "@/lib/whatsapp";
import { interpretarMensaje, resumenPlan, guardarPlan, type Plan } from "@/lib/finanzasWhatsapp";
import {
  TAMANO_MAXIMO_WEBHOOK,
  leerConfigWebhook,
  leerWebhook,
  tokenVerificacionValido,
  verificarFirmaMeta,
} from "@/lib/marketing/whatsappWebhook";
import { anotar, procesarEventos, registrarEventos } from "@/lib/marketing/whatsappServer";

// Webhook de WhatsApp Cloud API (Meta). Dos usos sobre el mismo número:
//   · Marketing: estados de entrega de los envíos reales, bajas por WhatsApp
//     (texto inequívoco, botón de baja, user_preferences) → bandeja persistente
//     de db/marketing-whatsapp.sql. No envía nada.
//   · Finanzas (MVP de siempre): carga de movimientos por texto desde números
//     autorizados, con confirmación OK/CANCELAR. Sin cambios en su lógica.
// GET: verificación de la suscripción (hub.mode, hub.verify_token, hub.challenge).
// POST: solo se procesa con la configuración completa (secreto de la app, número
// y cuenta) y una firma X-Hub-Signature-256 válida sobre los BYTES recibidos.
// Solo eventos de la cuenta (entry.id) y el número (metadata.phone_number_id) de
// SIM. Las novedades de marketing se GUARDAN antes de responder 200: si la base
// falla se responde 500 y Meta reintenta (hasta 7 días). Ver
// docs/marketing/whatsapp-cloud-api.md.

export const dynamic = "force-dynamic";

const RE_OK = /^(ok|s[ií]|dale|confirmar|guardar|guarda)\b/i;
const RE_CANCEL = /^(cancelar|cancela|no|cancel)\b/i;

// ── GET: verificación del webhook (Meta) ──────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const esperado = whatsappVerifyToken();
  if (!esperado) {
    return NextResponse.json({ error: "WhatsApp no configurado" }, { status: 503 });
  }
  if (mode === "subscribe" && tokenVerificacionValido(token, esperado) && challenge && /^[A-Za-z0-9_-]{1,100}$/.test(challenge)) {
    await anotar("webhook_verificado");
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  logSecurityEvent("whatsapp_verificacion_invalida", { ip: clientIp(req) });
  return NextResponse.json({ error: "Token de verificación inválido" }, { status: 403 });
}

// ── POST: eventos ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  if (!(await rateLimit(`wa:${clientIp(req)}`, 120, 60_000))) {
    return NextResponse.json({ error: "rate limit" }, { status: 429 });
  }

  const cfg = leerConfigWebhook();
  if (!cfg.ok) {
    // Sin secreto, número o cuenta no se puede autenticar ni filtrar: no se procesa.
    await anotar("rechazo:sin_configuracion");
    return NextResponse.json({ error: "WhatsApp no configurado" }, { status: 503 });
  }

  const crudo = new Uint8Array(await req.arrayBuffer());
  if (crudo.byteLength > TAMANO_MAXIMO_WEBHOOK) {
    await anotar("rechazo:cuerpo_demasiado_grande");
    return NextResponse.json({ error: "cuerpo demasiado grande" }, { status: 413 });
  }
  if (!verificarFirmaMeta(crudo, req.headers.get("x-hub-signature-256"), cfg.config.appSecret)) {
    logSecurityEvent("whatsapp_firma_invalida", { ip: clientIp(req) });
    await anotar("rechazo:firma_invalida");
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(crudo).toString("utf8"));
  } catch {
    // Firmado pero ilegible: reintentarlo no lo arregla.
    await anotar("rechazo:cuerpo_invalido");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const lectura = leerWebhook(body, cfg.config);
  for (const [motivo, n] of Object.entries(lectura.rechazos)) {
    if (n) {
      if (motivo !== "evento_malformado") logSecurityEvent("whatsapp_evento_ajeno", { motivo, n });
      await anotar(`rechazo:${motivo}`);
    }
  }

  // Marketing: guardar ANTES de responder. Sin la migración, no hay nada que guardar.
  if (lectura.eventos.length) {
    const r = await registrarEventos(lectura.eventos);
    if (!r.ok && r.instalado) {
      console.error("[whatsapp] no se pudo guardar el webhook:", r.causa.slice(0, 200));
      return NextResponse.json({ error: "no se pudo guardar; reintentar" }, { status: 500 });
    }
    if (r.ok) {
      const p = await procesarEventos(100);
      if (!p.ok) console.error("[whatsapp] procesamiento pendiente:", p.causa.slice(0, 200));
    }
  }

  // Finanzas: el flujo de siempre, solo para eventos ya autenticados de la cuenta de SIM.
  if (isWhatsappConfigured()) {
    try {
      for (const m of lectura.finanzas) {
        await procesarMensaje(m.from, m.id, m.text, m.type);
      }
    } catch (e) {
      console.error("[whatsapp] error procesando", e);
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ── Finanzas: helpers (sin cambios) ───────────────────────────────────────────

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

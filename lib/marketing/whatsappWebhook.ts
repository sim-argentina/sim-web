// ============================================================================
// WhatsApp Cloud API — lectura del WEBHOOK. PURO (sin base ni red).
// ----------------------------------------------------------------------------
// Formatos de la documentación oficial (docs/marketing/whatsapp-cloud-api.md):
//   · Cuerpo: { object: "whatsapp_business_account", entry: [{ id: <WABA>,
//     changes: [{ field: "messages" | "user_preferences", value: {...} }] }] }.
//   · field "messages": value.metadata { display_phone_number, phone_number_id },
//     value.statuses[] { id, status (sent|delivered|read|failed|played),
//     timestamp, recipient_id, biz_opaque_callback_data?, pricing?, errors[] },
//     value.messages[] { from, id, timestamp, type, text.body | button {text,
//     payload} | interactive.button_reply {id, title}, context.id }.
//   · field "user_preferences": value.user_preferences[] { wa_id, category
//     "marketing_messages", value "stop"|"resume", timestamp }.
//   · Firma: X-Hub-Signature-256: sha256=<HMAC-SHA256(cuerpo, app secret)>. Se
//     calcula sobre los BYTES recibidos, antes de parsear.
//   · Meta reintenta hasta 7 días si no recibe 200 y puede duplicar eventos; el
//     orden no está garantizado y un "delivered" puede no llegar si se leyó
//     enseguida. La deduplicación va por clave (db/marketing-whatsapp.sql).
// De un mensaje entrante NO se guarda el texto: solo si es un pedido
// INEQUÍVOCO de baja (el mensaje entero) o el botón de baja de la plantilla.
// ============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

export const TAMANO_MAXIMO_WEBHOOK = 3 * 1024 * 1024; // documentado: hasta 3 MB

export function verificarFirmaMeta(crudo: Uint8Array, encabezado: string | null, secreto: string): boolean {
  if (!secreto || !encabezado || !encabezado.startsWith("sha256=")) return false;
  const esperado = Buffer.from(`sha256=${createHmac("sha256", secreto).update(crudo).digest("hex")}`);
  const dado = Buffer.from(encabezado.trim());
  return dado.length === esperado.length && timingSafeEqual(dado, esperado);
}

/** Comparación en tiempo constante del token de verificación (GET). */
export function tokenVerificacionValido(dado: string | null, esperado: string): boolean {
  if (!dado || !esperado) return false;
  const a = Buffer.from(dado);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ConfigWebhook = { appSecret: string; phoneNumberId: string; wabaId: string };

export function leerConfigWebhook(e: Record<string, string | undefined> = process.env):
  { ok: true; config: ConfigWebhook } | { ok: false; faltan: string[] } {
  const v = (k: string) => (e[k] ?? "").trim();
  const faltan = ["WHATSAPP_APP_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"].filter((k) => !v(k));
  if (faltan.length) return { ok: false, faltan };
  return { ok: true, config: { appSecret: v("WHATSAPP_APP_SECRET"), phoneNumberId: v("WHATSAPP_PHONE_NUMBER_ID"), wabaId: v("WHATSAPP_BUSINESS_ACCOUNT_ID") } };
}

// ── Bajas inequívocas ──────────────────────────────────────────────────────
// El mensaje ENTERO (sin tildes, mayúsculas ni puntuación final) tiene que ser
// uno de estos. "No, gracias", "cancelar" o "baja el precio" NO son bajas.
const TEXTOS_BAJA = new Set([
  "baja", "stop", "unsubscribe", "desuscribir", "desuscribirme", "darme de baja", "dar de baja",
  "baja promociones", "baja de promociones", "no quiero promociones", "no quiero mas promociones",
  "no quiero recibir promociones", "no quiero recibir mas promociones",
]);
// Etiquetas del botón de baja (quick reply de la plantilla). La de SIM se puede
// sumar con MARKETING_WHATSAPP_BOTON_BAJA; Meta usa estas en sus ejemplos.
const BOTONES_BAJA = new Set([
  "no quiero promociones", "baja de promociones", "dejar de recibir promociones", "detener promociones",
  "stop promotions", "unsubscribe from promos", "unsubscribe from all", "unsubscribe",
]);

export function normalizarTextoBaja(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ").replace(/\s+/g, " ").trim();
}

export function esTextoDeBaja(t: string): boolean {
  return TEXTOS_BAJA.has(normalizarTextoBaja(t));
}

export function esBotonDeBaja(etiqueta: string, extra: string | undefined = process.env.MARKETING_WHATSAPP_BOTON_BAJA): boolean {
  const n = normalizarTextoBaja(etiqueta);
  return BOTONES_BAJA.has(n) || (!!extra && n === normalizarTextoBaja(extra));
}

// ── Normalización de eventos ───────────────────────────────────────────────
export type EventoWhatsapp = {
  clave: string;
  tipo: "estado" | "mensaje" | "preferencia";
  wamid?: string;
  contexto_wamid?: string;
  biz_opaque?: string;
  wa_id?: string;
  estado_meta?: "sent" | "delivered" | "read" | "failed" | "played";
  intencion?: "baja_texto" | "baja_boton" | "otro";
  preferencia?: "stop" | "resume";
  error_codigo?: string;
  pricing?: { type?: string; category?: string; billable?: boolean; pricing_model?: string };
  ocurrido_en: string;
};

/** Lo mínimo de un mensaje entrante que usa el módulo de Finanzas (sin cambios). */
export type MensajeFinanzas = { from: string; id: string; type: string; text: string };

export type Rechazo = "cuenta_ajena" | "numero_ajeno" | "evento_malformado";

export type Lectura = { eventos: EventoWhatsapp[]; finanzas: MensajeFinanzas[]; rechazos: Partial<Record<Rechazo, number>> };

const ID_RE = /^[A-Za-z0-9._:=+/-]{1,200}$/;
const WA_RE = /^[0-9]{6,20}$/;
const ESTADOS = new Set(["sent", "delivered", "read", "failed", "played"]);

function instante(ts: unknown): string | null {
  const n = typeof ts === "string" && /^[0-9]{9,11}$/.test(ts) ? Number(ts) : typeof ts === "number" && Number.isInteger(ts) ? ts : NaN;
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Del cuerpo YA autenticado (firma válida) saca los eventos de la cuenta y el
 * número de SIM. Lo de otra cuenta u otro número se cuenta como rechazo y no
 * se procesa. Un elemento malformado se descarta sin frenar el resto.
 */
export function leerWebhook(cuerpo: unknown, c: Pick<ConfigWebhook, "phoneNumberId" | "wabaId">, botonExtra?: string): Lectura {
  const out: Lectura = { eventos: [], finanzas: [], rechazos: {} };
  const rechazo = (r: Rechazo) => { out.rechazos[r] = (out.rechazos[r] ?? 0) + 1; };
  const b = obj(cuerpo);
  if (!b || b.object !== "whatsapp_business_account") { rechazo("evento_malformado"); return out; }
  for (const e of arr(b.entry)) {
    const entry = obj(e);
    if (!entry) { rechazo("evento_malformado"); continue; }
    if (str(entry.id) !== c.wabaId) { rechazo("cuenta_ajena"); continue; }
    for (const ch of arr(entry.changes)) {
      const change = obj(ch);
      const value = obj(change?.value);
      if (!change || !value) { rechazo("evento_malformado"); continue; }
      const meta = obj(value.metadata);
      if (meta && str(meta.phone_number_id) !== c.phoneNumberId) { rechazo("numero_ajeno"); continue; }
      if (change.field === "messages") {
        if (!meta) { rechazo("numero_ajeno"); continue; }
        for (const s of arr(value.statuses)) leerEstado(obj(s), out, rechazo);
        for (const m of arr(value.messages)) leerMensaje(obj(m), out, rechazo, botonExtra);
      } else if (change.field === "user_preferences") {
        for (const p of arr(value.user_preferences)) leerPreferencia(obj(p), out, rechazo);
      }
    }
  }
  return out;
}

function leerEstado(s: Record<string, unknown> | null, out: Lectura, rechazo: (r: Rechazo) => void) {
  const id = str(s?.id);
  const status = str(s?.status);
  const cuando = instante(s?.timestamp);
  if (!s || !ID_RE.test(id) || !ESTADOS.has(status) || !cuando) { rechazo("evento_malformado"); return; }
  const ev: EventoWhatsapp = { clave: `estado:${id}:${status}`, tipo: "estado", wamid: id, estado_meta: status as EventoWhatsapp["estado_meta"], ocurrido_en: cuando };
  const destino = str(s.recipient_id);
  if (WA_RE.test(destino)) ev.wa_id = destino;
  const opaco = str(s.biz_opaque_callback_data);
  if (ID_RE.test(opaco)) ev.biz_opaque = opaco;
  const err = obj(arr(s.errors)[0]);
  if (err && Number.isInteger(err.code)) ev.error_codigo = String(err.code);
  const pr = obj(s.pricing);
  if (pr) {
    ev.pricing = {
      ...(typeof pr.type === "string" ? { type: pr.type.slice(0, 40) } : {}),
      ...(typeof pr.category === "string" ? { category: pr.category.slice(0, 40) } : {}),
      ...(typeof pr.billable === "boolean" ? { billable: pr.billable } : {}),
      ...(typeof pr.pricing_model === "string" ? { pricing_model: pr.pricing_model.slice(0, 20) } : {}),
    };
  }
  out.eventos.push(ev);
}

function leerMensaje(m: Record<string, unknown> | null, out: Lectura, rechazo: (r: Rechazo) => void, botonExtra?: string) {
  const id = str(m?.id);
  const from = str(m?.from);
  const cuando = instante(m?.timestamp);
  if (!m || !ID_RE.test(id) || !WA_RE.test(from) || !cuando) { rechazo("evento_malformado"); return; }
  const type = str(m.type);
  const texto = type === "text" ? str(obj(m.text)?.body) : "";
  let intencion: EventoWhatsapp["intencion"] = "otro";
  if (type === "text" && esTextoDeBaja(texto)) intencion = "baja_texto";
  else if (type === "button") {
    const boton = obj(m.button);
    if (esBotonDeBaja(str(boton?.text), botonExtra) || esBotonDeBaja(str(boton?.payload), botonExtra)) intencion = "baja_boton";
  } else if (type === "interactive") {
    const r = obj(obj(m.interactive)?.button_reply);
    if (esBotonDeBaja(str(r?.title), botonExtra)) intencion = "baja_boton";
  }
  const ev: EventoWhatsapp = { clave: `mensaje:${id}`, tipo: "mensaje", wamid: id, wa_id: from, intencion, ocurrido_en: cuando };
  const ctx = str(obj(m.context)?.id);
  if (ID_RE.test(ctx)) ev.contexto_wamid = ctx;
  out.eventos.push(ev);
  // Finanzas sigue recibiendo lo de siempre (texto incluido, solo en memoria).
  out.finanzas.push({ from, id, type, text: texto.trim() });
}

function leerPreferencia(p: Record<string, unknown> | null, out: Lectura, rechazo: (r: Rechazo) => void) {
  const wa = str(p?.wa_id);
  const value = str(p?.value);
  const cuando = instante(p?.timestamp);
  if (!p || p.category !== "marketing_messages" || !WA_RE.test(wa) || (value !== "stop" && value !== "resume") || !cuando) {
    rechazo("evento_malformado");
    return;
  }
  const ts = typeof p.timestamp === "number" ? String(p.timestamp) : str(p.timestamp);
  out.eventos.push({ clave: `preferencia:${wa}:${value}:${ts}`, tipo: "preferencia", wa_id: wa, preferencia: value, ocurrido_en: cuando });
}

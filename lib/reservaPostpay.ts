// ============================================================================
// Experiencia post-pago de Reservas (pública desde el 18/10/2026, con kill
// switch). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// Después de pagar una Reserva con Mercado Pago, el cliente vuelve a
// /reservas/confirmacion, que muestra el comprobante y permite agendar el turno
// (Google Calendar o .ics). Reglas:
//
//   · Kill switch: EXPERIMENTAL_RESERVA_POSTPAY. Prendida ("true"), TODAS las
//     Reservas web vuelven acá, sin pedir sesión. Apagada o ausente: el retorno
//     de siempre, idéntico, y las rutas nuevas dan 404. La vista previa interna
//     (/api/reservas/comprobante/vista-previa) sigue siendo solo admin.
//   · La pantalla NO decide nada con lo que trae la URL de Mercado Pago
//     (status, collection_status, payment_id…). "Pagada" sale solo de lo que
//     persistió el webhook: estado 'activa' + mercado_pago_payment_id.
//   · Acceso por enlace firmado: <id en base 36>.<HMAC>. Sin la firma correcta
//     no se lee nada (404): cambiar el número no muestra otra reserva. La clave
//     se deriva de ADMIN_SESSION_SECRET con un contexto propio (nunca sale del
//     servidor); si falta, todo falla cerrado y la preferencia usa el retorno
//     de siempre.
//   · Lo que se muestra es lo mínimo: sin nombre, teléfono, ids de la base ni
//     de Mercado Pago. El código visible es la referencia pública si la reserva
//     ya tiene una; si no, uno derivado de la firma (no el id).
// ============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reservaPostpayHabilitada } from "@/lib/featureFlags";
import { enlaceGoogleCalendar, sumarMinutos, type EventoReserva } from "@/lib/reservaPostpayCalendario";

export const RUTA_CONFIRMACION = "/reservas/confirmacion";
export const RUTA_ICS = "/api/reservas/comprobante/ics";

const CONTEXTO = "sim:reserva-postpay:v1";
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I

/** Clave propia del experimento, derivada; null si el secreto no está configurado. */
function clave(): Buffer | null {
  const secreto = process.env.ADMIN_SESSION_SECRET || "";
  if (secreto.length < 16) return null;
  return createHmac("sha256", secreto).update(CONTEXTO).digest();
}

function firma(k: Buffer, uso: string, id: number): Buffer {
  return createHmac("sha256", k).update(`${uso}:${id}`).digest();
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Enlace firmado del comprobante de una reserva: "<id base 36>.<firma>". */
export function firmarComprobante(id: number): string | null {
  const k = clave();
  if (!k || !Number.isSafeInteger(id) || id <= 0) return null;
  return `${id.toString(36)}.${b64url(firma(k, "comprobante", id)).slice(0, 22)}`;
}

/** El id de la reserva si el enlace es auténtico; si no, null. */
export function leerComprobante(token: unknown): number | null {
  if (typeof token !== "string" || token.length > 64) return null;
  const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const id = parseInt(m[1], 36);
  if (!Number.isSafeInteger(id) || id <= 0 || id.toString(36) !== m[1]) return null;
  const esperado = firmarComprobante(id);
  if (!esperado) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** Código visible derivado (SIM-XXXX-XXXX): estable, no revela el id. */
function codigoDerivado(k: Buffer, id: number): string {
  const h = firma(k, "codigo", id);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALFABETO[h[i] % ALFABETO.length];
  return `SIM-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** UID estable del evento de calendario (no revela el id). */
function uidEvento(k: Buffer, id: number): string {
  return `reserva-${firma(k, "uid", id).toString("hex").slice(0, 24)}@simexperience.com.ar`;
}

/**
 * ¿Esta preferencia vuelve a la experiencia nueva? Depende SOLO del kill switch:
 * prendido → cualquier cliente, sin sesión; apagado → el retorno de siempre.
 * (Hasta el 18/10/2026 además exigía sesión del panel: era la prueba interna.)
 */
export async function experimentoPostpayActivo(): Promise<boolean> {
  return reservaPostpayHabilitada();
}

/**
 * back_urls del experimento. null si no se puede firmar: entonces la
 * preferencia usa el retorno de siempre (falla segura).
 */
export function retornoExperimental(baseUrl: string, reservaId: number): {
  success: string; pending: string; failure: string;
} | null {
  const t = firmarComprobante(reservaId);
  if (!t) return null;
  const url = (vuelta: Vuelta) => `${baseUrl}${RUTA_CONFIRMACION}?t=${t}&vuelta=${vuelta}`;
  return { success: url("exito"), pending: url("pendiente"), failure: url("error") };
}

// ── Estado público ───────────────────────────────────────────────────────────

/** Por qué back_url volvió el cliente. Solo cambia el MENSAJE, nunca "pagada". */
export type Vuelta = "exito" | "pendiente" | "error";

export function leerVuelta(v: unknown): Vuelta | null {
  return v === "exito" || v === "pendiente" || v === "error" ? v : null;
}

export type EstadoPublico =
  | "confirmada"   // activa (pagada si además tiene el payment_id del webhook)
  | "procesando"   // volvió por éxito pero el webhook todavía no la confirmó
  | "pendiente"    // Mercado Pago informó pago pendiente
  | "rechazada"    // no se pudo cobrar / error al crear el pago
  | "cancelada"    // cancelada o reembolsada después
  | "revision";    // cobrada, pero el turno quedó en conflicto: se resuelve a mano

/** Estado que ve el cliente, decidido por la base. La vuelta solo matiza lo no confirmado. */
export function estadoPublico(estado: string, vuelta: Vuelta | null): EstadoPublico {
  switch (estado) {
    case "activa": return "confirmada";
    case "conflicto_pago": return "revision";
    case "cancelada":
    case "reembolsada": return "cancelada";
    case "error_pago": return "rechazada";
    case "pendiente_pago":
      return vuelta === "error" ? "rechazada" : vuelta === "pendiente" ? "pendiente" : "procesando";
    default:
      return "pendiente";
  }
}

export type DetalleReserva = {
  codigo: string;
  fecha: string;
  hora: string;
  horaFin: string;
  duracionMin: number;
  simuladores: string[];
  total: number;
  /** true solo con el payment_id que guardó el webhook. */
  pagada: boolean;
};

export type ComprobantePublico = {
  estado: EstadoPublico;
  /** Solo cuando está confirmada. */
  reserva: DetalleReserva | null;
  calendario: { google: string; ics: string } | null;
  /** transaction_id de GA4 (el mismo de begin_checkout/purchase), solo si está pagada. */
  analitica: { transaccion: string } | null;
};

type FilaReserva = {
  id: number;
  estado: string;
  origen: string | null;
  fecha: string;
  hora: string;
  duracion_minutos: number;
  simuladores: unknown;
  total: number | string;
  mercado_pago_payment_id: string | null;
  reprogramaciones: number | null;
  referencia_publica: string | null;
};

const COLUMNAS = "id, estado, origen, fecha, hora, duracion_minutos, simuladores, total, " +
  "mercado_pago_payment_id, reprogramaciones, referencia_publica";

/** Lee la reserva del enlace. Solo reservas web; cualquier otra cosa → null (404). */
async function leerReserva(token: unknown): Promise<{ fila: FilaReserva; k: Buffer } | null> {
  const id = leerComprobante(token);
  const k = clave();
  if (!id || !k) return null;
  const { data, error } = await supabaseAdmin.from("reservas").select(COLUMNAS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const fila = data as FilaReserva | null;
  if (!fila || (fila.origen ?? "web") !== "web") return null;
  return { fila, k };
}

function simuladoresDe(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : [];
  return (Array.isArray(lista) ? lista : []).map(String).filter(Boolean);
}

function eventoDe(fila: FilaReserva, k: Buffer): EventoReserva {
  return {
    fecha: fila.fecha,
    hora: String(fila.hora).slice(0, 5),
    duracionMin: Number(fila.duracion_minutos),
    simuladores: Math.max(1, simuladoresDe(fila.simuladores).length),
    codigo: fila.referencia_publica || codigoDerivado(k, fila.id),
    uid: uidEvento(k, fila.id),
    secuencia: Number(fila.reprogramaciones) || 0,
  };
}

/** Comprobante público de un enlace firmado. null = no existe para este enlace (404). */
export async function comprobantePorToken(token: unknown, vueltaCruda: unknown): Promise<ComprobantePublico | null> {
  const leida = await leerReserva(token);
  if (!leida) return null;
  const { fila, k } = leida;
  const estado = estadoPublico(String(fila.estado), leerVuelta(vueltaCruda));
  if (estado !== "confirmada") return { estado, reserva: null, calendario: null, analitica: null };

  const evento = eventoDe(fila, k);
  const pagada = !!fila.mercado_pago_payment_id;
  return {
    estado,
    reserva: {
      codigo: evento.codigo,
      fecha: evento.fecha,
      hora: evento.hora,
      horaFin: sumarMinutos(evento.fecha, evento.hora, evento.duracionMin).hora,
      duracionMin: evento.duracionMin,
      simuladores: simuladoresDe(fila.simuladores),
      total: Number(fila.total) || 0,
      pagada,
    },
    calendario: { google: enlaceGoogleCalendar(evento), ics: `${RUTA_ICS}?t=${token as string}` },
    analitica: pagada ? { transaccion: `reserva_${fila.id}` } : null,
  };
}

/** Datos del .ics: solo para una reserva confirmada (si no, null → 404). */
export async function eventoPorToken(token: unknown): Promise<EventoReserva | null> {
  const leida = await leerReserva(token);
  if (!leida || leida.fila.estado !== "activa") return null;
  return eventoDe(leida.fila, leida.k);
}

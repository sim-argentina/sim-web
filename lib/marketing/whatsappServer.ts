// ============================================================================
// WhatsApp Cloud API — acceso de SERVIDOR a la bandeja del webhook y al
// diagnóstico (db/marketing-whatsapp.sql). service_role solo lee; todo cambio
// pasa por las RPCs. Nada de esto envía mensajes.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { estadoConfiguracionWhatsapp, type EstadoConfigWhatsapp } from "@/lib/marketing/whatsappCloud";
import type { EventoWhatsapp } from "@/lib/marketing/whatsappWebhook";

type ErrorPg = { code?: string | null; message?: string | null } | null;
const SIN_INSTALAR = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);
export const noInstalado = (e: ErrorPg) => !!e?.code && SIN_INSTALAR.has(e.code);

export type R<T> = { ok: true; valor: T } | { ok: false; instalado: boolean; causa: string };
const fallo = <T>(e: ErrorPg): R<T> => ({ ok: false, instalado: !noInstalado(e), causa: `${e?.code ?? ""} ${e?.message ?? ""}`.trim() });

export async function registrarEventos(eventos: EventoWhatsapp[]): Promise<R<{ nuevos: number; repetidos: number }>> {
  const { data, error } = await supabaseAdmin.rpc("mkt_wa_registrar_eventos", { p_eventos: eventos });
  if (error) return fallo(error);
  return { ok: true, valor: data as { nuevos: number; repetidos: number } };
}

export async function procesarEventos(limite = 100): Promise<R<{ procesados: number; con_error: number; pendientes: number }>> {
  const { data, error } = await supabaseAdmin.rpc("mkt_wa_procesar_eventos", { p_limite: limite });
  if (error) return fallo(error);
  return { ok: true, valor: data as { procesados: number; con_error: number; pendientes: number } };
}

/** Anotación de diagnóstico; nunca hace fallar al webhook. */
export async function anotar(tipo: string, detalle: string | null = null): Promise<void> {
  try {
    await supabaseAdmin.rpc("mkt_wa_anotar", { p_tipo: tipo, p_detalle: detalle });
  } catch {
    // sin base o sin migración: el diagnóstico queda sin esa marca
  }
}

const enmascarar = (wa: string | null) => (wa && /^[0-9]{6,20}$/.test(wa) ? `${wa.slice(0, 5)}*****${wa.slice(-2)}` : null);

export type EstadoIntegracion =
  | "sin_configurar" | "configuracion_incompleta" | "presente_sin_verificar" | "verificada";

export type Diagnostico = {
  estado: EstadoIntegracion;
  config: EstadoConfigWhatsapp;
  instalado: boolean;
  verificacion: { webhook_verificado_en: string | null; ultimo_evento_firmado_en: string | null };
  rechazos: Record<string, { n: number; ultimo_en: string }>;
  ultimo_error: { detalle: string; en: string } | null;
  conteos: { pendientes: number; con_error: number; total: number };
  ultimos: { id: number; tipo: string; estado_meta: string | null; intencion: string | null; preferencia: string | null;
    error_codigo: string | null; wa_id: string | null; resultado: string | null; ocurrido_en: string; recibido_en: string;
    procesado_en: string | null; intentos: number; ultimo_error: string | null }[];
  reanudaciones_meta: number;
  envios: { simulados: number; reales: number };
};

/**
 * Diagnóstico sin secretos. "verificada" solo si Meta llamó de verdad: pasó la
 * verificación del webhook o llegó un evento firmado de la cuenta de SIM. Que
 * existan las variables NO alcanza para decir "conectado".
 */
export async function diagnostico(): Promise<Diagnostico> {
  const config = estadoConfiguracionWhatsapp();
  const base: Diagnostico = {
    estado: config.nivel === "sin_configurar" ? "sin_configurar" : config.nivel === "incompleta" ? "configuracion_incompleta" : "presente_sin_verificar",
    config, instalado: true,
    verificacion: { webhook_verificado_en: null, ultimo_evento_firmado_en: null },
    rechazos: {}, ultimo_error: null, conteos: { pendientes: 0, con_error: 0, total: 0 }, ultimos: [], reanudaciones_meta: 0,
    envios: { simulados: 0, reales: 0 },
  };
  const [est, ult, pend, err, tot, rean, envS, envR] = await Promise.all([
    supabaseAdmin.from("mkt_whatsapp_estado").select("*").maybeSingle(),
    supabaseAdmin.from("mkt_whatsapp_eventos")
      .select("id, tipo, estado_meta, intencion, preferencia, error_codigo, wa_id, resultado, ocurrido_en, recibido_en, procesado_en, intentos, ultimo_error")
      .order("id", { ascending: false }).limit(25),
    supabaseAdmin.from("mkt_whatsapp_eventos").select("id", { count: "exact", head: true }).is("procesado_en", null),
    supabaseAdmin.from("mkt_whatsapp_eventos").select("id", { count: "exact", head: true }).eq("resultado", "error"),
    supabaseAdmin.from("mkt_whatsapp_eventos").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("mkt_whatsapp_eventos").select("id", { count: "exact", head: true }).eq("preferencia", "resume"),
    supabaseAdmin.from("mkt_whatsapp_envios").select("id", { count: "exact", head: true }).eq("origen", "simulado"),
    supabaseAdmin.from("mkt_whatsapp_envios").select("id", { count: "exact", head: true }).eq("origen", "real"),
  ]);
  if (noInstalado(est.error) || noInstalado(ult.error)) return { ...base, instalado: false };
  const e = (est.data ?? {}) as { webhook_verificado_en?: string | null; ultimo_evento_firmado_en?: string | null; rechazos?: Record<string, { n: number; ultimo_en: string }>; ultimo_error?: string | null; ultimo_error_en?: string | null };
  const verificada = config.nivel === "presente" && !!(e.webhook_verificado_en || e.ultimo_evento_firmado_en);
  return {
    ...base,
    estado: verificada ? "verificada" : base.estado,
    verificacion: { webhook_verificado_en: e.webhook_verificado_en ?? null, ultimo_evento_firmado_en: e.ultimo_evento_firmado_en ?? null },
    rechazos: e.rechazos ?? {},
    ultimo_error: e.ultimo_error && e.ultimo_error_en ? { detalle: e.ultimo_error, en: e.ultimo_error_en } : null,
    conteos: { pendientes: pend.count ?? 0, con_error: err.count ?? 0, total: tot.count ?? 0 },
    ultimos: ((ult.data ?? []) as Diagnostico["ultimos"]).map((x) => ({ ...x, wa_id: enmascarar(x.wa_id) })),
    reanudaciones_meta: rean.count ?? 0,
    envios: { simulados: envS.count ?? 0, reales: envR.count ?? 0 },
  };
}

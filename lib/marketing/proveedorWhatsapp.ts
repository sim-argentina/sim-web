// ============================================================================
// Proveedor de envío de WhatsApp para campañas (Marketing · Etapa 1). PURO.
// ----------------------------------------------------------------------------
// En esta etapa solo existe el proveedor FALSO: guarda en memoria lo que se
// habría enviado y nunca toca la red. El de la Cloud API llega en una etapa
// posterior, con plantillas aprobadas y webhooks de estado y bajas.
//
// `evaluarProveedorWhatsapp` decide qué proveedor puede usar un proceso que
// PERSISTE el resultado de un envío (la cola de envíos). Sigue el patrón de
// lib/ia/proveedorPermitido.ts: decide por DESTINO y falla CERRADA. El falso solo
// se admite contra una base loopback o en Preview/Development de Vercel: marcar
// "enviado" en la base real algo que nadie recibió contaminaría las métricas.
// La simulación no persiste nada y usa el falso en memoria directamente.
// ============================================================================

import { createHash } from "node:crypto";
import { destinoEsLoopback } from "@/lib/ia/proveedorPermitido";

export type MensajePlantilla = {
  /** 549 + número canónico de 10 dígitos. */
  destino: string;
  /** Nombre de la plantilla aprobada en Meta. */
  plantilla: string;
  /** Idioma de la plantilla, p. ej. "es_AR". */
  idioma: string;
  /** Variables del cuerpo, en orden ({{1}}, {{2}}, …). */
  variables: readonly string[];
  /** Cupón del botón "copiar código", si la plantilla lo tiene. */
  codigoCupon?: string | null;
  /**
   * Clave LOCAL de un envío por destinatario y campaña (`${campania}:${telefono}`).
   * Evita que SIM pida dos veces en el flujo normal; NO es una garantía de envío
   * único del lado de Meta (la Cloud API no documenta idempotencia para /messages).
   */
  claveIdempotencia: string;
  /** Número de intento (1 = el primero). */
  intento?: number;
  /** "<destinatario>:<intento>": la Cloud API la puede devolver en los webhooks de estado (biz_opaque_callback_data). */
  referencia?: string;
};

/**
 * ok = la API ACEPTÓ el pedido (todavía no hay entrega ni lectura: eso llega por
 * webhook). incierto = no se sabe si salió: se conserva así y no se reenvía solo.
 */
export type ResultadoEnvio =
  | { ok: true; wamid: string; repetido: boolean; estadoMeta?: string }
  | { ok: false; codigo: string; transitorio: boolean; detalle: string; incierto?: true };

export interface ProveedorWhatsapp {
  readonly nombre: "falso" | "cloud";
  enviarPlantilla(mensaje: MensajePlantilla): Promise<ResultadoEnvio>;
}

const DESTINO_RE = /^549[0-9]{10}$/;

export type ProveedorFalso = ProveedorWhatsapp & {
  /** Lo que se habría enviado, en orden. Un registro por clave de idempotencia. */
  readonly enviados: readonly (MensajePlantilla & { wamid: string })[];
};

/**
 * Proveedor en memoria. `fallar` permite simular respuestas de Meta en pruebas
 * (p. ej. 131050 = la persona frenó el marketing; 131049 = límite por usuario).
 */
export function crearProveedorFalso(opts: { fallar?: (m: MensajePlantilla) => ResultadoEnvio | null } = {}): ProveedorFalso {
  const enviados: (MensajePlantilla & { wamid: string })[] = [];
  const porClave = new Map<string, string>();
  return {
    nombre: "falso",
    enviados,
    async enviarPlantilla(m) {
      if (!DESTINO_RE.test(m.destino)) {
        return { ok: false, codigo: "destino_invalido", transitorio: false, detalle: "El destino tiene que ser 549 + 10 dígitos." };
      }
      if (!m.plantilla.trim() || !m.idioma.trim() || !m.claveIdempotencia.trim()) {
        return { ok: false, codigo: "mensaje_incompleto", transitorio: false, detalle: "Faltan plantilla, idioma o clave de idempotencia." };
      }
      const previo = porClave.get(m.claveIdempotencia);
      if (previo) return { ok: true, wamid: previo, repetido: true };
      const falla = opts.fallar?.(m) ?? null;
      if (falla) return falla;
      const wamid = `wamid.FALSO.${enviados.length + 1}`;
      porClave.set(m.claveIdempotencia, wamid);
      enviados.push({ ...m, variables: [...m.variables], wamid });
      return { ok: true, wamid, repetido: false };
    },
  };
}

// ── Proveedor SIMULADO para la cola persistente de campañas ─────────────────
// El falso de arriba recuerda en memoria; la cola vive en la base y sobrevive a
// reinicios, así que este no guarda nada: decide por la clave de idempotencia
// (hash estable) qué le pasa a cada envío, y la misma clave da siempre el mismo
// wamid. Así una campaña simulada es reproducible y no depende del proceso.
// Bandas sobre un percentil 0–100 de la clave:
//   [0, definitivo)            error definitivo (131026: no se puede entregar)
//   [.., +transitorio)         error transitorio en el 1.er intento (130429: límite de envío), después sale
//   [.., +incierto)            sin respuesta en el 1.er intento (no se sabe si salió), después sale
//   resto                      aceptado
// La entrega usa otro percentil de la misma clave: < no_entregado → no entregado.

export type SimulacionEnvio = {
  fallo_definitivo_pct: number;
  fallo_transitorio_pct: number;
  incierto_pct: number;
  no_entregado_pct: number;
};

export class SinRespuestaSimulada extends Error {
  constructor() {
    super("sin respuesta del proveedor (simulado): no se sabe si el mensaje salió");
    this.name = "SinRespuestaSimulada";
  }
}

function percentil(clave: string): number {
  return createHash("sha256").update(clave).digest().readUInt32BE(0) / 2 ** 32 * 100;
}

export type DecisionEnvio = "aceptado" | "definitivo" | "transitorio" | "incierto";

export function decidirEnvioSimulado(clave: string, intento: number, s: SimulacionEnvio): DecisionEnvio {
  const p = percentil(clave);
  const def = s.fallo_definitivo_pct;
  const tra = def + s.fallo_transitorio_pct;
  const inc = tra + s.incierto_pct;
  if (p < def) return "definitivo";
  if (p < tra) return intento <= 1 ? "transitorio" : "aceptado";
  if (p < inc) return intento <= 1 ? "incierto" : "aceptado";
  return "aceptado";
}

export function decidirEntregaSimulada(clave: string, s: SimulacionEnvio): boolean {
  return percentil(`${clave}:entrega`) >= s.no_entregado_pct;
}

export function wamidSimulado(clave: string): string {
  return `wamid.SIMULADO.${createHash("sha256").update(clave).digest("hex").slice(0, 24)}`;
}

/** Proveedor sin estado y determinístico. Una respuesta incierta se simula lanzando SinRespuestaSimulada. */
export function crearProveedorSimulado(s: SimulacionEnvio): ProveedorWhatsapp {
  return {
    nombre: "falso",
    async enviarPlantilla(m) {
      if (!DESTINO_RE.test(m.destino)) {
        return { ok: false, codigo: "destino_invalido", transitorio: false, detalle: "El destino tiene que ser 549 + 10 dígitos." };
      }
      if (!m.plantilla.trim() || !m.idioma.trim() || !m.claveIdempotencia.trim()) {
        return { ok: false, codigo: "mensaje_incompleto", transitorio: false, detalle: "Faltan plantilla, idioma o clave de idempotencia." };
      }
      switch (decidirEnvioSimulado(m.claveIdempotencia, m.intento ?? 1, s)) {
        case "definitivo":
          return { ok: false, codigo: "131026", transitorio: false, detalle: "No se puede entregar a este número (simulado)." };
        case "transitorio":
          return { ok: false, codigo: "130429", transitorio: true, detalle: "Límite de envío alcanzado, reintentar más tarde (simulado)." };
        case "incierto":
          throw new SinRespuestaSimulada();
        default:
          return { ok: true, wamid: wamidSimulado(`${m.claveIdempotencia}:${m.intento ?? 1}`), repetido: false };
      }
    },
  };
}

export const CODIGO_SIN_PROVEEDOR = "whatsapp_sin_proveedor";
export const CODIGO_REAL_NO_DISPONIBLE = "whatsapp_cloud_api_no_disponible";
export const CODIGO_CLOUD_SIN_CAMPANIAS = "whatsapp_cloud_solo_adaptador";
export const CODIGO_FALSO_EN_PRODUCCION = "whatsapp_falso_en_vercel_production";
export const CODIGO_FALSO_VERCEL_INDETERMINADO = "whatsapp_falso_en_vercel_indeterminado";
export const CODIGO_FALSO_DESTINO_NO_LOOPBACK = "whatsapp_falso_con_destino_no_loopback";

export type VeredictoProveedorWhatsapp =
  | { ok: true; proveedor: "falso"; motivo: string }
  | { ok: false; codigo: string; motivo: string };

const ENTORNOS_VERCEL_NO_PRODUCTIVOS = new Set(["preview", "development"]);

export function evaluarProveedorWhatsapp(
  entorno: Record<string, string | undefined> = process.env,
): VeredictoProveedorWhatsapp {
  const pedido = (entorno.MARKETING_WHATSAPP_PROVIDER || "").trim().toLowerCase();
  if (!pedido) {
    return { ok: false, codigo: CODIGO_SIN_PROVEEDOR, motivo: "MARKETING_WHATSAPP_PROVIDER no está definido: no se envía nada." };
  }
  if (pedido === "cloud") {
    // El adaptador existe (lib/marketing/whatsappCloud.ts) pero en esta etapa
    // ninguna campaña puede usarlo: la base solo admite modo simulacion y los
    // envíos reales tienen su propio bloqueo, apagado por defecto.
    return { ok: false, codigo: CODIGO_CLOUD_SIN_CAMPANIAS, motivo: "La Cloud API está implementada pero las campañas solo corren en simulación; los envíos reales siguen bloqueados." };
  }
  if (pedido !== "fake") {
    return { ok: false, codigo: CODIGO_REAL_NO_DISPONIBLE, motivo: `El proveedor "${pedido}" no existe: los valores son "fake" o "cloud".` };
  }

  const vercelEnv = (entorno.VERCEL_ENV || "").toLowerCase();
  if (vercelEnv === "production") {
    return { ok: false, codigo: CODIGO_FALSO_EN_PRODUCCION, motivo: "El proveedor falso no puede usarse en Vercel Production." };
  }
  const enVercel = Boolean(entorno.VERCEL || entorno.VERCEL_URL);
  if (enVercel && !ENTORNOS_VERCEL_NO_PRODUCTIVOS.has(vercelEnv)) {
    return {
      ok: false,
      codigo: CODIGO_FALSO_VERCEL_INDETERMINADO,
      motivo: `Proveedor falso en Vercel con VERCEL_ENV="${entorno.VERCEL_ENV ?? ""}": no se puede descartar Production.`,
    };
  }
  if (destinoEsLoopback(entorno.NEXT_PUBLIC_SUPABASE_URL)) return { ok: true, proveedor: "falso", motivo: "destino_loopback" };
  if (ENTORNOS_VERCEL_NO_PRODUCTIVOS.has(vercelEnv)) return { ok: true, proveedor: "falso", motivo: `vercel_${vercelEnv}` };
  return {
    ok: false,
    codigo: CODIGO_FALSO_DESTINO_NO_LOOPBACK,
    motivo: "El proveedor falso solo puede persistir envíos en una base loopback; este destino no lo es.",
  };
}

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
  /** Un envío por destinatario y campaña: p. ej. `${campania}:${telefono}`. */
  claveIdempotencia: string;
};

export type ResultadoEnvio =
  | { ok: true; wamid: string; repetido: boolean }
  | { ok: false; codigo: string; transitorio: boolean; detalle: string };

export interface ProveedorWhatsapp {
  readonly nombre: "falso";
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

export const CODIGO_SIN_PROVEEDOR = "whatsapp_sin_proveedor";
export const CODIGO_REAL_NO_DISPONIBLE = "whatsapp_cloud_api_no_disponible";
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
  if (pedido !== "fake") {
    return { ok: false, codigo: CODIGO_REAL_NO_DISPONIBLE, motivo: `El proveedor "${pedido}" no existe todavía: solo hay proveedor falso.` };
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

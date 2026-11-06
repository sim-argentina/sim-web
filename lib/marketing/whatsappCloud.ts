// ============================================================================
// WhatsApp Cloud API (Meta) — adaptador de ENVÍO de plantillas de marketing.
// SOLO SERVIDOR: lee credenciales del entorno y nunca las devuelve ni las loguea.
// ----------------------------------------------------------------------------
// Documentación oficial consultada el 27/10/2026 (docs/marketing/whatsapp-cloud-api.md):
//   · POST https://graph.facebook.com/<VERSION>/<PHONE_NUMBER_ID>/messages con
//     Authorization: Bearer <token>; type "template" con name, language.code y
//     components (body con parámetros "text"; botón copy_code con "coupon_code",
//     máx. 20 caracteres).
//   · La respuesta (contacts[], messages[].id = wamid, messages[].message_status
//     accepted | held_for_quality_assessment | paused) SOLO dice que la API
//     ACEPTÓ el pedido: la entrega y la lectura llegan después por webhook
//     (sent, delivered, read, failed). Acá nunca se marca "entregado".
//   · Errores: 2, 4, 130429, 131000, 131016 y 131056 se pueden reintentar más
//     tarde; 131049 recién después de 24 h (para la campaña es definitivo);
//     131050 = la persona frenó el marketing (definitivo y además es una baja).
//   · Meta NO documenta una clave de idempotencia para /messages. La clave local
//     (campaña:teléfono) evita que SIM pida dos veces en el flujo normal, pero NO
//     garantiza un envío único del lado de Meta: si no hay respuesta (tiempo
//     agotado, corte de red, 5xx sin código), el resultado es INCIERTO y se
//     conserva así; nunca se reenvía solo suponiendo que falló.
//
// BLOQUEO de envíos reales (evaluarEnvioReal): apagado por defecto. Hace falta
// MARKETING_WHATSAPP_ENVIOS_REALES="true" (literal) además de la configuración
// completa y la plantilla. Se comprueba en CADA envío, ANTES de armar el pedido
// o tocar la red. Tener credenciales cargadas no habilita nada por sí solo.
// En esta etapa ninguna campaña puede usar este proveedor (modo 'simulacion' es
// el único que admite la base): el adaptador se prueba con transporte simulado.
// ============================================================================

import type { MensajePlantilla, ProveedorWhatsapp, ResultadoEnvio } from "@/lib/marketing/proveedorWhatsapp";

export const GRAPH_HOST = "https://graph.facebook.com";
export const TIEMPO_CLOUD_MS = 10_000;
const VERSION_RE = /^v\d{2,3}\.\d$/;
const ID_RE = /^[0-9]{6,25}$/;
const PLANTILLA_RE = /^[a-z0-9_]{1,512}$/;
const IDIOMA_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
const DESTINO_RE = /^549[0-9]{10}$/;

/** Variables de entorno de la integración. Ningún valor sale del servidor. */
export const VARIABLES_WHATSAPP = {
  WHATSAPP_ACCESS_TOKEN: "Token de usuario del sistema (permisos whatsapp_business_messaging y whatsapp_business_management).",
  WHATSAPP_PHONE_NUMBER_ID: "ID del número de WhatsApp Business (no el número de teléfono).",
  WHATSAPP_BUSINESS_ACCOUNT_ID: "ID de la cuenta de WhatsApp Business (WABA): el webhook solo acepta eventos de esa cuenta.",
  WHATSAPP_APP_SECRET: "Secreto de la app de Meta: valida la firma X-Hub-Signature-256 del webhook.",
  WHATSAPP_VERIFY_TOKEN: "Token que se carga en la configuración del webhook para la verificación inicial.",
  WHATSAPP_GRAPH_VERSION: "Versión explícita de la Graph API, p. ej. v26.0.",
  MARKETING_WHATSAPP_PLANTILLA: "Nombre de la plantilla de marketing APROBADA.",
  MARKETING_WHATSAPP_IDIOMA: "Código de idioma de la plantilla, p. ej. es_AR.",
} as const;
export type VariableWhatsapp = keyof typeof VARIABLES_WHATSAPP;

export type NivelConfig = "sin_configurar" | "incompleta" | "presente";
export type EstadoConfigWhatsapp = {
  nivel: NivelConfig;
  presentes: VariableWhatsapp[];
  faltan: VariableWhatsapp[];
  invalidas: VariableWhatsapp[];
  /** No secretos: la versión y los últimos 4 dígitos de los IDs. */
  version: string | null;
  numeroFinal: string | null;
  cuentaFinal: string | null;
  enviosReales: { pedido: boolean; habilitado: boolean; motivo: string };
};

type Entorno = Record<string, string | undefined>;
const val = (e: Entorno, k: string) => (e[k] ?? "").trim();

function invalidas(e: Entorno): VariableWhatsapp[] {
  const out: VariableWhatsapp[] = [];
  if (val(e, "WHATSAPP_GRAPH_VERSION") && !VERSION_RE.test(val(e, "WHATSAPP_GRAPH_VERSION"))) out.push("WHATSAPP_GRAPH_VERSION");
  if (val(e, "WHATSAPP_PHONE_NUMBER_ID") && !ID_RE.test(val(e, "WHATSAPP_PHONE_NUMBER_ID"))) out.push("WHATSAPP_PHONE_NUMBER_ID");
  if (val(e, "WHATSAPP_BUSINESS_ACCOUNT_ID") && !ID_RE.test(val(e, "WHATSAPP_BUSINESS_ACCOUNT_ID"))) out.push("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (val(e, "MARKETING_WHATSAPP_PLANTILLA") && !PLANTILLA_RE.test(val(e, "MARKETING_WHATSAPP_PLANTILLA"))) out.push("MARKETING_WHATSAPP_PLANTILLA");
  if (val(e, "MARKETING_WHATSAPP_IDIOMA") && !IDIOMA_RE.test(val(e, "MARKETING_WHATSAPP_IDIOMA"))) out.push("MARKETING_WHATSAPP_IDIOMA");
  return out;
}

export function estadoConfiguracionWhatsapp(e: Entorno = process.env): EstadoConfigWhatsapp {
  const claves = Object.keys(VARIABLES_WHATSAPP) as VariableWhatsapp[];
  const presentes = claves.filter((k) => val(e, k) !== "");
  const faltan = claves.filter((k) => val(e, k) === "");
  const inval = invalidas(e);
  const nivel: NivelConfig = presentes.length === 0 ? "sin_configurar" : faltan.length || inval.length ? "incompleta" : "presente";
  const fin = (k: string) => (ID_RE.test(val(e, k)) ? val(e, k).slice(-4) : null);
  const r = evaluarEnvioReal(e);
  return {
    nivel, presentes, faltan, invalidas: inval,
    version: VERSION_RE.test(val(e, "WHATSAPP_GRAPH_VERSION")) ? val(e, "WHATSAPP_GRAPH_VERSION") : null,
    numeroFinal: fin("WHATSAPP_PHONE_NUMBER_ID"), cuentaFinal: fin("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    enviosReales: { pedido: val(e, "MARKETING_WHATSAPP_ENVIOS_REALES") === "true", habilitado: r.ok, motivo: r.ok ? "habilitados" : r.motivo },
  };
}

/** "messages" (Cloud API) o "marketing_messages" (Marketing Messages API: mismo esquema y webhooks; Meta deja de admitir marketing por /messages el 13/10/2027). */
export type EndpointCloud = "messages" | "marketing_messages";
export type ConfigCloud = { version: string; phoneNumberId: string; token: string; plantilla: string; idioma: string; bizOpaque: boolean; endpoint: EndpointCloud };

export const CODIGO_ENVIO_REAL_BLOQUEADO = "envio_real_bloqueado";

/**
 * El bloqueo de envíos reales. Falla cerrada: cualquier cosa que no sea el
 * literal "true" lo deja apagado, y sin configuración completa tampoco sale nada.
 */
export function evaluarEnvioReal(e: Entorno = process.env): { ok: true; config: ConfigCloud } | { ok: false; codigo: string; motivo: string } {
  if (val(e, "MARKETING_WHATSAPP_ENVIOS_REALES") !== "true") {
    return { ok: false, codigo: "envios_reales_apagados", motivo: "Envíos reales apagados (MARKETING_WHATSAPP_ENVIOS_REALES no es \"true\")." };
  }
  const requeridas: VariableWhatsapp[] = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_GRAPH_VERSION", "MARKETING_WHATSAPP_PLANTILLA", "MARKETING_WHATSAPP_IDIOMA"];
  const faltan = requeridas.filter((k) => val(e, k) === "");
  const inval = invalidas(e).filter((k) => requeridas.includes(k));
  const endpoint = val(e, "MARKETING_WHATSAPP_ENDPOINT") || "messages";
  if (endpoint !== "messages" && endpoint !== "marketing_messages") {
    return { ok: false, codigo: "configuracion_incompleta", motivo: "MARKETING_WHATSAPP_ENDPOINT tiene que ser messages o marketing_messages." };
  }
  if (faltan.length || inval.length) {
    return { ok: false, codigo: "configuracion_incompleta", motivo: `Falta o es inválida: ${[...faltan, ...inval].join(", ")}.` };
  }
  return {
    ok: true,
    config: {
      version: val(e, "WHATSAPP_GRAPH_VERSION"), phoneNumberId: val(e, "WHATSAPP_PHONE_NUMBER_ID"), token: val(e, "WHATSAPP_ACCESS_TOKEN"),
      plantilla: val(e, "MARKETING_WHATSAPP_PLANTILLA"), idioma: val(e, "MARKETING_WHATSAPP_IDIOMA"),
      bizOpaque: val(e, "MARKETING_WHATSAPP_BIZ_OPAQUE") === "true",
      endpoint,
    },
  };
}

/** Máximo de parámetros de cuerpo que admite el contrato de la plantilla de SIM. */
export const PARAMETROS_CUERPO_MAX = 10;
const PARAMETRO_MAX = 512;

/**
 * Arma el cuerpo del pedido para una plantilla. Validación local y conservadora:
 * cada parámetro de cuerpo no vacío, sin saltos de línea ni tabulaciones y sin
 * más de 4 espacios seguidos; el cupón del botón "copiar código" hasta 20
 * caracteres (límite documentado).
 */
export function armarPedidoPlantilla(m: MensajePlantilla, c: Pick<ConfigCloud, "plantilla" | "idioma" | "bizOpaque">):
  { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!DESTINO_RE.test(m.destino)) return { ok: false, error: "destino_invalido" };
  const plantilla = m.plantilla || c.plantilla;
  const idioma = m.idioma || c.idioma;
  if (!PLANTILLA_RE.test(plantilla) || !IDIOMA_RE.test(idioma)) return { ok: false, error: "plantilla_invalida" };
  if (m.variables.length === 0 || m.variables.length > PARAMETROS_CUERPO_MAX) return { ok: false, error: "parametros_invalidos" };
  for (const v of m.variables) {
    if (typeof v !== "string" || !v.trim() || v.length > PARAMETRO_MAX || /[\n\t]/.test(v) || / {5,}/.test(v)) return { ok: false, error: "parametros_invalidos" };
  }
  const components: Record<string, unknown>[] = [
    { type: "body", parameters: m.variables.map((t) => ({ type: "text", text: t })) },
  ];
  if (m.codigoCupon) {
    if (!/^[A-Za-z0-9-]{1,20}$/.test(m.codigoCupon)) return { ok: false, error: "cupon_invalido" };
    components.push({ type: "button", sub_type: "copy_code", index: 0, parameters: [{ type: "coupon_code", coupon_code: m.codigoCupon }] });
  }
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp", recipient_type: "individual", to: m.destino, type: "template",
    template: { name: plantilla, language: { code: idioma }, components },
  };
  if (c.bizOpaque && m.referencia && /^[A-Za-z0-9._:=+/-]{1,200}$/.test(m.referencia)) body.biz_opaque_callback_data = m.referencia;
  return { ok: true, body };
}

const TRANSITORIOS = new Set([2, 4, 130429, 131000, 131016, 131056]);

/** Respuesta HTTP de Meta → resultado. Sin respuesta legible o 5xx sin código = incierto. */
export function clasificarRespuestaCloud(status: number, json: unknown): ResultadoEnvio {
  const j = (json && typeof json === "object" ? json : {}) as {
    messages?: { id?: unknown; message_status?: unknown }[]; error?: { code?: unknown; message?: unknown; error_subcode?: unknown };
  };
  if (status >= 200 && status < 300) {
    const id = j.messages?.[0]?.id;
    if (typeof id === "string" && /^[A-Za-z0-9._:=+/-]{1,200}$/.test(id)) {
      const estado = j.messages?.[0]?.message_status;
      return { ok: true, wamid: id, repetido: false, ...(typeof estado === "string" && /^[a-z_]{1,40}$/.test(estado) ? { estadoMeta: estado } : {}) };
    }
    return { ok: false, codigo: "respuesta_sin_id", transitorio: false, incierto: true, detalle: "La API respondió OK sin un id de mensaje: no se sabe si salió." };
  }
  const code = typeof j.error?.code === "number" ? j.error.code : null;
  const detalle = typeof j.error?.message === "string" ? j.error.message.slice(0, 200) : `HTTP ${status}`;
  if (code === null) {
    if (status >= 500) return { ok: false, codigo: `http_${status}`, transitorio: false, incierto: true, detalle };
    return { ok: false, codigo: `http_${status}`, transitorio: false, detalle };
  }
  if (code === 1) return { ok: false, codigo: "1", transitorio: false, incierto: true, detalle };
  if (TRANSITORIOS.has(code)) return { ok: false, codigo: String(code), transitorio: true, detalle };
  return { ok: false, codigo: String(code), transitorio: false, detalle };
}

export type Transporte = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Proveedor de la Cloud API. `transporte` es el fetch (las pruebas lo
 * interceptan); `entorno` se lee en CADA envío, así apagar el bloqueo corta en
 * el acto.
 */
export function crearProveedorCloud(o: { transporte?: Transporte; entorno?: () => Entorno; tiempoMs?: number } = {}): ProveedorWhatsapp {
  const transporte: Transporte = o.transporte ?? ((u, i) => globalThis.fetch(u, i));
  const entorno = o.entorno ?? (() => process.env);
  const tiempo = o.tiempoMs ?? TIEMPO_CLOUD_MS;
  return {
    nombre: "cloud",
    async enviarPlantilla(m) {
      const bloqueo = evaluarEnvioReal(entorno());
      if (!bloqueo.ok) return { ok: false, codigo: CODIGO_ENVIO_REAL_BLOQUEADO, transitorio: false, detalle: bloqueo.motivo };
      const pedido = armarPedidoPlantilla(m, bloqueo.config);
      if (!pedido.ok) return { ok: false, codigo: pedido.error, transitorio: false, detalle: "Pedido inválido: no se envió." };
      const url = `${GRAPH_HOST}/${bloqueo.config.version}/${bloqueo.config.phoneNumberId}/${bloqueo.config.endpoint}`;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), tiempo);
      let res: Response;
      try {
        res = await transporte(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${bloqueo.config.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(pedido.body),
          signal: ctl.signal,
        });
      } catch (e) {
        // Sin respuesta: el pedido pudo haber llegado. Incierto, nunca "falló".
        const abortado = e instanceof Error && e.name === "AbortError";
        return { ok: false, codigo: abortado ? "tiempo_agotado" : "sin_respuesta", transitorio: false, incierto: true,
          detalle: abortado ? `Sin respuesta en ${tiempo} ms.` : "Error de red sin respuesta." };
      } finally {
        clearTimeout(t);
      }
      const json = await res.json().catch(() => null);
      if (json === null && res.ok) {
        return { ok: false, codigo: "respuesta_ilegible", transitorio: false, incierto: true, detalle: "La API respondió OK con un cuerpo ilegible." };
      }
      return clasificarRespuestaCloud(res.status, json);
    },
  };
}

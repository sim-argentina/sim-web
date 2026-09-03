import type { IAProvider, GenerarParams, TurnoProveedor, LlamadaHerramienta, WebTurno, AnalizarVisualParams, ResultadoVisual } from "@/lib/ia/provider";
import { IAProviderError } from "@/lib/ia/provider";
import { normalizarUrl, dominioDe, recortarFragmento, dedupFuentesWeb, type FuenteWeb } from "@/lib/ia/web/fuentes";

// Proveedor Anthropic vía la API OFICIAL de Claude (no automatiza el sitio web ni
// reutiliza cookies/suscripción Pro). La API key se lee del entorno server-side y
// NUNCA se loguea ni se serializa en errores.

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_PAUSE_TURNS = 4; // tope de continuaciones por pause_turn (evita loops)

// Usage real de Anthropic. Los tokens de caché son tokens de ENTRADA facturables:
// se suman a tokensIn para que el consumo total sea exacto (no cero).
export type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
export function usoDesde(u: Usage | undefined): { tokensIn: number; tokensOut: number } {
  const uu = u ?? {};
  return {
    tokensIn: (uu.input_tokens ?? 0) + (uu.cache_creation_input_tokens ?? 0) + (uu.cache_read_input_tokens ?? 0),
    tokensOut: uu.output_tokens ?? 0,
  };
}

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

function traducirHistorial(historial: GenerarParams["historial"]): Array<{ role: "user" | "assistant"; content: unknown[] }> {
  const msgs: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];
  for (const t of historial) {
    if (t.rol === "user") {
      msgs.push({ role: "user", content: [{ type: "text", text: t.texto }] });
    } else if (t.rol === "assistant") {
      // Si el turno conserva los bloques CRUDOS del proveedor (con server_tool_use /
      // web_search_tool_result / citas cifradas), se replican VERBATIM para continuar
      // el turno sin perder contexto ni duplicar búsquedas.
      if (Array.isArray(t.rawContent) && t.rawContent.length > 0) {
        msgs.push({ role: "assistant", content: t.rawContent });
        continue;
      }
      const content: Bloque[] = [];
      if (t.texto) content.push({ type: "text", text: t.texto });
      for (const l of t.llamadas ?? []) content.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.input });
      if (content.length === 0) content.push({ type: "text", text: "" });
      msgs.push({ role: "assistant", content });
    } else {
      msgs.push({ role: "user", content: t.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.contenido })) });
    }
  }
  return msgs;
}

// Bloque de respuesta de Anthropic (incluye server_tool_use, web_search_tool_result y citas).
type BloqueResp = {
  type: string;
  text?: string;
  id?: string; name?: string; input?: Record<string, unknown>;
  content?: unknown; // web_search_tool_result: array de resultados o error
  citations?: Array<{ type?: string; url?: string; title?: string; cited_text?: string }>;
  error_code?: string;
};
type RespuestaMensajes = {
  content?: BloqueResp[];
  usage?: Usage & { server_tool_use?: { web_search_requests?: number } };
  stop_reason?: string;
};

// Extrae las fuentes web (citas + resultados) de una lista de bloques, sin exponer
// tokens del proveedor (encrypted_index / encrypted_content se descartan).
function fuentesDeBloques(bloques: BloqueResp[]): { fuentes: FuenteWeb[]; error?: string } {
  const porUrl = new Map<string, FuenteWeb>();
  let orden = 0;
  let error: string | undefined;
  const put = (rawUrl: unknown, extra: Partial<FuenteWeb>) => {
    const url = normalizarUrl(rawUrl);
    if (!url) return;
    const prev = porUrl.get(url);
    if (prev) { porUrl.set(url, { ...prev, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)) }); return; }
    porUrl.set(url, { url, dominio: dominioDe(url), orden: orden++, ...extra });
  };
  for (const b of bloques) {
    if (b.type === "web_search_tool_result") {
      const c = b.content;
      if (c && typeof c === "object" && !Array.isArray(c) && (c as { type?: string }).type === "web_search_tool_result_error") {
        error = String((c as { error_code?: string }).error_code || "web_search_error");
      } else if (Array.isArray(c)) {
        for (const r of c as Array<Record<string, unknown>>) {
          put(r.url, { titulo: typeof r.title === "string" ? r.title : undefined, fecha_pagina: typeof r.page_age === "string" ? r.page_age : undefined });
        }
      }
    } else if (b.type === "text" && Array.isArray(b.citations)) {
      const claim = recortarFragmento(b.text, 200);
      for (const cit of b.citations) {
        if (!cit || (cit.type && cit.type !== "web_search_result_location")) continue;
        put(cit.url, { titulo: cit.title || undefined, fragmento: recortarFragmento(cit.cited_text), claim });
      }
    }
  }
  return { fuentes: dedupFuentesWeb([...porUrl.values()]), error };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class AnthropicProvider implements IAProvider {
  nombre = "anthropic";
  // fetchImpl inyectable SOLO para tests (simular respuestas de Anthropic sin red).
  constructor(private apiKey: string, private fetchImpl?: FetchLike) {}

  private async postMensajes(body: unknown, timeoutMs: number): Promise<RespuestaMensajes> {
    const doFetch = this.fetchImpl ?? (fetch as unknown as FetchLike);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new IAProviderError((e as Error)?.name === "AbortError" ? "El proveedor tardó demasiado (timeout)." : "No se pudo contactar al proveedor de IA.");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // Solo el status; nunca el cuerpo (podría reflejar datos sensibles). 400 por herramienta
      // deshabilitada/incompatible se propaga como IAProviderError (no se oculta).
      throw new IAProviderError(`El proveedor de IA respondió con estado ${res.status}.`, res.status === 429 ? 429 : res.status === 400 ? 400 : 502);
    }
    return (await res.json()) as RespuestaMensajes;
  }

  async generar(params: GenerarParams): Promise<TurnoProveedor> {
    const tools: unknown[] = params.herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.schema }));
    // Herramienta oficial de búsqueda web (server tool). La ejecuta Anthropic inline.
    // Localizada en Córdoba (acota resultados) y, si el modelo/config lo permiten,
    // response_inclusion:"excluded" para no reenviar los bloques brutos.
    if (params.webSearch?.habilitado) {
      const w: Record<string, unknown> = { type: params.webSearch.version, name: "web_search", max_uses: params.webSearch.maxUsos };
      if (params.webSearch.ubicacion) w.user_location = params.webSearch.ubicacion;
      if (params.webSearch.responseInclusionExcluded) w.response_inclusion = "excluded";
      tools.push(w);
    }
    const messages = traducirHistorial(params.historial);
    const inicio = Date.now();

    let tokensIn = 0, tokensOut = 0, searchRequests = 0;
    const bloquesWeb: BloqueResp[] = [];
    const consultasWeb: string[] = [];
    let ultimoContent: BloqueResp[] = [];
    let stop = "";

    // Loop de pause_turn: Anthropic pausa un turno con server tools de larga duración.
    // Se re-envía el contenido del asistente VERBATIM (con bloques cifrados) hasta cerrar.
    for (let i = 0; i < MAX_PAUSE_TURNS; i++) {
      const restante = Math.max(1000, params.timeoutMs - (Date.now() - inicio));
      const body = { model: params.modelo, max_tokens: params.maxTokensSalida, system: params.system, messages, tools };
      const json = await this.postMensajes(body, restante);
      const uso = usoDesde(json.usage);
      tokensIn += uso.tokensIn; tokensOut += uso.tokensOut;
      searchRequests += Number(json.usage?.server_tool_use?.web_search_requests ?? 0) || 0;
      ultimoContent = json.content ?? [];
      for (const b of ultimoContent) {
        if (b.type === "web_search_tool_result" || (b.type === "text" && b.citations)) bloquesWeb.push(b);
        if (b.type === "server_tool_use" && b.name === "web_search" && typeof b.input?.query === "string") consultasWeb.push(b.input.query as string);
      }
      stop = String(json.stop_reason ?? "");
      if (stop === "pause_turn") { messages.push({ role: "assistant", content: ultimoContent }); continue; }
      break;
    }

    const uso = { tokensIn, tokensOut };
    const usoWeb = params.webSearch?.habilitado || bloquesWeb.length > 0;
    let web: WebTurno | undefined;
    if (usoWeb) {
      const { fuentes, error } = fuentesDeBloques(bloquesWeb);
      // Solo se reportan como facturables las que Anthropic contó (los errores no facturables no suman).
      web = { busquedasFacturables: searchRequests, fuentes, error, consultas: consultasWeb };
    }

    const llamadas: LlamadaHerramienta[] = ultimoContent.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, nombre: b.name!, input: (b.input ?? {}) as Record<string, unknown> }));
    const texto = ultimoContent.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();

    if (llamadas.length > 0) return { tipo: "herramientas", texto: texto || undefined, llamadas, uso, web, rawContent: ultimoContent, stopReason: stop };
    return { tipo: "texto", texto, uso, web, rawContent: ultimoContent, stopReason: stop };
  }

  // OCR / visión: envía imágenes o un PDF (document) y pide un JSON estructurado.
  async analizarVisual(params: AnalizarVisualParams): Promise<ResultadoVisual> {
    const bloques = params.contenidos.map((c) =>
      c.tipo === "imagen"
        ? { type: "image", source: { type: "base64", media_type: c.media_type, data: c.dataBase64 } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: c.dataBase64 } }
    );
    const body = {
      model: params.modelo,
      max_tokens: params.maxTokensSalida,
      system: params.instruccion,
      messages: [{ role: "user", content: [...bloques, { type: "text", text: "Respondé ÚNICAMENTE con un objeto JSON válido (sin texto adicional) con las claves: texto_detectado (string), descripcion_visual (string), tablas (string), confianza ('alta'|'media'|'baja'), advertencias (string[]), paginas_o_imagenes (number)." }] }],
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), params.timeoutMs);
    let res: Response;
    try {
      res = await fetch(API_URL, { method: "POST", headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": ANTHROPIC_VERSION }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw new IAProviderError((e as Error)?.name === "AbortError" ? "El análisis visual tardó demasiado (timeout)." : "No se pudo contactar al proveedor de IA.");
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      throw new IAProviderError(res.status === 400 ? "El modelo no pudo procesar este archivo (formato no soportado por visión)." : `El proveedor respondió con estado ${res.status}.`, res.status === 429 ? 429 : 502);
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }>; usage?: Usage };
    const uso = usoDesde(json.usage);
    const texto = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
    return parsearResultadoVisual(texto, uso);
  }
}

function parsearResultadoVisual(texto: string, uso: ResultadoVisual["uso"]): ResultadoVisual {
  const m = texto.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as Record<string, unknown>;
      const conf = o.confianza === "alta" || o.confianza === "media" || o.confianza === "baja" ? o.confianza : "media";
      return {
        texto_detectado: String(o.texto_detectado ?? ""),
        descripcion_visual: String(o.descripcion_visual ?? ""),
        tablas: String(o.tablas ?? ""),
        confianza: conf,
        advertencias: Array.isArray(o.advertencias) ? o.advertencias.map(String) : [],
        paginas_o_imagenes: Number(o.paginas_o_imagenes) || 1,
        uso,
      };
    } catch { /* cae abajo */ }
  }
  // Respuesta no estructurada: se conserva cruda y se marca baja confianza para revisión.
  return { texto_detectado: texto, descripcion_visual: "", tablas: "", confianza: "baja", advertencias: ["La respuesta del modelo no fue un JSON válido; revisá el contenido."], paginas_o_imagenes: 1, uso, crudo: texto };
}

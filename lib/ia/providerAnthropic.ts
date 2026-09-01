import type { IAProvider, GenerarParams, TurnoProveedor, LlamadaHerramienta, AnalizarVisualParams, ResultadoVisual } from "@/lib/ia/provider";
import { IAProviderError } from "@/lib/ia/provider";

// Proveedor Anthropic vía la API OFICIAL de Claude (no automatiza el sitio web ni
// reutiliza cookies/suscripción Pro). La API key se lee del entorno server-side y
// NUNCA se loguea ni se serializa en errores.

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

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

function traducirHistorial(historial: GenerarParams["historial"]): Array<{ role: "user" | "assistant"; content: Bloque[] }> {
  const msgs: Array<{ role: "user" | "assistant"; content: Bloque[] }> = [];
  for (const t of historial) {
    if (t.rol === "user") {
      msgs.push({ role: "user", content: [{ type: "text", text: t.texto }] });
    } else if (t.rol === "assistant") {
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

export class AnthropicProvider implements IAProvider {
  nombre = "anthropic";
  constructor(private apiKey: string) {}

  async generar(params: GenerarParams): Promise<TurnoProveedor> {
    const body = {
      model: params.modelo,
      max_tokens: params.maxTokensSalida,
      system: params.system,
      messages: traducirHistorial(params.historial),
      tools: params.herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.schema })),
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), params.timeoutMs);
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      // No incluir la key ni el request en el mensaje de error.
      throw new IAProviderError((e as Error)?.name === "AbortError" ? "El proveedor tardó demasiado (timeout)." : "No se pudo contactar al proveedor de IA.");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // Solo el status; nunca el cuerpo (podría reflejar datos sensibles).
      throw new IAProviderError(`El proveedor de IA respondió con estado ${res.status}.`, res.status === 429 ? 429 : 502);
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage?: Usage;
      stop_reason?: string;
    };
    const uso = usoDesde(json.usage);
    const bloques = json.content ?? [];
    const llamadas: LlamadaHerramienta[] = bloques.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, nombre: b.name!, input: (b.input ?? {}) as Record<string, unknown> }));
    const texto = bloques.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();

    if (llamadas.length > 0) return { tipo: "herramientas", texto: texto || undefined, llamadas, uso };
    return { tipo: "texto", texto, uso };
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

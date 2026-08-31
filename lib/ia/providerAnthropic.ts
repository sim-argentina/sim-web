import type { IAProvider, GenerarParams, TurnoProveedor, LlamadaHerramienta } from "@/lib/ia/provider";
import { IAProviderError } from "@/lib/ia/provider";

// Proveedor Anthropic vía la API OFICIAL de Claude (no automatiza el sitio web ni
// reutiliza cookies/suscripción Pro). La API key se lee del entorno server-side y
// NUNCA se loguea ni se serializa en errores.

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

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
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    const uso = { tokensIn: json.usage?.input_tokens ?? 0, tokensOut: json.usage?.output_tokens ?? 0 };
    const bloques = json.content ?? [];
    const llamadas: LlamadaHerramienta[] = bloques.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, nombre: b.name!, input: (b.input ?? {}) as Record<string, unknown> }));
    const texto = bloques.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();

    if (llamadas.length > 0) return { tipo: "herramientas", texto: texto || undefined, llamadas, uso };
    return { tipo: "texto", texto, uso };
  }
}

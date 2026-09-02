import { strict as assert } from "node:assert";
import { AnthropicProvider, type FetchLike } from "@/lib/ia/providerAnthropic";
import { IAProviderError, type GenerarParams } from "@/lib/ia/provider";

// Ejecutar: npx tsx lib/ia/web/providerWeb.test.ts — sin red (fetch simulado).
// Simula respuestas REALES de la Messages API de Anthropic con búsqueda web.

function resp(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
function fetchSecuencia(responses: Response[]): FetchLike {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)];
}
const base: Omit<GenerarParams, "webSearch"> = { modelo: "claude-sonnet-5", system: "s", historial: [{ rol: "user", texto: "buscá X en internet" }], herramientas: [], maxTokensSalida: 500, timeoutMs: 5000 };
const web = { habilitado: true, maxUsos: 3, version: "web_search_20250305" };

async function main() {
  // ── Éxito: server_tool_use + web_search_tool_result (multi-fuente) + texto con citas ──
  const ok = new AnthropicProvider("k", fetchSecuencia([resp(200, {
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 2 } },
    content: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "simuladores cordoba" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [
        { type: "web_search_result", url: "https://ejemplo1.com/a", title: "Sim A", page_age: "2026-01-01", encrypted_content: "SECRETO" },
        { type: "web_search_result", url: "https://ejemplo2.com/b", title: "Sim B" },
      ] },
      { type: "text", text: "En Córdoba hay opciones.", citations: [{ type: "web_search_result_location", url: "https://ejemplo1.com/a", title: "Sim A", cited_text: "hay simuladores en Córdoba" }] },
    ],
  })]));
  const t1 = await ok.generar({ ...base, webSearch: web });
  assert.equal(t1.tipo, "texto", "responde texto");
  assert.ok(t1.web, "trae web");
  assert.equal(t1.web!.busquedasFacturables, 2, "2 búsquedas facturables (de usage)");
  assert.ok(t1.web!.fuentes.length >= 2, "múltiples fuentes");
  assert.equal(t1.web!.fuentes[0].dominio, "ejemplo1.com", "dominio extraído");
  assert.ok(t1.web!.fuentes.find((f) => f.fragmento?.includes("simuladores")), "cita con fragmento");
  assert.ok(t1.web!.consultas?.includes("simuladores cordoba"), "consulta capturada");
  assert.ok(!JSON.stringify(t1.web).includes("SECRETO"), "no filtra encrypted_content");
  if (t1.tipo === "texto") assert.equal(t1.texto, "En Córdoba hay opciones.", "texto final");

  // ── Resultado VACÍO ──────────────────────────────────────────────────────────
  const vacio = new AnthropicProvider("k", fetchSecuencia([resp(200, {
    stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
    content: [{ type: "web_search_tool_result", tool_use_id: "s1", content: [] }, { type: "text", text: "No encontré resultados." }],
  })]));
  const t2 = await vacio.generar({ ...base, webSearch: web });
  assert.equal(t2.web!.fuentes.length, 0, "sin fuentes");
  assert.equal(t2.web!.busquedasFacturables, 1, "cuenta la búsqueda");

  // ── ERROR dentro de HTTP 200 (web_search_tool_result_error) ──────────────────
  const err200 = new AnthropicProvider("k", fetchSecuencia([resp(200, {
    stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 0 } },
    content: [{ type: "web_search_tool_result", tool_use_id: "s1", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }, { type: "text", text: "Límite de búsquedas." }],
  })]));
  const t3 = await err200.generar({ ...base, webSearch: web });
  assert.equal(t3.web!.error, "max_uses_exceeded", "error normalizado dentro de 200");
  assert.equal(t3.web!.busquedasFacturables, 0, "error no facturable no suma");

  // ── 400 (herramienta deshabilitada/incompatible) → NO se oculta ──────────────
  const e400 = new AnthropicProvider("k", fetchSecuencia([resp(400, { error: "web search disabled" })]));
  await assert.rejects(() => e400.generar({ ...base, webSearch: web }), (e) => e instanceof IAProviderError && e.status === 400, "400 propaga status 400");

  // ── 429 (too_many_requests) ──────────────────────────────────────────────────
  const e429 = new AnthropicProvider("k", fetchSecuencia([resp(429, { error: "rate" })]));
  await assert.rejects(() => e429.generar({ ...base, webSearch: web }), (e) => e instanceof IAProviderError && e.status === 429, "429 propaga status 429");

  // ── Timeout (AbortError) ─────────────────────────────────────────────────────
  const eTimeout = new AnthropicProvider("k", async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
  await assert.rejects(() => eTimeout.generar({ ...base, webSearch: web }), (e) => e instanceof IAProviderError, "timeout → IAProviderError");

  // ── pause_turn: continuación correcta acumulando búsquedas ───────────────────
  const pausa = new AnthropicProvider("k", fetchSecuencia([
    resp(200, { stop_reason: "pause_turn", usage: { input_tokens: 20, output_tokens: 10, server_tool_use: { web_search_requests: 1 } }, content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "parte 1" } }] }),
    resp(200, { stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 10, server_tool_use: { web_search_requests: 1 } }, content: [{ type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://c.com", title: "C" }] }, { type: "text", text: "listo" }] }),
  ]));
  const t4 = await pausa.generar({ ...base, webSearch: web });
  assert.equal(t4.web!.busquedasFacturables, 2, "pause_turn acumula búsquedas de ambas partes");
  assert.equal(t4.web!.fuentes.length, 1, "fuente de la continuación");
  assert.equal(t4.uso.tokensIn, 40, "tokens acumulados de ambas partes");
  if (t4.tipo === "texto") assert.equal(t4.texto, "listo", "texto de la parte final");

  // ── Mixto: herramienta INTERNA (tool_use) + web en el mismo turno ────────────
  const mixto = new AnthropicProvider("k", fetchSecuencia([resp(200, {
    stop_reason: "tool_use", usage: { input_tokens: 30, output_tokens: 15, server_tool_use: { web_search_requests: 1 } },
    content: [
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://d.com", title: "D" }] },
      { type: "text", text: "Consulto finanzas y comparo." },
      { type: "tool_use", id: "u1", name: "consultar_finanzas", input: { anio: 2026, mes: 8 } },
    ],
  })]));
  const t5 = await mixto.generar({ ...base, webSearch: web });
  assert.equal(t5.tipo, "herramientas", "pide herramienta interna");
  if (t5.tipo === "herramientas") { assert.equal(t5.llamadas[0].nombre, "consultar_finanzas", "llamada interna"); }
  assert.equal(t5.web!.fuentes.length, 1, "web y herramienta interna conviven");
  assert.ok(Array.isArray(t5.rawContent) && t5.rawContent.length === 3, "conserva bloques crudos para continuar");

  console.log("OK — providerWeb: éxito+multi-fuente+citas (2 búsquedas, sin filtrar cifrados), vacío, error-en-200 (no facturable), 400 y 429 propagados, timeout, pause_turn (acumula y continúa), interno+web mixto (rawContent conservado).");
}
main().catch((e) => { console.error(e); process.exit(1); });

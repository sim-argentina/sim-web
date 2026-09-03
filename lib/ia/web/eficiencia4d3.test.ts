import { strict as assert } from "node:assert";
import { reconciliarConsumo } from "@/lib/ia/creditos/reconciliar";
import { capacidadesWeb, UBICACION_BUSQUEDA } from "@/lib/ia/web/capacidades";
import { AnthropicProvider, type FetchLike } from "@/lib/ia/providerAnthropic";
import type { GenerarParams } from "@/lib/ia/provider";

// Ejecutar: npx tsx lib/ia/web/eficiencia4d3.test.ts — puro, sin red.

function main() {
  // ── §14.A Reconciliación exacta del consumo observado ─────────────────────────
  // Valores AUDITADOS de las dos pruebas competitivas reales (12d175ed + 79270243).
  const AUDITADO = [
    { tokens_in: 71218, tokens_out: 2185, costo_estimado: "0.10214300000000001", proveedor: "anthropic" }, // 4D.1
    { tokens_in: 64478, tokens_out: 4249, costo_estimado: "0.267169", proveedor: "anthropic" },             // 4D.2
    { tokens_in: 999, tokens_out: 999, costo_estimado: "9.99", proveedor: "fake" },                          // fake: excluido
  ];
  const rec = reconciliarConsumo(AUDITADO);
  assert.equal(rec.tokens, 142130, "142.130 tokens = suma de las dos ejecuciones reales");
  assert.equal(rec.tokensIn, 135696, "135.696 tokens de entrada");
  assert.equal(rec.tokensOut, 6434, "6.434 tokens de salida");
  assert.equal(rec.costoUsd, 0.369312, "US$0,369312 ≈ US$0,3693");
  assert.equal(rec.incluidas, 2, "fake excluido");

  // ── §14.C Matriz de capacidades por modelo (defaults seguros) ────────────────
  delete process.env.IA_WEB_VERSION_MODERNA;
  assert.equal(capacidadesWeb("claude-sonnet-5").version, "web_search_20250305", "default básico para sonnet-5");
  assert.equal(capacidadesWeb("claude-haiku-4-5-20251001").filtradoDinamico, false, "haiku sin filtrado dinámico por defecto");
  assert.equal(capacidadesWeb("modelo-futuro-desconocido").version, "web_search_20250305", "modelo desconocido → básico (fallback)");
  // Con versión moderna CONFIGURADA + modelo habilitado → se activa; otros siguen básicos.
  process.env.IA_WEB_VERSION_MODERNA = "web_search_20260318";
  process.env.IA_WEB_RESPONSE_EXCLUDED = "1";
  process.env.IA_WEB_MODELOS_MODERNOS = "claude-sonnet-5";
  assert.equal(capacidadesWeb("claude-sonnet-5").version, "web_search_20260318", "sonnet-5 usa moderna si está configurada");
  assert.equal(capacidadesWeb("claude-sonnet-5").responseInclusionExcluded, true, "response_inclusion excluded activado");
  assert.equal(capacidadesWeb("claude-haiku-4-5-20251001").version, "web_search_20250305", "haiku NO habilitado → básico");
  delete process.env.IA_WEB_VERSION_MODERNA; delete process.env.IA_WEB_RESPONSE_EXCLUDED; delete process.env.IA_WEB_MODELOS_MODERNOS;

  console.log("OK — eficiencia4d3 (puro): reconciliación 142.130 tok / US$0,369312 (fake excluido, caché una vez); matriz de capacidades (default básico, moderna solo con config explícita, modelo desconocido → fallback).");
}

async function contratoProveedor() {
  // ── §14.B/§5 Contrato: la config del tool web incluye localización y, si corresponde,
  // response_inclusion "excluded"; sin filtrar cifrados en la respuesta. ─────────────────
  let bodyBasica: unknown;
  const capBasica: FetchLike = async (_u, init) => { bodyBasica = JSON.parse(String(init.body)); return { ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } }, content: [{ type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", url: "https://x.com", title: "X", encrypted_content: "SECRETO" }] }, { type: "text", text: "ok" }] }) } as unknown as Response; };
  const base: GenerarParams = { modelo: "claude-sonnet-5", system: "s", historial: [{ rol: "user", texto: "buscá" }], herramientas: [], maxTokensSalida: 500, timeoutMs: 5000 };
  const p = new AnthropicProvider("k", capBasica);
  const t = await p.generar({ ...base, webSearch: { habilitado: true, maxUsos: 1, version: "web_search_20250305", ubicacion: UBICACION_BUSQUEDA } });
  const tools = (bodyBasica as { tools: Array<Record<string, unknown>> }).tools;
  const web = tools.find((x) => x.name === "web_search")!;
  assert.equal(web.type, "web_search_20250305", "versión básica enviada");
  assert.ok(web.user_location, "localización enviada (Córdoba)");
  assert.equal((web.user_location as { city: string }).city, "Córdoba", "ciudad Córdoba");
  assert.ok(!("response_inclusion" in web), "sin response_inclusion en versión básica");
  assert.ok(!JSON.stringify(t.web).includes("SECRETO"), "no filtra encrypted_content");

  // Con response_inclusion excluded → se envía.
  let bodyMod: unknown;
  const capMod: FetchLike = async (_u, init) => { bodyMod = JSON.parse(String(init.body)); return { ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "ok" }] }) } as unknown as Response; };
  const p2 = new AnthropicProvider("k", capMod);
  await p2.generar({ ...base, webSearch: { habilitado: true, maxUsos: 1, version: "web_search_20260318", responseInclusionExcluded: true, ubicacion: UBICACION_BUSQUEDA } });
  const web2 = (bodyMod as { tools: Array<Record<string, unknown>> }).tools.find((x) => x.name === "web_search")!;
  assert.equal(web2.type, "web_search_20260318", "versión moderna enviada");
  assert.equal(web2.response_inclusion, "excluded", "response_inclusion excluded enviado");

  console.log("OK — eficiencia4d3 (contrato proveedor): tool web con localización Córdoba, response_inclusion solo cuando corresponde, sin filtrar contenido cifrado.");
}

main();
contratoProveedor().catch((e) => { console.error(e); process.exit(1); });

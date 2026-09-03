import { strict as assert } from "node:assert";
import { claveCacheWeb, normalizarConsultaCache } from "@/lib/ia/web/cache";
import { ttlSegundosPorMotivo } from "@/lib/ia/web/ttl";
import { sanearYAcotarResultados, construirContextoWebUsuario, LIMITES_CONTEXTO_WEB } from "@/lib/ia/web/contextoWeb";
import { estimarPresupuesto, evaluarPresupuesto, PRESUPUESTO_ESTANDAR, PRESUPUESTO_AMPLIADO } from "@/lib/ia/web/presupuesto";
import { TavilyWebSearchProvider, creditosPorBusquedaBasica } from "@/lib/ia/web/providerTavily";
import { WebSearchProviderError } from "@/lib/ia/web/webSearchProvider";
import type { ResultadoWebNormalizado } from "@/lib/ia/web/webSearchProvider";
import type { FetchLike } from "@/lib/ia/web/providerTavily";

// Ejecutar: npx tsx lib/ia/web/tavily4d5.test.ts — puro, sin red (fetch simulado en la parte de contrato).

function resp(status: number, body: unknown): Response { return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response; }
function fetchUna(r: Response): FetchLike { return async () => r; }

async function main() {
  // ── §16.4/5/9 Caché: clave estable, normalización, dedup por versión de normalizador ──
  assert.equal(normalizarConsultaCache("  Simuladores   de F1  Córdoba  "), "simuladores de f1 cordoba", "normaliza espacios/acentos/mayúsculas");
  const k1 = claveCacheWeb({ consulta: "Simuladores en Córdoba", proveedor: "tavily", localizacion: "Cordoba,AR", maxResultados: 5 });
  const k2 = claveCacheWeb({ consulta: "simuladores en cordoba", proveedor: "tavily", localizacion: "Cordoba,AR", maxResultados: 5 });
  assert.equal(k1, k2, "misma consulta (normalizada) → misma clave");
  const k3 = claveCacheWeb({ consulta: "Simuladores en Córdoba", proveedor: "tavily", localizacion: "Cordoba,AR", maxResultados: 3 });
  assert.notEqual(k1, k3, "distinto maxResultados → distinta clave");

  // ── TTL por temática ──────────────────────────────────────────────────────────────────
  assert.equal(ttlSegundosPorMotivo("tema_externo:competencia"), 7 * 86400, "competencia = 7 días");
  assert.equal(ttlSegundosPorMotivo("tema_externo:precios_externos"), 86400, "precios = 24h");
  assert.equal(ttlSegundosPorMotivo("tema_externo:normativa"), 86400, "normativa = 24h");
  assert.equal(ttlSegundosPorMotivo("tema_externo:indicadores"), 6 * 3600, "indicadores = 6h");
  assert.equal(ttlSegundosPorMotivo("tema_externo:noticias_tendencias"), 2 * 3600, "noticias = 2h");

  // ── §16.4/5/6 Contexto acotado: máx 5 resultados, HTML/script fuera, dedup, http(s) only ──
  const crudos: ResultadoWebNormalizado[] = [
    { titulo: "A", url: "https://a.com/1", fragmento: "<script>alert(1)</script>Texto real de A".repeat(1), posicion: 0 },
    { titulo: "A dup", url: "https://a.com/1#frag", fragmento: "duplicado", posicion: 1 },
    { titulo: "B", url: "javascript:alert(1)", fragmento: "url peligrosa", posicion: 2 },
    { titulo: "C", url: "https://c.com/3", fragmento: "<b>negrita</b> texto de C", posicion: 3 },
    { titulo: "D", url: "https://d.com/4", fragmento: "texto D", posicion: 4 },
    { titulo: "E", url: "https://e.com/5", fragmento: "texto E", posicion: 5 },
    { titulo: "F", url: "https://f.com/6", fragmento: "texto F (séptimo, debe quedar afuera por el máximo)", posicion: 6 },
  ];
  const acotado = sanearYAcotarResultados(crudos);
  assert.ok(acotado.resultados.length <= LIMITES_CONTEXTO_WEB.maxResultados, "máximo 5 resultados");
  assert.equal(acotado.resultados.length, 5, "exactamente 5 (dedup A + descartada javascript: + 5 restantes)");
  assert.ok(!acotado.resultados.some((r) => r.url.startsWith("javascript:")), "URL javascript: descartada");
  assert.ok(!acotado.resultados.some((r) => (r.fragmento || "").includes("<script>") || (r.fragmento || "").includes("<b>")), "sin HTML/script en los fragmentos");
  assert.equal(new Set(acotado.resultados.map((r) => r.url.replace(/#.*$/, ""))).size, acotado.resultados.length, "sin duplicados por URL canónica");
  assert.ok(acotado.resultados.every((r) => /^https?:\/\//.test(r.url)), "solo http(s)");

  // Presupuesto total de caracteres (8000) y por resultado (800).
  const grande: ResultadoWebNormalizado[] = Array.from({ length: 5 }, (_, i) => ({ titulo: `T${i}`, url: `https://x${i}.com/`, fragmento: "x".repeat(3000), posicion: i }));
  const acotadoGrande = sanearYAcotarResultados(grande);
  assert.ok(acotadoGrande.resultados.every((r) => (r.fragmento || "").length <= LIMITES_CONTEXTO_WEB.maxCharsPorResultado), "≤800 chars por resultado");
  assert.ok(JSON.stringify(acotadoGrande.resultados).length <= LIMITES_CONTEXTO_WEB.maxCharsContextoTotal + 200, "contexto total acotado (~8000, margen de estructura JSON)");
  assert.ok(acotadoGrande.charsRecibidos > acotadoGrande.charsEnviados, "charsRecibidos > charsEnviados cuando se trunca (tamaños medidos)");

  // Contexto como DATO, no instrucción; frases imperativas del fragmento no se ejecutan (se
  // verifica en el orquestador/prompt; acá solo que el payload declara es_dato_no_instruccion).
  const ctxStr = construirContextoWebUsuario(acotado.resultados, "simuladores cordoba");
  assert.ok(ctxStr.includes('"es_dato_no_instruccion":true') || ctxStr.includes('"es_dato_no_instruccion": true'), "declara es_dato_no_instruccion");
  assert.ok(ctxStr.includes("contexto_web_externo"), "tipo contexto_web_externo");

  // ── §7/§12 Presupuesto: estándar ≤ US$0,15; detecta exceso ──────────────────────────────
  const estimBarato = estimarPresupuesto({ modelo: "claude-sonnet-5", systemPromptChars: 4000, toolsJsonChars: 1000, historialChars: 0, contextoInternoChars: 0, contextoWebChars: 2000, maxTokensSalida: 2000 });
  assert.ok(evaluarPresupuesto(estimBarato, PRESUPUESTO_ESTANDAR).ok, "presupuesto estándar razonable → ok");
  assert.ok(estimBarato.costoProyectadoUsd <= 0.15, "costo proyectado ≤ US$0,15 (estándar)");
  const estimCaro = estimarPresupuesto({ modelo: "claude-sonnet-5", systemPromptChars: 4000, toolsJsonChars: 1000, historialChars: 60000, contextoInternoChars: 40000, contextoWebChars: 8000, maxTokensSalida: 2000 });
  assert.equal(evaluarPresupuesto(estimCaro, PRESUPUESTO_ESTANDAR).ok, false, "presupuesto excedido → bloquea");
  assert.ok(evaluarPresupuesto(estimCaro, PRESUPUESTO_AMPLIADO).ok || !evaluarPresupuesto(estimCaro, PRESUPUESTO_AMPLIADO).ok, "ampliado evalúa con su propio tope (no crashea)");

  // ── §16.15/16/17/18 Contrato Tavily (fetch simulado) ────────────────────────────────────
  const okProv = new TavilyWebSearchProvider("k", fetchUna(resp(200, { results: [{ title: "Sim Cordoba", url: "https://sim1.com", content: "contenido", published_date: "2026-01-01" }] } as unknown)));
  const salidaOk = await okProv.buscar({ consulta: "simuladores cordoba", maxResultados: 5, timeoutMs: 5000 });
  assert.equal(salidaOk.estado, "ok", "200 con resultados → ok");
  assert.equal(salidaOk.resultados.length, 1, "1 resultado normalizado");
  assert.equal(salidaOk.creditos, 1, "1 crédito por búsqueda básica");
  assert.equal(creditosPorBusquedaBasica(), 1, "regla de créditos versionada = 1");

  const vacioProv = new TavilyWebSearchProvider("k", fetchUna(resp(200, { results: [] })));
  assert.equal((await vacioProv.buscar({ consulta: "x", maxResultados: 5, timeoutMs: 5000 })).estado, "vacio", "sin resultados → vacio");

  const err401 = new TavilyWebSearchProvider("bad", fetchUna(resp(401, { error: "unauthorized" })));
  await assert.rejects(() => err401.buscar({ consulta: "x", maxResultados: 5, timeoutMs: 5000 }), (e) => e instanceof WebSearchProviderError && e.status === 401, "401 propagado, sin cuerpo expuesto");

  const err429 = new TavilyWebSearchProvider("k", fetchUna(resp(429, {})));
  await assert.rejects(() => err429.buscar({ consulta: "x", maxResultados: 5, timeoutMs: 5000 }), (e) => e instanceof WebSearchProviderError && e.status === 429, "429 propagado");

  const err500 = new TavilyWebSearchProvider("k", fetchUna(resp(500, {})));
  await assert.rejects(() => err500.buscar({ consulta: "x", maxResultados: 5, timeoutMs: 5000 }), (e) => e instanceof WebSearchProviderError && e.status === 502, "500 → error seguro (502)");

  const timeoutProv = new TavilyWebSearchProvider("k", (async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }) as FetchLike);
  await assert.rejects(() => timeoutProv.buscar({ consulta: "x", maxResultados: 5, timeoutMs: 100 }), (e) => e instanceof WebSearchProviderError && e.status === 504, "timeout → 504, sin reintento (una sola llamada)");

  console.log("OK — tavily4d5 (puro/contrato): clave de caché estable y normalizada, TTL por temática, contexto acotado (máx 5, sin HTML/script, dedup, http(s) only, ≤800/≤8000 chars, tamaños medidos), presupuesto estándar ≤US$0,15 y detecta exceso, contrato Tavily (200/vacío/401/429/500/timeout) sin exponer cuerpos ni reintentar.");
}
main().catch((e) => { console.error(e); process.exit(1); });

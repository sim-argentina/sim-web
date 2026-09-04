import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { FakeWebSearchProvider } from "@/lib/ia/web/providerWebFake";
import { claveCacheWeb } from "@/lib/ia/web/cache";
import { sanitizarConsultaWeb } from "@/lib/ia/web/sanitizar";
import { LIMITES_TAVILY } from "@/lib/ia/web/config";
import { NOMBRE_EMITIR_ANALISIS_WEB } from "@/lib/ia/web/analisisWebSchema";

// 4D.5.2 — desde esta corrección, una consulta mixta (con contexto web) va por el flujo
// ESTRUCTURADO (tool_choice forzado a emitir_analisis_web), no por texto libre. Este helper
// arma una llamada mínima válida (referencia RESULT[0] = "ext-1") para esos escenarios.
const emitirValido = (frase: string) => ({
  nombre: NOMBRE_EMITIR_ANALISIS_WEB,
  input: {
    respuesta_directa: frase, datos_internos_ids: [],
    actores_externos: [{ nombre: "Sim Cordoba (resultado externo)", evidencia: "Fuente externa encontrada.", fuente_ids: ["ext-1"], actividad_comparable: true, ubicacion_cordoba: true, vigencia_reciente: true, es_fabricante: false, es_red_nacional: false, es_evento: false }],
    comparacion: [], no_determinable: [], conclusion: "Sin datos suficientes para una comparación cuantitativa.",
  },
});

// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/web/servidor4d5.integration.ts
// ZZTEST (no toca datos reales). TAVILY_API_KEY debe estar AUSENTE del entorno real (se inyecta
// el proveedor web vía opts para no depender de la key real ni de red). La caché web es GLOBAL
// (correcto en producción); acá se limpia la clave del propio fixture antes/después.

const OWNER = "admin:zztest-4d5";
const RESULT = [{ titulo: "Sim Cordoba", url: "https://simexterno.com/a", dominio: "simexterno.com", fechaPublicada: "2026-01-01", fragmento: "Simuladores de auto en Córdoba.", posicion: 0 }];
const PREGUNTA_EXT_TXT = "Buscá qué experiencias de simulación de automovilismo existen actualmente en Córdoba";

async function limpiarCacheZZ() {
  const clave = claveCacheWeb({ consulta: sanitizarConsultaWeb(PREGUNTA_EXT_TXT, 300), proveedor: "tavily", localizacion: "Cordoba,AR", maxResultados: LIMITES_TAVILY.maxResultados });
  await supabaseAdmin.from("ia_web_cache").delete().eq("clave_hash", clave);
}

// Proveedor "veneno": si algo lo llama, la prueba de "Claude nunca se invoca" falla explícitamente.
class ProveedorVeneno {
  nombre = "veneno";
  async generar(): Promise<never> { throw new Error("NO DEBÍA LLAMARSE A CLAUDE en este escenario."); }
}

async function limpiar(id?: string) { if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id); await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER); await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER); }

async function nuevaConv(): Promise<string> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 4d5", estado: "activa" }).select("id").single();
  return data!.id as string;
}

async function main() {
  await limpiar();
  await limpiarCacheZZ();
  const convId = await nuevaConv();
  try {
    // ── 1) Interna: cero búsquedas Tavily, sin contexto web ──────────────────────────────
    const web1 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT }]);
    const p1 = new FakeProviderGuionado([{ tipo: "texto", texto: "Federico hizo 385 turnos." }]);
    const r1 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "¿Cuántos turnos hizo Federico en agosto de 2026?" }, { provider: p1, webProvider: web1 });
    assert.ok(r1.ok, "interna ok"); if (!r1.ok) return;
    assert.equal(web1.llamadas.length, 0, "consulta interna → cero búsquedas Tavily");
    assert.equal(r1.busquedasWeb ?? 0, 0, "sin búsquedas web");
    assert.equal(p1.ultimoWebSearch, undefined, "Anthropic web_search NUNCA ofrecida");

    // ── 2) Externa: UNA búsqueda Tavily, fuentes separadas interna/externa, sin web nativa ──
    const web2 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT }]);
    const p2 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [emitirValido("En Córdoba hay opciones de simulación de automovilismo.")] }]);
    const PREGUNTA_EXT = PREGUNTA_EXT_TXT;
    const r2 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: PREGUNTA_EXT, idempotencyKey: "zz-ext-1" }, { provider: p2, webProvider: web2 });
    assert.ok(r2.ok, "externa ok"); if (!r2.ok) return;
    assert.equal(web2.llamadas.length, 1, "una búsqueda Tavily (máximo estándar)");
    assert.equal(r2.busquedasWeb, 1, "1 búsqueda facturable");
    assert.equal(p2.ultimoWebSearch, undefined, "Anthropic web_search NUNCA ofrecida ni con contexto web activo");
    const { data: msg2 } = await supabaseAdmin.from("ia_mensajes").select("fuentes").eq("id", r2.mensajeId).single();
    const fuentes2 = (msg2!.fuentes as Array<{ tipo?: string; url?: string }>) ?? [];
    const externas2 = fuentes2.filter((f) => f.tipo === "externa");
    assert.equal(externas2.length, 1, "1 fuente externa persistida");
    assert.equal(externas2[0].url, "https://simexterno.com/a", "URL externa correcta");
    assert.ok(fuentes2.every((f) => f.tipo === "interna" || f.tipo === "externa"), "toda fuente clasificada interna o externa (nunca ambigua)");
    const { data: bwConv } = await supabaseAdmin.from("ia_busquedas_web").select("proveedor, cache_hit, creditos_busqueda").eq("conversacion_id", convId).order("created_at", { ascending: false }).limit(1).single();
    assert.equal(bwConv!.proveedor, "tavily", "proveedor auditado = tavily");
    assert.equal(bwConv!.cache_hit, false, "primera búsqueda no es cache hit");
    assert.equal(Number(bwConv!.creditos_busqueda), 1, "1 crédito Tavily auditado");

    // ── 3) Misma consulta de nuevo: CACHE HIT, cero búsquedas Tavily nuevas ──────────────
    const p3 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [emitirValido("En Córdoba hay opciones (respuesta con evidencia reutilizada).")] }]);
    const r3 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: PREGUNTA_EXT }, { provider: p3, webProvider: web2 });
    assert.ok(r3.ok, "repetición ok"); if (!r3.ok) return;
    assert.equal(web2.llamadas.length, 1, "SIGUE en 1: la 2ª vez usó caché, cero búsquedas nuevas");
    assert.equal(r3.busquedasWeb ?? 0, 0, "0 búsquedas facturables (cache hit)");
    assert.equal(r3.webCacheHit, true, "marca cache_hit=true");

    // ── 4) Doble clic / idempotencia: mismo key → duplicado, sin nueva búsqueda ──────────
    const web4 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT }]);
    const p4 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [emitirValido("otra vez")] }]);
    const r4 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: PREGUNTA_EXT, idempotencyKey: "zz-ext-1" }, { provider: p4, webProvider: web4 });
    assert.ok(r4.ok && (r4 as { duplicado?: boolean }).duplicado, "duplicado por idempotency_key");
    assert.equal(web4.llamadas.length, 0, "idempotencia: ni siquiera se intenta buscar de nuevo");

    console.log("OK — servidor4d5 (parte 1): interna sin Tavily y sin web nativa; externa con 1 búsqueda + fuentes separadas + auditoría (proveedor tavily, créditos); repetición usa caché (0 búsquedas nuevas); idempotencia no repite.");
  } finally {
    await limpiar(convId);
  }

  // ── 5) Tavily NO configurado: chat interno sigue funcionando, no llama a Claude para el
  //      intento externo, mensaje exacto, sin 500 ────────────────────────────────────────
  const conv2 = await nuevaConv();
  try {
    const r5 = await correrChat({ owner: OWNER, conversacionId: conv2, pregunta: "Buscá competidores de simuladores en Córdoba" }, { provider: new ProveedorVeneno() as never, webProvider: undefined });
    assert.ok(r5.ok, "no configurada: responde ok, no 500"); if (!r5.ok) return;
    assert.equal(r5.texto, "La búsqueda web no está configurada.", "mensaje exacto de no configurada");
    console.log("OK — servidor4d5 (parte 2): Tavily no configurado → mensaje exacto, Claude NUNCA invocado (proveedor veneno no lanzó), sin 500.");
  } finally {
    await limpiar(conv2);
  }

  // ── 6) PII en la consulta: no se llama a Tavily ──────────────────────────────────────
  const conv3 = await nuevaConv();
  try {
    const web6 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT }]);
    const p6 = new FakeProviderGuionado([{ tipo: "texto", texto: "No puedo usar ese dato en una búsqueda." }]);
    const r6 = await correrChat({ owner: OWNER, conversacionId: conv3, pregunta: "Buscá en internet el teléfono +54 351 1234567 del cliente" }, { provider: p6, webProvider: web6 });
    assert.ok(r6.ok, "pii ok");
    assert.equal(web6.llamadas.length, 0, "PII → cero búsquedas Tavily");
    console.log("OK — servidor4d5 (parte 3): PII en la consulta bloquea la búsqueda web (cero llamadas a Tavily).");
  } finally {
    await limpiar(conv3);
  }

  // ── 7) Error/timeout de Tavily: sin reintento, degradación limpia (sigue con lo interno) ──
  const conv4 = await nuevaConv();
  try {
    const web7 = new FakeWebSearchProvider([{ tipo: "error", mensaje: "El proveedor de búsqueda respondió con estado 500.", status: 502 }]);
    const p7 = new FakeProviderGuionado([{ tipo: "texto", texto: "Respondo con lo disponible." }]);
    const r7 = await correrChat({ owner: OWNER, conversacionId: conv4, pregunta: "Buscá competidores de simuladores en Córdoba y compará con SIM" }, { provider: p7, webProvider: web7 });
    assert.ok(r7.ok, "error tavily: responde ok"); if (!r7.ok) return;
    assert.equal(web7.llamadas.length, 1, "una sola llamada a Tavily (sin reintento automático)");
    const { data: bw7 } = await supabaseAdmin.from("ia_busquedas_web").select("estado, error_normalizado").eq("conversacion_id", conv4).single();
    assert.equal(bw7!.estado, "error", "búsqueda registrada en error");
    console.log("OK — servidor4d5 (parte 4): error de Tavily sin reintento; se audita el error; el chat sigue con lo disponible.");
  } finally {
    await limpiar(conv4);
  }

  // ── 8) Interruptor global apagado (IA_WEB_HABILITADA=0): mensaje exacto, sin Claude ──────
  const conv5 = await nuevaConv();
  const prevEnv = process.env.IA_WEB_HABILITADA;
  try {
    process.env.IA_WEB_HABILITADA = "0";
    const r8 = await correrChat({ owner: OWNER, conversacionId: conv5, pregunta: "Buscá competidores de simuladores en Córdoba" }, { provider: new ProveedorVeneno() as never, webProvider: new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT }]) });
    assert.ok(r8.ok, "kill switch: responde ok"); if (!r8.ok) return;
    assert.equal(r8.texto, "La búsqueda web está temporalmente desactivada. Las consultas internas de SIM siguen disponibles.", "mensaje exacto del interruptor global");
    console.log("OK — servidor4d5 (parte 5): IA_WEB_HABILITADA=0 → mensaje exacto, Claude NUNCA invocado.");
  } finally {
    process.env.IA_WEB_HABILITADA = prevEnv;
    await limpiar(conv5);
    await limpiarCacheZZ();
    const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
  }
}
main().catch(async (e) => { console.error(e); await limpiar(); await limpiarCacheZZ(); process.exit(1); });

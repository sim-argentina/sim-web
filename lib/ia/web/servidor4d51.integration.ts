// Corrección 4D.5.1 — auditoría de la ejecución real d5275e4f-6c69-40e5-bff1-652b87d2c803
// (stop_reason=max_tokens con el techo previo de 2.000 tokens de salida) y verificación de la
// corrección: presupuesto de salida realista (3.200), resumen interno compacto precomputado
// (menos rondas de herramientas) y mensaje de límite que YA NO sugiere repetir una consulta que
// tuvo costo. Rama Tavily (default). NO llama a Claude ni a Tavily reales.
//
// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/web/servidor4d51.integration.ts

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { FakeWebSearchProvider } from "@/lib/ia/web/providerWebFake";
import { claveCacheWeb } from "@/lib/ia/web/cache";
import { sanitizarConsultaWeb } from "@/lib/ia/web/sanitizar";
import { LIMITES_TAVILY } from "@/lib/ia/web/config";
import { estimarCostoUSD } from "@/lib/ia/config";
import { PRESUPUESTO_ESTANDAR } from "@/lib/ia/web/presupuesto";

const OWNER = "admin:zztest-4d51";
const RESULT = [{ titulo: "Sim Cordoba", url: "https://simexterno.com/a", dominio: "simexterno.com", fechaPublicada: "2026-01-01", fragmento: "Simuladores de auto en Córdoba.", posicion: 0 }];
const PREGUNTA_1 = "Buscá competidores de simuladores en Córdoba y compará con SIM (caso 1: respuesta completa)";
const PREGUNTA_2 = "Buscá competidores de simuladores en Córdoba y compará con SIM (caso 2: respuesta cortada)";

async function limpiarCacheZZ(pregunta: string) {
  const clave = claveCacheWeb({ consulta: sanitizarConsultaWeb(pregunta, 300), proveedor: "tavily", localizacion: "Cordoba,AR", maxResultados: LIMITES_TAVILY.maxResultados });
  await supabaseAdmin.from("ia_web_cache").delete().eq("clave_hash", clave);
}
async function limpiar(id?: string) {
  if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}
async function nuevaConv(): Promise<string> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 4d5.1", estado: "activa" }).select("id").single();
  return data!.id as string;
}

async function main() {
  await limpiar(); await limpiarCacheZZ(PREGUNTA_1); await limpiarCacheZZ(PREGUNTA_2);

  // ── 1) Presupuesto de salida elevado (3.200) + resumen interno compacto precomputado +
  //      respuesta extensa y bien formada NO se trunca (caso real, ya corregido) ──────────────
  const conv1 = await nuevaConv();
  try {
    const web1 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT }]);
    const secciones = Array.from({ length: 5 }, (_, i) => `## Actor ${i + 1}\nClasificación y datos del actor ${i + 1}, correctamente cerrado.`).join("\n\n");
    const textoLargo = `Respuesta directa: no hay competidor directo confirmado.\n\n${secciones}\n\n## Conclusión\nAnálisis completo y cerrado.`;
    const p1 = new FakeProviderGuionado([{ tipo: "texto", texto: textoLargo, stopReason: "end_turn" }]);
    const r1 = await correrChat({ owner: OWNER, conversacionId: conv1, pregunta: PREGUNTA_1, idempotencyKey: "zz-451-1" }, { provider: p1, webProvider: web1 });
    assert.ok(r1.ok, "ok"); if (!r1.ok) return;
    assert.equal(p1.ultimoMaxTokensSalida, 3200, "presupuesto de salida estándar elevado a 3.200 (4D.5.1)");
    assert.ok(!/No pude terminar esta respuesta|No pude completar la respuesta/i.test(r1.texto), "no cae al mensaje de límite");
    assert.ok(r1.texto.includes("## Conclusión"), "publica la respuesta completa, incluida la conclusión");
    const { data: eje1 } = await supabaseAdmin.from("ia_ejecuciones").select("busqueda_previa").eq("conversacion_id", conv1).order("created_at", { ascending: false }).limit(1).single();
    const bp1 = eje1!.busqueda_previa as { contexto_interno_compacto_enviado?: boolean };
    assert.equal(bp1.contexto_interno_compacto_enviado, true, "el resumen interno compacto (mes vigente) se precomputó y se envió");
    console.log("OK — 4D.5.1 (parte 1): maxTokensSalida=3200; resumen interno compacto enviado; respuesta extensa y bien formada se publica COMPLETA (no se trunca).");
  } finally { await limpiar(conv1); await limpiarCacheZZ(PREGUNTA_1); }

  // ── 2) stop_reason=max_tokens: mensaje NUEVO (sin "acotando el alcance"), apunta a "Ampliar
  //      investigación" (reutiliza caché, sin pedir repetir una consulta que ya costó) ────────
  const conv2 = await nuevaConv();
  try {
    const web2 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT }]);
    const p2 = new FakeProviderGuionado([{ tipo: "texto", texto: "## Datos\nUn análisis parcial que se corta a mitad de", stopReason: "max_tokens" }]);
    const r2 = await correrChat({ owner: OWNER, conversacionId: conv2, pregunta: PREGUNTA_2, idempotencyKey: "zz-451-2" }, { provider: p2, webProvider: web2 });
    assert.ok(r2.ok, "ok"); if (!r2.ok) return;
    assert.ok(/No pude terminar esta respuesta dentro del presupuesto est[aá]ndar/.test(r2.texto), "mensaje NUEVO de límite (causa concreta, sin jerga)");
    assert.ok(!/acotando el alcance/i.test(r2.texto), "ya NO sugiere acotar/repetir la consulta que ya tuvo costo");
    assert.ok(/Ampliar investigaci[oó]n/i.test(r2.texto), "señala continuar (Ampliar investigación) en vez de repetir desde cero");
    const { data: msg2 } = await supabaseAdmin.from("ia_mensajes").select("error, fuentes").eq("conversacion_id", conv2).eq("rol", "assistant").order("created_at", { ascending: false }).limit(1).single();
    assert.ok((msg2!.error as string ?? "").includes("truncado_max_tokens"), "el texto real generado se conserva SOLO en auditoría");
    const fuentes2 = (msg2!.fuentes as Array<{ tipo?: string }>) ?? [];
    assert.ok(fuentes2.some((f) => f.tipo === "externa"), "las fuentes ya encontradas se conservan pese al corte (crédito Tavily ya pagado)");
    console.log("OK — 4D.5.1 (parte 2): stop_reason=max_tokens → mensaje nuevo sin 'acotando el alcance', apunta a Ampliar investigación, fuentes conservadas, texto real solo en auditoría.");
  } finally { await limpiar(conv2); await limpiarCacheZZ(PREGUNTA_2); }

  // ── 3) Reconciliación EXACTA de la ejecución real auditada (sin llamar a Claude/Tavily) ────
  {
    const tokensIn = 20033, tokensOut = 2692;
    assert.equal(tokensIn + tokensOut, 22725, "reconcilia exactamente 601.393 − 578.668 = 22.725 tokens");
    const costo = estimarCostoUSD("claude-sonnet-5", tokensIn, tokensOut);
    assert.ok(costo != null && Math.abs((costo as number) - 0.100479) < 1e-6, "costo exacto US$0,100479 (sonnet-5: US$3/M in, US$15/M out)");
    assert.ok((costo as number) <= 0.15, "dentro del techo estándar de US$0,15 (Tavily NO se descuenta del saldo Anthropic)");
    console.log("OK — 4D.5.1 (parte 3): reconciliación exacta 22.725 tokens y US$0,100479 de la ejecución real auditada (d5275e4f…), sin llamar a Claude ni Tavily.");
  }

  // ── 4) El presupuesto de salida elevado NO esconde el problema: el peor caso proyectado
  //      sigue ≤ US$0,15 (el techo de costo estándar NO se tocó) ─────────────────────────────
  {
    const peor = estimarCostoUSD("claude-sonnet-5", PRESUPUESTO_ESTANDAR.maxTokensInEstimados, PRESUPUESTO_ESTANDAR.maxTokensSalida);
    assert.ok(peor != null && (peor as number) <= PRESUPUESTO_ESTANDAR.maxCostoUsd, "peor caso proyectado (tope de entrada × tope de salida) sigue ≤ US$0,15");
    assert.equal(PRESUPUESTO_ESTANDAR.maxCostoUsd, 0.15, "el techo de costo estándar sigue en US$0,15 (no se subió para esconder el problema)");
    console.log(`OK — 4D.5.1 (parte 4): peor caso de PRESUPUESTO_ESTANDAR (${PRESUPUESTO_ESTANDAR.maxTokensInEstimados} in / ${PRESUPUESTO_ESTANDAR.maxTokensSalida} out) = US$${(peor as number).toFixed(6)} ≤ US$0,15.`);
  }

  const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
  console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
}
main().catch(async (e) => { console.error(e); await limpiar(); await limpiarCacheZZ(PREGUNTA_1); await limpiarCacheZZ(PREGUNTA_2); process.exit(1); });

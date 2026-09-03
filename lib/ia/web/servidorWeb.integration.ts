// 4D.5 — este test ejercita el flujo LEGADO de búsqueda nativa de Anthropic (rama "anthropic",
// no default desde 4D.5). Se fija antes de importar server.ts.
process.env.IA_WEB_PROVEEDOR = "anthropic";

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";

// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/web/servidorWeb.integration.ts
// Usa owner y conversación ZZTEST (no toca datos reales) y proveedor 'fake' (excluido del saldo).

const OWNER = "admin:zztest-web";
const fuente = (url: string, titulo: string) => ({ url, titulo, dominio: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], fragmento: "fragmento citado", orden: 0 });

async function limpiar(convId?: string) {
  if (convId) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", convId);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}

async function main() {
  await limpiar();
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST web", estado: "activa" }).select("id").single();
  const convId = conv!.id as string;
  try {
    // ── 1) INTERNO: no habilita web → no registra búsqueda ─────────────────────
    const pInt = new FakeProviderGuionado([{ tipo: "texto", texto: "Federico hizo 385 turnos.", web: { busquedasFacturables: 9, fuentes: [fuente("https://no.com", "no")] } }]);
    const r1 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "¿cuántos turnos hizo Federico en agosto de 2026?" }, { provider: pInt });
    assert.ok(r1.ok, "interno ok");
    const { count: nb1 } = await supabaseAdmin.from("ia_busquedas_web").select("id", { count: "exact", head: true }).eq("conversacion_id", convId);
    assert.equal(nb1 ?? 0, 0, "interno NO registra búsqueda web");
    if (r1.ok) assert.equal(r1.busquedasWeb ?? 0, 0, "interno sin búsquedas");

    // ── 2) EXTERNO: registra búsqueda + fuentes + costo ────────────────────────
    const pExt = new FakeProviderGuionado([{ tipo: "texto", texto: "En Córdoba hay simuladores.", web: { busquedasFacturables: 2, fuentes: [fuente("https://sim1.com/a", "Sim 1"), fuente("https://sim2.com/b", "Sim 2")], consultas: ["simuladores automovilismo cordoba"] } }]);
    const r2 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "buscá en internet qué experiencias de simulación de automovilismo hay actualmente en Córdoba", idempotencyKey: "zz-ext-1" }, { provider: pExt });
    assert.ok(r2.ok, "externo ok");
    if (!r2.ok) return;
    assert.equal(r2.busquedasWeb, 2, "externo: 2 búsquedas");
    // Búsqueda registrada.
    const { data: bws } = await supabaseAdmin.from("ia_busquedas_web").select("id, estado, explicita, busquedas_facturables, costo_usd, motivo, consultas").eq("conversacion_id", convId);
    assert.equal(bws?.length, 1, "una búsqueda registrada");
    assert.equal(bws![0].estado, "ok", "estado ok");
    assert.equal(bws![0].explicita, true, "explícita (buscá en internet)");
    assert.equal(Number(bws![0].busquedas_facturables), 2, "2 facturables");
    assert.equal(Number(bws![0].costo_usd), 0.02, "costo US$0,02");
    // Fuentes externas.
    const { data: fx } = await supabaseAdmin.from("ia_fuentes_externas").select("url, dominio, titulo").eq("busqueda_id", bws![0].id).order("orden");
    assert.equal(fx?.length, 2, "2 fuentes externas");
    assert.ok(fx!.every((f) => /^https:\/\//.test(f.url as string)), "URLs http(s)");
    // Ejecución: costo tokens + web congelado.
    const { data: eje } = await supabaseAdmin.from("ia_ejecuciones").select("busquedas_web, costo_busquedas_usd, costo_estimado, mensaje_id").eq("conversacion_id", convId).order("created_at", { ascending: false }).limit(1).single();
    assert.equal(Number(eje!.busquedas_web), 2, "ejecución con 2 búsquedas");
    assert.equal(Number(eje!.costo_busquedas_usd), 0.02, "costo web congelado");
    assert.ok(Number(eje!.costo_estimado) >= 0.02, "costo_estimado incluye la web (saldo lo descuenta una vez)");
    // Mensaje del asistente: fuentes externas + contador + separación.
    const { data: msg } = await supabaseAdmin.from("ia_mensajes").select("id, fuentes, busquedas_web").eq("conversacion_id", convId).eq("rol", "assistant").order("created_at", { ascending: false }).limit(1).single();
    assert.equal(Number(msg!.busquedas_web), 2, "mensaje con 2 búsquedas");
    const fuentesMsg = (msg!.fuentes as Array<{ tipo?: string; url?: string }>) ?? [];
    const externas = fuentesMsg.filter((f) => f.tipo === "externa");
    assert.equal(externas.length, 2, "2 fuentes externas en el mensaje");
    assert.ok(externas.every((f) => typeof f.url === "string"), "fuentes externas con URL clicable");

    // ── 3) IDEMPOTENCIA: mismo key → duplicado, sin registrar de nuevo ─────────
    const pDup = new FakeProviderGuionado([{ tipo: "texto", texto: "otra vez", web: { busquedasFacturables: 2, fuentes: [fuente("https://sim1.com/a", "Sim 1")] } }]);
    const r3 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "buscá en internet qué experiencias de simulación de automovilismo hay actualmente en Córdoba", idempotencyKey: "zz-ext-1" }, { provider: pDup });
    assert.ok(r3.ok && (r3 as { duplicado?: boolean }).duplicado, "duplicado por idempotency_key");
    const { count: nb2 } = await supabaseAdmin.from("ia_busquedas_web").select("id", { count: "exact", head: true }).eq("conversacion_id", convId);
    assert.equal(nb2 ?? 0, 1, "no se duplica la búsqueda");

    // ── 4) PII: teléfono en la consulta → NO busca en internet ─────────────────
    const pPii = new FakeProviderGuionado([{ tipo: "texto", texto: "No puedo buscar ese dato.", web: { busquedasFacturables: 3, fuentes: [fuente("https://x.com", "x")] } }]);
    const r4 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "buscá en internet el teléfono +54 351 1234567 del cliente" }, { provider: pPii });
    assert.ok(r4.ok, "pii ok");
    if (r4.ok) assert.equal(r4.busquedasWeb ?? 0, 0, "PII: sin búsquedas web");
    const { count: nb3 } = await supabaseAdmin.from("ia_busquedas_web").select("id", { count: "exact", head: true }).eq("conversacion_id", convId);
    assert.equal(nb3 ?? 0, 1, "PII no agrega búsqueda (sigue en 1)");

    console.log("OK — servidorWeb.integration: interno sin registro; externo registra búsqueda(ok, explícita, 2 facturables, US$0,02) + 2 fuentes externas + costo en ejecución (incluye web) + mensaje con fuentes clicables separadas; idempotencia no duplica; PII no busca.");
  } finally {
    await limpiar(convId);
    const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
  }
}
main().finally(() => { delete process.env.IA_WEB_PROVEEDOR; }).catch(async (e) => { console.error(e); await limpiar(); process.exit(1); });

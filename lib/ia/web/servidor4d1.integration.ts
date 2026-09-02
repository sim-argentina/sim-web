import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";

// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/web/servidor4d1.integration.ts
// ZZTEST + proveedor fake (excluido del saldo). No toca datos reales.

const OWNER = "admin:zztest-4d1";
const CONSULTA = "Buscá en internet qué experiencias de simulación de automovilismo existen actualmente en Córdoba y citá las fuentes. Después explicame, separando los datos internos y externos, qué diferencias principales encontrás con SIM.";
// Respuesta MALA (como la real observada): la validación debe anexar salvedades.
const MALA = "SIM — Agosto 2026 (incompleto, corte actual): 489 operaciones → aprox. 15-20 máquinas operando. Volumen alto y ocupación sostenida; SIM sería el de mayor volumen en Córdoba. Competidor SimCafé Racer: $2-5K/sesión.";
const fuente = (url: string, titulo: string) => ({ url, titulo, dominio: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], orden: 0 });

async function limpiar(convId?: string) {
  if (convId) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", convId);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}

async function main() {
  await limpiar();
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 4d1", estado: "activa" }).select("id").single();
  const convId = conv!.id as string;
  try {
    // Consulta competitiva mixta → router POTENTE + validación anexada.
    const p = new FakeProviderGuionado([{ tipo: "texto", texto: MALA, web: { busquedasFacturables: 2, fuentes: [fuente("https://a.com", "A"), fuente("https://b.com", "B")], consultas: ["simuladores cordoba"] } }]);
    const r = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: CONSULTA }, { provider: p });
    assert.ok(r.ok, "ok");
    if (!r.ok) return;
    assert.equal(r.busquedasWeb, 2, "2 búsquedas");
    // Router: comparación competitiva → potente desde el inicio.
    const { data: eje } = await supabaseAdmin.from("ia_ejecuciones").select("clase_modelo, motivo_router").eq("conversacion_id", convId).order("created_at", { ascending: false }).limit(1).single();
    assert.equal(eje!.clase_modelo, "potente", "router elige potente para análisis competitivo");
    // Validación anexada a la respuesta publicada.
    const { data: msg } = await supabaseAdmin.from("ia_mensajes").select("contenido").eq("conversacion_id", convId).eq("rol", "assistant").order("created_at", { ascending: false }).limit(1).single();
    const c = msg!.contenido as string;
    assert.ok(c.includes("Verificación automática"), "anexa notas de verificación");
    assert.ok(/hist[óo]rica de SIM/i.test(c), "corrige SIM Café Racer como no-competidor");
    assert.ok(/incompleto|finalizado/i.test(c), "advierte sobre el período");
    assert.ok(/m[áa]quinas/i.test(c), "advierte sobre máquinas derivadas");

    // Consulta interna posterior → NO usa web, sin costo web.
    const p2 = new FakeProviderGuionado([{ tipo: "texto", texto: "Federico hizo 385 turnos." }]);
    const r2 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "¿Cuántos turnos hizo Federico en agosto de 2026?" }, { provider: p2 });
    assert.ok(r2.ok, "interna ok");
    if (r2.ok) assert.equal(r2.busquedasWeb ?? 0, 0, "consulta interna NO usa web");
    const { count: nb } = await supabaseAdmin.from("ia_busquedas_web").select("id", { count: "exact", head: true }).eq("conversacion_id", convId);
    assert.equal(nb ?? 0, 1, "solo la búsqueda de la consulta externa (interna no registra)");

    console.log("OK — servidor4d1.integration: consulta competitiva → router potente + validación anexada (SIM Café Racer histórica, período, máquinas); consulta interna posterior sin web.");
  } finally {
    await limpiar(convId);
    const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
  }
}
main().catch(async (e) => { console.error(e); await limpiar(); process.exit(1); });

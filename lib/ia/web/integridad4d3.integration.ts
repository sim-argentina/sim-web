import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";

// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/web/integridad4d3.integration.ts
const OWNER = "admin:zztest-4d3";
const PARCIAL = "## Datos internos de SIM\n- Stand: 489 operaciones, 814 personas.\n- No tengo en";
const fuente = (u: string, t: string) => ({ url: u, titulo: t, dominio: u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], orden: 0 });

async function limpiar(id?: string) { if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id); await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER); await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER); }

async function main() {
  await limpiar();
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 4d3", estado: "activa" }).select("id").single();
  const convId = conv!.id as string;
  try {
    // Síntesis cortada por max_tokens: NO debe publicarse el parcial.
    const p = new FakeProviderGuionado([{ tipo: "texto", texto: PARCIAL, stopReason: "max_tokens", web: { busquedasFacturables: 1, fuentes: [fuente("https://a.com", "A")] } }]);
    const r = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "buscá competidores de simuladores en Córdoba y compará con SIM" }, { provider: p });
    assert.ok(r.ok, "ok"); if (!r.ok) return;
    const { data: msg } = await supabaseAdmin.from("ia_mensajes").select("contenido, error, fuentes, estado").eq("conversacion_id", convId).eq("rol", "assistant").order("created_at", { ascending: false }).limit(1).single();
    const c = msg!.contenido as string;
    assert.ok(!c.includes("No tengo en"), "NUNCA publica el fragmento truncado");
    assert.ok(/No pude completar la respuesta dentro del límite/i.test(c), "muestra mensaje local íntegro");
    assert.ok((msg!.error as string ?? "").includes("truncado_max_tokens"), "parcial preservado SOLO en auditoría");
    assert.ok((msg!.error as string).includes("No tengo en"), "el parcial queda en el campo de error (no visible)");
    const fuentes = (msg!.fuentes as Array<{ tipo?: string; url?: string }>) ?? [];
    assert.ok(fuentes.some((f) => f.tipo === "externa" && f.url), "las fuentes externas siguen visibles/persistidas");

    // La respuesta que SÍ termina bien se publica normal.
    const p2 = new FakeProviderGuionado([{ tipo: "texto", texto: "Respuesta directa: no hay competidor directo confirmado. Fuentes abajo.", stopReason: "end_turn", web: { busquedasFacturables: 1, fuentes: [fuente("https://b.com", "B")] } }]);
    const r2 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "buscá competidores en Córdoba y compará con SIM" }, { provider: p2 });
    assert.ok(r2.ok && r2.ok, "ok2");
    const { data: msg2 } = await supabaseAdmin.from("ia_mensajes").select("contenido").eq("conversacion_id", convId).eq("rol", "assistant").order("created_at", { ascending: false }).limit(1).single();
    assert.ok(/no hay competidor directo confirmado/i.test(msg2!.contenido as string), "respuesta completa se publica normal");
    assert.ok(!/No pude completar/.test(msg2!.contenido as string), "no marca truncado cuando terminó bien");

    console.log("OK — integridad4d3: truncamiento max_tokens NO publica el parcial ('No tengo en'), muestra mensaje local íntegro, conserva el parcial en auditoría y las fuentes; respuesta completa se publica normal.");
  } finally {
    await limpiar(convId);
    const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
  }
}
main().catch(async (e) => { console.error(e); await limpiar(); process.exit(1); });

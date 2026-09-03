// Tiempos cortos para el fake (antes de importar config/server).
process.env.IA_PROVIDER = "fake";
process.env.IA_TIEMPO_MS_MAX = "3000";
process.env.IA_WEB_TIMEOUT_MS = "1500";

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/web/timeoutServidor4d4.integration.ts
const OWNER = "admin:zztest-4d4";
async function limpiar(id?: string) { if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id); await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER); await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER); }

async function main() {
  await limpiar();
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 4d4", estado: "activa" }).select("id").single();
  const convId = conv!.id as string;
  try {
    // ── Timeout en la búsqueda web: mensaje honesto, uso desconocido, sin costo inventado ──
    const p = new FakeProviderGuionado([{ tipo: "timeout" }]);
    const r = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "buscá competidores de simuladores en Córdoba y compará con SIM", idempotencyKey: "zz-to-1" }, { provider: p });
    assert.ok(r.ok, "responde ok (no 500 crudo)"); if (!r.ok) return;
    const { data: msg } = await supabaseAdmin.from("ia_mensajes").select("contenido, estado").eq("conversacion_id", convId).eq("rol", "assistant").order("created_at", { ascending: false }).limit(1).single();
    const c = msg!.contenido as string;
    assert.ok(/tardó más de lo permitido/i.test(c), "mensaje local honesto de timeout");
    assert.ok(/Referencia:/i.test(c), "incluye referencia corta");
    assert.ok(/No se reintentó automáticamente/i.test(c), "avisa que no reintentó");
    assert.ok(/pendiente de conciliación/i.test(c), "avisa consumo desconocido pendiente");
    assert.ok(!/No tengo en|##/.test(c), "no muestra fragmento parcial ni estructura rota");
    // Ejecución auditada con uso desconocido y SIN costo inventado.
    const { data: eje } = await supabaseAdmin.from("ia_ejecuciones").select("estado, uso_desconocido, costo_estimado, tokens_in, tokens_out, fase_fallo").eq("conversacion_id", convId).order("created_at", { ascending: false }).limit(1).single();
    assert.equal(eje!.estado, "error", "ejecución en error");
    assert.equal(eje!.uso_desconocido, true, "uso_desconocido=true");
    assert.equal(Number(eje!.costo_estimado), 0, "no inventa costo (0 conocido, marcado desconocido)");
    assert.ok((eje!.fase_fallo as string ?? "").includes("ronda_0"), "fase de fallo registrada");
    // Búsqueda web auditada con uso desconocido.
    const { data: bw } = await supabaseAdmin.from("ia_busquedas_web").select("estado, uso_desconocido").eq("conversacion_id", convId).order("created_at", { ascending: false }).limit(1).single();
    assert.equal(bw!.estado, "error", "búsqueda web en error");
    assert.equal(bw!.uso_desconocido, true, "búsqueda con uso desconocido");
    // Una sola ejecución (sin auto-reintento).
    const { count: nEje } = await supabaseAdmin.from("ia_ejecuciones").select("id", { count: "exact", head: true }).eq("conversacion_id", convId);
    assert.equal(nEje ?? 0, 1, "una sola ejecución (sin auto-reintento)");

    // ── Idempotencia: reenvío con el mismo key → duplicado, NO crea otra ejecución ──
    const p2 = new FakeProviderGuionado([{ tipo: "timeout" }]);
    const r2 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "buscá competidores de simuladores en Córdoba y compará con SIM", idempotencyKey: "zz-to-1" }, { provider: p2 });
    assert.ok(r2.ok && (r2 as { duplicado?: boolean }).duplicado, "duplicado por idempotency_key");
    const { count: nEje2 } = await supabaseAdmin.from("ia_ejecuciones").select("id", { count: "exact", head: true }).eq("conversacion_id", convId);
    assert.equal(nEje2 ?? 0, 1, "sigue habiendo una sola ejecución (recarga/doble no duplica)");

    console.log("OK — timeoutServidor4d4: timeout → mensaje local honesto (referencia, sin reintento, consumo pendiente de conciliación), sin fragmento parcial; ejecución+búsqueda con uso_desconocido y sin costo inventado; una sola ejecución; idempotencia no duplica.");
  } finally {
    await limpiar(convId);
    const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
  }
}
main().catch(async (e) => { console.error(e); await limpiar(); process.exit(1); });

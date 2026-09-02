import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearBorrador, obtenerPreview } from "@/lib/ia/informes/informesServer";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/informes/recuperacion.integration.ts
// Idempotencia y recuperación del borrador (bloque 4C.1). Datos ZZTEST con limpieza.

const OWNER = "ZZTEST-4c1";
const SNAP = [{ herramienta: "consultar_metricas_equipo", resumen: { neta: 142000 } }];
const spec = { titulo: "ZZTEST Federico agosto", tipo_informe: "analitico_mensual", periodo: "2026-08", resumen_ejecutivo: "R.", modulos_consultados: ["metricas_equipo"], incluye_pii: false };

async function limpiar() {
  await supabaseAdmin.from("ia_informes").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
}

async function main() {
  await limpiar();
  const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST conv", estado: "activa" }).select("id").single();
  const { data: umsg } = await supabaseAdmin.from("ia_mensajes").insert({ conversacion_id: conv!.id, rol: "user", contenido: "Generame un informe de Federico" }).select("id").single();
  const convId = conv!.id as string, msgId = umsg!.id as string;

  try {
    // Crear borrador vinculado al mensaje.
    const c1 = await crearBorrador({ conversacionId: convId, owner: OWNER, ejecucionId: null, mensajeUsuarioId: msgId, specRaw: spec, snapshotFuentes: SNAP });
    assert.ok(c1.ok, "borrador creado");
    if (!c1.ok) return;

    // Idempotencia: mismo mensaje → REUTILIZA (no duplica).
    const c2 = await crearBorrador({ conversacionId: convId, owner: OWNER, ejecucionId: null, mensajeUsuarioId: msgId, specRaw: spec, snapshotFuentes: SNAP });
    assert.ok(c2.ok && "reutilizado" in c2 && c2.reutilizado, "segundo intento reutiliza");
    assert.equal(c1.ok && c2.ok && c1.informeId, c2.ok && c2.informeId, "mismo informeId");
    const { count: nInf } = await supabaseAdmin.from("ia_informes").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    assert.equal(nInf, 1, "un solo informe (sin duplicar)");
    const { count: nVer } = await supabaseAdmin.from("ia_informe_versiones").select("id", { count: "exact", head: true }).eq("informe_id", c1.informeId);
    assert.equal(nVer, 1, "una sola versión (sin duplicar)");

    // Simular doble clic concurrente (dos creaciones casi simultáneas) → sigue 1.
    await Promise.all([
      crearBorrador({ conversacionId: convId, owner: OWNER, ejecucionId: null, mensajeUsuarioId: msgId, specRaw: spec, snapshotFuentes: SNAP }),
      crearBorrador({ conversacionId: convId, owner: OWNER, ejecucionId: null, mensajeUsuarioId: msgId, specRaw: spec, snapshotFuentes: SNAP }),
    ]);
    const { count: nInf2 } = await supabaseAdmin.from("ia_informes").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    assert.equal(nInf2, 1, "doble clic no duplica");

    // El borrador es recuperable por preview + conserva fuentes/snapshot.
    const prev = await obtenerPreview(c1.informeId, OWNER);
    assert.ok(prev.ok && prev.spec.titulo === "ZZTEST Federico agosto", "preview recuperable");
    const { data: ver } = await supabaseAdmin.from("ia_informe_versiones").select("snapshot_fuentes").eq("informe_id", c1.informeId).single();
    assert.ok(ver && Array.isArray(ver.snapshot_fuentes) && (ver.snapshot_fuentes as unknown[]).length === 1, "snapshot de grounding conservado");

    console.log("OK — recuperacion.integration (4C.1): borrador idempotente por mensaje (reutiliza, no duplica versiones), doble clic concurrente no duplica, preview recuperable, snapshot conservado.");
  } finally {
    await limpiar();
    const { count } = await supabaseAdmin.from("ia_informes").select("id", { count: "exact", head: true }).eq("owner", OWNER);
    assert.equal(count ?? 0, 0, "limpieza ZZTEST");
    console.log("Limpieza ZZTEST verificada.");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

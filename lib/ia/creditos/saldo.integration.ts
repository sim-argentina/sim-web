import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { registrarMovimiento, anularMovimiento, sincronizarCostos, conciliar } from "@/lib/ia/creditos/saldoServer";
import type { FetchLike } from "@/lib/ia/creditos/costReport";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/creditos/saldo.integration.ts
// Usa datos ZZTEST (actor='ZZTEST') y los ELIMINA al final. No toca datos de negocio.
// Precondición: la tabla de movimientos no debe tener filas reales (pre-deploy).

const ACTOR = "ZZTEST";

async function saldoRPC() {
  const { data } = await supabaseAdmin.rpc("ia_creditos_saldo");
  return data as { cargas_total_usd: string; costo_oficial_usd: string; saldo_calculado_usd: string; hay_snapshot: boolean };
}
async function limpiar() {
  await supabaseAdmin.from("ia_saldo_conciliaciones").delete().eq("actor", ACTOR);
  await supabaseAdmin.from("ia_costos_oficiales_snapshots").delete().eq("actor", ACTOR);
  await supabaseAdmin.from("ia_creditos_movimientos").delete().eq("actor", ACTOR);
}

async function main() {
  await limpiar();
  // Este test usa valores ABSOLUTOS del saldo global, así que SOLO corre con las tablas
  // vacías (pre-deploy). Si ya hay datos REALES (cargas/conciliaciones de Ramiro), se SKIPEA
  // para NO tocarlos ni fallar en falso. El feature quedó verificado en el bloque 4B.5.
  const { count: movReales } = await supabaseAdmin.from("ia_creditos_movimientos").select("id", { count: "exact", head: true });
  const { count: snapReales } = await supabaseAdmin.from("ia_costos_oficiales_snapshots").select("id", { count: "exact", head: true });
  if ((movReales ?? 0) > 0 || (snapReales ?? 0) > 0) {
    console.log(`SKIP — saldo.integration: hay datos reales de crédito (${movReales} movimientos, ${snapReales} snapshots). El test requiere tablas vacías; no se ejecuta para no tocar datos reales.`);
    return;
  }

  try {
    // ── Carga inicial USD 5 (idempotente) ────────────────────────────────────
    const c1 = await registrarMovimiento({ tipo: "carga", importeUsd: "5.000000", fecha: "2026-08-15", descripcion: "Carga inicial Anthropic", idempotencyKey: "k-carga-5", actor: ACTOR });
    assert.ok(c1.ok && !("duplicado" in c1 && c1.duplicado), "carga 5 registrada");
    let s = await saldoRPC();
    assert.equal(Number(s.cargas_total_usd), 5, "cargas = 5");
    assert.equal(Number(s.saldo_calculado_usd), 5, "saldo = 5 (sin costo oficial aún)");
    assert.equal(s.hay_snapshot, false, "aún sin snapshot");

    // ── Doble envío NO duplica ────────────────────────────────────────────────
    const c1b = await registrarMovimiento({ tipo: "carga", importeUsd: "5.000000", fecha: "2026-08-15", descripcion: "Carga inicial Anthropic", idempotencyKey: "k-carga-5", actor: ACTOR });
    assert.ok(c1b.ok && "duplicado" in c1b && c1b.duplicado, "segundo envío marcado duplicado");
    s = await saldoRPC();
    assert.equal(Number(s.cargas_total_usd), 5, "sigue 5 (no duplicó)");

    // ── Nueva carga USD 20 ────────────────────────────────────────────────────
    await registrarMovimiento({ tipo: "carga", importeUsd: "20.000000", fecha: "2026-09-01", descripcion: "Segunda carga", idempotencyKey: "k-carga-20", actor: ACTOR });
    s = await saldoRPC();
    assert.equal(Number(s.cargas_total_usd), 25, "cargas = 25 (5+20)");

    // ── Ajuste positivo y negativo (signo por tipo) ──────────────────────────
    await registrarMovimiento({ tipo: "ajuste_positivo", importeUsd: "1.000000", fecha: "2026-09-01", descripcion: "ajuste +1", actor: ACTOR });
    const neg = await registrarMovimiento({ tipo: "ajuste_negativo", importeUsd: "2.000000", fecha: "2026-09-01", descripcion: "ajuste -2", actor: ACTOR });
    assert.ok(neg.ok);
    s = await saldoRPC();
    assert.equal(Number(s.cargas_total_usd), 24, "25 +1 −2 = 24");

    // ── Anulación conserva historial y descuenta del saldo ───────────────────
    const idNeg = (neg as { id: string }).id;
    const an = await anularMovimiento(idNeg, "cargado por error", ACTOR);
    assert.ok(an.ok, "anulado");
    s = await saldoRPC();
    assert.equal(Number(s.cargas_total_usd), 26, "tras anular el −2: 25 +1 = 26");
    const { data: rowAnul } = await supabaseAdmin.from("ia_creditos_movimientos").select("estado, motivo_anulacion").eq("id", idNeg).single();
    assert.equal(rowAnul?.estado, "anulado", "el registro sigue existiendo (historial)");
    assert.equal(rowAnul?.motivo_anulacion, "cargado por error", "motivo conservado");
    // Anular de nuevo → no permitido.
    const an2 = await anularMovimiento(idNeg, "otra vez", ACTOR);
    assert.equal(an2.ok, false, "no se puede anular dos veces");

    // ── Sincronización de costos oficiales (fetch FALSO) → snapshot ───────────
    // 8 centavos = US$0.08.
    const fakeFetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ starting_at: "2026-08-01T00:00:00Z", results: [{ amount: "8", currency: "USD", description: "uso" }] }], has_more: false, next_page: null }) } as unknown as Response);
    const sync = await sincronizarCostos(ACTOR, { fetchImpl: fakeFetch, adminKeyOverride: "sk-ant-admin01-FAKE" });
    assert.ok(sync.ok, "sync ok");
    s = await saldoRPC();
    assert.equal(s.hay_snapshot, true, "ya hay snapshot");
    assert.equal(Number(s.costo_oficial_usd), 0.08, "costo oficial = US$0.08");
    assert.equal(Number(s.saldo_calculado_usd), 25.92, "saldo = 26 − 0.08 = 25.92 (cargas USD5 − costos ≈ 4.92 en el caso real)");

    // ── Cambio de mes NO reinicia el saldo (es acumulado, no mensual) ────────
    // (el saldo depende de movimientos+snapshot, no del período; ya validado arriba)

    // ── Conciliación: preview + commit (conserva historial) ──────────────────
    const prev = await conciliar({ observadoUsd: "26.000000", confirmar: false, actor: ACTOR });
    assert.ok(prev.ok && !prev.committed, "preview sin commit");
    assert.equal(Number(prev.saldo_calculado_usd), 25.92, "calculado 25.92");
    assert.equal(Number(prev.diferencia_usd), 0.08, "diferencia +0.08");
    const com = await conciliar({ observadoUsd: "26.000000", confirmar: true, motivo: "uso Playground", actor: ACTOR });
    assert.ok(com.ok && com.committed, "commit");
    s = await saldoRPC();
    assert.equal(Number(s.saldo_calculado_usd), 26, "tras conciliar, saldo = observado 26.00");
    const { count: nConc } = await supabaseAdmin.from("ia_saldo_conciliaciones").select("id", { count: "exact", head: true }).eq("actor", ACTOR);
    assert.equal(nConc, 1, "conciliación registrada (historial)");

    // ── Decimales exactos (sin floating point) ───────────────────────────────
    // cargas ya = 26.08 (incluye la conciliación +0.08); +0.1 +0.2 = 26.38 exacto.
    await registrarMovimiento({ tipo: "carga", importeUsd: "0.100000", fecha: "2026-09-01", descripcion: "centavos", actor: ACTOR });
    await registrarMovimiento({ tipo: "carga", importeUsd: "0.200000", fecha: "2026-09-01", descripcion: "centavos", actor: ACTOR });
    s = await saldoRPC();
    assert.equal(Number(s.cargas_total_usd), 26.38, "26.08 + 0.1 + 0.2 = 26.38 exacto (no 26.379999)");
    assert.ok(!/9999|0001/.test(s.cargas_total_usd), "sin ruido de floating point en el numeric");

    console.log("OK — saldo.integration: cargas 5/20, idempotencia, ajustes, anulación+historial, sync(fake), saldo 25.92, conciliación 26.00, decimales exactos.");
  } finally {
    await limpiar();
    const s = await saldoRPC();
    assert.equal(Number(s.cargas_total_usd), 0, "limpieza: sin cargas ZZTEST");
    assert.equal(s.hay_snapshot, false, "limpieza: sin snapshots ZZTEST");
    console.log("Limpieza ZZTEST verificada (tablas de saldo vacías).");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resumenSaldo, conciliar } from "@/lib/ia/creditos/saldoServer";

// Ejecutar: npx tsx --env-file=.env.test.local lib/ia/creditos/saldo.integration.ts
//
// El ledger de crédito y consumo es GLOBAL: un saldo, un consumo acumulado y una última
// conciliación para toda la instalación. Varios invariantes de acá necesitan que exista una
// conciliación ANTERIOR con baseline: es la que demuestra que el consumo previo no se
// descuenta dos veces. Antes el test leía la conciliación real del administrador, lo que lo
// ataba al saldo y al consumo verdaderos de SIM. Ahora ARMA esa conciliación previa, sintética
// y por el camino real —conciliar() calcula el baseline del lado del servidor— y la borra al
// terminar. No lee el saldo real, ni consumos reales, ni registros reales de ia_ejecuciones.
//
// Todo lo que escribe lleva la marca de abajo y se valida por DELTAS.

const MARCA = "zztest-4b51";
// La conciliación sintética PREEXISTENTE: el punto de partida que el test necesita encontrar.
const PREVIO = `${MARCA}-previo`;
async function saldoUsd(): Promise<number> { return Number((await resumenSaldo()).saldo.saldo_usd); }

async function limpiar() {
  await supabaseAdmin.from("ia_ejecuciones").delete().like("modelo", `${MARCA}%`);
  // Conciliaciones ANTES que movimientos: la conciliación referencia el movimiento (FK).
  // `like`, no `eq`: alcanza también a la conciliación previa sintética.
  await supabaseAdmin.from("ia_saldo_conciliaciones").delete().like("actor", `${MARCA}%`);
  await supabaseAdmin.from("ia_creditos_movimientos").delete().like("actor", `${MARCA}%`);
}

async function main() {
  await limpiar();
  // Censo previo: al final el ledger tiene que volver exactamente a este número.
  const { count: movAntes } = await supabaseAdmin.from("ia_creditos_movimientos").select("id", { count: "exact", head: true });

  // ── Escenario de partida, sintético ──────────────────────────────────────────
  // Un consumo anterior a la conciliación (así el baseline B queda > 0 y el invariante
  // S − (C − B) no es trivial) y la conciliación que lo fija, hecha con conciliar(), que
  // es quien calcula el baseline en el servidor.
  await supabaseAdmin.from("ia_ejecuciones").insert({ modelo: `${PREVIO}-consumo`, proveedor: "anthropic", tokens_in: 4000, tokens_out: 400, estado: "completa", costo_estimado: 0.004, precios_version: "test", created_at: "2026-08-15T12:00:00.000Z" });
  const previa = await conciliar({ observadoUsd: "5.00", confirmar: true, motivo: "escenario sintetico previo", actor: PREVIO });
  assert.ok(previa.ok && previa.committed, "la conciliación previa sintética se registra");
  const { data: concPrevia } = await supabaseAdmin.from("ia_saldo_conciliaciones").select("id, saldo_observado_usd, costo_interno_baseline").eq("actor", PREVIO).order("created_at", { ascending: false }).limit(1).maybeSingle();
  assert.ok(concPrevia && concPrevia.costo_interno_baseline != null, "la conciliación previa quedó con baseline");
  assert.ok(Number(concPrevia!.costo_interno_baseline) > 0, "y el baseline previo es > 0: hubo consumo antes de conciliar");
  const baselinePrevio = concPrevia!.costo_interno_baseline;

  try {
    const base = await saldoUsd();
    console.log("saldo base (escenario sintético):", base.toFixed(6));

    // ── Nueva ejecución REAL reduce el saldo (C sube; es posterior a la conciliación) ──
    const t = new Date().toISOString();
    await supabaseAdmin.from("ia_ejecuciones").insert({ modelo: `${MARCA}-real`, proveedor: "anthropic", tokens_in: 10000, tokens_out: 1000, estado: "completa", costo_estimado: 0.01, precios_version: "test", created_at: t });
    const s1 = await saldoUsd();
    assert.ok(Math.abs((base - s1) - 0.01) < 1e-6, `nueva ejecución real de US$0.01 baja el saldo 0.01 (base ${base} → ${s1})`);

    // ── Fake NO consume ──────────────────────────────────────────────────────────
    await supabaseAdmin.from("ia_ejecuciones").insert({ modelo: `${MARCA}-fake`, proveedor: "fake", tokens_in: 999999, tokens_out: 99999, estado: "completa", costo_estimado: 5, precios_version: "test", created_at: t });
    const s2 = await saldoUsd();
    assert.ok(Math.abs(s2 - s1) < 1e-9, "una ejecución fake no cambia el saldo");

    // ── El consumo PREVIO (baseline B) no se descuenta dos veces ─────────────────
    // Invariante leído de la base, sin hardcode: saldo_base = S − (C_total − B).
    // Como B ya contiene el consumo pre-conciliación, sólo (C−B) se resta → no se duplica.
    const { data: cRpc } = await supabaseAdmin.rpc("ia_costo_interno_acumulado", { p_hasta: null });
    const S = Number(concPrevia!.saldo_observado_usd), B = Number(baselinePrevio), C = Number(cRpc);
    // base incluye la ejecución ZZTEST de 0.01 insertada arriba → comparo contra s1 (antes de esa) sería base.
    const esperado = S - (C - B); // C aquí ya incluye la ZZTEST-real (0.01) y NO la fake
    assert.ok(Math.abs(base - esperado) < 1e-6 || Math.abs(s1 - esperado) < 1e-6, `saldo = S − (C − B): el consumo previo (B=${B}) no se resta de nuevo`);
    const s3 = s2;

    // ── Carga posterior aumenta el saldo (M > 0) ─────────────────────────────────
    await supabaseAdmin.from("ia_creditos_movimientos").insert({ tipo: "carga", importe_usd: 20, fecha: "2026-09-02", descripcion: "ZZTEST carga posterior", actor: MARCA, referencia: MARCA, estado: "confirmado" });
    const s4 = await saldoUsd();
    assert.ok(Math.abs((s4 - s3) - 20) < 1e-6, `carga posterior de US$20 sube el saldo 20 (${s3} → ${s4})`);

    // ── conciliar() snapshotea B = costo interno ACTUAL; no acepta baseline del cliente ──
    const prev = await conciliar({ observadoUsd: "3.00", confirmar: false, actor: MARCA });
    assert.ok(prev.ok && !prev.committed && Number(prev.baseline_usd) > 0, "preview de conciliación calcula el baseline en el servidor");
    // (conciliar sólo recibe observadoUsd; el baseline lo calcula el servidor — anti mass-assignment)
    const com = await conciliar({ observadoUsd: "3.00", confirmar: true, motivo: "zz", actor: MARCA });
    assert.ok(com.ok && com.committed, "commit de conciliación");
    const { data: nueva } = await supabaseAdmin.from("ia_saldo_conciliaciones").select("costo_interno_baseline, saldo_observado_usd").eq("actor", MARCA).order("created_at", { ascending: false }).limit(1).maybeSingle();
    assert.ok(nueva && Number(nueva.costo_interno_baseline) > 0, "la nueva conciliación guardó el baseline exacto del instante");
    // Segunda conciliación reemplaza el punto de partida → saldo ≈ observado (3.00) con consumo posterior ~0.
    const s5 = await saldoUsd();
    assert.ok(Math.abs(s5 - 3.0) < 0.01, `la segunda conciliación reemplaza el baseline → saldo ≈ 3.00 (${s5})`);

    console.log("OK — saldo.integration (4B.5.1): ejecución real baja saldo, fake no consume, consumo previo no se duplica, carga posterior sube, conciliar snapshotea B server-side (anti mass-assignment), segunda conciliación reemplaza baseline.");
  } finally {
    // La conciliación de partida no pudo ser alterada por nada de lo anterior. Se lee ANTES
    // de borrarla, porque es parte de la familia que limpia este test.
    const { data: concDespues } = await supabaseAdmin.from("ia_saldo_conciliaciones").select("costo_interno_baseline").eq("actor", PREVIO).order("created_at", { ascending: false }).limit(1).maybeSingle();
    assert.equal(concDespues?.costo_interno_baseline, baselinePrevio, "el baseline de la conciliación de partida quedó intacto");
    await limpiar();
    // Y no queda residuo: el ledger vuelve a tener los movimientos que tenía antes.
    const { count: movDespues } = await supabaseAdmin.from("ia_creditos_movimientos").select("id", { count: "exact", head: true });
    assert.equal(movDespues, movAntes, "el ledger quedó con la misma cantidad de movimientos que antes del test");
    console.log("Limpieza verificada; el ledger quedó como estaba.");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

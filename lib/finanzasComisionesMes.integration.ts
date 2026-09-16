import { strict as assert } from "node:assert";
import { getComisionesStandMes, rangoMes, ultimoDiaMes, type ComisionesResumen } from "@/lib/finanzas";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Último día del mes que REALMENTE tiene turnos cargados (septiembre está en curso:
// no se puede asumir que haya movimiento hasta el día 30).
async function ultimaFechaConTurnos(mes: string): Promise<string | null> {
  const { desde, hastaExclusivo } = rangoMes(mes);
  const { data, error } = await supabaseAdmin
    .from("turnos_stand")
    .select("fecha")
    .gte("fecha", desde)
    .lt("fecha", hastaExclusivo)
    .or("estado.is.null,estado.neq.cancelado")
    .order("fecha", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.fecha ?? null;
}

// Integración contra la DB REAL (solo LECTURA: no crea ni borra nada).
//
// Verifica el bug de rango mensual con datos reales: antes del fix,
// getComisionesStandMes de un mes de 30 días consultaba `fecha <= '2026-09-31'`,
// Postgres devolvía 400 (22008), el error se descartaba y la comisión quedaba en
// $0 — inflando el saldo teórico de Mercado Pago por ese mismo monto.
//
// Ejecutar:
//   npx tsx --env-file=.env.local lib/finanzasComisionesMes.integration.ts

const MES_30 = "2026-09"; // el mes del bug
const MES_31 = "2026-08"; // control: ya funcionaba, no debe cambiar

const money = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

function mostrar(mes: string, c: ComisionesResumen) {
  console.log(
    `\n${mes}  bruto ${money(c.brutoStand)} · comisión ${money(c.comisionStand)} · neto ${money(c.netoStand)} · tasa ${(c.tasaEfectiva * 100).toFixed(3)}%`
  );
  for (const [proc, v] of Object.entries(c.porProcesador)) {
    console.log(`   procesador ${proc.padEnd(14)} bruto ${money(v.bruto)} · comisión ${money(v.comision)}`);
  }
  for (const [met, v] of Object.entries(c.porMetodo)) {
    console.log(`   método     ${met.padEnd(14)} bruto ${money(v.bruto)} · comisión ${money(v.comision)}`);
  }
  if (c.advertencias.length > 0) {
    console.log(`   ⚠ ${c.advertencias.length} cobro(s) sin procesador → comisión 0%:`);
    for (const a of c.advertencias) {
      console.log(`      ${a.fecha} turno ${a.turno_id} · ${a.metodo_pago} · ${money(a.monto)} · ${a.motivo}`);
    }
  }
}

async function main() {
  // El rango que se le pide a Postgres nunca puede contener un día inexistente.
  assert.deepEqual(
    rangoMes(MES_30),
    { desde: "2026-09-01", hastaExclusivo: "2026-10-01" },
    "septiembre se consulta como [2026-09-01, 2026-10-01)"
  );

  const c30 = await getComisionesStandMes(MES_30);
  const c31 = await getComisionesStandMes(MES_31);
  mostrar(MES_30, c30);
  mostrar(MES_31, c31);

  // ── Mes de 30 días: el fix tiene que devolver datos reales, no ceros ───────
  assert.ok(c30.brutoStand > 0, `${MES_30}: brutoStand > 0 (antes del fix daba 0 por el 400 silenciado)`);
  assert.ok(c30.comisionStand > 0, `${MES_30}: comisionStand > 0`);
  assert.ok(c30.detalle.length > 0, `${MES_30}: hay detalle por pago`);
  assert.equal(c30.sinConfig, false, `${MES_30}: hay configuración de comisiones activa`);
  assert.ok(
    Math.abs(c30.brutoStand - c30.comisionStand - c30.netoStand) < 0.01,
    `${MES_30}: bruto − comisión = neto`
  );
  // Ningún turno del mes puede quedar afuera por el tope del rango. Septiembre
  // está en curso, así que se compara contra el último día con turnos reales.
  const ultima30 = await ultimaFechaConTurnos(MES_30);
  assert.ok(ultima30, `${MES_30}: hay turnos cargados`);
  assert.ok(
    c30.detalle.some((d) => d.fecha === ultima30),
    `${MES_30}: el rango llega hasta el último día con turnos (${ultima30})`
  );
  for (const d of c30.detalle) {
    assert.ok(
      d.fecha >= `${MES_30}-01` && d.fecha <= ultimoDiaMes(MES_30),
      `${MES_30}: ${d.fecha} cae fuera del mes`
    );
  }

  // ── Mes de 31 días: control de no-regresión ───────────────────────────────
  assert.ok(c31.brutoStand > 0, `${MES_31}: brutoStand > 0 (seguía andando antes del fix)`);
  assert.ok(c31.comisionStand > 0, `${MES_31}: comisionStand > 0`);
  assert.ok(
    c31.detalle.some((d) => d.fecha === "2026-08-31"),
    `${MES_31}: el día 31 sigue incluido (el fix no recorta meses de 31 días)`
  );

  console.log("\nOK — finanzasComisionesMes: comisiones reales en meses de 30 y 31 días.");
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

import { strict as assert } from "node:assert";
import { validarPlan, type PlanAnalitico } from "@/lib/ia/analisis/planAnalitico";
import { ejecutarPlanAnalitico } from "@/lib/ia/analisis/ejecutorAnalitico";
import { getIngresosAutomaticos } from "@/lib/finanzas";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/analisis/ejecutorAnalitico.integration.ts
//
// Bloque 5A — lee la base REAL, SOLO LECTURA. Verifica (a) paridad al peso con Finanzas y
// (b) el resultado real de agosto 2026 de lunes a viernes por semana, calculado aparte en SQL.

const MES = "2026-08";
// Verificado con SQL independiente sobre la misma composición de fin_ingresos_por_mes.
const SEMANAS_AGOSTO_LUN_VIE = [
  { clave: "2026-08-03", dias: 5, valor: 1_248_000 },
  { clave: "2026-08-10", dias: 5, valor: 954_000 },
  { clave: "2026-08-17", dias: 5, valor: 1_354_000 },
  { clave: "2026-08-24", dias: 5, valor: 1_042_000 },
  { clave: "2026-08-31", dias: 1, valor: 132_000 },
];
const TOTAL_AGOSTO_LUN_VIE = 4_730_000;
const DIAS_HABILES_AGOSTO = 21;

function plan(input: Record<string, unknown>): PlanAnalitico {
  const v = validarPlan(input);
  assert.equal(v.ok, true, v.ok ? "" : `plan inválido: ${v.error}`);
  return (v as Extract<typeof v, { ok: true }>).plan;
}
async function ejecutar(input: Record<string, unknown>) {
  const r = await ejecutarPlanAnalitico(plan(input));
  assert.equal(r.ok, true, r.ok ? "" : `ejecución fallida: ${r.motivo}`);
  return r as Extract<typeof r, { ok: true }>;
}
const isoDow = (f: string) => {
  const [a, m, d] = f.split("-").map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
};

async function main() {
  // ── Censo previo: al terminar se verifica que NADA cambió ─────────────────────────────────
  const tablas = ["turnos_stand", "reservas", "gift_cards", "campeonato_inscripciones"] as const;
  const censo = async () => {
    const out: Record<string, number> = {};
    for (const t of tablas) {
      const { count, error } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
      if (error) throw error;
      out[t] = count ?? -1;
    }
    return out;
  };
  const antes = await censo();

  // ── LA consulta productiva, calculada de punta a punta ───────────────────────────────────
  {
    const r = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes: MES }, filtros: { dias_semana: [1, 2, 3, 4, 5] }, agrupar_por: "semana" });
    assert.equal(r.filas.length, SEMANAS_AGOSTO_LUN_VIE.length, "agosto 2026 tiene 5 semanas con días hábiles");
    r.filas.forEach((f, i) => {
      const esperada = SEMANAS_AGOSTO_LUN_VIE[i];
      assert.equal(f.clave, esperada.clave, `la semana ${i + 1} arranca el lunes ${esperada.clave}`);
      assert.equal(f.dias, esperada.dias, `la semana ${esperada.clave} tiene ${esperada.dias} día(s) hábil(es)`);
      assert.equal(f.valor, esperada.valor, `la facturación de la semana ${esperada.clave} coincide con el SQL de control`);
      for (const fecha of f.fechas) {
        assert.ok(isoDow(fecha) >= 1 && isoDow(fecha) <= 5, `${fecha} es un día hábil`);
        assert.ok(fecha >= "2026-08-01" && fecha <= "2026-08-31", `${fecha} cae dentro de agosto`);
      }
    });
    assert.equal(r.total, TOTAL_AGOSTO_LUN_VIE, "el total del período coincide con el SQL de control");
    assert.equal(r.totalDias, DIAS_HABILES_AGOSTO, "21 días hábiles con datos");
    assert.ok(r.filas.some((f) => f.fechas.includes("2026-08-31")), "el lunes 31 NO se pierde: forma su propia semana parcial");
    assert.equal(r.filas.reduce((a, f) => a + f.valor, 0), r.total, "las semanas suman exactamente el total");
    assert.equal(r.truncado, false);
  }
  console.log(`OK — agosto 2026, lunes a viernes por semana: 5 semanas, ${DIAS_HABILES_AGOSTO} días hábiles, total $${TOTAL_AGOSTO_LUN_VIE.toLocaleString("es-AR")} (coincide con el SQL de control).`);

  // ── PARIDAD CON FINANZAS: mismo mes, misma plata, al peso ────────────────────────────────
  {
    const fin = await getIngresosAutomaticos(MES);
    const r = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes: MES }, agrupar_por: "fuente" });
    assert.equal(r.total, fin.total, `el total del ejecutor ($${r.total}) debe ser idéntico al de Finanzas ($${fin.total})`);
    for (const [fuente, monto] of Object.entries(fin.totalPorFuente)) {
      const mia = r.filas.find((f) => f.clave === fuente);
      assert.ok(mia, `la fuente "${fuente}" de Finanzas aparece en el resultado`);
      assert.equal(mia!.valor, monto, `la fuente "${fuente}" coincide al peso con Finanzas`);
    }
    assert.equal(r.filas.length, Object.keys(fin.totalPorFuente).length, "no se agrega ni se pierde ninguna fuente");
  }
  console.log("OK — PARIDAD: el total mensual y cada fuente coinciden al peso con Finanzas (fin_ingresos_por_mes).");

  // ── Los filtros particionan: hábiles + fin de semana = mes completo ──────────────────────
  {
    const fin = await getIngresosAutomaticos(MES);
    const habiles = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes: MES }, filtros: { dias_semana: [1, 2, 3, 4, 5] } });
    const finde = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes: MES }, filtros: { dias_semana: [6, 7] } });
    assert.equal(habiles.total + finde.total, fin.total, "lunes-a-viernes + fin de semana reconstruye el mes completo");
    assert.equal(habiles.total, TOTAL_AGOSTO_LUN_VIE);
  }
  console.log("OK — el filtro por día parte el mes sin perder ni duplicar un peso.");

  // ── El calendario se DERIVA: el mismo plan funciona en cualquier mes ─────────────────────
  {
    for (const mes of ["2026-02", "2026-09", "2027-03"]) {
      const r = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes }, filtros: { dias_semana: [1, 2, 3, 4, 5] }, agrupar_por: "semana" });
      for (const f of r.filas) {
        assert.equal(isoDow(f.clave), 1, `la clave de grupo ${f.clave} es un lunes`);
        for (const fecha of f.fechas) {
          assert.ok(fecha.startsWith(mes), `${fecha} pertenece a ${mes}: la semana se recorta al mes pedido`);
          assert.ok(isoDow(fecha) <= 5, `${fecha} es hábil`);
        }
      }
      const claves = r.filas.map((f) => f.clave);
      assert.deepEqual(claves, [...claves].sort(), "las semanas salen en orden cronológico");
    }
  }
  console.log("OK — las semanas se derivan del calendario (lunes reales, recortadas al mes) en febrero, septiembre y marzo del año siguiente.");

  // ── Otras métricas y agrupaciones del contrato ───────────────────────────────────────────
  {
    const porDiaSemana = await ejecutar({ metrica: "turnos", periodo: { mes: MES }, agrupar_por: "dia_semana" });
    assert.ok(porDiaSemana.filas.every((f) => Number(f.clave) >= 1 && Number(f.clave) <= 7));
    assert.equal(porDiaSemana.unidad, "turnos");

    const porMetodo = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes: MES }, agrupar_por: "metodo_pago" });
    assert.equal(Math.round(porMetodo.filas.reduce((a, f) => a + f.valor, 0)), Math.round(porMetodo.total), "los métodos de pago suman el total");

    const soloTurnero = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes: MES }, filtros: { fuente: ["turnero"] } });
    assert.deepEqual(soloTurnero.porFuente.map((f) => f.fuente), ["turnero"], "el filtro por fuente excluye de verdad al resto");
    const fin = await getIngresosAutomaticos(MES);
    assert.equal(soloTurnero.total, fin.totalPorFuente.turnero ?? 0, "el turnero solo coincide con Finanzas");
  }
  console.log("OK — métricas de actividad, agrupación por día de la semana y por método de pago, y filtro por fuente.");

  // ── Un período sin datos no inventa nada ─────────────────────────────────────────────────
  {
    const r = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes: "2020-01" } });
    assert.equal(r.total, 0);
    assert.equal(r.filas.length, 0);
    assert.ok(r.advertencias.some((a) => a.toLowerCase().includes("no hay")), "avisa explícitamente que no hay datos");
  }
  console.log("OK — un período sin datos devuelve cero con aviso, no una cifra inventada.");

  // ── Las fuentes declaradas son internas ──────────────────────────────────────────────────
  {
    const r = await ejecutar({ metrica: "facturacion_bruta", periodo: { mes: MES } });
    assert.equal(r.fuentesInternas.length, 1);
    assert.ok(r.fuentesInternas[0].includes("Finanzas"), "declara de dónde salió el número");
    assert.ok(!JSON.stringify(r).includes("http"), "ninguna fuente externa ni enlace");
  }
  console.log("OK — el resultado declara su fuente interna y no contiene referencias externas.");

  // ── SOLO LECTURA: la base quedó igual ────────────────────────────────────────────────────
  {
    const despues = await censo();
    assert.deepEqual(despues, antes, "el ejecutor no insertó, actualizó ni eliminó una sola fila");
  }
  console.log("OK — SOLO LECTURA: el conteo de filas de las cuatro tablas involucradas quedó idéntico.");

  console.log("\nOK — ejecutor analítico (datos reales): paridad al peso con Finanzas y resultado de agosto verificado contra SQL.");
}

main().catch((e) => { console.error(e); process.exit(1); });

import { strict as assert } from "node:assert";
import { validarPlan, LIMITE_DEFAULT, LIMITE_MAX, RANGO_MAX_DIAS } from "@/lib/ia/analisis/planAnalitico";

// Ejecutar: npx tsx lib/ia/analisis/planAnalitico.test.ts — puro.
//
// Bloque 5A — el plan es la ÚNICA superficie por la que el modelo llega a los datos. Acá se
// verifica que sea un contrato cerrado: sin SQL, sin tablas, sin columnas, sin rangos abusivos.

const ok = (x: ReturnType<typeof validarPlan>) => {
  assert.equal(x.ok, true, x.ok ? "" : `esperaba plan válido y falló: ${x.error}`);
  return (x as Extract<typeof x, { ok: true }>).plan;
};
const falla = (x: ReturnType<typeof validarPlan>, campo?: string) => {
  assert.equal(x.ok, false, "esperaba un plan RECHAZADO");
  const e = x as Extract<typeof x, { ok: false }>;
  assert.ok(e.error && e.error.length > 0, "el rechazo trae un mensaje accionable");
  if (campo) assert.equal(e.campo, campo);
  return e;
};

function main() {
  // ── El plan de la consulta productiva ────────────────────────────────────────────────────
  {
    const plan = ok(validarPlan({ metrica: "facturacion_bruta", periodo: { mes: "2026-08" }, filtros: { dias_semana: [1, 2, 3, 4, 5] }, agrupar_por: "semana" }));
    assert.equal(plan.metrica, "facturacion_bruta");
    assert.equal(plan.ventana.desde, "2026-08-01");
    assert.equal(plan.ventana.hasta, "2026-08-31", "agosto completo, incluido el lunes 31");
    assert.deepEqual(plan.filtros.diasSemana, [1, 2, 3, 4, 5]);
    assert.equal(plan.agruparPor, "semana");
    assert.equal(plan.orden, "cronologico");
    assert.equal(plan.limite, LIMITE_DEFAULT);
  }
  console.log("OK — plan de la consulta productiva: agosto completo, lunes a viernes, agrupado por semana.");

  // ── Días como texto y desordenados/duplicados ────────────────────────────────────────────
  {
    const plan = ok(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, filtros: { dias_semana: ["viernes", "lunes", "Miércoles", "lunes"] } }));
    assert.deepEqual(plan.filtros.diasSemana, [1, 3, 5], "normaliza a ISO, deduplica y ordena");
  }
  console.log("OK — los días se aceptan por nombre o número ISO, deduplicados y ordenados.");

  // ── SEGURIDAD · nada de SQL ──────────────────────────────────────────────────────────────
  {
    falla(validarPlan({ metrica: "facturacion_bruta; DROP TABLE turnos_stand", periodo: { mes: "2026-08" } }), "metrica");
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { mes: "2026-08" }, filtros: { metodo_pago: ["efectivo' OR 1=1--"] } }), "filtros.metodo_pago");
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { mes: "2026-08' UNION SELECT * FROM usuarios --" } }), "periodo.mes");
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { mes: "2026-08" }, agrupar_por: "fuente; DELETE FROM reservas" }), "agrupar_por");
  }
  console.log("OK — SEGURIDAD: cualquier intento de SQL en métrica, filtro, período o agrupación se rechaza.");

  // ── SEGURIDAD · nombres de tabla/columna inventados no llegan al ejecutor ─────────────────
  {
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { mes: "2026-08" }, filtros: { fuente: ["turnos_stand"] } }), "filtros.fuente");
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { mes: "2026-08" }, filtros: { fuente: ["usuarios"] } }), "filtros.fuente");
    // Campos ajenos al contrato se descartan: el plan se construye desde cero, no se copia el input.
    const plan = ok(
      validarPlan({
        metrica: "facturacion_bruta",
        periodo: { mes: "2026-08" },
        tabla: "usuarios",
        columnas: ["email", "telefono"],
        sql: "select * from pagos",
        where: "1=1",
      } as Record<string, unknown>),
    );
    const serializado = JSON.stringify(plan).toLowerCase();
    for (const prohibido of ["tabla", "columna", "sql", "where", "usuarios", "select", "email"]) {
      assert.ok(!serializado.includes(prohibido), `el plan validado no arrastra "${prohibido}"`);
    }
  }
  console.log("OK — SEGURIDAD: tablas, columnas y SQL enviados por el modelo se descartan; el plan se reconstruye desde cero.");

  // ── SEGURIDAD · fuentes según la familia de la métrica ───────────────────────────────────
  {
    ok(validarPlan({ metrica: "facturacion_bruta", periodo: { mes: "2026-08" }, filtros: { fuente: ["turnero", "gift_cards"] } }));
    ok(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, filtros: { fuente: ["stand"] } }));
    falla(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, filtros: { fuente: ["gift_cards"] } }), "filtros.fuente");
    falla(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, filtros: { metodo_pago: ["efectivo"] } }), "filtros.metodo_pago");
    falla(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, agrupar_por: "metodo_pago" }), "agrupar_por");
  }
  console.log("OK — cada métrica solo admite las fuentes y filtros que tienen sentido para su familia.");

  // ── Métricas derivadas: se deriva a la herramienta correcta, no se inventa una definición ──
  {
    for (const [m, esperado] of [["ganancia", "consultar_finanzas"], ["facturacion_neta", "consultar_finanzas"], ["horas_cronograma", "consultar_metricas_equipo"]] as const) {
      const e = falla(validarPlan({ metrica: m, periodo: { mes: "2026-08" } }), "metrica");
      assert.ok(e.error.includes(esperado), `"${m}" deriva a ${esperado}`);
    }
    const e = falla(validarPlan({ metrica: "asistencia_promedio", periodo: { mes: "2026-08" } }), "metrica");
    assert.ok(e.error.includes("facturacion_bruta"), "una métrica desconocida lista las disponibles");
  }
  console.log("OK — métricas no calculables acá derivan explícitamente a la herramienta correcta.");

  // ── Rangos ──────────────────────────────────────────────────────────────────────────────
  {
    ok(validarPlan({ metrica: "facturacion_bruta", periodo: { desde: "2026-08-01", hasta: "2026-08-31" } }));
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { desde: "2026-08-31", hasta: "2026-08-01" } }), "periodo");
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { desde: "2020-01-01", hasta: "2026-12-31" } }), "periodo");
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { mes: "2026-13" } }), "periodo.mes");
    falla(validarPlan({ metrica: "facturacion_bruta", periodo: { desde: "2026-02-30", hasta: "2026-03-01" } }), "periodo");
    falla(validarPlan({ metrica: "facturacion_bruta" }), "periodo");
    // El borde exacto del rango máximo sí entra.
    const desde = "2025-01-01";
    const hasta = new Date(Date.UTC(2025, 0, 1) + (RANGO_MAX_DIAS - 1) * 86_400_000).toISOString().slice(0, 10);
    ok(validarPlan({ metrica: "facturacion_bruta", periodo: { desde, hasta } }));
  }
  console.log(`OK — rangos: invertido, inexistente, ausente y mayor a ${RANGO_MAX_DIAS} días se rechazan; el borde exacto se acepta.`);

  // ── Límite de filas ─────────────────────────────────────────────────────────────────────
  {
    assert.equal(ok(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, limite: LIMITE_MAX })).limite, LIMITE_MAX);
    falla(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, limite: LIMITE_MAX + 1 }), "limite");
    falla(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, limite: 0 }), "limite");
    falla(validarPlan({ metrica: "turnos", periodo: { mes: "2026-08" }, limite: 5.5 }), "limite");
  }
  console.log(`OK — el límite de filas se acota a ${LIMITE_MAX}; los valores absurdos se rechazan.`);

  // ── Períodos relativos con reloj inyectado (sin depender de la fecha real) ───────────────
  {
    const ahora = new Date("2026-08-19T15:00:00Z"); // miércoles 19/08/2026 en Córdoba
    assert.deepEqual(ok(validarPlan({ metrica: "turnos", periodo: { relativo: "este_mes" } }, ahora)).ventana, { desde: "2026-08-01", hasta: "2026-08-31" });
    assert.deepEqual(ok(validarPlan({ metrica: "turnos", periodo: { relativo: "mes_pasado" } }, ahora)).ventana, { desde: "2026-07-01", hasta: "2026-07-31" });
    assert.deepEqual(ok(validarPlan({ metrica: "turnos", periodo: { relativo: "mismo_mes_anio_pasado" } }, ahora)).ventana, { desde: "2025-08-01", hasta: "2025-08-31" });
    assert.deepEqual(ok(validarPlan({ metrica: "turnos", periodo: { relativo: "esta_semana" } }, ahora)).ventana.desde, "2026-08-17", "la semana arranca el lunes");
    falla(validarPlan({ metrica: "turnos", periodo: { relativo: "la_semana_que_viene" } }, ahora), "periodo.relativo");
  }
  console.log("OK — los períodos relativos se resuelven con el reloj de Córdoba y los desconocidos se rechazan.");

  console.log("\nOK — plan analítico (puro): contrato cerrado, sin SQL ni tablas del modelo, con rangos y límites acotados.");
}
main();

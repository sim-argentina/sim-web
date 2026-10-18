import { strict as assert } from "node:assert";
import {
  aplicarFiltros, calcularMetricas, cobertura, compararCantidad, compararTasa, diaSemana, embudo, franjaDe, periodo,
  rangoAnterior, rangoRapido, tamanoDe, tasa, validarParamsMetricas,
  type EmpleadoRef, type FilaAnalisis, type FilaCobertura,
} from "@/lib/interaccionesMetricas";

// Interacciones del stand · métricas puras (Bloque 4). Sin base, sin red.
// Ejecutar: npx tsx lib/interaccionesMetricas.test.ts

let seq = 0;
function fila(p: Partial<FilaAnalisis>): FilaAnalisis {
  seq++;
  return {
    interaccion_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    fecha_negocio: "2026-10-05", hora_negocio: "15:00:00", resultado: "miro", personas_grupo: 1,
    hombres: null, mujeres: null, rango_etario: null, conocia_sim: null, se_subio_antes: null, iniciador: null,
    atendio_empleado_id: null, motivo: null, vinculo_estado: "no_aplica", turnos_vinculados: 0, turnos_activos: 0,
    turnos_pagos: 0, turnos_gratis: 0, turnos_pago_contradictorio: 0, participaciones: 0, venta_verificada: false,
    ...p,
  };
}
const varias = (n: number, p: Partial<FilaAnalisis>) => Array.from({ length: n }, () => fila(p));
const v = (t: { valor: number | null }) => (t.valor === null ? null : Math.round(t.valor * 10000) / 10000);

async function main() {
  // ── 1. Ejemplo de referencia: 10 / 5 / 3 → 18 / 8 / 3 ─────────────────
  {
    const filas = [...varias(10, { resultado: "miro" }), ...varias(5, { resultado: "pregunto" }), ...varias(3, { resultado: "subio", vinculo_estado: "pendiente" })];
    const e = embudo(filas);
    assert.deepEqual(e.exclusivos, { miro: 10, pregunto: 5, subio: 3 }, "distribución exclusiva 10/5/3");
    assert.deepEqual([e.miraron, e.preguntaron, e.subieron], [18, 8, 3], "embudo acumulativo 18/8/3");
    assert.deepEqual(e.tasas.miro_pregunto, { num: 8, den: 18, valor: 8 / 18 });
    assert.deepEqual(e.tasas.pregunto_subio, { num: 3, den: 8, valor: 3 / 8 });
    assert.deepEqual(e.tasas.miro_subio, { num: 3, den: 18, valor: 3 / 18 });
    assert.equal(e.interacciones, 18);
  }

  // ── 2. Denominadores 0, "Sin base" y % frente a puntos porcentuales ─────
  {
    const vacio = embudo([]);
    assert.deepEqual(vacio.tasas.miro_subio, { num: 0, den: 0, valor: null }, "sin denominador → Sin datos");
    assert.equal(vacio.tamano_promedio, null);
    assert.deepEqual(compararCantidad(5, 0), { actual: 5, anterior: 0, diferencia: 5, variacion: null }, "base 0 → Sin base");
    assert.deepEqual(compararCantidad(15, 10), { actual: 15, anterior: 10, diferencia: 5, variacion: 0.5 }, "cantidades en %");
    assert.equal(Math.round(compararTasa(tasa(3, 10), tasa(1, 5)).diferencia_pp! * 1e6) / 1e6, 10, "tasas en puntos: 30% − 20% = 10 pp");
    assert.equal(compararTasa(tasa(3, 10), tasa(0, 0)).diferencia_pp, null, "si una no tiene denominador → Sin datos");
  }

  // ── 3. Personas, participaciones, pago/gratis/contradictorio, estados ───
  {
    const filas = [
      fila({ resultado: "subio", personas_grupo: 2, vinculo_estado: "con_turno", turnos_vinculados: 2, turnos_activos: 2, turnos_pagos: 2, participaciones: 4, venta_verificada: true }),
      fila({ resultado: "subio", personas_grupo: 3, vinculo_estado: "con_turno", turnos_vinculados: 1, turnos_activos: 1, turnos_gratis: 1, participaciones: 3 }),
      fila({ resultado: "subio", personas_grupo: 1, vinculo_estado: "con_turno", turnos_vinculados: 1, turnos_activos: 1, turnos_pagos: 1, turnos_pago_contradictorio: 1, participaciones: 1, venta_verificada: true }),
      fila({ resultado: "subio", personas_grupo: 2, vinculo_estado: "pendiente" }),
      fila({ resultado: "subio", personas_grupo: 4, vinculo_estado: "cerrada_sin_turno" }),
      fila({ resultado: "pregunto", personas_grupo: 5 }),
    ];
    const m = calcularMetricas(filas, null, new Map());
    assert.equal(m.embudo.personas, 17, "personas observadas = suma de grupos");
    assert.equal(m.embudo.tamano_promedio, 17 / 6);
    assert.deepEqual(m.vinculo, {
      subidas_declaradas: 5, con_turno: 3, con_turno_pago: 2, turno_no_activo: 0, pendientes: 1, cerradas_sin_turno: 1,
      con_pago_contradictorio: 1, turnos_vinculados: 4, participaciones: 8,
    });
    assert.equal(m.vinculo.participaciones > 2, true, "2 personas que juegan dos veces = 4 participaciones, no 4 personas");
    assert.equal(m.embudo.subieron, 5, "las gratis también \"se subieron\"");
    assert.equal(m.vinculo.pendientes + m.vinculo.cerradas_sin_turno + m.vinculo.con_turno, 5, "estados del vínculo de las subidas");
  }

  // ── 4. Períodos frente al inicio del registro (Córdoba) ─────────────────
  {
    const inicio = "2026-11-01T03:00:00+00:00"; // 01/11 00:00 Cba
    assert.deepEqual(periodo("2026-10-02", "2026-10-31", inicio, "2026-11-18").estado, "sin_registro", "antes del inicio: sin datos de registro");
    const parcial = periodo("2026-10-26", "2026-11-05", inicio, "2026-11-18");
    assert.deepEqual([parcial.estado, parcial.cubierto], ["parcial", { desde: "2026-11-01", hasta: "2026-11-05", dias: 5 }]);
    assert.equal(parcial.dias, 11);
    assert.deepEqual(periodo("2026-11-02", "2026-11-08", inicio, "2026-11-18").estado, "completo");
    assert.deepEqual(periodo("2026-11-10", "2026-11-25", inicio, "2026-11-18").cubierto, { desde: "2026-11-10", hasta: "2026-11-18", dias: 9 }, "nunca después de hoy");
    assert.equal(periodo("2026-11-01", "2026-11-05", null, "2026-11-18").estado, "sin_inicio");
    // Inicio a las 02:59 UTC del 01/11 = 31/10 23:59 en Córdoba: el 31/10 ya tiene registro.
    assert.equal(periodo("2026-10-31", "2026-10-31", "2026-11-01T02:59:00Z", "2026-11-18").estado, "completo");
    assert.deepEqual(rangoRapido("hoy", "2026-10-18"), { desde: "2026-10-18", hasta: "2026-10-18" });
    assert.deepEqual(rangoRapido("7d", "2026-10-18"), { desde: "2026-10-12", hasta: "2026-10-18" }, "7 días inclusivos");
    assert.deepEqual(rangoRapido("30d", "2026-10-18"), { desde: "2026-09-19", hasta: "2026-10-18" });
    assert.deepEqual(rangoAnterior("2026-10-12", "2026-10-18"), { desde: "2026-10-05", hasta: "2026-10-11" }, "mismo largo, justo antes");
  }

  // ── 5. Franjas sin duplicar, "otros" y días de la semana ────────────────
  {
    assert.equal(franjaDe("10:00:00"), "10-12");
    assert.equal(franjaDe("11:59:59"), "10-12");
    assert.equal(franjaDe("12:00:00"), "12-14", "el borde es de la franja siguiente");
    assert.equal(franjaDe("21:59:59"), "20-22");
    assert.equal(franjaDe("22:00:00"), "otros");
    assert.equal(franjaDe("09:59:00"), "otros");
    assert.equal(franjaDe("00:30:00"), "otros");
    const filas = ["09:59:00", "10:00:00", "11:59:59", "12:00:00", "21:59:59", "22:00:00", "23:30:00"].map((h) => fila({ hora_negocio: h }));
    const m = calcularMetricas(filas, null, new Map());
    assert.equal(m.franjas.reduce((a, f) => a + f.embudo.interacciones, 0), filas.length, "cada registro en UNA franja");
    assert.deepEqual(m.franjas.map((f) => f.embudo.interacciones), [2, 1, 0, 0, 0, 1, 3]);
    assert.equal(diaSemana("2026-10-19"), 0, "lunes");
    assert.equal(diaSemana("2026-10-18"), 6, "domingo");
    // La fecha es la de negocio (Córdoba) que ya trae la vista: 23:30 del sábado sigue siendo sábado.
    const sab = calcularMetricas([fila({ fecha_negocio: "2026-10-17", hora_negocio: "23:30:00" })], null, new Map());
    assert.equal(sab.dias_semana[5].embudo.interacciones, 1);
  }

  // ── 6. Perfil: "No sabe" ≠ sin dato, perfiles parciales, género con cobertura ──
  {
    const filas = [
      fila({ conocia_sim: "no_sabe", personas_grupo: 2, hombres: 1, mujeres: 1, rango_etario: "18_24", resultado: "subio" }),
      fila({ conocia_sim: "no", personas_grupo: 3, hombres: 3, mujeres: 0 }),
      fila({ conocia_sim: null, personas_grupo: 4 }),
      fila({ conocia_sim: "si", personas_grupo: 1, rango_etario: "50_mas", resultado: "subio" }),
    ];
    const p = calcularMetricas(filas, null, new Map()).perfil;
    const c = Object.fromEntries(p.conocia_sim.valores.map((x) => [x.valor, x.n]));
    assert.deepEqual(c, { si: 1, no: 1, no_sabe: 1 }, "\"No sabe\" se cuenta aparte, no se fusiona con No");
    assert.deepEqual([p.conocia_sim.sin_dato, p.conocia_sim.con_dato, p.conocia_sim.total], [1, 3, 4]);
    assert.deepEqual(p.conocia_sim.valores.find((x) => x.valor === "no")!.pct, { num: 1, den: 3, valor: 1 / 3 }, "% sobre los que tienen dato");
    assert.deepEqual(p.genero, {
      registros_con_desglose: 2, personas_con_desglose: 5, hombres: 4, mujeres: 1,
      cobertura: { num: 5, den: 10, valor: 0.5 }, hombres_pct: { num: 4, den: 5, valor: 0.8 }, mujeres_pct: { num: 1, den: 5, valor: 0.2 },
    }, "género solo entre registros con desglose, con su cobertura");
    assert.deepEqual([p.rango_etario.con_dato, p.rango_etario.sin_dato], [2, 2], "rango: grupos por rango aproximado + sin dato");
    assert.deepEqual(p.conocia_sim.valores.find((x) => x.valor === "si")!.miro_subio, { num: 1, den: 1, valor: 1 });
    assert.deepEqual(p.tamano.map((t) => t.n), [1, 1, 1, 1, 0]);
    assert.equal(tamanoDe(7), "5+");
  }

  // ── 7. Motivos: base = preguntaron y no se subieron; sin motivo aparte; solo miró separado ──
  {
    const filas = [
      ...varias(2, { resultado: "pregunto", motivo: "precio" }),
      fila({ resultado: "pregunto", motivo: "tiempo" }),
      ...varias(2, { resultado: "pregunto" }),
      fila({ resultado: "miro", motivo: "espera" }),
      fila({ resultado: "miro" }),
    ];
    const m = calcularMetricas(filas, null, new Map()).motivos;
    assert.deepEqual([m.base, m.con_motivo, m.sin_motivo], [5, 3, 2]);
    assert.deepEqual(m.cobertura, { num: 3, den: 5, valor: 0.6 });
    assert.deepEqual(m.valores.find((x) => x.motivo === "precio")!.pct, { num: 2, den: 3, valor: 2 / 3 }, "% sobre las que tienen motivo");
    assert.deepEqual([m.solo_miro.base, m.solo_miro.con_motivo, m.solo_miro.valores.find((x) => x.motivo === "espera")!.n], [2, 1, 1]);
    assert.equal(m.valores.reduce((a, x) => a + x.n, 0), 3, "los de solo miró no se suman acá");
  }

  // ── 8. Atendió declarado: inactivo histórico y "Sin asignar" ────────────
  {
    const empleados = new Map<string, EmpleadoRef>([
      ["e1", { id: "e1", nombre: "Ana", activo: true }],
      ["e2", { id: "e2", nombre: "Beto", activo: false }],
    ]);
    const filas = [
      ...varias(3, { atendio_empleado_id: "e1", resultado: "subio" }), fila({ atendio_empleado_id: "e1", resultado: "pregunto" }),
      ...varias(2, { atendio_empleado_id: "e2", resultado: "miro" }),
      fila({ atendio_empleado_id: null, resultado: "subio" }),
    ];
    const a = calcularMetricas(filas, null, empleados).atendio;
    assert.deepEqual(a.map((x) => [x.nombre, x.activo, x.embudo.interacciones]), [["Ana", true, 4], ["Beto", false, 2], ["Sin asignar", true, 1]]);
    assert.deepEqual(a[0].embudo.tasas.miro_subio, { num: 3, den: 4, valor: 0.75 }, "con denominador visible");
  }

  // ── 9. Cobertura: por fecha del turno, pagos/gratis, contradicciones; NO sigue los filtros ──
  {
    const turnos: FilaCobertura[] = [
      { turno_stand_id: "1", fecha: "2026-10-05", es_pago: true, pago_contradictorio: false, vinculado: true },
      { turno_stand_id: "2", fecha: "2026-10-05", es_pago: true, pago_contradictorio: false, vinculado: false },
      { turno_stand_id: "3", fecha: "2026-10-05", es_pago: false, pago_contradictorio: false, vinculado: true },
      { turno_stand_id: "4", fecha: "2026-10-05", es_pago: true, pago_contradictorio: true, vinculado: false },
    ];
    const c = cobertura(turnos);
    assert.deepEqual([c.turnos, c.vinculados, v(c.tasa)], [4, 2, 0.5]);
    assert.deepEqual([c.pagos.total, c.pagos.vinculados, c.gratis.total, c.gratis.vinculados, c.contradictorios.total], [3, 1, 1, 1, 1]);
    // La cobertura se calcula aparte: filtrar interacciones no la cambia.
    const filas = [fila({ rango_etario: "18_24" }), fila({ rango_etario: "25_34" })];
    assert.equal(aplicarFiltros(filas, { rango_etario: "18_24" }).length, 1);
    assert.deepEqual(cobertura(turnos), c, "independiente de los filtros de perfil");
  }

  // ── 10. Filtros (incluido sin dato / sin motivo / sin asignar) y serie diaria con ceros ──
  {
    const filas = [
      fila({ resultado: "subio", hora_negocio: "10:30:00", rango_etario: "18_24", atendio_empleado_id: "e1", personas_grupo: 6 }),
      fila({ resultado: "pregunto", hora_negocio: "12:00:00", motivo: "precio" }),
      fila({ resultado: "pregunto", hora_negocio: "22:10:00" }),
      fila({ resultado: "miro", fecha_negocio: "2026-10-07" }),
    ];
    assert.equal(aplicarFiltros(filas, { franja: "10-12" }).length, 1);
    assert.equal(aplicarFiltros(filas, { franja: "otros" }).length, 1);
    assert.equal(aplicarFiltros(filas, { motivo: "sin_motivo" }).length, 3);
    assert.equal(aplicarFiltros(filas, { rango_etario: "sin_dato" }).length, 3);
    assert.equal(aplicarFiltros(filas, { atendio: "sin_asignar" }).length, 3);
    assert.equal(aplicarFiltros(filas, { tamano: "5+" }).length, 1);
    assert.equal(aplicarFiltros(filas, { resultado: "pregunto", franja: "12-14" }).length, 1);
    const serie = calcularMetricas(filas, { desde: "2026-10-04", hasta: "2026-10-07" }, new Map()).serie;
    assert.deepEqual(serie.map((s) => [s.fecha, s.interacciones, s.miraron, s.preguntaron, s.subieron]), [
      ["2026-10-04", 0, 0, 0, 0], ["2026-10-05", 3, 3, 3, 1], ["2026-10-06", 0, 0, 0, 0], ["2026-10-07", 1, 1, 0, 0],
    ], "días sin cargas = 0 interacciones registradas (no ausencia de público)");
  }

  // ── 11. Parámetros de la API de métricas ─────────────────────────────────
  {
    const ok = validarParamsMetricas(new URLSearchParams("desde=2026-11-01&hasta=2026-11-18&comp_desde=2026-10-14&comp_hasta=2026-10-31&rango_etario=sin_dato&franja=otros"));
    assert.ok(ok.ok && ok.valor.comparar?.desde === "2026-10-14" && ok.valor.filtros.rango_etario === "sin_dato" && ok.valor.filtros.franja === "otros");
    for (const malo of ["desde=2026-11-18&hasta=2026-11-01", "desde=2025-01-01&hasta=2026-10-18", "desde=2026-11-01", "desde=2026-11-01&hasta=2026-11-02&rol=admin",
      "desde=2026-11-01&hasta=2026-11-02&resultado=compro", "desde=2026-11-01&hasta=2026-11-02&comp_desde=2026-09-01", "desde=2026-11-01&hasta=2026-11-02&atendio=Juan"]) {
      assert.equal(validarParamsMetricas(new URLSearchParams(malo)).ok, false, malo);
    }
  }

  console.log("OK — Interacciones · métricas puras (Bloque 4): 10/5/3 → 18/8/3 con 8/18, 3/8, 3/18; denominador 0 = Sin datos; % y pp; participaciones ≠ personas; pago, gratis y contradicciones; pendientes y cierres; períodos anterior/parcial/posterior al inicio; franjas sin duplicar con \"otros\"; No sabe ≠ sin dato; perfiles parciales; atendió inactivo y Sin asignar; cobertura independiente de filtros; serie con días en cero; parámetros validados.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

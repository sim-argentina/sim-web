// CONTRATO del escenario histórico sintético (db/fixtures-ia-historico.sql).
//
//   IA_PROVIDER=fake npx tsx --env-file=.env.test.local scripts/pruebas/contrato-historico-ia.ts
//
// Pregunta al MOTOR REAL —la composición canónica de Finanzas, el motor analítico, el
// planificador multiherramienta y el cronograma— y comprueba cada invariante numérico que
// las suites de IA SIM dan por cierto. Si alguno no coincide, las suites NO deben empezar:
// fallarían por el fixture y no por el código, y el mensaje de abajo dice exactamente qué
// invariante se rompió.
//
// Solo lee datos de negocio. El guardián va primero igual: si el destino no es la base
// local de pruebas, el proceso aborta antes de tocar nada.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { ejecutarPlanAnalitico, type ResumenGrupo } from "@/lib/ia/analisis/ejecutorAnalitico";
import { validarPlan } from "@/lib/ia/analisis/planAnalitico";
import { validarPlanMulti } from "@/lib/ia/plan/planMulti";
import { accesoDesdeRegistro } from "@/lib/ia/plan/capacidades";
import { ejecutarPlanMulti } from "@/lib/ia/plan/ejecutorPlan";
import { renderResultadoPlan } from "@/lib/ia/plan/renderPlan";
import { HERRAMIENTAS } from "@/lib/ia/tools";
import { getHorasMensuales } from "@/lib/cronogramaServer";

const MARCA = "TEST_IA_HIST_2026";

// El contrato aprobado. Es la misma tabla que verifica scripts/pruebas/generar-historico-ia.mjs,
// pero del otro lado: allá se comprueba la aritmética del reparto, acá lo que devuelve el motor.
const C = {
  ago: { total: 13_454_000, turnero: 10_258_000, manuales: 2_950_000, campeonatos: 120_000, reservas: 126_000, turnos: 912, personas: 822, minutos: 13_680, horas: 414 },
  sep: { total: 10_440_000, turnero: 9_454_000, manuales: 670_000, campeonatos: 240_000, reservas: 76_000, turnos: 826, personas: 738, minutos: 12_390, horas: 405.08 },
  // Las dos filas del desglose aprobado. Los ceros son parte del contrato: el servidor los
  // publica como $0, nunca como un guion.
  habiles: { dias: 21, total: 7_680_000, promedio: 365_714.29, mejor: "18 de agosto", mejorMonto: 1_720_000,
    fuentes: { turnero: 4_690_000, manuales: 2_950_000, campeonatos: 40_000, reservas_online: 0 } },
  finde: { dias: 10, total: 5_774_000, promedio: 577_400, mejor: "15 de agosto", mejorMonto: 878_000,
    fuentes: { turnero: 5_568_000, manuales: 0, campeonatos: 80_000, reservas_online: 126_000 } },
  mes: { dias: 31, promedio: 434_000 },
  semanas: { "2026-08-03": 1_348_000, "2026-08-10": 1_004_000, "2026-08-17": 2_954_000, "2026-08-24": 2_242_000, "2026-08-31": 132_000 },
  // `diferencia` y `variacionPct` son lo que calcula el motor (dos decimales). Las filas son
  // la tabla publicada, donde el porcentaje va con un decimal: es el contrato aprobado y es
  // textualmente lo que verifica servidor5c.
  delta: { facturacion: -3_014_000, facturacionPct: -22.4, turnos: -86, turnosPct: -9.43, horas: -8.92, horasPct: -2.15 },
  filas: [
    "| Facturación bruta | $13.454.000 | $10.440.000 | -$3.014.000 | -22,4% |",
    "| Turnos comerciales | 912 | 826 | -86 | -9,4% |",
    "| Horas programadas | 414 h | 405,08 h | -8,92 h | -2,2% |",
    "| Ingresos manuales | $2.950.000 | $670.000 | -$2.280.000 |",
  ],
  deltaFuentes: { turnero: -804_000, manuales: -2_280_000, campeonatos: 120_000, reservas_online: -50_000 },
};

let fallos = 0;
function invariante(nombre: string, fn: () => void) {
  try { fn(); console.log(`  ok   ${nombre}`); }
  catch (e) { fallos++; console.error(`  FALLA ${nombre}\n        ${(e as Error).message.split("\n")[0]}`); }
}

const FUENTE_DE = { turnero: "turnero", manuales: "manuales", campeonatos: "campeonatos", reservas: "reservas_online" } as const;

async function analitica(input: Record<string, unknown>) {
  const v = validarPlan(input);
  assert.equal(v.ok, true, `el plan del contrato no es válido: ${v.ok ? "" : v.error}`);
  if (!v.ok) throw new Error("plan inválido");
  const r = await ejecutarPlanAnalitico(v.plan);
  assert.ok(r.ok, "el plan del contrato no se pudo ejecutar");
  if (!r.ok) throw new Error("no ejecutó");
  return r;
}
const valor = (vals: Array<{ metrica: string; valor: number }>, metrica: string) =>
  vals.find((v) => v.metrica === metrica)?.valor ?? 0;
const fuente = (g: ResumenGrupo, f: string, metrica = "facturacion_bruta") =>
  valor(g.porFuente.find((x) => x.fuente === f)?.valores ?? [], metrica);

async function main() {
  console.log(`Contrato del escenario ${MARCA} — contra el motor real, solo lectura.\n`);

  // ── 1) Totales del mes y por fuente ───────────────────────────────────────
  for (const [nombre, mes, esp] of [["agosto", "2026-08", C.ago], ["septiembre", "2026-09", C.sep]] as const) {
    const r = await analitica({ metricas: ["facturacion_bruta"], periodo: { mes }, dimensiones: ["fuente"] });
    invariante(`${nombre}: facturación bruta $${esp.total.toLocaleString("es-AR")}`, () => {
      assert.equal(valor(r.resumen.totales, "facturacion_bruta"), esp.total);
    });
    for (const [clave, id] of Object.entries(FUENTE_DE)) {
      invariante(`${nombre}: ${id} $${(esp as Record<string, number>)[clave].toLocaleString("es-AR")}`, () => {
        assert.equal(fuente(r.resumen, id), (esp as Record<string, number>)[clave]);
      });
    }
    invariante(`${nombre}: sin Gift Cards ni Mensualidades`, () => {
      const extra = r.resumen.porFuente.filter((f) => f.fuente === "gift_cards" || f.fuente === "mensualidades");
      assert.deepEqual(extra, [], `aparecieron fuentes que el contrato excluye: ${extra.map((f) => f.fuente).join(", ")}`);
    });
  }

  // ── 2) Actividad: turnos, personas y minutos ──────────────────────────────
  for (const [nombre, mes, esp] of [["agosto", "2026-08", C.ago], ["septiembre", "2026-09", C.sep]] as const) {
    const r = await analitica({ metricas: ["turnos", "personas", "minutos_actividad"], periodo: { mes } });
    invariante(`${nombre}: ${esp.turnos} turnos comerciales`, () => assert.equal(valor(r.resumen.totales, "turnos"), esp.turnos));
    invariante(`${nombre}: ${esp.personas} personas`, () => assert.equal(valor(r.resumen.totales, "personas"), esp.personas));
    invariante(`${nombre}: ${esp.minutos} minutos de actividad`, () => assert.equal(valor(r.resumen.totales, "minutos_actividad"), esp.minutos));
  }

  // ── 3) Horas programadas del cronograma confirmado ────────────────────────
  for (const [nombre, mes, esp] of [["agosto", 8, C.ago], ["septiembre", 9, C.sep]] as const) {
    const h = await getHorasMensuales(2026, mes);
    invariante(`${nombre}: cronograma confirmado y ${esp.horas} h programadas`, () => {
      assert.ok(h, "el mes tiene que existir en estado borrador o confirmado");
      assert.equal(h!.estado, "confirmado", "el mes tiene que estar CONFIRMADO para ser oficial");
      const minutos = h!.integrantes.reduce((a, x) => a + Number(x.minutos || 0), 0);
      assert.equal(Math.round((minutos / 60) * 100) / 100, esp.horas);
    });
  }
  // El reparto POR INTEGRANTE no es decorativo: lib/ia/informes/completar.integration.ts
  // afirma que Federico tiene 194 h (11.640 min) en agosto, y de ahí sale el valor crudo
  // que el informe publica con la unidad en columna aparte. Si el reparto cambia, se
  // entera acá y no diez suites más adelante.
  const horasAgosto = await getHorasMensuales(2026, 8);
  invariante("agosto: el integrante de la mañana suma 11.640 min (194 h)", () => {
    const por = Object.fromEntries((horasAgosto?.integrantes ?? []).map((x) => [x.nombre, Number(x.minutos || 0)]));
    assert.equal(por["Federico"], 11_640, `Federico tiene ${por["Federico"]} min`);
    assert.equal(por["Francisco"], 13_200, `Francisco tiene ${por["Francisco"]} min`);
    assert.equal(por["Ramiro"] ?? 0, 0, "el integrante de respaldo no suma minutos: la ventana queda cubierta");
  });

  // ── 4) Segmentación de agosto: la consulta de aceptación de 5B ────────────
  {
    const r = await analitica({
      metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" },
      segmentacion: { tipo: "dias_semana", grupo_a: ["habiles"], grupo_b: ["fin_de_semana"] },
      calculos: ["promedio_dia_calendario", "maximo"],
    });
    invariante("agosto: la consulta de aceptación devuelve dos grupos", () => {
      assert.ok(r.segmentos, "el plan segmentado tiene que devolver segmentos");
      assert.equal(r.segmentos!.length, 2);
    });
    if (r.segmentos?.length === 2) {
      const [hab, fds] = r.segmentos;
      for (const [nombre, g, esp] of [["lunes a viernes", hab, C.habiles], ["sábados y domingos", fds, C.finde]] as const) {
        invariante(`${nombre}: ${esp.dias} días calendario`, () => assert.equal(g.diasCalendario, esp.dias));
        invariante(`${nombre}: total $${esp.total.toLocaleString("es-AR")}`, () => assert.equal(valor(g.totales, "facturacion_bruta"), esp.total));
        invariante(`${nombre}: promedio por día $${esp.promedio.toLocaleString("es-AR")}`, () => assert.equal(valor(g.promedioDiaCalendario, "facturacion_bruta"), esp.promedio));
        invariante(`${nombre}: mejor día ${esp.mejor} con $${esp.mejorMonto.toLocaleString("es-AR")}`, () => {
          assert.equal(g.mejor?.etiqueta, esp.mejor);
          assert.equal(valor(g.mejor?.valores ?? [], "facturacion_bruta"), esp.mejorMonto);
        });
        for (const [id, monto] of Object.entries(esp.fuentes)) {
          invariante(`${nombre}: ${id} $${monto.toLocaleString("es-AR")}`, () => assert.equal(fuente(g, id), monto));
        }
      }
      invariante("agosto: los dos grupos cierran el total del mes", () => {
        assert.equal(valor(hab.totales, "facturacion_bruta") + valor(fds.totales, "facturacion_bruta"), C.ago.total);
      });
    }
    invariante(`agosto: ${C.mes.dias} días calendario y promedio $${C.mes.promedio.toLocaleString("es-AR")}`, () => {
      assert.equal(r.resumen.diasCalendario, C.mes.dias);
      assert.equal(valor(r.resumen.promedioDiaCalendario, "facturacion_bruta"), C.mes.promedio);
    });
  }

  // ── 5) Las cinco semanas hábiles de 5A ────────────────────────────────────
  {
    const r = await analitica({ metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { dias_semana: ["habiles"] }, dimensiones: ["semana"] });
    invariante("agosto hábil: cinco semanas, incluida la del lunes 31", () => assert.equal(r.filas.length, 5));
    invariante(`agosto hábil: total $${C.habiles.total.toLocaleString("es-AR")}`, () => assert.equal(valor(r.resumen.totales, "facturacion_bruta"), C.habiles.total));
    const esperadas = Object.entries(C.semanas);
    for (const [i, [lunes, monto]] of esperadas.entries()) {
      invariante(`semana del ${lunes}: $${monto.toLocaleString("es-AR")}`, () => {
        const fila = r.filas[i];
        assert.ok(fila, `falta la fila ${i + 1}`);
        assert.ok(String(fila.claves[0]).includes(lunes), `la fila ${i + 1} es ${fila.claves[0]}, no la semana del ${lunes}`);
        assert.equal(valor(fila.valores, "facturacion_bruta"), monto);
      });
    }
  }

  // ── 6) La comparación de 5C, con el planificador real ─────────────────────
  {
    const plan = {
      objetivo: "Contrato del escenario histórico: agosto contra septiembre",
      pasos: [
        { id: "p1", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["fuente"] } },
        { id: "p2", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-09" }, dimensiones: ["fuente"] } },
        { id: "p3", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["turnos"], periodo: { mes: "2026-08" } } },
        { id: "p4", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["turnos"], periodo: { mes: "2026-09" } } },
        { id: "p5", herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes: 8 } },
        { id: "p6", herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes: 9 } },
      ],
      calculos: [
        { tipo: "diferencia", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "facturacion_bruta" } },
        { tipo: "delta_por_fuente", base: { paso: "p1", metrica: "facturacion_bruta" }, comparado: { paso: "p2", metrica: "facturacion_bruta" } },
        { tipo: "diferencia", base: { paso: "p3", metrica: "turnos" }, comparado: { paso: "p4", metrica: "turnos" } },
        { tipo: "diferencia", base: { paso: "p5", metrica: "horas_programadas" }, comparado: { paso: "p6", metrica: "horas_programadas" } },
      ],
    };
    const v = validarPlanMulti(plan, accesoDesdeRegistro(HERRAMIENTAS));
    assert.equal(v.ok, true, `el plan 5C del contrato no es válido: ${v.ok ? "" : v.error}`);
    if (!v.ok) return;
    const r = await ejecutarPlanMulti(v.plan);

    invariante("plan 5C: ninguna herramienta falló (faltantes 0)", () => assert.deepEqual(r.faltantes, []));
    invariante("plan 5C: ocho evidencias", () => assert.equal(r.evidencias.length, 8));

    const comp = (m: string) => r.comparaciones.find((c) => c.metrica === m);
    invariante(`facturación: -$${Math.abs(C.delta.facturacion).toLocaleString("es-AR")} y ${C.delta.facturacionPct} %`, () => {
      const c = comp("facturacion_bruta");
      assert.ok(c, "falta la comparación de facturación");
      assert.equal(c!.diferencia, C.delta.facturacion);
      assert.equal(c!.variacionPct, C.delta.facturacionPct);
    });
    invariante(`turnos: ${C.delta.turnos} y ${C.delta.turnosPct} %`, () => {
      const c = comp("turnos");
      assert.ok(c, "falta la comparación de turnos");
      assert.equal(c!.diferencia, C.delta.turnos);
      assert.equal(c!.variacionPct, C.delta.turnosPct);
    });
    invariante(`horas programadas: ${C.delta.horas} h y ${C.delta.horasPct} %`, () => {
      const c = comp("horas_programadas");
      assert.ok(c, "falta la comparación de horas");
      assert.equal(c!.diferencia, C.delta.horas);
      assert.equal(c!.variacionPct, C.delta.horasPct);
    });
    invariante("los deltas por fuente suman exactamente la diferencia total", () => {
      // El desglose por fuente vive en el cálculo delta_por_fuente, no en la diferencia.
      const porFuente = r.comparaciones.find((c) => c.tipo === "delta_por_fuente")?.porFuente ?? [];
      assert.ok(porFuente.length > 0, "la comparación no trajo delta por fuente");
      for (const [id, esperado] of Object.entries(C.deltaFuentes)) {
        const f = porFuente.find((x) => x.fuente === id);
        assert.ok(f, `falta el delta de ${id}`);
        assert.equal(f!.delta, esperado, `delta de ${id}`);
      }
      assert.equal(porFuente.reduce((a, f) => a + f.delta, 0), C.delta.facturacion);
    });
    invariante("la lectura es compatible_menor_demanda", () => {
      assert.ok(r.lectura, "el plan tiene que producir una lectura");
      assert.equal(r.lectura!.veredicto, "compatible_menor_demanda");
    });
    invariante("la tabla publicada trae las cuatro filas aprobadas", () => {
      const texto = renderResultadoPlan(r);
      for (const fila of C.filas) assert.ok(texto.includes(fila), `falta la fila: ${fila}`);
    });
  }

  console.log("");
  if (fallos > 0) {
    console.error(`CONTRATO DEL FIXTURE ROTO: ${fallos} invariante(s) no coinciden.`);
    console.error("Las suites de IA SIM no deben correr así: fallarían por el escenario, no por el código.");
    console.error("Revisá db/fixtures-ia-historico.sql (se regenera con scripts/pruebas/generar-historico-ia.mjs).");
    process.exit(1);
  }
  console.log(`CONTRATO OK — el escenario ${MARCA} reproduce las cifras aprobadas de agosto y septiembre de 2026.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

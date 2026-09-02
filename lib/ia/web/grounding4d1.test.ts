import { strict as assert } from "node:assert";
import { estadoPeriodoCalendario, fraseEstado, mesFinalizadoMencionado } from "@/lib/ia/periodo";
import { horasDeActividad, promedioPorDia, neto, maquinasDesdeOperaciones } from "@/lib/ia/web/calculos";
import { esMismaEntidadSIM, clasificarEntidad } from "@/lib/ia/entidad";
import { validarRespuestaMixta } from "@/lib/ia/web/validacion";
import { elegirModelo } from "@/lib/ia/router";

// Ejecutar: npx tsx lib/ia/web/grounding4d1.test.ts — puro, sin red ni DB.

const D = (s: string) => new Date(s + "T12:00:00-03:00");

function main() {
  // ── A. Períodos ──────────────────────────────────────────────────────────────
  const ago = estadoPeriodoCalendario(2026, 8, D("2026-09-02"));
  assert.equal(ago.periodo_calendario, "finalizado", "agosto consultado el 2/9 → finalizado");
  assert.equal(estadoPeriodoCalendario(2026, 9, D("2026-09-02")).periodo_calendario, "en_curso", "septiembre en curso");
  assert.equal(estadoPeriodoCalendario(2025, 12, D("2026-01-01")).periodo_calendario, "finalizado", "cambio de año");
  assert.ok(/pendiente/i.test(fraseEstado(ago, { cronogramaEstado: "confirmado", finanzasEstado: "abierto" })), "finalizado + finanzas abierto → cierre pendiente");
  assert.ok(!/incompleto/i.test(fraseEstado(ago, { cronogramaEstado: "confirmado", finanzasEstado: "abierto" })), "no dice incompleto");
  assert.equal(mesFinalizadoMencionado("datos de agosto de 2026", D("2026-09-02")), true, "detecta mes finalizado mencionado");
  assert.equal(mesFinalizadoMencionado("datos de septiembre de 2026", D("2026-09-02")), false, "mes en curso no finalizado");

  // ── B. Cálculos ──────────────────────────────────────────────────────────────
  const h = horasDeActividad(13560);
  assert.equal(h.resultado, 226, "13560 min = 226 h");
  assert.ok(/actividad de clientes/.test(h.unidad), "unidad: horas de actividad de clientes");
  const pd = promedioPorDia(814, 31, "calendario", "personas", ["Stand"]);
  assert.ok(!("error" in pd) && pd.resultado === 26.3, "814/31 = 26,3 (no 314)");
  const pdErr = promedioPorDia(814, 0, "abiertos", "personas", []);
  assert.ok("error" in pdErr && pdErr.error === "sin_denominador", "sin denominador → no calcula");
  const maq = maquinasDesdeOperaciones(489);
  assert.ok("error" in maq && maq.error === "no_derivable", "489 operaciones NO da máquinas");
  assert.equal(neto(10258000, 83000).resultado, 10175000, "bruto − comisión = neto");

  // ── C. Entidades ─────────────────────────────────────────────────────────────
  assert.equal(esMismaEntidadSIM("SIM Café Racer"), true, "SIM Café Racer = SIM");
  assert.equal(esMismaEntidadSIM("SimCafé Racer"), true, "SimCafé Racer = SIM");
  assert.equal(esMismaEntidadSIM("SIM Argentina"), true, "SIM Argentina = SIM");
  assert.equal(esMismaEntidadSIM("Karting Extremo Córdoba"), false, "otra empresa no es SIM");
  assert.equal(clasificarEntidad({ nombre: "SIM Café Racer", actividadComparable: true, ubicacionCordoba: true }).clase, "misma_entidad", "SIM Café Racer → misma entidad");
  assert.equal(clasificarEntidad({ nombre: "Butacas Pro", esFabricante: true }).clase, "proveedor_o_fabricante", "fabricante → proveedor");
  assert.equal(clasificarEntidad({ nombre: "Red Nacional Sim", esRedNacional: true, ubicacionCordoba: false, actividadComparable: true }).clase, "red_o_plataforma", "red nacional sin sede → plataforma");
  assert.equal(clasificarEntidad({ nombre: "Sim Córdoba Race", actividadComparable: true, ubicacionCordoba: true, vigenciaReciente: true, tieneFuente: true }).clase, "competidor_directo_confirmado", "actividad+Córdoba+vigente+fuente → confirmado");
  assert.equal(clasificarEntidad({ nombre: "Algo Sim", actividadComparable: true }).clase, "competidor_potencial_o_ambiguo", "sin sede/vigencia/fuente → potencial");

  // ── D. Validador (§16.F): respuesta MALA marca todo; respuesta BUENA queda limpia ──
  const MALA = "SIM — Agosto 2026 (incompleto, corte actual): 489 operaciones → aprox. 15-20 máquinas/estaciones operando. Volumen operativo alto y ocupación sostenida; SIM sería el de mayor volumen en Córdoba. Competidor SimCafé Racer: $2.000/5 min, $2-5K/sesión.";
  const vMala = validarRespuestaMixta(MALA, { periodoFinalizado: true, hayBenchmarkCompetidores: false });
  const codes = vMala.advertencias.map((a) => a.codigo);
  for (const c of ["periodo_incompleto_erroneo", "maquinas_derivadas_de_operaciones", "superlativo_sin_benchmark", "entidad_historica_como_competidor", "precio_externo_sin_moneda"]) {
    assert.ok(codes.includes(c), `detecta ${c}`);
  }
  assert.ok(vMala.notas.includes("Verificación automática"), "anexa notas de verificación");

  const BUENA = "**Respuesta directa:** en agosto de 2026 (período finalizado; cronograma confirmado), SIM registró 489 operaciones y 814 personas en Stand. Facturación bruta ARS 10.258.000. 13.560 minutos de actividad de clientes equivalen a 226 horas de actividad de clientes (no horas trabajadas). No hay datos de volumen de otras experiencias, así que no puede determinarse quién tiene mayor volumen. La cantidad de máquinas no está disponible en las fuentes internas.";
  const vBuena = validarRespuestaMixta(BUENA, { periodoFinalizado: true, hayBenchmarkCompetidores: false });
  assert.equal(vBuena.advertencias.length, 0, "respuesta correcta no genera advertencias");
  assert.equal(vBuena.notas, "", "sin notas cuando está bien");

  // ── E. Router (§13) ──────────────────────────────────────────────────────────
  assert.equal(elegirModelo("¿cuántos turnos hizo Federico en agosto de 2026?").clase, "economico", "consulta interna directa → económico");
  assert.equal(elegirModelo("Buscá experiencias de simulación en Córdoba y explicame las diferencias con SIM").clase, "potente", "comparación competitiva → potente");
  assert.equal(elegirModelo("Analizá la competencia de simuladores en Córdoba").clase, "potente", "análisis competitivo → potente");

  console.log("OK — grounding4d1 (puro): períodos (finalizado/en curso, cierre pendiente, timezone/cambio de año), cálculos (226 h actividad, 26,3 no 314, sin denominador no calcula, máquinas no derivables, neto), entidades (SIM Café Racer=SIM, fabricante/red/confirmado/potencial), validador (mala marca 5 códigos, buena limpia), router (interno económico, competitivo potente).");
}
main();

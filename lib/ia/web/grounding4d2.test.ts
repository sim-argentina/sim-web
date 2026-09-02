import { strict as assert } from "node:assert";
import { validarRespuestaMixta, VALIDADOR_VERSION } from "@/lib/ia/web/validacion";
import { verificarIntegridadMarkdown } from "@/lib/ia/web/markdownIntegridad";
import { participacion } from "@/lib/ia/web/calculos";
import { seleccionarHerramientas } from "@/lib/ia/herramientasIntencion";
import { SYSTEM_PROMPT } from "@/lib/ia/systemPrompt";
import { defsParaProveedor } from "@/lib/ia/tools";

// Ejecutar: npx tsx lib/ia/web/grounding4d2.test.ts — puro.
const tk = (s: string) => Math.ceil(s.length / 4);
const flags = (t: string, ctx = { periodoFinalizado: true, hayBenchmarkCompetidores: false }) => validarRespuestaMixta(t, ctx).advertencias.map((a) => a.codigo);

function main() {
  // ── §17.B Polaridad / falsos positivos ───────────────────────────────────────
  assert.ok(flags("SimCafé Racer es un competidor directo de SIM en Córdoba.").includes("entidad_historica_como_competidor"), "afirmar competidor → marca");
  assert.ok(!flags("SIM Café Racer es una denominación histórica de SIM y no es un competidor.").includes("entidad_historica_como_competidor"), "negación correcta → sin advertencia");
  assert.ok(!flags("No puede determinarse quién tiene mayor volumen en Córdoba.").includes("superlativo_sin_benchmark"), "no puede determinarse → sin advertencia");
  assert.ok(flags("SIM es el de mayor volumen del mercado local.").includes("superlativo_sin_benchmark"), "afirmar mayor volumen → marca");
  assert.ok(!flags("No puede estimarse la ocupación sin la capacidad máxima.").includes("superlativo_sin_benchmark"), "no puede estimarse ocupación → sin advertencia");
  assert.ok(flags("La ocupación es alta y sostenida.").includes("superlativo_sin_benchmark"), "ocupación alta sin capacidad → marca");
  assert.ok(!flags("Las operaciones no permiten calcular cuántas máquinas tiene SIM.").includes("maquinas_derivadas_de_operaciones"), "negación de máquinas → sin advertencia");
  assert.ok(flags("SIM tiene 20 máquinas según sus 489 operaciones.").includes("maquinas_derivadas_de_operaciones"), "derivar máquinas → marca");
  assert.ok(!flags("El período de agosto finalizó, pero el cierre financiero está pendiente.").includes("periodo_incompleto_erroneo"), "cierre pendiente → sin advertencia");
  assert.ok(flags("El mes de agosto está incompleto.").includes("periodo_incompleto_erroneo"), "mes incompleto (finalizado) → marca");

  // ── §17.A Integridad NO destructiva (la respuesta no queda mutilada) ──────────
  const truncada = "Datos internos de SIM:\n- Stand: 489 operaciones.\n- No tengo en";
  const iTrunc = verificarIntegridadMarkdown(truncada);
  assert.equal(iTrunc.ok, false, "detecta respuesta truncada");
  assert.ok(iTrunc.problemas.includes("vineta_cortada"), "viñeta cortada detectada");
  const completa = "Datos internos de SIM:\n- Stand: 489 operaciones, 814 personas.\n- Reservas web: 8 turnos.\n\nConclusión: no hay evidencia suficiente para confirmar un competidor directo.";
  assert.equal(verificarIntegridadMarkdown(completa).ok, true, "respuesta completa pasa integridad");
  // El validador NUNCA recorta: la salida conserva el texto original + (si hay) notas al final.
  const v = validarRespuestaMixta(completa, { periodoFinalizado: true, hayBenchmarkCompetidores: false });
  assert.equal(v.advertencias.length, 0, "respuesta correcta sin advertencias (sin nota)");
  assert.equal(v.notas, "", "sin notas → no se anexa nada");

  // ── §17.D Participación con métrica explícita (no hardcode) ──────────────────
  const pT = participacion(8, 904 + 8, "turnos");
  assert.ok(!("error" in pT) && pT.resultado === 0.9, "8/912 = 0,9% de turnos");
  assert.ok(!("error" in pT) && /turnos/.test(pT.unidad), "métrica turnos explícita");
  const pF = participacion(146000, 10258000 + 146000, "facturación bruta");
  assert.ok(!("error" in pF) && pF.resultado === 1.4, "146000/10404000 = 1,4% de facturación");
  assert.ok("error" in participacion(5, 0, "turnos"), "sin total → no calcula");

  // ── §17.F/G Subconjunto de herramientas por intención ────────────────────────
  const comp = seleccionarHerramientas("buscá competidores de simuladores en Córdoba y comparalos con SIM");
  assert.ok(!comp.includes("preparar_informe"), "competitiva NO ofrece preparar_informe");
  assert.ok(!comp.includes("buscar_conocimiento_sim"), "competitiva NO ofrece conocimiento");
  assert.ok(!comp.includes("consultar_colectivo"), "competitiva NO ofrece colectivo");
  assert.ok(comp.includes("consultar_metricas_equipo") && comp.includes("consultar_finanzas"), "sí ofrece el núcleo interno");
  assert.ok(seleccionarHerramientas("hacé un PDF con las métricas de Federico").includes("preparar_informe"), "pedido de informe → ofrece preparar_informe");
  assert.ok(seleccionarHerramientas("compará el colectivo con el stand").includes("consultar_colectivo"), "colectivo → ofrece colectivo");
  assert.ok(seleccionarHerramientas("¿qué dice el manual/documento de precios?").includes("buscar_conocimiento_sim"), "conocimiento → ofrece conocimiento");

  // ── §12/§17.F Reducción del contexto controlable (overhead system+tools) ─────
  const sys = tk(SYSTEM_PROMPT);
  const todas = tk(JSON.stringify(defsParaProveedor()));
  const sub = tk(JSON.stringify(defsParaProveedor(comp)));
  const antes = sys + todas, despues = sys + sub;
  const reduccionTools = 1 - sub / todas;
  console.log(`  overhead/ronda: antes=${antes} tok, después=${despues} tok; tools ${todas}→${sub} (−${Math.round(reduccionTools * 100)}%)`);
  assert.ok(reduccionTools >= 0.5, "reducción de schemas de herramientas ≥ 50%");
  assert.ok(despues < antes, "overhead por ronda reducido");

  console.log(`OK — grounding4d2 (puro): polaridad/negación (competidor/superlativo/máquinas/período), integridad NO destructiva (trunc detectada, completa pasa, validador nunca recorta), participación (0,9% turnos / 1,4% facturación con métrica), subconjunto de tools por intención (competitiva 5 tools, informe/colectivo/conocimiento bajo intención), overhead/ronda reducido (validador ${VALIDADOR_VERSION}).`);
}
main();

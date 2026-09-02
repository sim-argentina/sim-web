import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { completarInformeMetricas } from "@/lib/ia/informes/completar";
import { completarBorrador } from "@/lib/ia/informes/informesServer";
import { validarProcedencia } from "@/lib/ia/informes/procedencia";
import { validarInforme, type InformeSpec } from "@/lib/ia/informes/schema";
import { IA_OWNER_ADMIN } from "@/lib/ia/config";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/informes/completar.integration.ts
// Lee el motor real (read-only) para Federico ago-2026. NO llama a Claude, NO escribe
// (el guard de idempotencia hace no-op sobre el informe real ya completo).

const specBase = (validarInforme({ titulo: "T", tipo_informe: "analitico_mensual", resumen_ejecutivo: "R.", modulos_consultados: ["m"] }) as { ok: true; spec: InformeSpec }).spec;

async function main() {
  // ── §12.6-11, 12.16 Completado determinístico desde el motor real ────────────
  const r = await completarInformeMetricas({ specBase, anio: 2026, mes: 8, nombreIntegrante: "Federico", componentesRequeridos: ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo"] });
  assert.ok(r.ok, "completó");
  if (!r.ok) return;
  const s = r.spec;
  assert.equal(s.tablas.length, 2, "2 tablas (indicadores + por origen)");
  assert.equal(s.graficos.length, 2, "2 gráficos");
  assert.equal(s.fuentes.length, 4, "4 fuentes vinculadas");
  assert.ok(s.metodologia && s.metodologia.length > 50, "metodología presente");
  assert.equal(s.anexo.length, 1, "anexo presente");

  // §12.16 194 h de Federico conservadas. 4C.3: el valor es NÚMERO crudo (tipable en Excel)
  // y la unidad va en columna aparte ("h"); no un string "194 h".
  const indic = s.tablas[0];
  const horas = indic.filas.find((f) => String(f[0]).includes("Horas"));
  assert.equal(horas?.[1], 194, "194 (número crudo) desde el snapshot real");
  assert.equal(horas?.[2], "h", "unidad h en columna aparte (no string '194 h')");

  // §12.7/12.11 Gráficos desde las mismas cifras; unidades NO mezcladas.
  const gTurnos = s.graficos.find((g) => /turnos/i.test(g.titulo));
  const gFact = s.graficos.find((g) => /facturaci/i.test(g.titulo));
  assert.ok(gTurnos && gTurnos.series[0].unidad === "turnos", "gráfico de turnos en unidad turnos");
  assert.ok(gFact && gFact.series[0].unidad === "ARS", "gráfico de facturación en ARS");
  assert.notEqual(gTurnos!.series[0].unidad, gFact!.series[0].unidad, "no mezcla unidades entre gráficos");
  // Los valores del gráfico coinciden con la tabla por origen (Stand/Reservas).
  const porOrigen = s.tablas[1];
  const stand = porOrigen.filas.find((f) => String(f[0]).includes("Stand"))!;
  assert.equal(gTurnos!.series[0].valores[0], stand[1], "turnos Stand del gráfico = tabla");
  assert.equal(gFact!.series[0].valores[0], stand[5], "facturación Stand del gráfico = tabla");

  // §12.16 Procedencia: 194 valida solo para Federico/total/horas; Reservas ≠ Stand.
  assert.ok(validarProcedencia(r.procedencia, { integrante: "Federico", origen: "total", metrica: "horas_minutos", unidad: "min", valor: 11640 }).ok, "194 valida por procedencia");
  assert.equal(validarProcedencia(r.procedencia, { integrante: "Federico", origen: "reservas", metrica: "turnos", valor: Number(stand[1]) }).ok, false, "turnos de Stand no validan como Reservas");

  // §12.10 No inventa: la tabla de indicadores tiene exactamente las métricas conocidas.
  assert.equal(indic.filas.length, 8, "8 indicadores conocidos (sin inventar)");

  // ── §12.19-21 Idempotencia sobre el informe REAL ya completo (no-op, sin Claude) ──
  const { data: infs } = await supabaseAdmin.from("ia_informes").select("id,version_actual");
  const real = (infs ?? []).find((x) => String(x.id).startsWith("7013315b"));
  if (real) {
    const vAntes = real.version_actual;
    const rep = await completarBorrador(real.id as string, IA_OWNER_ADMIN);
    assert.ok(rep.ok, "completarBorrador ok");
    if (rep.ok) assert.equal(rep.agregados.length, 0, "no-op: ya estaba completo, sin agregar componentes");
    const { data: after } = await supabaseAdmin.from("ia_informes").select("version_actual").eq("id", real.id).single();
    assert.equal(after?.version_actual, vAntes, "NO se creó otra versión (idempotente)");
  }

  console.log("OK — completar.integration (4C.2): 2 tablas + 2 gráficos + 4 fuentes + metodología + anexo desde el motor real, 194 h conservadas, gráficos consistentes con tablas sin mezclar unidades, procedencia semántica, sin inventar, idempotente sobre el informe real (no-op, sin Claude).");
}
main().catch((e) => { console.error(e); process.exit(1); });

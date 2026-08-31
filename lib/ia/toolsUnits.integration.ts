import { strict as assert } from "node:assert";
import { HERRAMIENTAS } from "@/lib/ia/tools";
import { formatHoras } from "@/lib/cronograma";
import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";

// Integración (read-only) del grounding numérico del wrapper consultar_metricas_equipo.
//   npx tsx --env-file=.env.local lib/ia/toolsUnits.integration.ts
// NO consume la API de Claude. NO modifica datos.

async function main() {
  // 1/2) formatHoras canónico: minutos → horas legibles.
  assert.equal(formatHoras(11460), "191 h", "11460 min → 191 h");
  assert.equal(formatHoras(11520), "192 h", "11520 min → 192 h");

  const raw = (await HERRAMIENTAS.consultar_metricas_equipo.ejecutar({ anio: 2026, mes: 8 })).contenido;
  const payload = JSON.parse(raw) as {
    integrantes: Array<{ nombre: string; horas_trabajadas_minutos: number; horas_trabajadas_formateadas: string; minutos_actividad: number; turnos_cantidad: number; operaciones_cantidad: number; facturacion_bruta_pesos: number; stand: { turnos_cantidad: number }; reservas: { turnos_cantidad: number } }>;
    _unidades: Record<string, string>;
    mes_en_curso: boolean;
    corte: string;
  };

  // 3) Nombres inequívocos + unidad declarada; sin el campo ambiguo viejo.
  assert.ok(!/\bhoras_min\b/.test(raw) && !/"horas":/.test(raw), "no expone el campo ambiguo 'horas_min'/'horas'");
  assert.ok(payload._unidades && payload._unidades.horas_trabajadas_minutos.includes("MINUTOS"), "declara la unidad de horas");

  const fede = payload.integrantes.find((i) => i.nombre === "Federico")!;
  // horas formateadas == formatHoras(minutos): NUNCA se muestran minutos como horas.
  assert.equal(fede.horas_trabajadas_formateadas, formatHoras(fede.horas_trabajadas_minutos), "formateadas = formatHoras(minutos)");
  // El valor en minutos es del orden de miles (mes), y en horas ~ cientos.
  assert.ok(fede.horas_trabajadas_minutos > 3000, "horas en minutos (valor grande)");
  assert.ok(/^\d{1,3} h/.test(fede.horas_trabajadas_formateadas), "formateadas en horas (dos/tres dígitos)");
  // Ninguna métrica se ETIQUETA como 'facturable'; al contrario, el wrapper le indica
  // explícitamente al modelo que las horas NO son 'facturables' ni 'mínimas'.
  assert.ok(/NO son 'facturables'/.test(raw), "el wrapper prohíbe explícitamente la etiqueta 'facturable' para las horas");
  assert.ok(!/horas_facturables|facturables_min/i.test(raw), "no hay ningún campo etiquetado 'facturable'");

  // 4) Conceptos separados: minutos de actividad ≠ horas de cronograma; turnos ≠ operaciones.
  assert.ok(typeof fede.minutos_actividad === "number" && fede.minutos_actividad !== fede.horas_trabajadas_minutos, "minutos_actividad separado de horas_trabajadas");
  assert.ok(typeof fede.turnos_cantidad === "number" && typeof fede.operaciones_cantidad === "number", "turnos y operaciones separados");

  // 8/9) Coincide con el motor 3B y stand + reservas = total.
  const ref = await consultarMetricasEquipo({ desde: "2026-08-01", hasta: "2026-08-31" });
  const fedeRef = ref.integrantes.find((i) => i.nombre === "Federico")!;
  assert.equal(fede.turnos_cantidad, fedeRef.total.turnos, "turnos = 3B");
  assert.equal(fede.facturacion_bruta_pesos, fedeRef.total.bruto, "bruto = 3B");
  assert.equal(fede.stand.turnos_cantidad + fede.reservas.turnos_cantidad, fede.turnos_cantidad, "stand + reservas = total");
  assert.equal(Math.round(fedeRef.horas_minutos), fede.horas_trabajadas_minutos, "horas_minutos = 3B");

  // 5) Mes en curso con corte informado.
  assert.ok(typeof payload.mes_en_curso === "boolean" && /T/.test(payload.corte), "informa mes_en_curso + corte");

  // 15) Sin PII.
  assert.ok(!/telefono|"nombre_cliente"/.test(raw), "sin PII de clientes");

  console.log("✔ toolsUnits.integration OK (formatHoras 191/192 h, nombres+unidades inequívocos, sin 'horas_min', minutos≠horas, turnos≠operaciones, = 3B, stand+reservas=total, sin PII)");
}

main().catch((e) => { console.error(e); process.exit(1); });

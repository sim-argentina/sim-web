import { strict as assert } from "node:assert";
import { parsearRequisitos, pidioInforme } from "@/lib/ia/informes/requisitos";
import { evaluarIntegridad } from "@/lib/ia/informes/integridad";
import { validarInforme, type InformeSpec } from "@/lib/ia/informes/schema";
import { validarProcedencia, indiceDesdeDatos } from "@/lib/ia/informes/procedencia";

// Ejecutar: npx tsx lib/ia/informes/requisitos.test.ts

const PEDIDO_FEDERICO = "Generame un informe con las métricas de Federico de agosto de 2026, con resumen ejecutivo, tablas, gráficos, fuentes, metodología y anexo de datos. Quiero descargarlo en PDF y Excel.";

// ── §12.1/12.2 Reconocimiento de componentes y formatos ───────────────────────
{
  const r = parsearRequisitos(PEDIDO_FEDERICO);
  assert.deepEqual([...r.formatos].sort(), ["pdf", "xlsx"], "PDF y Excel → pdf, xlsx");
  for (const c of ["resumen_ejecutivo", "tablas", "graficos", "fuentes", "periodo", "metodologia", "anexo"]) {
    assert.ok(r.componentes.includes(c as never), `pidió ${c}`);
  }
  assert.ok(pidioInforme(PEDIDO_FEDERICO), "es un pedido de informe");
}
// Equivalentes en español (no hardcodea la frase exacta).
{
  const r = parsearRequisitos("armá un reporte mensual de Fede con tablas y un par de gráficos, fuentes y metodología; lo quiero en Word y planilla de cálculo");
  assert.deepEqual([...r.formatos].sort(), ["docx", "xlsx"], "Word + planilla → docx, xlsx");
  assert.ok(r.componentes.includes("tablas") && r.componentes.includes("graficos") && r.componentes.includes("metodologia"));
}
// ── §12.3 Pedido simple sin gráficos ──────────────────────────────────────────
{
  const r = parsearRequisitos("dame un informe de agosto en PDF");
  assert.ok(!r.componentes.includes("graficos"), "no pidió gráficos");
  assert.deepEqual(r.formatos, ["pdf"], "solo PDF");
}

const base = (extra: Record<string, unknown> = {}) => (validarInforme({ titulo: "T", tipo_informe: "analitico_mensual", resumen_ejecutivo: "R.", modulos_consultados: ["m"], periodo: "2026-08", ...extra }) as { ok: true; spec: InformeSpec }).spec;

// ── §12.4/12.5 Integridad: requisito faltante → incompleto → no confirmable ────
{
  const reqs = { componentes: ["resumen_ejecutivo", "tablas", "graficos", "fuentes", "periodo", "metodologia", "anexo"] as never, formatos: ["pdf", "xlsx"] as never };
  const spec = base(); // sin tablas/graficos/fuentes/metodologia/anexo
  const integ = evaluarIntegridad({ spec, requisitos: reqs, formatosSeleccionados: ["pdf"], fuentesVinculadas: 0 });
  assert.equal(integ.estado, "incompleto", "faltan componentes → incompleto");
  assert.ok(integ.faltantes.includes("tablas") && integ.faltantes.includes("graficos") && integ.faltantes.includes("anexo"), "reporta faltantes");
  assert.ok(integ.formatos_faltantes.includes("xlsx"), "xlsx pedido pero no seleccionado");
}
// Completo cuando todo está presente y formatos seleccionados.
{
  const reqs = { componentes: ["resumen_ejecutivo", "tablas", "graficos", "periodo", "metodologia", "anexo"] as never, formatos: ["pdf", "xlsx"] as never };
  const spec = base({
    tablas: [{ titulo: "T", columnas: [{ clave: "a", etiqueta: "A", tipo: "texto" }], filas: [["x"]] }],
    graficos: [{ tipo: "barras", titulo: "G", categorias: ["a"], series: [{ nombre: "s", valores: [1] }] }],
    metodologia: "M", anexo: [{ titulo: "An", columnas: [{ clave: "a", etiqueta: "A", tipo: "texto" }], filas: [["x"]] }],
  });
  const integ = evaluarIntegridad({ spec, requisitos: reqs, formatosSeleccionados: ["pdf", "xlsx"], fuentesVinculadas: 2 });
  assert.equal(integ.estado, "completo", "todo presente → completo");
}
// Contradicción → bloqueado.
{
  const reqs = { componentes: [] as never, formatos: [] as never };
  const integ = evaluarIntegridad({ spec: base(), requisitos: reqs, formatosSeleccionados: ["pdf"], fuentesVinculadas: 1, reconciliacion: { ok: false, contradicciones: [{ etiqueta: "Neta", detalle: "no reconcilia" }] } });
  assert.equal(integ.estado, "bloqueado", "contradicción → bloqueado");
}

// ── §12.12-16 Procedencia semántica ───────────────────────────────────────────
{
  const idx = indiceDesdeDatos("Federico", {
    total: { turnos: 385, personas: 336, operaciones: 209.5, minutos: 5775, bruto: 4372000, comision: 35432.68, neto: 4336567.32 },
    stand: { turnos: 378, personas: 330, operaciones: 200, minutos: 5670, bruto: 4246000, comision: 35432.68, neto: 4210567.32 },
    reservas: { turnos: 7, personas: 6, operaciones: 9.5, minutos: 105, bruto: 126000, comision: 0, neto: 126000 },
    horas_minutos: 11640,
  });
  // §12.16 Las 194 h (11640 min) de Federico se conservan y validan.
  assert.ok(validarProcedencia(idx, { integrante: "Federico", origen: "total", metrica: "horas_minutos", unidad: "min", valor: 11640 }).ok, "194 h de Federico validan");
  // §12.12 Un valor de OTRO empleado no valida el indicador de Federico.
  assert.equal(validarProcedencia(idx, { integrante: "Francisco", origen: "total", metrica: "horas_minutos", valor: 11640 }).ok, false, "Francisco no tiene ese dato");
  // §12.13 Reservas no valida Stand.
  assert.equal(validarProcedencia(idx, { integrante: "Federico", origen: "reservas", metrica: "turnos", valor: 378 }).ok, false, "378 es de Stand, no de Reservas");
  assert.ok(validarProcedencia(idx, { integrante: "Federico", origen: "stand", metrica: "turnos", valor: 378 }).ok, "378 sí valida como Stand");
  // §12.14 Minutos no validan horas (unidad).
  assert.equal(validarProcedencia(idx, { integrante: "Federico", origen: "total", metrica: "horas_minutos", unidad: "turnos", valor: 11640 }).ok, false, "unidad turnos no corresponde a horas");
  // §12.15 Bruto no valida neto.
  assert.equal(validarProcedencia(idx, { integrante: "Federico", origen: "total", metrica: "neto", valor: 4372000 }).ok, false, "4.372.000 es bruto, no neto");
  assert.ok(validarProcedencia(idx, { integrante: "Federico", origen: "total", metrica: "bruto", valor: 4372000 }).ok, "4.372.000 valida como bruto");
}

console.log("OK — requisitos/integridad/procedencia (4C.2): reconocimiento de componentes+formatos (no hardcode), integridad completo/incompleto/bloqueado, formatos faltantes, procedencia semántica (Federico≠Francisco, Reservas≠Stand, min≠horas, bruto≠neto, 194 conservada).");

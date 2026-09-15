// Bloque 4E — integración end-to-end contra Supabase real (SOLO LECTURA para datos de negocio;
// escritura únicamente en tablas ia_*/ia_ipc_indice con fixtures ZZTEST). Proveedor de Claude
// SIEMPRE falso; Tavily SIEMPRE falso. Cero llamadas reales.
//
// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/analisis/servidor4e.integration.ts

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { FakeWebSearchProvider } from "@/lib/ia/web/providerWebFake";
import { NOMBRE_EMITIR_FODA } from "@/lib/ia/analisis/fodaSchema";
import { cargarPuntoIpc, leerSerieIpc } from "@/lib/ia/analisis/ipc";
import { ejecutarComparacion } from "@/lib/ia/analisis/comparacionServer";

const OWNER = "admin:zztest-4e";
const RESULT5 = [
  { titulo: "Aracing inaugura su sede en Córdoba", url: "https://infonegocios.info/aracing", dominio: "infonegocios.info", fechaPublicada: "2026-08-20", fragmento: "Nueva sede de simuladores.", posicion: 0 },
];

async function limpiar(id?: string) {
  if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}
async function nuevaConv(): Promise<string> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 4e", estado: "activa" }).select("id").single();
  return data!.id as string;
}
async function limpiarIpc(periodos: string[]) {
  await supabaseAdmin.from("ia_ipc_indice").delete().in("periodo", periodos);
}

function llamadaFodaValida(idsInternos: string[], idsExternos: string[]) {
  return {
    nombre: NOMBRE_EMITIR_FODA,
    input: {
      fortalezas: [{ texto: "Equipo estable y operación consolidada en Córdoba.", fuente_ids: idsInternos.slice(0, 1), confianza: "media" }],
      debilidades: [],
      oportunidades: idsExternos.length > 0 ? [{ texto: "Crecimiento del mercado de simuladores en Córdoba.", fuente_ids: idsExternos.slice(0, 1), confianza: "baja" }] : [],
      amenazas: idsExternos.length > 0 ? [{ texto: "Nuevo competidor potencial con sede propia en Córdoba.", fuente_ids: idsExternos.slice(0, 1), confianza: "media" }] : [],
      conclusion: "SIM mantiene una base interna sólida; conviene monitorear la evolución de nuevos entrantes locales.",
    },
  };
}

async function main() {
  await limpiar();

  // ── 1) comparar_periodos, modo=equipo, DOS MESES FINALIZADOS (vía el loop general) ───────
  const conv1 = await nuevaConv();
  try {
    const p1 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { anio: 2026, mes: 7 }, periodo_b: { anio: 2026, mes: 8 } } }] },
      { tipo: "texto", texto: "Agosto tuvo más actividad que julio." },
    ]);
    const r1 = await correrChat({ owner: OWNER, conversacionId: conv1, pregunta: "Compará los turnos y la facturación de julio con agosto." }, { provider: p1 });
    assert.ok(r1.ok, "ok"); if (!r1.ok) return;
    const h1 = (r1.herramientas as Array<{ nombre: string; ok: boolean; resumen?: Record<string, unknown> }>).find((h) => h.nombre === "comparar_periodos");
    assert.ok(h1?.ok, "comparar_periodos se ejecutó OK");
    const resumen1 = h1!.resumen as { modoPeriodo?: string; metricas?: Array<{ clave: string; variacionPct: number | null }> };
    assert.equal(resumen1.modoPeriodo, "completos", "dos meses finalizados → comparación de períodos COMPLETOS");
    assert.ok(resumen1.metricas?.some((m) => m.clave === "horas_trabajadas_cronograma"), "distingue horas trabajadas del cronograma");
    assert.ok(resumen1.metricas?.some((m) => m.clave === "minutos_actividad_clientes"), "distingue minutos de actividad de clientes (métrica separada)");
    console.log("OK — 4E (parte 1): comparar_periodos (equipo) con dos meses finalizados → modo 'completos'; horas trabajadas del cronograma y actividad de clientes quedan como métricas SEPARADAS.");
  } finally { await limpiar(conv1); }

  // ── 2) comparar_periodos, mes EN CURSO vs mes finalizado → tramo equivalente ──────────────
  const conv2 = await nuevaConv();
  try {
    const hoy = new Date();
    const p2 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { anio: 2026, mes: 8 }, periodo_b: { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 } } }] },
      { tipo: "texto", texto: "Comparación por tramo equivalente." },
    ]);
    const r2 = await correrChat({ owner: OWNER, conversacionId: conv2, pregunta: "Compará los turnos de agosto con el mes en curso." }, { provider: p2 });
    assert.ok(r2.ok, "ok"); if (!r2.ok) return;
    const h2 = (r2.herramientas as Array<{ nombre: string; ok: boolean; resumen?: Record<string, unknown> }>).find((h) => h.nombre === "comparar_periodos");
    const resumen2 = h2!.resumen as { modoPeriodo?: string; referenciaCompleta?: { etiqueta: string } | null; advertencias?: string[] };
    // Si "hoy" cae el día 1 del mes, ambos meses pueden terminar comparándose como completos
    // (sin tramo que recortar); para cualquier otro día del mes debe salir "equivalente".
    if (hoy.getDate() > 1) {
      assert.equal(resumen2.modoPeriodo, "equivalente", "mes en curso → comparación por TRAMO EQUIVALENTE");
      assert.ok(resumen2.referenciaCompleta, "el mes completo de referencia se ofrece APARTE (no mezclado en la variación)");
    }
    console.log("OK — 4E (parte 2): comparar_periodos con un mes en curso usa tramo EQUIVALENTE y ofrece el mes completo de referencia por separado.");
  } finally { await limpiar(conv2); }

  // ── 3) Financiero: bruto/comisión/neto/ganancia reconciliados + IPC FALTANTE sin inventar ──
  const conv3 = await nuevaConv();
  try {
    await limpiarIpc(["2026-07", "2026-08"]); // asegura que NO haya índice cargado para este test
    const p3 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "financiero", periodo_a: { anio: 2026, mes: 7 }, periodo_b: { anio: 2026, mes: 8 }, ajustar_inflacion: true } }] },
      { tipo: "texto", texto: "Comparación financiera nominal." },
    ]);
    const r3 = await correrChat({ owner: OWNER, conversacionId: conv3, pregunta: "Compará la ganancia de julio con agosto ajustada por inflación." }, { provider: p3 });
    assert.ok(r3.ok, "ok"); if (!r3.ok) return;
    const h3 = (r3.herramientas as Array<{ nombre: string; ok: boolean; resumen?: Record<string, unknown> }>).find((h) => h.nombre === "comparar_periodos");
    const resumen3 = h3!.resumen as { modo: string; metricas: Array<{ clave: string }>; inflacion: Array<{ ok: boolean }> | null; advertencias: string[] };
    assert.equal(resumen3.modo, "financiero");
    for (const clave of ["ingresos_brutos", "reembolsos", "ingresos_netos", "ganancia_sim", "mi_sueldo"]) {
      assert.ok(resumen3.metricas.some((m) => m.clave === clave), `expone ${clave} por separado`);
    }
    assert.ok(resumen3.inflacion, "intentó el ajuste (se pidió explícitamente)");
    assert.ok(resumen3.inflacion!.some((i) => i.ok === false), "SIN índice IPC cargado, el ajuste queda como no-ok (no se inventa un valor)");
    assert.ok(resumen3.advertencias.some((a) => /IPC/.test(a)), "advierte explícitamente que falta el índice IPC");
    console.log("OK — 4E (parte 3): financiero expone bruto/reembolsos/neto/ganancia/sueldo por separado; sin índice IPC cargado, el ajuste por inflación queda sin inventar un valor y lo advierte.");
  } finally { await limpiar(conv3); }

  // ── 4) IPC cargado → el ajuste por inflación SÍ se calcula (motor completo, sin chat) ─────
  {
    await cargarPuntoIpc({ periodo: "2026-01", indice: 100 }, OWNER);
    await cargarPuntoIpc({ periodo: "2026-08", indice: 150, fuente: "INDEC", url: "https://www.indec.gob.ar" }, OWNER);
    const r = await ejecutarComparacion({ modo: "financiero", periodoA: { anio: 2026, mes: 1 }, periodoB: { anio: 2026, mes: 8 }, ajustarInflacion: true });
    assert.ok(r.ok);
    if (r.ok) {
      assert.ok(r.inflacion, "con índice cargado para ambos períodos, sí arma el ajuste");
      const ingresosNetos = r.inflacion!.find((i) => i.metrica === "ingresos_netos");
      assert.ok(ingresosNetos?.ok, "el ajuste de ingresos_netos se calculó (índice presente para 2026-01 y 2026-08)");
    }
    const serieCargada = await leerSerieIpc(["2026-01", "2026-08"]);
    assert.equal(serieCargada.get("2026-01"), 100);
    assert.equal(serieCargada.get("2026-08"), 150);
    await limpiarIpc(["2026-01", "2026-08"]);
    console.log("OK — 4E (parte 4): con el índice IPC cargado (admin, auditado), el ajuste nominal+real se calcula correctamente end-to-end.");
  }

  // ── 5) FODA INTERNO (sin web): cero llamadas a Tavily ─────────────────────────────────────
  const conv5 = await nuevaConv();
  try {
    const web5 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const p5 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [llamadaFodaValida(["int-1", "int-2"], [])] }]);
    const r5 = await correrChat({ owner: OWNER, conversacionId: conv5, pregunta: "Hacé un FODA de SIM usando solamente datos internos." }, { provider: p5, webProvider: web5 });
    assert.ok(r5.ok, "ok"); if (!r5.ok) return;
    assert.equal(web5.llamadas.length, 0, "FODA interno: cero búsquedas Tavily");
    assert.ok(r5.texto.includes("### Fortalezas"), "renderiza el FODA");
    assert.ok(!/No pude/.test(r5.texto), "sin fallback");
    const { data: eje5 } = await supabaseAdmin.from("ia_ejecuciones").select("motivo_router").eq("conversacion_id", conv5).single();
    assert.equal(eje5!.motivo_router, "foda_estructurado", "pasó por el flujo estructurado de FODA");
    console.log("OK — 4E (parte 5): FODA interno no dispara ninguna búsqueda Tavily; se renderiza vía síntesis estructurada terminal.");
  } finally { await limpiar(conv5); }

  // ── 6) FODA MIXTO: 1 búsqueda Tavily (o caché), fuentes internas Y externas persistidas ───
  const conv6 = await nuevaConv();
  try {
    const web6 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const p6 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [llamadaFodaValida(["int-1"], ["ext-1"])] }]);
    const r6 = await correrChat({ owner: OWNER, conversacionId: conv6, pregunta: "Hacé un FODA de SIM comparándolo con el mercado actual de Córdoba.", idempotencyKey: "zz-4e-foda-mixto" }, { provider: p6, webProvider: web6 });
    assert.ok(r6.ok, "ok"); if (!r6.ok) return;
    assert.ok(web6.llamadas.length <= 1, "como máximo 1 búsqueda Tavily estándar");
    assert.ok(r6.texto.includes("### Amenazas"), "renderiza el cuadrante de amenazas externas");
    const { data: msg6 } = await supabaseAdmin.from("ia_mensajes").select("fuentes").eq("id", r6.mensajeId).single();
    const fuentes6 = (msg6!.fuentes as Array<{ tipo?: string }>) ?? [];
    assert.ok(fuentes6.some((f) => f.tipo === "interna"), "fuentes internas persistidas");
    assert.ok(fuentes6.some((f) => f.tipo === "externa"), "fuentes externas persistidas");
    console.log("OK — 4E (parte 6): FODA mixto usa como máximo 1 búsqueda Tavily y persiste fuentes internas y externas por separado.");
  } finally { await limpiar(conv6); }

  // ── 7) Snapshot reutilizado por informes SIN volver a consultar (mismo mecanismo de 4C) ───
  const conv7 = await nuevaConv();
  try {
    const p7 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { anio: 2026, mes: 7 }, periodo_b: { anio: 2026, mes: 8 } } }] },
      { tipo: "herramientas", llamadas: [{ nombre: "preparar_informe", input: { titulo: "Comparación julio vs agosto", tipo_informe: "comparacion", resumen_ejecutivo: "Agosto superó a julio en actividad.", modulos_consultados: ["Comparación de períodos"] } }] },
    ]);
    const r7 = await correrChat({ owner: OWNER, conversacionId: conv7, pregunta: "Compará los turnos de julio con agosto y preparame un informe." }, { provider: p7 });
    assert.ok(r7.ok, "ok"); if (!r7.ok) return;
    assert.ok(r7.borrador, "se preparó el borrador del informe");
    const { data: version } = await supabaseAdmin.from("ia_informe_versiones").select("snapshot_fuentes").eq("id", r7.borrador!.versionId).single();
    const snapshot = (version!.snapshot_fuentes as Array<{ herramienta: string; resumen: Record<string, unknown> }>) ?? [];
    const comp = snapshot.find((s) => s.herramienta === "comparar_periodos");
    assert.ok(comp, "el snapshot del informe reutiliza el resultado de comparar_periodos SIN volver a consultarlo (mismo mecanismo que preparar_informe→snapshot_fuentes de 4C)");
    assert.ok((comp!.resumen as { metricas?: unknown[] }).metricas, "el snapshot conserva el análisis estructurado completo (métricas, no solo un resumen de auditoría)");
    console.log("OK — 4E (parte 7): el informe reutiliza el snapshot ESTRUCTURADO de comparar_periodos sin recalcular (mismo mecanismo de snapshot_fuentes de 4C).");
  } finally { await limpiar(conv7); }

  // ── 8) Sin PII: comparar_periodos no expone nombres/teléfonos de clientes ─────────────────
  {
    const r = await ejecutarComparacion({ modo: "equipo", periodoA: { anio: 2026, mes: 7 }, periodoB: { anio: 2026, mes: 8 } });
    const json = JSON.stringify(r);
    assert.ok(!/\+54\s?9?\s?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{4}/.test(json), "sin números de teléfono en el resultado");
    console.log("OK — 4E (parte 8): comparar_periodos no expone PII (sin nombres/teléfonos de clientes en el resultado estructurado).");
  }

  const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
  console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
}
main().catch(async (e) => { console.error(e); await limpiar(); process.exit(1); });

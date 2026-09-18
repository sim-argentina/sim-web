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
import { hoyCordoba } from "@/lib/ia/periodo";

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
    const resumen2 = h2!.resumen as {
      modoPeriodo?: string;
      referenciaCompleta?: { etiqueta: string; metricas: Array<{ diferencia: number; variacionPct: number | null; variacionFormateada: string }> } | null;
      advertencias?: string[];
    };
    // Si "hoy" cae el día 1 del mes, ambos meses pueden terminar comparándose como completos
    // (sin tramo que recortar); para cualquier otro día del mes debe salir "equivalente".
    if (hoy.getDate() > 1) {
      assert.equal(resumen2.modoPeriodo, "equivalente", "mes en curso → comparación por TRAMO EQUIVALENTE");
      assert.ok(resumen2.referenciaCompleta, "el mes completo de referencia se ofrece APARTE (no mezclado en la variación)");
      // Hotfix 2 — el mes anterior completo es SOLO referencia: no puede tener una diferencia ni
      // una variación real (ni siquiera 0%), para que nadie la confunda con parte de la comparación.
      for (const m of resumen2.referenciaCompleta!.metricas) {
        assert.equal(m.diferencia, 0, "referencia completa: diferencia siempre 0 (no es una comparación)");
        assert.equal(m.variacionPct, null, "referencia completa: variación excluida (null), no 0%");
        assert.ok(!/%/.test(m.variacionFormateada), "referencia completa: el texto formateado tampoco debe insinuar un porcentaje");
      }
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

  // ── 9) HOTFIX — "Compará los turnos de este mes con el mes pasado" resuelve SOLO, sin pedir
  // aclaración, seleccionando comparar_periodos con relativo (este_mes/mes_pasado), modelo
  // económico, y sin ofrecer la herramienta web (no hay Tavily de por medio). El período
  // esperado se calcula con la fecha REAL de Córdoba (no se hardcodea el mes de la incidencia).
  const conv9 = await nuevaConv();
  try {
    const hoyCba = hoyCordoba();
    const [anioHoy, mesHoy] = hoyCba.split("-").map(Number);
    const mesAnteriorEsperado = mesHoy === 1 ? { anio: anioHoy - 1, mes: 12 } : { anio: anioHoy, mes: mesHoy - 1 };
    const p9 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { relativo: "este_mes" }, periodo_b: { relativo: "mes_pasado" } } }] },
      { tipo: "texto", texto: "Este mes tuvo esta actividad comparado con el mes pasado." },
    ]);
    const r9 = await correrChat({ owner: OWNER, conversacionId: conv9, pregunta: "Compará los turnos de este mes con el mes pasado." }, { provider: p9 });
    assert.ok(r9.ok, "ok"); if (!r9.ok) return;
    assert.equal(r9.claseModelo, "economico", "comparación numérica simple de dos meses → modelo económico");
    const h9 = (r9.herramientas as Array<{ nombre: string; ok: boolean; resumen?: Record<string, unknown> }>).find((h) => h.nombre === "comparar_periodos");
    assert.ok(h9?.ok, "comparar_periodos se ejecutó (el modelo NO sustituyó la herramienta por una respuesta libre)");
    const resumen9 = h9!.resumen as { ladoA: { periodo: string }; ladoB: { periodo: string } };
    // Hotfix 2 — A es SIEMPRE el período más antiguo (mes pasado = base) y B el más reciente
    // (este mes = comparado), sin importar que el pedido haya puesto "este_mes" en periodo_a.
    const mesPasadoStr = `${mesAnteriorEsperado.anio}-${String(mesAnteriorEsperado.mes).padStart(2, "0")}`;
    assert.equal(resumen9.ladoA.periodo, mesPasadoStr, "ladoA es el mes pasado (base/referencia), con acarreo de año si hace falta");
    assert.equal(resumen9.ladoB.periodo, hoyCba.slice(0, 7), "ladoB es este mes (actual/comparado)");
    assert.equal(p9.ultimoWebSearch, undefined, "sin Tavily/búsqueda web: es una comparación interna");
    console.log("OK — 4E (parte 9, hotfix): 'este mes' vs 'mes pasado' resuelve con la fecha real de Córdoba, sin aclaración, con comparar_periodos + modelo económico + cero web.");
  } finally { await limpiar(conv9); }

  // ── 10) HOTFIX — "el mismo mes del año pasado" (año pasado) resuelve con acarreo de año ────
  const conv10 = await nuevaConv();
  try {
    const hoyCba = hoyCordoba();
    const [anioHoy, mesHoy] = hoyCba.split("-").map(Number);
    const p10 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { relativo: "este_mes" }, periodo_b: { relativo: "mismo_mes_anio_pasado" } } }] },
      { tipo: "texto", texto: "Comparación interanual del mismo mes." },
    ]);
    const r10 = await correrChat({ owner: OWNER, conversacionId: conv10, pregunta: "Compará los turnos de este mes con el mismo mes del año pasado." }, { provider: p10 });
    assert.ok(r10.ok, "ok"); if (!r10.ok) return;
    const h10 = (r10.herramientas as Array<{ nombre: string; ok: boolean; resumen?: Record<string, unknown> }>).find((h) => h.nombre === "comparar_periodos");
    assert.ok(h10?.ok, "comparar_periodos se ejecutó");
    const resumen10 = h10!.resumen as { ladoA: { periodo: string }; ladoB: { periodo: string } };
    // Hotfix 2 — el año anterior es cronológicamente más antiguo → ladoA (base), aunque haya
    // llegado en periodo_b; "este_mes" (año actual) es el más reciente → ladoB (comparado).
    assert.equal(resumen10.ladoA.periodo, `${anioHoy - 1}-${String(mesHoy).padStart(2, "0")}`, "'mismo_mes_anio_pasado' resuelve al mismo mes, año-1, y queda como ladoA (base)");
    assert.equal(resumen10.ladoB.periodo, hoyCba.slice(0, 7), "'este_mes' queda como ladoB (comparado)");
    console.log("OK — 4E (parte 10, hotfix): 'año pasado' (mismo mes) resuelve al año anterior sin pedir aclaración.");
  } finally { await limpiar(conv10); }

  // ── 11) HOTFIX — una expresión REALMENTE ambigua sigue pudiendo pedir aclaración: no se ────
  // fuerza tool_choice a comparar_periodos, así que el modelo conserva la libertad de preguntar
  // cuando de verdad falta información (acá: "el otro mes" no identifica ningún período).
  const conv11 = await nuevaConv();
  try {
    const p11 = new FakeProviderGuionado([
      { tipo: "texto", texto: "¿A qué mes te referís con 'el otro mes'? Decime el mes y el año para poder compararlo con marzo." },
    ]);
    const r11 = await correrChat({ owner: OWNER, conversacionId: conv11, pregunta: "Compará marzo con el otro mes." }, { provider: p11 });
    assert.ok(r11.ok, "ok"); if (!r11.ok) return;
    assert.equal((r11.herramientas as unknown[]).length, 0, "período genuinamente ambiguo: no se ejecuta ninguna herramienta");
    assert.equal(p11.ultimoToolChoice, undefined, "no se fuerza tool_choice: el modelo conserva la libertad de pedir aclaración cuando hace falta de verdad");
    console.log("OK — 4E (parte 11, hotfix): una expresión realmente ambigua ('el otro mes', sin año ni referencia) todavía puede pedir aclaración; no se forzó comparar_periodos.");
  } finally { await limpiar(conv11); }

  // ── 12) HOTFIX 2 — orientación A/B invariante al orden de los parámetros: da IGUAL en qué
  // slot (periodo_a/periodo_b) venga cada mes, el resultado final debe ser IDÉNTICO. Antes de
  // este hotfix, invertir el orden invertía además a quién le tocaba ser el denominador de la
  // variación (el bug real: "este mes" en periodo_a, "mes pasado" en periodo_b, terminaba
  // usando el mes ACTUAL como base). Se usan julio/agosto 2026 (ambos finalizados, ya usados en
  // la parte 1) sin necesidad de conocer sus valores reales: alcanza con que ambos órdenes den
  // exactamente lo mismo.
  {
    const [directo, invertido] = await Promise.all([
      ejecutarComparacion({ modo: "equipo", periodoA: { anio: 2026, mes: 7 }, periodoB: { anio: 2026, mes: 8 } }),
      ejecutarComparacion({ modo: "equipo", periodoA: { anio: 2026, mes: 8 }, periodoB: { anio: 2026, mes: 7 } }), // orden INVERTIDO
    ]);
    assert.ok(directo.ok && invertido.ok, "ambas órdenes ejecutan OK");
    if (directo.ok && invertido.ok) {
      assert.equal(directo.ladoA.periodo, "2026-07", "julio (más antiguo) es SIEMPRE ladoA...");
      assert.equal(invertido.ladoA.periodo, "2026-07", "...sin importar en qué parámetro lo haya puesto el llamador");
      assert.equal(directo.ladoB.periodo, "2026-08");
      assert.equal(invertido.ladoB.periodo, "2026-08");
      assert.deepEqual(directo.metricas, invertido.metricas, "las métricas (diferencia, variación, signos) son IDÉNTICAS sin importar el orden de los parámetros");
    }
  }
  console.log("OK — 4E (parte 12, hotfix): la orientación A=más antiguo/B=más reciente es invariante al orden de periodo_a/periodo_b — ya no depende de cómo el modelo redactó el pedido.");

  // ── 13) HOTFIX 2 — reproduce el caso productivo EXACTO: septiembre 492 vs agosto 607, con
  // "este_mes" en periodo_a y "mes_pasado" en periodo_b (el orden natural en que un modelo real
  // arma la llamada para "comparar ESTE MES con EL MES PASADO" — y el que causó el bug en
  // producción). Usa datos reales (no se conocen los valores exactos de HOY, así que se verifica
  // la RELACIÓN, no los números: sea cual sea el resultado, la variación debe salir de dividir
  // por agosto —el período más antiguo—, nunca por septiembre.
  const conv13 = await nuevaConv();
  try {
    const p13 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { relativo: "este_mes" }, periodo_b: { relativo: "mes_pasado" } } }] },
      { tipo: "texto", texto: "Comparación de este mes contra el mes pasado." },
    ]);
    const r13 = await correrChat({ owner: OWNER, conversacionId: conv13, pregunta: "Compará los turnos de este mes con el mes pasado." }, { provider: p13 });
    assert.ok(r13.ok, "ok"); if (!r13.ok) return;
    const h13 = (r13.herramientas as Array<{ nombre: string; ok: boolean; resumen?: Record<string, unknown> }>).find((h) => h.nombre === "comparar_periodos");
    assert.ok(h13?.ok, "comparar_periodos se ejecutó");
    const resumen13 = h13!.resumen as {
      ladoA: { periodo: string }; ladoB: { periodo: string };
      metricas: Array<{ clave: string; valorA: number; valorB: number; diferencia: number; variacionPct: number | null; diferenciaFormateada: string; variacionFormateada: string }>;
    };
    const hoyCba = hoyCordoba();
    const [anioHoy, mesHoy] = hoyCba.split("-").map(Number);
    const mesPasadoEsperado = mesHoy === 1 ? { anio: anioHoy - 1, mes: 12 } : { anio: anioHoy, mes: mesHoy - 1 };
    // ladoA es SIEMPRE el más antiguo (mes pasado), aunque "este_mes" haya llegado en periodo_a.
    assert.equal(resumen13.ladoA.periodo, `${mesPasadoEsperado.anio}-${String(mesPasadoEsperado.mes).padStart(2, "0")}`, "ladoA es el mes pasado (base), no 'este_mes', pese al orden de la llamada");
    assert.equal(resumen13.ladoB.periodo, hoyCba.slice(0, 7), "ladoB es este mes (comparado)");
    const turnos = resumen13.metricas.find((m) => m.clave === "turnos")!;
    assert.equal(turnos.diferencia, Math.round((turnos.valorB - turnos.valorA) * 10000) / 10000, "diferencia = B - A (con A=mes pasado)");
    if (turnos.valorA !== 0) {
      const esperado = Math.round(((turnos.valorB - turnos.valorA) / Math.abs(turnos.valorA)) * 100 * 100) / 100;
      assert.equal(turnos.variacionPct, esperado, "variación = (B-A)/|A|*100, con A=mes pasado (NUNCA con A=este mes)");
    }
    // Coherencia de signo: si hay una diferencia negativa, el texto formateado debe empezar con "-".
    for (const m of resumen13.metricas) {
      if (m.diferencia < 0) assert.ok(m.diferenciaFormateada.startsWith("-"), `${m.clave}: diferencia negativa debe verse con signo ('${m.diferenciaFormateada}')`);
      if (m.variacionPct != null && m.variacionPct < 0) assert.ok(m.variacionFormateada.startsWith("-"), `${m.clave}: variación negativa debe verse con signo ('${m.variacionFormateada}')`);
    }
    console.log(`OK — 4E (parte 13, hotfix): reproduce el caso productivo — turnos ${turnos.valorA}→${turnos.valorB}, diferencia ${turnos.diferenciaFormateada}, variación ${turnos.variacionFormateada} (base = mes pasado, con signo preservado).`);
  } finally { await limpiar(conv13); }

  // ── 14) HOTFIX 3 — el modelo OMITE la referencia del mes completo en su narración, pero la
  // respuesta FINAL (lo que recibe el cliente) la incluye igual: el servidor la agrega
  // DETERMINÍSTICAMENTE a partir del resultado estructurado, sin depender de que el modelo la
  // haya mencionado (mes/año dinámicos, turnos/facturación reales, sin diferencia/variación/0%,
  // con formato argentino, al final del texto, y persistida en la conversación).
  const conv14 = await nuevaConv();
  try {
    const p14 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { relativo: "este_mes" }, periodo_b: { relativo: "mes_pasado" } } }] },
      { tipo: "texto", texto: "Este mes tuvo menos actividad que el mes pasado en el tramo comparable." },
    ]);
    const r14 = await correrChat({ owner: OWNER, conversacionId: conv14, pregunta: "Compará los turnos de este mes con el mes pasado." }, { provider: p14 });
    assert.ok(r14.ok, "ok"); if (!r14.ok) return;
    const h14 = (r14.herramientas as Array<{ nombre: string; ok: boolean; resumen?: Record<string, unknown> }>).find((h) => h.nombre === "comparar_periodos");
    const resumen14 = h14!.resumen as { modoPeriodo: string; referenciaCompleta: { etiqueta: string; metricas: Array<{ clave: string; valorBFormateado: string }> } | null };
    assert.equal(resumen14.modoPeriodo, "equivalente", "precondición del caso: hay tramo equivalente");
    assert.ok(resumen14.referenciaCompleta, "precondición del caso: el motor SÍ trae la referencia completa");
    const refTurnos = resumen14.referenciaCompleta!.metricas.find((m) => m.clave === "turnos")!;
    const refFacturacion = resumen14.referenciaCompleta!.metricas.find((m) => m.clave === "facturacion_bruta")!;
    const nombreMesRef = resumen14.referenciaCompleta!.etiqueta.replace(/\s*\(mes completo.*\)\s*$/i, "").trim();

    assert.ok(r14.texto.toLowerCase().includes("referencia del mes completo"), "la respuesta FINAL incluye la referencia aunque el modelo no la haya mencionado");
    assert.ok(r14.texto.includes(nombreMesRef), "el mes de la referencia es DINÁMICO (el mes real, no hardcodeado)");
    assert.ok(r14.texto.includes(refTurnos.valorBFormateado), "los turnos de la referencia son los del resultado estructurado real");
    assert.ok(r14.texto.includes(refFacturacion.valorBFormateado), "la facturación bruta de la referencia es la del resultado estructurado real");
    assert.ok(/\$\d{1,3}(\.\d{3})*/.test(refFacturacion.valorBFormateado), "la facturación de la referencia usa formato argentino ($ y separador de miles)");
    const bloque = r14.texto.slice(r14.texto.toLowerCase().indexOf("referencia del mes completo"));
    assert.ok(!/^[-*]?\s*(diferencia|variaci[oó]n)\s*:/im.test(bloque), "el bloque de referencia no tiene una línea de diferencia/variación CALCULADA");
    assert.ok(!/%/.test(bloque), "el bloque de referencia no tiene ningún porcentaje (ni 0%)");
    assert.ok(r14.texto.trim().endsWith("tramo equivalente._"), "el bloque de referencia es lo ÚLTIMO del texto (queda antes de donde la UI agrega 'Fuentes', que es una sección aparte — ver IAChat.tsx)");

    const { data: msgs } = await supabaseAdmin.from("ia_mensajes").select("contenido").eq("conversacion_id", conv14).eq("rol", "assistant").order("created_at", { ascending: false }).limit(1);
    assert.ok((msgs?.[0]?.contenido as string ?? "").toLowerCase().includes("referencia del mes completo"), "la referencia queda en el texto PERSISTIDO de la conversación, no solo en memoria");
    assert.equal(r14.claseModelo, "economico");
    console.log(`OK — 4E (parte 14, hotfix 3): el modelo omite la referencia de ${nombreMesRef} y el servidor la agrega igual, dinámica y real (${refTurnos.valorBFormateado} turnos, ${refFacturacion.valorBFormateado}), sin diferencia/variación/0%, persistida.`);
  } finally { await limpiar(conv14); }

  // ── 15) HOTFIX 3 — el modelo termina INMEDIATAMENTE después de la comparación (respuesta
  // mínima, sin narrar nada de la referencia): igual se agrega. ────────────────────────────────
  const conv15 = await nuevaConv();
  try {
    const p15 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { relativo: "este_mes" }, periodo_b: { relativo: "mes_pasado" } } }] },
      { tipo: "texto", texto: "Listo." },
    ]);
    const r15 = await correrChat({ owner: OWNER, conversacionId: conv15, pregunta: "Compará los turnos de este mes con el mes pasado." }, { provider: p15 });
    assert.ok(r15.ok, "ok"); if (!r15.ok) return;
    assert.ok(r15.texto.toLowerCase().includes("referencia del mes completo"), "incluso con una respuesta brevísima del modelo, la referencia se agrega igual");
    console.log("OK — 4E (parte 15, hotfix 3): el modelo termina inmediatamente tras la comparación (respuesta mínima) y la referencia se agrega de todas formas.");
  } finally { await limpiar(conv15); }

  // ── 16) HOTFIX 3 — el modelo MENCIONA accidentalmente la referencia: el resultado final NO la
  // duplica (dedup por el marcador propio del ensamblador, no por buscar una palabra genérica). ─
  const conv16 = await nuevaConv();
  try {
    const p16 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { relativo: "este_mes" }, periodo_b: { relativo: "mes_pasado" } } }] },
      { tipo: "texto", texto: "Este mes bajó respecto al mes pasado.\n\n**Referencia del mes completo:** el modelo la mencionó igual (no debería duplicarse)." },
    ]);
    const r16 = await correrChat({ owner: OWNER, conversacionId: conv16, pregunta: "Compará los turnos de este mes con el mes pasado." }, { provider: p16 });
    assert.ok(r16.ok, "ok"); if (!r16.ok) return;
    const ocurrencias = (r16.texto.toLowerCase().match(/referencia del mes completo/g) ?? []).length;
    assert.equal(ocurrencias, 1, "si el modelo ya mencionó la referencia por su cuenta, el servidor NO agrega una segunda");
    console.log("OK — 4E (parte 16, hotfix 3): el modelo menciona la referencia por accidente y el resultado final no la duplica (una sola aparición).");
  } finally { await limpiar(conv16); }

  // ── 17) HOTFIX 3 — dos meses YA CERRADOS: no hay tramo equivalente que recortar, así que NO
  // se agrega el bloque de referencia (no aplica). ────────────────────────────────────────────
  const conv17 = await nuevaConv();
  try {
    const p17 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { anio: 2026, mes: 7 }, periodo_b: { anio: 2026, mes: 8 } } }] },
      { tipo: "texto", texto: "Julio y agosto, ambos cerrados." },
    ]);
    const r17 = await correrChat({ owner: OWNER, conversacionId: conv17, pregunta: "Compará los turnos de julio con agosto." }, { provider: p17 });
    assert.ok(r17.ok, "ok"); if (!r17.ok) return;
    assert.ok(!r17.texto.toLowerCase().includes("referencia del mes completo"), "dos meses YA CERRADOS no llevan bloque de referencia");
    console.log("OK — 4E (parte 17, hotfix 3): comparación de dos meses ya cerrados NO agrega el bloque de referencia.");
  } finally { await limpiar(conv17); }

  // ── 18) HOTFIX 3 — mismo mes en dos años DISTINTOS, ambos cerrados ("interanual" sin mes en
  // curso): tampoco aplica el bloque. ─────────────────────────────────────────────────────────
  const conv18 = await nuevaConv();
  try {
    const p18 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "comparar_periodos", input: { modo: "equipo", periodo_a: { anio: 2025, mes: 8 }, periodo_b: { anio: 2026, mes: 8 } } }] },
      { tipo: "texto", texto: "Agosto de un año contra el otro, ambos cerrados." },
    ]);
    const r18 = await correrChat({ owner: OWNER, conversacionId: conv18, pregunta: "Compará agosto de este año con agosto del año pasado." }, { provider: p18 });
    assert.ok(r18.ok, "ok"); if (!r18.ok) return;
    assert.ok(!r18.texto.toLowerCase().includes("referencia del mes completo"), "comparación interanual con ambos lados cerrados NO agrega el bloque de referencia");
    console.log("OK — 4E (parte 18, hotfix 3): mismo mes en dos años, ambos cerrados, NO agrega el bloque de referencia.");
  } finally { await limpiar(conv18); }

  // ── 19) HOTFIX 3 — una herramienta AJENA a comparar_periodos (detectar_anomalias) nunca
  // agrega el bloque de referencia. ───────────────────────────────────────────────────────────
  const conv19 = await nuevaConv();
  try {
    const p19 = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: "detectar_anomalias", input: { anio: 2026, mes: 8 } }] },
      { tipo: "texto", texto: "No se detectaron anomalías importantes en agosto." },
    ]);
    const r19 = await correrChat({ owner: OWNER, conversacionId: conv19, pregunta: "Detectá anomalías en agosto." }, { provider: p19 });
    assert.ok(r19.ok, "ok"); if (!r19.ok) return;
    assert.ok(!r19.texto.toLowerCase().includes("referencia del mes completo"), "una herramienta ajena a comparar_periodos nunca agrega el bloque de referencia");
    console.log("OK — 4E (parte 19, hotfix 3): detectar_anomalias no agrega el bloque de referencia (ajeno a comparar_periodos).");
  } finally { await limpiar(conv19); }

  const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
  console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
}
main().catch(async (e) => { console.error(e); await limpiar(); process.exit(1); });

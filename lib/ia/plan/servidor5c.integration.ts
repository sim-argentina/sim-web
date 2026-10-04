// Bloque 5C — integración end-to-end contra Supabase real (SOLO LECTURA de datos de negocio;
// escritura únicamente en tablas ia_* con fixtures ZZTEST). Proveedor de Claude SIEMPRE falso;
// Tavily SIEMPRE falso y verificado sin usar. Cero llamadas reales, cero créditos.
//
// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/plan/servidor5c.integration.ts

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado, type GuionTurno } from "@/lib/ia/providerFake";
import { FakeWebSearchProvider } from "@/lib/ia/web/providerWebFake";
import { NOMBRE_ANALISIS_MULTI, NOMBRE_SINTESIS } from "@/lib/ia/plan/herramientasPlan";
import { clasificarConsulta } from "@/lib/ia/ruteo";
import { claseEfectiva } from "@/lib/ia/plan/complejidad";
import { getModelos } from "@/lib/ia/config";

const OWNER = "admin:zztest-5c";
const OWNER_B = "admin:zztest-5c-otra";

const PREGUNTA =
  "Compará agosto y septiembre de 2026. Decime cómo cambiaron la facturación bruta total, los turnos comerciales y las horas programadas. Después identificá qué fuentes explican la variación de facturación y decime si la diferencia parece relacionarse más con menor demanda o con menor disponibilidad.";

const PLAN = {
  objetivo: "Agosto contra septiembre de 2026: facturación, turnos y horas programadas",
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
  presentacion: { tipo: "comparacion_multidominio" },
};

// Lo que el servidor tiene que publicar, exactamente una vez cada cosa.
const UNICOS = [
  ["título", "### Agosto contra septiembre"],
  ["tabla comparativa", "| Métrica | agosto de 2026 | septiembre de 2026 | Diferencia | Variación |"],
  ["fila de facturación", "| Facturación bruta | $13.454.000 | $10.440.000 | -$3.014.000 | -22,4% |"],
  ["fila de turnos", "| Turnos comerciales | 912 | 826 | -86 | -9,4% |"],
  ["fila de horas", "| Horas programadas | 414 h | 405,08 h | -8,92 h | -2,2% |"],
  ["desglose por fuente", "**Qué fuentes explican el cambio de facturación bruta**"],
  ["delta de manuales", "| Ingresos manuales | $2.950.000 | $670.000 | -$2.280.000 |"],
  ["lectura", "**Demanda o disponibilidad**"],
  ["criterios", "**Criterios y limitaciones**"],
  ["fuentes internas", "_Fuentes internas consultadas:"],
] as const;

const PROHIBIDOS = [
  ["ids de paso", "p1."], ["ids de cálculo", "calculoId"], ["evidenciaId", "evidenciaId"],
  ["JSON", "{\""], ["marcador interno", "ia-sim:"], ["comentario HTML", "<!--"],
  ["nombre de tabla", "turnos_stand"], ["SQL", "select "], ["indefinido", "undefined"],
] as const;

type Herramienta = { nombre: string; ok: boolean; resumen?: Record<string, unknown> };
const veces = (t: string, a: string) => t.split(a).length - 1;

async function limpiar(owner = OWNER, id?: string) {
  if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", owner);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", owner);
}
async function nuevaConv(owner = OWNER): Promise<string> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").insert({ owner, titulo: "ZZTEST 5c", estado: "activa" }).select("id").single();
  return data!.id as string;
}
async function auditoria(conversacionId: string) {
  const { data } = await supabaseAdmin.from("ia_ejecuciones").select("busqueda_previa, busquedas_web, clase_modelo, tokens_in, tokens_out").eq("conversacion_id", conversacionId).order("created_at", { ascending: false }).limit(1);
  return (data ?? [])[0] as { busqueda_previa: Record<string, unknown>; busquedas_web: number; clase_modelo: string; tokens_in: number; tokens_out: number } | undefined;
}
const tavilyNuevo = () => new FakeWebSearchProvider([{ tipo: "ok", resultados: [{ titulo: "Nota externa", url: "https://ejemplo.com/n", dominio: "ejemplo.com", fechaPublicada: "2026-09-20", fragmento: "No debería usarse.", posicion: 0 }] }]);

async function correr(pregunta: string, guion: GuionTurno[], opts: { owner?: string; conv?: string; webAccion?: "normal" | "forzar" } = {}) {
  const owner = opts.owner ?? OWNER;
  const conv = opts.conv ?? (await nuevaConv(owner));
  const p = new FakeProviderGuionado(guion);
  const tavily = tavilyNuevo();
  const r = await correrChat({ owner, conversacionId: conv, pregunta, webAccion: opts.webAccion }, { provider: p, webProvider: tavily });
  return { conv, p, tavily, r, aud: await auditoria(conv) };
}

function verificarUnica(texto: string, etiqueta: string) {
  for (const [que, aguja] of UNICOS) {
    assert.equal(veces(texto, aguja), 1, `${etiqueta}: "${que}" tiene que aparecer EXACTAMENTE una vez (apareció ${veces(texto, aguja)})`);
  }
  for (const [que, aguja] of PROHIBIDOS) {
    assert.equal(veces(texto, aguja), 0, `${etiqueta}: "${que}" no puede aparecer en la respuesta`);
  }
  assert.equal(veces(texto, "###"), 1, `${etiqueta}: un solo encabezado`);
  assert.ok(texto.trim().startsWith("### "), `${etiqueta}: arranca por el título del servidor`);
  // Nunca una causa afirmada.
  for (const causal of ["porque hubo", "debido a", "gracias a", "la causa fue", "se explica por la"]) {
    assert.ok(!texto.toLowerCase().includes(causal), `${etiqueta}: ninguna causa afirmada ("${causal}")`);
  }
  assert.ok(/no prueban/.test(texto), `${etiqueta}: declara que los datos no prueban la causa`);
}

async function main() {
  await limpiar(); await limpiar(OWNER_B);

  // ── 1) LA CONSULTA DE ACEPTACIÓN, plan correcto + síntesis válida ───────────────────────
  {
    const { p, tavily, r, aud, conv } = await correr(PREGUNTA, [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: PLAN }] },
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_SINTESIS, input: { conclusion: "La facturación cayó $3.014.000 y la actividad bajó 86 turnos, mientras las horas programadas se mantuvieron casi iguales.", afirmaciones: [{ texto: "Los ingresos manuales aportaron -$2.280.000 del cambio.", metrica: "fuente:manuales", direccion: "bajo", evidencias: ["p1.facturacion_bruta", "p2.facturacion_bruta"] }] } }] },
      { tipo: "texto", texto: "Listo." },
    ]);
    try {
      assert.ok(r.ok, "la consulta se resuelve"); if (!r.ok) return;

      // Plan ejecutado con evidencias y cálculos server-side.
      const h = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_ANALISIS_MULTI);
      assert.ok(h?.ok, "el plan se ejecutó");
      const res = h!.resumen as { ok: boolean; evidencias: Array<{ evidenciaId: string; valor: number }>; comparaciones: Array<{ metrica: string; diferencia: number; variacionPct: number | null }>; lectura: { veredicto: string } | null; faltantes: unknown[] };
      assert.equal(res.ok, true);
      assert.equal(res.evidencias.length, 8, "ocho evidencias: facturación, turnos y cronograma de los dos meses");
      assert.equal(res.faltantes.length, 0, "ninguna herramienta falló");
      assert.equal(res.comparaciones.find((c) => c.metrica === "facturacion_bruta")!.diferencia, -3_014_000);
      assert.equal(res.comparaciones.find((c) => c.metrica === "turnos")!.diferencia, -86);
      assert.equal(res.lectura!.veredicto, "compatible_menor_demanda");

      // Una sola respuesta combinada, con la síntesis validada adentro.
      verificarUnica(r.texto, "aceptación");
      assert.ok(r.texto.includes("La facturación cayó $3.014.000"), "la síntesis validada se publica");
      assert.ok(r.texto.includes("-$2.280.000"), "y su afirmación también");
      assert.ok(!r.texto.includes("Listo."), "el texto libre del modelo no se publica");

      // Modelo: escaló a potente por complejidad, y quedó auditado.
      assert.equal(aud?.busqueda_previa.complejidad, "multiherramienta");
      assert.equal(aud?.busqueda_previa.clase_pedida, "potente");
      assert.equal(aud?.clase_modelo, "potente");
      assert.ok(Array.isArray(aud?.busqueda_previa.complejidad_senales));
      assert.ok((aud!.tokens_in ?? 0) > 0 && (aud!.tokens_out ?? 0) > 0, "el consumo de TODAS las llamadas del plan queda registrado");

      // Sin internet.
      assert.equal(tavily.llamadas.length, 0);
      assert.equal(r.busquedasWeb, 0);
      assert.ok(!p.ultimoWebSearch?.habilitado);
      assert.ok((r.fuentes as Array<Record<string, unknown>>).every((f) => f.tipo === "interna" && !f.url));

      // Una sola respuesta persistida.
      const { data: msgs } = await supabaseAdmin.from("ia_mensajes").select("contenido").eq("conversacion_id", conv).eq("rol", "assistant");
      assert.equal((msgs ?? []).length, 1);
      assert.equal((msgs ?? [])[0].contenido, r.texto);
    } finally { await limpiar(OWNER, conv); }
  }
  console.log("OK — 5C (1): CONSULTA DE ACEPTACIÓN end-to-end — plan de 6 pasos, 8 evidencias, cálculos server-side, síntesis validada, modelo potente y cero Tavily.");

  // ── 2) Planes inválidos: ciclo, herramienta inventada, SQL, demasiado largo ──────────────
  {
    const casos: Array<[string, Record<string, unknown>, RegExp]> = [
      ["ciclo", { objetivo: "x", pasos: [{ id: "p1", herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes: 8 }, dependeDe: ["p2"] }, { id: "p2", herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes: 9 } }] }, /hacia atr[áa]s/],
      ["herramienta inventada", { objetivo: "x", pasos: [{ id: "p1", herramienta: "leer_la_mente", argumentos: {} }] }, /no es una herramienta/],
      ["SQL", { objetivo: "select * from reservas", pasos: [{ id: "p1", herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes: 8 } }] }, /SQL|no puede ir/],
      ["demasiado largo", { objetivo: "x", pasos: Array.from({ length: 7 }, (_, i) => ({ id: `p${i + 1}`, herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes: (i % 12) + 1 } })) }, /m[áa]ximo es 6/],
      ["argumento inventado", { objetivo: "x", pasos: [{ id: "p1", herramienta: "consultar_cronograma", argumentos: { anio: 2026, mes: 8, incluir_sueldos: true } }] }, /no es un argumento/],
    ];
    for (const [nombre, plan, patron] of casos) {
      const { tavily, r, conv } = await correr(PREGUNTA, [
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: plan }] },
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: PLAN }] },
        { tipo: "texto", texto: "Corregido." },
      ]);
      try {
        assert.ok(r.ok, nombre); if (!r.ok) return;
        const hs = (r.herramientas as Herramienta[]).filter((x) => x.nombre === NOMBRE_ANALISIS_MULTI);
        assert.equal(hs.length, 2, `${nombre}: un plan rechazado y una reparación`);
        const primero = hs[0].resumen as { ok?: boolean; motivo?: string };
        assert.equal(primero.ok, false, `${nombre}: el plan se rechaza`);
        assert.ok(patron.test(primero.motivo ?? ""), `${nombre}: el motivo lo explica (${primero.motivo})`);
        assert.equal((hs[1].resumen as { ok?: boolean }).ok, true, `${nombre}: la reparación se ejecuta`);
        verificarUnica(r.texto, `${nombre} (reparado)`);
        assert.equal(tavily.llamadas.length, 0, `${nombre}: nunca se sale a internet`);
      } finally { await limpiar(OWNER, conv); }
    }
  }
  console.log("OK — 5C (2): ciclo, herramienta inventada, SQL, plan demasiado largo y argumento inventado se rechazan como reparables; el modelo corrige y nunca se sale a internet.");

  // ── 3) Reparación fallida: no se publica nada aproximado ────────────────────────────────
  {
    const roto = { objetivo: "x", pasos: [{ id: "p1", herramienta: "leer_la_mente", argumentos: {} }] };
    const { r, conv } = await correr(PREGUNTA, [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: roto }] },
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: roto }] },
      { tipo: "texto", texto: "No pude armar el análisis; puedo darte la facturación de cada mes por separado." },
    ]);
    try {
      assert.ok(r.ok); if (!r.ok) return;
      assert.ok(!r.texto.includes("###"), "sin plan válido no se publica ninguna tabla");
      assert.ok(r.texto.includes("No pude armar el análisis"), "el modelo explica la limitación");
      assert.ok(!/\$\d/.test(r.texto), "y no aparece ninguna cifra inventada");
    } finally { await limpiar(OWNER, conv); }
  }
  console.log("OK — 5C (3): si la reparación también falla, no se publica ninguna tabla ni ninguna cifra.");

  // ── 4) Síntesis inválida: la respuesta determinística se publica igual ──────────────────
  {
    const sintesisMalas: Array<[string, Record<string, unknown>]> = [
      ["números inventados", { conclusion: "La facturación cayó $9.999.999." }],
      ["signo cambiado", { conclusion: "La facturación subió 22,4% y los turnos subieron 86." }],
      ["causa no sustentada", { conclusion: "La facturación cayó $3.014.000 porque hubo menos demanda." }],
      ["vacía", { conclusion: "" }],
      ["evidencia inexistente", { conclusion: "Bajó.", afirmaciones: [{ texto: "Algo pasó.", evidencias: ["p99.inventada"] }] }],
      ["ids internos", { conclusion: "Según p1.facturacion_bruta bajó." }],
      // Dirección DECLARADA que contradice el dato: se rechaza por el enum, no por la prosa.
      ["direccion declarada al revés", { conclusion: "Hubo cambios entre los dos meses.", afirmaciones: [{ texto: "La facturación se movió.", metrica: "facturacion_bruta", direccion: "subio", evidencias: ["p1.facturacion_bruta"] }] }],
      ["direccion estable sobre un -22,4%", { conclusion: "Hubo cambios entre los dos meses.", afirmaciones: [{ texto: "La facturación se movió poco.", metrica: "facturacion_bruta", direccion: "estable", evidencias: ["p1.facturacion_bruta"] }] }],
      ["direccion inexistente", { conclusion: "Bajó la facturación.", afirmaciones: [{ texto: "Se hundió.", metrica: "facturacion_bruta", direccion: "se_hundio", evidencias: ["p1.facturacion_bruta"] }] }],
      ["metrica no comparada", { conclusion: "Bajó la facturación.", afirmaciones: [{ texto: "La ganancia también.", metrica: "ganancia_sim", direccion: "bajo", evidencias: ["p1.facturacion_bruta"] }] }],
      ["cambio sin sujeto", { conclusion: "Todo bajó bastante este mes." }],
      ["negacion falsa", { conclusion: "La facturación no cayó entre los dos meses." }],
    ];
    for (const [nombre, sintesis] of sintesisMalas) {
      const { r, conv } = await correr(PREGUNTA, [
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: PLAN }] },
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_SINTESIS, input: sintesis }] },
        { tipo: "texto", texto: "Listo." },
      ]);
      try {
        assert.ok(r.ok, nombre); if (!r.ok) return;
        verificarUnica(r.texto, `síntesis ${nombre}`);
        assert.ok(!r.texto.includes("$9.999.999"), `${nombre}: ninguna cifra inventada`);
        assert.ok(!/subi[óo] 22,4|subieron 86/.test(r.texto), `${nombre}: ningún signo cambiado`);
        assert.ok(!/porque hubo menos demanda/.test(r.texto), `${nombre}: ninguna causa afirmada`);
        assert.ok(r.texto.includes("-$3.014.000"), `${nombre}: las cifras del servidor están`);
      } finally { await limpiar(OWNER, conv); }
    }
  }
  console.log("OK — 5C (4): doce síntesis inválidas (cifras inventadas, signo cambiado, causa, vacía, evidencia fantasma, ids internos, dirección declarada al revés o estable fuera de umbral, enum inexistente, métrica no comparada, cambio sin sujeto y negación falsa) se descartan y queda la respuesta calculada.");

  // ── 5) Narración caída: timeout, truncado, error ────────────────────────────────────────
  {
    for (const [nombre, turno] of [
      ["timeout", { tipo: "timeout" as const }],
      ["error", { tipo: "error" as const, mensaje: "El proveedor falló.", status: 500 }],
      ["truncado", { tipo: "texto" as const, texto: "La facturación cayó $3.0", stopReason: "max_tokens" }],
      ["vacío", { tipo: "texto" as const, texto: "" }],
    ] as const) {
      const { r, conv } = await correr(PREGUNTA, [
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: PLAN }] },
        turno,
      ]);
      try {
        assert.ok(r.ok, nombre); if (!r.ok) return;
        verificarUnica(r.texto, nombre);
        assert.ok(r.texto.includes("-$3.014.000"), `${nombre}: el análisis calculado se publica completo`);
      } finally { await limpiar(OWNER, conv); }
    }
  }
  console.log("OK — 5C (5): con timeout, error, salida truncada o vacía, el análisis determinístico se publica completo.");

  // ── 6) Fallo de una herramienta y de varias ─────────────────────────────────────────────
  {
    const unaFalla = {
      ...PLAN,
      pasos: [...PLAN.pasos.slice(0, 5), { id: "p6", herramienta: "consultar_cronograma", argumentos: { anio: 1999, mes: 1 } }],
    };
    const { r, conv } = await correr(PREGUNTA, [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: unaFalla }] },
      { tipo: "texto", texto: "" },
    ]);
    try {
      assert.ok(r.ok); if (!r.ok) return;
      assert.ok(r.texto.includes("-$3.014.000"), "la facturación comprobada se publica");
      assert.ok(r.texto.includes("-86"), "y los turnos también");
      assert.ok(!/supongo|asumiendo/.test(r.texto), "el hueco no se completa con una suposición");
    } finally { await limpiar(OWNER, conv); }
  }
  console.log("OK — 5C (6): con un cronograma sin datos se publica lo comprobado y no se rellena el hueco.");

  // ── 7) Una pregunta simple NO escala; una compleja sí ───────────────────────────────────
  {
    const simple = await correr("¿Cuánto facturamos en agosto de 2026?", [
      { tipo: "herramientas", llamadas: [{ nombre: "consulta_analitica_interna", input: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" } } }] },
      { tipo: "texto", texto: "Ahí va." },
    ]);
    try {
      assert.ok(simple.r.ok); if (!simple.r.ok) return;
      assert.equal(simple.aud?.busqueda_previa.complejidad, "analitica");
      assert.equal(simple.aud?.clase_modelo, "economico", "una consulta de una métrica NO escala de modelo");
      assert.ok(!simple.p.ultimoHerramientasOfrecidas?.includes(NOMBRE_ANALISIS_MULTI), "y no se le ofrece el planificador");
    } finally { await limpiar(OWNER, simple.conv); }

    const compleja = await correr(PREGUNTA, [{ tipo: "texto", texto: "x" }]);
    try {
      assert.equal(compleja.aud?.clase_modelo, "potente");
      assert.ok(compleja.p.ultimoHerramientasOfrecidas?.includes(NOMBRE_ANALISIS_MULTI), "a la compleja sí se le ofrece el planificador");
      assert.ok(compleja.p.ultimoHerramientasOfrecidas?.includes(NOMBRE_SINTESIS));
    } finally { await limpiar(OWNER, compleja.conv); }
  }
  console.log("OK — 5C (7): una consulta de una sola métrica sigue en el modelo económico y sin el planificador; la multiherramienta escala y recibe las dos herramientas.");

  // ── 8) Contexto conversacional: seguimiento, reemplazo y aislamiento ────────────────────
  {
    // Primer análisis en una conversación.
    const conv = await nuevaConv();
    const primero = await correr("¿Cuánto facturamos de lunes a viernes en agosto de 2026?", [
      { tipo: "herramientas", llamadas: [{ nombre: "consulta_analitica_interna", input: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { dias_semana: ["habiles"] } } }] },
      { tipo: "texto", texto: "" },
    ], { conv });
    assert.ok(primero.r.ok);

    // Seguimiento en LA MISMA conversación: recibe el contexto del anterior.
    const seguimiento = await correr("¿Y solo los fines de semana?", [
      { tipo: "herramientas", llamadas: [{ nombre: "consulta_analitica_interna", input: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { dias_semana: ["fin_de_semana"] } } }] },
      { tipo: "texto", texto: "" },
    ], { conv });
    try {
      assert.ok(seguimiento.r.ok); if (!seguimiento.r.ok) return;
      const ctx = seguimiento.aud?.busqueda_previa.contexto_heredado as { periodos: string[]; metricas: string[] } | null;
      assert.ok(ctx, "el seguimiento recibió el contexto del análisis anterior");
      assert.ok(ctx!.periodos.some((p) => p.startsWith("2026-08")), "con el período del análisis previo");
      assert.deepEqual(ctx!.metricas, ["facturacion_bruta"]);
      // Lo que se le pasa al modelo es una PISTA estructurada, nunca razonamiento guardado.
      const enviado = seguimiento.p.ultimoTurnoUsuario ?? "";
      const pista = enviado.split("[PREGUNTA DEL ADMINISTRADOR]")[0];
      assert.ok(/Contexto del último análisis de ESTA conversación/.test(pista), "la pista estructurada viaja como dato de usuario");
      assert.ok(/2026-08-01\.\.2026-08-31/.test(pista), "con el período anterior");
      assert.ok(/facturacion_bruta/.test(pista), "con la métrica anterior");
      // El filtro se nombra con el identificador PÚBLICO, el único que el modelo puede reescribir.
      assert.ok(/dias_semana=1\/2\/3\/4\/5/.test(pista), "y con el filtro anterior en su nombre de contrato");
      assert.ok(!/diasSemana/.test(pista), "nunca con el nombre interno");
      assert.ok(/REEMPLAZA/.test(pista), "y aclara que una instrucción nueva reemplaza la anterior");
      assert.ok(/preguntá cuál antes de ejecutar/.test(pista), "y que ante dos lecturas razonables hay que preguntar");
      // Contexto ESTRUCTURADO: ni resultados ni cadena de razonamiento del turno anterior.
      assert.ok(!/\$|\d{1,3}\.\d{3}/.test(pista.replace(/2026-\d\d-\d\d/g, "")), "sin importes ni resultados del análisis anterior");
      assert.ok(!/cadena de razonamiento|porque|concluy/i.test(pista), "sin razonamiento guardado");
      assert.ok(seguimiento.r.texto.includes("$5.774.000"), "y el resultado es el del fin de semana");
    } finally { await limpiar(OWNER, conv); }

    // Otra conversación arranca SIN contexto heredado.
    const otra = await correr("¿Y solo los fines de semana?", [
      { tipo: "herramientas", llamadas: [{ nombre: "consulta_analitica_interna", input: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, filtros: { dias_semana: ["fin_de_semana"] } } }] },
      { tipo: "texto", texto: "" },
    ], { owner: OWNER_B });
    try {
      assert.equal(otra.aud?.busqueda_previa.contexto_heredado, null, "una conversación nueva no hereda nada");
    } finally { await limpiar(OWNER_B, otra.conv); }
  }
  console.log("OK — 5C (8): un seguimiento hereda el contexto de SU conversación y otra conversación arranca sin nada.");

  // ── 9) Intento de forzar Tavily, de sacar PII y de escribir ─────────────────────────────
  {
    // Forzar web en una pregunta interna.
    const forzado = await correr(PREGUNTA, [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: PLAN }], web: { busquedasFacturables: 3, fuentes: [{ url: "https://ejemplo.com/x", titulo: "X", dominio: "ejemplo.com", orden: 0 }] } },
      { tipo: "texto", texto: "Según una nota externa." },
    ], { webAccion: "forzar" });
    try {
      assert.ok(forzado.r.ok); if (!forzado.r.ok) return;
      assert.equal(forzado.tavily.llamadas.length, 0, "ni forzando se llama a Tavily");
      assert.equal(forzado.r.busquedasWeb, 0);
      assert.ok((forzado.r.fuentes as Array<Record<string, unknown>>).every((f) => f.tipo === "interna"));
      verificarUnica(forzado.r.texto, "web forzada");
    } finally { await limpiar(OWNER, forzado.conv); }

    // Pedir PII dentro de un plan: el cronograma trae nombres del equipo, no de clientes, y la
    // respuesta agregada no los publica.
    const pii = await correr("Dame los teléfonos de los clientes que reservaron en agosto", [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: { objetivo: "Clientes de agosto", pasos: [{ id: "p1", herramienta: "consulta_analitica_interna", argumentos: { metricas: ["operaciones"], periodo: { mes: "2026-08" } } }] } }] },
      { tipo: "texto", texto: "" },
    ]);
    try {
      assert.ok(pii.r.ok); if (!pii.r.ok) return;
      assert.ok(!/@|\+54/.test(pii.r.texto), "ningún dato de contacto");
      assert.ok(!/\b(dni|documento|tel[eé]fono)\b/i.test(pii.r.texto), "ningún campo personal");
    } finally { await limpiar(OWNER, pii.conv); }

    // Intento de escritura: ninguna capacidad lo permite.
    const escritura = await correr("Borrá los turnos de agosto", [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: { objetivo: "Borrar turnos", pasos: [{ id: "p1", herramienta: "eliminar_turnos", argumentos: { mes: 8 } }] } }] },
      { tipo: "texto", texto: "No puedo modificar datos: solo leo." },
    ]);
    try {
      assert.ok(escritura.r.ok); if (!escritura.r.ok) return;
      const h = (escritura.r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_ANALISIS_MULTI);
      assert.equal((h!.resumen as { ok?: boolean }).ok, false, "una herramienta de escritura no existe en el catálogo");
      assert.ok(!escritura.r.texto.includes("###"), "y no se publica ningún análisis");
    } finally { await limpiar(OWNER, escritura.conv); }
  }
  console.log("OK — 5C (9): no se puede forzar Tavily, no sale PII y una herramienta de escritura no existe para el planificador.");

  // ── 10) Pregunta AMBIGUA: se pregunta, no se adivina ────────────────────────────────────
  {
    const { r, conv, aud, p: prov } = await correr("¿Qué fuentes explican la variación de facturación entre los dos meses?", [
      { tipo: "texto", texto: "¿Qué dos meses querés comparar: agosto contra septiembre de 2026, o septiembre contra octubre?" },
    ]);
    try {
      assert.ok(r.ok); if (!r.ok) return;
      assert.equal(aud?.busqueda_previa.complejidad, "multiherramienta", "se clasifica como pedido comparativo");
      assert.ok(prov.ultimoHerramientasOfrecidas?.includes(NOMBRE_ANALISIS_MULTI), "el planificador estaba disponible");
      assert.ok(/\?/.test(r.texto), "se devuelve una pregunta concreta");
      assert.ok(!r.texto.includes("###"), "y no se publica ninguna tabla adivinada");
      assert.ok(!/\$\d/.test(r.texto), "ni ninguna cifra");
      const hs = (r.herramientas as Herramienta[]).filter((x) => x.nombre === NOMBRE_ANALISIS_MULTI);
      assert.equal(hs.length, 0, "no se ejecutó ningún plan inventado");
    } finally { await limpiar(OWNER, conv); }
  }
  console.log("OK — 5C (10): con el planificador disponible pero el período ambiguo, se devuelve una pregunta concreta en vez de un plan inventado.");

  // ── 11) Modelo avanzado NO disponible: se degrada y queda auditado ───────────────────────
  {
    const modelos = getModelos();
    // Con el nivel potente sin configurar, un pedido multiherramienta cae al económico y lo declara.
    const sinPotente = claseEfectiva("potente", { ...modelos, potente: "" });
    assert.equal(sinPotente.clase, "economico");
    assert.equal(sinPotente.degradado, true);
    // Y al revés: sin el económico, una consulta simple usa el potente antes que no responder.
    const sinEconomico = claseEfectiva("economico", { ...modelos, economico: "  " });
    assert.equal(sinEconomico.clase, "potente");
    assert.equal(sinEconomico.degradado, true);
    // Con los dos configurados no hay degradación, y el servidor lo audita en cada ejecución.
    assert.deepEqual(claseEfectiva("potente", modelos), { clase: "potente", degradado: false });
    const { r, conv, aud } = await correr(PREGUNTA, [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_ANALISIS_MULTI, input: PLAN }] },
      { tipo: "texto", texto: "" },
    ]);
    try {
      assert.ok(r.ok); if (!r.ok) return;
      assert.equal(aud?.busqueda_previa.modelo_degradado, false, "la degradación se audita siempre, incluso cuando no ocurrió");
      assert.equal(aud?.busqueda_previa.clase_por_complejidad, "potente");
      verificarUnica(r.texto, "modelo configurado");
    } finally { await limpiar(OWNER, conv); }
  }
  console.log("OK — 5C (11): si el nivel avanzado no está configurado la clase se degrada al disponible y la degradación queda auditada.");

  // ── 11.1) La complejidad SOLO escala: no baja de nivel lo que el router ya escaló ───────
  {
    // Un análisis competitivo lo manda al potente el router de 4D, no la complejidad de 5C.
    const competitivo = await correr("Hacé un análisis competitivo de SIM contra el mercado de Córdoba.", [{ tipo: "texto", texto: "x" }]);
    try {
      assert.notEqual(competitivo.aud?.busqueda_previa.complejidad, "multiherramienta", "no es un pedido multiherramienta");
      assert.equal(competitivo.aud?.busqueda_previa.clase_por_complejidad, "economico", "la complejidad no pide escalar");
      assert.equal(competitivo.aud?.clase_modelo, "potente", "y aun así se usa el potente: 5C no degrada lo que el router escaló");
    } finally { await limpiar(OWNER, competitivo.conv); }

    // Y al revés: una consulta que el router deja en económico, con un pedido multiherramienta, escala.
    const multi = await correr(PREGUNTA, [{ tipo: "texto", texto: "x" }]);
    try {
      assert.equal(multi.aud?.busqueda_previa.clase_por_complejidad, "potente");
      assert.equal(multi.aud?.clase_modelo, "potente");
    } finally { await limpiar(OWNER, multi.conv); }
  }
  console.log("OK — 5C (11.1): la complejidad solo escala; un análisis competitivo sigue en el modelo potente que ya elegía el router.");

  // ── 12) Las redacciones del bloque rutean interno ───────────────────────────────────────
  {
    for (const q of [
      PREGUNTA,
      "¿Qué fuentes explican la diferencia de facturación entre dos meses?",
      "Detectá el período más flojo y después desglosalo por día y fuente.",
      "¿La caída de facturación coincidió con menos actividad o solamente con menos ingresos manuales?",
      "Compará fines de semana de agosto y septiembre y decime en cuál hubo mayor actividad.",
      "¿Los días con más horas programadas también tuvieron más turnos?",
      "¿Qué cambió entre este mes y el anterior en facturación, personas, turnos y minutos?",
      "¿Por qué septiembre rindió distinto de agosto según nuestros datos?",
      "¿La variación vino del Turnero, Reservas, Campeonatos, Mensualidades o ingresos manuales?",
      "Mostrame primero el resultado general y después profundizá solamente en lo que más cambió.",
    ]) {
      const d = clasificarConsulta(q);
      assert.notEqual(d.ruta, "externa", `"${q}" no puede irse a internet`);
      assert.equal(d.webPermitida, false, `"${q}": Tavily bloqueado`);
    }
  }
  console.log("OK — 5C (12): las diez preguntas del bloque rutean interno con Tavily bloqueado.");

  // ── 13) Cero consumo de créditos ────────────────────────────────────────────────────────
  {
    const { count } = await supabaseAdmin.from("ia_busquedas_web").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).gt("creditos_busqueda", 0);
    assert.equal(count ?? 0, 0, "ninguna búsqueda con créditos");
  }
  await limpiar(); await limpiar(OWNER_B);
  console.log("OK — 5C (13): ninguna búsqueda con consumo de créditos durante la corrida.");

  console.log("\nOK — 5C end-to-end: planificación multiherramienta, síntesis validada contra evidencia, fallos parciales declarados, contexto aislado y una sola respuesta combinada.");
}

main().catch((e) => { console.error(e); process.exit(1); });

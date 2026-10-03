// Bloque 5B.1 — NO DUPLICACIÓN del ensamblado. Integración end-to-end contra Supabase real
// (SOLO LECTURA de datos de negocio; escritura únicamente en tablas ia_* con fixtures ZZTEST).
// Proveedor de Claude SIEMPRE falso; Tavily SIEMPRE falso y verificado sin usar.
//
// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/analisis/servidor5b1.integration.ts
//
// El defecto que cubre: la prueba autenticada de 5B publicó DOS respuestas enteras —la del modelo
// y la del servidor— con el marcador interno en medio, $365.714 contra $365.714,29, los ceros
// escritos de dos formas y cinco hallazgos. Acá el modelo intenta todas esas cosas y la respuesta
// final tiene que seguir siendo UNA sola, la del servidor.
//
// No alcanza con comprobar que la respuesta "contiene" la tabla: se CUENTAN las ocurrencias.

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado, type GuionTurno } from "@/lib/ia/providerFake";
import { FakeWebSearchProvider } from "@/lib/ia/web/providerWebFake";
import { NOMBRE_CONSULTA_ANALITICA } from "@/lib/ia/analisis/herramientaAnalitica";

const OWNER = "admin:zztest-5b1";
const MES = "2026-08";

const PREGUNTA =
  "En agosto de 2026, separá la facturación de lunes a viernes y la de sábados y domingos. Mostrame el total, el promedio por día calendario, el mejor día y el desglose por fuente de cada grupo.";
const PLAN = {
  metricas: ["facturacion_bruta"],
  periodo: { mes: MES },
  segmentacion: { tipo: "dias_semana", grupo_a: ["habiles"], grupo_b: ["fin_de_semana"] },
  calculos: ["promedio_dia_calendario", "maximo"],
};

// Lo que el servidor tiene que publicar, exactamente una vez cada cosa.
const UNICOS = [
  ["título", "### Facturación bruta"],
  ["tabla de grupos", "| Grupo | Días |"],
  ["fila de hábiles", "| Lunes a viernes | 21 |"],
  ["fila de fin de semana", "| Sábados y domingos | 10 |"],
  ["fila de total", "| **Total** | **31** |"],
  ["desglose por fuente", "**Desglose por fuente**"],
  ["criterio contable", "Facturación total operativa bruta"],
] as const;

// Un importe puede estar en la respuesta directa Y en la tabla: eso no es duplicar. Lo que no
// puede pasar es que aparezca dos veces DENTRO de las tablas, que es la forma del defecto.
const UNICOS_EN_TABLA = [
  ["total de hábiles", "$7.680.000"],
  ["total del fin de semana", "$5.774.000"],
  ["total del mes", "$13.454.000"],
  ["promedio de hábiles", "$365.714,29"],
  ["promedio del fin de semana", "$577.400"],
] as const;

// Lo que el modelo intentó meter y NO puede aparecer.
const PROHIBIDOS = [
  ["marcador interno", "ia-sim:tabla-analitica"],
  ["comentario HTML", "<!--"],
  ["promedio redondeado del modelo", "$365.714,2 "],
  ["promedio truncado del modelo", "$365.714 "],
] as const;

type Herramienta = { nombre: string; ok: boolean; resumen?: Record<string, unknown> };

async function limpiar(id?: string) {
  if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}
async function nuevaConv(): Promise<string> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 5b1", estado: "activa" }).select("id").single();
  return data!.id as string;
}
const tavilyNuevo = () => new FakeWebSearchProvider([{ tipo: "ok", resultados: [{ titulo: "Nota externa", url: "https://ejemplo.com/nota", dominio: "ejemplo.com", fechaPublicada: "2026-08-20", fragmento: "No debería usarse.", posicion: 0 }] }]);

const veces = (texto: string, aguja: string) => texto.split(aguja).length - 1;

/** Lo que el modelo devolvió en producción: la respuesta ENTERA, con otro redondeo y 5 hallazgos. */
const NARRACION_DUPLICADA = `## Facturación de agosto 2026: días hábiles vs fin de semana

| Grupo | Días | Facturación | Promedio diario | Mejor día |
| --- | --- | --- | --- | --- |
| Lunes a viernes | 21 | $7.680.000 | $365.714 | 18 de agosto |
| Sábados y domingos | 10 | $5.774.000 | $577.400 | 15 de agosto |
| Total | 31 | $13.454.000 | $434.000 | — |

**Desglose por fuente**

| Fuente | Hábiles | Fin de semana |
| --- | --- | --- |
| Turnero | $4.690.000 | $5.568.000 |
| Manuales | $2.950.000 | — |
| Campeonatos | $40.000 | $80.000 |
| Reservas online | — | $126.000 |

**Hallazgos**
1. Los días hábiles concentran el 57,1% de la facturación.
2. El fin de semana rinde 1,6 veces más por día.
3. El turnero es la fuente principal en los dos grupos.
4. Los ingresos manuales aparecen solo en días hábiles.
5. La campaña de mitad de mes explica el pico del 18.`;

async function correr(guion: GuionTurno[], webAccion?: "normal" | "forzar") {
  const conv = await nuevaConv();
  const p = new FakeProviderGuionado(guion);
  const tavily = tavilyNuevo();
  const r = await correrChat({ owner: OWNER, conversacionId: conv, pregunta: PREGUNTA, webAccion }, { provider: p, webProvider: tavily });
  return { conv, p, tavily, r, limpiar: () => limpiar(conv) };
}

/** El contrato de 5B.1, verificado contando: una sola representación canónica. */
function verificarUnica(texto: string, etiqueta: string) {
  for (const [que, aguja] of UNICOS) {
    assert.equal(veces(texto, aguja), 1, `${etiqueta}: "${que}" tiene que aparecer EXACTAMENTE una vez (apareció ${veces(texto, aguja)})`);
  }
  for (const [que, aguja] of PROHIBIDOS) {
    assert.equal(veces(texto, aguja), 0, `${etiqueta}: "${que}" no puede aparecer`);
  }
  const enTabla = texto.split("\n").filter((l) => l.trim().startsWith("|")).join("\n");
  for (const [que, aguja] of UNICOS_EN_TABLA) {
    assert.equal(veces(enTabla, aguja), 1, `${etiqueta}: "${que}" aparece una sola vez dentro de las tablas (apareció ${veces(enTabla, aguja)})`);
  }

  // Un solo encabezado, un solo bloque de tabla, una sola respuesta directa en negrita.
  assert.equal(veces(texto, "###"), 1, `${etiqueta}: un solo encabezado`);
  assert.equal(veces(texto, "##"), 1, `${etiqueta}: ningún encabezado extra del modelo (## suelto)`);
  // "Lunes a viernes" aparece además como COLUMNA del desglose por fuente, así que lo que se
  // cuenta es la fila del grupo (ya está en UNICOS) y acá, que no haya dos tablas de grupos.
  const filasTabla = texto.split("\n").filter((l) => l.trim().startsWith("|"));
  assert.equal(filasTabla.filter((l) => l.includes("| Grupo |")).length, 1, `${etiqueta}: una sola tabla de grupos`);
  assert.equal(filasTabla.filter((l) => /^\|\s*Lunes a viernes\s*\|/.test(l.trim())).length, 1, `${etiqueta}: la fila de hábiles no se repite`);

  // Los ceros, de UNA sola manera: el servidor usa $0, nunca un guion en una celda de importe.
  assert.ok(texto.includes("| $0 |"), `${etiqueta}: los ceros se escriben $0`);
  const celdasGuion = filasTabla.filter((l) => /\|\s*—\s*\|/.test(l));
  assert.equal(celdasGuion.length, 0, `${etiqueta}: ninguna celda de importe con guion`);

  // Como máximo dos hallazgos, y ninguna inferencia causal.
  const hallazgos = texto.split("\n").filter((l) => l.startsWith("_") && !l.includes("total operativa bruta") && !l.includes("mismo valor") && !l.includes("No hay ingresos") && !l.includes("Se muestran las primeras"));
  assert.ok(hallazgos.length <= 2, `${etiqueta}: como máximo dos hallazgos (hubo ${hallazgos.length})`);
  for (const causal of ["campaña", "porque", "debido a", "gracias a", "la causa", "explica el pico"]) {
    assert.ok(!texto.toLowerCase().includes(causal), `${etiqueta}: ninguna inferencia causal ("${causal}")`);
  }
}

async function main() {
  await limpiar();

  // ── Los once escenarios de narración del modelo ─────────────────────────────────────────
  const escenarios: Array<[string, GuionTurno]> = [
    ["1. tabla completa duplicada", { tipo: "texto", texto: NARRACION_DUPLICADA }],
    ["2. mismos números con otro redondeo", { tipo: "texto", texto: "Hábiles $7.680.000 (promedio $365.714). Finde $5.774.000 (promedio $577.400,00). Total $13.454.000." }],
    ["3. cifras incorrectas", { tipo: "texto", texto: "Hábiles $7.000.000 y finde $6.454.000, total $13.454.000. El mejor día fue el 20 de agosto con $2.000.000." }],
    ["4. cinco hallazgos", { tipo: "texto", texto: "_Hallazgo 1._\n_Hallazgo 2._\n_Hallazgo 3._\n_Hallazgo 4._\n_Hallazgo 5._" }],
    ["5. solo una introducción", { tipo: "texto", texto: "Acá va el análisis de agosto que pediste, separado por tipo de día:" }],
    ["6. texto vacío", { tipo: "texto", texto: "" }],
    ["7. respuesta truncada", { tipo: "texto", texto: "La facturación de lunes a viernes fue de $7.680.0", stopReason: "max_tokens" }],
    ["8. marcador interno escapado", { tipo: "texto", texto: "<!-- ia-sim:tabla-analitica -->\n### Facturación bruta — agosto de 2026\n| Grupo | Días |\n| --- | --- |" }],
    ["9. timeout sin narración", { tipo: "timeout" }],
    ["10. cambia $0 por un guion", { tipo: "texto", texto: "| Fuente | Hábiles | Fin de semana |\n| --- | --- | --- |\n| Manuales | $2.950.000 | — |" }],
    ["11. inferencia causal", { tipo: "texto", texto: "El pico del 18 de agosto se explica porque hubo una campaña de descuentos." }],
  ];

  for (const [nombre, turno] of escenarios) {
    const { p, tavily, r, conv, limpiar: fin } = await correr([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN }] },
      turno,
    ]);
    try {
      assert.ok(r.ok, `${nombre}: el turno no se pierde`); if (!r.ok) return;

      // Precondición: el motor analítico calculó bien. Lo que se prueba es el ENSAMBLADO.
      const h = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
      assert.equal((h?.resumen as { ok?: boolean } | undefined)?.ok, true, `${nombre}: precondición — el resultado interno es válido`);

      verificarUnica(r.texto, nombre);

      // Las cifras son EXCLUSIVAMENTE las del servidor: lo que el modelo inventó no entra.
      assert.ok(!r.texto.includes("$7.000.000") && !r.texto.includes("$6.454.000") && !r.texto.includes("20 de agosto") && !r.texto.includes("$2.000.000"),
        `${nombre}: ninguna cifra inventada por el modelo`);
      assert.ok(!r.texto.includes("Acá va el análisis") && !r.texto.includes("Hallazgo 1"), `${nombre}: ninguna redacción libre del modelo`);
      assert.ok(r.texto.trim().startsWith("### "), `${nombre}: la respuesta arranca por el título del servidor`);

      // Se persiste UNA sola respuesta, y es la misma que se devolvió.
      const { data: mensajes } = await supabaseAdmin.from("ia_mensajes").select("contenido, rol").eq("conversacion_id", conv).eq("rol", "assistant");
      assert.equal((mensajes ?? []).length, 1, `${nombre}: se persiste exactamente un mensaje del asistente`);
      assert.equal((mensajes ?? [])[0].contenido, r.texto, `${nombre}: lo persistido es lo publicado`);
      verificarUnica(String((mensajes ?? [])[0].contenido), `${nombre} (persistido)`);

      // Fuentes: una sola vez, internas, y después del contenido (las arma la UI con este array).
      const fuentes = r.fuentes as Array<Record<string, unknown>>;
      assert.ok(fuentes.length > 0 && fuentes.every((f) => f.tipo === "interna" && !f.url), `${nombre}: fuentes internas`);
      assert.equal(new Set(fuentes.map((f) => String(f.modulo))).size, fuentes.length, `${nombre}: ninguna fuente repetida`);
      assert.ok(!r.texto.includes("Fuentes"), `${nombre}: el contenido no trae su propia sección de Fuentes (la pone la interfaz, después)`);

      // Y sigue sin internet.
      assert.equal(tavily.llamadas.length, 0, `${nombre}: sin Tavily`);
      assert.equal(r.busquedasWeb, 0, `${nombre}: cero búsquedas`);
      assert.ok(!p.ultimoWebSearch?.habilitado, `${nombre}: sin web_search del proveedor`);
    } finally { await fin(); }
    console.log(`OK — 5B.1 · ${nombre}: una sola respuesta canónica, con las cifras del servidor.`);
  }

  // ── La misma respuesta, pase lo que pase: es BYTE a BYTE idéntica ────────────────────────
  {
    const textos: string[] = [];
    for (const turno of [
      { tipo: "texto" as const, texto: NARRACION_DUPLICADA },
      { tipo: "texto" as const, texto: "" },
      { tipo: "error" as const, mensaje: "El proveedor falló.", status: 500 },
    ]) {
      const { r, limpiar: fin } = await correr([
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN }] },
        turno,
      ]);
      try {
        assert.ok(r.ok); if (!r.ok) return;
        textos.push(r.texto);
      } finally { await fin(); }
    }
    assert.equal(textos[0], textos[1], "la respuesta no depende de lo que escriba el modelo");
    assert.equal(textos[1], textos[2], "ni de que el proveedor falle");
  }
  console.log("OK — 5B.1: con narración duplicada, con texto vacío o con el proveedor caído, la respuesta publicada es byte a byte la misma.");

  // ── Tavily bloqueado aunque se fuerce, con narración duplicada encima ───────────────────
  {
    const { tavily, r, limpiar: fin } = await correr([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN }], web: { busquedasFacturables: 2, fuentes: [{ url: "https://ejemplo.com/x", titulo: "X", dominio: "ejemplo.com", orden: 0 }] } },
      { tipo: "texto", texto: NARRACION_DUPLICADA },
    ], "forzar");
    try {
      assert.ok(r.ok); if (!r.ok) return;
      assert.equal(tavily.llamadas.length, 0);
      assert.equal(r.busquedasWeb, 0);
      verificarUnica(r.texto, "forzando web");
    } finally { await fin(); }
  }
  console.log("OK — 5B.1: ni forzando la búsqueda web se duplica la respuesta ni entra una fuente externa.");

  // ── Una aclaración NO publica tabla (el resultado no es válido, no hay canónica) ─────────
  {
    const { r, limpiar: fin } = await correr([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: { calculos: ["maximo"] } }] },
      { tipo: "texto", texto: "¿Qué querés medir: facturación, turnos, personas o minutos de actividad?" },
    ]);
    try {
      assert.ok(r.ok); if (!r.ok) return;
      assert.ok(!r.texto.includes("### Facturación"), "sin resultado válido no se publica ninguna tabla");
      assert.ok(r.texto.includes("¿Qué querés medir"), "y la pregunta del modelo sí llega al usuario");
      assert.ok(!r.texto.includes("<!--"), "sin marcadores");
    } finally { await fin(); }
  }
  console.log("OK — 5B.1: cuando no hay resultado válido el modelo conserva la palabra y no se publica tabla alguna.");

  // ── Otras herramientas de IA SIM: el ensamblador no las toca ─────────────────────────────
  {
    const { r, limpiar: fin } = await correr([
      { tipo: "herramientas", llamadas: [{ nombre: "consultar_metricas_stand_reservas", input: { anio: 2026, mes: 8 } }] },
      { tipo: "texto", texto: "En agosto el stand tuvo actividad sostenida." },
    ]);
    try {
      assert.ok(r.ok); if (!r.ok) return;
      assert.equal(r.texto, "En agosto el stand tuvo actividad sostenida.", "sin consulta analítica, el texto del modelo se publica tal cual");
      assert.ok(!r.texto.includes("###"), "y no se le inyecta ninguna tabla");
    } finally { await fin(); }
  }
  console.log("OK — 5B.1: con otra herramienta interna el ensamblador no interviene y el texto del modelo se publica tal cual.");

  // ── Cero consumo de créditos ────────────────────────────────────────────────────────────
  {
    const { count } = await supabaseAdmin.from("ia_busquedas_web").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 20 * 60_000).toISOString()).gt("creditos_busqueda", 0);
    assert.equal(count ?? 0, 0, "ninguna búsqueda con créditos");
  }
  await limpiar();
  console.log("OK — 5B.1: ninguna búsqueda con consumo de créditos durante la corrida.");

  console.log("\nOK — 5B.1: una sola respuesta canónica del servidor en los once escenarios de narración, contada ocurrencia por ocurrencia.");
}

main().catch((e) => { console.error(e); process.exit(1); });

// Bloque 5B — integración end-to-end contra Supabase real (SOLO LECTURA de datos de negocio;
// escritura únicamente en tablas ia_* con fixtures ZZTEST). Proveedor de Claude SIEMPRE falso;
// Tavily SIEMPRE falso y verificado sin usar. Cero llamadas reales, cero créditos.
//
// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/analisis/servidor5b.integration.ts
//
// Qué se puede y qué no se puede probar con un proveedor falso: la traducción de la pregunta al
// plan la hace el MODELO, así que acá no se verifica su criterio. Sí se verifica lo que garantiza
// el SERVIDOR, que es la mitad que importa para no inventar nada:
//   · cada redacción de la pregunta rutea INTERNO y deja Tavily bloqueado;
//   · planes EQUIVALENTES escritos de formas distintas dan el MISMO resultado;
//   · un pedido imposible o ambiguo no ejecuta datos y devuelve una sola aclaración concreta;
//   · si la narración del modelo se cae, el resultado determinístico se publica igual.

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { FakeWebSearchProvider } from "@/lib/ia/web/providerWebFake";
import { clasificarConsulta } from "@/lib/ia/ruteo";
import { NOMBRE_CONSULTA_ANALITICA } from "@/lib/ia/analisis/herramientaAnalitica";
import { MARCADOR_TABLA_ANALITICA } from "@/lib/ia/analisis/renderAnalitico";
import { validarPlan } from "@/lib/ia/analisis/planAnalitico";
import { ejecutarPlanAnalitico } from "@/lib/ia/analisis/ejecutorAnalitico";

const OWNER = "admin:zztest-5b";
const MES = "2026-08";

// La consulta de ACEPTACIÓN y su plan.
const PREGUNTA_ACEPTACION =
  "En agosto de 2026, separá la facturación de lunes a viernes y la de sábados y domingos. Mostrame el total, el promedio por día calendario, el mejor día y el desglose por fuente de cada grupo.";
const PLAN_ACEPTACION = {
  metricas: ["facturacion_bruta"],
  periodo: { mes: MES },
  segmentacion: { tipo: "dias_semana", grupo_a: ["habiles"], grupo_b: ["fin_de_semana"] },
  calculos: ["promedio_dia_calendario", "maximo"],
};

// Verificado aparte en SQL sobre fin_eventos_facturacion.
const ESPERADO = {
  habiles: { total: "$7.680.000", dias: 21, promedio: "$365.714,29", mejor: "18 de agosto", mejorMonto: "$1.720.000" },
  finde: { total: "$5.774.000", dias: 10, promedio: "$577.400", mejor: "15 de agosto", mejorMonto: "$878.000" },
  totalMes: "$13.454.000",
};

type Herramienta = { nombre: string; ok: boolean; resumen?: Record<string, unknown> };

async function limpiar(id?: string) {
  if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}
async function nuevaConv(): Promise<string> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 5b", estado: "activa" }).select("id").single();
  return data!.id as string;
}
async function auditoria(conversacionId: string) {
  const { data } = await supabaseAdmin.from("ia_ejecuciones").select("busqueda_previa, busquedas_web, clase_modelo").eq("conversacion_id", conversacionId).order("created_at", { ascending: false }).limit(1);
  return (data ?? [])[0] as { busqueda_previa: Record<string, unknown>; busquedas_web: number; clase_modelo: string } | undefined;
}
// Tavily falso CON resultados: si alguna vez se lo llamara, el test lo detecta.
const tavilyNuevo = () => new FakeWebSearchProvider([{ tipo: "ok", resultados: [{ titulo: "Nota externa", url: "https://ejemplo.com/nota", dominio: "ejemplo.com", fechaPublicada: "2026-08-20", fragmento: "No debería usarse.", posicion: 0 }] }]);

async function correr(pregunta: string, guion: ConstructorParameters<typeof FakeProviderGuionado>[0], webAccion?: "normal" | "forzar") {
  const conv = await nuevaConv();
  const p = new FakeProviderGuionado(guion);
  const tavily = tavilyNuevo();
  const r = await correrChat({ owner: OWNER, conversacionId: conv, pregunta, webAccion }, { provider: p, webProvider: tavily });
  const aud = await auditoria(conv);
  return { conv, p, tavily, r, aud, limpiar: () => limpiar(conv) };
}

async function main() {
  await limpiar();

  // ── 1) LA CONSULTA DE ACEPTACIÓN, de punta a punta ──────────────────────────────────────
  {
    const { p, tavily, r, aud, limpiar: fin } = await correr(PREGUNTA_ACEPTACION, [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_ACEPTACION }] },
      { tipo: "texto", texto: "El fin de semana rinde más por día, aunque los hábiles sumen más en total." },
    ]);
    try {
      assert.ok(r.ok, "la consulta se resuelve"); if (!r.ok) return;

      // Ruta interna y Tavily bloqueado.
      assert.equal(aud?.busqueda_previa.ruta, "interna");
      assert.equal(aud?.busqueda_previa.web_permitida, false);
      assert.equal(tavily.llamadas.length, 0, "Tavily NUNCA se llamó");
      assert.equal(r.busquedasWeb, 0);
      assert.ok(!p.ultimoWebSearch?.habilitado, "tampoco se le ofreció el web_search del proveedor");

      // El plan se ejecutó y los dos grupos están.
      const h = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
      assert.ok(h?.ok, "la consulta analítica se ejecutó");
      const res = h!.resumen as { ok: boolean; segmentos: Array<{ etiqueta: string; diasCalendario: number; totales: Array<{ valor: number }> }> };
      assert.equal(res.ok, true);
      assert.equal(res.segmentos.length, 2);
      assert.equal(res.segmentos[0].diasCalendario, ESPERADO.habiles.dias);
      assert.equal(res.segmentos[1].diasCalendario, ESPERADO.finde.dias);
      assert.equal(res.segmentos[0].totales[0].valor + res.segmentos[1].totales[0].valor, 13_454_000, "los dos grupos cierran el total del mes");

      // La respuesta publicada tiene todo lo que se pidió.
      assert.ok(r.texto.includes(MARCADOR_TABLA_ANALITICA), "la respuesta la publica el servidor");
      assert.ok(r.texto.includes("Lunes a viernes") && r.texto.includes("Sábados y domingos"), "los dos grupos aparecen");
      assert.ok(r.texto.includes(ESPERADO.habiles.total) && r.texto.includes(ESPERADO.finde.total), "los dos totales");
      assert.ok(r.texto.includes(ESPERADO.habiles.promedio) && r.texto.includes(ESPERADO.finde.promedio), "los dos promedios por día calendario");
      assert.ok(r.texto.includes(ESPERADO.habiles.mejor) && r.texto.includes(ESPERADO.finde.mejor), "el mejor día de cada grupo");
      assert.ok(r.texto.includes(ESPERADO.totalMes), "y el total del mes");
      assert.ok(r.texto.includes("Desglose por fuente"), "el desglose por fuente de cada grupo");
      assert.ok(r.texto.includes("| **Total** | **31** |") || r.texto.includes("**31**"), "los 31 días del mes");
      assert.ok(r.texto.includes("total operativa bruta"), "declara el criterio contable");
      assert.ok(!/no cumpli[óo] el formato esperado/i.test(r.texto));

      // Sin PII, sin fuentes externas, sin inferencias causales del servidor.
      const fuentes = r.fuentes as Array<Record<string, unknown>>;
      assert.ok(fuentes.every((f) => f.tipo === "interna" && !f.url), "todas las fuentes son internas");
      assert.ok(!/@|\+54/.test(r.texto), "ningún dato de contacto");
      assert.equal(r.estado, "completa");
    } finally { await fin(); }
  }
  console.log(`OK — 5B (1): CONSULTA DE ACEPTACIÓN end-to-end: hábiles ${ESPERADO.habiles.total}/21 días y finde ${ESPERADO.finde.total}/10 días, promedios, mejor día, desglose por fuente y total ${ESPERADO.totalMes}, sin Tavily.`);

  // ── 2) Cada redacción rutea INTERNO (lo que garantiza el servidor) ──────────────────────
  {
    const redacciones = [
      "¿Cuánto vendimos entre semana en agosto?",
      "Decime la facturación de lunes a viernes de agosto.",
      "¿Cuánto ingresó durante los días hábiles de agosto?",
      "Separame agosto entre semana y fin de semana.",
      "Mostrame las fuentes que más facturaron.",
      "¿Cuáles fueron los cinco mejores días?",
      "Compará lunes contra viernes.",
      "¿Qué días de agosto facturamos más?",
      "¿Cuál fue el método de pago más utilizado?",
      "¿Qué porcentaje de la facturación provino de cada fuente?",
      "¿Cuántos turnos comerciales, personas y minutos de actividad hubo por día?",
      "¿Qué promedio diario tuvimos durante este mes?",
      "Desglosame las ventas automáticas y manuales.",
      "¿Qué pasó durante los fines de semana?",
    ];
    for (const q of redacciones) {
      const d = clasificarConsulta(q);
      assert.notEqual(d.ruta, "externa", `"${q}" no puede irse a internet`);
      assert.equal(d.webPermitida, false, `"${q}": Tavily bloqueado`);
    }
  }
  console.log(`OK — 5B (2): las ${14} redacciones del bloque rutean interno y dejan Tavily bloqueado del lado del servidor.`);

  // ── 3) Planes EQUIVALENTES → resultado IDÉNTICO ─────────────────────────────────────────
  {
    const equivalentes: Array<[string, Record<string, unknown>]> = [
      ["atajo habiles", { metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { dias_semana: ["habiles"] }, dimensiones: ["semana"] }],
      ["días ISO", { metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { dias_semana: ["1", "2", "3", "4", "5"] }, dimensiones: ["semana"] }],
      ["nombres de días", { metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { dias_semana: ["lunes", "martes", "miércoles", "jueves", "viernes"] }, dimensiones: ["semana"] }],
      ["sin tildes", { metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { dias_semana: ["lunes", "martes", "miercoles", "jueves", "viernes"] }, dimensiones: ["semana"] }],
      ["entre_semana", { metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { dias_semana: ["entre_semana"] }, dimensiones: ["semana"] }],
      ["forma vieja de 5A", { metrica: "facturacion_bruta", periodo: { mes: MES }, filtros: { dias_semana: [1, 2, 3, 4, 5] }, agrupar_por: "semana" }],
      ["rango explícito", { metricas: ["facturacion_bruta"], periodo: { desde: "2026-08-01", hasta: "2026-08-31" }, filtros: { dias_semana: ["habiles"] }, dimensiones: ["semana"] }],
      ["orden explícito", { metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { dias_semana: ["habiles"] }, dimensiones: ["semana"], orden: "cronologico" }],
    ];
    const resultados: string[] = [];
    for (const [nombre, input] of equivalentes) {
      const v = validarPlan(input);
      assert.equal(v.ok, true, `"${nombre}" debería ser un plan válido`);
      if (!v.ok) return;
      const r = await ejecutarPlanAnalitico(v.plan);
      assert.ok(r.ok, `"${nombre}" debería ejecutar`);
      if (!r.ok) return;
      resultados.push(JSON.stringify({ total: r.resumen.totales[0].valor, dias: r.resumen.diasCalendario, filas: r.filas.map((f) => [f.claves[0], f.valores[0].valor]) }));
    }
    const primero = resultados[0];
    for (let i = 1; i < resultados.length; i++) {
      assert.equal(resultados[i], primero, `"${equivalentes[i][0]}" tiene que dar exactamente lo mismo que "${equivalentes[0][0]}"`);
    }
    assert.ok(primero.includes("7680000"), "y el resultado es el de agosto hábil");
  }
  console.log("OK — 5B (3): ocho formas distintas de escribir el MISMO plan (atajos, días ISO, nombres con y sin tildes, la forma vieja de 5A, rango explícito) dan un resultado idéntico.");

  // ── 4) "¿Cuánto vendió Fede?" — no se inventa una atribución ────────────────────────────
  {
    const { tavily, r, limpiar: fin } = await correr("¿Cuánto vendió Fede en agosto?", [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: { metricas: ["facturacion_bruta"], periodo: { mes: MES }, filtros: { empleado: ["Federico"] } } }] },
      { tipo: "texto", texto: "No puedo atribuirle ventas a una persona; sí puedo darte sus horas programadas." },
    ]);
    try {
      assert.ok(r.ok); if (!r.ok) return;
      const h = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
      const resumen = h!.resumen as { ok?: boolean; motivo?: string };
      assert.equal(resumen.ok, false, "el plan con filtro por empleado se RECHAZA");
      assert.ok(/cronograma/i.test(resumen.motivo ?? ""), "explica que estar en el cronograma no demuestra la venta");
      assert.ok(/consultar_metricas_equipo|consultar_cronograma/.test(resumen.motivo ?? ""), "ofrece qué SÍ se puede responder");
      assert.ok(!r.texto.includes(MARCADOR_TABLA_ANALITICA), "no se publica ninguna tabla de ventas por persona");
      assert.equal(tavily.llamadas.length, 0, "y no se busca afuera para tapar el hueco");
    } finally { await fin(); }
  }
  console.log("OK — 5B (4): preguntar cuánto vendió una persona NO produce atribución: se rechaza, se explica y se ofrece el análisis válido.");

  // ── 5) Pedido ambiguo: una sola aclaración, sin tocar datos ─────────────────────────────
  {
    const { tavily, r, limpiar: fin } = await correr("¿Cuál fue el mejor?", [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: { calculos: ["maximo"] } }] },
      { tipo: "texto", texto: "¿Qué querés comparar: facturación, turnos, personas o minutos de actividad?" },
    ]);
    try {
      assert.ok(r.ok); if (!r.ok) return;
      const h = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
      const resumen = h!.resumen as { ok?: boolean; aclaracion?: boolean; motivo?: string };
      assert.equal(resumen.ok, false);
      assert.equal(resumen.aclaracion, true, "se marca como ACLARACIÓN, no como error reparable");
      assert.ok(resumen.motivo!.includes("¿Qué querés medir?"), "la pregunta es una sola y concreta");
      assert.ok(!r.texto.includes(MARCADOR_TABLA_ANALITICA), "no se publica un resultado aproximado");
      assert.equal(tavily.llamadas.length, 0);
    } finally { await fin(); }
  }
  console.log("OK — 5B (5): un pedido ambiguo no ejecuta datos ni aproxima: pide UNA aclaración concreta.");

  // ── 6) Plan incompatible y métrica inventada: reparables, sin leer datos ────────────────
  {
    const casos: Array<[string, Record<string, unknown>, RegExp]> = [
      ["universos mezclados", { metricas: ["facturacion_bruta", "turnos"], periodo: { mes: MES } }, /no se pueden combinar/i],
      ["agrupación inválida", { metricas: ["turnos"], periodo: { mes: MES }, dimensiones: ["metodo_pago"] }, /no se puede agrupar/i],
      ["métrica inventada", { metricas: ["facturacion_lunar"], periodo: { mes: MES } }, /no disponible/i],
      ["ticket promedio", { metricas: ["ticket_promedio"], periodo: { mes: MES } }, /universos/i],
      ["dos dimensiones temporales", { metricas: ["facturacion_bruta"], periodo: { mes: MES }, dimensiones: ["dia", "semana"] }, /una contiene a la otra/i],
    ];
    for (const [nombre, input, patron] of casos) {
      const { tavily, r, limpiar: fin } = await correr("Dame un análisis de agosto.", [
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input }] },
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: { metricas: ["facturacion_bruta"], periodo: { mes: MES } } }] },
        { tipo: "texto", texto: "Corregido." },
      ]);
      try {
        assert.ok(r.ok, nombre); if (!r.ok) return;
        const hs = (r.herramientas as Herramienta[]).filter((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
        assert.equal(hs.length, 2, `${nombre}: un intento rechazado y uno válido`);
        const primero = hs[0].resumen as { ok?: boolean; motivo?: string; aclaracion?: boolean };
        assert.equal(primero.ok, false, `${nombre}: el primer plan se rechaza`);
        assert.ok(patron.test(primero.motivo ?? ""), `${nombre}: el motivo lo explica (${primero.motivo})`);
        assert.notEqual(primero.aclaracion, true, `${nombre}: es reparable por el modelo, no una pregunta al admin`);
        assert.ok(!/error|exception|sql|undefined/i.test(primero.motivo ?? ""), `${nombre}: el mensaje no es técnico`);
        assert.equal((hs[1].resumen as { ok?: boolean }).ok, true, `${nombre}: el plan corregido se ejecuta`);
        assert.ok(r.texto.includes(MARCADOR_TABLA_ANALITICA), `${nombre}: se publica el resultado del intento válido`);
        assert.equal(tavily.llamadas.length, 0, `${nombre}: nunca se cae a internet`);
      } finally { await fin(); }
    }
  }
  console.log("OK — 5B (6): universos mezclados, agrupación inválida, métrica inventada, ticket promedio y dos dimensiones temporales se rechazan como reparables; el modelo corrige y nunca se busca afuera.");

  // ── 7) La narración se cae: el resultado determinístico se publica igual ────────────────
  {
    for (const [nombre, segundoTurno] of [
      ["error del proveedor", { tipo: "error" as const, mensaje: "El proveedor devolvió un error.", status: 500 }],
      ["salida truncada", { tipo: "texto" as const, texto: "La facturación de agosto fue de", stopReason: "max_tokens" }],
      ["salida vacía", { tipo: "texto" as const, texto: "" }],
    ] as const) {
      const { r, limpiar: fin } = await correr(PREGUNTA_ACEPTACION, [
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_ACEPTACION }] },
        segundoTurno,
      ]);
      try {
        assert.ok(r.ok, `${nombre}: el turno no se pierde`); if (!r.ok) return;
        const h = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
        assert.equal((h?.resumen as { ok?: boolean } | undefined)?.ok, true, `${nombre}: precondición — el motor interno calculó`);
        assert.ok(r.texto.includes(MARCADOR_TABLA_ANALITICA), `${nombre}: la respuesta del servidor se publica igual`);
        assert.ok(r.texto.includes(ESPERADO.habiles.total) && r.texto.includes(ESPERADO.finde.total), `${nombre}: con los números completos`);
      } finally { await fin(); }
    }
  }
  console.log("OK — 5B (7): con error del proveedor, salida truncada o salida vacía, el resultado determinístico se publica completo.");

  // ── 8) Timeout del proveedor ────────────────────────────────────────────────────────────
  {
    const { r, limpiar: fin } = await correr(PREGUNTA_ACEPTACION, [
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_ACEPTACION }] },
      { tipo: "timeout" },
    ]);
    try {
      assert.ok(r.ok, "el turno no se pierde"); if (!r.ok) return;
      assert.notEqual(r.estado, "completa", "el estado dice honestamente que no se completó");
      assert.ok(r.texto.includes(MARCADOR_TABLA_ANALITICA), "y la respuesta calculada se publica igual");
      assert.ok(r.texto.includes(ESPERADO.totalMes));
    } finally { await fin(); }
  }
  console.log("OK — 5B (8): con timeout del proveedor el estado es honesto y el resultado calculado se publica igual.");

  // ── 9) Tavily sigue bloqueado aunque se lo fuerce y el modelo simule búsquedas ──────────
  {
    const { tavily, r, limpiar: fin } = await correr(
      PREGUNTA_ACEPTACION,
      [
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_ACEPTACION }], web: { busquedasFacturables: 3, fuentes: [{ url: "https://ejemplo.com/x", titulo: "X", dominio: "ejemplo.com", orden: 0 }] } },
        { tipo: "texto", texto: "Según lo consultado afuera.", web: { busquedasFacturables: 1, fuentes: [{ url: "https://ejemplo.com/y", titulo: "Y", dominio: "ejemplo.com", orden: 0 }] } },
      ],
      "forzar",
    );
    try {
      assert.ok(r.ok); if (!r.ok) return;
      assert.equal(tavily.llamadas.length, 0, "ni forzando la acción web se llama a Tavily");
      assert.equal(r.busquedasWeb, 0, "las búsquedas que el proveedor dice haber hecho no se computan");
      assert.ok((r.fuentes as Array<Record<string, unknown>>).every((f) => f.tipo === "interna" && !f.url), "no se cuela ninguna fuente externa");
      assert.ok(r.texto.includes(ESPERADO.totalMes), "y la respuesta interna se publica igual");
    } finally { await fin(); }
  }
  console.log("OK — 5B (9): en ruta interna el bloqueo de Tavily es del SERVIDOR: ni forzándolo ni simulando búsquedas entra una fuente externa.");

  // ── 10) Cero consumo de créditos en toda la corrida ────────────────────────────────────
  {
    const { count } = await supabaseAdmin.from("ia_busquedas_web").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 20 * 60_000).toISOString()).gt("creditos_busqueda", 0);
    assert.equal(count ?? 0, 0, "ninguna búsqueda con créditos en los últimos 20 minutos");
  }
  await limpiar();
  console.log("OK — 5B (10): ninguna búsqueda con consumo de créditos registrada durante la corrida.");

  console.log("\nOK — 5B end-to-end: capa semántica flexible, ruteo interno, aclaraciones concretas y publicación determinística aunque la narración falle.");
}

main().catch((e) => { console.error(e); process.exit(1); });

// Bloque 5A — integración end-to-end contra Supabase real (SOLO LECTURA de datos de negocio;
// escritura únicamente en tablas ia_* con fixtures ZZTEST). Proveedor de Claude SIEMPRE falso;
// Tavily SIEMPRE falso y verificado sin usar. Cero llamadas reales, cero créditos.
//
// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/analisis/servidor5a.integration.ts

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { FakeWebSearchProvider } from "@/lib/ia/web/providerWebFake";
import { NOMBRE_CONSULTA_ANALITICA } from "@/lib/ia/analisis/herramientaAnalitica";
import { MARCADOR_TABLA_ANALITICA } from "@/lib/ia/analisis/renderAnalitico";

const OWNER = "admin:zztest-5a";
const PREGUNTA_PRODUCTIVA = "Me podrías decir la facturación del mes de agosto de 2026, entre los días lunes a viernes de cada semana?";
const PLAN_AGOSTO = { metrica: "facturacion_bruta", periodo: { mes: "2026-08" }, filtros: { dias_semana: [1, 2, 3, 4, 5] }, agrupar_por: "semana" };
const SEMANAS = ["$1.248.000", "$954.000", "$1.354.000", "$1.042.000", "$132.000"];
const TOTAL = "$4.730.000";

type Herramienta = { nombre: string; ok: boolean; resumen?: Record<string, unknown> };

async function limpiar(id?: string) {
  if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}
async function nuevaConv(): Promise<string> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 5a", estado: "activa" }).select("id").single();
  return data!.id as string;
}
async function auditoria(conversacionId: string) {
  const { data } = await supabaseAdmin.from("ia_ejecuciones").select("busqueda_previa, busquedas_web, clase_modelo").eq("conversacion_id", conversacionId).order("created_at", { ascending: false }).limit(1);
  return (data ?? [])[0] as { busqueda_previa: Record<string, unknown>; busquedas_web: number; clase_modelo: string } | undefined;
}
// Tavily falso con resultados cargados: si alguna vez se lo llamara, el test lo detecta.
const tavilyNuevo = () => new FakeWebSearchProvider([{ tipo: "ok", resultados: [{ titulo: "Nota externa", url: "https://ejemplo.com/nota", dominio: "ejemplo.com", fechaPublicada: "2026-08-20", fragmento: "No debería usarse.", posicion: 0 }] }]);

async function main() {
  await limpiar();

  // ── 1) LA consulta productiva, de punta a punta ──────────────────────────────────────────
  const conv1 = await nuevaConv();
  try {
    const p = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_AGOSTO }] },
      { tipo: "texto", texto: "Agosto se concentró en las semanas completas; el 31 quedó como una jornada suelta." },
    ]);
    const tavily = tavilyNuevo();
    const r = await correrChat({ owner: OWNER, conversacionId: conv1, pregunta: PREGUNTA_PRODUCTIVA }, { provider: p, webProvider: tavily });
    assert.ok(r.ok, "la consulta se resuelve"); if (!r.ok) return;

    // Ruteo auditable
    const aud = await auditoria(conv1);
    assert.equal(aud?.busqueda_previa.ruta, "interna", "la consulta se clasifica como INTERNA");
    assert.equal(aud?.busqueda_previa.web_permitida, false, "la ruta interna no permite web");
    assert.ok(String(aud?.busqueda_previa.ruta_motivo ?? "").length > 0, "queda un código de decisión auditable");
    assert.ok(Array.isArray(aud?.busqueda_previa.ruta_senales) && (aud!.busqueda_previa.ruta_senales as string[]).includes("interno:facturacion"));

    // Tavily técnicamente bloqueado
    assert.equal(tavily.llamadas.length, 0, "Tavily NUNCA se llamó");
    assert.equal(r.busquedasWeb, 0, "cero búsquedas facturables");
    assert.ok(!p.ultimoWebSearch?.habilitado, "tampoco se le ofreció el web_search del proveedor al modelo");
    assert.equal(aud?.busquedas_web, 0);
    const { count: nBusquedas } = await supabaseAdmin.from("ia_busquedas_web").select("*", { count: "exact", head: true }).eq("conversacion_id", conv1);
    assert.equal(nBusquedas ?? 0, 0, "no se registró ninguna búsqueda web");

    // Modelo económico y herramienta ofrecida
    assert.equal(r.claseModelo, "economico", "una consulta interna directa usa el modelo económico");
    assert.ok(p.ultimoHerramientasOfrecidas?.includes(NOMBRE_CONSULTA_ANALITICA), "la herramienta analítica se ofrece siempre en el núcleo interno");

    // El plan se ejecutó y devolvió el resultado correcto
    const h = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
    assert.ok(h?.ok, "la consulta analítica se ejecutó");
    const res = h!.resumen as { ok: boolean; ventana: { desde: string; hasta: string }; filas: unknown[]; total: number; totalDias: number; agruparPor: string };
    assert.equal(res.ok, true);
    assert.deepEqual(res.ventana, { desde: "2026-08-01", hasta: "2026-08-31" }, "agosto COMPLETO");
    assert.equal(res.agruparPor, "semana");
    assert.equal(res.filas.length, 5, "cinco semanas, incluida la del lunes 31");
    assert.equal(res.total, 4_730_000);
    assert.equal(res.totalDias, 21, "solo los 21 días hábiles");

    // Respuesta publicada
    assert.ok(r.texto.includes(MARCADOR_TABLA_ANALITICA), "la tabla la publica el servidor");
    for (const v of SEMANAS) assert.ok(r.texto.includes(v), `la respuesta muestra ${v}`);
    assert.ok(r.texto.includes(TOTAL), "la respuesta muestra el total del período");
    assert.ok(r.texto.includes("31 de agosto"), "la semana parcial del 31 aparece en la tabla");
    assert.ok(!/no cumpli[óo] el formato esperado/i.test(r.texto), "NO aparece el error de formato que rompió la consulta en producción");
    assert.equal(r.estado, "completa");

    // Fuentes: exclusivamente internas
    const fuentes = r.fuentes as Array<Record<string, unknown>>;
    assert.ok(fuentes.length > 0, "se declara al menos una fuente");
    for (const f of fuentes) {
      assert.equal(f.tipo, "interna", `la fuente ${JSON.stringify(f.modulo)} es interna`);
      assert.ok(!f.url, "ninguna fuente tiene URL externa");
    }
  } finally { await limpiar(conv1); }
  console.log("OK — 5A (1): la consulta productiva se resuelve entera por dentro: ruta interna auditada, Tavily bloqueado, modelo económico, agosto completo de lunes a viernes por semana, tabla con total y fuentes internas.");

  // ── 2) Variantes lingüísticas: la misma pregunta dicha de otra forma ─────────────────────
  for (const [i, pregunta] of [
    "Separame los ingresos de agosto de 2026 por semana, solo de lunes a viernes.",
    "¿Cuánto facturamos cada semana hábil de agosto de 2026?",
    "Mostrame la facturación semanal de agosto de 2026 excluyendo sábados y domingos.",
  ].entries()) {
    const conv = await nuevaConv();
    try {
      const p = new FakeProviderGuionado([
        { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_AGOSTO }] },
        { tipo: "texto", texto: "Ahí va el detalle por semana." },
      ]);
      const tavily = tavilyNuevo();
      const r = await correrChat({ owner: OWNER, conversacionId: conv, pregunta }, { provider: p, webProvider: tavily });
      assert.ok(r.ok, `variante ${i + 1} resuelta`); if (!r.ok) return;
      assert.equal(tavily.llamadas.length, 0, `variante ${i + 1}: sin Tavily`);
      assert.equal(r.busquedasWeb, 0);
      assert.equal((await auditoria(conv))?.busqueda_previa.ruta, "interna", `variante ${i + 1}: ruta interna`);
      assert.ok(r.texto.includes(TOTAL), `variante ${i + 1}: publica el total`);
    } finally { await limpiar(conv); }
  }
  console.log("OK — 5A (2): tres variantes lingüísticas de la misma pregunta llegan al mismo resultado, sin web.");

  // ── 3) El modelo INTENTA buscar en internet en una consulta interna ──────────────────────
  const conv3 = await nuevaConv();
  try {
    const p = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_AGOSTO }], web: { busquedasFacturables: 2, fuentes: [{ url: "https://ejemplo.com/x", titulo: "X", dominio: "ejemplo.com", orden: 0 }] } },
      { tipo: "texto", texto: "Según lo consultado.", web: { busquedasFacturables: 1, fuentes: [{ url: "https://ejemplo.com/y", titulo: "Y", dominio: "ejemplo.com", orden: 0 }] } },
    ]);
    const tavily = tavilyNuevo();
    // Incluso pidiendo explícitamente "forzar" la búsqueda, la ruta interna manda.
    const r = await correrChat({ owner: OWNER, conversacionId: conv3, pregunta: PREGUNTA_PRODUCTIVA, webAccion: "forzar" }, { provider: p, webProvider: tavily });
    assert.ok(r.ok); if (!r.ok) return;
    assert.equal(tavily.llamadas.length, 0, "Tavily sigue bloqueado aunque se fuerce la acción web");
    assert.equal(r.busquedasWeb, 0, "las búsquedas que el proveedor dice haber hecho no se computan: nunca se habilitaron");
    const fuentes = r.fuentes as Array<Record<string, unknown>>;
    assert.ok(fuentes.every((f) => f.tipo === "interna" && !f.url), "no se cuela ninguna fuente externa");
    assert.ok(r.texto.includes(TOTAL), "la respuesta interna se publica igual");
  } finally { await limpiar(conv3); }
  console.log("OK — 5A (3): en ruta interna el bloqueo de Tavily es del SERVIDOR: ni forzándolo ni simulando búsquedas entra una fuente externa.");

  // ── 4) Plan inválido → error estructurado reparable → reintento correcto ─────────────────
  const conv4 = await nuevaConv();
  try {
    const p = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: { metrica: "ganancia", periodo: { mes: "2026-08" }, tabla: "usuarios", sql: "select * from pagos" } }] },
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_AGOSTO }] },
      { tipo: "texto", texto: "Corregido: acá va la facturación por semana." },
    ]);
    const tavily = tavilyNuevo();
    const r = await correrChat({ owner: OWNER, conversacionId: conv4, pregunta: PREGUNTA_PRODUCTIVA }, { provider: p, webProvider: tavily });
    assert.ok(r.ok); if (!r.ok) return;
    const hs = (r.herramientas as Herramienta[]).filter((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
    assert.equal(hs.length, 2, "hubo un intento rechazado y uno válido");
    assert.equal((hs[0].resumen as { ok?: boolean }).ok, false, "el primer plan se rechaza");
    assert.ok(String((hs[0].resumen as { motivo?: string }).motivo ?? "").includes("consultar_finanzas"), "el rechazo dice a qué herramienta ir");
    assert.equal((hs[1].resumen as { ok?: boolean }).ok, true, "el plan corregido se ejecuta");
    assert.ok(r.texto.includes(TOTAL), "se publica la tabla del intento válido");
    assert.equal(tavily.llamadas.length, 0, "un plan inválido NO se compensa con una búsqueda web");
  } finally { await limpiar(conv4); }
  console.log("OK — 5A (4): un plan inválido devuelve un error reparable, el modelo corrige y nunca se cae a internet para tapar el fallo.");

  // ── 5) La narración del modelo falla, pero el resultado interno ya estaba validado ────────
  const conv5 = await nuevaConv();
  try {
    const p = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_AGOSTO }] },
      { tipo: "error", mensaje: "El proveedor devolvió un error.", status: 500 },
    ]);
    const r = await correrChat({ owner: OWNER, conversacionId: conv5, pregunta: PREGUNTA_PRODUCTIVA }, { provider: p, webProvider: tavilyNuevo() });
    assert.ok(r.ok, "el turno no se pierde"); if (!r.ok) return;
    assert.notEqual(r.estado, "completa", "el estado refleja honestamente que la narración falló");
    // Precondición explícita: lo que se prueba es la PUBLICACIÓN, no la lectura. Si la lectura
    // interna falló (un hipo de la base), que el diagnóstico lo diga en vez de culpar a la tabla.
    const calculo = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
    assert.equal((calculo?.resumen as { ok?: boolean } | undefined)?.ok, true, "precondición: el motor interno alcanzó a calcular el resultado");
    assert.ok(r.texto.includes(MARCADOR_TABLA_ANALITICA), "la tabla calculada por el servidor se publica igual");
    assert.ok(r.texto.includes(TOTAL) && SEMANAS.every((v) => r.texto.includes(v)), "con todos los números, no un resumen degradado");
  } finally { await limpiar(conv5); }
  console.log("OK — 5A (5): si la narración se cae después de calcular, el resultado interno validado se publica igual.");

  // ── 6) El modelo no narra la tabla: el servidor no duplica ni omite ──────────────────────
  const conv6 = await nuevaConv();
  try {
    const p = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: PLAN_AGOSTO }] },
      { tipo: "texto", texto: "" },
    ]);
    const r = await correrChat({ owner: OWNER, conversacionId: conv6, pregunta: PREGUNTA_PRODUCTIVA }, { provider: p, webProvider: tavilyNuevo() });
    assert.ok(r.ok); if (!r.ok) return;
    assert.equal(r.texto.split(MARCADOR_TABLA_ANALITICA).length - 1, 1, "la tabla aparece exactamente UNA vez");
    assert.ok(r.texto.trim().startsWith(MARCADOR_TABLA_ANALITICA), "sin narración, la respuesta ES la tabla");
  } finally { await limpiar(conv6); }
  console.log("OK — 5A (6): la tabla se publica exactamente una vez, narre o no narre el modelo.");

  // ── 7) Una consulta interna distinta (otra métrica y agrupación) ─────────────────────────
  const conv7 = await nuevaConv();
  try {
    const p = new FakeProviderGuionado([
      { tipo: "herramientas", llamadas: [{ nombre: NOMBRE_CONSULTA_ANALITICA, input: { metrica: "turnos", periodo: { mes: "2026-08" }, agrupar_por: "dia_semana" } }] },
      { tipo: "texto", texto: "Los turnos se reparten así por día de la semana." },
    ]);
    const tavily = tavilyNuevo();
    const r = await correrChat({ owner: OWNER, conversacionId: conv7, pregunta: "¿Cómo se reparten los turnos de agosto de 2026 por día de la semana?" }, { provider: p, webProvider: tavily });
    assert.ok(r.ok); if (!r.ok) return;
    assert.equal(tavily.llamadas.length, 0);
    assert.equal((await auditoria(conv7))?.busqueda_previa.ruta, "interna");
    const h = (r.herramientas as Herramienta[]).find((x) => x.nombre === NOMBRE_CONSULTA_ANALITICA);
    assert.equal((h!.resumen as { ok?: boolean }).ok, true, "la misma herramienta resuelve otra métrica y otra agrupación");
    assert.ok(r.texto.includes("Día de la semana"), "la tabla se adapta a la agrupación pedida");
  } finally { await limpiar(conv7); }
  console.log("OK — 5A (7): la misma arquitectura responde otra métrica con otra agrupación, sin herramienta nueva ni parche por frase.");

  // ── 8) Auditoría final: cero búsquedas web y cero consumo de Tavily en todo el archivo ────
  {
    const { count } = await supabaseAdmin.from("ia_busquedas_web").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString()).eq("proveedor", "tavily").gt("creditos_busqueda", 0);
    assert.equal(count ?? 0, 0, "ninguna búsqueda con créditos en los últimos 10 minutos");
  }
  await limpiar();
  console.log("OK — 5A (8): ninguna búsqueda con consumo de créditos registrada durante la corrida.");

  console.log("\nOK — 5A end-to-end: enrutamiento internal-first, motor analítico interno y publicación determinística del resultado.");
}

main().catch((e) => { console.error(e); process.exit(1); });

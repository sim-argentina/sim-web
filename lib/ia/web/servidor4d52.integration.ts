// Corrección 4D.5.2 — reproduce EXACTAMENTE la consulta real (referencia 192ef058) con
// proveedores FALSOS realistas: caché Tavily reutilizada, contexto interno estructurado con
// fuentes que SÍ se persisten (corrige "0 fuentes internas"), UNA sola llamada a Claude forzada
// por tool_choice, salida estructurada validada, Markdown renderizado localmente. No llama a
// Claude ni a Tavily reales.
//
// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/web/servidor4d52.integration.ts

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { FakeWebSearchProvider } from "@/lib/ia/web/providerWebFake";
import { claveCacheWeb } from "@/lib/ia/web/cache";
import { sanitizarConsultaWeb } from "@/lib/ia/web/sanitizar";
import { LIMITES_TAVILY } from "@/lib/ia/web/config";
import { NOMBRE_EMITIR_ANALISIS_WEB } from "@/lib/ia/web/analisisWebSchema";

const OWNER = "admin:zztest-4d52";

const RESULT5 = [
  { titulo: "Aracing inaugura su sede en Córdoba con 12 simuladores", url: "https://infonegocios.info/aracing", dominio: "infonegocios.info", fechaPublicada: "2026-08-20", fragmento: "Nueva sede de simuladores de conducción profesional en Córdoba.", posicion: 0 },
  { titulo: "ARacing ya aceleró en Infinito Open Córdoba", url: "https://expresionnorte.com.ar/aracing-infinito-open", dominio: "expresionnorte.com.ar", fechaPublicada: "2026-08-22", fragmento: "Torneos y podio para los visitantes.", posicion: 1 },
  { titulo: "Experiencia Elite Tour 2026 Córdoba", url: "https://experienciaelite.com/cordoba", dominio: "experienciaelite.com", fechaPublicada: "2026-09-01", fragmento: "Show automotor en vivo, entrada desde $25.000.", posicion: 2 },
  { titulo: "Simuladores de automovilismo en Córdoba - SIM Argentina", url: "https://simexperience.com.ar/sobre-nosotros", dominio: "simexperience.com.ar", fechaPublicada: null, fragmento: "Experiencia de simulación de Fórmula 1 creada en Córdoba.", posicion: 3 },
  { titulo: "A Racing Simuladores en Instagram", url: "https://www.instagram.com/p/aracing", dominio: "instagram.com", fechaPublicada: "2026-08-18", fragmento: "Se viene A Racing Simuladores a Córdoba.", posicion: 4 },
];
const PREGUNTA_REAL = "Buscá en internet qué experiencias de simulación de automovilismo existen actualmente en Córdoba y citá las fuentes. Después explicame, separando los datos internos y externos, qué diferencias principales encontrás con SIM.";

// Respuesta ESTRUCTURADA realista (equivalente a la que el modelo real generó, pero acotada).
function llamadaValida(idsInternos: string[]) {
  return {
    nombre: NOMBRE_EMITIR_ANALISIS_WEB,
    input: {
      respuesta_directa: "En Córdoba hay un competidor potencial (Aracing) y un evento no competitivo (Elite Tour); no hay datos externos de precios ni facturación para comparar cuantitativamente.",
      datos_internos_ids: idsInternos,
      actores_externos: [
        { nombre: "Aracing", evidencia: "Nueva sede en Córdoba con 12 simuladores, participó en Infinito Open.", fuente_ids: ["ext-1", "ext-2"], actividad_comparable: true, ubicacion_cordoba: true, vigencia_reciente: true, es_fabricante: false, es_red_nacional: false, es_evento: false },
        { nombre: "Experiencia Elite Tour", evidencia: "Show automotor en vivo, evento puntual de septiembre 2026.", fuente_ids: ["ext-3"], actividad_comparable: false, ubicacion_cordoba: true, vigencia_reciente: true, es_fabricante: false, es_red_nacional: false, es_evento: true },
      ],
      comparacion: [
        { aspecto: "Ubicación", sim: "Córdoba, sede propia", mercado: "Aracing: Córdoba", fuente_ids: ["ext-1"] },
        { aspecto: "Precio por sesión", sim: "No disponible en este snapshot", mercado: "No disponible en las fuentes consultadas", fuente_ids: [] },
      ],
      no_determinable: ["Precio público de Aracing", "Cantidad de simuladores de SIM en este snapshot"],
      conclusion: "No hay competidor directo confirmado con datos suficientes: Aracing es un competidor potencial y Elite Tour es un evento, no un operador permanente.",
    },
  };
}

async function limpiarCacheZZ(pregunta: string) {
  const clave = claveCacheWeb({ consulta: sanitizarConsultaWeb(pregunta, 300), proveedor: "tavily", localizacion: "Cordoba,AR", maxResultados: LIMITES_TAVILY.maxResultados });
  await supabaseAdmin.from("ia_web_cache").delete().eq("clave_hash", clave);
}
async function limpiar(id?: string) {
  if (id) await supabaseAdmin.from("ia_conversaciones").delete().eq("id", id);
  await supabaseAdmin.from("ia_conversaciones").delete().eq("owner", OWNER);
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}
async function nuevaConv(): Promise<string> {
  const { data } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, titulo: "ZZTEST 4d5.2", estado: "activa" }).select("id").single();
  return data!.id as string;
}

async function main() {
  await limpiar();
  await limpiarCacheZZ(PREGUNTA_REAL);

  // ── 1) Caso REAL reproducido: primera búsqueda (sin caché) → 1 búsqueda + 1 crédito ────────
  const conv1 = await nuevaConv();
  try {
    const web1 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const p1 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [llamadaValida(["int-1", "int-2", "int-3"])] }]);
    const r1 = await correrChat({ owner: OWNER, conversacionId: conv1, pregunta: PREGUNTA_REAL, idempotencyKey: "zz-452-1" }, { provider: p1, webProvider: web1 });
    assert.ok(r1.ok, "ok"); if (!r1.ok) return;

    assert.equal(web1.llamadas.length, 1, "sin caché previa: 1 búsqueda Tavily");
    assert.equal(p1.llamadasGenerar, 1, "UNA sola llamada a Claude (sin exploración, sin segunda síntesis)");
    assert.deepEqual(p1.ultimoToolChoice, { nombre: NOMBRE_EMITIR_ANALISIS_WEB }, "tool_choice forzado a emitir_analisis_web");
    assert.equal(p1.ultimoHerramientasOfrecidas?.length, 1, "SOLO se ofrece emitir_analisis_web (sin herramientas internas, sin web nativa)");
    assert.ok((p1.ultimoMaxTokensSalida ?? 0) <= 2600, "presupuesto de salida acotado por el esquema, no un tope arbitrario");

    // No hay fallback, no hay mención a "ampliar" como rescate.
    assert.ok(!/No pude (terminar|completar)/.test(r1.texto), "sin fallback: la respuesta se publicó completa");
    assert.ok(!/[Aa]mpliar investigaci/i.test(r1.texto), "no sugiere 'Ampliar investigación' como rescate de una consulta estándar");
    assert.ok(r1.texto.includes("## Comparación"), "tabla comparativa presente");
    assert.ok(r1.texto.includes("| Ubicación |"), "fila de la tabla cerrada correctamente");
    assert.ok(r1.texto.includes("## Conclusión"), "conclusión presente");
    assert.ok(/\[Aracing inaugura su sede en Córdoba con 12 simuladores\]\(https:\/\/infonegocios\.info\/aracing\)/.test(r1.texto), "enlaces externos correctos (título + URL real)");
    assert.ok(r1.texto.includes("## Datos internos de SIM"), "sección de datos internos presente");
    assert.ok(r1.texto.includes("## No se puede determinar con lo disponible"), "declara lo no determinable en vez de inventarlo");

    // Fuentes: ya NO hay "0 internas" — lo citado se persiste como fuente real.
    const { data: msg1 } = await supabaseAdmin.from("ia_mensajes").select("fuentes").eq("id", r1.mensajeId).single();
    const fuentes1 = (msg1!.fuentes as Array<{ tipo?: string; url?: string; modulo?: string }>) ?? [];
    const internas1 = fuentes1.filter((f) => f.tipo === "interna");
    const externas1 = fuentes1.filter((f) => f.tipo === "externa");
    assert.ok(internas1.length >= 1, "AL MENOS una fuente interna persistida (corrige el bug de 0 internas)");
    assert.ok(externas1.length >= 1 && externas1.length <= 5, "máximo 5 fuentes externas");
    assert.ok(externas1.every((f) => typeof f.url === "string" && /^https:\/\//.test(f.url!)), "URLs externas http(s)");

    // Ejecución: UNA ronda, modelo potente, motivo_router del flujo estructurado.
    const { data: eje1 } = await supabaseAdmin.from("ia_ejecuciones").select("rondas, clase_modelo, motivo_router, tokens_in, tokens_out, costo_estimado, escalado").eq("conversacion_id", conv1).order("created_at", { ascending: false }).limit(1).single();
    assert.equal(eje1!.rondas, 1, "1 ronda (una sola síntesis, cero rondas exploratorias)");
    assert.equal(eje1!.clase_modelo, "potente", "modelo potente para análisis competitivo");
    assert.equal(eje1!.motivo_router, "analisis_web_estructurado", "ejecutada por el flujo estructurado");
    assert.equal(eje1!.escalado, false, "sin escalado (no hubo rondas de herramientas)");
    assert.ok(Number(eje1!.tokens_in) <= 25000, "≤25.000 tokens estimados/reales de entrada");
    assert.ok(Number(eje1!.costo_estimado) <= 0.15, "≤US$0,15 de Claude");

    // Búsqueda Tavily auditada: 1 crédito, integridad válida.
    const { data: bw1 } = await supabaseAdmin.from("ia_busquedas_web").select("cache_hit, creditos_busqueda, fuentes_recibidas, integridad_ok").eq("conversacion_id", conv1).single();
    assert.equal(bw1!.cache_hit, false, "primera vez: no es cache hit");
    assert.equal(Number(bw1!.creditos_busqueda), 1, "1 crédito Tavily");
    assert.equal(Number(bw1!.fuentes_recibidas), 5, "5 fuentes recibidas (tope Tavily)");
    assert.equal(bw1!.integridad_ok, true, "integridad válida (salida estructurada aceptada)");

    console.log("OK — 4D.5.2 (parte 1, sin caché): 1 búsqueda + 1 crédito Tavily; UNA sola llamada a Claude (tool_choice forzado, sin herramientas internas); respuesta completa (sin fallback, sin 'Ampliar investigación'); tabla/enlaces/conclusión/no-determinable correctos; fuentes internas y externas persistidas (ya no '0 internas'); ≤25k tokens, ≤US$0,15.");
  } finally { await limpiar(conv1); }

  // ── 2) Misma consulta de nuevo: CACHE HIT, 0 créditos Tavily nuevos ─────────────────────────
  const conv2 = await nuevaConv();
  try {
    const web2 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const p2 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [llamadaValida(["int-1", "int-2"])] }]);
    const r2 = await correrChat({ owner: OWNER, conversacionId: conv2, pregunta: PREGUNTA_REAL, idempotencyKey: "zz-452-2" }, { provider: p2, webProvider: web2 });
    assert.ok(r2.ok, "ok"); if (!r2.ok) return;
    assert.equal(web2.llamadas.length, 0, "caché reutilizada: 0 llamadas nuevas a Tavily");
    assert.equal(r2.webCreditos, 0, "0 créditos Tavily nuevos");
    assert.equal(p2.llamadasGenerar, 1, "sigue siendo UNA sola llamada a Claude");
    console.log("OK — 4D.5.2 (parte 2): repetir la MISMA consulta reutiliza la caché de Tavily (0 búsquedas, 0 créditos nuevos); sigue habiendo una sola síntesis.");
  } finally { await limpiar(conv2); }

  // ── 3) IDs de fuente INVENTADOS → rechazo, sin publicar nada parcial ────────────────────────
  const conv3 = await nuevaConv();
  try {
    const web3 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const llamadaMala = llamadaValida(["int-1"]);
    (llamadaMala.input.actores_externos[0] as { fuente_ids: string[] }).fuente_ids = ["ext-99-inventado"];
    const p3 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [llamadaMala] }]);
    const r3 = await correrChat({ owner: OWNER, conversacionId: conv3, pregunta: "Buscá competidores de simuladores en Córdoba y compará con SIM", idempotencyKey: "zz-452-3" }, { provider: p3, webProvider: web3 });
    assert.ok(r3.ok, "responde ok (no 500)"); if (!r3.ok) return;
    assert.ok(!/Aracing/.test(r3.texto), "NUNCA publica el contenido del intento inválido");
    assert.ok(/no cumpli[óo] el formato|no pude generar/i.test(r3.texto), "mensaje honesto de salida inválida");
    const { data: msgMala } = await supabaseAdmin.from("ia_mensajes").select("error").eq("id", r3.mensajeId).single();
    assert.ok((msgMala!.error as string ?? "").includes("ext-99-inventado"), "el motivo del rechazo (id inventado) queda en auditoría");
    console.log("OK — 4D.5.2 (parte 3): un id de fuente inventado rechaza TODA la respuesta (nunca se publica parcial); motivo auditado.");
  } finally { await limpiar(conv3); await limpiarCacheZZ("Buscá competidores de simuladores en Córdoba y compará con SIM"); }

  // ── 4) Salida cortada por stop_reason=max_tokens → NUNCA visible ───────────────────────────
  const conv4 = await nuevaConv();
  try {
    const web4 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const p4 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [llamadaValida(["int-1"])], stopReason: "max_tokens" }]);
    const r4 = await correrChat({ owner: OWNER, conversacionId: conv4, pregunta: "Buscá competidores de simuladores en Córdoba y compará con SIM (caso truncado)", idempotencyKey: "zz-452-4" }, { provider: p4, webProvider: web4 });
    assert.ok(r4.ok, "ok"); if (!r4.ok) return;
    assert.ok(!/Aracing/.test(r4.texto), "el análisis cortado NUNCA se publica, ni parcialmente");
    assert.ok(/no pude terminar el an[aá]lisis/i.test(r4.texto), "mensaje honesto de límite alcanzado");
    const { data: fuentesMsg4 } = await supabaseAdmin.from("ia_mensajes").select("fuentes").eq("id", r4.mensajeId).single();
    const ext4 = ((fuentesMsg4!.fuentes as Array<{ tipo?: string }>) ?? []).filter((f) => f.tipo === "externa");
    assert.ok(ext4.length > 0, "las fuentes ya encontradas (crédito ya pagado) se conservan igual");
    console.log("OK — 4D.5.2 (parte 4): stop_reason=max_tokens nunca publica el análisis (ni parcial); fuentes ya encontradas se conservan.");
  } finally { await limpiar(conv4); await limpiarCacheZZ("Buscá competidores de simuladores en Córdoba y compará con SIM (caso truncado)"); }

  // ── 5) Consulta interna normal: sin Tavily y sin el flujo estructurado ──────────────────────
  const conv5 = await nuevaConv();
  try {
    const web5 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const p5 = new FakeProviderGuionado([{ tipo: "texto", texto: "Federico hizo 385 turnos este mes." }]);
    const r5 = await correrChat({ owner: OWNER, conversacionId: conv5, pregunta: "¿Cuántos turnos hizo Federico este mes?" }, { provider: p5, webProvider: web5 });
    assert.ok(r5.ok, "ok"); if (!r5.ok) return;
    assert.equal(web5.llamadas.length, 0, "consulta interna: cero búsquedas Tavily");
    const { data: eje5 } = await supabaseAdmin.from("ia_ejecuciones").select("motivo_router").eq("conversacion_id", conv5).single();
    assert.notEqual(eje5!.motivo_router, "analisis_web_estructurado", "consulta interna NO pasa por el flujo estructurado");
    console.log("OK — 4D.5.2 (parte 5): consulta interna normal no dispara Tavily ni el flujo estructurado (sigue con el chat libre de siempre).");
  } finally { await limpiar(conv5); }

  // ── 6) PII: la búsqueda web queda bloqueada (no se llega ni a Tavily) ───────────────────────
  const conv6 = await nuevaConv();
  try {
    const web6 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const p6 = new FakeProviderGuionado([{ tipo: "texto", texto: "No puedo usar ese dato en una búsqueda." }]);
    const r6 = await correrChat({ owner: OWNER, conversacionId: conv6, pregunta: "Buscá en internet el teléfono +54 351 1234567 del cliente" }, { provider: p6, webProvider: web6 });
    assert.ok(r6.ok, "ok");
    assert.equal(web6.llamadas.length, 0, "PII → cero búsquedas Tavily");
    console.log("OK — 4D.5.2 (parte 6): PII en la consulta bloquea la búsqueda web.");
  } finally { await limpiar(conv6); }

  // ── 7) Error de Tavily (401/429/timeout equivalente): sin reintento, sin flujo estructurado ─
  const conv7 = await nuevaConv();
  try {
    const web7 = new FakeWebSearchProvider([{ tipo: "error", mensaje: "El proveedor de búsqueda respondió con estado 429.", status: 429 }]);
    const p7 = new FakeProviderGuionado([{ tipo: "texto", texto: "Respondo con los datos internos disponibles." }]);
    const r7 = await correrChat({ owner: OWNER, conversacionId: conv7, pregunta: "Buscá competidores de simuladores en Córdoba y compará con SIM (caso error tavily)" }, { provider: p7, webProvider: web7 });
    assert.ok(r7.ok, "ok"); if (!r7.ok) return;
    assert.equal(web7.llamadas.length, 1, "una sola llamada a Tavily (sin reintento automático)");
    const { data: eje7 } = await supabaseAdmin.from("ia_ejecuciones").select("motivo_router").eq("conversacion_id", conv7).single();
    assert.notEqual(eje7!.motivo_router, "analisis_web_estructurado", "sin resultados externos, no entra al flujo estructurado (sigue con lo interno)");
    console.log("OK — 4D.5.2 (parte 7): error de Tavily sin reintento; sin resultados, la consulta sigue con el chat interno (no entra al flujo estructurado).");
  } finally { await limpiar(conv7); await limpiarCacheZZ("Buscá competidores de simuladores en Córdoba y compará con SIM (caso error tavily)"); }

  // ── 8) Consumo y saldo: una sola actualización por consulta ─────────────────────────────────
  const conv8 = await nuevaConv();
  try {
    const web8 = new FakeWebSearchProvider([{ tipo: "ok", resultados: RESULT5 }]);
    const p8 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [llamadaValida(["int-1"])] }]);
    const r8 = await correrChat({ owner: OWNER, conversacionId: conv8, pregunta: "Buscá competidores de simuladores en Córdoba y compará con SIM (caso consumo)" }, { provider: p8, webProvider: web8 });
    assert.ok(r8.ok, "ok"); if (!r8.ok) return;
    const { count: nEje8 } = await supabaseAdmin.from("ia_ejecuciones").select("id", { count: "exact", head: true }).eq("conversacion_id", conv8);
    assert.equal(nEje8 ?? 0, 1, "una sola ejecución auditada (consumo/saldo actualizados una sola vez)");
    console.log("OK — 4D.5.2 (parte 8): consumo y saldo se actualizan una sola vez por consulta (una sola ejecución auditada).");
  } finally { await limpiar(conv8); await limpiarCacheZZ("Buscá competidores de simuladores en Córdoba y compará con SIM (caso consumo)"); }

  await limpiarCacheZZ(PREGUNTA_REAL);
  const { count } = await supabaseAdmin.from("ia_conversaciones").select("id", { count: "exact", head: true }).eq("owner", OWNER);
  console.log("Limpieza ZZTEST verificada:", (count ?? 0) === 0);
}
main().catch(async (e) => { console.error(e); await limpiar(); await limpiarCacheZZ(PREGUNTA_REAL); process.exit(1); });

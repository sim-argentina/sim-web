import { strict as assert } from "node:assert";
import { getPresupuestoWeb, ROUTE_MAX_SEG } from "@/lib/ia/config";
import { ejecutarChat } from "@/lib/ia/orchestrator";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { getModelos } from "@/lib/ia/config";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/web/timeout4d41.test.ts — sin esperas reales.

const modelos = getModelos();
// Config de prueba: tope general 60s (equivalente), presupuesto web 250s (equivalente). No hay
// sleeps: los fakes de éxito devuelven al instante; se verifica el PRESUPUESTO pasado al proveedor.
const limites = { mensajesPorMinuto: 6, solicitudesDia: 100, tokensEntradaMax: 60000, tokensSalidaMax: 2000, rondasHerramientasMax: 6, herramientasPorRespuestaMax: 8, tiempoEjecucionMsMax: 60000, webTimeoutMs: 250000, tokensMesMax: 5_000_000 };
const webOn = { habilitar: true, explicita: true, motivo: "tema_externo", maxUsos: 3, version: "web_search_20260318" };

function configTests() {
  // Ruta a 300s (Hobby + Fluid Compute), no 60.
  assert.equal(ROUTE_MAX_SEG, 300, "ROUTE_MAX_SEG = 300 (no 60)");
  // Default seguro sin env (250s, válido, deja margen bajo 300).
  delete process.env.IA_WEB_TIMEOUT_MS;
  const d = getPresupuestoWeb();
  assert.equal(d.valido, true, "default válido");
  assert.equal(d.timeoutMs, 250000, "default 250s");
  assert.ok(d.timeoutMs < d.maxDurationSeg * 1000, "presupuesto web < maxDuration");
  assert.ok(d.timeoutMs + d.margenMs <= d.maxDurationSeg * 1000, "queda margen para persistir/responder");
  // Env válida prevalece.
  process.env.IA_WEB_TIMEOUT_MS = "180000";
  assert.equal(getPresupuestoWeb().timeoutMs, 180000, "env válida prevalece (180s)");
  // Env inválida: >= límite de la Function → inválida y clamp al máximo seguro (no 60, no crash).
  process.env.IA_WEB_TIMEOUT_MS = "400000";
  const inv = getPresupuestoWeb();
  assert.equal(inv.valido, false, "timeout >= límite Function → inválido");
  assert.ok(inv.timeoutMs < ROUTE_MAX_SEG * 1000 && inv.timeoutMs >= 1000, "clamp al máximo seguro");
  assert.ok(/l[ií]mite de la Function/i.test(inv.motivo ?? ""), "motivo claro de config inválida");
  // No numérico → default, marcado inválido.
  process.env.IA_WEB_TIMEOUT_MS = "abc";
  assert.equal(getPresupuestoWeb().valido, false, "no numérico → inválido");
  delete process.env.IA_WEB_TIMEOUT_MS;
}

async function orquestadorTests() {
  // Web: el proveedor recibe el PRESUPUESTO WEB (>> 60s), NO el tope de 60s.
  const p1 = new FakeProviderGuionado([{ tipo: "texto", texto: "En Córdoba hay opciones.", web: { busquedasFacturables: 1, fuentes: [{ url: "https://a.com", dominio: "a.com", orden: 0 }] } }]);
  const r1 = await ejecutarChat({ provider: p1, modelos, limites, historialPrevio: [], pregunta: "buscá competidores en Córdoba y compará con SIM", web: webOn, webTimeoutMs: limites.webTimeoutMs, tiempoTotalMs: limites.webTimeoutMs });
  assert.equal(r1.estado, "completa", "búsqueda moderna simulada completa");
  assert.ok((p1.ultimoTimeoutMs ?? 0) > 200000, `proveedor recibe presupuesto web amplio (${p1.ultimoTimeoutMs}ms, sin cap de 60s)`);
  assert.ok((p1.ultimoTimeoutMs ?? 0) > 60000, "NO hay abort a los 60s para web");

  // pause_turn / continuaciones: el presupuesto TOTAL no se reinicia; la 2ª ronda recibe MENOS.
  const p2 = new FakeProviderGuionado([
    { tipo: "herramientas", llamadas: [{ nombre: "consultar_empleados", input: {} }], web: { busquedasFacturables: 1, fuentes: [] } },
    { tipo: "texto", texto: "listo", web: { busquedasFacturables: 0, fuentes: [{ url: "https://b.com", dominio: "b.com", orden: 0 }] } },
  ]);
  const budgets: number[] = [];
  const origGen = p2.generar.bind(p2);
  p2.generar = async (params) => { const r = await origGen(params); budgets.push(params.timeoutMs); return r; };
  const r2 = await ejecutarChat({ provider: p2, modelos, limites, historialPrevio: [], pregunta: "buscá y compará con SIM", web: webOn, webTimeoutMs: limites.webTimeoutMs, tiempoTotalMs: limites.webTimeoutMs });
  assert.equal(r2.estado, "completa", "continuación completa");
  assert.ok(budgets.length === 2 && budgets[1] <= budgets[0], "el presupuesto total se respeta entre rondas (no se reinicia)");
  assert.equal(r2.web.busquedasFacturables, 1, "búsqueda facturable contada una sola vez (tope global)");

  // Interna: el proveedor usa el tope general (≤60s), NO el presupuesto web.
  const p3 = new FakeProviderGuionado([{ tipo: "texto", texto: "385 turnos." }]);
  const r3 = await ejecutarChat({ provider: p3, modelos, limites, historialPrevio: [], pregunta: "cuántos turnos hizo Federico", web: { habilitar: false, explicita: false, motivo: "interno", maxUsos: 3, version: "web_search_20250305" } });
  assert.equal(r3.estado, "completa", "interna ok");
  assert.ok((p3.ultimoTimeoutMs ?? 0) <= limites.tiempoEjecucionMsMax, "interna conserva timeout corto (≤60s)");
}

async function main() {
  configTests();
  await orquestadorTests();
  console.log(`OK — timeout4d41: ROUTE_MAX_SEG=300; presupuesto web validado (default 250s, env válida prevalece, >=límite Function → inválido+clamp, no numérico → inválido); web recibe presupuesto amplio (>200s, sin cap de 60s) y completa; continuaciones respetan el presupuesto total (no se reinicia); búsqueda contada una vez; interna con timeout corto.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

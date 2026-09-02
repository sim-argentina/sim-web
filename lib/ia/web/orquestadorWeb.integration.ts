import { strict as assert } from "node:assert";
import { ejecutarChat } from "@/lib/ia/orchestrator";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { getLimites, getModelos } from "@/lib/ia/config";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/web/orquestadorWeb.integration.ts
// El orquestador es local; solo consultar_empleados hace una lectura (read-only) a la DB.

const modelos = getModelos();
const limites = getLimites();
const webOn = { habilitar: true, explicita: true, motivo: "tema_externo:mercado_local", maxUsos: 3, version: "web_search_20250305" };
const webOff = { habilitar: false, explicita: false, motivo: "resoluble_internamente", maxUsos: 3, version: "web_search_20250305" };
const fuente = (url: string) => ({ url, dominio: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], orden: 0 });

async function main() {
  // ── Interno: web NO habilitada → no se ofrece la herramienta; sin fuentes web ──
  const p1 = new FakeProviderGuionado([{ tipo: "texto", texto: "385 turnos.", web: { busquedasFacturables: 2, fuentes: [fuente("https://x.com")] } }]);
  const r1 = await ejecutarChat({ provider: p1, modelos, limites, historialPrevio: [], pregunta: "cuántos turnos", web: webOff });
  assert.equal(p1.ultimoWebSearch, undefined, "no se ofreció web cuando está deshabilitada");
  assert.equal(r1.web.busquedasFacturables, 0, "sin búsquedas (el fake no las emite sin habilitar)");
  assert.equal(r1.web.fuentes.length, 0, "sin fuentes externas");
  assert.equal(r1.web.habilitada, false, "web.habilitada = false");

  // ── Externo: web habilitada → se ofrece; se acumulan búsquedas y fuentes ─────
  const p2 = new FakeProviderGuionado([{ tipo: "texto", texto: "En Córdoba hay opciones.", web: { busquedasFacturables: 2, fuentes: [fuente("https://a.com/1"), fuente("https://b.com/2")], consultas: ["simuladores cordoba"] } }]);
  const r2 = await ejecutarChat({ provider: p2, modelos, limites, historialPrevio: [], pregunta: "buscá simuladores en córdoba", web: webOn });
  assert.equal(p2.ultimoWebSearch?.habilitado, true, "se ofreció web");
  assert.equal(p2.ultimoWebSearch?.maxUsos, 3, "maxUsos = presupuesto");
  assert.equal(r2.web.busquedasFacturables, 2, "acumula búsquedas");
  assert.equal(r2.web.fuentes.length, 2, "acumula fuentes");
  assert.deepEqual(r2.web.consultas, ["simuladores cordoba"], "consultas acumuladas");
  assert.equal(r2.web.explicita, true, "explícita");

  // ── Tope de búsquedas: agotado el presupuesto, no se vuelve a ofrecer web ─────
  const p3 = new FakeProviderGuionado([
    { tipo: "herramientas", llamadas: [{ nombre: "consultar_empleados", input: {} }], web: { busquedasFacturables: 3, fuentes: [fuente("https://a.com")] } },
    { tipo: "texto", texto: "listo", web: { busquedasFacturables: 5, fuentes: [fuente("https://no.com")] } },
  ]);
  const r3 = await ejecutarChat({ provider: p3, modelos, limites, historialPrevio: [], pregunta: "buscá competidores", web: webOn });
  assert.equal(p3.ultimoWebSearch, undefined, "2ª ronda: web NO ofrecida (presupuesto agotado)");
  assert.equal(r3.web.busquedasFacturables, 3, "no supera el tope de 3 (la 2ª ronda ya no busca)");

  // ── Degradación §15: 400 al ofrecer web → reintento SIN web, marca no disponible ─
  const p4 = new FakeProviderGuionado([
    { tipo: "error", mensaje: "El proveedor de IA respondió con estado 400.", status: 400 },
    { tipo: "texto", texto: "Respondo con datos internos." },
  ]);
  const r4 = await ejecutarChat({ provider: p4, modelos, limites, historialPrevio: [], pregunta: "buscá inflación", web: webOn });
  assert.equal(r4.estado, "completa", "responde igual (no 500)");
  assert.equal(r4.web.error, "web_no_disponible", "marca web no disponible");
  assert.equal(r4.texto, "Respondo con datos internos.", "responde la parte interna");

  console.log("OK — orquestadorWeb: interno no ofrece web; externo acumula búsquedas/fuentes/consultas; tope de 3 respetado (no rebusca en 2ª ronda); degradación 400 responde interno y marca web_no_disponible.");
}
main().catch((e) => { console.error(e); process.exit(1); });

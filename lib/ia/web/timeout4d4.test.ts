import { strict as assert } from "node:assert";
import { ejecutarChat } from "@/lib/ia/orchestrator";
import { FakeProviderGuionado } from "@/lib/ia/providerFake";
import { getModelos } from "@/lib/ia/config";

// Ejecutar: npx tsx --env-file=.env.local lib/ia/web/timeout4d4.test.ts
// Reloj real acotado: los "timeouts" del fake usan timeoutMs chico (no un sleep largo real).

const modelos = getModelos();
// Límites de prueba con tiempos cortos (no sleeps largos): el fake timeout espera timeoutMs+50.
const limites = { mensajesPorMinuto: 6, solicitudesDia: 100, tokensEntradaMax: 60000, tokensSalidaMax: 2000, rondasHerramientasMax: 6, herramientasPorRespuestaMax: 8, tiempoEjecucionMsMax: 3000, webTimeoutMs: 1500, tokensMesMax: 5_000_000 };
const webOn = { habilitar: true, explicita: true, motivo: "tema_externo", maxUsos: 3, version: "web_search_20250305" };

async function main() {
  // ── Timeout en ronda 0 SIN usage previo → uso desconocido, tokens conocidos = 0 ──
  const p1 = new FakeProviderGuionado([{ tipo: "timeout" }]);
  const r1 = await ejecutarChat({ provider: p1, modelos, limites, historialPrevio: [], pregunta: "buscá competidores en Córdoba y compará con SIM", web: webOn, webTimeoutMs: limites.webTimeoutMs });
  assert.equal(r1.estado, "error", "timeout → error");
  assert.equal(r1.usoDesconocido, true, "uso desconocido en timeout");
  assert.equal(r1.uso.tokensIn + r1.uso.tokensOut, 0, "tokens conocidos = 0 (no se inventa)");
  assert.ok(/timeout|tard[óo]/i.test(r1.error ?? ""), "error de timeout");
  assert.ok((r1.faseFallo ?? "").includes("ronda_0"), "fase de fallo registrada");
  // Presupuesto web aplicado: el proveedor recibió el timeout web (≤ webTimeoutMs), no el general.
  assert.ok((p1.ultimoTimeoutMs ?? 0) <= limites.webTimeoutMs, "presupuesto web (< tope general) aplicado al proveedor");

  // ── Timeout tras usage PARCIAL conocido (una ronda de herramienta) → parcial + desconocido ──
  const p2 = new FakeProviderGuionado([{ tipo: "herramientas", llamadas: [{ nombre: "consultar_empleados", input: {} }] }, { tipo: "timeout" }]);
  const r2 = await ejecutarChat({ provider: p2, modelos, limites, historialPrevio: [], pregunta: "buscá y compará con SIM", web: webOn, webTimeoutMs: limites.webTimeoutMs });
  assert.equal(r2.estado, "error", "timeout tras parcial → error");
  assert.equal(r2.usoDesconocido, true, "uso desconocido (último intento abortado)");
  assert.ok(r2.uso.tokensIn > 0, "conserva los tokens CONOCIDOS de la ronda previa");

  // ── Error NO-timeout (502) → NO marca uso desconocido ─────────────────────────
  const p3 = new FakeProviderGuionado([{ tipo: "error", mensaje: "El proveedor de IA respondió con estado 502.", status: 502 }]);
  const r3 = await ejecutarChat({ provider: p3, modelos, limites, historialPrevio: [], pregunta: "buscá X y compará con SIM", web: webOn, webTimeoutMs: limites.webTimeoutMs });
  assert.equal(r3.estado, "error", "502 → error");
  assert.equal(r3.usoDesconocido ?? false, false, "502 no es uso desconocido");

  // ── Sin web: el proveedor recibe el tiempo general (no el presupuesto web) ────
  const p4 = new FakeProviderGuionado([{ tipo: "texto", texto: "Federico hizo 385 turnos." }]);
  const r4 = await ejecutarChat({ provider: p4, modelos, limites, historialPrevio: [], pregunta: "cuántos turnos hizo Federico", web: { habilitar: false, explicita: false, motivo: "interno", maxUsos: 3, version: "web_search_20250305" }, webTimeoutMs: limites.webTimeoutMs });
  assert.equal(r4.estado, "completa", "interna ok");
  assert.equal(p4.ultimoWebSearch, undefined, "interna no ofrece web");
  assert.ok((p4.ultimoTimeoutMs ?? 0) > limites.webTimeoutMs, "interna usa el tiempo general (mayor que el presupuesto web)");

  console.log("OK — timeout4d4: timeout ronda 0 → uso_desconocido + tokens 0 (no inventa) + fase; timeout parcial → conserva conocidos + desconocido; 502 no es desconocido; presupuesto web aplicado con web y tiempo general sin web; sin auto-fallback ni reintento.");
}
main().catch((e) => { console.error(e); process.exit(1); });

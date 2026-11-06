import { strict as assert } from "node:assert";
import { VIGENCIA_TOKEN_MS, emitirTokenFormulario, verificarTokenFormulario } from "@/lib/marketing/tokenFormulario";

// Marketing · token firmado del formulario de aceptación. Puro (node:crypto).
// Ejecutar: npx tsx lib/marketing/tokenFormulario.test.ts

const env = { ADMIN_SESSION_SECRET: "secreto-de-prueba-del-token" };
const T0 = new Date("2026-10-19T15:00:00.000Z");
const mas = (ms: number) => new Date(T0.getTime() + ms);

// ── 1. Ida y vuelta: firma el momento exacto y la versión mostrada ──────────
{
  const t = emitirTokenFormulario("promos-v1", T0, env);
  assert.ok(t && /^[0-9a-z]+\.[A-Za-z0-9_-]{32}$/.test(t));
  const v = verificarTokenFormulario(t, "promos-v1", mas(60_000), env);
  assert.ok(v.ok && v.emitidoEn.getTime() === T0.getTime(), "devuelve el momento en que se mostró el texto");
  assert.equal(emitirTokenFormulario("promos-v1", T0, env), t, "determinístico");
}

// ── 2. No se puede cambiar la versión, el momento ni la firma ───────────────
{
  const t = emitirTokenFormulario("promos-v1", T0, env)!;
  assert.deepEqual(verificarTokenFormulario(t, "promos-v2", mas(1000), env), { ok: false, motivo: "token_invalido" }, "otra versión");
  const [ms, firma] = t.split(".");
  const masNuevo = `${(parseInt(ms, 36) + 3_600_000).toString(36)}.${firma}`;
  assert.deepEqual(verificarTokenFormulario(masNuevo, "promos-v1", mas(1000), env), { ok: false, motivo: "token_invalido" }, "no se puede rejuvenecer");
  const otraFirma = `${ms}.${"A".repeat(32)}`;
  assert.deepEqual(verificarTokenFormulario(otraFirma, "promos-v1", mas(1000), env), { ok: false, motivo: "token_invalido" });
  assert.deepEqual(verificarTokenFormulario(t, "promos-v1", mas(1000), { ADMIN_SESSION_SECRET: "otro" }), { ok: false, motivo: "token_invalido" });
  for (const malo of [undefined, null, 42, "", "x", "abc.def", `${ms}.${firma}!`]) {
    assert.deepEqual(verificarTokenFormulario(malo, "promos-v1", mas(1000), env), { ok: false, motivo: "token_invalido" }, String(malo));
  }
}

// ── 3. Vence a las 2 h; uno "del futuro" (más de 2 min) no vale ──────────────
{
  const t = emitirTokenFormulario("promos-v1", T0, env)!;
  assert.ok(verificarTokenFormulario(t, "promos-v1", mas(VIGENCIA_TOKEN_MS), env).ok, "justo en el límite vale");
  assert.deepEqual(verificarTokenFormulario(t, "promos-v1", mas(VIGENCIA_TOKEN_MS + 1), env), { ok: false, motivo: "formulario_vencido" });
  assert.ok(verificarTokenFormulario(t, "promos-v1", mas(-60_000), env).ok, "1 min de diferencia de reloj se tolera");
  assert.deepEqual(verificarTokenFormulario(t, "promos-v1", mas(-3 * 60_000), env), { ok: false, motivo: "token_invalido" });
}

// ── 4. Sin secreto no hay token: las altas se cierran (falla cerrada) ───────
{
  assert.equal(emitirTokenFormulario("promos-v1", T0, {}), null);
  assert.deepEqual(verificarTokenFormulario("abc.def", "promos-v1", T0, {}), { ok: false, motivo: "sin_secreto" });
}

console.log("tokenFormulario: ok");

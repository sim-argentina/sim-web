import { strict as assert } from "node:assert";
import {
  COOKIE_SESION, DURACION_SESION_MS, nuevoTokenSesion, hashToken,
  opcionesCookie, opcionesCookieBorrada,
} from "@/lib/mensualidadSesion";
import { minutosATexto, normalizarCodigo, normalizarTelefono } from "@/lib/mensualidades";
import { ADMIN_COOKIE } from "@/lib/adminSession";

// Ejecutar: npx tsx lib/mensualidadesM4.test.ts
// Reglas PURAS de la sesión pública (M4). Lo que toca base y endpoints está en
// lib/mensualidadesM4.integration.ts.

// ── Token de sesión ────────────────────────────────────────────────────────
const tokens = new Set<string>();
for (let i = 0; i < 500; i++) {
  const t = nuevoTokenSesion();
  assert.match(t, /^[A-Za-z0-9_-]+$/, `token con caracteres inesperados: ${t}`);
  // 32 bytes en base64url = 43 caracteres. El mínimo exigido era 24 bytes.
  assert.ok(t.length >= 40, `token demasiado corto: ${t.length}`);
  tokens.add(t);
}
assert.equal(tokens.size, 500, "los tokens de sesión no pueden repetirse");

// ── Hash: es lo único que va a la base ─────────────────────────────────────
const tok = nuevoTokenSesion();
const h = hashToken(tok);
assert.match(h, /^[a-f0-9]{64}$/, "el hash debe ser SHA-256 en hex");
assert.equal(hashToken(tok), h, "el hash es determinista");
assert.notEqual(h, tok, "el hash no puede ser el token");
assert.ok(!h.includes(tok), "el token no puede estar contenido en el hash");
assert.notEqual(hashToken(nuevoTokenSesion()), h, "tokens distintos → hashes distintos");
// Un cambio de un solo carácter cambia el hash por completo.
const tokAlterado = `${tok.slice(0, -1)}${tok.endsWith("A") ? "B" : "A"}`;
assert.notEqual(hashToken(tokAlterado), h);

// ── Cookie ─────────────────────────────────────────────────────────────────
assert.equal(COOKIE_SESION, "sim_mensualidad_session");
// No puede pisar ni reutilizar la sesión de admin.
assert.notEqual(COOKIE_SESION, ADMIN_COOKIE);
for (const ajena of ["sim-admin-session", "sim-reservas", "sim-empresas", "sim-giftcards"]) {
  assert.notEqual(COOKIE_SESION, ajena, `la cookie no puede ser ${ajena}`);
}

const op = opcionesCookie();
assert.equal(op.httpOnly, true, "la cookie NO puede leerse desde JavaScript");
assert.equal(op.sameSite, "lax");
assert.equal(op.path, "/");
assert.equal(op.maxAge, DURACION_SESION_MS / 1000);
assert.equal(DURACION_SESION_MS, 30 * 60 * 1000, "la sesión dura 30 minutos");
// `secure` depende del entorno: en producción tiene que ser true.
const env = process.env as Record<string, string | undefined>;
const entornoPrevio = env.NODE_ENV;
try {
  env.NODE_ENV = "production";
  assert.equal(opcionesCookie().secure, true, "en producción la cookie debe ser Secure");
} finally {
  if (entornoPrevio === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = entornoPrevio;
}

const borrada = opcionesCookieBorrada();
assert.equal(borrada.maxAge, 0, "borrar la cookie es maxAge 0");
assert.equal(borrada.httpOnly, true);

// ── Saldo legible ──────────────────────────────────────────────────────────
assert.equal(minutosATexto(0), "0 min");
assert.equal(minutosATexto(15), "15 min");
assert.equal(minutosATexto(45), "45 min");
assert.equal(minutosATexto(60), "1 h");
assert.equal(minutosATexto(90), "1 h 30 min");
assert.equal(minutosATexto(120), "2 h");
assert.equal(minutosATexto(150), "2 h 30 min");
assert.equal(minutosATexto(240), "4 h");
assert.equal(minutosATexto(-30), "0 min", "un saldo negativo nunca se muestra");

// ── Normalizaciones reutilizadas de M2.1/M2.2 ─────────────────────────────
// El formulario de identificación acepta el código escrito de cualquier forma.
assert.equal(normalizarCodigo("men abcd 2345"), "MEN-ABCD-2345");
assert.equal(normalizarCodigo("ABCD2345"), "MEN-ABCD-2345");
assert.equal(normalizarCodigo("men-abc0-2345"), null, "0 no está en el alfabeto");
// Y el teléfono en cualquiera de sus formatos argentinos.
for (const tel of ["3515123456", "0351 15-5123456", "+54 9 351 512-3456"]) {
  assert.equal(normalizarTelefono(tel), "3515123456", `identificación con "${tel}"`);
}

console.log("mensualidadesM4.test.ts OK");

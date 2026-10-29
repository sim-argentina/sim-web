import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { hashContrasena, hashConFormatoValido, hashSimulado, verificarContrasena } from "@/lib/crmContrasena";
import { problemaContrasenaNueva } from "@/lib/crmUsuarios";

// Ejecutar: npx tsx lib/crmContrasena.test.ts
// Hash de contraseñas comerciales (scrypt) y su contrato con la base: el formato
// que genera el servidor es exactamente el que aceptan el CHECK de crm_usuarios y
// crm_hash_valido() en db/crm-b0-identidad.sql.

async function tiempo(f: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await f();
  return performance.now() - t0;
}

async function main() {
  const clave = "Una-clave-de-prueba-1";
  const h1 = await hashContrasena(clave);
  const h2 = await hashContrasena(clave);

  // ── 1) Formato y sal ────────────────────────────────────────────────────
  assert.match(h1, /^scrypt\$17\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/, "formato y parámetros explícitos");
  assert.notEqual(h1, h2, "sal aleatoria: dos hashes de la misma contraseña difieren");
  assert.ok(!h1.includes(clave), "el hash no contiene la contraseña");
  assert.equal(hashConFormatoValido(h1), true);

  // ── 2) Verificación ─────────────────────────────────────────────────────
  assert.equal(await verificarContrasena(clave, h1), true, "contraseña correcta");
  assert.equal(await verificarContrasena(clave, h2), true, "con la otra sal también");
  assert.equal(await verificarContrasena(clave + "x", h1), false, "contraseña incorrecta");
  assert.equal(await verificarContrasena("", h1), false, "vacía");
  const tocado = h1.slice(0, -1) + (h1.endsWith("A") ? "B" : "A");
  assert.equal(await verificarContrasena(clave, tocado), false, "hash alterado");
  assert.equal(await verificarContrasena(clave, h1.replace("scrypt$17$", "scrypt$25$")), false, "parámetros fuera de rango");
  assert.equal(await verificarContrasena(clave, clave), false, "texto plano no es un hash");
  assert.equal(await verificarContrasena(clave, "$2b$10$abcdefghijklmnopqrstuv"), false, "otro algoritmo");
  // Normalización Unicode: "é" compuesta y descompuesta son la misma contraseña.
  const hU = await hashContrasena("café-con-leche-1");
  assert.equal(await verificarContrasena("café-con-leche-1", hU), true, "NFC");

  // ── 3) Contrato con la base ─────────────────────────────────────────────
  const sql = readFileSync("db/crm-b0-identidad.sql", "utf8");
  const check = /crm_usuarios_hash_chk check \(password_hash ~ '([^']+)'\)/.exec(sql)?.[1];
  const funcion = /coalesce\(p_hash ~ '([^']+)', false\)/.exec(sql)?.[1];
  assert.ok(check && funcion, "las dos expresiones existen en el SQL");
  assert.equal(check, funcion, "el CHECK y crm_hash_valido() aceptan lo mismo");
  const reSql = new RegExp(check!);
  assert.ok(reSql.test(h1) && reSql.test(h2) && reSql.test(hU), "la base acepta lo que genera el servidor");
  for (const malo of [clave, tocado.replace("scrypt$17$8$1$", "scrypt$17$8$2$"), h1.replace("scrypt$17$", "scrypt$20$"), h1 + "x"]) {
    assert.equal(reSql.test(malo), false, `la base rechaza ${malo.slice(0, 20)}…`);
  }

  // ── 4) Usuario inexistente: mismo costo ─────────────────────────────────
  const s = await hashSimulado();
  assert.equal(s, await hashSimulado(), "un solo hash simulado por proceso");
  assert.equal(hashConFormatoValido(s), true);
  const real: number[] = [];
  const sim: number[] = [];
  for (let i = 0; i < 3; i++) {
    real.push(await tiempo(() => verificarContrasena("intento-incorrecto", h1)));
    sim.push(await tiempo(() => verificarContrasena("intento-incorrecto", s)));
  }
  const med = (a: number[]) => a.sort((x, y) => x - y)[1];
  const razon = med(real) / med(sim);
  assert.ok(razon > 0.5 && razon < 2, `costo comparable (real ${med(real).toFixed(0)} ms, simulado ${med(sim).toFixed(0)} ms)`);
  assert.ok(med(real) > 50, "scrypt con costo real (no un atajo)");

  // ── 5) Política de contraseñas nuevas ───────────────────────────────────
  assert.equal(problemaContrasenaNueva("Bien-larga-123", "tobias"), null);
  assert.ok(problemaContrasenaNueva(undefined, "tobias"));
  assert.ok(problemaContrasenaNueva("", "tobias"));
  assert.ok(problemaContrasenaNueva("corta-1", "tobias"), "menos de 10");
  assert.ok(problemaContrasenaNueva("x".repeat(129), "tobias"), "más de 128");
  assert.ok(problemaContrasenaNueva(" con-espacio-1", "tobias"), "espacio al principio");
  assert.ok(problemaContrasenaNueva("soy-TOBIAS-2026", "tobias"), "contiene el usuario");
  assert.ok(problemaContrasenaNueva("aaaaaaaaaaaa", "tobias"), "repetitiva");

  console.log(`OK — crmContrasena: scrypt con sal, verificación, contrato con la base y costo simulado (${med(real).toFixed(0)} ms).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Prueba PURA (sin base, sin red) de la defensa que impide que el proveedor FALSO
// atienda consultas reales. Ejecutar: npx tsx lib/ia/proveedorPermitido.test.ts
import { strict as assert } from "node:assert";
import {
  evaluarProveedor,
  destinoEsLoopback,
  CODIGO_FAKE_EN_PRODUCCION,
  CODIGO_FAKE_VERCEL_INDETERMINADO,
  CODIGO_FAKE_DESTINO_NO_LOOPBACK,
} from "@/lib/ia/proveedorPermitido";

const PROD = "https://bcmoewwhsyxsiyvroarj.supabase.co";
const LOCAL = "http://127.0.0.1:55321";

// ── 1) El proveedor real nunca se discute ───────────────────────────────────
{
  for (const entorno of [
    { IA_PROVIDER: "anthropic", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD },
    { VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD }, // sin IA_PROVIDER → anthropic
    { IA_PROVIDER: "ANTHROPIC", NEXT_PUBLIC_SUPABASE_URL: PROD },
  ]) {
    const v = evaluarProveedor(entorno);
    assert.equal(v.ok, true, "el proveedor real se permite siempre");
    if (v.ok) assert.equal(v.motivo, "proveedor_real");
  }
}
console.log("OK — proveedor (1): el proveedor real pasa en cualquier entorno, incluido Production.");

// ── 2) Vercel Production bloquea el falso ───────────────────────────────────
{
  const v = evaluarProveedor({ IA_PROVIDER: "fake", VERCEL: "1", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.codigo, CODIGO_FAKE_EN_PRODUCCION);

  // Y lo bloquea incluso si alguien apuntara a un loopback: en Production no se simula.
  const w = evaluarProveedor({ IA_PROVIDER: "fake", VERCEL: "1", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: LOCAL });
  assert.equal(w.ok, false, "en Vercel Production el falso está prohibido, mire donde mire");
  if (!w.ok) assert.equal(w.codigo, CODIGO_FAKE_EN_PRODUCCION);
}
console.log("OK — proveedor (2): en Vercel Production el proveedor falso queda bloqueado, incluso con destino loopback.");

// ── 3) Falla CERRADA: en Vercel con un entorno que no se puede clasificar ───
{
  for (const vercelEnv of [undefined, "", "staging", "produccion", "PRODUCTION_X"]) {
    const v = evaluarProveedor({ IA_PROVIDER: "fake", VERCEL: "1", VERCEL_ENV: vercelEnv, NEXT_PUBLIC_SUPABASE_URL: LOCAL });
    assert.equal(v.ok, false, `VERCEL_ENV="${vercelEnv}" no se puede descartar: tiene que bloquear`);
    if (!v.ok) {
      assert.ok(
        v.codigo === CODIGO_FAKE_VERCEL_INDETERMINADO || v.codigo === CODIGO_FAKE_EN_PRODUCCION,
        `código inesperado para VERCEL_ENV="${vercelEnv}": ${v.codigo}`,
      );
    }
  }
  // También con VERCEL_URL en vez de VERCEL.
  const v = evaluarProveedor({ IA_PROVIDER: "fake", VERCEL_URL: "sim-web.vercel.app", NEXT_PUBLIC_SUPABASE_URL: LOCAL });
  assert.equal(v.ok, false, "VERCEL_URL también indica que corre en Vercel");
}
console.log("OK — proveedor (3): falla cerrada — en Vercel, cualquier VERCEL_ENV que no sea preview/development bloquea.");

// ── 4) Preview y Development sí pueden usar el falso ────────────────────────
{
  for (const env of ["preview", "development", "Preview", "DEVELOPMENT"]) {
    const v = evaluarProveedor({ IA_PROVIDER: "fake", VERCEL: "1", VERCEL_ENV: env, NEXT_PUBLIC_SUPABASE_URL: PROD });
    assert.equal(v.ok, true, `${env} puede usar el proveedor falso`);
  }
}
console.log("OK — proveedor (4): Preview y Development de Vercel pueden usar el proveedor falso.");

// ── 5) Local contra el Supabase LOCAL: permitido (es como corren las suites) ─
{
  const v = evaluarProveedor({ IA_PROVIDER: "fake", NEXT_PUBLIC_SUPABASE_URL: LOCAL });
  assert.equal(v.ok, true, "las suites corren así");
  if (v.ok) assert.equal(v.motivo, "destino_loopback");

  for (const url of ["http://localhost:55321", "http://[::1]:55321", "http://127.0.0.1:55321/"]) {
    assert.equal(evaluarProveedor({ IA_PROVIDER: "fake", NEXT_PUBLIC_SUPABASE_URL: url }).ok, true, url);
  }
}
console.log("OK — proveedor (5): con el Supabase local el proveedor falso se permite; así corren las suites.");

// ── 6) Local contra PRODUCCIÓN: bloqueado. Es el camino que contaminó la base ─
{
  const v = evaluarProveedor({ IA_PROVIDER: "fake", NEXT_PUBLIC_SUPABASE_URL: PROD });
  assert.equal(v.ok, false, "un portátil con .env.local no puede escribir ejecuciones falsas en el negocio");
  if (!v.ok) assert.equal(v.codigo, CODIGO_FAKE_DESTINO_NO_LOOPBACK);

  // Sin destino declarado tampoco: no se asume nada.
  assert.equal(evaluarProveedor({ IA_PROVIDER: "fake" }).ok, false, "sin destino no se permite");
}
console.log("OK — proveedor (6): fuera de Vercel, el falso contra una base que no es loopback queda bloqueado.");

// ── 7) No se puede fingir un loopback ───────────────────────────────────────
{
  const falsos = [
    "https://localhost.bcmoewwhsyxsiyvroarj.supabase.co",
    "https://127.0.0.1.evil.com",
    "https://bcmoewwhsyxsiyvroarj.supabase.co/localhost",
    "https://bcmoewwhsyxsiyvroarj.supabase.co#127.0.0.1",
    "http://user@127.0.0.1:55321",
    "no-es-una-url",
  ];
  for (const url of falsos) {
    assert.equal(destinoEsLoopback(url), false, `${url} NO es loopback`);
    assert.equal(evaluarProveedor({ IA_PROVIDER: "fake", NEXT_PUBLIC_SUPABASE_URL: url }).ok, false, url);
  }
  assert.equal(destinoEsLoopback(undefined), false);
}
console.log("OK — proveedor (7): una URL que solo CONTIENE 'localhost' o '127.0.0.1' no pasa; el host tiene que serlo.");

// ── 8) NODE_ENV no participa de la decisión ─────────────────────────────────
{
  const conProd = { IA_PROVIDER: "fake", VERCEL: "1", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD };
  for (const nodeEnv of ["development", "test", "production", undefined]) {
    assert.equal(evaluarProveedor({ ...conProd, NODE_ENV: nodeEnv }).ok, false, `NODE_ENV=${nodeEnv} no habilita nada`);
  }
  const conLocal = { IA_PROVIDER: "fake", NEXT_PUBLIC_SUPABASE_URL: LOCAL };
  for (const nodeEnv of ["development", "test", "production", undefined]) {
    assert.equal(evaluarProveedor({ ...conLocal, NODE_ENV: nodeEnv }).ok, true, `NODE_ENV=${nodeEnv} no quita nada`);
  }
}
console.log("OK — proveedor (8): NODE_ENV no cambia la decisión; manda el destino y el entorno de despliegue.");

// ── 9) El contrato con correrChat: se evalúa antes de persistir ─────────────
{
  const fuente = readFileSyncSeguro("lib/ia/server.ts");
  const iEval = fuente.indexOf("evaluarProveedor()");
  assert.ok(iEval > 0, "correrChat tiene que evaluar el proveedor");

  // Nada que escriba puede aparecer antes de la evaluación dentro de correrChat.
  const iChat = fuente.indexOf("export async function correrChat");
  assert.ok(iChat > 0 && iChat < iEval, "la evaluación va dentro de correrChat");
  const antes = fuente.slice(iChat, iEval);
  for (const escritura of ["ia_reservar_solicitud", "ia_sumar_consumo", ".insert(", ".update(", ".delete("]) {
    assert.ok(!antes.includes(escritura), `"${escritura}" no puede ejecutarse antes de la defensa`);
  }
  // Y ni siquiera una lectura de la conversación: se sale sin tocar la base.
  assert.ok(!antes.includes("from(\"ia_conversaciones\")"), "tampoco se lee la conversación antes");
}
console.log("OK — proveedor (9): en correrChat la defensa corre ANTES de cualquier lectura o escritura: no se persiste nada.");

function readFileSyncSeguro(ruta: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(ruta, "utf8");
}

console.log("\nOK — defensa del proveedor falso: 9/9.");

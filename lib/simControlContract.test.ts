import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "@/lib/simControlHash";
import {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  validarPayload,
  type DayPackagePayload,
} from "@/lib/simControlProtocol";
import { conciliar } from "@/lib/simControlReconciliation";

// Ejecutar: npx tsx lib/simControlContract.test.ts
//
// Test de CONTRATO contra el golden JSON.
//
// `tests/contracts/day-sync-v1/valid-package.json` no lo escribió una persona: lo genera el MISMO
// serializador de SIM Control (C#), así que sus bytes son exactamente los que van a llegar por la
// red. Si alguien cambia el payload de un lado y no del otro, este test se rompe acá y el equivalente
// en C# se rompe allá. Es lo único que impide que backend y terminal se separen sin que nadie lo note.
//
// Importante: el hash se calcula sobre el TEXTO CRUDO del archivo, nunca sobre un JSON re-serializado.

const DIR = join(process.cwd(), "tests", "contracts", "day-sync-v1");
const rawPackage = readFileSync(join(DIR, "valid-package.json"), "utf8");
const meta = JSON.parse(readFileSync(join(DIR, "valid-package.meta.json"), "utf8"));

// ── CASO A — el hash del golden es el que dice su metadata ─────────────────────
// Si alguien edita el fixture a mano, esto lo caza al instante.
{
  assert.equal(sha256Hex(rawPackage), meta.payloadSha256, "el hash del payload no coincide con el del contrato");
  assert.equal(Buffer.byteLength(rawPackage, "utf8"), meta.payloadBytes);
}

// ── CASO B — el backend acepta el paquete que produce la terminal ──────────────
{
  const parsed = JSON.parse(rawPackage);
  const validacion = validarPayload(parsed);
  assert.ok(validacion.ok, `el golden no pasó la validación: ${validacion.ok ? "" : validacion.motivo}`);

  const payload = (validacion as { ok: true; payload: DayPackagePayload }).payload;
  assert.equal(payload.protocolVersion, PROTOCOL_VERSION);
  assert.equal(payload.schemaVersion, SCHEMA_VERSION);
  assert.equal(payload.sessions.length, meta.expected.sessions);
  assert.equal(payload.interventions.length, meta.expected.interventions);
  assert.equal(payload.performance?.length ?? 0, meta.expected.performance);
  assert.equal(payload.totals.reconcilableSessions, meta.expected.reconcilableSessions);
  assert.equal(payload.totals.reconcilableMinutesTotal, meta.expected.reconcilableMinutesTotal);
}

// ── CASO C — las claves son camelCase ─────────────────────────────────────────
// El contrato documentado dice camelCase. Vale la pena fijarlo: el serializador de .NET usa
// PascalCase por defecto, y esa diferencia ya se coló una vez.
{
  assert.ok(rawPackage.startsWith('{"schemaVersion":'), "el payload tiene que empezar con schemaVersion en camelCase");
  assert.ok(!rawPackage.includes('"SchemaVersion"'), "no puede haber claves en PascalCase");
  assert.ok(!rawPackage.includes('"CountsForReconciliation"'));
}

// ── CASO D — el golden NO lleva secretos ──────────────────────────────────────
// Mismo criterio que el test equivalente del lado C#: el payload no transporta credenciales,
// códigos de operador ni datos del sistema operativo.
{
  const prohibido = ["password", "secret", "token", "credential", "pin", "hash", "dpapi", "C:\\\\", "Users\\\\"];
  const enMinuscula = rawPackage.toLowerCase();
  for (const palabra of prohibido) {
    assert.ok(!enMinuscula.includes(palabra.toLowerCase()), `el payload no puede contener "${palabra}"`);
  }
}

// ── CASO E — la conciliación entiende el golden ───────────────────────────────
// La jornada de ejemplo trae: 15 simple + (15+5 de extensión) + un turno reiniciado con su
// reemplazo + mantenimiento. Lo conciliable son 50 simulador-minutos: el mantenimiento no cuenta y
// el incidente no se cobra dos veces.
{
  const payload = JSON.parse(rawPackage) as DayPackagePayload;
  const sesiones = payload.sessions.map((s) => ({
    terminal_key: payload.terminalId,
    local_session_id: s.sessionId,
    counts_for_reconciliation: s.countsForReconciliation,
    authorized_duration_minutes: s.authorizedDurationMinutes,
    session_type: s.sessionType,
    status: s.status,
  }));

  const r = conciliar({
    businessDate: payload.businessDate,
    // 50 simulador-minutos esperados en el central: p. ej. un turno de 2 sims × 15 + uno de 1 × 20.
    stand: [
      { id: 1, estado: "activo", cantidad_simuladores: 2, cantidad_minutos: 15 },
      { id: 2, estado: "activo", cantidad_simuladores: 1, cantidad_minutos: 20 },
    ],
    reservas: [],
    sesiones,
  });

  assert.equal(r.simControl.simuladorMinutos, 50, "base + extensiones, sin mantenimiento ni el turno reiniciado");
  assert.equal(r.simControl.sesionesConciliables, 3);
  assert.equal(r.simControl.sesionesMantenimiento, 1);
  assert.equal(r.simControl.sesionesReiniciadas, 1);
  assert.equal(r.central.simuladorMinutos, 50);
  assert.equal(r.estado, "verified");
}

// ── CASO F — un payload de una versión futura se rechaza explícitamente ───────
{
  const futuro = { ...JSON.parse(rawPackage), protocolVersion: 99 };
  const v = validarPayload(futuro);
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "unsupported_protocol");
}

// ── CASO G — un payload manipulado se rechaza ────────────────────────────────
{
  const sinBandera = JSON.parse(rawPackage);
  delete sinBandera.sessions[0].countsForReconciliation;
  const v = validarPayload(sinBandera);
  assert.equal(v.ok, false, "sin el campo autoritativo no se ingiere nada");
}

{
  const idRepetido = JSON.parse(rawPackage);
  idRepetido.sessions[1].sessionId = idRepetido.sessions[0].sessionId;
  const v = validarPayload(idRepetido);
  assert.equal(v.ok, false, "dos sesiones con el mismo id son un paquete corrupto");
}

{
  const huerfana = JSON.parse(rawPackage);
  huerfana.interventions[0].sessionId = "00000000-0000-4000-8000-000000000099";
  const v = validarPayload(huerfana);
  assert.equal(v.ok, false, "una intervención tiene que pertenecer a una sesión del mismo paquete");
}

// ── CASO H — cambiar un solo byte cambia el hash ─────────────────────────────
{
  const alterado = rawPackage.replace('"sequence":1', '"sequence":2');
  assert.notEqual(sha256Hex(alterado), meta.payloadSha256);
}

console.log("simControlContract.test.ts OK");

import { strict as assert } from "node:assert";
import { faltanMsPara, MS_24H } from "@/lib/mensualidadesMiPlan";

// Test PURO del cálculo de las 24 horas (Bloque M5C). Sin DB, sin red.
// Ejecutar: npx tsx lib/mensualidadesM5C.test.ts
//
// La autoridad sobre restituir o no es la RPC, que lo calcula en Postgres con
// America/Argentina/Cordoba. Esto es el MISMO criterio del lado del navegador,
// para poder decirle al titular de antemano qué va a pasar si cancela. Si los
// dos se separaran, la pantalla prometería una cosa y la base haría otra.

function main() {
  // Instante de referencia: 2026-09-20 18:00 en Córdoba (UTC-3) = 21:00 UTC.
  const ahora = Date.parse("2026-09-20T21:00:00Z");

  // ── 1) Argentina es UTC-3 todo el año: la hora local se ancla con -03:00 ──
  assert.equal(
    faltanMsPara("2026-09-20", "18:00", ahora), 0,
    "18:00 de Córdoba del 20/09 es exactamente el instante de referencia",
  );

  // ── 2) El ejemplo del bloque ──
  // Reserva 20/09 18:00 → se puede cancelar con devolución hasta el 19/09 18:00.
  const reserva = { fecha: "2026-09-20", hora: "18:00" };
  const el19a18 = Date.parse("2026-09-19T21:00:00Z");
  assert.equal(
    faltanMsPara(reserva.fecha, reserva.hora, el19a18), MS_24H,
    "el 19/09 a las 18:00 faltan exactamente 24 h",
  );
  assert.ok(
    faltanMsPara(reserva.fecha, reserva.hora, el19a18) >= MS_24H,
    "a las 24 h EXACTAS todavía restituye: el corte es inclusivo",
  );

  // ── 3) Un segundo más tarde ya no ──
  const unSegundoDespues = el19a18 + 1000;
  assert.ok(
    faltanMsPara(reserva.fecha, reserva.hora, unSegundoDespues) < MS_24H,
    "a 23:59:59 ya no se restituye",
  );
  assert.equal(
    faltanMsPara(reserva.fecha, reserva.hora, unSegundoDespues), MS_24H - 1000,
  );

  // ── 4) Un segundo antes sí ──
  assert.ok(
    faltanMsPara(reserva.fecha, reserva.hora, el19a18 - 1000) > MS_24H,
    "a 24:00:01 restituye",
  );

  // ── 5) Reserva ya empezada o pasada: faltan milisegundos negativos ──
  assert.ok(faltanMsPara("2026-09-20", "17:00", ahora) < 0, "un turno de hace una hora ya pasó");
  assert.ok(faltanMsPara("2026-09-19", "10:00", ahora) < 0, "un turno de ayer ya pasó");
  assert.equal(faltanMsPara("2026-09-20", "18:00", ahora), 0, "justo al empezar, 0");

  // ── 6) No depende de la zona del servidor ──
  // El mismo cálculo con el reloj en otro huso da el mismo resultado, porque la
  // hora de la reserva se ancla con el offset fijo de Argentina.
  const mismoInstanteOtroHuso = Date.parse("2026-09-19T18:00:00-06:00"); // = 00:00Z del 20
  assert.equal(
    faltanMsPara("2026-09-20", "18:00", mismoInstanteOtroHuso),
    Date.parse("2026-09-20T21:00:00Z") - mismoInstanteOtroHuso,
    "el resultado sale del instante absoluto, no de la zona de quien pregunta",
  );

  // ── 7) Entradas inválidas no mienten: devuelven NaN, no un número creíble ──
  for (const [f, h] of [["", "18:00"], ["2026-13-45", "18:00"], ["2026-09-20", "99:99"], ["2026-09-20", ""]] as const) {
    assert.ok(Number.isNaN(faltanMsPara(f, h, ahora)), `(${f} ${h}) no puede dar un número`);
  }

  // ── 8) Cruce de medianoche ──
  // Un turno a las 10:00 del 21/09, preguntado a las 23:00 del 19/09: faltan 35 h.
  const el19a23 = Date.parse("2026-09-20T02:00:00Z"); // 23:00 del 19 en Córdoba
  assert.equal(
    faltanMsPara("2026-09-21", "10:00", el19a23), 35 * 60 * 60 * 1000,
    "el cálculo cruza la medianoche sin corrimientos",
  );

  // ── 9) MS_24H es lo que dice ser ──
  assert.equal(MS_24H, 86_400_000);

  console.log("mensualidadesM5C.test.ts OK (9 escenarios de la regla de 24 h)");
}

main();

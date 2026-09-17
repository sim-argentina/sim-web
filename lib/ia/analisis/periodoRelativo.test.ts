import { strict as assert } from "node:assert";
import {
  resolverMesRelativo, mesAnterior,
  ventanaHoy, ventanaAyer, ventanaEstaSemana, ventanaSemanaPasada, ventanaEsteAnio, ventanaAnioPasado,
} from "@/lib/ia/analisis/periodoRelativo";
import { hoyCordoba } from "@/lib/ia/periodo";

// Ejecutar: npx tsx lib/ia/analisis/periodoRelativo.test.ts — puro, reloj SIEMPRE inyectado.
//
// Bloque 4E (hotfix) — "compará este mes con el mes pasado" pedía aclaración en producción
// porque ninguna herramienta ni el prompt de sistema resolvían expresiones temporales
// relativas: el modelo no tenía forma de saber qué año/mes es "este mes". Esto prueba, con
// fechas FIJAS (nunca la fecha real de la corrida), que la resolución es correcta en
// America/Argentina/Cordoba, incluyendo el acarreo de año y el cambio de día cerca de medianoche
// UTC.

function diaIso(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow; // 1=lunes .. 7=domingo
}

function main() {
  // ── este_mes / mes_pasado / mismo_mes_anio_pasado, caso normal (sin cruce de año) ─────────
  {
    // 2026-09-17T15:00:00Z → Córdoba (UTC-3) = 2026-09-17 12:00, mismo día.
    const ahora = new Date("2026-09-17T15:00:00Z");
    assert.deepEqual(resolverMesRelativo("este_mes", ahora), { anio: 2026, mes: 9 });
    assert.deepEqual(resolverMesRelativo("mes_pasado", ahora), { anio: 2026, mes: 8 });
    assert.deepEqual(resolverMesRelativo("mismo_mes_anio_pasado", ahora), { anio: 2025, mes: 9 });
  }
  console.log("OK — este_mes/mes_pasado/mismo_mes_anio_pasado (caso normal)");

  // ── Cruce de año: enero → "mes pasado" es diciembre del año ANTERIOR ──────────────────────
  {
    const ahoraEnero = new Date("2027-01-05T15:00:00Z"); // Córdoba: 2027-01-05
    assert.deepEqual(resolverMesRelativo("este_mes", ahoraEnero), { anio: 2027, mes: 1 });
    assert.deepEqual(resolverMesRelativo("mes_pasado", ahoraEnero), { anio: 2026, mes: 12 }, "enero → mes pasado es diciembre del año anterior");
    assert.deepEqual(mesAnterior(2027, 1), { anio: 2026, mes: 12 });
  }
  console.log("OK — cruce de enero contra diciembre del año anterior");

  // ── Cruce de año para "año pasado" (mismo mes, año-1), en cualquier mes del calendario ────
  {
    const ahora = new Date("2027-01-05T15:00:00Z");
    assert.deepEqual(resolverMesRelativo("mismo_mes_anio_pasado", ahora), { anio: 2026, mes: 1 });
  }
  console.log("OK — cruce de año para 'año pasado'");

  // ── Zona horaria de Córdoba cerca del cambio de día UTC ───────────────────────────────────
  {
    // 2026-09-17T02:00:00Z → Córdoba (UTC-3) = 2026-09-16 23:00: TODAVÍA 16 de septiembre.
    const cercaMedianoche = new Date("2026-09-17T02:00:00Z");
    assert.equal(hoyCordoba(cercaMedianoche), "2026-09-16", "a las 02:00 UTC, en Córdoba todavía es el día anterior");
    assert.deepEqual(resolverMesRelativo("este_mes", cercaMedianoche), { anio: 2026, mes: 9 });
    assert.deepEqual(ventanaHoy(cercaMedianoche), { desde: "2026-09-16", hasta: "2026-09-16" });
    assert.deepEqual(ventanaAyer(cercaMedianoche), { desde: "2026-09-15", hasta: "2026-09-15" });

    // Una hora más tarde (05:00 UTC = 02:00 Córdoba) ya es el día siguiente en Córdoba.
    const yaAlOtroDia = new Date("2026-09-17T05:00:00Z");
    assert.equal(hoyCordoba(yaAlOtroDia), "2026-09-17");
  }
  console.log("OK — zona horaria de Córdoba cerca del cambio de día UTC (una hora UTC cuyo día todavía es el anterior en Córdoba)");

  // ── hoy / ayer ─────────────────────────────────────────────────────────────────────────
  {
    const ahora = new Date("2026-09-17T15:00:00Z");
    assert.deepEqual(ventanaHoy(ahora), { desde: "2026-09-17", hasta: "2026-09-17" });
    assert.deepEqual(ventanaAyer(ahora), { desde: "2026-09-16", hasta: "2026-09-16" });
    // Ayer cruzando de mes (día 1 → último día del mes anterior).
    const primerDia = new Date("2026-09-01T15:00:00Z");
    assert.deepEqual(ventanaAyer(primerDia), { desde: "2026-08-31", hasta: "2026-08-31" });
  }
  console.log("OK — hoy y ayer");

  // ── esta semana / semana pasada (Lunes a Domingo, Córdoba) ────────────────────────────────
  {
    const ahora = new Date("2026-09-17T15:00:00Z"); // jueves 2026-09-17 en Córdoba
    const esta = ventanaEstaSemana(ahora);
    assert.equal(diaIso(esta.desde), 1, "'esta semana' arranca un lunes");
    assert.equal(esta.hasta, hoyCordoba(ahora), "'esta semana' llega hasta hoy (tramo transcurrido, no la semana completa)");
    const pasada = ventanaSemanaPasada(ahora);
    assert.equal(diaIso(pasada.desde), 1, "'semana pasada' arranca un lunes");
    assert.equal(diaIso(pasada.hasta), 7, "'semana pasada' termina un domingo (semana COMPLETA)");
    const [aEsta, mEsta, dEsta] = esta.desde.split("-").map(Number);
    const unDiaAntes = new Date(Date.UTC(aEsta, mEsta - 1, dEsta - 1)).toISOString().slice(0, 10);
    assert.equal(pasada.hasta, unDiaAntes, "'semana pasada' termina el día inmediato anterior al lunes de 'esta semana'");
  }
  console.log("OK — esta semana y semana pasada (lunes a domingo, Córdoba)");

  // ── este año / año pasado ──────────────────────────────────────────────────────────────
  {
    const ahora = new Date("2026-09-17T15:00:00Z");
    assert.deepEqual(ventanaEsteAnio(ahora), { desde: "2026-01-01", hasta: "2026-09-17" });
    assert.deepEqual(ventanaAnioPasado(ahora), { desde: "2025-01-01", hasta: "2025-12-31" });
  }
  console.log("OK — este año y año pasado");

  console.log("\nOK — periodoRelativo (puro): este_mes/mes_pasado/mismo_mes_anio_pasado con acarreo de año, hoy/ayer, esta semana/semana pasada, este año/año pasado, siempre con reloj inyectado y America/Argentina/Cordoba.");
}
main();

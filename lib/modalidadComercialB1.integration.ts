import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CORTE_MODALIDAD_V2, CORTE_MODALIDAD_V2_MS, leerOverride, modalidadProgramada, modalidadVigente,
} from "@/lib/modalidadComercial";
import { diagnosticoModalidad } from "@/lib/modalidadComercialDiagnostico";

// Integración del Bloque B1 contra la base REAL. SOLO LECTURA: no inserta, no
// actualiza y no borra nada, así que se puede correr contra producción.
// Ejecutar: npx tsx --env-file=.env.local lib/modalidadComercialB1.integration.ts
//
// Comprueba el estado que deja db/modalidad-comercial-b1.sql: el override en
// NULL, las columnas nuevas sin backfill (lo anterior a B1; desde B3 Reservas
// escribe la modalidad de lo nuevo) y los precios de planes versionados. Lo más
// importante: que el instante de los precios nuevos en la base sea EXACTAMENTE
// el corte del código (lib/modalidadComercial.ts), la única fuente.
//
// La conducta del trigger, los checks y la RPC del override (con escrituras) la
// prueba db/modalidad-comercial-b1.verificacion.sql, que revierte todo.

// Instante en que se aplicó db/modalidad-comercial-b1.sql (migración
// 20260929022738). Lo anterior quedó sin backfill para siempre; desde B3 cada
// reserva web NUEVA guarda su modalidad y cada slot v2 su ocupación.
const B1_APLICADA = "2026-09-29T02:27:38Z";

async function contar(tabla: string, columna: string, antesDe?: string): Promise<number> {
  let q = supabaseAdmin
    .from(tabla)
    .select(columna, { count: "exact", head: true })
    .not(columna, "is", null);
  if (antesDe) q = q.lt("created_at", antesDe);
  const { count, error } = await q;
  if (error) throw new Error(`${tabla}.${columna}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  // ── Override: existe, está en NULL y se lee sin error ─────────────────────
  const o = await leerOverride();
  assert.equal(o.errorLectura, false, "el override se lee");
  assert.equal(o.override, null, "el override quedó en NULL: rige el calendario");

  const ahora = new Date();
  const vigente = await modalidadVigente(ahora);
  assert.equal(vigente.override, null);
  assert.equal(vigente.modalidad, modalidadProgramada(ahora), "sin override, la efectiva es la del calendario");

  // ── Columnas nuevas: existen y NADIE rellenó lo anterior (sin backfill) ──
  // Reservas (B3) escribe la modalidad de lo nuevo: se mira solo lo previo a
  // B1. El Turnero todavía no se conectó: ahí no la escribe nadie.
  assert.equal(await contar("reservas", "modalidad", B1_APLICADA), 0, "reservas.modalidad: sin backfill");
  assert.equal(await contar("reserva_slots", "ocupacion_min", B1_APLICADA), 0, "reserva_slots.ocupacion_min: sin backfill");
  assert.equal(await contar("turnos_stand", "modalidad"), 0, "turnos_stand.modalidad: sin backfill");
  assert.equal(await contar("reservas_precios_especiales", "precio_10"), 0, "precio_10: sin overrides cargados");
  assert.equal(await contar("reservas_precios_especiales", "precio_20"), 0, "precio_20: sin overrides cargados");

  // ── Precios de planes versionados ───────────────────────────────────────
  const { data: planes, error: ePlanes } = await supabaseAdmin
    .from("mensualidad_planes")
    .select("id, slug, precio")
    .in("slug", ["1h", "2h", "4h"]);
  assert.ifError(ePlanes);
  const { data: versiones, error: eVers } = await supabaseAdmin
    .from("mensualidad_plan_precios")
    .select("plan_id, precio, vigente_desde");
  assert.ifError(eVers);
  assert.equal(planes?.length, 3);
  assert.equal(versiones?.length, 6, "dos versiones por plan");

  const esperadoNuevo: Record<string, number> = { "1h": 38000, "2h": 70000, "4h": 128000 };
  const esperadoHoy: Record<string, number> = { "1h": 30000, "2h": 55000, "4h": 100000 };
  for (const p of planes ?? []) {
    // B1 no toca lo que se cobra hoy.
    assert.equal(Number(p.precio), esperadoHoy[p.slug], `${p.slug}: mensualidad_planes.precio sin cambios`);
    const propias = (versiones ?? [])
      .filter((v) => v.plan_id === p.id)
      .map((v) => ({ precio: Number(v.precio), desde: Date.parse(String(v.vigente_desde)) }))
      .sort((a, b) => a.desde - b.desde);
    assert.equal(propias.length, 2, `${p.slug}: dos versiones`);
    const [actual, nueva] = propias;
    assert.equal(actual.precio, Number(p.precio), `${p.slug}: la primera versión es el precio de hoy`);
    assert.ok(actual.desde < CORTE_MODALIDAD_V2_MS, `${p.slug}: el precio de hoy rige desde antes del corte`);
    assert.equal(nueva.precio, esperadoNuevo[p.slug], `${p.slug}: precio nuevo aprobado`);
    // El DATO de la base coincide con la FUENTE ÚNICA del código.
    assert.equal(nueva.desde, CORTE_MODALIDAD_V2_MS, `${p.slug}: el precio nuevo rige EXACTAMENTE desde el corte del código`);
  }

  // ── Diagnóstico: mismo resultado que el resolver, sin escribir nada ──────
  const antes = await diagnosticoModalidad({ simularEn: new Date(CORTE_MODALIDAD_V2_MS - 1) });
  assert.equal(antes.simulacion?.modalidad_programada, "legacy");
  assert.equal(antes.simulacion?.modalidad_efectiva, "legacy");
  assert.equal(antes.override.valor, null);
  assert.equal(antes.corte.epoch_ms, CORTE_MODALIDAD_V2_MS);
  assert.equal(antes.corte.literal, CORTE_MODALIDAD_V2);
  // En Buenos Aires el corte es la medianoche del día que dice el literal.
  assert.equal(antes.corte.en_zona, `${CORTE_MODALIDAD_V2.slice(0, 10)} 00:00:00`);
  assert.equal(antes.planes_mensualidad.error, false);
  for (const p of antes.planes_mensualidad.planes.filter((x) => x.slug in esperadoHoy)) {
    assert.equal(p.precio_por_version_simulado, esperadoHoy[p.slug], `${p.slug}: 1 ms antes del corte rige el precio de hoy`);
    assert.equal(p.precio_publico_actual, esperadoHoy[p.slug]);
  }

  const despues = await diagnosticoModalidad({ simularEn: new Date(CORTE_MODALIDAD_V2_MS) });
  assert.equal(despues.simulacion?.modalidad_programada, "v2_10");
  assert.equal(despues.simulacion?.modalidad_efectiva, "v2_10");
  for (const p of despues.planes_mensualidad.planes.filter((x) => x.slug in esperadoNuevo)) {
    assert.equal(p.precio_por_version_simulado, esperadoNuevo[p.slug], `${p.slug}: en el corte rige el precio nuevo`);
    assert.equal(p.precio_publico_actual, esperadoHoy[p.slug], `${p.slug}: lo público sigue cobrando el de hoy (B6)`);
  }
  assert.deepEqual(despues.catalogos.v2_10.duraciones.reserva, [10, 20, 30]);
  assert.deepEqual(despues.catalogos.legacy.duraciones.reserva, [15, 30]);

  // Consultar el diagnóstico no cambió el override.
  assert.equal((await leerOverride()).override, null, "el diagnóstico es de solo lectura");

  console.log(`OK — B1 contra la base: override NULL, sin backfill, 6 versiones de precio y corte = ${new Date(CORTE_MODALIDAD_V2_MS).toISOString()}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

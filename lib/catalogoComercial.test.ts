import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOGOS, CATALOGO_ACTUALIZADO, MODALIDADES, PRODUCTOS_COMERCIALES,
  bufferMinutos, catalogoDe, catalogoVistoVigente, duracionPermitida, duracionesPermitidas,
  esModalidad, ocupacionMinutos, pasoAgendaMin, precioBaseReserva, productoGiftCard,
  productosGiftCard, turnosComerciales, type Modalidad, type TipoDia,
} from "@/lib/catalogoComercial";
// Las fuentes legacy de HOY. El catálogo tiene que decir exactamente lo mismo.
import {
  DURACIONES_CONOCIDAS, DURACIONES_POR_PRODUCTO, PASO_AGENDA_MIN, bloquesPara, esFinDeSemana, sumarDias,
} from "@/lib/agenda";
import {
  DURACIONES_VALIDAS, PRECIO_15, PRECIO_30_FINDE, PRECIO_30_SEMANA, precioPorSimulador,
} from "@/lib/reservasSlots";
import { productosGiftCardDe } from "@/lib/giftCards";
import { DURACIONES_MENSUALIDAD } from "@/lib/mensualidades";
import { MINUTOS_POR_TURNO as TURNO_STAND } from "@/lib/metricasStand";
import { MINUTOS_POR_TURNO as TURNO_EQUIPO } from "@/lib/metricasEquipo";

// Catálogo comercial versionado (Bloque B0).
// Ejecutar: npx tsx --env-file=.env.local lib/catalogoComercial.test.ts
//
// Test 7: el catálogo legacy es EXACTAMENTE la operación de hoy. Se compara
// contra los módulos que hoy la definen, no contra números copiados: si alguien
// cambia un precio en lib/reservasSlots.ts sin tocar el catálogo, esto falla.
// Test 8: el catálogo v2_10 tiene 10/20/30 y los precios aprobados.

const tipoDia = (fecha: string): TipoDia => (esFinDeSemana(fecha) ? "finde" : "semana");

// ── 7) LEGACY = operación actual ────────────────────────────────────────────
{
  const L = CATALOGOS.legacy;
  assert.equal(L.modalidad, "legacy");

  // Duraciones por producto.
  assert.deepEqual([...L.duraciones.reserva], [...DURACIONES_POR_PRODUCTO.reserva], "7 · Reservas: las de lib/agenda.ts");
  assert.deepEqual([...L.duraciones.reserva], [...DURACIONES_VALIDAS], "7 · Reservas: las de lib/reservasSlots.ts");
  assert.deepEqual([...L.duraciones.reserva], [15, 30]);
  assert.deepEqual([...L.duraciones.mensualidad], [...DURACIONES_POR_PRODUCTO.mensualidad], "7 · Mensualidades: las de lib/agenda.ts");
  assert.deepEqual([...L.duraciones.mensualidad], [...DURACIONES_MENSUALIDAD], "7 · Mensualidades: las de lib/mensualidades.ts");
  assert.deepEqual([...L.duraciones.mensualidad], [15, 30, 45, 60]);

  // Gift Cards: (B5) lib/giftCards.ts ya no tiene una lista propia, deriva de
  // este catálogo. Legacy sigue siendo EXACTAMENTE lo de siempre: productos,
  // montos y textos.
  assert.deepEqual(L.giftCards.map((p) => [p.duracion, p.monto]), [[15, 12000], [30, 20000]]);
  assert.deepEqual([...L.duraciones.gift_card], L.giftCards.map((p) => p.duracion));
  assert.deepEqual(productosGiftCardDe("legacy"), [
    { duracion: 15, monto: 12000, titulo: "Gift Card · 15 min", descripcion: "Una sesión de simulador de Fórmula 1 de 15 minutos." },
    { duracion: 30, monto: 20000, titulo: "Gift Card · 30 min", descripcion: "Una sesión doble de 30 minutos (dos turnos consecutivos)." },
  ], "7 · Gift Cards legacy: los productos y textos de siempre");

  // Precios de Reserva: constantes y fórmula (semana/finde) sobre cuatro meses.
  assert.equal(PRECIO_15, 12000);
  assert.equal(PRECIO_30_SEMANA, 18000);
  assert.equal(PRECIO_30_FINDE, 20000);
  assert.equal(precioBaseReserva("legacy", 15, "semana"), PRECIO_15);
  assert.equal(precioBaseReserva("legacy", 15, "finde"), PRECIO_15);
  assert.equal(precioBaseReserva("legacy", 30, "semana"), PRECIO_30_SEMANA);
  assert.equal(precioBaseReserva("legacy", 30, "finde"), PRECIO_30_FINDE);
  let dias = 0;
  for (let f = "2026-09-01"; f <= "2026-12-31"; f = sumarDias(f, 1)) {
    for (const d of [15, 30]) {
      assert.equal(precioBaseReserva("legacy", d, tipoDia(f)), precioPorSimulador(f, d), `7 · precio ${f} ${d} min`);
    }
    dias++;
  }
  assert.equal(dias, 122, "se recorrieron los 122 días de sep–dic");

  // Grilla y ocupación: 15→20, 30→40, 45→60, 60→80, igual que bloquesPara × 20.
  assert.equal(pasoAgendaMin("legacy"), PASO_AGENDA_MIN);
  assert.equal(PASO_AGENDA_MIN, 20);
  assert.deepEqual(DURACIONES_CONOCIDAS.map((d) => ocupacionMinutos("legacy", d)), [20, 40, 60, 80]);
  assert.deepEqual(DURACIONES_CONOCIDAS.map((d) => bufferMinutos("legacy", d)), [5, 10, 15, 20], "buffer implícito");
  // Equivalencia con bloquesPara sobre entradas normales y manipuladas.
  const entradas: unknown[] = [
    0, 5, 10, 14, 15, 16, 20, 25, 29, 30, 31, 44, 45, 46, 59, 60, 61, 75, 90, 120, -15, 15.5, 30.0001,
    "15", "30", "030", " 30 ", "30abc", "0x1E", "", null, undefined, true, false, NaN, Infinity, 1e21, {},
  ];
  for (const x of entradas) {
    const b = bloquesPara(x);
    assert.equal(ocupacionMinutos("legacy", x), b === null ? null : b * PASO_AGENDA_MIN,
      `7 · ocupación legacy de ${JSON.stringify(x)} igual a bloquesPara × 20`);
  }
  // Única diferencia DELIBERADA de lectura de entrada (no de regla comercial):
  // bloquesPara pasa todo por Number(), así que un array [30] cuenta como 30.
  // El catálogo no acepta un array como duración.
  assert.equal(bloquesPara([30]), 2);
  assert.equal(ocupacionMinutos("legacy", [30]), null);

  // Unidad de turno: la misma de Métricas Stand y de Equipo.
  assert.equal(L.minutosPorTurno, TURNO_STAND);
  assert.equal(L.minutosPorTurno, TURNO_EQUIPO);
  assert.equal(turnosComerciales("legacy", 15, 1), 1);
  assert.equal(turnosComerciales("legacy", 30, 1), 2);
  assert.equal(turnosComerciales("legacy", 30, 4), 8, "4 personas × 30 min = 8 turnos (canon de metricasStand)");
}

// ── 8) V2_10 ────────────────────────────────────────────────────────────────
{
  const V = CATALOGOS.v2_10;
  assert.equal(V.modalidad, "v2_10");
  for (const p of PRODUCTOS_COMERCIALES) {
    assert.deepEqual([...duracionesPermitidas("v2_10", p)], [10, 20, 30], `8 · ${p}: 10/20/30`);
  }
  // Mismo precio los siete días.
  for (const [d, precio] of [[10, 10000], [20, 17000], [30, 23000]] as const) {
    assert.equal(precioBaseReserva("v2_10", d, "semana"), precio, `8 · ${d} min de semana`);
    assert.equal(precioBaseReserva("v2_10", d, "finde"), precio, `8 · ${d} min de finde: sin diferencia`);
  }
  // El catálogo no conoce fechas: el rango solo cubre semanas y findes.
  for (let f = "2026-09-28"; f <= "2026-11-01"; f = sumarDias(f, 1)) {
    assert.equal(precioBaseReserva("v2_10", 30, tipoDia(f)), 23000, `8 · ${f} 30 min = 23.000 cualquier día`);
  }
  assert.deepEqual(productosGiftCard("v2_10").map((p) => [p.duracion, p.monto]), [[10, 10000], [20, 17000], [30, 23000]]);

  // Grilla de 10 y buffer de 10: 10→20, 20→30, 30→40.
  assert.equal(pasoAgendaMin("v2_10"), 10);
  assert.deepEqual([10, 20, 30].map((d) => ocupacionMinutos("v2_10", d)), [20, 30, 40]);
  assert.deepEqual([10, 20, 30].map((d) => bufferMinutos("v2_10", d)), [10, 10, 10]);
  // La ocupación v2 no exige que la duración se VENDA: Empresa legacy 15 → 25.
  assert.equal(ocupacionMinutos("v2_10", 15), 25);
  assert.equal(ocupacionMinutos("v2_10", 7), null, "no múltiplo de 5");
  assert.equal(ocupacionMinutos("v2_10", 245), null, "más de 4 h");
  assert.equal(ocupacionMinutos("v2_10", 0), null);
  assert.equal(ocupacionMinutos("v2_10", "20"), 30);
  assert.equal(ocupacionMinutos("v2_10", " 20"), null);

  // Turnero v2: bloques comerciales de 10 minutos por persona.
  assert.equal(V.minutosPorTurno, 10);
  assert.equal(turnosComerciales("v2_10", 10, 1), 1);
  assert.equal(turnosComerciales("v2_10", 20, 1), 2);
  assert.equal(turnosComerciales("v2_10", 30, 1), 3);
  assert.equal(turnosComerciales("v2_10", 30, 2), 6);
  assert.equal(turnosComerciales("v2_10", 15, 1), 1.5, "una Gift Card legacy de 15 en v2: B8 decide el redondeo");
  assert.equal(turnosComerciales("v2_10", 0, 1), null);
  assert.equal(turnosComerciales("v2_10", 10, 0), null);
}

// ── Las dos modalidades no se mezclan ───────────────────────────────────────
{
  assert.equal(duracionPermitida("legacy", "reserva", 10), false);
  assert.equal(duracionPermitida("legacy", "reserva", 20), false);
  assert.equal(duracionPermitida("v2_10", "reserva", 15), false);
  assert.equal(duracionPermitida("legacy", "mensualidad", 45), true);
  assert.equal(duracionPermitida("v2_10", "mensualidad", 45), false);
  assert.equal(duracionPermitida("v2_10", "gift_card", 15), false);
  assert.equal(precioBaseReserva("v2_10", 15, "semana"), null);
  assert.equal(precioBaseReserva("legacy", 20, "semana"), null);
  assert.equal(precioBaseReserva("legacy", 45, "semana"), null, "45 no se vende como Reserva");
  assert.equal(productoGiftCard("legacy", 15)?.monto, 12000);
  assert.equal(productoGiftCard("v2_10", 15), null);
  assert.equal(productoGiftCard("legacy", 10), null);
  assert.equal(productoGiftCard("v2_10", "20")?.monto, 17000);
  assert.equal(productoGiftCard("v2_10", "20 "), null);
  assert.equal(precioBaseReserva("v2_10", 10, "feriado" as never), null, "tipo de día desconocido");
}

// ── Coherencia interna de cada catálogo ────────────────────────────────────
for (const m of MODALIDADES) {
  const c = catalogoDe(m);
  const conPrecio = Object.keys(c.preciosReserva).map(Number).sort((a, b) => a - b);
  assert.deepEqual(conPrecio, [...c.duraciones.reserva], `${m}: cada duración de Reserva tiene precio y viceversa`);
  assert.deepEqual(c.giftCards.map((p) => p.duracion), [...c.duraciones.gift_card], `${m}: Gift Cards = sus duraciones`);
  for (const d of new Set(PRODUCTOS_COMERCIALES.flatMap((p) => [...c.duraciones[p]]))) {
    assert.ok((ocupacionMinutos(m, d) ?? 0) > d, `${m}: toda duración vendible tiene ocupación mayor a la comercial`);
  }
}

// ── Modalidades cerradas, catálogos inmutables ──────────────────────────────
{
  assert.deepEqual([...MODALIDADES], ["legacy", "v2_10"]);
  assert.equal(esModalidad("legacy"), true);
  assert.equal(esModalidad("v2_10"), true);
  for (const x of ["V2_10", " legacy", "v2", "", null, undefined, 10, {}]) {
    assert.equal(esModalidad(x), false, `${JSON.stringify(x)} no es una modalidad`);
  }
  assert.throws(() => catalogoDe("v3" as Modalidad), /desconocida/);
  assert.ok(Object.isFrozen(CATALOGOS));
  assert.ok(Object.isFrozen(CATALOGOS.legacy.duraciones.reserva));
  assert.ok(Object.isFrozen(CATALOGOS.v2_10.preciosReserva[30]));
  assert.throws(() => { (CATALOGOS.legacy.duraciones.reserva as number[]).push(45); });
  assert.throws(() => { (CATALOGOS.v2_10.preciosReserva[30] as { semana: number }).semana = 1; });
  assert.throws(() => { (CATALOGOS as Record<string, unknown>).v2_10 = null; });
}

// ── 409 catalogo_actualizado (contrato para los bloques que venden) ────────
{
  assert.equal(CATALOGO_ACTUALIZADO.codigo, "catalogo_actualizado");
  assert.equal(CATALOGO_ACTUALIZADO.status, 409);
  assert.equal(CATALOGO_ACTUALIZADO.mensaje,
    "Actualizamos nuestros turnos y precios. Revisá las nuevas opciones para continuar.");
  assert.equal(catalogoVistoVigente("legacy", "legacy"), true);
  assert.equal(catalogoVistoVigente("v2_10", "v2_10"), true);
  assert.equal(catalogoVistoVigente("legacy", "v2_10"), false, "vio legacy y rige v2: 409");
  assert.equal(catalogoVistoVigente(undefined, "legacy"), false, "sin dato = desactualizado");
  assert.equal(catalogoVistoVigente("LEGACY", "legacy"), false);
}

// ── Pureza: lo puede importar el navegador ──────────────────────────────────
{
  const src = readFileSync(join(process.cwd(), "lib/catalogoComercial.ts"), "utf8");
  assert.ok(!/^\s*import\s/m.test(src), "catalogoComercial no importa nada");
  for (const prohibido of ["process.env", "Date.now", "new Date(", "fetch(", "supabase", "require("]) {
    assert.ok(!src.includes(prohibido), `catalogoComercial no usa ${prohibido}`);
  }
}

console.log("OK — catalogoComercial: legacy idéntico a la operación actual; v2_10 10/20/30 a 10.000/17.000/23.000.");

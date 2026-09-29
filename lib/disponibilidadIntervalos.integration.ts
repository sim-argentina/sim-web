import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PENDIENTE_TTL_MIN, simuladoresLibresDelDia } from "@/lib/disponibilidad";
import { esFinDeSemana, fechasPublicas, hoyEnSim, type Producto } from "@/lib/agenda";
import { getOccupiedSlots } from "@/lib/reservasSlots";
import { duracionesPermitidas, type Modalidad, type ProductoComercial } from "@/lib/catalogoComercial";
import { horaDeMinutos, minutosDeHora } from "@/lib/agendaIntervalos";
import { RECURSOS_AGENDA, horariosConLibres } from "@/lib/disponibilidadIntervalos";
import { cargarFuentesAgenda, disponibilidadDesdeFuentes, type FuentesAgenda } from "@/lib/disponibilidadIntervalosServer";
import { barrido, sqlMotorVsTrigger } from "@/lib/disponibilidadIntervalosTrigger";

// Integración del motor por intervalos (Bloque B2) contra la base REAL.
// SOLO LECTURA: no inserta, no actualiza y no borra nada.
// Ejecutar: npx tsx --env-file=.env.local lib/disponibilidadIntervalos.integration.ts
//   B2_SQL_REAL=<archivo>  además escribe el contraste motor vs trigger del día
//                          de las reservas reales (se corre aparte, revertido).
//
// 1. Equivalencia legacy en la ventana pública: el motor ACTUAL y el nuevo en
//    modo legacy, fecha por fecha, duración por duración, simulador por simulador.
// 2. Consistencia de los datos: los slots de cada reserva activa son los que
//    el motor actual deduce de sus datos (si no, habría diferencias de clase D1).
// 3. El día con reservas legacy reales: v2 contra un cálculo independiente.
// 4. Consultas y tiempos.

const DIA_REAL = "2026-10-03";   // las reservas legacy reales de 30 min a las 13:00

let consultas = 0;
const cliente = supabaseAdmin as unknown as Record<string, unknown>;
const fromOrig = cliente.from as (...a: unknown[]) => unknown;
cliente.from = (...a: unknown[]) => { consultas++; return fromOrig.apply(supabaseAdmin, a); };

const PRODUCTOS_LEGACY: Array<[ProductoComercial, Producto]> = [["reserva", "reserva"], ["mensualidad", "mensualidad"]];

async function equivalencia(fuentes: FuentesAgenda, fechas: string[]) {
  const difs: string[] = [];
  let comparaciones = 0;
  consultas = 0;
  for (const fecha of fechas) {
    for (const [producto, deAgenda] of PRODUCTOS_LEGACY) {
      for (const d of duracionesPermitidas("legacy", producto)) {
        const actual = await simuladoresLibresDelDia({ fecha, duracion: d, producto: deAgenda });
        assert.ok(actual.ok, `motor actual ${fecha} ${producto} ${d}`);
        const a = new Map(actual.horarios.map((h) => [h.hora, h.simuladores]));
        const nuevo = disponibilidadDesdeFuentes(fuentes, { modalidad: "legacy", producto, fecha, duracion: d, ahora: new Date() });
        const n = new Map(horariosConLibres(nuevo.disponibilidad).map((h) => [h.hora, h.libres]));
        for (const hora of new Set([...a.keys(), ...n.keys()])) {
          for (const sim of RECURSOS_AGENDA) {
            comparaciones++;
            const libreA = a.get(hora)?.includes(sim) ?? false;
            const libreN = n.get(hora)?.includes(sim) ?? false;
            if (libreA !== libreN) difs.push(`${fecha} ${producto} ${d} ${hora} ${sim}: actual ${libreA ? "libre" : "ocupado"}, nuevo ${libreN ? "libre" : "ocupado"}`);
          }
        }
      }
    }
  }
  return { difs, comparaciones, consultasActual: consultas };
}

async function main() {
  const hoy = hoyEnSim();
  const fechas = fechasPublicas(hoy);

  // ── 4 · Carga única + cálculo en memoria ──────────────────────────────────
  consultas = 0;
  const t0 = performance.now();
  let fuentes = await cargarFuentesAgenda(fechas[0], fechas[fechas.length - 1]);
  const tCarga = performance.now() - t0;
  const consultasNuevo = consultas;
  assert.equal(fuentes.consultas, consultasNuevo);

  const t1 = performance.now();
  let inicios = 0;
  for (const fecha of fechas) {
    for (const modalidad of ["legacy", "v2_10"] as Modalidad[]) {
      for (const producto of ["reserva", "mensualidad", "gift_card"] as ProductoComercial[]) {
        for (const d of duracionesPermitidas(modalidad, producto)) {
          inicios += disponibilidadDesdeFuentes(fuentes, { modalidad, producto, fecha, duracion: d, ahora: new Date() })
            .disponibilidad.horarios.length;
        }
      }
    }
  }
  const tCalculo = performance.now() - t1;

  // ── 1 · Equivalencia legacy en la ventana pública ─────────────────────────
  let eq = await equivalencia(fuentes, fechas);
  if (eq.difs.length) {
    // Entre las dos lecturas pudo entrar una reserva real: se relee una vez.
    fuentes = await cargarFuentesAgenda(fechas[0], fechas[fechas.length - 1]);
    eq = await equivalencia(fuentes, fechas);
  }

  // ── 2 · Consistencia: slots de cada reserva activa vs. lo que deduce el motor actual ─
  const inconsistentes: string[] = [];
  for (const r of fuentes.reservas.filter((x) => x.estado === "activa")) {
    const sims = Array.isArray(r.simuladores) ? r.simuladores.map(String) : [];
    const deducidos = new Set(sims.flatMap((s) => getOccupiedSlots(r.fecha, r.hora, Number(r.duracion_minutos) || 15).map((b) => `${b}|${s}`)));
    const reales = new Set(fuentes.slots.filter((s) => String(s.reserva_id) === String(r.id)).map((s) => `${s.hora}|${s.simulador}`));
    const iguales = deducidos.size === reales.size && [...deducidos].every((k) => reales.has(k));
    if (!iguales) inconsistentes.push(`#${r.id} ${r.fecha} ${r.hora}`);
  }
  const huerfanos = fuentes.slots.filter((s) => !fuentes.reservas.some((r) => String(r.id) === String(s.reserva_id) && r.estado === "activa"));

  // ── 3 · El día de las reservas legacy reales ──────────────────────────────
  const ahora = new Date();
  const slotsDia = fuentes.slots.filter((s) => s.fecha === DIA_REAL);
  const pendientesDia = fuentes.reservas.filter((r) => r.fecha === DIA_REAL && r.estado === "pendiente_pago"
    && r.created_at && Date.parse(r.created_at) > ahora.getTime() - PENDIENTE_TTL_MIN * 60_000);
  // Cálculo INDEPENDIENTE, escrito de nuevo acá: un recurso está tomado si
  // alguna de sus filas activas —legacy 20 minutos, v2 su ocupación— o una
  // pendiente vigente (sus bloques de 20) comparte algún minuto con el turno.
  const tomado = (sim: string, desde: number, hasta: number) => {
    const filas = slotsDia.filter((s) => s.simulador === sim).map((s) => {
      const m = minutosDeHora(s.hora)!;
      return [m, m + (s.ocupacion_min ?? 20)];
    });
    const pend = pendientesDia.filter((r) => Array.isArray(r.simuladores) && r.simuladores.map(String).includes(sim))
      .flatMap((r) => getOccupiedSlots(DIA_REAL, r.hora, Number(r.duracion_minutos) || 15).map((b) => [minutosDeHora(b)!, minutosDeHora(b)! + 20]));
    return [...filas, ...pend].some(([a, b]) => a < hasta && desde < b);
  };
  const bloqueosDia = fuentes.bloqueos.filter((b) => b.fecha === DIA_REAL);
  const tabla: string[] = [];
  for (const d of duracionesPermitidas("v2_10", "reserva")) {
    const r = disponibilidadDesdeFuentes(fuentes, { modalidad: "v2_10", producto: "reserva", fecha: DIA_REAL, duracion: d, ahora });
    for (const h of r.disponibilidad.horarios) {
      if (bloqueosDia.length === 0) {
        const esperados = RECURSOS_AGENDA.filter((s) => !tomado(s, h.turno.inicio, h.turno.finOcupacion));
        assert.deepEqual(h.libres, esperados, `v2 ${d} a las ${h.hora} en ${DIA_REAL}`);
      }
      if (h.turno.inicio >= 12 * 60 && h.turno.inicio <= 14 * 60) {
        tabla.push(`v2 ${d} ${h.hora}–${horaDeMinutos(h.turno.finOcupacion)}: ${h.libres.length} libres${h.libres.length < 4 ? ` (${RECURSOS_AGENDA.filter((s) => !h.libres.includes(s)).join(", ")} tomados)` : ""}`);
      }
    }
  }
  const legacyDia = slotsDia.filter((s) => s.ocupacion_min === null).map((s) => `${s.hora} ${s.simulador}`);

  // ── Contraste motor vs trigger con los datos reales de ese día ────────────
  const salida = process.env.B2_SQL_REAL;
  let casosTrigger = 0;
  if (salida) {
    const v2 = barrido({ modalidad: "v2_10", producto: "reserva", fecha: DIA_REAL, desde: "12:00", hasta: "14:00", duraciones: duracionesPermitidas("v2_10", "reserva") });
    const leg = barrido({ modalidad: "legacy", producto: "reserva", fecha: DIA_REAL, desde: "12:00", hasta: "14:00", duraciones: duracionesPermitidas("legacy", "reserva") });
    const escenario = {
      codigo: "R1", fecha: DIA_REAL, reservaId: -960010, base: [], bloqueos: [],
      existentes: { slots: slotsDia, bloqueos: bloqueosDia }, candidatos: [...v2, ...leg],
    };
    casosTrigger = escenario.candidatos.length;
    writeFileSync(salida, sqlMotorVsTrigger([escenario], {
      titulo: `B2 · motor vs trigger B1 sobre las reservas REALES del ${DIA_REAL} (generado ${ahora.toISOString()})`, ahora,
    }));
  }

  // ── Informe ───────────────────────────────────────────────────────────────
  console.log(`ventana pública ${fechas[0]} … ${fechas[fechas.length - 1]} (${fechas.length} días, ${fechas.filter(esFinDeSemana).length} de fin de semana)`);
  console.log(`fuentes: ${fuentes.reservas.length} reservas activas/pendientes, ${fuentes.slots.length} slots activos, ${fuentes.bloqueos.length} bloqueos habilitados`);
  console.log(`motor nuevo: ${consultasNuevo} consultas para toda la ventana (${tCarga.toFixed(0)} ms), cálculo en memoria de ${inicios} inicios en ${tCalculo.toFixed(1)} ms (legacy + v2, 3 productos, todas las duraciones)`);
  console.log(`motor actual: ${eq.consultasActual} consultas para la misma ventana legacy (2 por día y duración)`);
  console.log(`equivalencia legacy: ${eq.comparaciones} comparaciones, ${eq.difs.length} diferencias`);
  for (const x of eq.difs.slice(0, 20)) console.log(`  ${x}`);
  console.log(`consistencia: ${inconsistentes.length} reservas activas cuyos slots no son los que deduce el motor actual; ${huerfanos.length} slots activos sin reserva activa`);
  console.log(`${DIA_REAL}: slots legacy ${legacyDia.join(", ") || "ninguno"}; pendientes vigentes ${pendientesDia.length}; bloqueos ${bloqueosDia.length}`);
  for (const l of tabla) console.log(`  ${l}`);
  if (salida) console.log(`motor vs trigger (${DIA_REAL}): ${casosTrigger} casos → ${salida}`);

  assert.deepEqual(eq.difs, [], "motor nuevo en legacy === motor actual sobre los datos reales");
  assert.deepEqual(inconsistentes, [], "los slots reales son exactamente los que deduce el motor actual");
  assert.equal(huerfanos.length, 0);
  console.log("OK — disponibilidadIntervalos (real, solo lectura): equivalencia legacy exacta en la ventana pública.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => { cliente.from = fromOrig; });

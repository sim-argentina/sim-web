import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { simuladoresLibresDelDia } from "@/lib/disponibilidad";
import { fechasPublicas, horariosDe } from "@/lib/agenda";
import { CORTE_MODALIDAD_V2_MS, modalidadVigente } from "@/lib/modalidadComercial";
import { getPreciosEfectivos } from "@/lib/reservasPricing";
import { cargarFuentesAgenda } from "@/lib/disponibilidadIntervalosServer";
import { catalogoReservasVigente, disponibilidadReservas, evaluarTurno } from "@/lib/reservasComercial";

// Integración de Reservas web (Bloque B3) contra la base REAL.
// SOLO LECTURA: no inserta, no actualiza y no borra nada (se vigila abajo).
// Ejecutar: npx tsx --env-file=.env.local lib/reservasComercial.integration.ts
//
// 1. Antes del corte, lo que ahora sirve /api/reservas/disponibilidad es lo que
//    servía el motor actual: fecha por fecha de la ventana, 15 y 30, horario por
//    horario, simulador por simulador. Y los precios, los mismos.
// 2. Lo que se MUESTRA y lo que el POST ACEPTA salen del mismo cálculo.
// 3. El 03/10 (reservas legacy reales #3033/#3034, 30 min a las 13:00): igual
//    que hoy antes del corte; con el reloj inyectado después del corte, v2 las
//    ve como [13:00, 13:40) sin tocarlas.

const DIA_REAL = "2026-10-03";

// Vigilancia: cualquier intento de escribir aborta el test.
const cliente = supabaseAdmin as unknown as Record<string, unknown>;
const fromOrig = cliente.from as (t: string) => Record<string, unknown>;
let consultas = 0;
cliente.from = (t: string) => {
  consultas++;
  const q = fromOrig.call(supabaseAdmin, t);
  for (const escritura of ["insert", "update", "upsert", "delete"]) {
    q[escritura] = () => { throw new Error(`solo lectura: ${escritura} sobre ${t}`); };
  }
  return q;
};
cliente.rpc = () => { throw new Error("solo lectura: rpc"); };

const clave = (libres: readonly string[]) => [...libres].sort().join(",");

async function main() {
  const ahora = new Date();
  const vigente = await modalidadVigente(ahora);
  assert.equal(vigente.override, null, "el override de producción sigue en NULL");
  assert.equal(vigente.modalidad, "legacy", "este test se corre ANTES del corte");

  const catalogo = await catalogoReservasVigente(ahora);
  assert.equal(catalogo.modalidad, "legacy");
  assert.deepEqual(catalogo.ventana, fechasPublicas(), "la ventana es la de siempre");

  // ── 1. Equivalencia legacy en toda la ventana ─────────────────────────────
  let comparaciones = 0;
  const difs: string[] = [];
  for (const fecha of catalogo.ventana) {
    const precios = await getPreciosEfectivos(fecha);
    for (const duracion of [15, 30]) {
      const nuevo = await disponibilidadReservas({ fecha, duracion, ahora });
      assert.ok(nuevo.ok, `${fecha} ${duracion}: ${JSON.stringify(nuevo)}`);
      assert.equal(nuevo.data.modalidad, "legacy");
      assert.deepEqual(nuevo.data.grilla, horariosDe(fecha), `${fecha}: grilla`);
      assert.equal(nuevo.data.precio, duracion === 15 ? precios.precio_15 : precios.precio_30, `${fecha} ${duracion}: precio`);

      const actual = await simuladoresLibresDelDia({ fecha, duracion, producto: "reserva" });
      assert.ok(actual.ok);
      const a = new Map(actual.horarios.map((h) => [h.hora, clave(h.simuladores)]));
      const n = new Map(nuevo.data.horarios.map((h) => [h.hora, clave(h.libres)]));
      for (const hora of new Set([...a.keys(), ...n.keys()])) {
        comparaciones++;
        if ((a.get(hora) ?? "") !== (n.get(hora) ?? "")) {
          difs.push(`${fecha} ${hora} ${duracion}: actual [${a.get(hora) ?? ""}] nuevo [${n.get(hora) ?? ""}]`);
        }
      }
    }
  }
  assert.deepEqual(difs, [], "antes del corte, /reservas muestra lo mismo que el motor actual");

  // ── 2. Lo que se muestra = lo que el POST acepta (03/10 y el primer día) ──
  let coherencia = 0;
  for (const fecha of [DIA_REAL, catalogo.ventana[0]]) {
    const fuentes = await cargarFuentesAgenda(fecha, fecha);
    for (const duracion of [15, 30]) {
      const d = await disponibilidadReservas({ fecha, duracion, ahora });
      assert.ok(d.ok);
      for (const h of d.data.horarios) {
        for (const sim of ["Ferrari", "McLaren", "Red Bull", "Alpine"]) {
          const v = await evaluarTurno(
            { modalidad: "legacy", fecha, hora: h.hora, duracion, simuladores: [sim], ahora }, fuentes,
          );
          assert.equal(v.ocupado === null && !v.bloqueado, h.libres.includes(sim), `${fecha} ${h.hora} ${duracion} ${sim}`);
          coherencia++;
        }
      }
    }
  }

  // ── 3. El 03/10: reservas reales intactas, legacy hoy, v2 simulado ────────
  const { data: reales, error } = await supabaseAdmin
    .from("reservas")
    .select("id, fecha, hora, duracion_minutos, simuladores, estado, modalidad")
    .in("id", [3033, 3034]);
  assert.ifError(error);
  const { data: slotsReales, error: eSlots } = await supabaseAdmin
    .from("reserva_slots")
    .select("reserva_id, hora, simulador, estado, ocupacion_min")
    .in("reserva_id", [3033, 3034]);
  assert.ifError(eSlots);
  const activas = (reales ?? []).filter((r) => r.estado === "activa");
  const ocupados = new Set(activas.flatMap((r) => (r.simuladores as string[]).map(String)));
  console.log("reservas reales del 03/10:", JSON.stringify(reales));
  console.log("sus slots:", JSON.stringify((slotsReales ?? []).map((s) => `${s.reserva_id} ${s.hora} ${s.simulador} ${s.estado} ${s.ocupacion_min ?? "-"}`)));
  for (const r of activas) {
    assert.equal(r.modalidad, null, "siguen sin modalidad (= legacy): nadie las tocó");
    assert.equal(r.hora, "13:00");
    assert.equal(r.duracion_minutos, 30);
  }
  assert.ok((slotsReales ?? []).every((s) => s.ocupacion_min === null), "slots legacy, sin ocupacion_min");

  const tabla = async (duracion: number, instante: Date) => {
    const d = await disponibilidadReservas({ fecha: DIA_REAL, duracion, ahora: instante });
    assert.ok(d.ok);
    return d.data;
  };
  // Antes del corte (hoy): lo de siempre.
  for (const duracion of [15, 30]) {
    const d = await tabla(duracion, ahora);
    const fila = d.horarios.map((h) => `${h.hora}:${h.disponibles}`).join(" ");
    console.log(`03/10 legacy ${duracion} min (${d.precio}):`, fila);
    if (ocupados.size > 0) {
      const tapados = duracion === 15 ? ["13:00", "13:20"] : ["12:40", "13:00", "13:20"];
      for (const h of d.horarios) {
        const esperado = tapados.includes(h.hora) ? 4 - ocupados.size : 4;
        assert.equal(h.disponibles, esperado, `legacy ${duracion} ${h.hora}`);
      }
    }
  }
  // Después del corte (reloj inyectado, override NULL): v2.
  const DESPUES = new Date(CORTE_MODALIDAD_V2_MS + 60 * 60_000);
  for (const duracion of [10, 20, 30]) {
    const d = await tabla(duracion, DESPUES);
    assert.equal(d.modalidad, "v2_10");
    const fila = d.horarios.map((h) => `${h.hora}:${h.disponibles}`).join(" ");
    console.log(`03/10 v2 ${duracion} min (${d.precio}):`, fila);
    assert.equal(d.horarios[d.horarios.length - 1].hora, "14:00", "finde: último inicio 14:00");
    if (ocupados.size > 0) {
      // Ocupación v2 [inicio, inicio + duración + 10) contra [13:00, 13:40).
      for (const h of d.horarios) {
        const [hh, mm] = h.hora.split(":").map(Number);
        const ini = hh * 60 + mm;
        const toca = ini < 13 * 60 + 40 && 13 * 60 < ini + duracion + 10;
        assert.equal(h.disponibles, toca ? 4 - ocupados.size : 4, `v2 ${duracion} ${h.hora}`);
      }
    }
  }

  console.log(`OK — B3 contra la base real (solo lectura): ${comparaciones} comparaciones legacy sin diferencias, ${coherencia} verificaciones mostrar = aceptar, 03/10 legacy/v2 correcto; ${consultas} consultas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

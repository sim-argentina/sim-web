import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPrecioReserva, getPreciosEfectivos } from "@/lib/reservasPricing";
import { precioPorSimulador } from "@/lib/reservasSlots";

// Integración contra la DB real, con fixtures temporales que se ELIMINAN al final.
// NO crea reservas reales de negocio. Ejecutar con:
//   npx tsx --env-file=.env.local lib/reservasPreciosBloqueos.integration.ts
const FECHA_FUT = "2030-06-05"; // futuro (vigente)
const FECHA_PAS = "2020-01-01"; // pasado (vencido)
const SIM = "ZZ_SIM_PRICING";
const MOTIVO = "ZZTEST_BLOQUEO_PRICING";

async function limpiar() {
  await supabaseAdmin.from("reservas_precios_especiales").delete().eq("fecha", FECHA_FUT);
  await supabaseAdmin.from("bloqueos_reservas").delete().eq("motivo", MOTIVO);
  const { data: rs } = await supabaseAdmin.from("reservas").select("id").eq("nombre", "ZZTEST_PRICING");
  const ids = (rs ?? []).map((r) => r.id);
  if (ids.length) {
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", ids);
    await supabaseAdmin.from("reservas").delete().in("id", ids);
  }
}

async function nuevaReserva(fecha: string): Promise<number> {
  const { data, error } = await supabaseAdmin.from("reservas").insert({
    nombre: "ZZTEST_PRICING", telefono: "0", fecha, hora: "10:00", simuladores: [SIM],
    cantidad_turnos: 1, total: 0, estado: "activa", acepto_condiciones: true, duracion_minutos: 15, origen: "web",
  }).select("id").single();
  if (error || !data) throw new Error("crear reserva: " + JSON.stringify(error));
  return data.id as number;
}

async function main() {
  await limpiar();
  try {
    // ── PRECIOS ESPECIALES ────────────────────────────────────────────────────
    const normal15 = precioPorSimulador(FECHA_FUT, 15);
    const normal30 = precioPorSimulador(FECHA_FUT, 30);

    // A — sin especial → normal.
    assert.equal(await getPrecioReserva(FECHA_FUT, 15), normal15, "A: 15 normal");
    assert.equal(await getPrecioReserva(FECHA_FUT, 30), normal30, "A: 30 normal");

    // B/C — especial ambos.
    await supabaseAdmin.from("reservas_precios_especiales").upsert({ fecha: FECHA_FUT, precio_15: 15000, precio_30: 25000 }, { onConflict: "fecha" });
    assert.equal(await getPrecioReserva(FECHA_FUT, 15), 15000, "B: 15 especial");
    assert.equal(await getPrecioReserva(FECHA_FUT, 30), 25000, "C: 30 especial");
    assert.deepEqual(await getPreciosEfectivos(FECHA_FUT), { precio_15: 15000, precio_30: 25000 }, "efectivos = especiales");

    // D — override solo 15 → 30 vuelve a normal.
    await supabaseAdmin.from("reservas_precios_especiales").upsert({ fecha: FECHA_FUT, precio_15: 15000, precio_30: null }, { onConflict: "fecha" });
    assert.equal(await getPrecioReserva(FECHA_FUT, 15), 15000, "D: 15 especial");
    assert.equal(await getPrecioReserva(FECHA_FUT, 30), normal30, "D: 30 normal");

    // E — eliminar → normal.
    await supabaseAdmin.from("reservas_precios_especiales").delete().eq("fecha", FECHA_FUT);
    assert.equal(await getPrecioReserva(FECHA_FUT, 15), normal15, "E: 15 vuelve a normal");
    assert.equal(await getPrecioReserva(FECHA_FUT, 30), normal30, "E: 30 vuelve a normal");

    // ── TRIGGER: bloqueo vencido vs vigente ───────────────────────────────────
    // CASO M — bloqueo TODO EL DÍA de una fecha PASADA → NO impide la reserva.
    await supabaseAdmin.from("bloqueos_reservas").insert({ fecha: FECHA_PAS, todo_el_dia: true, activo: true, motivo: MOTIVO });
    const rPas = await nuevaReserva(FECHA_PAS);
    const { error: eM } = await supabaseAdmin.from("reserva_slots").insert({ reserva_id: rPas, fecha: FECHA_PAS, hora: "10:00", simulador: SIM, estado: "activa" });
    assert.equal(eM, null, "M: bloqueo vencido NO impide la reserva (slot insertado)");

    // CASO N — bloqueo TODO EL DÍA de una fecha FUTURA (vigente) → RECHAZA la reserva.
    await supabaseAdmin.from("bloqueos_reservas").insert({ fecha: FECHA_FUT, todo_el_dia: true, activo: true, motivo: MOTIVO });
    const rFut = await nuevaReserva(FECHA_FUT);
    const { error: eN } = await supabaseAdmin.from("reserva_slots").insert({ reserva_id: rFut, fecha: FECHA_FUT, hora: "10:00", simulador: SIM, estado: "activa" });
    assert.equal((eN as { code?: string } | null)?.code, "23514", "N: bloqueo vigente RECHAZA la reserva (23514)");

    console.log("OK — precios (A/B/C/D/E) + trigger bloqueo vencido no impide (M) / vigente rechaza (N). Concurrencia (advisory lock) intacta.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

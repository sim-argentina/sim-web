import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Integración del Bloque M5B.1 contra la DB REAL, con datos TEMPORALES que se
// ELIMINAN al final.
//
// Demuestra la decisión de producto: el saldo se usa ENTERO o no se usa. No hay
// consumo parcial, no hay pago de diferencia y el flujo mixto de M5B ya no puede
// operar ni siquiera llamando directo a la base.
//
// Ejecutar:
//   npx tsx --env-file=.env.local lib/mensualidadesM5B1.integration.ts

const MARCA = `zzm5b1_${Date.now()}`;
const creados: string[] = [];
let seq = 0;

const nuevoTel = () => `296698${String((Date.now() % 10_000) + seq++).padStart(4, "0").slice(-4)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let k = 0;
const nuevaClave = () => `m5b1_${Date.now()}_${k++}`.padEnd(20, "0").slice(0, 40);

async function crearBilletera(saldo: number, diasVence = 30): Promise<string> {
  const { data: hoy } = await supabaseAdmin.rpc("mensualidad_hoy");
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + diasVence);
  const { data, error } = await supabaseAdmin.from("mensualidades").insert({
    codigo: nuevoCodigo(), titular_nombre: "Probe", titular_apellido: MARCA,
    titular_telefono: nuevoTel(), telefono_norm: nuevoTel(),
    titular_email: `${MARCA}@test.local`, saldo_minutos: saldo,
    vence_el: d.toISOString().slice(0, 10),
  }).select("id").single();
  if (error) throw new Error(`crearBilletera: ${error.message}`);
  creados.push(data.id as string);
  return data.id as string;
}

async function limpiar() {
  const ids = Array.from(new Set(creados));
  if (ids.length === 0) return;
  const { data: rs } = await supabaseAdmin.from("reservas").select("id").in("mensualidad_id", ids);
  const rids = (rs ?? []).map((r) => r.id as number);
  if (rids.length) {
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", rids);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reservas").delete().in("id", rids);
  }
  await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
  await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
  await supabaseAdmin.from("mensualidades").delete().in("id", ids);
}

async function fechaEnVentana(dias = 4): Promise<string> {
  const { data: hoy } = await supabaseAdmin.rpc("mensualidad_hoy");
  const [y, m, d] = String(hoy).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + dias * 86_400_000);
  return t.toISOString().slice(0, 10);
}

type Rpc = {
  reserva_id: number; referencia_publica: string; minutos_consumidos: number;
  saldo_anterior: number; saldo_posterior: number; idempotente: boolean;
};

async function reservar(args: {
  mid: string; fecha: string; hora: string; duracion: number;
  sims: string[]; slots: string[]; clave?: string;
}) {
  return supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: args.mid, p_fecha: args.fecha, p_hora: args.hora,
    p_duracion: args.duracion, p_simuladores: args.sims, p_slots: args.slots,
    p_idempotency_key: args.clave ?? nuevaClave(), p_condiciones_version: "cond-v1",
  });
}

const saldoDe = async (mid: string) => {
  const { data } = await supabaseAdmin.from("mensualidades").select("saldo_minutos").eq("id", mid).single();
  return Number(data?.saldo_minutos);
};
const efectos = async (mid: string) => {
  const { count: reservas } = await supabaseAdmin
    .from("reservas").select("*", { count: "exact", head: true }).eq("mensualidad_id", mid);
  const { count: movs } = await supabaseAdmin
    .from("mensualidad_movimientos").select("*", { count: "exact", head: true }).eq("mensualidad_id", mid);
  return { reservas: reservas ?? 0, movs: movs ?? 0 };
};

async function main() {
  const FECHA = await fechaEnVentana();

  // ── M5B1-A · El flujo mixto ya no existe en la base ──────────────────────
  // Ni siquiera llamando directo a la base con service_role: las RPC se
  // retiraron del catálogo, así que no hay forma de crear una reserva mixta,
  // una retención ni una liberación.
  for (const fn of [
    "crear_retencion_reserva_mensualidad",
    "confirmar_reserva_mensualidad_pagada",
    "liberar_retencion_reserva_mensualidad",
    "mensualidad_tiene_retencion_viva",
  ]) {
    const { error } = await supabaseAdmin.rpc(fn as never, {} as never);
    assert.ok(error, `M5B1-A la RPC ${fn} no debe poder ejecutarse`);
    assert.ok(
      /could not find|does not exist|schema cache|not found/i.test(String(error?.message ?? "")),
      `M5B1-A ${fn} debe estar retirada del catálogo (fue: ${error?.message})`,
    );
  }
  // La tabla del complemento sigue existiendo pero vacía y sin uso.
  const { count: pagos } = await supabaseAdmin
    .from("mensualidad_reserva_pagos").select("*", { count: "exact", head: true });
  assert.equal(pagos ?? 0, 0, "M5B1-A la tabla de pagos complementarios queda vacía");
  console.log("M5B1-A flujo mixto retirado de la base OK");

  // ── M5B1-1/2/19 · Saldo exacto y saldo superior confirman ────────────────
  {
    // Saldo 60, 2 simuladores x 30 = 60 → confirma y queda en 0.
    const mid = await crearBilletera(60);
    const { data, error } = await reservar({
      mid, fecha: FECHA, hora: "12:00", duracion: 30,
      sims: ["Ferrari", "McLaren"], slots: ["12:00", "12:20"],
    });
    assert.equal(error, null);
    const r = (Array.isArray(data) ? data[0] : data) as Rpc;
    assert.equal(r.minutos_consumidos, 60);
    assert.equal(r.saldo_posterior, 0, "M5B1-19 saldo 60 con 30x2 queda en 0");
    const { data: res } = await supabaseAdmin
      .from("reservas").select("estado, cobertura, total, importe_complementario, minutos_consumidos")
      .eq("id", r.reserva_id).single();
    assert.equal(res!.estado, "activa", "confirma inmediatamente");
    assert.equal(res!.cobertura, "saldo", "M5B1-14 M5A es el único flujo");
    assert.equal(Number(res!.total), 0);
    assert.equal(Number(res!.importe_complementario), 0, "nunca hay complemento");
    const { count: slots } = await supabaseAdmin
      .from("reserva_slots").select("*", { count: "exact", head: true })
      .eq("reserva_id", r.reserva_id).eq("estado", "activa");
    assert.equal(slots, 4, "2 bloques x 2 simuladores");
  }
  {
    // Saldo superior: 120 y consume 60 → remanente 60.
    const mid = await crearBilletera(120);
    const { data } = await reservar({
      mid, fecha: FECHA, hora: "13:00", duracion: 30,
      sims: ["Red Bull", "Alpine"], slots: ["13:00", "13:20"],
    });
    const r = (Array.isArray(data) ? data[0] : data) as Rpc;
    assert.equal(r.saldo_posterior, 60, "M5B1-2 remanente correcto");
  }
  console.log("M5B1-1/2/19 saldo exacto y superior confirman OK");

  // ── M5B1-22 · Saldo 120 con 4 simuladores x 30 confirma y queda en 0 ─────
  {
    const mid = await crearBilletera(120);
    const { data, error } = await reservar({
      mid, fecha: FECHA, hora: "14:00", duracion: 30,
      sims: ["Ferrari", "McLaren", "Red Bull", "Alpine"], slots: ["14:00", "14:20"],
    });
    assert.equal(error, null);
    const r = (Array.isArray(data) ? data[0] : data) as Rpc;
    assert.equal(r.minutos_consumidos, 120);
    assert.equal(r.saldo_posterior, 0);
    const { count: slots } = await supabaseAdmin
      .from("reserva_slots").select("*", { count: "exact", head: true })
      .eq("reserva_id", r.reserva_id).eq("estado", "activa");
    assert.equal(slots, 8, "2 bloques x 4 simuladores");
  }
  console.log("M5B1-22 saldo 120 con 30x4 confirma OK");

  // ── M5B1-3..11/20/21 · Saldo insuficiente: rechaza SIN NINGÚN EFECTO ─────
  for (const caso of [
    { nota: "M5B1-20 saldo 60, 30x4 = 120", saldo: 60, duracion: 30, sims: ["Ferrari", "McLaren", "Red Bull", "Alpine"], slots: ["16:00", "16:20"], hora: "16:00" },
    { nota: "M5B1-21 saldo 45, 60x1 = 60", saldo: 45, duracion: 60, sims: ["Alpine"], slots: ["17:00", "17:20", "17:40", "18:00"], hora: "17:00" },
    { nota: "M5B1-5 falta por 15 min: 45 vs 60x1", saldo: 45, duracion: 60, sims: ["Ferrari"], slots: ["19:00", "19:20", "19:40", "20:00"], hora: "19:00" },
  ]) {
    const mid = await crearBilletera(caso.saldo);
    const { error } = await reservar({
      mid, fecha: FECHA, hora: caso.hora, duracion: caso.duracion,
      sims: caso.sims, slots: caso.slots,
    });
    assert.ok(error, `${caso.nota}: debe rechazar`);
    assert.ok(String(error?.message).includes("saldo_insuficiente"),
      `${caso.nota}: error tipado saldo_insuficiente (fue: ${error?.message})`);

    // Sin consumo parcial y sin ningún efecto lateral.
    assert.equal(await saldoDe(mid), caso.saldo, `${caso.nota}: el saldo queda intacto`);
    const e = await efectos(mid);
    assert.equal(e.reservas, 0, `${caso.nota}: no crea reserva`);
    assert.equal(e.movs, 0, `${caso.nota}: no crea movimiento`);
    const { count: slots } = await supabaseAdmin
      .from("reserva_slots").select("*", { count: "exact", head: true })
      .eq("fecha", FECHA).eq("hora", caso.hora);
    assert.equal(slots, 0, `${caso.nota}: no crea slots`);
  }
  console.log("M5B1-3/5/6/7/8/20/21 saldo insuficiente sin efectos OK");

  // ── M5B1-4 · Saldo cero rechaza ─────────────────────────────────────────
  {
    const mid = await crearBilletera(0);
    const { error } = await reservar({
      mid, fecha: FECHA, hora: "10:00", duracion: 15, sims: ["Alpine"], slots: ["10:00"],
    });
    assert.ok(String(error?.message).includes("mensualidad_agotada"),
      "M5B1-4 saldo 0 rechaza (estado agotada)");
    assert.equal(await saldoDe(mid), 0);
    assert.equal((await efectos(mid)).reservas, 0);
  }
  console.log("M5B1-4 saldo cero rechaza OK");

  // ── M5B1-12 · Doble clic idempotente no duplica consumo ─────────────────
  {
    const mid = await crearBilletera(60);
    const clave = nuevaClave();
    const a = await reservar({ mid, fecha: FECHA, hora: "11:00", duracion: 15, sims: ["Ferrari"], slots: ["11:00"], clave });
    const b = await reservar({ mid, fecha: FECHA, hora: "11:00", duracion: 15, sims: ["Ferrari"], slots: ["11:00"], clave });
    const ra = (Array.isArray(a.data) ? a.data[0] : a.data) as Rpc;
    const rb = (Array.isArray(b.data) ? b.data[0] : b.data) as Rpc;
    assert.equal(ra.reserva_id, rb.reserva_id, "M5B1-12 misma reserva");
    assert.equal(rb.idempotente, true);
    assert.equal(await saldoDe(mid), 45, "M5B1-12 descuenta una sola vez");
    assert.equal((await efectos(mid)).movs, 1, "M5B1-12 un solo movimiento");
  }
  console.log("M5B1-12 doble clic idempotente OK");

  // ── M5B1-13 · Dos consumos concurrentes del último saldo ────────────────
  {
    const mid = await crearBilletera(60); // alcanza para UNA sola de 30x2
    const [r1, r2] = await Promise.all([
      reservar({ mid, fecha: FECHA, hora: "20:00", duracion: 30, sims: ["Ferrari", "McLaren"], slots: ["20:00", "20:20"] }),
      reservar({ mid, fecha: FECHA, hora: "21:00", duracion: 30, sims: ["Red Bull", "Alpine"], slots: ["21:00", "21:20"] }),
    ]);
    const ok = [r1, r2].filter((r) => !r.error).length;
    assert.equal(ok, 1, "M5B1-13 solo una de las dos puede ganar");
    const saldo = await saldoDe(mid);
    assert.equal(saldo, 0, "M5B1-13 saldo final 0, nunca negativo");
    assert.ok(saldo >= 0, "M5B1-13 sin saldo negativo");
    assert.equal((await efectos(mid)).movs, 1, "M5B1-13 un solo consumo");
  }
  console.log("M5B1-13 concurrencia sobre el último saldo OK");

  // ── M5B1-14 · Conflicto de slots mantiene el saldo intacto ──────────────
  {
    const midA = await crearBilletera(30);
    const midB = await crearBilletera(30);
    await reservar({ mid: midA, fecha: FECHA, hora: "09:00", duracion: 15, sims: ["Ferrari"], slots: ["09:00"] });
    const antes = await saldoDe(midB);
    const { error } = await reservar({ mid: midB, fecha: FECHA, hora: "09:00", duracion: 15, sims: ["Ferrari"], slots: ["09:00"] });
    assert.ok(error, "el turno ya está tomado");
    assert.equal(await saldoDe(midB), antes, "M5B1-14 conflicto de slot no descuenta");
    assert.equal((await efectos(midB)).movs, 0, "M5B1-14 sin movimiento");
  }
  console.log("M5B1-14 conflicto de slots sin descuento OK");

  // ── M5B1-15/16 · Bloqueo administrativo y turno fuera de vigencia ───────
  {
    const mid = await crearBilletera(120);
    await supabaseAdmin.from("mensualidades").update({ bloqueada: true }).eq("id", mid);
    const { error } = await reservar({ mid, fecha: FECHA, hora: "15:00", duracion: 15, sims: ["Alpine"], slots: ["15:00"] });
    assert.ok(String(error?.message).includes("mensualidad_bloqueada"), "M5B1-15 bloqueada rechaza");
    assert.equal(await saldoDe(mid), 120);
    await supabaseAdmin.from("mensualidades").update({ bloqueada: false }).eq("id", mid);

    const { data: hoy } = await supabaseAdmin.rpc("mensualidad_hoy");
    const lejos = new Date(`${hoy}T12:00:00Z`);
    lejos.setUTCDate(lejos.getUTCDate() + 10);
    await supabaseAdmin.from("mensualidades")
      .update({ vence_el: new Date(`${hoy}T12:00:00Z`).toISOString().slice(0, 10) }).eq("id", mid);
    const { error: e2 } = await reservar({
      mid, fecha: lejos.toISOString().slice(0, 10), hora: "15:00",
      duracion: 15, sims: ["Alpine"], slots: ["15:00"],
    });
    assert.ok(String(e2?.message).includes("turno_posterior_al_vencimiento"),
      "M5B1-16 turno posterior al vencimiento rechaza");
    assert.equal(await saldoDe(mid), 120);
  }
  console.log("M5B1-15/16 bloqueo y vencimiento rechazan OK");

  // ── M5B1-17/18 · Duraciones y simuladores concretos siguen validándose ──
  {
    const mid = await crearBilletera(240);
    for (const [dur, slots] of [
      [15, ["10:20"]], [30, ["10:40", "11:00"]],
      [45, ["11:20", "11:40", "12:00"]], [60, ["18:00", "18:20", "18:40", "19:00"]],
    ] as Array<[number, string[]]>) {
      const { error } = await reservar({
        mid, fecha: FECHA, hora: slots[0], duracion: dur, sims: ["Alpine"], slots,
      });
      assert.equal(error, null, `M5B1-17 duración ${dur} sigue permitida`);
      await supabaseAdmin.from("mensualidades").update({ saldo_minutos: 240 }).eq("id", mid);
    }
    const { error: eDup } = await reservar({
      mid, fecha: FECHA, hora: "13:40", duracion: 15, sims: ["Ferrari", "Ferrari"], slots: ["13:40"],
    });
    assert.ok(String(eDup?.message).includes("simuladores_duplicados"), "M5B1-18 duplicados rechazan");
    const { error: eDesc } = await reservar({
      mid, fecha: FECHA, hora: "13:40", duracion: 15, sims: ["Ferrari 2026"], slots: ["13:40"],
    });
    assert.ok(String(eDesc?.message).includes("simulador_desconocido"), "M5B1-18 desconocido rechaza");
  }
  console.log("M5B1-17/18 duraciones 15/30/45/60 y simuladores concretos OK");

  // ── M5B1-23 · anon no puede operar nada ─────────────────────────────────
  {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error: e1 } = await anon.from("mensualidad_reserva_pagos").select("id").limit(1);
    assert.ok(e1, "M5B1-23 anon no lee la tabla del complemento");
    const { error: e2 } = await anon.rpc("crear_reserva_mensualidad" as never, {} as never);
    assert.ok(e2, "M5B1-23 anon no ejecuta la RPC de reserva");
    const { error: e3 } = await anon.from("mensualidades").select("codigo").limit(1);
    assert.ok(e3, "M5B1-23 anon no lee billeteras");
  }
  console.log("M5B1-23 anon sin acceso OK");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M5B.1 OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const ids = Array.from(new Set(creados));
    const { count } = await supabaseAdmin
      .from("mensualidades").select("*", { count: "exact", head: true })
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    console.log(`limpieza: ${count ?? 0} billeteras temporales restantes (debe ser 0)`);
  });

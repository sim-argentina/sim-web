import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cancelarReserva, reprogramarReserva } from "@/lib/mensualidadesGestionReserva";
import { crearSesion, revocarSesion } from "@/lib/mensualidadSesion";

// Integración del Bloque M5C contra la DB REAL, con datos TEMPORALES marcados
// con MARCA y eliminados al final.
//
// Cancelación y reprogramación de reservas de Mensualidades: regla de 24 h,
// restitución exacta, idempotencia, pertenencia y atomicidad.
//
// Ejecutar:
//   npx tsx --env-file=.env.local lib/mensualidadesM5C.integration.ts

const MARCA = `zzm5c_${Date.now()}`;
const EMAIL = `${MARCA}@test.local`;
const creados: string[] = [];
const reservasSueltas: number[] = [];
let seq = 0;

const nuevoTel = () => `296699${String((Date.now() % 10_000) + seq++).padStart(4, "0").slice(-4)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let k = 0;
const clave = () => `m5c_${Date.now()}_${k++}`.padEnd(20, "0").slice(0, 40);

async function hoyCordoba(): Promise<string> {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}
function masDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + dias * 86_400_000).toISOString().slice(0, 10);
}

async function crearBilletera(saldo: number, diasVence = 40): Promise<string> {
  const hoy = await hoyCordoba();
  const { data, error } = await supabaseAdmin.from("mensualidades").insert({
    codigo: nuevoCodigo(), titular_nombre: "Probe", titular_apellido: MARCA,
    titular_telefono: nuevoTel(), telefono_norm: nuevoTel(),
    titular_email: EMAIL, saldo_minutos: saldo, vence_el: masDias(hoy, diasVence),
  }).select("id").single();
  if (error) throw new Error(`crearBilletera: ${error.message}`);
  creados.push(data.id as string);
  return data.id as string;
}

type Creada = { referencia: string; reservaId: number };
async function crearReserva(args: {
  mid: string; fecha: string; hora: string; duracion: number; sims: string[]; slots: string[];
}): Promise<Creada> {
  const { data, error } = await supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: args.mid, p_fecha: args.fecha, p_hora: args.hora,
    p_duracion: args.duracion, p_simuladores: args.sims, p_slots: args.slots,
    p_idempotency_key: clave(), p_condiciones_version: "cond-m5c",
  });
  if (error) throw new Error(`crearReserva: ${error.message}`);
  const f = (Array.isArray(data) ? data[0] : data) as { referencia_publica: string; reserva_id: number };
  return { referencia: f.referencia_publica, reservaId: Number(f.reserva_id) };
}

/** Empuja una reserva a un instante relativo a AHORA, para probar los bordes. */
async function moverA(referencia: string, offsetMs: number) {
  const t = new Date(Date.now() + offsetMs);
  const enCordoba = new Date(t.getTime() - 3 * 3600_000); // UTC-3 fijo
  const fecha = enCordoba.toISOString().slice(0, 10);
  const hora = enCordoba.toISOString().slice(11, 16);
  const { error } = await supabaseAdmin.from("reservas")
    .update({ fecha, hora }).eq("referencia_publica", referencia);
  if (error) throw new Error(`moverA: ${error.message}`);
  return { fecha, hora };
}

const saldoDe = async (mid: string) => {
  const { data } = await supabaseAdmin.from("mensualidades").select("saldo_minutos").eq("id", mid).single();
  return Number(data?.saldo_minutos);
};
const contar = async (tabla: string, filtro: (q: never) => unknown) => {
  const q = supabaseAdmin.from(tabla).select("*", { count: "exact", head: true });
  const { count } = await (filtro as unknown as (x: typeof q) => typeof q)(q as never);
  return count ?? 0;
};
const slotsActivos = async (reservaId: number) => {
  const { count } = await supabaseAdmin.from("reserva_slots")
    .select("*", { count: "exact", head: true }).eq("reserva_id", reservaId).eq("estado", "activa");
  return count ?? 0;
};
const devoluciones = async (reservaId: number) => {
  const { count } = await supabaseAdmin.from("mensualidad_movimientos")
    .select("*", { count: "exact", head: true }).eq("reserva_id", reservaId).eq("tipo", "devolucion");
  return count ?? 0;
};
const estadoDe = async (referencia: string) => {
  const { data } = await supabaseAdmin.from("reservas")
    .select("estado, fecha, hora, cancelacion_resultado, duracion_minutos, minutos_consumidos, simuladores, reprogramaciones")
    .eq("referencia_publica", referencia).single();
  return data!;
};

async function limpiar() {
  const ids = Array.from(new Set(creados));
  const { data: rs } = ids.length
    ? await supabaseAdmin.from("reservas").select("id").in("mensualidad_id", ids)
    : { data: [] as { id: number }[] };
  const rids = [...(rs ?? []).map((r) => r.id as number), ...reservasSueltas];
  if (rids.length) {
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", rids);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reservas").delete().in("id", rids);
  }
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  }
  // Red de seguridad por marcador, por si algo quedó fuera de los ids.
  await supabaseAdmin.from("mensualidades").delete().eq("titular_email", EMAIL);
  await supabaseAdmin.from("reservas").delete().eq("nombre", MARCA);
}

async function main() {
  const hoy = await hoyCordoba();
  const D5 = masDias(hoy, 5);
  const D8 = masDias(hoy, 8);

  // ── M5C-1 · Cancelación con más de 24 h: restituye exacto ────────────────
  {
    const mid = await crearBilletera(300);
    const r = await crearReserva({ mid, fecha: D5, hora: "12:00", duracion: 30,
      sims: ["Ferrari", "McLaren"], slots: ["12:00", "12:20"] });
    assert.equal(await saldoDe(mid), 240, "30x2 consumió 60");
    assert.equal(await slotsActivos(r.reservaId), 4);

    const c = await cancelarReserva(mid, r.referencia, clave());
    assert.ok(c.ok, "cancela");
    if (c.ok) {
      assert.equal(c.data.restituyo, true);
      assert.equal(c.data.minutos_restituidos, 60, "M5C-1 restitución EXACTA");
      assert.equal(c.data.saldo_restante, 300);
      assert.equal(c.data.idempotente, false);
    }
    assert.equal(await saldoDe(mid), 300, "el saldo vuelve entero");
    assert.equal(await slotsActivos(r.reservaId), 0, "M5C liberó TODOS los slots");
    assert.equal(await devoluciones(r.reservaId), 1, "un único movimiento de devolución");
    const e = await estadoDe(r.referencia);
    assert.equal(e.estado, "cancelada");
    assert.equal(e.cancelacion_resultado, "restituida");
  }
  console.log("M5C-1 cancelación >24 h restituye exacto y libera slots OK");

  // ── M5C-2 · Exactamente 24 h y 23:59:59 ─────────────────────────────────
  {
    const mid = await crearBilletera(300);
    // 24 h + 2 min de margen: el corte es inclusivo, así que restituye.
    const a = await crearReserva({ mid, fecha: D5, hora: "13:00", duracion: 15,
      sims: ["Alpine"], slots: ["13:00"] });
    await moverA(a.referencia, 24 * 3600_000 + 120_000);
    const ca = await cancelarReserva(mid, a.referencia, clave());
    assert.ok(ca.ok && ca.data.restituyo === true, "M5C-2 a 24 h y 2 min todavía restituye");
    if (ca.ok) assert.equal(ca.data.minutos_restituidos, 15);

    // 23 h 59 min: ya no.
    const b = await crearReserva({ mid, fecha: D5, hora: "14:00", duracion: 15,
      sims: ["Alpine"], slots: ["14:00"] });
    const saldoAntes = await saldoDe(mid);
    await moverA(b.referencia, 23 * 3600_000 + 59 * 60_000);
    const cb = await cancelarReserva(mid, b.referencia, clave());
    assert.ok(cb.ok, "cancela igual");
    if (cb.ok) {
      assert.equal(cb.data.restituyo, false, "M5C-3 a 23:59 NO restituye");
      assert.equal(cb.data.minutos_restituidos, 0);
    }
    assert.equal(await saldoDe(mid), saldoAntes, "el saldo no se movió");
    assert.equal(await slotsActivos(b.reservaId), 0, "pero el turno SÍ se liberó");
    assert.equal(await devoluciones(b.reservaId), 0, "sin movimiento de devolución");
    assert.equal((await estadoDe(b.referencia)).cancelacion_resultado, "sin_restitucion");
  }
  console.log("M5C-2/3 bordes de 24 h (inclusive) y <24 h sin restitución OK");

  // ── M5C-4 · Cancelación duplicada: idempotente, un solo movimiento ───────
  {
    const mid = await crearBilletera(120);
    const r = await crearReserva({ mid, fecha: D5, hora: "15:00", duracion: 15,
      sims: ["Red Bull"], slots: ["15:00"] });
    const c1 = await cancelarReserva(mid, r.referencia, clave());
    const saldo1 = await saldoDe(mid);
    const c2 = await cancelarReserva(mid, r.referencia, clave());
    const c3 = await cancelarReserva(mid, r.referencia, clave());
    assert.ok(c1.ok && c2.ok && c3.ok);
    if (c2.ok) assert.equal(c2.data.idempotente, true, "M5C-4 la segunda es un replay");
    assert.equal(await saldoDe(mid), saldo1, "no devuelve de nuevo");
    assert.equal(await devoluciones(r.reservaId), 1, "M5C-4 sigue habiendo UN solo movimiento");
  }
  console.log("M5C-4 cancelación duplicada sin doble devolución OK");

  // ── M5C-5 · Dos cancelaciones CONCURRENTES ──────────────────────────────
  {
    const mid = await crearBilletera(120);
    const r = await crearReserva({ mid, fecha: D5, hora: "16:00", duracion: 15,
      sims: ["Ferrari"], slots: ["16:00"] });
    const saldoAntes = await saldoDe(mid);
    const [x, y] = await Promise.all([
      cancelarReserva(mid, r.referencia, clave()),
      cancelarReserva(mid, r.referencia, clave()),
    ]);
    assert.ok(x.ok && y.ok, "las dos responden sin romper");
    assert.equal(await saldoDe(mid), saldoAntes + 15, "M5C-5 se devolvió UNA sola vez");
    assert.equal(await devoluciones(r.reservaId), 1, "M5C-5 un único movimiento");
  }
  console.log("M5C-5 cancelaciones concurrentes sin doble devolución OK");

  // ── M5C-6 · Reserva pasada / ya iniciada ────────────────────────────────
  {
    const mid = await crearBilletera(120);
    const r = await crearReserva({ mid, fecha: D5, hora: "17:00", duracion: 15,
      sims: ["Alpine"], slots: ["17:00"] });
    await moverA(r.referencia, -3600_000); // hace una hora
    const saldoAntes = await saldoDe(mid);
    const c = await cancelarReserva(mid, r.referencia, clave());
    assert.equal(c.ok, false, "M5C-6 una reserva ya iniciada no se cancela");
    if (!c.ok) assert.equal(c.codigo, "reserva_ya_iniciada");
    assert.equal(await saldoDe(mid), saldoAntes, "sin efectos");
    const p = await reprogramarReserva(mid, r.referencia, D8, "10:00", clave());
    assert.equal(p.ok, false, "tampoco se reprograma");
  }
  console.log("M5C-6 reserva pasada no se cancela ni reprograma OK");

  // ── M5C-7 · Reserva AJENA y reserva que no es de Mensualidad ────────────
  {
    const mid = await crearBilletera(120);
    const otro = await crearBilletera(120);
    const r = await crearReserva({ mid, fecha: D5, hora: "18:00", duracion: 15,
      sims: ["McLaren"], slots: ["18:00"] });

    const c = await cancelarReserva(otro, r.referencia, clave());
    assert.equal(c.ok, false, "M5C-7 no se cancela una reserva ajena");
    if (!c.ok) {
      assert.equal(c.status, 404, "y se responde como inexistente, sin revelar que existe");
      assert.equal(c.codigo, "reserva_inexistente");
    }
    const p = await reprogramarReserva(otro, r.referencia, D8, "10:00", clave());
    assert.equal(p.ok, false, "tampoco se reprograma");
    assert.equal((await estadoDe(r.referencia)).estado, "activa", "la reserva del dueño sigue viva");

    // Una reserva NORMAL (origen web) no se toca desde Mensualidades.
    const { data: web } = await supabaseAdmin.from("reservas").insert({
      nombre: MARCA, telefono: "3515123456", fecha: D5, hora: "19:00",
      simuladores: ["Ferrari"], cantidad_turnos: 1, total: 12000, total_original: 12000,
      estado: "activa", acepto_condiciones: true, duracion_minutos: 15, origen: "web",
      referencia_publica: null,
    }).select("id").single();
    if (web) reservasSueltas.push(web.id as number);
    const cWeb = await cancelarReserva(mid, "RES-ZZZZ-ZZZZ", clave());
    assert.equal(cWeb.ok, false, "M5C-7 una referencia que no existe tampoco");
  }
  console.log("M5C-7 reserva ajena y reserva normal protegidas OK");

  // ── M5C-8 · Reprogramación válida: no toca saldo, duración ni escuderías ─
  {
    const mid = await crearBilletera(300);
    const r = await crearReserva({ mid, fecha: D5, hora: "10:00", duracion: 30,
      sims: ["Ferrari", "McLaren"], slots: ["10:00", "10:20"] });
    const saldoAntes = await saldoDe(mid);
    const movsAntes = await contar("mensualidad_movimientos", (q) =>
      (q as never as { eq: (a: string, b: string) => unknown }).eq("mensualidad_id", mid));

    const p = await reprogramarReserva(mid, r.referencia, D8, "16:00", clave());
    assert.ok(p.ok, "reprograma");
    if (p.ok) {
      assert.equal(p.data.fecha, D8);
      assert.equal(p.data.hora, "16:00");
      assert.equal(p.data.sin_cambios, false);
      assert.equal(p.data.duracion, 30, "M5C-8 la duración NO cambia");
      assert.equal(p.data.minutos_consumidos, 60, "M5C-8 los minutos NO cambian");
    }
    assert.equal(await saldoDe(mid), saldoAntes, "M5C-8 el saldo queda intacto");
    const movsDespues = await contar("mensualidad_movimientos", (q) =>
      (q as never as { eq: (a: string, b: string) => unknown }).eq("mensualidad_id", mid));
    assert.equal(movsDespues, movsAntes, "M5C-8 no se escribe ningún movimiento");
    assert.equal(await slotsActivos(r.reservaId), 4, "4 slots activos en el turno nuevo");

    const e = await estadoDe(r.referencia);
    assert.equal(e.fecha, D8);
    assert.equal(e.hora, "16:00");
    assert.equal(e.duracion_minutos, 30);
    assert.deepEqual((e.simuladores as string[]).map(String).sort(), ["Ferrari", "McLaren"],
      "M5C-8 las escuderías NO cambian");
    assert.equal(e.reprogramaciones, 1);

    // Los slots viejos quedaron liberados, no activos.
    const { count: viejos } = await supabaseAdmin.from("reserva_slots")
      .select("*", { count: "exact", head: true })
      .eq("reserva_id", r.reservaId).eq("fecha", D5).eq("estado", "activa");
    assert.equal(viejos ?? 0, 0, "el turno anterior quedó libre");

    // ── Reprogramar al MISMO horario: sin cambios, sin duplicar slots ──
    const p2 = await reprogramarReserva(mid, r.referencia, D8, "16:00", clave());
    assert.ok(p2.ok && p2.data.sin_cambios === true, "M5C-9 mismo horario = sin cambios");
    assert.equal(await slotsActivos(r.reservaId), 4, "M5C-9 no duplica slots");
    assert.equal((await estadoDe(r.referencia)).reprogramaciones, 1, "M5C-9 no cuenta otra vez");
    assert.equal(await saldoDe(mid), saldoAntes, "M5C-9 saldo intacto");
  }
  console.log("M5C-8/9 reprogramación válida y al mismo horario OK");

  // ── M5C-10 · Reprogramar con menos de 24 h: rechazado ───────────────────
  {
    const mid = await crearBilletera(120);
    const r = await crearReserva({ mid, fecha: D5, hora: "11:00", duracion: 15,
      sims: ["Alpine"], slots: ["11:00"] });
    const orig = await moverA(r.referencia, 20 * 3600_000); // faltan 20 h
    const p = await reprogramarReserva(mid, r.referencia, D8, "12:00", clave());
    assert.equal(p.ok, false, "M5C-10 con menos de 24 h no se reprograma");
    if (!p.ok) {
      assert.equal(p.codigo, "fuera_de_plazo");
      assert.equal(p.status, 409);
    }
    const e = await estadoDe(r.referencia);
    assert.equal(e.fecha, orig.fecha, "la reserva original no se movió");
    assert.equal(e.hora, orig.hora);
    assert.equal(await slotsActivos(r.reservaId), 1, "conserva su slot");

    // Pero SÍ se puede cancelar, sin devolución.
    const c = await cancelarReserva(mid, r.referencia, clave());
    assert.ok(c.ok && c.data.restituyo === false, "M5C-10 cancelar sí, sin devolver");
  }
  console.log("M5C-10 reprogramación fuera de plazo rechazada OK");

  // ── M5C-11 · Reprogramar a un turno OCUPADO: original intacta ───────────
  {
    const mid = await crearBilletera(300);
    const otro = await crearBilletera(300);
    const r = await crearReserva({ mid, fecha: D5, hora: "20:00", duracion: 15,
      sims: ["Ferrari"], slots: ["20:00"] });
    // Otro titular toma el turno destino con la MISMA escudería.
    await crearReserva({ mid: otro, fecha: D8, hora: "21:00", duracion: 15,
      sims: ["Ferrari"], slots: ["21:00"] });

    const saldoAntes = await saldoDe(mid);
    const p = await reprogramarReserva(mid, r.referencia, D8, "21:00", clave());
    assert.equal(p.ok, false, "M5C-11 no se puede tomar un turno ocupado");
    if (!p.ok) assert.equal(p.codigo, "turno_ocupado");

    const e = await estadoDe(r.referencia);
    assert.equal(e.fecha, D5, "M5C-11 la reserva ORIGINAL quedó intacta");
    assert.equal(e.hora, "20:00");
    assert.equal(e.estado, "activa");
    assert.equal(await slotsActivos(r.reservaId), 1, "M5C-11 conserva su slot original");
    assert.equal(await saldoDe(mid), saldoAntes, "y el saldo no se movió");
  }
  console.log("M5C-11 turno ocupado deja la reserva original intacta OK");

  // ── M5C-12 · Fuera de ventana y posterior al vencimiento ────────────────
  {
    const mid = await crearBilletera(300, 6); // vence en 6 días
    const r = await crearReserva({ mid, fecha: masDias(hoy, 3), hora: "10:00", duracion: 15,
      sims: ["Alpine"], slots: ["10:00"] });

    const hoyMismo = await reprogramarReserva(mid, r.referencia, hoy, "12:00", clave());
    assert.equal(hoyMismo.ok, false, "M5C-12 no se reprograma para hoy");

    const lejos = await reprogramarReserva(mid, r.referencia, masDias(hoy, 20), "12:00", clave());
    assert.equal(lejos.ok, false, "M5C-12 no más de 15 días");
    if (!lejos.ok) assert.equal(lejos.codigo, "fecha_fuera_de_ventana");

    // Dentro de la ventana de 15 días PERO después del vencimiento (día 10 > 6).
    const postVenc = await reprogramarReserva(mid, r.referencia, masDias(hoy, 10), "12:00", clave());
    assert.equal(postVenc.ok, false, "M5C-12 no después del vencimiento");
    if (!postVenc.ok) {
      assert.equal(postVenc.codigo, "turno_posterior_al_vencimiento",
        `esperaba turno_posterior_al_vencimiento, fue ${postVenc.codigo}`);
    }
    assert.equal((await estadoDe(r.referencia)).fecha, masDias(hoy, 3), "la original no se movió");
  }
  console.log("M5C-12 ventana de 15 días y vencimiento respetados OK");

  // ── M5C-13 · No-show: ni cancelación ni reprogramación, sin restitución ─
  {
    const mid = await crearBilletera(120);
    const r = await crearReserva({ mid, fecha: D5, hora: "09:00", duracion: 15,
      sims: ["Red Bull"], slots: ["09:00"] });
    await supabaseAdmin.from("reservas").update({ no_show: true }).eq("id", r.reservaId);
    const saldoAntes = await saldoDe(mid);

    const c = await cancelarReserva(mid, r.referencia, clave());
    assert.equal(c.ok, false, "M5C-13 un no-show no se cancela");
    if (!c.ok) assert.equal(c.codigo, "estado_no_cancelable");
    const p = await reprogramarReserva(mid, r.referencia, D8, "09:00", clave());
    assert.equal(p.ok, false, "M5C-13 un no-show no se reprograma");

    assert.equal(await saldoDe(mid), saldoAntes, "M5C-13 el no-show NO restituye minutos");
    assert.equal(await devoluciones(r.reservaId), 0, "y no hay movimiento de devolución");
  }
  console.log("M5C-13 no-show mantiene los minutos consumidos OK");

  // ── M5C-14 · Estados no modificables ────────────────────────────────────
  {
    const mid = await crearBilletera(120);
    for (const estado of ["reembolsada", "pendiente_pago"]) {
      const r = await crearReserva({ mid, fecha: D5, hora: estado === "reembolsada" ? "10:40" : "11:20",
        duracion: 15, sims: ["McLaren"], slots: [estado === "reembolsada" ? "10:40" : "11:20"] });
      await supabaseAdmin.from("reservas").update({ estado }).eq("id", r.reservaId);
      const c = await cancelarReserva(mid, r.referencia, clave());
      assert.equal(c.ok, false, `M5C-14 estado ${estado} no se cancela`);
      if (!c.ok) assert.equal(c.codigo, "estado_no_cancelable");
      const p = await reprogramarReserva(mid, r.referencia, D8, "13:00", clave());
      assert.equal(p.ok, false, `M5C-14 estado ${estado} no se reprograma`);
      await supabaseAdmin.from("reservas").update({ estado: "activa" }).eq("id", r.reservaId);
    }
  }
  console.log("M5C-14 estados no modificables rechazados OK");

  // ── M5C-15 · Los endpoints: sesión, flag y propiedad ────────────────────
  {
    const { POST: cancelarRoute } = await import("@/app/api/mensualidades/reservas/cancelar/route");
    const { POST: reprogramarRoute } = await import("@/app/api/mensualidades/reservas/reprogramar/route");

    const mid = await crearBilletera(120);
    const r = await crearReserva({ mid, fecha: D5, hora: "21:20", duracion: 15,
      sims: ["Alpine"], slots: ["21:20"] });
    const token = await crearSesion(mid);
    assert.ok(token, "sesión creada");

    let ipSeq = 0;
    const pedir = (fn: (req: Request) => Promise<Response>, url: string, body: unknown, cookie?: string | null) =>
      fn(new Request(`https://simexperience.com.ar${url}`, {
        method: "POST",
        headers: {
          origin: "https://simexperience.com.ar",
          "content-type": "application/json",
          "x-real-ip": `10.5.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`,
          ...(cookie ? { cookie: `sim_mensualidad_session=${cookie}` } : {}),
        },
        body: JSON.stringify(body),
      }));

    const flagPrevia = process.env.MENSUALIDADES_ENABLED;

    // Flag apagada → 404 aunque la sesión sea válida.
    delete process.env.MENSUALIDADES_ENABLED;
    const off = await pedir(cancelarRoute, "/api/mensualidades/reservas/cancelar",
      { referencia: r.referencia, idempotency_key: clave() }, token);
    assert.equal(off.status, 404, "M5C-15 con la flag apagada el endpoint no existe");
    assert.equal((await estadoDe(r.referencia)).estado, "activa", "y no cancela nada");

    process.env.MENSUALIDADES_ENABLED = "true";

    // Sin sesión → 404 neutral.
    const sin = await pedir(cancelarRoute, "/api/mensualidades/reservas/cancelar",
      { referencia: r.referencia, idempotency_key: clave() }, null);
    assert.equal(sin.status, 404, "M5C-15 sin sesión no se puede cancelar");

    // Sesión revocada → 404.
    const tokenMuerto = await crearSesion(mid);
    await revocarSesion(tokenMuerto);
    const rev = await pedir(cancelarRoute, "/api/mensualidades/reservas/cancelar",
      { referencia: r.referencia, idempotency_key: clave() }, tokenMuerto);
    assert.equal(rev.status, 404, "M5C-15 sesión revocada no sirve");

    // Origen cruzado → 403.
    const cruzado = await cancelarRoute(new Request("https://simexperience.com.ar/api/mensualidades/reservas/cancelar", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json",
        "x-real-ip": "10.5.90.1", cookie: `sim_mensualidad_session=${token}` },
      body: JSON.stringify({ referencia: r.referencia, idempotency_key: clave() }),
    }));
    assert.equal(cruzado.status, 403, "M5C-15 originCheck en cancelar");

    // Con sesión válida → cancela y devuelve un DTO sin PII ni ids internos.
    const ok = await pedir(cancelarRoute, "/api/mensualidades/reservas/cancelar",
      { referencia: r.referencia, idempotency_key: clave() }, token);
    assert.equal(ok.status, 200, "M5C-15 con sesión válida cancela");
    const dto = await ok.json();
    const crudo = JSON.stringify(dto);
    for (const prohibido of ["telefono", "email", "codigo", "reserva_id", "mensualidad_id", "token", "_hash"]) {
      assert.ok(!crudo.includes(prohibido), `M5C-15 el DTO no puede traer "${prohibido}"`);
    }
    assert.equal(dto.restituyo, true);
    assert.equal(dto.minutos_restituidos, 15);
    assert.ok(/no-store/i.test(ok.headers.get("cache-control") ?? ""), "no-store");

    // Reprogramar una reserva ajena vía endpoint → 404.
    const otroMid = await crearBilletera(120);
    const rAjena = await crearReserva({ mid: otroMid, fecha: D5, hora: "21:40", duracion: 15,
      sims: ["Ferrari"], slots: ["21:40"] });
    const ajena = await pedir(reprogramarRoute, "/api/mensualidades/reservas/reprogramar",
      { referencia: rAjena.referencia, fecha: D8, hora: "14:00", idempotency_key: clave() }, token);
    assert.equal(ajena.status, 404, "M5C-15 no se reprograma una reserva de otra billetera");
    assert.equal((await estadoDe(rAjena.referencia)).hora, "21:40", "la ajena no se movió");

    if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
    else delete process.env.MENSUALIDADES_ENABLED;
  }
  console.log("M5C-15 endpoints: flag, sesión, origen y propiedad OK");

  // ── M5C-16 · anon no puede ejecutar las RPC nuevas ──────────────────────
  {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    for (const fn of ["cancelar_reserva_mensualidad", "reprogramar_reserva_mensualidad"]) {
      const { error } = await anon.rpc(fn as never, {} as never);
      assert.ok(error, `M5C-16 anon no puede ejecutar ${fn}`);
    }
  }
  console.log("M5C-16 anon sin acceso a las RPC OK");

  // ── M5C-17 · El flujo mixto de M5B sigue ausente ───────────────────────
  {
    for (const fn of [
      "crear_retencion_reserva_mensualidad",
      "confirmar_reserva_mensualidad_pagada",
      "liberar_retencion_reserva_mensualidad",
      "mensualidad_tiene_retencion_viva",
    ]) {
      const { error } = await supabaseAdmin.rpc(fn as never, {} as never);
      assert.ok(error, `M5C-17 la RPC mixta ${fn} no debe existir`);
    }
    const { count } = await supabaseAdmin.from("mensualidad_reserva_pagos")
      .select("*", { count: "exact", head: true });
    assert.equal(count ?? 0, 0, "M5C-17 la tabla del complemento sigue vacía");
  }
  console.log("M5C-17 flujo mixto sigue ausente OK");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M5C OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count: bill } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("titular_email", EMAIL);
    const { count: res } = await supabaseAdmin.from("reservas")
      .select("*", { count: "exact", head: true }).eq("nombre", MARCA);
    console.log(`limpieza: ${bill ?? 0} billeteras y ${res ?? 0} reservas con la marca (deben ser 0 y 0)`);
  });

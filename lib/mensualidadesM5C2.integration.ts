import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_SESION, crearSesion } from "@/lib/mensualidadSesion";
import { cancelarReserva, reprogramarReserva } from "@/lib/mensualidadesGestionReserva";
import { cancelarReservaAdmin, cambiarBloqueo } from "@/lib/mensualidadesAdminAcciones";
import { bloquesDeAgenda, fechasPublicasPara, horariosPosiblesPara, sumarDias } from "@/lib/agenda";
import { simuladoresLibresDelDia } from "@/lib/disponibilidad";

// Integración del hotfix M7.3 / M5C.2 contra la DB REAL.
//
// Dos errores que encontró la validación visual de M7:
//
//   1. El movimiento de devolución decía siempre actor 'titular', aunque hubiera
//      cancelado un administrador desde el panel. La auditoría sí lo registraba
//      bien, pero el LIBRO MAYOR atribuía mal, que es el registro que se mira
//      cuando hay que explicar un saldo.
//   2. El mensaje del corte de 24 h decía "Para reprogramar faltan más de 24
//      horas" justo cuando faltaban MENOS. Lo veía el titular en Mi Plan.
//
// Todo lo que se prueba acá FALLA con el estado anterior.
//
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM5C2.integration.ts

const MARCA = `ZZ M7.3 ${Date.now()}`;
const EMAIL = `m5c2-${Date.now()}@test.local`;
const billeteras: string[] = [];

let seq = 0;
const nuevoTel = () => `2966${String(300000 + (Date.now() % 90000) + seq++).slice(-6)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let k = 0;
const clave = () => `k${String(Date.now()).slice(-8)}m5c2${String(k++).padStart(4, "0")}`.slice(0, 60);
const CTX = () => ({ actor: "admin", rol: "admin" as const, idempotencyKey: clave() });

async function hoyCordoba() {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}

async function crearBilletera(saldo = 600): Promise<string> {
  const hoy = await hoyCordoba();
  const t = nuevoTel();
  const { data, error } = await supabaseAdmin.from("mensualidades").insert({
    codigo: nuevoCodigo(), titular_nombre: MARCA, titular_apellido: "Prueba",
    titular_telefono: t, telefono_norm: t, titular_email: EMAIL,
    saldo_minutos: saldo, vence_el: sumarDias(hoy, 40),
  }).select("id").single();
  if (error) throw new Error(`crearBilletera: ${error.message}`);
  billeteras.push(data.id as string);
  return data.id as string;
}

const saldoDe = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidades").select("saldo_minutos").eq("id", id).single();
  return Number(data?.saldo_minutos);
};
const devoluciones = async (reservaId: number) => {
  const { data } = await supabaseAdmin.from("mensualidad_movimientos")
    .select("tipo, minutos, actor, saldo_anterior, saldo_posterior")
    .eq("reserva_id", reservaId).eq("tipo", "devolucion");
  return data ?? [];
};
const slotsActivos = async (reservaId: number) => {
  const { count } = await supabaseAdmin.from("reserva_slots")
    .select("*", { count: "exact", head: true }).eq("reserva_id", reservaId).eq("estado", "activa");
  return count ?? 0;
};
const auditoriaDe = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidad_auditoria")
    .select("accion, actor, actor_rol, referencia").eq("mensualidad_id", id);
  return data ?? [];
};

async function reservar(mid: string, fecha: string, duracion = 30) {
  const d = await simuladoresLibresDelDia({ fecha, duracion, producto: "mensualidad" });
  const posibles = horariosPosiblesPara("mensualidad", fecha, duracion);
  const hora = d.ok
    ? d.horarios.filter((h) => h.simuladores.length === 4 && posibles.includes(h.hora)).slice(-1)[0]?.hora
    : undefined;
  if (!hora) throw new Error(`sin horario libre el ${fecha}`);
  const { data, error } = await supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: mid, p_fecha: fecha, p_hora: hora, p_duracion: duracion,
    p_simuladores: ["Ferrari", "McLaren"],
    p_slots: bloquesDeAgenda(fecha, hora, duracion) ?? [hora],
    p_idempotency_key: clave(), p_condiciones_version: "cond-m5c2",
  });
  if (error) throw new Error(`reservar: ${error.message}`);
  const f = (Array.isArray(data) ? data[0] : data) as { reserva_id: number; referencia_publica: string };
  return { id: Number(f.reserva_id), ref: f.referencia_publica };
}

/** Una hora de ese día en la que los cuatro simuladores estén libres AHORA. */
async function horaLibre(fecha: string, duracion: number): Promise<string> {
  const d = await simuladoresLibresDelDia({ fecha, duracion, producto: "mensualidad" });
  const posibles = horariosPosiblesPara("mensualidad", fecha, duracion);
  const hora = d.ok
    ? d.horarios.filter((h) => h.simuladores.length === 4 && posibles.includes(h.hora)).slice(-1)[0]?.hora
    : undefined;
  if (!hora) throw new Error(`sin horario libre el ${fecha} para ${duracion} min`);
  return hora;
}

/** Acerca una reserva en el tiempo. La RPC no deja crear turnos a menos de 24 h. */
async function moverA(reservaId: number, offsetMs: number) {
  const t = new Date(Date.now() + offsetMs - 3 * 3600_000); // Córdoba, UTC-3 fijo
  await supabaseAdmin.from("reservas").update({
    fecha: t.toISOString().slice(0, 10), hora: t.toISOString().slice(11, 16),
  }).eq("id", reservaId);
}

async function limpiar() {
  const ids = Array.from(new Set(billeteras));
  if (ids.length) {
    const { data: rs } = await supabaseAdmin.from("reservas").select("id").in("mensualidad_id", ids);
    const rids = (rs ?? []).map((r) => Number(r.id));
    if (rids.length) {
      await supabaseAdmin.from("mensualidad_movimientos").delete().in("reserva_id", rids);
      await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", rids);
      await supabaseAdmin.from("reservas").delete().in("id", rids);
    }
    await supabaseAdmin.from("mensualidad_auditoria").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  }
  await supabaseAdmin.from("mensualidades").delete().eq("titular_email", EMAIL);
  await supabaseAdmin.from("reservas").delete().like("nombre", "ZZ M7.3%");
}

async function main() {
  const hoy = await hoyCordoba();
  const habiles = fechasPublicasPara("mensualidad", hoy);
  assert.ok(habiles.length >= 6, "hacen falta días hábiles en la ventana");

  const contar = async (t: string) =>
    (await supabaseAdmin.from(t).select("*", { count: "exact", head: true })).count ?? 0;
  const antes = {
    mensualidades: await contar("mensualidades"), compras: await contar("mensualidad_compras"),
    movimientos: await contar("mensualidad_movimientos"), auditoria: await contar("mensualidad_auditoria"),
    sesiones: await contar("mensualidad_sesiones"), planes: await contar("mensualidad_planes"),
    pagos: await contar("mensualidad_reserva_pagos"), reservas: await contar("reservas"),
    slots: await contar("reserva_slots"), bloqueos: await contar("bloqueos_reservas"),
  };
  console.log(`contadores antes: ${JSON.stringify(antes)}`);

  // ── 1 · Cancela el TITULAR: el libro dice 'titular' ──────────────────────
  {
    const m = await crearBilletera(600);
    const r = await reservar(m, habiles[2]);
    const c = await cancelarReserva(m, r.ref, clave());
    assert.ok(c.ok && c.data.restituyo, "M5C2-1 con más de 24 h restituye");

    const movs = await devoluciones(r.id);
    assert.equal(movs.length, 1, "M5C2-1 un solo movimiento de devolución");
    assert.equal(movs[0].tipo, "devolucion");
    assert.equal(movs[0].actor, "titular", "M5C2-1 lo canceló el titular y el libro lo dice");
    assert.equal(movs[0].minutos, 60);
  }
  console.log("M5C2-1 cancelación del titular → actor 'titular' OK");

  // ── 2 · Cancela la ADMINISTRACIÓN: el libro dice 'admin' ─────────────────
  // Este es el caso que fallaba: antes escribía 'titular'.
  {
    const m = await crearBilletera(600);
    const r = await reservar(m, habiles[3]);
    const saldoAntes = await saldoDe(m);

    const c = await cancelarReservaAdmin(m, r.ref, "el cliente llamó y no puede venir", CTX());
    assert.ok(c.ok, `M5C2-2 la administración cancela: ${!c.ok ? c.error : ""}`);
    if (c.ok) assert.equal(c.data.restituyo, true);

    const movs = await devoluciones(r.id);
    assert.equal(movs.length, 1, "M5C2-2 un solo movimiento");
    assert.equal(movs[0].tipo, "devolucion");
    assert.equal(movs[0].actor, "admin",
      "M5C2-2 canceló la administración: el libro mayor tiene que decir 'admin'");
    assert.equal(await saldoDe(m), saldoAntes + 60, "M5C2-2 restituyó una vez");

    const aud = await auditoriaDe(m);
    const linea = aud.find((a) => a.accion === "cancelar_reserva");
    assert.ok(linea, "M5C2-2 quedó auditado");
    assert.equal(linea!.actor, "admin", "M5C2-2 la auditoría también dice admin");
    assert.equal(linea!.actor_rol, "admin");
    assert.equal(linea!.referencia, r.ref);
  }
  console.log("M5C2-2 cancelación administrativa → actor 'admin' OK");

  // ── 3 · Billetera BLOQUEADA: se sigue pudiendo cancelar, con actor correcto ──
  {
    const m = await crearBilletera(600);
    const r = await reservar(m, habiles[4]);
    const b = await cambiarBloqueo(m, true, "prueba de bloqueo", CTX());
    assert.ok(b.ok, "M5C2-3 se bloquea");

    const c = await cancelarReservaAdmin(m, r.ref, "cancelación con la billetera bloqueada", CTX());
    assert.ok(c.ok, `M5C2-3 bloquear NO impide cancelar: ${!c.ok ? c.error : ""}`);

    const movs = await devoluciones(r.id);
    assert.equal(movs.length, 1);
    assert.equal(movs[0].actor, "admin", "M5C2-3 y el actor sigue siendo el correcto");
  }
  console.log("M5C2-3 bloqueada: cancela igual y con el actor correcto OK");

  // ── 4 · Administración con MENOS de 24 h: cancela, libera, NO restituye ──
  {
    const m = await crearBilletera(600);
    const r = await reservar(m, habiles[5]);
    const saldoAntes = await saldoDe(m);
    await moverA(r.id, 20 * 3600_000);

    const c = await cancelarReservaAdmin(m, r.ref, "avisó tarde", CTX());
    assert.ok(c.ok, "M5C2-4 se cancela igual");
    if (c.ok) {
      assert.equal(c.data.restituyo, false, "M5C2-4 a menos de 24 h NO restituye");
      assert.equal(c.data.minutos_restituidos, 0);
    }
    assert.equal(await devoluciones(r.id).then((x) => x.length), 0,
      "M5C2-4 sin restitución NO hay ningún movimiento nuevo");
    assert.equal(await saldoDe(m), saldoAntes, "M5C2-4 el saldo queda intacto");
    assert.equal(await slotsActivos(r.id), 0, "M5C2-4 pero los slots SÍ se liberan");
  }
  console.log("M5C2-4 administración a menos de 24 h: sin devolución OK");

  // ── 5 · Cancelación DUPLICADA: un solo movimiento, actor estable ─────────
  {
    const m = await crearBilletera(600);
    const r = await reservar(m, habiles[2], 15);
    await cancelarReservaAdmin(m, r.ref, "primera", CTX());
    const saldo1 = await saldoDe(m);
    const dos = await cancelarReservaAdmin(m, r.ref, "segunda", CTX());
    const tres = await cancelarReserva(m, r.ref, clave());   // ahora por el flujo del titular
    assert.ok(dos.ok && tres.ok, "M5C2-5 los reintentos responden sin romper");

    const movs = await devoluciones(r.id);
    assert.equal(movs.length, 1, "M5C2-5 sigue habiendo UN solo movimiento");
    assert.equal(movs[0].actor, "admin",
      "M5C2-5 el actor del primero manda: un reintento no lo reescribe");
    assert.equal(await saldoDe(m), saldo1, "M5C2-5 no devuelve de nuevo");
  }
  console.log("M5C2-5 cancelación duplicada: un movimiento, actor estable OK");

  // ── 6 · Dos cancelaciones CONCURRENTES ──────────────────────────────────
  {
    const m = await crearBilletera(600);
    const r = await reservar(m, habiles[3], 15);
    const saldoAntes = await saldoDe(m);
    const [a, b] = await Promise.all([
      cancelarReservaAdmin(m, r.ref, "concurrente A", CTX()),
      cancelarReserva(m, r.ref, clave()),
    ]);
    assert.ok(a.ok && b.ok, "M5C2-6 las dos responden");

    const movs = await devoluciones(r.id);
    assert.equal(movs.length, 1, "M5C2-6 un solo movimiento");
    assert.ok(["admin", "titular"].includes(String(movs[0].actor)),
      "M5C2-6 el actor es el de quien ganó, no un valor inventado");
    assert.equal(await saldoDe(m), saldoAntes + 30, "M5C2-6 se restituyó UNA sola vez");
  }
  console.log("M5C2-6 cancelaciones concurrentes: un movimiento OK");

  // ── 7 · Actor MANIPULADO desde el cliente: se ignora ─────────────────────
  // Se invoca el route handler público de verdad, con un cuerpo que intenta
  // atribuirse 'admin'. La ruta no lee ese campo y la RPC recibe 'titular'.
  {
    const { POST } = await import("@/app/api/mensualidades/reservas/cancelar/route");
    const flagPrevia = process.env.MENSUALIDADES_ENABLED;
    process.env.MENSUALIDADES_ENABLED = "true";

    const m = await crearBilletera(600);
    const r = await reservar(m, habiles[4], 15);
    const token = (await crearSesion(m))!;

    const res = await POST(new Request("https://simexperience.com.ar/api/mensualidades/reservas/cancelar", {
      method: "POST",
      headers: {
        origin: "https://simexperience.com.ar", "content-type": "application/json",
        "x-real-ip": "10.9.1.1", cookie: `${COOKIE_SESION}=${token}`,
      },
      // Todas las formas de intentar atribuirse la cancelación.
      body: JSON.stringify({
        referencia: r.ref, idempotency_key: clave(),
        actor: "admin", p_actor: "admin", actor_rol: "admin", rol: "admin",
      }),
    }));
    assert.equal(res.status, 200, "M5C2-7 la cancelación del titular se procesa igual");

    const movs = await devoluciones(r.id);
    assert.equal(movs.length, 1);
    assert.equal(movs[0].actor, "titular",
      "M5C2-7 el actor enviado por el cliente se IGNORA: nadie se atribuye 'admin'");

    if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
    else delete process.env.MENSUALIDADES_ENABLED;
  }
  console.log("M5C2-7 actor manipulado desde el cliente: ignorado OK");

  // ── 8 · Un actor fuera de la lista no escribe nada ───────────────────────
  // La RPC es la autoridad: aunque alguien la llamara directo con service_role.
  {
    const m = await crearBilletera(600);
    const r = await reservar(m, habiles[5], 15);
    const { error } = await supabaseAdmin.rpc("cancelar_reserva_mensualidad", {
      p_mensualidad_id: m, p_referencia: r.ref, p_idempotency_key: clave(),
      p_actor: "staff",
    });
    assert.ok(String(error?.message).includes("actor_invalido"),
      `M5C2-8 'staff' no es un actor válido (fue: ${error?.message})`);
    const { data: viva } = await supabaseAdmin.from("reservas")
      .select("estado").eq("id", r.id).single();
    assert.equal(viva!.estado, "activa", "M5C2-8 y la reserva no se tocó");
    assert.equal(await devoluciones(r.id).then((x) => x.length), 0);
  }
  console.log("M5C2-8 actor fuera de la lista cerrada: rechazado OK");

  // ── 9 · El corte de 24 h y su MENSAJE ────────────────────────────────────
  {
    const m = await crearBilletera(600);
    // Dos destinos DISTINTOS y con horas REALMENTE libres: la disponibilidad se
    // consulta en el momento, porque los casos anteriores dejaron turnos vivos y
    // una colisión daría 'turno_ocupado' antes de llegar al chequeo del plazo.
    const destinoA = habiles[3];
    const destinoB = habiles[5];

    // 24 h + margen: se puede reprogramar.
    const rOk = await reservar(m, habiles[2]);
    await moverA(rOk.id, 24 * 3600_000 + 5 * 60_000);
    const p1 = await reprogramarReserva(m, rOk.ref, destinoA, await horaLibre(destinoA, 30), clave());
    assert.ok(p1.ok, `M5C2-9 a 24 h y 5 min SÍ se reprograma: ${!p1.ok ? p1.error : ""}`);

    // 23 h 59 min: no se puede, y el mensaje tiene que ser el correcto.
    const rNo = await reservar(m, habiles[4]);
    await moverA(rNo.id, 23 * 3600_000 + 59 * 60_000);
    const p2 = await reprogramarReserva(m, rNo.ref, destinoB, await horaLibre(destinoB, 30), clave());
    assert.equal(p2.ok, false, "M5C2-9 a 23 h 59 min NO se reprograma");
    if (!p2.ok) {
      assert.equal(p2.codigo, "fuera_de_plazo");
      assert.equal(p2.status, 409);
      assert.match(p2.error, /al menos 24 horas de anticipación/,
        "M5C2-9 el mensaje dice la regla, no lo contrario");
      assert.ok(!/faltan más de 24/.test(p2.error),
        "M5C2-9 no puede quedar la frase invertida");
    }

    // Cancelar sigue permitido en los dos casos, y sin devolver a menos de 24 h.
    const saldoAntes = await saldoDe(m);
    const c = await cancelarReserva(m, rNo.ref, clave());
    assert.ok(c.ok && c.data.restituyo === false, "M5C2-9 cancelar sí, sin devolver");
    assert.equal(await saldoDe(m), saldoAntes, "M5C2-9 el saldo no se movió");
    assert.equal(await slotsActivos(rNo.id), 0, "M5C2-9 los slots se liberaron igual");
  }
  console.log("M5C2-9 corte de 24 h y mensaje correcto OK");

  await limpiar();
  billeteras.length = 0;
  const despues = {
    mensualidades: await contar("mensualidades"), compras: await contar("mensualidad_compras"),
    movimientos: await contar("mensualidad_movimientos"), auditoria: await contar("mensualidad_auditoria"),
    sesiones: await contar("mensualidad_sesiones"), planes: await contar("mensualidad_planes"),
    pagos: await contar("mensualidad_reserva_pagos"), reservas: await contar("reservas"),
    slots: await contar("reserva_slots"), bloqueos: await contar("bloqueos_reservas"),
  };
  console.log(`contadores después: ${JSON.stringify(despues)}`);
  assert.deepEqual(despues, antes, "la suite deja la base exactamente como estaba");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M5C.2 OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("titular_email", EMAIL);
    console.log(`limpieza: ${count ?? 0} billeteras con la marca (debe ser 0)`);
  });

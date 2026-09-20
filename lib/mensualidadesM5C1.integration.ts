import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_SESION, crearSesion } from "@/lib/mensualidadSesion";
import { cancelarReserva, reprogramarReserva } from "@/lib/mensualidadesGestionReserva";
import { validarSeleccion } from "@/lib/mensualidadesReserva";
import { disponibilidadDelDia, simuladoresLibresDelDia } from "@/lib/disponibilidad";
import {
  bloquesDeAgenda, diaHabilitadoPara, diasEntre, fechasPublicas, fechasPublicasPara,
  horariosPosiblesPara, sumarDias, REGLAS_POR_PRODUCTO,
} from "@/lib/agenda";

// Integración del Bloque M5C.1 contra la DB REAL: las restricciones que son
// EXCLUSIVAS de Mensualidades, comprobadas en las tres capas donde tienen que
// regir —validación, RPC y pantallas— y en los dos sentidos:
//
//   · Mensualidades queda restringida: lunes a viernes, de 10:00 a 22:00 con la
//     experiencia terminada al cierre, 15/30/45/60 y de 2 a 4 simuladores.
//   · Reservas normales NO cambia: mismos días, mismas duraciones, un simulador
//     sigue siendo una selección válida. El motor de disponibilidad es el mismo
//     y lo que cambia es el filtro por producto.
//
// Nada acá depende de qué simulador sea cuál: las reglas son por CANTIDAD.
//
// Todos los datos son TEMPORALES, llevan MARCA y se borran en el `finally`.
//
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM5C1.integration.ts

const MARCA = `zzm5c1_${Date.now()}`;
const EMAIL = `${MARCA}@test.local`;
const billeteras: string[] = [];
const reservasSueltas: number[] = [];
const bloqueos: number[] = [];

let seq = 0;
const nuevoTel = () => `296698${String((Date.now() % 10_000) + seq++).padStart(4, "0").slice(-4)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let k = 0;
const clave = () => `k${MARCA}${String(k++).padStart(4, "0")}`.slice(0, 60);

const DOS = ["Ferrari", "McLaren"];
const TRES = ["Ferrari", "McLaren", "Red Bull"];
const CUATRO = ["Ferrari", "McLaren", "Red Bull", "Alpine"];

async function hoyCordoba(): Promise<string> {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}

async function crearBilletera(saldo = 900, diasVence = 40): Promise<string> {
  const hoy = await hoyCordoba();
  const tel = nuevoTel();
  const { data, error } = await supabaseAdmin.from("mensualidades").insert({
    codigo: nuevoCodigo(), titular_nombre: "Probe", titular_apellido: MARCA,
    titular_telefono: tel, telefono_norm: tel, titular_email: EMAIL,
    saldo_minutos: saldo, vence_el: sumarDias(hoy, diasVence),
  }).select("id").single();
  if (error) throw new Error(`crearBilletera: ${error.message}`);
  billeteras.push(data.id as string);
  return data.id as string;
}

/** Llama a la RPC directamente, como haría el módulo servidor. */
async function rpcCrear(args: {
  mid: string; fecha: string; hora: string; duracion: number; sims: string[]; slots?: string[];
}) {
  return supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: args.mid, p_fecha: args.fecha, p_hora: args.hora,
    p_duracion: args.duracion, p_simuladores: args.sims,
    p_slots: args.slots ?? bloquesDeAgenda(args.fecha, args.hora, args.duracion) ?? [args.hora],
    p_idempotency_key: clave(), p_condiciones_version: "cond-m5c1",
  });
}

const saldoDe = async (mid: string) => {
  const { data } = await supabaseAdmin.from("mensualidades")
    .select("saldo_minutos").eq("id", mid).single();
  return Number(data?.saldo_minutos);
};
const estadoDe = async (referencia: string) => {
  const { data } = await supabaseAdmin.from("reservas")
    .select("estado, fecha, hora, simuladores, duracion_minutos, cancelacion_resultado")
    .eq("referencia_publica", referencia).single();
  return data!;
};
const slotsActivos = async (reservaId: number) => {
  const { count } = await supabaseAdmin.from("reserva_slots")
    .select("*", { count: "exact", head: true })
    .eq("reserva_id", reservaId).eq("estado", "activa");
  return count ?? 0;
};

let ipSeq = 0;
function pedido(url: string, opts: { metodo?: string; cookie?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    origin: "https://simexperience.com.ar",
    "x-real-ip": `10.7.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`,
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = `${COOKIE_SESION}=${opts.cookie}`;
  return new Request(`https://simexperience.com.ar${url}`, {
    method: opts.metodo ?? "GET", headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function limpiar() {
  const ids = Array.from(new Set(billeteras));
  const { data: rs } = ids.length
    ? await supabaseAdmin.from("reservas").select("id").in("mensualidad_id", ids)
    : { data: [] as { id: number }[] };
  const rids = Array.from(new Set([...(rs ?? []).map((r) => Number(r.id)), ...reservasSueltas]));
  if (rids.length) {
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reservas").delete().in("id", rids);
  }
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  }
  if (bloqueos.length) {
    await supabaseAdmin.from("bloqueos_reservas").delete().in("id", bloqueos);
  }
  // Redes de seguridad por marcador.
  await supabaseAdmin.from("bloqueos_reservas").delete().eq("motivo", MARCA);
  await supabaseAdmin.from("mensualidades").delete().eq("titular_email", EMAIL);
  await supabaseAdmin.from("reservas").delete().eq("nombre", MARCA);
}

/** Horarios de ese día en los que los cuatro simuladores están libres. */
async function librisimos(fecha: string, duracion: number): Promise<string[]> {
  const d = await simuladoresLibresDelDia({ fecha, duracion, producto: "mensualidad" });
  if (!d.ok) return [];
  const posibles = horariosPosiblesPara("mensualidad", fecha, duracion);
  return d.horarios
    .filter((h) => h.simuladores.length === 4 && posibles.includes(h.hora))
    .map((h) => h.hora);
}

async function main() {
  const flagPrevia = process.env.MENSUALIDADES_ENABLED;
  const { POST: postReservar } = await import("@/app/api/mensualidades/reservar/route");
  const { GET: getDisp } = await import("@/app/api/mensualidades/disponibilidad/route");
  const { POST: postCancelar } = await import("@/app/api/mensualidades/reservas/cancelar/route");
  const { POST: postReprogramar } = await import("@/app/api/mensualidades/reservas/reprogramar/route");

  const hoy = await hoyCordoba();
  const ventana = fechasPublicas(hoy);
  const habiles = fechasPublicasPara("mensualidad", hoy);
  const noHabiles = ventana.filter((f) => !diaHabilitadoPara("mensualidad", f));
  assert.ok(habiles.length >= 7, "la ventana necesita al menos siete días hábiles");
  assert.ok(noHabiles.length >= 4, "quince días corridos tienen al menos dos fines de semana");

  const dow = (f: string) => {
    const [y, m, d] = f.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };
  const LUNES = habiles.find((f) => dow(f) === 1)!;
  const VIERNES = habiles.find((f) => dow(f) === 5)!;
  const SABADO = noHabiles.find((f) => dow(f) === 6)!;
  const DOMINGO = noHabiles.find((f) => dow(f) === 0)!;
  assert.ok(LUNES && VIERNES && SABADO && DOMINGO, "la ventana tiene lunes, viernes, sábado y domingo");

  // Contadores ANTES, para poder demostrar al final que no quedó nada.
  const contar = async (tabla: string) => {
    const { count } = await supabaseAdmin.from(tabla).select("*", { count: "exact", head: true });
    return count ?? 0;
  };
  const antes = {
    reservas: await contar("reservas"),
    slots: await contar("reserva_slots"),
    movimientos: await contar("mensualidad_movimientos"),
    mensualidades: await contar("mensualidades"),
    bloqueos: await contar("bloqueos_reservas"),
  };
  console.log(`base: hoy=${hoy} lun=${LUNES} vie=${VIERNES} sáb=${SABADO} dom=${DOMINGO}`);
  console.log(`contadores antes: ${JSON.stringify(antes)}`);

  process.env.MENSUALIDADES_ENABLED = "true";

  // ── A · DÍAS: lunes a viernes, nunca fin de semana ───────────────────────
  {
    const mid = await crearBilletera();
    const tok = (await crearSesion(mid))!;

    // A1 · Lunes y viernes reales de la ventana: la reserva se crea.
    for (const [nota, fecha] of [["lunes", LUNES], ["viernes", VIERNES]] as const) {
      const horas = await librisimos(fecha, 30);
      assert.ok(horas.length, `M5C1-A1 hace falta un horario libre el ${nota}`);
      const res = await postReservar(pedido("/api/mensualidades/reservar", {
        metodo: "POST", cookie: tok,
        body: {
          fecha, hora: horas[horas.length - 1], duracion_minutos: 30,
          simuladores: DOS, acepto_condiciones: true, idempotency_key: clave(),
        },
      }));
      assert.equal(res.status, 201, `M5C1-A1 ${nota} es un día habilitado`);
    }

    // A2 · Sábado y domingo: rechazados en las tres capas.
    for (const [nota, fecha] of [["sábado", SABADO], ["domingo", DOMINGO]] as const) {
      const v = validarSeleccion({
        fecha, hora: "11:00", duracion_minutos: 30, simuladores: DOS,
        acepto_condiciones: true, idempotency_key: clave(),
      }, hoy);
      assert.equal(v.ok, false, `M5C1-A2 ${nota}: la validación lo corta`);
      if (!v.ok) assert.equal(v.codigo, "dia_no_habilitado");

      const res = await postReservar(pedido("/api/mensualidades/reservar", {
        metodo: "POST", cookie: tok,
        body: {
          fecha, hora: "11:00", duracion_minutos: 30, simuladores: DOS,
          acepto_condiciones: true, idempotency_key: clave(),
        },
      }));
      assert.equal(res.status, 422, `M5C1-A2 ${nota}: el endpoint responde 422`);
      assert.equal((await res.json()).codigo, "dia_no_habilitado");

      // Y la RPC tampoco, aunque se la llame directo con todo bien armado.
      const r = await rpcCrear({ mid, fecha, hora: "11:00", duracion: 30, sims: DOS });
      assert.ok(String(r.error?.message).includes("dia_no_habilitado"),
        `M5C1-A2 ${nota}: la base lo rechaza sola (fue: ${r.error?.message})`);
    }

    // A3 · La disponibilidad no ofrece esos días ni esas fechas.
    const dispSab = await simuladoresLibresDelDia({ fecha: SABADO, duracion: 30, producto: "mensualidad" });
    assert.equal(dispSab.ok, false, "M5C1-A3 no hay disponibilidad de Mensualidades el sábado");
    const dto = await (await getDisp(pedido(
      `/api/mensualidades/disponibilidad?fecha=${LUNES}&duracion=30`, { cookie: tok },
    ))).json();
    assert.equal(dto.fechas.includes(SABADO), false, "M5C1-A3 el sábado no está en el calendario");
    assert.equal(dto.fechas.includes(DOMINGO), false, "M5C1-A3 el domingo tampoco");
    assert.equal(dto.fechas.every((f: string) => diaHabilitadoPara("mensualidad", f)), true);
    // (M8C) El DTO publica los límites de dominio, sean los que sean: se
    // comparan contra REGLAS_POR_PRODUCTO en vez de contra números escritos a
    // mano, para que cambiar la regla no obligue a tocar este archivo.
    assert.equal(dto.simuladores_min, REGLAS_POR_PRODUCTO.mensualidad.simuladoresMin,
      "M5C1-A3 el DTO publica el mínimo de dominio");
    assert.equal(dto.simuladores_max, REGLAS_POR_PRODUCTO.mensualidad.simuladoresMax,
      "M5C1-A3 y el máximo");
    assert.equal(dto.simuladores_min, 1, "M5C1-A3 que hoy es 1");
    assert.equal(dto.simuladores_max, 4, "M5C1-A3 y 4");

    // A4 · El saldo no se movió por ninguno de los rechazos.
    const consumido = 30 * 2 * 2; // las dos reservas válidas de arriba
    assert.equal(await saldoDe(mid), 900 - consumido,
      "M5C1-A4 solo descontaron las reservas válidas");

    await limpiar();
    billeteras.length = 0;
  }
  console.log("M5C1-A días hábiles: lunes/viernes sí, sábado/domingo no OK");

  // ── B · HORARIO: de 10:00 a 22:00, terminando al cierre ──────────────────
  {
    const mid = await crearBilletera();

    // B1 · Antes de las 10:00 no hay agenda.
    for (const hora of ["08:00", "09:00", "09:40"]) {
      const v = validarSeleccion({
        fecha: LUNES, hora, duracion_minutos: 15, simuladores: DOS,
        acepto_condiciones: true, idempotency_key: clave(),
      }, hoy);
      assert.equal(v.ok, false, `M5C1-B1 ${hora} es antes de abrir`);
      if (!v.ok) assert.equal(v.codigo, "hora_invalida");
    }

    // B2 · El cierre, medido en la base: terminar 22:00 vale, un minuto más no.
    const cierre = async (hora: string, duracion: number) => {
      const { data, error } = await supabaseAdmin
        .rpc("mensualidad_termina_antes_del_cierre", { p_hora: hora, p_duracion: duracion });
      assert.ok(!error, `mensualidad_termina_antes_del_cierre: ${error?.message}`);
      return data as boolean;
    };
    for (const [hora, dur] of [["21:45", 15], ["21:30", 30], ["21:15", 45], ["21:00", 60]] as const) {
      assert.equal(await cierre(hora, dur), true, `M5C1-B2 ${hora}+${dur} termina 22:00 justo`);
    }
    for (const [hora, dur] of [["21:46", 15], ["21:31", 30], ["21:16", 45], ["21:01", 60]] as const) {
      assert.equal(await cierre(hora, dur), false, `M5C1-B2 ${hora}+${dur} se pasa del cierre`);
    }

    // Y la RPC lo aplica: un horario manipulado que termina 22:05 no entra.
    const tarde = await rpcCrear({
      mid, fecha: LUNES, hora: "21:50", duracion: 15, sims: DOS, slots: ["21:50"],
    });
    assert.ok(String(tarde.error?.message).includes("fuera_de_horario"),
      `M5C1-B2 la base corta el turno que termina después de las 22:00 (fue: ${tarde.error?.message})`);
    assert.equal(await saldoDe(mid), 900, "M5C1-B2 y no descontó nada");

    // B3 · El último inicio real de cada duración sí entra.
    const ultimos: Array<[number, string]> = [[15, "21:40"], [30, "21:20"], [45, "21:00"], [60, "20:40"]];
    for (const [dur, hora] of ultimos) {
      const posibles = horariosPosiblesPara("mensualidad", LUNES, dur);
      assert.equal(posibles[posibles.length - 1], hora,
        `M5C1-B3 el último inicio de ${dur} min es ${hora}`);
      const v = validarSeleccion({
        fecha: LUNES, hora, duracion_minutos: dur, simuladores: DOS,
        acepto_condiciones: true, idempotency_key: clave(),
      }, hoy);
      assert.equal(v.ok, true, `M5C1-B3 ${dur} min a las ${hora} es válido`);
    }

    await limpiar();
    billeteras.length = 0;
  }
  console.log("M5C1-B horario 10:00-22:00 con cierre inclusivo OK");

  // ── C · CANTIDAD: 1, 2, 3 o 4 simuladores. Nunca 0, nunca 5 ──────────────
  // (M8C) El mínimo bajó de 2 a 1. Antes este bloque comprobaba lo contrario:
  // que un solo simulador fuera rechazado en las tres capas.
  {
    const mid = await crearBilletera();
    const tok = (await crearSesion(mid))!;
    const horas = await librisimos(VIERNES, 15);
    assert.ok(horas.length >= 4, "M5C1-C hacen falta cuatro horarios libres");
    const [h1, h2, h3, h4] = horas.slice(-4);

    // C1 · Uno solo: ACEPTADO en las tres capas y consume 15, no 30.
    const v1 = validarSeleccion({
      fecha: VIERNES, hora: h1, duracion_minutos: 15, simuladores: ["Ferrari"],
      acepto_condiciones: true, idempotency_key: clave(),
    }, hoy);
    assert.equal(v1.ok, true, "M5C1-C1 un simulador pasa la validación");

    const res1 = await postReservar(pedido("/api/mensualidades/reservar", {
      metodo: "POST", cookie: tok,
      body: {
        fecha: VIERNES, hora: h1, duracion_minutos: 15, simuladores: ["Ferrari"],
        acepto_condiciones: true, idempotency_key: clave(),
      },
    }));
    assert.equal(res1.status, 201, "M5C1-C1 el endpoint la crea");
    const cuerpo1 = await res1.json();
    assert.equal(cuerpo1.minutos_consumidos, 15,
      "M5C1-C1 un simulador durante 15 minutos consume 15, no 30");
    assert.equal(await saldoDe(mid), 900 - 15, "M5C1-C1 el débito es exacto");

    // C1b · Cero simuladores: sigue siendo inválido en las tres capas.
    const v0 = validarSeleccion({
      fecha: VIERNES, hora: h2, duracion_minutos: 15, simuladores: [],
      acepto_condiciones: true, idempotency_key: clave(),
    }, hoy);
    assert.equal(v0.ok, false, "M5C1-C1b cero no pasa la validación");
    if (!v0.ok) assert.equal(v0.codigo, "simuladores_invalidos");
    const rpc0 = await rpcCrear({ mid, fecha: VIERNES, hora: h2, duracion: 15, sims: [] });
    assert.ok(String(rpc0.error?.message).includes("cantidad_simuladores_invalida"),
      `M5C1-C1b la base rechaza cero (fue: ${rpc0.error?.message})`);

    // C2 · Dos, tres y cuatro: se crean, y consumen duración x cantidad.
    let esperado = 900 - 15;
    for (const [hora, sims] of [[h2, DOS], [h3, TRES], [h4, CUATRO]] as const) {
      const r = await rpcCrear({ mid, fecha: VIERNES, hora, duracion: 15, sims: [...sims] });
      assert.ok(!r.error, `M5C1-C2 ${sims.length} simuladores tienen que entrar: ${r.error?.message}`);
      esperado -= 15 * sims.length;
      assert.equal(await saldoDe(mid), esperado, `M5C1-C2 15 x ${sims.length} descontados`);
    }

    // C3 · Cinco: rechazado (además de que no existen cinco simuladores).
    const rpc5 = await rpcCrear({
      mid, fecha: VIERNES, hora: h1, duracion: 15, sims: [...CUATRO, "Ferrari"],
    });
    assert.ok(String(rpc5.error?.message).includes("cantidad_simuladores_invalida"),
      `M5C1-C3 cinco no entran (fue: ${rpc5.error?.message})`);
    const v5 = validarSeleccion({
      fecha: VIERNES, hora: h1, duracion_minutos: 15, simuladores: [...CUATRO, "Ferrari"],
      acepto_condiciones: true, idempotency_key: clave(),
    }, hoy);
    assert.equal(v5.ok, false, "M5C1-C3 la validación tampoco");
    assert.equal(await saldoDe(mid), esperado, "M5C1-C3 ningún rechazo tocó el saldo");

    await limpiar();
    billeteras.length = 0;
  }
  console.log("M5C1-C cantidad de simuladores 1/2/3/4 OK");

  // ── D · VENTANA Y VIGENCIA ───────────────────────────────────────────────
  {
    const mid = await crearBilletera();

    // D1 · El mismo día, nunca.
    const rHoy = await rpcCrear({ mid, fecha: hoy, hora: "11:00", duracion: 15, sims: DOS });
    assert.ok(rHoy.error, "M5C1-D1 hoy no se reserva");
    assert.match(String(rHoy.error?.message), /fecha_fuera_de_ventana|dia_no_habilitado/,
      "M5C1-D1 por la ventana o por el día, según qué día sea hoy");

    // D2 · El primer día hábil de la ventana sí.
    const primero = habiles[0];
    const horasPrimero = await librisimos(primero, 15);
    assert.ok(horasPrimero.length, "M5C1-D2 hace falta un horario libre el primer día hábil");
    const rPrimero = await rpcCrear({
      mid, fecha: primero, hora: horasPrimero[horasPrimero.length - 1], duracion: 15, sims: DOS,
    });
    assert.ok(!rPrimero.error, `M5C1-D2 el primer día hábil entra: ${rPrimero.error?.message}`);

    // D3 · Más de 15 días, no. Se elige un día hábil para que el motivo sea la
    // ventana y no el día de la semana.
    const lejos = [16, 17, 18, 19, 20, 21, 22].map((i) => sumarDias(hoy, i))
      .find((f) => diaHabilitadoPara("mensualidad", f))!;
    const v = validarSeleccion({
      fecha: lejos, hora: "11:00", duracion_minutos: 15, simuladores: DOS,
      acepto_condiciones: true, idempotency_key: clave(),
    }, hoy);
    assert.equal(v.ok, false, "M5C1-D3 más de 15 días no se reserva");
    if (!v.ok) assert.equal(v.codigo, "fecha_fuera_de_ventana");

    // D4 · Posterior al vencimiento, no.
    const corta = await crearBilletera(300, diasEntre(hoy, habiles[0]));
    const tarde = habiles.find((f) => diasEntre(hoy, f) > diasEntre(hoy, habiles[0]))!;
    const horasTarde = await librisimos(tarde, 15);
    const rVenc = await rpcCrear({
      mid: corta, fecha: tarde, hora: horasTarde[horasTarde.length - 1], duracion: 15, sims: DOS,
    });
    assert.ok(String(rVenc.error?.message).includes("turno_posterior_al_vencimiento"),
      `M5C1-D4 después del vencimiento no (fue: ${rVenc.error?.message})`);
    assert.equal(await saldoDe(corta), 300, "M5C1-D4 sin descuento");

    await limpiar();
    billeteras.length = 0;
  }
  console.log("M5C1-D ventana de fechas y vigencia OK");

  // ── E · BLOQUEOS ADMINISTRATIVOS Y FERIADOS ──────────────────────────────
  {
    const mid = await crearBilletera();
    const horas = await librisimos(LUNES, 60);
    assert.ok(horas.length, "M5C1-E hace falta una ventana de 60 min libre");
    const h = horas[horas.length - 1];
    const bloques = bloquesDeAgenda(LUNES, h, 60)!;

    // E1 · Bloqueo de UN simulador en un bloque intermedio.
    const { data: b1 } = await supabaseAdmin.from("bloqueos_reservas").insert({
      fecha: LUNES, todo_el_dia: false, hora_inicio: bloques[1], hora_fin: bloques[1],
      simulador: "Ferrari", motivo: MARCA, activo: true,
    }).select("id").single();
    if (b1) bloqueos.push(b1.id as number);
    const rBloq = await rpcCrear({ mid, fecha: LUNES, hora: h, duracion: 60, sims: DOS });
    assert.ok(rBloq.error, "M5C1-E1 el bloqueo parcial impide reservar ese simulador");
    assert.equal(await saldoDe(mid), 900, "M5C1-E1 sin descuento");
    // Los otros dos siguen disponibles: el bloqueo es por simulador.
    const rOtros = await rpcCrear({ mid, fecha: LUNES, hora: h, duracion: 60, sims: ["Red Bull", "Alpine"] });
    assert.ok(!rOtros.error, `M5C1-E1 los no bloqueados sí: ${rOtros.error?.message}`);
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", b1!.id);

    // E2 · Feriado: bloqueo de día completo.
    const feriado = habiles[habiles.length - 1];
    const { data: b2 } = await supabaseAdmin.from("bloqueos_reservas").insert({
      fecha: feriado, todo_el_dia: true, motivo: MARCA, activo: true,
    }).select("id").single();
    if (b2) bloqueos.push(b2.id as number);
    const horasFeriado = horariosPosiblesPara("mensualidad", feriado, 15);
    const rFeriado = await rpcCrear({
      mid, fecha: feriado, hora: horasFeriado[horasFeriado.length - 1], duracion: 15, sims: DOS,
    });
    assert.ok(rFeriado.error, "M5C1-E2 un feriado bloqueado no admite reservas");
    // Y la disponibilidad tampoco lo ofrece.
    const dispFeriado = await disponibilidadDelDia({ fecha: feriado, duracion: 15, producto: "mensualidad" });
    assert.ok(dispFeriado.ok);
    if (dispFeriado.ok) {
      assert.equal(dispFeriado.horarios.length, 0, "M5C1-E2 el feriado no ofrece ningún horario");
    }
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", b2!.id);

    await limpiar();
    billeteras.length = 0;
    bloqueos.length = 0;
  }
  console.log("M5C1-E bloqueos por simulador y feriados respetados OK");

  // ── F · REPROGRAMACIÓN ───────────────────────────────────────────────────
  {
    const mid = await crearBilletera();
    const origen = habiles[2];
    const destino = habiles[4];
    const horasOrigen = await librisimos(origen, 30);
    assert.ok(horasOrigen.length, "M5C1-F hace falta un horario libre de origen");
    const hOrigen = horasOrigen[horasOrigen.length - 1];
    const creada = await rpcCrear({ mid, fecha: origen, hora: hOrigen, duracion: 30, sims: DOS });
    assert.ok(!creada.error, `M5C1-F preparación: ${creada.error?.message}`);
    const fila = (creada.data as Array<{ reserva_id: number; referencia_publica: string }>)[0];
    const ref = fila.referencia_publica;
    const saldoTrasCrear = await saldoDe(mid);

    // F1 · A un fin de semana: rechazado, y la original queda intacta.
    for (const [nota, fecha] of [["sábado", SABADO], ["domingo", DOMINGO]] as const) {
      const p = await reprogramarReserva(mid, ref, fecha, "11:00", clave());
      assert.equal(p.ok, false, `M5C1-F1 no se reprograma a un ${nota}`);
      if (!p.ok) {
        assert.equal(p.codigo, "dia_no_habilitado");
        assert.equal(p.status, 422);
      }
      const e = await estadoDe(ref);
      assert.equal(e.fecha, origen, `M5C1-F1 ${nota}: la original no se movió`);
      assert.equal(e.hora, hOrigen);
      assert.equal(e.estado, "activa");
    }
    assert.equal(await slotsActivos(fila.reserva_id), 4, "M5C1-F1 conserva sus cuatro slots");
    assert.equal(await saldoDe(mid), saldoTrasCrear, "M5C1-F1 el saldo no se movió");

    // F2 · A un horario fuera de la agenda: rechazado.
    for (const hora of ["09:00", "22:00", "10:10"]) {
      const p = await reprogramarReserva(mid, ref, destino, hora, clave());
      assert.equal(p.ok, false, `M5C1-F2 ${hora} no es un horario de la agenda`);
      if (!p.ok) assert.equal(p.codigo, "hora_invalida");
    }
    // Y a un inicio donde la duración ya no entra antes del cierre.
    const pTarde = await reprogramarReserva(mid, ref, destino, "21:40", clave());
    assert.equal(pTarde.ok, false, "M5C1-F2 30 min no entran empezando 21:40");
    assert.equal((await estadoDe(ref)).fecha, origen, "M5C1-F2 la original sigue igual");

    // F3 · Reprogramación válida a otro día hábil: funciona y no toca el saldo.
    const horasDestino = await librisimos(destino, 30);
    assert.ok(horasDestino.length, "M5C1-F3 hace falta un horario libre de destino");
    const hDestino = horasDestino[horasDestino.length - 1];
    const ok = await reprogramarReserva(mid, ref, destino, hDestino, clave());
    assert.ok(ok.ok, `M5C1-F3 la reprogramación válida tiene que entrar: ${!ok.ok ? ok.error : ""}`);
    if (ok.ok) {
      assert.equal(ok.data.fecha, destino);
      assert.equal(ok.data.hora, hDestino);
      assert.equal(ok.data.duracion, 30, "M5C1-F3 la duración no cambia");
    }
    assert.equal(await saldoDe(mid), saldoTrasCrear, "M5C1-F3 reprogramar no cuesta saldo");

    // F4 · Una reserva de UN SOLO simulador: se reprograma y se cancela con
    //      normalidad.
    //
    //      (M8C) Este caso comprobaba lo contrario. Con el mínimo en 2, una
    //      reserva de un simulador quedaba atrapada: existía, pero la RPC de
    //      reprogramación la rechazaba con cantidad_simuladores_invalida y la
    //      única salida era cancelarla. Ese callejón sin salida era el defecto,
    //      no la regla, y M8C lo cerró en las dos funciones.
    const legado = habiles[3];
    const horasLegado = await librisimos(legado, 15);
    const hLegado = horasLegado[horasLegado.length - 1];
    const { data: vieja, error: eVieja } = await supabaseAdmin.from("reservas").insert({
      nombre: MARCA, apellido: "Probe", telefono: "2966990000", email: EMAIL,
      fecha: legado, hora: hLegado, simuladores: ["Alpine"], cantidad_turnos: 1,
      total: 0, total_original: 0, estado: "activa", acepto_condiciones: true,
      duracion_minutos: 15, origen: "mensualidad", mensualidad_id: mid,
      minutos_consumidos: 15, importe_complementario: 0, cobertura: "saldo",
      idempotency_key: clave(), condiciones_version: "cond-legado",
      condiciones_at: new Date().toISOString(), referencia_publica: "RES-ZZZ7-ZZZ7",
    }).select("id").single();
    assert.ok(!eVieja, `M5C1-F4 no se pudo preparar la reserva vieja: ${eVieja?.message}`);
    reservasSueltas.push(vieja!.id as number);
    await supabaseAdmin.from("reserva_slots").insert({
      reserva_id: vieja!.id, fecha: legado, hora: hLegado, simulador: "Alpine", estado: "activa",
    });

    // Se reprograma a otro día hábil libre, distinto del que usó F3.
    const legadoDestino = habiles[4];
    const horasLD = await librisimos(legadoDestino, 15);
    assert.ok(horasLD.length, "M5C1-F4 hace falta un horario libre de destino");
    const hLD = horasLD[horasLD.length - 1];

    const saldoAntesF4 = await saldoDe(mid);
    const pVieja = await reprogramarReserva(mid, "RES-ZZZ7-ZZZ7", legadoDestino, hLD, clave());
    assert.ok(pVieja.ok,
      `M5C1-F4 una reserva de un simulador SÍ se reprograma: ${!pVieja.ok ? pVieja.error : ""}`);
    const eVieja2 = await estadoDe("RES-ZZZ7-ZZZ7");
    assert.equal(eVieja2.fecha, legadoDestino, "M5C1-F4 quedó en la fecha nueva");
    assert.equal(eVieja2.estado, "activa");
    assert.equal(await saldoDe(mid), saldoAntesF4, "M5C1-F4 reprogramar no vuelve a debitar");

    const cVieja = await cancelarReserva(mid, "RES-ZZZ7-ZZZ7", clave());
    assert.ok(cVieja.ok, "M5C1-F4 y cancelarla también se puede");
    if (cVieja.ok) assert.equal(cVieja.data.restituyo, true, "M5C1-F4 y devuelve sus minutos");
    assert.equal(await saldoDe(mid), saldoAntesF4 + 15,
      "M5C1-F4 la devolución es de 15: lo que consumía un solo simulador");

    // F5 · La regla de 24 h sigue mandando (M5C sin tocar).
    const cerca = new Date(Date.now() + 20 * 3600_000 - 3 * 3600_000);
    await supabaseAdmin.from("reservas").update({
      fecha: cerca.toISOString().slice(0, 10), hora: cerca.toISOString().slice(11, 16),
    }).eq("referencia_publica", ref);
    const pPlazo = await reprogramarReserva(mid, ref, destino, hDestino, clave());
    assert.equal(pPlazo.ok, false, "M5C1-F5 con menos de 24 h no se reprograma");
    if (!pPlazo.ok) assert.equal(pPlazo.codigo, "fuera_de_plazo");
    const cPlazo = await cancelarReserva(mid, ref, clave());
    assert.ok(cPlazo.ok, "M5C1-F5 cancelar sí se puede");
    if (cPlazo.ok) assert.equal(cPlazo.data.restituyo, false, "M5C1-F5 pero sin devolución");

    await limpiar();
    billeteras.length = 0;
    reservasSueltas.length = 0;
  }
  console.log("M5C1-F reprogramación: días, horarios, legado y 24 h OK");

  // ── G · CANCELACIÓN M5C: sigue funcionando igual ─────────────────────────
  {
    const mid = await crearBilletera(300);
    const fecha = habiles[5];
    const horas = await librisimos(fecha, 30);
    const r = await rpcCrear({ mid, fecha, hora: horas[horas.length - 1], duracion: 30, sims: TRES });
    assert.ok(!r.error, `M5C1-G preparación: ${r.error?.message}`);
    const fila = (r.data as Array<{ reserva_id: number; referencia_publica: string }>)[0];
    assert.equal(await saldoDe(mid), 300 - 90, "M5C1-G 30 x 3 = 90");

    const c = await cancelarReserva(mid, fila.referencia_publica, clave());
    assert.ok(c.ok, "M5C1-G cancela");
    if (c.ok) {
      assert.equal(c.data.restituyo, true);
      assert.equal(c.data.minutos_restituidos, 90, "M5C1-G restitución exacta");
      assert.equal(c.data.saldo_restante, 300);
    }
    assert.equal(await slotsActivos(fila.reserva_id), 0, "M5C1-G libera los slots");
    assert.equal((await estadoDe(fila.referencia_publica)).cancelacion_resultado, "restituida");

    await limpiar();
    billeteras.length = 0;
  }
  console.log("M5C1-G cancelación de M5C intacta OK");

  // ── H · RESERVAS NORMALES: nada de esto las toca ─────────────────────────
  {
    const { validarReservaInput } = await import("@/lib/reservasValidation");

    // H1 · El fin de semana sigue siendo reservable para el flujo normal.
    for (const fecha of [SABADO, DOMINGO]) {
      const d = await disponibilidadDelDia({ fecha, duracion: 15, producto: "reserva" });
      assert.equal(d.ok, true, "M5C1-H1 Reservas normales sigue teniendo fin de semana");
      if (d.ok) assert.ok(d.horarios.length > 0, "M5C1-H1 con horarios de verdad");
    }
    assert.equal(fechasPublicasPara("reserva", hoy).length, 15,
      "M5C1-H1 Reservas normales conserva las 15 fechas");
    assert.deepEqual(fechasPublicasPara("reserva", hoy), ventana);

    // H2 · Un solo simulador sigue siendo una selección válida, y el sábado.
    const v = validarReservaInput({
      nombre: "Zz", telefono: "3515123456", fecha: SABADO, hora: "11:00",
      simuladores: ["Alpine"], acepto_condiciones: true, duracion_minutos: 15,
    });
    assert.equal(v.ok, true, "M5C1-H2 una reserva normal de un simulador el sábado sigue valiendo");

    // H3 · Y 45/60 siguen siendo exclusivas de Mensualidades.
    for (const d of [45, 60]) {
      const r = await disponibilidadDelDia({ fecha: LUNES, duracion: d, producto: "reserva" });
      assert.equal(r.ok, false, `M5C1-H3 Reservas normales no puede pedir ${d} min`);
      const rm = await disponibilidadDelDia({ fecha: LUNES, duracion: d, producto: "mensualidad" });
      assert.equal(rm.ok, true, `M5C1-H3 Mensualidades sí puede pedir ${d} min`);
    }
  }
  console.log("M5C1-H Reservas normales sin cambios OK");

  // ── I · M5B.1 sigue en pie: solo saldo completo, sin flujo mixto ─────────
  {
    for (const fn of [
      "crear_retencion_reserva_mensualidad",
      "confirmar_reserva_mensualidad_pagada",
      "liberar_retencion_reserva_mensualidad",
      "mensualidad_tiene_retencion_viva",
    ]) {
      const { error } = await supabaseAdmin.rpc(fn as never, {} as never);
      assert.ok(error, `M5C1-I la RPC mixta ${fn} sigue sin existir`);
    }
    const { count } = await supabaseAdmin.from("mensualidad_reserva_pagos")
      .select("*", { count: "exact", head: true });
    assert.equal(count ?? 0, 0, "M5C1-I la tabla del complemento sigue vacía");

    // Saldo insuficiente NO habilita ningún complemento: simplemente rechaza.
    const mid = await crearBilletera(30);
    const horas = await librisimos(habiles[6], 30);
    const r = await rpcCrear({ mid, fecha: habiles[6], hora: horas[horas.length - 1], duracion: 30, sims: DOS });
    assert.ok(String(r.error?.message).includes("saldo_insuficiente"),
      `M5C1-I sin saldo completo no hay reserva (fue: ${r.error?.message})`);
    assert.equal(await saldoDe(mid), 30, "M5C1-I y el saldo queda intacto");

    await limpiar();
    billeteras.length = 0;
  }
  console.log("M5C1-I solo saldo completo, flujo mixto ausente OK");

  // ── J · FLAG APAGADA: las rutas públicas no existen ──────────────────────
  {
    const mid = await crearBilletera();
    const tok = (await crearSesion(mid))!;
    delete process.env.MENSUALIDADES_ENABLED;

    const rutas: Array<[string, Promise<Response>]> = [
      ["disponibilidad", getDisp(pedido(
        `/api/mensualidades/disponibilidad?fecha=${LUNES}&duracion=30`, { cookie: tok },
      ))],
      ["reservar", postReservar(pedido("/api/mensualidades/reservar", {
        metodo: "POST", cookie: tok,
        body: {
          fecha: LUNES, hora: "11:00", duracion_minutos: 30, simuladores: DOS,
          acepto_condiciones: true, idempotency_key: clave(),
        },
      }))],
      ["cancelar", postCancelar(pedido("/api/mensualidades/reservas/cancelar", {
        metodo: "POST", cookie: tok,
        body: { referencia: "RES-ZZZ7-ZZZ7", idempotency_key: clave() },
      }))],
      ["reprogramar", postReprogramar(pedido("/api/mensualidades/reservas/reprogramar", {
        metodo: "POST", cookie: tok,
        body: { referencia: "RES-ZZZ7-ZZZ7", fecha: LUNES, hora: "11:00", idempotency_key: clave() },
      }))],
    ];
    for (const [nota, promesa] of rutas) {
      const res = await promesa;
      assert.equal(res.status, 404, `M5C1-J con la flag apagada /${nota} no existe`);
    }

    await limpiar();
    billeteras.length = 0;
  }
  console.log("M5C1-J flag apagada: rutas públicas cerradas OK");

  if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
  else delete process.env.MENSUALIDADES_ENABLED;

  // ── Contadores DESPUÉS ───────────────────────────────────────────────────
  await limpiar();
  const despues = {
    reservas: await contar("reservas"),
    slots: await contar("reserva_slots"),
    movimientos: await contar("mensualidad_movimientos"),
    mensualidades: await contar("mensualidades"),
    bloqueos: await contar("bloqueos_reservas"),
  };
  console.log(`contadores después: ${JSON.stringify(despues)}`);
  assert.deepEqual(despues, antes, "la suite tiene que dejar la base exactamente como estaba");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M5C.1 OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count: bill } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("titular_email", EMAIL);
    const { count: res } = await supabaseAdmin.from("reservas")
      .select("*", { count: "exact", head: true }).eq("nombre", MARCA);
    const { count: blo } = await supabaseAdmin.from("bloqueos_reservas")
      .select("*", { count: "exact", head: true }).eq("motivo", MARCA);
    console.log(`limpieza: ${bill ?? 0} billeteras, ${res ?? 0} reservas y ${blo ?? 0} bloqueos con la marca (deben ser 0)`);
  });

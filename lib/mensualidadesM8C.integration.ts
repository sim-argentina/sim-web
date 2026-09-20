import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_SESION, crearSesion } from "@/lib/mensualidadSesion";
import { cancelarReserva, reprogramarReserva } from "@/lib/mensualidadesGestionReserva";
import { validarSeleccion } from "@/lib/mensualidadesReserva";
import { simuladoresLibresDelDia } from "@/lib/disponibilidad";
import {
  bloquesDeAgenda, fechasPublicasPara, horariosPosiblesPara, sumarDias,
} from "@/lib/agenda";
import { CONDICIONES_RESERVA_VERSION } from "@/lib/mensualidadesCondiciones";

// Integración del Bloque M8C contra la DB REAL: reservar con 1, 2, 3 o 4
// simuladores.
//
// M5C.1 había fijado el mínimo en DOS. Este archivo comprueba que el mínimo
// volvió a UNO en las tres capas —validación pura, endpoint público y RPC— y
// que todo lo que protegía el mínimo viejo sigue protegido: cero y cinco se
// rechazan, los duplicados también, el consumo lo calcula el motor y el saldo
// nunca queda negativo.
//
// Todos los datos son TEMPORALES, llevan MARCA y se borran en el `finally`.
//
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM8C.integration.ts

const MARCA = `zzm8c_${Date.now()}`;
const EMAIL = `${MARCA}@test.local`;
const billeteras: string[] = [];

let seq = 0;
const nuevoTel = () => `296697${String((Date.now() % 10_000) + seq++).padStart(4, "0").slice(-4)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let k = 0;
const clave = () => `k${MARCA}${String(k++).padStart(4, "0")}`.slice(0, 60);

const UNO = ["Ferrari"];
const DOS = ["Ferrari", "McLaren"];
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

async function rpcCrear(args: {
  mid: string; fecha: string; hora: string; duracion: number; sims: string[];
  idem?: string;
}) {
  return supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: args.mid, p_fecha: args.fecha, p_hora: args.hora,
    p_duracion: args.duracion, p_simuladores: args.sims,
    p_slots: bloquesDeAgenda(args.fecha, args.hora, args.duracion) ?? [args.hora],
    p_idempotency_key: args.idem ?? clave(),
    p_condiciones_version: CONDICIONES_RESERVA_VERSION,
  });
}

const saldoDe = async (mid: string) => {
  const { data } = await supabaseAdmin.from("mensualidades")
    .select("saldo_minutos").eq("id", mid).single();
  return Number(data?.saldo_minutos);
};

const slotsActivos = async (reservaId: number) => {
  const { count } = await supabaseAdmin.from("reserva_slots")
    .select("*", { count: "exact", head: true })
    .eq("reserva_id", reservaId).eq("estado", "activa");
  return count ?? 0;
};

const movimientosDe = async (mid: string, tipo?: string) => {
  let q = supabaseAdmin.from("mensualidad_movimientos")
    .select("tipo, minutos, actor").eq("mensualidad_id", mid);
  if (tipo) q = q.eq("tipo", tipo);
  const { data } = await q;
  return data ?? [];
};

let ipSeq = 0;
function pedido(url: string, opts: { metodo?: string; cookie?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    origin: "https://simexperience.com.ar",
    "x-real-ip": `10.9.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`,
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
  const rids = Array.from(new Set((rs ?? []).map((r) => Number(r.id))));
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
  await supabaseAdmin.from("mensualidades").delete().eq("titular_email", EMAIL);
}

/** Horarios de ese día con los cuatro simuladores libres. */
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

  const hoy = await hoyCordoba();
  const habiles = fechasPublicasPara("mensualidad", hoy);
  assert.ok(habiles.length >= 6, "la ventana necesita varios días hábiles");

  const contar = async (tabla: string) => {
    const { count } = await supabaseAdmin.from(tabla).select("*", { count: "exact", head: true });
    return count ?? 0;
  };
  const antes = {
    reservas: await contar("reservas"),
    slots: await contar("reserva_slots"),
    movimientos: await contar("mensualidad_movimientos"),
    pagos: await contar("mensualidad_reserva_pagos"),
    compras: await contar("mensualidad_compras"),
  };

  try {
    // ── A · UN SOLO SIMULADOR, de punta a punta ──────────────────────────────
    {
      const mid = await crearBilletera(900);
      const tok = (await crearSesion(mid))!;
      const dia = habiles[2];
      const horas = await librisimos(dia, 15);
      assert.ok(horas.length >= 3, "A necesita tres horarios con los cuatro libres");

      // A1 · La validación pura lo acepta.
      const v = validarSeleccion({
        fecha: dia, hora: horas[0], duracion_minutos: 15, simuladores: UNO,
        acepto_condiciones: true, idempotency_key: clave(),
      }, hoy);
      assert.equal(v.ok, true, "M8C-A1 un simulador pasa la validación pura");

      // A2 · El endpoint público la crea y descuenta 15, no 30.
      const res = await postReservar(pedido("/api/mensualidades/reservar", {
        metodo: "POST", cookie: tok,
        body: {
          fecha: dia, hora: horas[0], duracion_minutos: 15, simuladores: UNO,
          acepto_condiciones: true, idempotency_key: clave(),
        },
      }));
      assert.equal(res.status, 201, "M8C-A2 el endpoint responde 201 Created");
      const cuerpo = await res.json();
      assert.equal(cuerpo.minutos_consumidos, 15, "M8C-A2 consume 15");
      assert.equal(cuerpo.saldo_restante, 885, "M8C-A2 el saldo queda en 885");
      assert.deepEqual(cuerpo.simuladores, UNO, "M8C-A2 guarda el simulador elegido");

      // A3 · UN solo slot ocupado y UN solo movimiento de consumo.
      const { data: r } = await supabaseAdmin.from("reservas")
        .select("id, cantidad_turnos, minutos_consumidos, cobertura, importe_complementario, total")
        .eq("referencia_publica", cuerpo.referencia).single();
      assert.equal(await slotsActivos(Number(r!.id)), 1, "M8C-A3 un simulador ocupa un slot");
      assert.equal(Number(r!.cantidad_turnos), 1);
      assert.equal(Number(r!.minutos_consumidos), 15);

      // A4 · Cero impacto financiero: el saldo se usa entero, no hay diferencia
      //      que pagar. M5B.1 retiró la cobertura mixta y no volvió con M8C.
      assert.equal(r!.cobertura, "saldo", "M8C-A4 cubierta 100% con saldo");
      assert.equal(Number(r!.importe_complementario), 0, "M8C-A4 sin importe complementario");
      assert.equal(Number(r!.total), 0, "M8C-A4 sin total a cobrar");
      assert.equal(await contar("mensualidad_reserva_pagos"), antes.pagos,
        "M8C-A4 no se creó ningún pago de diferencia");
      assert.equal(await contar("mensualidad_compras"), antes.compras,
        "M8C-A4 reservar no crea compras ni preferencias");

      const consumos = await movimientosDe(mid, "consumo");
      assert.equal(consumos.length, 1, "M8C-A4 un solo movimiento de consumo");
      assert.equal(Number(consumos[0].minutos), -15);
      assert.equal(consumos[0].actor, "titular");

      // A5 · REPROGRAMAR con un solo simulador: sin segundo débito.
      //      Antes de M8C la RPC lo rechazaba con cantidad_simuladores_invalida:
      //      se podía crear la reserva pero no moverla.
      const otroDia = habiles[3];
      const horasOtro = await librisimos(otroDia, 15);
      assert.ok(horasOtro.length, "M8C-A5 hace falta un horario libre en el otro día");
      const rep = await reprogramarReserva(mid, cuerpo.referencia, otroDia, horasOtro[0], clave());
      assert.equal(rep.ok, true, `M8C-A5 la reprogramación entra: ${!rep.ok ? rep.error : ""}`);
      assert.equal(await saldoDe(mid), 885, "M8C-A5 el saldo NO cambia al reprogramar");
      assert.equal((await movimientosDe(mid, "consumo")).length, 1,
        "M8C-A5 no aparece un segundo consumo");
      assert.equal(await slotsActivos(Number(r!.id)), 1, "M8C-A5 sigue ocupando un solo slot");

      // A6 · CANCELAR: devuelve exactamente 15.
      const can = await cancelarReserva(mid, cuerpo.referencia, clave());
      assert.equal(can.ok, true, `M8C-A6 la cancelación entra: ${!can.ok ? can.error : ""}`);
      assert.equal(await saldoDe(mid), 900, "M8C-A6 el saldo vuelve entero");
      assert.equal(await slotsActivos(Number(r!.id)), 0, "M8C-A6 el slot queda libre");
      const devoluciones = await movimientosDe(mid, "devolucion");
      assert.equal(devoluciones.length, 1, "M8C-A6 una sola devolución");
      assert.equal(Number(devoluciones[0].minutos), 15, "M8C-A6 devuelve 15 exactos");
      assert.equal(devoluciones[0].actor, "titular");

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C-A un simulador: reservar, reprogramar y cancelar OK");

    // ── B · CERO, CINCO Y DUPLICADOS SIGUEN RECHAZADOS ───────────────────────
    {
      const mid = await crearBilletera(900);
      const tok = (await crearSesion(mid))!;
      const dia = habiles[2];
      const horas = await librisimos(dia, 15);
      const saldo0 = await saldoDe(mid);

      const casos: Array<[string, string[], string]> = [
        ["cero", [], "cantidad_simuladores_invalida"],
        ["cinco", [...CUATRO, "Ferrari"], "cantidad_simuladores_invalida"],
        ["duplicados", ["Ferrari", "Ferrari"], "simuladores_duplicados"],
        ["inexistente", ["Williams"], "simulador_desconocido"],
      ];
      for (const [nombre, sims, errEsperado] of casos) {
        // Capa 1: validación pura.
        const v = validarSeleccion({
          fecha: dia, hora: horas[0], duracion_minutos: 15, simuladores: sims,
          acepto_condiciones: true, idempotency_key: clave(),
        }, hoy);
        assert.equal(v.ok, false, `M8C-B ${nombre} no pasa la validación`);

        // Capa 2: endpoint público.
        const res = await postReservar(pedido("/api/mensualidades/reservar", {
          metodo: "POST", cookie: tok,
          body: {
            fecha: dia, hora: horas[0], duracion_minutos: 15, simuladores: sims,
            acepto_condiciones: true, idempotency_key: clave(),
          },
        }));
        assert.equal(res.status, 422, `M8C-B ${nombre}: el endpoint responde 422`);

        // Capa 3: la base sola, sin pasar por el servidor.
        const rpc = await rpcCrear({ mid, fecha: dia, hora: horas[0], duracion: 15, sims });
        assert.ok(String(rpc.error?.message).includes(errEsperado),
          `M8C-B ${nombre}: la base lo rechaza con ${errEsperado} (fue: ${rpc.error?.message})`);
      }
      assert.equal(await saldoDe(mid), saldo0, "M8C-B ningún rechazo tocó el saldo");
      assert.equal(await contar("reservas"), antes.reservas, "M8C-B no se creó ninguna reserva");

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C-B cero, cinco, duplicados y desconocidos rechazados OK");

    // ── C · LA ARITMÉTICA DEL CONSUMO, CONTRA LA BASE ────────────────────────
    // duración × cantidad, en los cinco casos del pedido. El total lo calcula el
    // motor: no hay forma de mandarlo desde afuera.
    {
      const casos: Array<[number, string[], number]> = [
        [15, UNO, 15],
        [60, UNO, 60],
        [30, DOS, 60],
        [15, CUATRO, 60],
        [60, CUATRO, 240],
      ];
      for (const [duracion, sims, esperado] of casos) {
        const mid = await crearBilletera(900);
        const dia = habiles[4];
        const horas = await librisimos(dia, duracion);
        assert.ok(horas.length, `M8C-C hace falta un horario libre de ${duracion} min`);

        const r = await rpcCrear({ mid, fecha: dia, hora: horas[0], duracion, sims });
        assert.ok(!r.error, `M8C-C ${sims.length}x${duracion}: ${r.error?.message}`);
        assert.equal(Number(r.data![0].minutos_consumidos), esperado,
          `M8C-C ${sims.length} x ${duracion} = ${esperado}`);
        assert.equal(await saldoDe(mid), 900 - esperado, `M8C-C el débito es ${esperado}`);

        // Un slot por simulador y por bloque de 15.
        const bloques = duracion / 15;
        assert.equal(await slotsActivos(Number(r.data![0].reserva_id)), bloques * sims.length,
          `M8C-C ${sims.length} simuladores x ${bloques} bloques de slots`);

        await limpiar();
        billeteras.length = 0;
      }
    }
    console.log("M8C-C consumo = duración x cantidad (15/60/60/60/240) OK");

    // ── D · EL TOTAL DEL NAVEGADOR SE IGNORA ─────────────────────────────────
    {
      const mid = await crearBilletera(900);
      const tok = (await crearSesion(mid))!;
      const dia = habiles[4];
      const horas = await librisimos(dia, 15);

      const res = await postReservar(pedido("/api/mensualidades/reservar", {
        metodo: "POST", cookie: tok,
        body: {
          fecha: dia, hora: horas[0], duracion_minutos: 15, simuladores: CUATRO,
          acepto_condiciones: true, idempotency_key: clave(),
          // Basura del cliente: un total inventado, un saldo inventado.
          minutos_consumidos: 1, saldo_restante: 99999, total: 0, minutos: 1,
        },
      }));
      assert.equal(res.status, 201);
      const cuerpo = await res.json();
      assert.equal(cuerpo.minutos_consumidos, 60,
        "M8C-D el consumo lo calcula el motor: 4 x 15 = 60, no el 1 que mandó el cliente");
      assert.equal(await saldoDe(mid), 840, "M8C-D y el saldo se descontó de verdad");

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C-D el total del cliente se ignora OK");

    // ── E · SALDO INSUFICIENTE, TAMBIÉN CON UN SIMULADOR ─────────────────────
    {
      // El saldo es siempre múltiplo de 15 (mensualidades_saldo_chk), así que
      // la reserva más chica posible —1 x 15— nunca puede quedar "a mitad de
      // camino". Para que falte saldo hace falta pedir más duración: con 15
      // minutos en la billetera, 1 x 30 no entra.
      const mid = await crearBilletera(15);
      const dia = habiles[4];
      const horas30 = await librisimos(dia, 30);
      assert.ok(horas30.length, "M8C-E hace falta un horario libre de 30 min");

      const r = await rpcCrear({ mid, fecha: dia, hora: horas30[0], duracion: 30, sims: UNO });
      assert.ok(String(r.error?.message).includes("saldo_insuficiente"),
        `M8C-E un simulador durante 30 min no entra con 15 de saldo (fue: ${r.error?.message})`);
      assert.equal(await saldoDe(mid), 15, "M8C-E el saldo no se movió");

      // Con 1 x 15 sí entra, y queda en cero: nunca en negativo.
      const horas15 = await librisimos(dia, 15);
      const r2 = await rpcCrear({ mid, fecha: dia, hora: horas15[0], duracion: 15, sims: UNO });
      assert.ok(!r2.error, `M8C-E con 15 justos entra: ${r2.error?.message}`);
      assert.equal(await saldoDe(mid), 0, "M8C-E queda en cero, no en negativo");

      // Y con la billetera agotada, ni siquiera la reserva más chica.
      const r3 = await rpcCrear({ mid, fecha: dia, hora: horas15[1], duracion: 15, sims: UNO });
      assert.ok(String(r3.error?.message).includes("mensualidad_agotada"),
        `M8C-E sin saldo la mensualidad está agotada (fue: ${r3.error?.message})`);
      assert.equal(await saldoDe(mid), 0, "M8C-E el saldo nunca queda negativo");

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C-E saldo insuficiente y saldo justo OK");

    // ── F · IDEMPOTENCIA Y CONCURRENCIA CON UN SIMULADOR ─────────────────────
    {
      const mid = await crearBilletera(900);
      const dia = habiles[5];
      const horas = await librisimos(dia, 15);
      assert.ok(horas.length >= 2, "M8C-F hacen falta dos horarios libres");

      // F1 · La misma clave dos veces = una sola reserva.
      const idem = clave();
      const a = await rpcCrear({ mid, fecha: dia, hora: horas[0], duracion: 15, sims: UNO, idem });
      const b = await rpcCrear({ mid, fecha: dia, hora: horas[0], duracion: 15, sims: UNO, idem });
      assert.ok(!a.error && !b.error, "M8C-F1 las dos llamadas contestan");
      assert.equal(a.data![0].reserva_id, b.data![0].reserva_id, "M8C-F1 es la misma reserva");
      assert.equal(b.data![0].idempotente, true, "M8C-F1 la segunda se marca idempotente");
      assert.equal(await saldoDe(mid), 885, "M8C-F1 se descontó una sola vez");

      // F2 · Dos reservas simultáneas del MISMO simulador y horario: una sola gana.
      const [r1, r2] = await Promise.allSettled([
        rpcCrear({ mid, fecha: dia, hora: horas[1], duracion: 15, sims: UNO }),
        rpcCrear({ mid, fecha: dia, hora: horas[1], duracion: 15, sims: UNO }),
      ]);
      const oks = [r1, r2].filter(
        (x) => x.status === "fulfilled" && !x.value.error,
      ).length;
      assert.equal(oks, 1, "M8C-F2 el mismo simulador a la misma hora entra una sola vez");
      assert.equal(await saldoDe(mid), 870, "M8C-F2 solo se descontó la que ganó");

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C-F idempotencia y concurrencia OK");

    // ── G · DISPONIBILIDAD CON UN SOLO SIMULADOR LIBRE ───────────────────────
    // Con tres simuladores tomados, el horario sigue sirviendo: antes de M8C ese
    // horario era inútil porque hacían falta dos.
    {
      const mid = await crearBilletera(900);
      const dia = habiles[5];
      const horas = await librisimos(dia, 15);
      assert.ok(horas.length, "M8C-G hace falta un horario con los cuatro libres");
      const hora = horas[0];

      const ocupa = await rpcCrear({
        mid, fecha: dia, hora, duracion: 15,
        sims: ["Ferrari", "McLaren", "Red Bull"],
      });
      assert.ok(!ocupa.error, `M8C-G ocupar tres: ${ocupa.error?.message}`);

      const d = await simuladoresLibresDelDia({ fecha: dia, duracion: 15, producto: "mensualidad" });
      assert.ok(d.ok);
      const libres = d.ok ? (d.horarios.find((h) => h.hora === hora)?.simuladores ?? []) : [];
      assert.deepEqual(libres, ["Alpine"], "M8C-G queda uno libre y se sigue ofreciendo");

      const r = await rpcCrear({ mid, fecha: dia, hora, duracion: 15, sims: ["Alpine"] });
      assert.ok(!r.error, `M8C-G el último simulador se puede reservar: ${r.error?.message}`);
      assert.equal(Number(r.data![0].minutos_consumidos), 15);

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C-G el último simulador libre se puede reservar OK");

    // ── H · NO QUEDÓ NADA ────────────────────────────────────────────────────
    await limpiar();
    const despues = {
      reservas: await contar("reservas"),
      slots: await contar("reserva_slots"),
      movimientos: await contar("mensualidad_movimientos"),
      pagos: await contar("mensualidad_reserva_pagos"),
      compras: await contar("mensualidad_compras"),
    };
    assert.deepEqual(despues, antes, "M8C-H la base quedó exactamente como estaba");

    console.log("mensualidadesM8C.integration.ts OK (1 a 4 simuladores en las tres capas)");
  } finally {
    await limpiar();
    if (flagPrevia === undefined) delete process.env.MENSUALIDADES_ENABLED;
    else process.env.MENSUALIDADES_ENABLED = flagPrevia;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

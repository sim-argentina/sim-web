import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_SESION, crearSesion } from "@/lib/mensualidadSesion";
import { cancelarReserva, reprogramarReserva } from "@/lib/mensualidadesGestionReserva";
import { validarSeleccion } from "@/lib/mensualidadesReserva";
import { simuladoresLibresDelDia } from "@/lib/disponibilidad";
import {
  bloquesDeAgendaPara, esFinDeSemana, fechasPublicasPara, horariosPosiblesPara, sumarDias,
} from "@/lib/agenda";
import { CONDICIONES_RESERVA_VERSION } from "@/lib/mensualidadesCondiciones";

// Integración del Bloque M8C.1 contra la DB REAL: Mensualidades opera los siete
// días, con el cierre de cada uno.
//
//   · lunes a viernes: 10:00 a 22:00
//   · sábados y domingos: inicios de 10:00 a 14:00 INCLUSIVE, y el turno
//     puede terminar después de las 14:00 según la duración
//
// Se prueba en las tres capas —validación pura, endpoint público y RPC— y en
// los dos sentidos: que el fin de semana AHORA entre, incluido el último
// inicio con las cuatro duraciones, y que un inicio que no está en la grilla
// siga sin entrar.
//
// Todos los datos son TEMPORALES, llevan MARCA y se borran en el `finally`.
//
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM8C1.integration.ts

const MARCA = `zzm8c1_${Date.now()}`;
const EMAIL = `${MARCA}@test.local`;
const billeteras: string[] = [];
const bloqueos: number[] = [];

let seq = 0;
const nuevoTel = () => `296696${String((Date.now() % 10_000) + seq++).padStart(4, "0").slice(-4)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let k = 0;
const clave = () => `k${MARCA}${String(k++).padStart(4, "0")}`.slice(0, 60);

const UNO = ["Ferrari"];
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
}) {
  return supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: args.mid, p_fecha: args.fecha, p_hora: args.hora,
    p_duracion: args.duracion, p_simuladores: args.sims,
    // Los bloques salen de la fuente por PRODUCTO: el fin de semana un turno
    // puede ocupar posiciones posteriores al último inicio.
    p_slots: bloquesDeAgendaPara("mensualidad", args.fecha, args.hora, args.duracion) ?? [args.hora],
    p_idempotency_key: clave(), p_condiciones_version: CONDICIONES_RESERVA_VERSION,
  });
}

const saldoDe = async (mid: string) => {
  const { data } = await supabaseAdmin.from("mensualidades")
    .select("saldo_minutos").eq("id", mid).single();
  return Number(data?.saldo_minutos);
};

let ipSeq = 0;
function pedido(url: string, opts: { metodo?: string; cookie?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    origin: "https://simexperience.com.ar",
    "x-real-ip": `10.11.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`,
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
  if (bloqueos.length) await supabaseAdmin.from("bloqueos_reservas").delete().in("id", bloqueos);
  await supabaseAdmin.from("bloqueos_reservas").delete().eq("motivo", MARCA);
  await supabaseAdmin.from("mensualidades").delete().eq("titular_email", EMAIL);
}

/** Horarios de ese día con los cuatro simuladores libres para Mensualidades. */
async function librisimos(fecha: string, duracion: number): Promise<string[]> {
  const d = await simuladoresLibresDelDia({ fecha, duracion, producto: "mensualidad" });
  if (!d.ok) return [];
  const posibles = horariosPosiblesPara("mensualidad", fecha, duracion);
  return d.horarios
    .filter((h) => h.simuladores.length === 4 && posibles.includes(h.hora))
    .map((h) => h.hora);
}

async function main() {
  const { POST: postReservar } = await import("@/app/api/mensualidades/reservar/route");
  const { GET: getDisp } = await import("@/app/api/mensualidades/disponibilidad/route");

  const hoy = await hoyCordoba();
  const ventana = fechasPublicasPara("mensualidad", hoy);
  assert.equal(ventana.length, 15, "(M8C.1) la ventana de Mensualidades ya no se recorta");

  const findes = ventana.filter(esFinDeSemana);
  const semana = ventana.filter((f) => !esFinDeSemana(f));
  assert.ok(findes.length >= 4, "quince días corridos traen al menos dos fines de semana");
  assert.ok(semana.length >= 8, "y varios días de semana");
  const SABADO = findes.find((f) => new Date(`${f}T12:00:00Z`).getUTCDay() === 6)!;
  const DOMINGO = findes.find((f) => new Date(`${f}T12:00:00Z`).getUTCDay() === 0)!;
  assert.ok(SABADO && DOMINGO, "la ventana tiene un sábado y un domingo");

  const contar = async (tabla: string) => {
    const { count } = await supabaseAdmin.from(tabla).select("*", { count: "exact", head: true });
    return count ?? 0;
  };
  const antes = {
    reservas: await contar("reservas"),
    slots: await contar("reserva_slots"),
    movimientos: await contar("mensualidad_movimientos"),
    bloqueos: await contar("bloqueos_reservas"),
  };

  try {
    // ── A · LA DISPONIBILIDAD OFRECE EL FIN DE SEMANA ────────────────────────
    {
      const mid = await crearBilletera();
      const tok = (await crearSesion(mid))!;

      const res = await getDisp(pedido(
        `/api/mensualidades/disponibilidad?fecha=${SABADO}&duracion=15`, { cookie: tok },
      ));
      assert.equal(res.status, 200, "M8C1-A el sábado ya no da 400");
      const dto = await res.json();
      assert.equal(dto.fecha, SABADO);
      assert.equal(dto.fechas.length, 15, "M8C1-A la ventana completa viaja al cliente");
      assert.ok(dto.fechas.includes(SABADO) && dto.fechas.includes(DOMINGO),
        "M8C1-A con sábado y domingo");
      assert.ok(dto.horarios.length > 0, "M8C1-A y hay horarios el sábado");
      const horas = dto.horarios.map((h: { hora: string }) => h.hora);
      assert.equal(horas[0], "10:00", "M8C1-A empieza a las 10:00");
      assert.equal(horas[horas.length - 1], "14:00",
        "M8C1-A el último inicio del fin de semana es 14:00");
      assert.equal(horas.length, 13, "M8C1-A los 13 inicios de la grilla");

      // Un domingo con 60 minutos: los 13 inicios siguen ahí. El turno que
      // arranca 14:00 termina 15:00, y eso está permitido.
      const res60 = await getDisp(pedido(
        `/api/mensualidades/disponibilidad?fecha=${DOMINGO}&duracion=60`, { cookie: tok },
      ));
      assert.equal(res60.status, 200);
      const dto60 = await res60.json();
      const h60 = dto60.horarios.map((h: { hora: string }) => h.hora);
      assert.equal(h60[h60.length - 1], "14:00",
        "M8C1-A domingo 60 min: el último inicio sigue siendo 14:00");
      assert.equal(h60.length, 13, "M8C1-A sin recortes por duración el fin de semana");

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C1-A la disponibilidad ofrece sábado y domingo OK");

    // ── B · RESERVAR EL FIN DE SEMANA, DE PUNTA A PUNTA ──────────────────────
    {
      const mid = await crearBilletera();
      const tok = (await crearSesion(mid))!;
      const horas = await librisimos(SABADO, 15);
      assert.ok(horas.length >= 2, "M8C1-B hacen falta dos horarios libres el sábado");

      // La validación pura lo acepta.
      const v = validarSeleccion({
        fecha: SABADO, hora: horas[0], duracion_minutos: 15, simuladores: UNO,
        acepto_condiciones: true, idempotency_key: clave(),
      }, hoy);
      assert.equal(v.ok, true, "M8C1-B el sábado pasa la validación");

      // El endpoint público la crea.
      const res = await postReservar(pedido("/api/mensualidades/reservar", {
        metodo: "POST", cookie: tok,
        body: {
          fecha: SABADO, hora: horas[0], duracion_minutos: 15, simuladores: UNO,
          acepto_condiciones: true, idempotency_key: clave(),
        },
      }));
      assert.equal(res.status, 201, "M8C1-B el endpoint crea la reserva del sábado");
      const cuerpo = await res.json();
      assert.equal(cuerpo.fecha, SABADO);
      assert.equal(cuerpo.minutos_consumidos, 15);
      assert.equal(await saldoDe(mid), 885);

      // Y la RPC directa también, un domingo.
      const hDom = await librisimos(DOMINGO, 30);
      assert.ok(hDom.length, "M8C1-B hace falta un horario libre el domingo");
      const r = await rpcCrear({ mid, fecha: DOMINGO, hora: hDom[0], duracion: 30, sims: UNO });
      assert.ok(!r.error, `M8C1-B el domingo entra por RPC: ${r.error?.message}`);
      assert.equal(await saldoDe(mid), 855);

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C1-B reservar sábado y domingo OK");

    // ── C · LOS INICIOS QUE NO EXISTEN SE RECHAZAN ──────────────────────────
    // El fin de semana NO se limita por hora de cierre sino por último inicio,
    // así que lo que se rechaza es empezar fuera de la grilla. En las tres
    // capas, y sin tocar el saldo.
    {
      const mid = await crearBilletera();
      const tok = (await crearSesion(mid))!;
      const saldo0 = await saldoDe(mid);

      const casos: Array<[string, string, number]> = [
        [SABADO, "14:20", 15],   // no existe como inicio
        [SABADO, "14:40", 30],   // tampoco
        [SABADO, "15:00", 45],   // tampoco
        [DOMINGO, "20:00", 60],  // la tarde del finde no está en la grilla
      ];
      for (const [fecha, hora, dur] of casos) {
        const v = validarSeleccion({
          fecha, hora, duracion_minutos: dur, simuladores: UNO,
          acepto_condiciones: true, idempotency_key: clave(),
        }, hoy);
        assert.equal(v.ok, false, `M8C1-C ${fecha} ${hora} no es un inicio válido`);
        if (!v.ok) assert.equal(v.codigo, "hora_invalida");

        const res = await postReservar(pedido("/api/mensualidades/reservar", {
          metodo: "POST", cookie: tok,
          body: {
            fecha, hora, duracion_minutos: dur, simuladores: UNO,
            acepto_condiciones: true, idempotency_key: clave(),
          },
        }));
        assert.equal(res.status, 422, `M8C1-C ${hora}/${dur}: el endpoint responde 422`);

        const rpc = await rpcCrear({ mid, fecha, hora, duracion: dur, sims: UNO });
        assert.ok(String(rpc.error?.message).includes("fuera_de_horario"),
          `M8C1-C ${hora}/${dur}: la base lo rechaza sola (fue: ${rpc.error?.message})`);
      }
      assert.equal(await saldoDe(mid), saldo0, "M8C1-C ningún rechazo tocó el saldo");

      // Y el ÚLTIMO INICIO con las cuatro duraciones, contra la base: es el
      // caso que define M8C.1. Cada uno con su simulador para que no choquen
      // entre sí, porque todos arrancan a las 14:00.
      const limites: Array<[string, string, number, string]> = [
        [SABADO, "14:00", 15, "Ferrari"],
        [SABADO, "14:00", 30, "McLaren"],
        [SABADO, "14:00", 45, "Red Bull"],
        [DOMINGO, "14:00", 60, "Alpine"],
      ];
      let esperado = saldo0;
      for (const [fecha, hora, dur, sim] of limites) {
        const r = await rpcCrear({ mid, fecha, hora, duracion: dur, sims: [sim] });
        assert.ok(!r.error, `M8C1-C ${fecha} ${hora} de ${dur} tiene que entrar: ${r.error?.message}`);
        esperado -= dur;
        assert.equal(await saldoDe(mid), esperado);
      }

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C1-C el último inicio de las 14:00 vale con las cuatro duraciones OK");

    // ── D · REPROGRAMAR APLICA LA MISMA REGLA ────────────────────────────────
    // La fecha NUEVA manda: pasar de un día de semana a un sábado recorta el
    // horario disponible.
    {
      const mid = await crearBilletera();
      const dia = semana.find((f) => f > sumarDias(hoy, 1))!;
      const horasSemana = await librisimos(dia, 30);
      assert.ok(horasSemana.length, "M8C1-D hace falta un horario de semana");
      // Un turno de tarde, imposible de trasladar tal cual a un sábado.
      const tarde = horasSemana.filter((h) => h >= "16:00");
      assert.ok(tarde.length, "M8C1-D hace falta un horario de tarde");

      const r = await rpcCrear({ mid, fecha: dia, hora: tarde[0], duracion: 30, sims: UNO });
      assert.ok(!r.error, `M8C1-D alta previa: ${r.error?.message}`);
      const { data: creada } = await supabaseAdmin.from("reservas")
        .select("referencia_publica").eq("id", r.data![0].reserva_id).single();
      const ref = creada!.referencia_publica as string;
      const saldoTrasCrear = await saldoDe(mid);

      // Mover ese mismo horario al sábado: no puede, el sábado no llega a la tarde.
      const malo = await reprogramarReserva(mid, ref, SABADO, tarde[0], clave());
      assert.equal(malo.ok, false, "M8C1-D la tarde no existe el sábado");

      // Pero a un horario del sábado que entra, sí.
      const hSab = await librisimos(SABADO, 30);
      assert.ok(hSab.length, "M8C1-D hace falta un horario libre el sábado");
      const bueno = await reprogramarReserva(mid, ref, SABADO, hSab[0], clave());
      assert.equal(bueno.ok, true,
        `M8C1-D reprogramar al sábado entra: ${!bueno.ok ? bueno.error : ""}`);
      assert.equal(await saldoDe(mid), saldoTrasCrear, "M8C1-D reprogramar no vuelve a debitar");

      // Y una hora del sábado que se pasaría del cierre, tampoco.
      // Un inicio que no existe en la grilla del sábado: rechazado.
      const pasado = await reprogramarReserva(mid, ref, SABADO, "14:20", clave());
      assert.equal(pasado.ok, false, "M8C1-D 14:20 no es un inicio del sábado");
      // Pero el último inicio sí, aunque el turno termine después de las 14:00.
      const alUltimo = await reprogramarReserva(mid, ref, SABADO, "14:00", clave());
      assert.equal(alUltimo.ok, true,
        `M8C1-D 14:00 + 30 entra: termina 14:30 y está permitido (${!alUltimo.ok ? alUltimo.error : ""})`);

      // Cancelar devuelve lo justo.
      const can = await cancelarReserva(mid, ref, clave());
      assert.equal(can.ok, true, `M8C1-D la cancelación entra: ${!can.ok ? can.error : ""}`);
      assert.equal(await saldoDe(mid), saldoTrasCrear + 30, "M8C1-D devuelve 30 exactos");

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C1-D reprogramar aplica la misma regla OK");

    // ── E · LOS BLOQUEOS DE FIN DE SEMANA SE RESPETAN ────────────────────────
    {
      const mid = await crearBilletera();
      const horas = await librisimos(SABADO, 15);
      assert.ok(horas.length >= 2, "M8C1-E hacen falta dos horarios libres");
      const hora = horas[0];

      const { data: bloq, error: eBloq } = await supabaseAdmin.from("bloqueos_reservas").insert({
        fecha: SABADO, todo_el_dia: false, hora_inicio: hora, hora_fin: hora,
        simulador: "Ferrari", motivo: MARCA,
      }).select("id").single();
      assert.ok(!eBloq, `M8C1-E no se pudo crear el bloqueo: ${eBloq?.message}`);
      bloqueos.push(bloq!.id as number);

      // Ese simulador ya no se ofrece a esa hora.
      const d = await simuladoresLibresDelDia({ fecha: SABADO, duracion: 15, producto: "mensualidad" });
      assert.ok(d.ok);
      const libres = d.ok ? (d.horarios.find((h) => h.hora === hora)?.simuladores ?? []) : [];
      assert.ok(!libres.includes("Ferrari"),
        "M8C1-E el simulador bloqueado no se ofrece el sábado");

      // Y la base lo rechaza aunque se intente igual.
      const r = await rpcCrear({ mid, fecha: SABADO, hora, duracion: 15, sims: ["Ferrari"] });
      assert.ok(r.error, "M8C1-E la base rechaza reservar sobre un bloqueo de sábado");

      await limpiar();
      billeteras.length = 0;
      bloqueos.length = 0;
    }
    console.log("M8C1-E los bloqueos de fin de semana se respetan OK");

    // ── F · VENTANA, VIGENCIA Y CANTIDADES SIGUEN IGUAL ──────────────────────
    {
      const mid = await crearBilletera();

      // Hoy nunca, aunque sea sábado.
      const rHoy = await rpcCrear({ mid, fecha: hoy, hora: "11:00", duracion: 15, sims: UNO });
      assert.ok(String(rHoy.error?.message).includes("fecha_fuera_de_ventana"),
        `M8C1-F hoy no se reserva (fue: ${rHoy.error?.message})`);

      // Más de 15 días, tampoco.
      const lejos = sumarDias(hoy, 16);
      const rLejos = await rpcCrear({ mid, fecha: lejos, hora: "11:00", duracion: 15, sims: UNO });
      assert.ok(rLejos.error, "M8C1-F hoy+16 no se reserva");

      // Vigencia: una billetera que vence antes del sábado no puede usarlo.
      const dias = Math.round(
        (Date.parse(`${SABADO}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000,
      );
      const corta = await crearBilletera(300, Math.max(dias - 1, 1));
      const hSab = await librisimos(SABADO, 15);
      const rVenc = await rpcCrear({ mid: corta, fecha: SABADO, hora: hSab[0], duracion: 15, sims: UNO });
      assert.ok(String(rVenc.error?.message).includes("turno_posterior_al_vencimiento"),
        `M8C1-F la vigencia sigue limitando (fue: ${rVenc.error?.message})`);

      // Cantidades: de 1 a 4 también el sábado, cero y cinco no.
      let esperado = 900;
      for (const n of [1, 2, 3, 4]) {
        const libres = await librisimos(SABADO, 15);
        assert.ok(libres.length, "M8C1-F hace falta un horario libre");
        const r = await rpcCrear({
          mid, fecha: SABADO, hora: libres[0], duracion: 15, sims: CUATRO.slice(0, n),
        });
        assert.ok(!r.error, `M8C1-F ${n} simuladores el sábado: ${r.error?.message}`);
        esperado -= 15 * n;
        assert.equal(await saldoDe(mid), esperado, `M8C1-F consumo 15 x ${n}`);
      }
      const hLibre = (await librisimos(SABADO, 15))[0];
      if (hLibre) {
        const r0 = await rpcCrear({ mid, fecha: SABADO, hora: hLibre, duracion: 15, sims: [] });
        assert.ok(String(r0.error?.message).includes("cantidad_simuladores_invalida"),
          "M8C1-F cero sigue rechazado el sábado");
        const r5 = await rpcCrear({
          mid, fecha: SABADO, hora: hLibre, duracion: 15, sims: [...CUATRO, "Ferrari"],
        });
        assert.ok(String(r5.error?.message).includes("cantidad_simuladores_invalida"),
          "M8C1-F cinco sigue rechazado el sábado");
      }

      await limpiar();
      billeteras.length = 0;
    }
    console.log("M8C1-F ventana, vigencia y cantidades intactas OK");

    // ── G · NO QUEDÓ NADA ────────────────────────────────────────────────────
    await limpiar();
    const despues = {
      reservas: await contar("reservas"),
      slots: await contar("reserva_slots"),
      movimientos: await contar("mensualidad_movimientos"),
      bloqueos: await contar("bloqueos_reservas"),
    };
    assert.deepEqual(despues, antes, "M8C1-G la base quedó exactamente como estaba");

    console.log("mensualidadesM8C1.integration.ts OK (los siete días, con el cierre de cada uno)");
  } finally {
    await limpiar();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

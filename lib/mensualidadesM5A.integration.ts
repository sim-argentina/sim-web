import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_SESION, crearSesion } from "@/lib/mensualidadSesion";
import { getMiPlan, getReservasDeMiPlan } from "@/lib/mensualidadesMiPlan";
import { CONDICIONES_VERSION, CONDICIONES_RESERVA_VERSION } from "@/lib/mensualidadesCondiciones";
import {
  bloquesDeAgenda, diaHabilitadoPara, diasEntre, fechasPublicas, fechasPublicasPara,
  horariosPosiblesPara, sumarDias,
} from "@/lib/agenda";
import { disponibilidadDelDia } from "@/lib/disponibilidad";

// Integración del Bloque M5A contra la DB REAL, con datos TEMPORALES que se
// ELIMINAN al final. Teléfonos con área 2966 (Río Gallegos, fuera del área de
// SIM) para no chocar con nadie.
//
// Las fechas TIENEN que ser reales: la ventana pública (mañana … hoy + 15) y la
// vigencia las valida la base con mensualidad_hoy(), que no se puede inyectar.
// Por eso se elige el último día de la ventana y los horarios más tardíos que
// estén completamente libres, y se limpia todo al terminar.
//
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM5A.integration.ts

const MARCA = `zzm5a_${Date.now()}`;

// (M5C.1) Mensualidades exige de 2 a 4 simuladores. Estas constantes existen
// para que ningún caso quede pidiendo uno solo por descuido, y para que la
// intención de cada test se lea sin contar elementos a mano.
const DOS = ["Ferrari", "McLaren"];
const TRES = ["Ferrari", "McLaren", "Red Bull"];
const CUATRO = ["Ferrari", "McLaren", "Red Bull", "Alpine"];
const creados = { mensualidades: [] as string[], reservas: [] as number[], compras: [] as string[] };

let seq = 0;
const nuevoTel = () => `296697${String((Date.now() % 10_000) + seq++).padStart(4, "0").slice(-4)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let claveSeq = 0;
const nuevaClave = () => `k${MARCA}${String(claveSeq++).padStart(4, "0")}`.slice(0, 60);

async function hoyCordoba(): Promise<string> {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}

async function crearMensualidad(opts: {
  saldo: number; diasVence: number; bloqueada?: boolean; telefonoNorm?: string;
}) {
  const hoy = await hoyCordoba();
  // Un solo teléfono: titular_telefono y telefono_norm tienen que coincidir,
  // como en una alta real.
  const tel = opts.telefonoNorm ?? nuevoTel();
  const { data, error } = await supabaseAdmin.from("mensualidades").insert({
    codigo: nuevoCodigo(), titular_nombre: "Ana María", titular_apellido: "Pérez",
    titular_telefono: tel,
    telefono_norm: tel,
    titular_email: `${MARCA}@test.local`, saldo_minutos: opts.saldo,
    vence_el: sumarDias(hoy, opts.diasVence), bloqueada: opts.bloqueada ?? false,
  }).select("id, codigo, vence_el, telefono_norm, saldo_minutos").single();
  if (error) throw new Error(`crearMensualidad: ${error.message}`);
  creados.mensualidades.push(data.id);
  return data as { id: string; codigo: string; vence_el: string; telefono_norm: string; saldo_minutos: number };
}

async function limpiar() {
  const ids = Array.from(new Set(creados.mensualidades));
  const { data: rs } = await supabaseAdmin.from("reservas").select("id").in("mensualidad_id", ids.length ? ids : ["-"]);
  const rids = Array.from(new Set([...(rs ?? []).map((r) => Number(r.id)), ...creados.reservas]));
  if (rids.length) {
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reservas").delete().in("id", rids);
  }
  if (creados.compras.length) {
    await supabaseAdmin.from("mensualidad_compras").delete().in("id", creados.compras);
  }
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  }
}

async function saldoDe(id: string) {
  const { data } = await supabaseAdmin.from("mensualidades").select("saldo_minutos").eq("id", id).single();
  return Number(data?.saldo_minutos ?? -1);
}

// Llama a la RPC directamente (sin endpoint), como haría el módulo servidor.
async function rpc(mid: string, fecha: string, hora: string, duracion: number, sims: string[], clave: string) {
  return supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: mid, p_fecha: fecha, p_hora: hora, p_duracion: duracion,
    p_simuladores: sims, p_slots: bloquesDeAgenda(fecha, hora, duracion) ?? [],
    p_idempotency_key: clave, p_condiciones_version: CONDICIONES_RESERVA_VERSION,
  });
}

let ipSeq = 0;
function pedido(url: string, opts: { metodo?: string; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    origin: "https://simexperience.com.ar",
    "x-real-ip": `10.5.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`,
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = `${COOKIE_SESION}=${opts.cookie}`;
  return new Request(`https://simexperience.com.ar${url}`, {
    method: opts.metodo ?? "GET", headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function main() {
  const flagPrevia = process.env.MENSUALIDADES_ENABLED;
  const { POST: postReservar } = await import("@/app/api/mensualidades/reservar/route");
  const { GET: getDisp } = await import("@/app/api/mensualidades/disponibilidad/route");
  const { GET: getMiPlanRoute } = await import("@/app/api/mensualidades/mi-plan/route");

  const hoy = await hoyCordoba();
  // (M5C.1) Mensualidades opera de lunes a viernes, así que el último día
  // utilizable de la ventana es el último HÁBIL, que no siempre es hoy + 15,
  // y el primero es el primer hábil, que no siempre es mañana.
  const ventanaMens = fechasPublicasPara("mensualidad", hoy);
  assert.ok(ventanaMens.length >= 2, "la ventana de Mensualidades necesita días hábiles");
  const primerHabil = ventanaMens[0];
  const limite = ventanaMens[ventanaMens.length - 1];
  const diasHastaLimite = diasEntre(hoy, limite);
  const pasado = sumarDias(hoy, 16);

  // Se trabaja en el último día de la ventana, con los horarios más tardíos que
  // estén 100% libres: así se toca lo menos posible la agenda real.
  const dispHoy = await disponibilidadDelDia({ fecha: limite, duracion: 60, producto: "mensualidad" });
  assert.ok(dispHoy.ok, "hace falta poder leer la disponibilidad del último día de la ventana");
  const librísimos = dispHoy.ok
    ? dispHoy.horarios.filter((h) => h.simuladores === 4).map((h) => h.hora)
    : [];
  assert.ok(librísimos.length >= 4, `hacen falta 4 inicios con los 4 simuladores libres en ${limite}`);
  // Se toman de atrás para adelante y separados, para que no se pisen entre sí.
  const posibles60 = horariosPosiblesPara("mensualidad", limite, 60);
  const elegibles = librísimos.filter((h) => posibles60.includes(h)).reverse();
  const H1 = elegibles[0];
  const H2 = elegibles.find((h) => bloquesDeAgenda(limite, h, 60)!.every((b) => !bloquesDeAgenda(limite, H1, 60)!.includes(b)))!;
  const H3 = elegibles.find((h) => h !== H1 && h !== H2 &&
    bloquesDeAgenda(limite, h, 60)!.every((b) =>
      !bloquesDeAgenda(limite, H1, 60)!.includes(b) && !bloquesDeAgenda(limite, H2, 60)!.includes(b)))!;
  assert.ok(H1 && H2 && H3, "hacen falta tres ventanas de 60 min que no se solapen");
  // Un sábado dentro de la ventana pública: existe siempre, porque 15 días
  // corridos contienen al menos dos. Sirve para probar el rechazo por día.
  const sabadoDeLaVentana = fechasPublicas(hoy).find((d) => !diaHabilitadoPara("mensualidad", d))!;
  assert.ok(sabadoDeLaVentana, "la ventana de 15 días siempre tiene un fin de semana");
  console.log(`base: hoy=${hoy} ventana hábil=${primerHabil}..${limite} horarios=${H1}/${H2}/${H3} no-hábil=${sabadoDeLaVentana}`);

  await limpiar();

  // ── 1..3 · Sesión y feature flag ────────────────────────────────────────
  delete process.env.MENSUALIDADES_ENABLED;
  const mFlag = await crearMensualidad({ saldo: 300, diasVence: 20 });
  const tokFlag = (await crearSesion(mFlag.id))!;
  {
    const res = await postReservar(pedido("/api/mensualidades/reservar", {
      metodo: "POST", cookie: tokFlag,
      body: { fecha: limite, hora: H1, duracion_minutos: 15, simuladores: DOS, acepto_condiciones: true, idempotency_key: nuevaClave() },
    }));
    assert.equal(res.status, 404, "M5A-3 con la flag apagada el endpoint no existe");
    assert.equal((await res.json()).error, "No encontrado", "respuesta neutral");
    const d = await getDisp(pedido(`/api/mensualidades/disponibilidad?fecha=${limite}&duracion=45`, { cookie: tokFlag }));
    assert.equal(d.status, 404, "M5A-3 la disponibilidad concreta tampoco se expone");
  }
  process.env.MENSUALIDADES_ENABLED = "true";
  {
    // 2 · Sesión inválida, vencida y revocada.
    for (const [nota, cookie] of [["sin cookie", undefined], ["token basura", "x".repeat(43)]] as const) {
      const res = await postReservar(pedido("/api/mensualidades/reservar", {
        metodo: "POST", cookie,
        body: { fecha: limite, hora: H1, duracion_minutos: 15, simuladores: DOS, acepto_condiciones: true, idempotency_key: nuevaClave() },
      }));
      assert.equal(res.status, 404, `M5A-2 ${nota} → 404 neutral`);
    }
    const mRev = await crearMensualidad({ saldo: 60, diasVence: 20 });
    const tokRev = (await crearSesion(mRev.id))!;
    await supabaseAdmin.from("mensualidad_sesiones")
      .update({ revocada_at: new Date().toISOString() }).eq("mensualidad_id", mRev.id);
    const resRev = await postReservar(pedido("/api/mensualidades/reservar", {
      metodo: "POST", cookie: tokRev,
      body: { fecha: limite, hora: H1, duracion_minutos: 15, simuladores: DOS, acepto_condiciones: true, idempotency_key: nuevaClave() },
    }));
    assert.equal(resRev.status, 404, "M5A-2 sesión revocada → 404");
    const mVen = await crearMensualidad({ saldo: 60, diasVence: 20 });
    const tokVen = (await crearSesion(mVen.id))!;
    // Hay que mover TAMBIÉN creada_at: mensualidad_sesiones_vig_chk exige
    // expira_at > creada_at, así que envejecer solo el vencimiento no pasa.
    const { error: eVen } = await supabaseAdmin.from("mensualidad_sesiones")
      .update({
        creada_at: new Date(Date.now() - 7_200_000).toISOString(),
        expira_at: new Date(Date.now() - 3_600_000).toISOString(),
      })
      .eq("mensualidad_id", mVen.id);
    assert.ok(!eVen, `no se pudo envejecer la sesión: ${eVen?.message}`);
    const resVen = await postReservar(pedido("/api/mensualidades/reservar", {
      metodo: "POST", cookie: tokVen,
      body: { fecha: limite, hora: H1, duracion_minutos: 15, simuladores: DOS, acepto_condiciones: true, idempotency_key: nuevaClave() },
    }));
    assert.equal(resVen.status, 404, "M5A-2 sesión vencida → 404");
  }
  console.log("M5A-1/2/3 sesión y feature flag OK");

  // ── 4..9 · Estado de la mensualidad y vigencia ──────────────────────────
  {
    const casos: Array<[string, { saldo: number; diasVence: number; bloqueada?: boolean }, string]> = [
      ["bloqueada", { saldo: 300, diasVence: 20, bloqueada: true }, "mensualidad_bloqueada"],
      ["vencida", { saldo: 300, diasVence: -1 }, "mensualidad_vencida"],
      ["agotada", { saldo: 0, diasVence: 20 }, "mensualidad_agotada"],
    ];
    for (const [nota, opts, esperado] of casos) {
      const m = await crearMensualidad(opts);
      const r = await rpc(m.id, limite, H1, 15, DOS, nuevaClave());
      assert.ok(r.error, `M5A-5/6/7 ${nota} tiene que fallar`);
      assert.ok(String(r.error?.message).includes(esperado), `M5A ${nota} → ${esperado}`);
      assert.equal(await saldoDe(m.id), opts.saldo, `${nota}: el saldo no se toca`);
      // Y la pantalla tampoco deja empezar.
      const plan = await getMiPlan(m.id);
      assert.equal(plan?.puede_reservar, false, `${nota}: puede_reservar = false`);
    }
    // 8 · Turno POSTERIOR al vencimiento (vence en 2 días, turno en 15).
    const mCorta = await crearMensualidad({ saldo: 300, diasVence: 2 });
    const rPost = await rpc(mCorta.id, limite, H1, 15, DOS, nuevaClave());
    assert.ok(String(rPost.error?.message).includes("turno_posterior_al_vencimiento"),
      "M5A-8 el turno no puede caer después del vencimiento");
    assert.equal(await saldoDe(mCorta.id), 300, "no se descontó nada");
    // 9 · Turno EL MISMO DÍA del vencimiento: vale todo el día.
    const mJusta = await crearMensualidad({ saldo: 300, diasVence: diasHastaLimite });
    const rMismo = await rpc(mJusta.id, limite, H1, 15, DOS, nuevaClave());
    assert.ok(!rMismo.error, `M5A-9 mismo día del vencimiento debe entrar: ${rMismo.error?.message}`);
    assert.equal(await saldoDe(mJusta.id), 270, "M5A-9 descontó 15 x 2 simuladores");
  }
  console.log("M5A-4/5/6/7/8/9 estado y vigencia OK");

  // ── 10..13 · Ventana de fechas contra la base ───────────────────────────
  {
    const m = await crearMensualidad({ saldo: 600, diasVence: 25 });
    for (const [nota, fecha] of [["hoy", hoy], ["ayer", sumarDias(hoy, -1)]] as const) {
      const r = await rpc(m.id, fecha, "10:00", 15, DOS, nuevaClave());
      assert.ok(r.error, `M5A-10 ${nota} rechazada`);
      // Las dos reglas rigen; cuál corta primero depende del día de la semana.
      assert.match(String(r.error?.message), /fecha_fuera_de_ventana|dia_no_habilitado/,
        `M5A-10 ${nota}: el motivo tiene que ser la ventana o el día`);
    }
    // Un día pasado que además es hábil: acá el motivo solo puede ser la ventana.
    const habilPasado = [0, 1, 2, 3, 4, 5, 6].map((i) => sumarDias(hoy, -i))
      .find((d) => diaHabilitadoPara("mensualidad", d))!;
    const rPasado = await rpc(m.id, habilPasado, "10:00", 15, DOS, nuevaClave());
    assert.ok(String(rPasado.error?.message).includes("fecha_fuera_de_ventana"),
      `M5A-10 ${habilPasado} es hábil pero pasado: se rechaza por la ventana`);
    // 11 · Mañana entra (se elige un horario libre de ese día).
    const dm = await disponibilidadDelDia({ fecha: primerHabil, duracion: 15, producto: "mensualidad" });
    assert.ok(dm.ok);
    const horaPrimera = dm.ok ? dm.horarios.filter((h) => h.simuladores === 4).slice(-1)[0]?.hora : undefined;
    if (horaPrimera) {
      const r = await rpc(m.id, primerHabil, horaPrimera, 15, ["Red Bull", "Alpine"], nuevaClave());
      assert.ok(!r.error, `M5A-11 el primer día hábil debe entrar: ${r.error?.message}`);
    }
    // 12 · hoy + 15 entra · 13 · hoy + 16 no (la ventana la aplica la app; la
    // base sabe que es futuro, así que acá el corte lo pone validarSeleccion).
    const { validarSeleccion } = await import("@/lib/mensualidadesReserva");
    const base = { hora: "10:00", duracion_minutos: 15, simuladores: DOS, acepto_condiciones: true, idempotency_key: nuevaClave() };
    assert.equal(validarSeleccion({ ...base, fecha: limite }).ok, true,
      "M5A-12 el último día hábil de la ventana es válido");
    // hoy+16 está fuera de la ventana pase lo que pase con el día de la semana.
    const v16 = validarSeleccion({ ...base, fecha: pasado });
    assert.equal(v16.ok, false, "M5A-13 hoy+16 inválido");
    if (!v16.ok) assert.equal(v16.codigo, "fecha_fuera_de_ventana");
  }
  console.log("M5A-10/11/12/13 ventana de fechas OK");

  // ── 14..20 · Duraciones, simuladores y consumo exacto ───────────────────
  {
    // (M5C.1) Las cuatro duraciones contra las tres cantidades permitidas.
    const consumos: Array<[number, string[], number]> = [
      [15, DOS, 30],
      [30, TRES, 90],
      [45, CUATRO, 180],
      [60, DOS, 120],
    ];
    for (const [dur, sims, esperado] of consumos) {
      const m = await crearMensualidad({ saldo: 600, diasVence: 20 });
      const r = await rpc(m.id, limite, H2, dur, sims, nuevaClave());
      assert.ok(!r.error, `M5A-20 ${dur}x${sims.length}: ${r.error?.message}`);
      const fila = (r.data as Array<{ minutos_consumidos: number; saldo_posterior: number }>)[0];
      assert.equal(fila.minutos_consumidos, esperado, `M5A-20 ${dur}x${sims.length} = ${esperado}`);
      assert.equal(fila.saldo_posterior, 600 - esperado, "saldo posterior correcto");
      assert.equal(await saldoDe(m.id), 600 - esperado, "el saldo quedó descontado");
      assert.equal(esperado % 15, 0, "el consumo es múltiplo de 15");
      // Slots: un bloque por cada 15 min, por cada simulador.
      const { data: slots } = await supabaseAdmin.from("reserva_slots")
        .select("hora, simulador").eq("reserva_id", fila ? (r.data as Array<{ reserva_id: number }>)[0].reserva_id : -1);
      assert.equal((slots ?? []).length, (dur / 15) * sims.length, "cantidad de slots");
      // Limpieza inmediata para liberar el horario al siguiente caso.
      await limpiar();
      creados.mensualidades.length = 0;
    }
    // 15/17/18/19 · Entradas manipuladas: la RPC no confía en el que llama.
    const m = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const malos: Array<[string, () => PromiseLike<{ error: unknown }>]> = [
      ["duración 20", () => supabaseAdmin.rpc("crear_reserva_mensualidad", { p_mensualidad_id: m.id, p_fecha: limite, p_hora: H1, p_duracion: 20, p_simuladores: DOS, p_slots: [H1], p_idempotency_key: nuevaClave(), p_condiciones_version: "v" })],
      ["0 simuladores", () => rpc(m.id, limite, H1, 15, [], nuevaClave())],
      // (M8C) "1 simulador" ya NO está en esta lista: M5C.1 lo daba por
      // inválido y M8C lo devolvió a válido. Se comprueba abajo, como caso
      // legítimo, que es lo que ahora corresponde.
      // (M5C.1) El día tiene que ser hábil, aunque todo lo demás esté bien.
      ["sábado", () => rpc(m.id, sabadoDeLaVentana, "11:00", 15, DOS, nuevaClave())],
      ["5 simuladores", () => rpc(m.id, limite, H1, 15, ["Ferrari", "McLaren", "Red Bull", "Alpine", "Ferrari"], nuevaClave())],
      ["duplicado", () => rpc(m.id, limite, H1, 30, ["Ferrari", "Ferrari"], nuevaClave())],
      ["desconocido", () => rpc(m.id, limite, H1, 15, ["Williams", "McLaren"], nuevaClave())],
      ["condiciones vacías", () => supabaseAdmin.rpc("crear_reserva_mensualidad", { p_mensualidad_id: m.id, p_fecha: limite, p_hora: H1, p_duracion: 15, p_simuladores: DOS, p_slots: [H1], p_idempotency_key: nuevaClave(), p_condiciones_version: "  " })],
      ["bloques de menos", () => supabaseAdmin.rpc("crear_reserva_mensualidad", { p_mensualidad_id: m.id, p_fecha: limite, p_hora: H1, p_duracion: 60, p_simuladores: DOS, p_slots: [H1], p_idempotency_key: nuevaClave(), p_condiciones_version: "v" })],
      ["clave corta", () => supabaseAdmin.rpc("crear_reserva_mensualidad", { p_mensualidad_id: m.id, p_fecha: limite, p_hora: H1, p_duracion: 15, p_simuladores: DOS, p_slots: [H1], p_idempotency_key: "corta", p_condiciones_version: "v" })],
    ];
    for (const [nota, fn] of malos) {
      const r = await fn();
      assert.ok(r.error, `M5A-15/17/18/19 "${nota}" tiene que fallar`);
    }
    assert.equal(await saldoDe(m.id), 600, "ninguna entrada manipulada tocó el saldo");

    // (M8C) UN simulador es una selección legítima y descuenta lo que
    // corresponde: 15 minutos, no 30. Antes esto vivía en la lista de entradas
    // rechazadas.
    const rUno = await rpc(m.id, limite, H1, 15, ["Ferrari"], nuevaClave());
    assert.ok(!rUno.error, `M5A-20b un simulador tiene que entrar: ${rUno.error?.message}`);
    assert.equal(await saldoDe(m.id), 600 - 15, "M5A-20b descuenta 15, no 30");

    await limpiar();
    creados.mensualidades.length = 0;
  }
  console.log("M5A-14..20 duraciones, simuladores y consumo OK");

  // ── 21/22 · Saldo exacto e insuficiente ─────────────────────────────────
  {
    const mExacta = await crearMensualidad({ saldo: 120, diasVence: 20 });
    const r = await rpc(mExacta.id, limite, H1, 60, ["Ferrari", "McLaren"], nuevaClave());
    assert.ok(!r.error, `M5A-21 saldo exacto debe entrar: ${r.error?.message}`);
    assert.equal(await saldoDe(mExacta.id), 0, "M5A-21 queda en 0");
    const plan = await getMiPlan(mExacta.id);
    assert.equal(plan?.estado, "agotada", "M5A-21 pasa a agotada sola");

    const mCorta = await crearMensualidad({ saldo: 45, diasVence: 20 });
    const tok = (await crearSesion(mCorta.id))!;
    const res = await postReservar(pedido("/api/mensualidades/reservar", {
      metodo: "POST", cookie: tok,
      body: { fecha: limite, hora: H2, duracion_minutos: 60, simuladores: ["Ferrari", "McLaren"], acepto_condiciones: true, idempotency_key: nuevaClave() },
    }));
    assert.equal(res.status, 422, "M5A-22 saldo insuficiente → 422");
    const cuerpo = await res.json();
    assert.equal(cuerpo.codigo, "saldo_insuficiente");
    assert.equal(cuerpo.saldo_minutos, 45, "M5A-22 devuelve el saldo disponible");
    assert.equal(cuerpo.minutos_faltantes, 75, "M5A-22 devuelve los minutos faltantes (120 - 45)");
    assert.equal(await saldoDe(mCorta.id), 45, "M5A-22 no descuenta");
    const { count: nRes } = await supabaseAdmin.from("reservas")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", mCorta.id);
    assert.equal(nRes ?? 0, 0, "M5A-22 no crea reserva");
    const { count: nMov } = await supabaseAdmin.from("mensualidad_movimientos")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", mCorta.id);
    assert.equal(nMov ?? 0, 0, "M5A-22 no crea movimiento");
    // 41 · No hay ningún pago de Mercado Pago involucrado.
    const { count: nComp } = await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", mCorta.id);
    assert.equal(nComp ?? 0, 0, "M5A-41 no se crea compra ni pago");
    await limpiar();
    creados.mensualidades.length = 0;
  }
  console.log("M5A-21/22/41 saldo exacto, insuficiente y sin pagos OK");

  // ── 23..28 · Escuderías concretas, ocupación y bloqueos ─────────────────
  {
    const mA = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const mB = await crearMensualidad({ saldo: 600, diasVence: 20 });
    // A toma Ferrari y McLaren 60 min.
    const rA = await rpc(mA.id, limite, H1, 60, DOS, nuevaClave());
    assert.ok(!rA.error, `preparación: ${rA.error?.message}`);

    // 24 · Ferrari ocupado: no se acepta aunque el otro elegido esté libre.
    const rDup = await rpc(mB.id, limite, H1, 15, ["Ferrari", "Red Bull"], nuevaClave());
    assert.ok(rDup.error, "M5A-24 Ferrari ocupado no se puede tomar");
    assert.equal((rDup.error as { code?: string }).code, "23505", "M5A-24 lo corta el índice único");
    assert.equal(await saldoDe(mB.id), 600, "M5A-37 rollback: no se descontó nada");

    // 25 · Ocupación en un bloque INTERMEDIO de una experiencia larga.
    const bloques = bloquesDeAgenda(limite, H1, 60)!;
    const rInt = await rpc(mB.id, limite, bloques[1], 30, ["McLaren", "Red Bull"], nuevaClave());
    assert.ok(rInt.error, "M5A-25 un bloque intermedio ocupado bloquea la reserva");

    // 23 · Las otras dos sí se pueden, en el mismo horario.
    const rOtras = await rpc(mB.id, limite, H1, 60, ["Red Bull", "Alpine"], nuevaClave());
    assert.ok(!rOtras.error, `M5A-23 las libres deben entrar: ${rOtras.error?.message}`);
    assert.equal(await saldoDe(mB.id), 600 - 120, "M5A-23 60x2 = 120");

    // 28 · Intersección: el endpoint autenticado no ofrece nada en ese horario.
    const tokB = (await crearSesion(mB.id))!;
    const resDisp = await getDisp(pedido(`/api/mensualidades/disponibilidad?fecha=${limite}&duracion=60`, { cookie: tokB }));
    assert.equal(resDisp.status, 200);
    const dtoDisp = await resDisp.json();
    const enH1 = dtoDisp.horarios.find((h: { hora: string }) => h.hora === H1);
    assert.equal(enH1, undefined, "M5A-28 con los 4 tomados el horario no aparece");
    // Y el DTO trae NOMBRES, no cantidades.
    const alguno = dtoDisp.horarios[0];
    assert.ok(Array.isArray(alguno.simuladores) && typeof alguno.simuladores[0] === "string",
      "M5A-28 el contrato autenticado devuelve simuladores concretos");
    assert.deepEqual(Object.keys(alguno).sort(), ["hora", "simuladores"], "sin campos de más");
    assert.deepEqual(dtoDisp.duraciones, [15, 30, 45, 60]);
    const crudoDisp = JSON.stringify(dtoDisp);
    for (const prohibido of ["nombre", "telefono", "email", "reserva_id", "mensualidad_id", "saldo"]) {
      assert.ok(!crudoDisp.includes(prohibido), `M5A-46 la disponibilidad no expone "${prohibido}"`);
    }
    await limpiar();
    creados.mensualidades.length = 0;
  }
  console.log("M5A-23/24/25/28 simuladores concretos e intersección OK");

  // ── 26/27 · Bloqueos administrativos ────────────────────────────────────
  {
    const m = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const bloques = bloquesDeAgenda(limite, H1, 60)!;
    // Parcial: solo el segundo bloque, solo Ferrari.
    const { data: b1 } = await supabaseAdmin.from("bloqueos_reservas").insert({
      fecha: limite, todo_el_dia: false, hora_inicio: bloques[1], hora_fin: bloques[1],
      simulador: "Ferrari", motivo: MARCA, activo: true,
    }).select("id").single();
    const rParcial = await rpc(m.id, limite, H1, 60, ["Ferrari", "Red Bull"], nuevaClave());
    assert.ok(rParcial.error, "M5A-26/27 bloqueo parcial en bloque intermedio impide reservar");
    assert.equal(await saldoDe(m.id), 600, "no se descontó");
    const rOtra = await rpc(m.id, limite, H1, 60, ["McLaren", "Alpine"], nuevaClave());
    assert.ok(!rOtra.error, "M5A-26 el bloqueo de un simulador no afecta a los otros");
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", b1!.id);

    // Total: el día entero.
    const { data: b2 } = await supabaseAdmin.from("bloqueos_reservas").insert({
      fecha: limite, todo_el_dia: true, motivo: MARCA, activo: true,
    }).select("id").single();
    const rTotal = await rpc(m.id, limite, H2, 15, ["Ferrari", "Alpine"], nuevaClave());
    assert.ok(rTotal.error, "M5A-27 bloqueo total impide reservar");
    assert.equal((rTotal.error as { code?: string }).code, "23514", "M5A-27 lo corta el trigger");
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", b2!.id);
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("motivo", MARCA);
    await limpiar();
    creados.mensualidades.length = 0;
  }
  console.log("M5A-26/27 bloqueos parciales y totales OK");

  // ── 29/30 · Último horario válido e inválido ────────────────────────────
  {
    const { validarSeleccion } = await import("@/lib/mensualidadesReserva");
    const posibles = horariosPosiblesPara("mensualidad", limite, 60);
    const ultimo = posibles[posibles.length - 1];
    const todos = horariosPosiblesPara("mensualidad", limite, 15);
    const primeroMalo = todos[todos.indexOf(ultimo) + 1];
    const b = { fecha: limite, duracion_minutos: 60, simuladores: DOS, acepto_condiciones: true, idempotency_key: nuevaClave() };
    assert.equal(validarSeleccion({ ...b, hora: ultimo }).ok, true, `M5A-29 ${ultimo} es el último válido para 60`);
    const malo = validarSeleccion({ ...b, hora: primeroMalo });
    assert.equal(malo.ok, false, `M5A-30 ${primeroMalo} ya no entra`);
    if (!malo.ok) assert.equal(malo.codigo, "sin_bloques");
  }
  console.log("M5A-29/30 último horario válido e inválido OK");

  // ── 31/32/33 · Idempotencia ─────────────────────────────────────────────
  {
    const m = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const tok = (await crearSesion(m.id))!;
    const clave = nuevaClave();
    const cuerpo = { fecha: limite, hora: H1, duracion_minutos: 30, simuladores: DOS, acepto_condiciones: true, idempotency_key: clave };

    const r1 = await postReservar(pedido("/api/mensualidades/reservar", { metodo: "POST", cookie: tok, body: cuerpo }));
    assert.equal(r1.status, 201, "M5A-31 la primera crea");
    const d1 = await r1.json();
    const r2 = await postReservar(pedido("/api/mensualidades/reservar", { metodo: "POST", cookie: tok, body: cuerpo }));
    assert.equal(r2.status, 200, "M5A-32 el replay devuelve 200, no 201");
    const d2 = await r2.json();
    assert.equal(d2.referencia, d1.referencia, "M5A-32 misma reserva");
    assert.equal(await saldoDe(m.id), 600 - 60, "M5A-31 se descontó una sola vez");
    const { count: nRes } = await supabaseAdmin.from("reservas").select("*", { count: "exact", head: true }).eq("mensualidad_id", m.id);
    const { count: nMov } = await supabaseAdmin.from("mensualidad_movimientos").select("*", { count: "exact", head: true }).eq("mensualidad_id", m.id);
    const { data: reservaIds } = await supabaseAdmin.from("reservas").select("id").eq("mensualidad_id", m.id);
    const { count: nSlots } = await supabaseAdmin.from("reserva_slots")
      .select("*", { count: "exact", head: true }).in("reserva_id", (reservaIds ?? []).map((x) => x.id));
    assert.equal(nRes, 1, "M5A-31 una sola reserva");
    assert.equal(nMov, 1, "M5A-38 exactamente un movimiento");
    assert.equal(nSlots, 4, "M5A-31 4 slots (2 bloques x 2 simuladores), sin duplicar");

    // 33 · La misma clave con OTRO payload se rechaza.
    const r3 = await postReservar(pedido("/api/mensualidades/reservar", {
      metodo: "POST", cookie: tok,
      body: { ...cuerpo, hora: H2, simuladores: ["Red Bull", "Alpine"], duracion_minutos: 15 },
    }));
    assert.equal(r3.status, 409, "M5A-33 misma clave con otro payload → 409");
    assert.equal((await r3.json()).codigo, "idempotency_key_con_otro_payload");
    assert.equal(await saldoDe(m.id), 540, "M5A-33 no descontó de nuevo");

    // 39 · Saldo anterior/posterior del movimiento.
    const { data: mov } = await supabaseAdmin.from("mensualidad_movimientos")
      .select("tipo, minutos, saldo_anterior, saldo_posterior, reserva_id, actor")
      .eq("mensualidad_id", m.id).single();
    assert.equal(mov!.tipo, "consumo");
    assert.equal(mov!.minutos, -60, "M5A-39 el consumo es negativo");
    assert.equal(mov!.saldo_anterior, 600);
    assert.equal(mov!.saldo_posterior, 540);
    assert.ok(mov!.reserva_id, "M5A-38 el movimiento está vinculado a la reserva");

    // 40 · Reserva confirmada con total 0 y los campos del contrato.
    const { data: reserva } = await supabaseAdmin.from("reservas")
      .select("estado, total, total_original, origen, cobertura, minutos_consumidos, importe_complementario, duracion_minutos, cantidad_turnos, condiciones_version, condiciones_at, referencia_publica, nombre, apellido, telefono, email")
      .eq("mensualidad_id", m.id).single();
    assert.equal(reserva!.estado, "activa", "M5A-40 confirmada");
    assert.equal(Number(reserva!.total), 0, "M5A-40 total 0");
    assert.equal(reserva!.origen, "mensualidad");
    assert.equal(reserva!.cobertura, "saldo");
    assert.equal(reserva!.minutos_consumidos, 60);
    assert.equal(Number(reserva!.importe_complementario), 0);
    assert.equal(reserva!.cantidad_turnos, 2);
    assert.equal(reserva!.condiciones_version, CONDICIONES_RESERVA_VERSION, "M5A-42 versión guardada");
    assert.ok(reserva!.condiciones_at, "M5A-42 fecha de aceptación guardada");
    assert.match(String(reserva!.referencia_publica), /^RES-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // 43 · Los datos de contacto salen de la billetera, no del cliente.
    assert.equal(reserva!.nombre, "Ana María");
    assert.equal(reserva!.apellido, "Pérez");
    assert.equal(reserva!.telefono, m.telefono_norm);
    assert.equal(reserva!.email, `${MARCA}@test.local`);

    // 42 · Sin aceptar condiciones no se reserva.
    const rSin = await postReservar(pedido("/api/mensualidades/reservar", {
      metodo: "POST", cookie: tok,
      body: { fecha: limite, hora: H2, duracion_minutos: 15, simuladores: ["Red Bull", "Alpine"], acepto_condiciones: false, idempotency_key: nuevaClave() },
    }));
    assert.equal(rSin.status, 422, "M5A-42 condiciones obligatorias");
    assert.equal((await rSin.json()).codigo, "condiciones");

    // 43b · Mandar nombre/teléfono/email en el body no cambia nada.
    const rInyecta = await postReservar(pedido("/api/mensualidades/reservar", {
      metodo: "POST", cookie: tok,
      body: {
        fecha: limite, hora: H2, duracion_minutos: 15, simuladores: ["Red Bull", "Alpine"],
        acepto_condiciones: true, idempotency_key: nuevaClave(),
        nombre: "Intruso", apellido: "Falso", telefono: "3510000000",
        email: "intruso@test.local", total: 99999, minutos_consumidos: 1,
      },
    }));
    assert.equal(rInyecta.status, 201);
    const { data: rInj } = await supabaseAdmin.from("reservas")
      .select("nombre, email, total, minutos_consumidos").eq("mensualidad_id", m.id).eq("hora", H2).single();
    assert.equal(rInj!.nombre, "Ana María", "M5A-43 el nombre del body se ignora");
    assert.equal(rInj!.email, `${MARCA}@test.local`, "M5A-43 el email del body se ignora");
    assert.equal(Number(rInj!.total), 0, "M5A-43 el total del body se ignora");
    assert.equal(rInj!.minutos_consumidos, 30, "M5A-43 los minutos los calcula el servidor");
    await limpiar();
    creados.mensualidades.length = 0;
  }
  console.log("M5A-31/32/33/38/39/40/42/43 idempotencia, movimiento y contacto OK");

  // ── 34/35/36/37 · Concurrencia ──────────────────────────────────────────
  {
    // 34 · Dos consumos simultáneos del último saldo: gana uno solo.
    // 30 min x 2 simuladores = 60: justo el saldo, así que entra UNA sola.
    const m = await crearMensualidad({ saldo: 60, diasVence: 20 });
    const [c1, c2] = await Promise.all([
      rpc(m.id, limite, H1, 30, ["Ferrari", "McLaren"], nuevaClave()),
      rpc(m.id, limite, H2, 30, ["Red Bull", "Alpine"], nuevaClave()),
    ]);
    const okC = [c1, c2].filter((r) => !r.error).length;
    assert.equal(okC, 1, "M5A-34 solo una de las dos puede consumir el último saldo");
    assert.equal(await saldoDe(m.id), 0, "M5A-34 el saldo no queda negativo ni se descuenta dos veces");
    const { count: movs } = await supabaseAdmin.from("mensualidad_movimientos")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", m.id);
    assert.equal(movs, 1, "M5A-34 un solo movimiento");

    // 35 · Dos mensualidades distintas peleando por los MISMOS slots.
    const mX = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const mY = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const [x, y] = await Promise.all([
      rpc(mX.id, limite, H3, 30, ["Ferrari", "McLaren"], nuevaClave()),
      rpc(mY.id, limite, H3, 30, ["Ferrari", "McLaren"], nuevaClave()),
    ]);
    assert.equal([x, y].filter((r) => !r.error).length, 1, "M5A-35 solo una gana el slot");
    const perdedora = !x.error ? mY.id : mX.id;
    assert.equal(await saldoDe(perdedora), 600, "M5A-37 la que perdió no descontó nada");
    const { count: movsPerd } = await supabaseAdmin.from("mensualidad_movimientos")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", perdedora);
    assert.equal(movsPerd, 0, "M5A-37 la que perdió no dejó movimiento");
    const { count: resPerd } = await supabaseAdmin.from("reservas")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", perdedora);
    assert.equal(resPerd, 0, "M5A-37 la que perdió no dejó reserva");

    // 31b · Doble clic real: la MISMA clave en paralelo.
    const mD = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const claveDoble = nuevaClave();
    const dispD = await disponibilidadDelDia({ fecha: limite, duracion: 15, producto: "mensualidad" });
    const horaLibre = dispD.ok ? dispD.horarios.filter((h) => h.simuladores === 4).slice(-1)[0]?.hora : H1;
    const [d1, d2] = await Promise.all([
      rpc(mD.id, limite, horaLibre!, 15, ["Red Bull", "Alpine"], claveDoble),
      rpc(mD.id, limite, horaLibre!, 15, ["Red Bull", "Alpine"], claveDoble),
    ]);
    const okD = [d1, d2].filter((r) => !r.error).length;
    assert.ok(okD >= 1, "M5A-31 al menos una responde bien al doble clic");
    assert.equal(await saldoDe(mD.id), 570, "M5A-31 el doble clic descuenta una sola vez");
    const { count: resD } = await supabaseAdmin.from("reservas")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", mD.id);
    assert.equal(resD, 1, "M5A-31 una sola reserva");
    await limpiar();
    creados.mensualidades.length = 0;
  }
  console.log("M5A-34/35/37 + doble clic concurrente OK");

  // ── 36 · Renovación concurrente con consumo ─────────────────────────────
  {
    const tel = nuevoTel();
    const m = await crearMensualidad({ saldo: 120, diasVence: 20, telefonoNorm: tel });
    // Compra pendiente del MISMO teléfono: al aplicarse es una renovación.
    const extRef = `${MARCA}-ren`;
    const { data: compra, error: eC } = await supabaseAdmin.from("mensualidad_compras").insert({
      plan_slug: "zz", plan_nombre: "Plan zz", plan_minutos: 300, plan_precio: 1000,
      plan_vigencia_dias: 30, comprador_nombre: "Ana María", comprador_apellido: "Pérez",
      comprador_telefono: tel, telefono_norm: tel, comprador_email: `${MARCA}@test.local`,
      importe_bruto: 1000, external_reference: extRef,
      condiciones_version: CONDICIONES_VERSION, condiciones_aceptadas_at: new Date().toISOString(),
    }).select("id").single();
    if (eC) throw new Error(`compra: ${eC.message}`);
    creados.compras.push(compra!.id);

    const [ren, con] = await Promise.all([
      supabaseAdmin.rpc("mensualidad_aplicar_compra", {
        p_external_reference: extRef, p_mp_payment_id: `${MARCA}-pay`,
        p_importe_bruto: 1000, p_comision_mp: 0, p_importe_neto: 1000,
      }),
      rpc(m.id, limite, H1, 30, DOS, nuevaClave()),
    ]);
    assert.ok(!ren.error, `M5A-36 la renovación debe aplicarse: ${ren.error?.message}`);
    assert.ok(!con.error, `M5A-36 el consumo debe aplicarse: ${con.error?.message}`);

    // Los dos se aplicaron sobre el mismo saldo, en algún orden, sin perderse.
    // Renovación: traslada hasta 60 min y suma 300. Consumo: -60.
    // Orden A (consumo primero): 120-60=60 → renov: min(60,60)+300 = 360.
    // Orden B (renovación primero): min(120,60)+300 = 360 → consumo: 300.
    const saldoFinal = await saldoDe(m.id);
    assert.ok([360, 300].includes(saldoFinal),
      `M5A-36 el saldo final tiene que ser coherente con uno de los dos órdenes, fue ${saldoFinal}`);
    const { data: movs } = await supabaseAdmin.from("mensualidad_movimientos")
      .select("tipo, minutos, saldo_anterior, saldo_posterior, created_at")
      .eq("mensualidad_id", m.id).order("created_at", { ascending: true });
    const tipos = (movs ?? []).map((x) => x.tipo);
    assert.ok(tipos.includes("consumo") && tipos.includes("renovacion"),
      "M5A-36 quedaron los dos movimientos");
    // La cadena de saldos no puede tener saltos: cada saldo_anterior encadena.
    for (const mv of movs ?? []) {
      assert.equal(mv.saldo_posterior, mv.saldo_anterior + mv.minutos,
        "M5A-36 cada movimiento es consistente consigo mismo");
    }
    const consumo = (movs ?? []).find((x) => x.tipo === "consumo")!;
    assert.equal(consumo.minutos, -60, "M5A-36 el consumo no se perdió ni se duplicó");
    await limpiar();
    creados.mensualidades.length = 0;
    creados.compras.length = 0;
  }
  console.log("M5A-36 renovación concurrente con consumo OK");

  // ── 44/45/46 · Mi mensualidad ───────────────────────────────────────────
  {
    const mA = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const mB = await crearMensualidad({ saldo: 600, diasVence: 20 });
    await rpc(mA.id, limite, H1, 15, DOS, nuevaClave());
    await rpc(mB.id, limite, H2, 15, ["Red Bull", "Alpine"], nuevaClave());
    // Una reserva PASADA de A, insertada directo (la RPC no acepta el pasado).
    const pasada = sumarDias(hoy, -5);
    const { data: vieja } = await supabaseAdmin.from("reservas").insert({
      nombre: "Ana María", apellido: "Pérez", telefono: mA.telefono_norm, email: `${MARCA}@test.local`,
      fecha: pasada, hora: "10:00", simuladores: ["Alpine"], cantidad_turnos: 1,
      total: 0, total_original: 0, estado: "activa", acepto_condiciones: true,
      duracion_minutos: 15, origen: "mensualidad", mensualidad_id: mA.id,
      minutos_consumidos: 15, importe_complementario: 0, cobertura: "saldo",
      idempotency_key: nuevaClave(), condiciones_version: CONDICIONES_RESERVA_VERSION,
      condiciones_at: new Date().toISOString(), referencia_publica: "RES-ZZZZ-ZZZ9",
    }).select("id").single();
    creados.reservas.push(vieja!.id);

    const hist = await getReservasDeMiPlan(mA.id);
    assert.equal(hist.proximas.length, 1, "M5A-45 una próxima");
    assert.equal(hist.anteriores.length, 1, "M5A-45 una anterior");
    assert.equal(hist.proximas[0].fecha, limite);
    assert.equal(hist.anteriores[0].fecha, pasada);
    // 44 · Nunca aparece la reserva de la otra mensualidad.
    const todas = [...hist.proximas, ...hist.anteriores];
    assert.ok(todas.every((r) => !r.simuladores.includes("Red Bull")),
      "M5A-44 no se cuela la reserva de otra mensualidad");
    const histB = await getReservasDeMiPlan(mB.id);
    assert.equal(histB.proximas.length, 1);
    assert.equal(histB.proximas[0].simuladores[0], "Red Bull");

    // 46 · El DTO no lleva PII ni ids internos.
    const tokA = (await crearSesion(mA.id))!;
    const resPlan = await getMiPlanRoute(pedido("/api/mensualidades/mi-plan", { cookie: tokA }));
    assert.equal(resPlan.status, 200);
    assert.ok(/no-store/i.test(resPlan.headers.get("cache-control") ?? ""), "M5A-46 no-store");
    const dto = await resPlan.json();
    const crudo = JSON.stringify(dto);
    for (const prohibido of [
      mA.id, mA.telefono_norm, `${MARCA}@test.local`, "Pérez",
      "reserva_id", "mensualidad_id", "importe", "total", "payment", "mp_",
    ]) {
      assert.ok(!crudo.includes(prohibido), `M5A-46 el DTO no puede contener "${prohibido}"`);
    }
    // La guarda sigue siendo un conjunto CERRADO: si alguien agrega un campo al
    // DTO, este test falla y hay que justificarlo acá. (M5C) sumó cinco, todos
    // derivados y sin PII: qué acciones habilita la reserva, cuántos minutos
    // volverían si se cancela ahora, y cómo terminó una cancelación.
    for (const r of [...dto.reservas.proximas, ...dto.reservas.anteriores]) {
      assert.deepEqual(Object.keys(r).sort(),
        ["cancelacion_resultado", "duracion", "estado", "fecha", "hora",
         "minutos_a_restituir", "minutos_consumidos", "puede_cancelar",
         "puede_reprogramar", "referencia", "restituye_minutos", "simuladores"],
        "M5A-46 solo los campos mínimos");
    }
    await limpiar();
    creados.mensualidades.length = 0;
    creados.reservas.length = 0;
  }
  console.log("M5A-44/45/46 historial de Mi mensualidad OK");

  // ── 47/48/49 · Visibilidad operativa y no contaminación de Reservas ─────
  {
    const m = await crearMensualidad({ saldo: 600, diasVence: 20 });
    const r = await rpc(m.id, limite, H1, 60, DOS, nuevaClave());
    assert.ok(!r.error);
    const reservaId = (r.data as Array<{ reserva_id: number }>)[0].reserva_id;

    // 47 · Visibilidad operativa. El route handler de /api/reservas no se puede
    // invocar acá porque llama a cookies() de next/headers (limitación ya
    // documentada en M4), así que se ejercitan las MISMAS consultas que hace:
    // la del admin (columnas completas) y la pública (subconjunto sin PII).
    const colsAdmin = "*";
    const colsPublicas = "fecha, hora, simuladores, estado, duracion_minutos, cantidad_turnos";
    for (const [nota, cols] of [["admin", colsAdmin], ["público", colsPublicas]] as const) {
      const { data: filas, error } = await supabaseAdmin
        .from("reservas").select(cols).eq("fecha", limite)
        .order("fecha", { ascending: true }).order("hora", { ascending: true });
      assert.ok(!error, `M5A-47 el listado ${nota} no puede romper: ${error?.message}`);
      const mia = (filas as unknown as Array<Record<string, unknown>>).find(
        (f) => f.hora === H1 && Array.isArray(f.simuladores) && (f.simuladores as string[]).includes("Ferrari"),
      );
      assert.ok(mia, `M5A-47 la reserva de mensualidad aparece en el listado ${nota}`);
      assert.equal(mia!.duracion_minutos, 60, `M5A-47 ${nota}: con su duración de 60`);
      assert.equal(mia!.estado, "activa", `M5A-47 ${nota}: confirmada`);
      assert.equal(mia!.cantidad_turnos, 2, `M5A-47 ${nota}: dos simuladores`);
    }
    // Los slots existen y son los cuatro bloques, para el turnero y la ocupación.
    const { data: slotsOp } = await supabaseAdmin.from("reserva_slots")
      .select("hora, simulador").eq("reserva_id", reservaId).order("hora");
    assert.equal((slotsOp ?? []).length, 8,
      "M5A-47 la reserva ocupa sus 4 bloques en cada uno de los 2 simuladores");

    // El calendario del admin deriva el rango con getOccupiedSlots (M6).
    const { getOccupiedSlots } = await import("@/lib/reservasSlots");
    assert.equal(getOccupiedSlots(limite, H1, 60).length, 4,
      "M5A-47 el calendario dibuja los 4 bloques de una de 60");

    // 48 · Bloquea la disponibilidad pública normal.
    const dispPublica = await disponibilidadDelDia({ fecha: limite, duracion: 15, producto: "reserva" });
    assert.ok(dispPublica.ok);
    if (dispPublica.ok) {
      const enH1 = dispPublica.horarios.find((h) => h.hora === H1);
      assert.equal(enH1?.simuladores, 2,
        "M5A-48 Ferrari y McLaren dejan de estar libres para Reservas normales");
    }

    // 49 · Reservas normales siguen sin 45/60.
    const { validarReservaInput } = await import("@/lib/reservasValidation");
    for (const d of [45, 60]) {
      const v = validarReservaInput({
        nombre: "Zz", telefono: "3515123456", fecha: limite, hora: H2,
        simuladores: ["Alpine"], acepto_condiciones: true, duracion_minutos: d,
      });
      assert.equal(v.ok, false, `M5A-49 una reserva normal no puede pedir ${d}`);
    }
    const dr = await disponibilidadDelDia({ fecha: limite, duracion: 45, producto: "reserva" });
    assert.equal(dr.ok, false, "M5A-49 tampoco por disponibilidad");

    // 51 · Finanzas: el monto del mes no sube por esta reserva.
    const mesActual = `${hoy.slice(0, 4)}-${hoy.slice(5, 7)}`;
    const { data: fin } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mesActual });
    const online = (fin as Array<{ fuente: string; total: number; cantidad: number }> ?? [])
      .find((f) => f.fuente === "reservas_online");
    const { count: reservasDelMes } = await supabaseAdmin
      .from("reservas").select("*", { count: "exact", head: true })
      .eq("origen", "mensualidad").eq("estado", "activa");
    assert.ok((reservasDelMes ?? 0) >= 1, "hay al menos una reserva de mensualidad viva");
    // La reserva vale 0, así que no puede haber sumado plata; y tampoco se
    // cuenta como operación online.
    const { data: sumaMens } = await supabaseAdmin
      .from("reservas").select("total").eq("id", reservaId).single();
    assert.equal(Number(sumaMens!.total), 0, "M5A-51 la reserva no aporta monto");
    if (online) {
      const { count: onlineReales } = await supabaseAdmin
        .from("reservas").select("*", { count: "exact", head: true })
        .in("estado", ["activa", "reembolsada"]).not("origen", "in", '("empresa","mensualidad")');
      assert.ok(Number(online.cantidad) <= (onlineReales ?? 0),
        "M5A-51 reservas_online no cuenta las de mensualidad");
    }
    await limpiar();
    creados.mensualidades.length = 0;
  }
  console.log("M5A-47/48/49/51 visibilidad operativa y finanzas OK");

  // ── 53 · anon no puede nada ─────────────────────────────────────────────
  {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const rRpc = await anon.rpc("crear_reserva_mensualidad", {
      p_mensualidad_id: "00000000-0000-0000-0000-000000000000", p_fecha: limite,
      p_hora: H1, p_duracion: 15, p_simuladores: ["Ferrari"], p_slots: [H1],
      p_idempotency_key: "aaaaaaaaaaaaaaaaaaaa", p_condiciones_version: "v",
    });
    assert.ok(rRpc.error, "M5A-53 anon no puede ejecutar la RPC");
    for (const tabla of ["reservas", "reserva_slots", "mensualidades", "mensualidad_movimientos"]) {
      const { data, error } = await anon.from(tabla).select("*").limit(1);
      assert.ok(error || (data ?? []).length === 0, `M5A-53 anon no lee ${tabla}`);
    }
    const rIns = await anon.from("reservas").insert({
      nombre: "x", telefono: "0", fecha: limite, hora: H1, simuladores: ["Ferrari"],
      cantidad_turnos: 1, total: 0, estado: "activa", acepto_condiciones: true, duracion_minutos: 15,
    });
    assert.ok(rIns.error, "M5A-53 anon no puede insertar reservas");
  }
  console.log("M5A-53 anon sin acceso OK");

  if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
  else delete process.env.MENSUALIDADES_ENABLED;

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M5A OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    // (M8C) Se cuenta SOLO lo que creó esta corrida, por el email marcado.
    // Antes contaba todas las reservas con origen 'mensualidad' del sistema y
    // avisaba "debe ser 0": desde que existe una mensualidad real con
    // historial, ese cartel informaba una fuga que no existía.
    const { count } = await supabaseAdmin.from("reservas")
      .select("*", { count: "exact", head: true })
      .eq("origen", "mensualidad").eq("email", `${MARCA}@test.local`);
    const { count: cm } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("titular_email", `${MARCA}@test.local`);
    console.log(`limpieza: ${count ?? 0} reservas y ${cm ?? 0} billeteras de ESTA corrida (deben ser 0 y 0)`);
    if ((count ?? 0) !== 0 || (cm ?? 0) !== 0) process.exitCode = 1;
  });

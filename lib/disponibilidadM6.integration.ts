import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { disponibilidadDelDia, hayDisponibilidadPara } from "@/lib/disponibilidad";
import { bloquesDeAgenda } from "@/lib/agenda";
import { precioPorSimulador } from "@/lib/reservasSlots";
import { reservarConCodigo } from "@/lib/empresasServer";

// Integración del Bloque M6 contra la DB REAL, con datos TEMPORALES que se
// ELIMINAN al final.
//
// Se trabaja sobre 2030-06-05 y se inyecta hoy = 2030-06-04: así la fecha cae
// dentro de la ventana pública (mañana … hoy + 15) sin tocar ningún día real en
// el que pueda haber clientes. Los simuladores SÍ son los reales, porque la
// intersección se calcula sobre ellos.
// Ejecutar:
//   npx tsx --env-file=.env.local lib/disponibilidadM6.integration.ts

const MARCA = `zzm6_${Date.now()}`;
const FECHA = "2030-06-05";       // miércoles → calendario de día de semana
const HOY = "2030-06-04";
const FECHA_FINDE = "2030-06-08"; // sábado
const creadas: number[] = [];
const bloqueosCreados: number[] = [];

const SIMS = ["Ferrari", "McLaren", "Red Bull", "Alpine"] as const;

async function crearReserva(hora: string, duracion: number, simuladores: string[], fecha = FECHA) {
  const bloques = bloquesDeAgenda(fecha, hora, duracion);
  if (!bloques) throw new Error(`crearReserva: ${hora} +${duracion} no entra`);
  const { data, error } = await supabaseAdmin.from("reservas").insert({
    nombre: MARCA, telefono: "3515123456", fecha, hora,
    simuladores, cantidad_turnos: simuladores.length,
    total: 0, total_original: 0, estado: "activa",
    acepto_condiciones: true, duracion_minutos: duracion,
  }).select("id").single();
  if (error) throw new Error(`crearReserva: ${error.message}`);
  creadas.push(data.id);
  const filas = bloques.flatMap((b) => simuladores.map((s) => ({
    reserva_id: data.id, fecha, hora: b, simulador: s, estado: "activa",
  })));
  const { error: e2 } = await supabaseAdmin.from("reserva_slots").insert(filas);
  if (e2) throw new Error(`crearReserva slots: ${e2.message}`);
  return data.id as number;
}

async function crearBloqueo(opts: {
  fecha?: string; todo_el_dia?: boolean; hora_inicio?: string; hora_fin?: string; simulador?: string | null;
}) {
  const { data, error } = await supabaseAdmin.from("bloqueos_reservas").insert({
    fecha: opts.fecha ?? FECHA,
    todo_el_dia: opts.todo_el_dia ?? false,
    hora_inicio: opts.hora_inicio ?? null,
    hora_fin: opts.hora_fin ?? null,
    simulador: opts.simulador ?? null,
    motivo: MARCA, activo: true,
  }).select("id").single();
  if (error) throw new Error(`crearBloqueo: ${error.message}`);
  bloqueosCreados.push(data.id);
  return data.id as number;
}

async function limpiar() {
  if (creadas.length) {
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", creadas);
    await supabaseAdmin.from("reservas").delete().in("id", creadas);
  }
  if (bloqueosCreados.length) {
    await supabaseAdmin.from("bloqueos_reservas").delete().in("id", bloqueosCreados);
  }
  await supabaseAdmin.from("reservas").delete().eq("nombre", MARCA);
  await supabaseAdmin.from("bloqueos_reservas").delete().eq("motivo", MARCA);
}

const disp = (duracion: number, fecha = FECHA, producto: "reserva" | "mensualidad" = "mensualidad") =>
  disponibilidadDelDia({ fecha, duracion, producto, hoy: HOY });

async function libresEn(hora: string, duracion: number, fecha = FECHA) {
  const r = await disp(duracion, fecha);
  if (!r.ok) throw new Error(`disponibilidad: ${r.error}`);
  return r.horarios.find((h) => h.hora === hora)?.simuladores ?? 0;
}

async function main() {
  await limpiar();

  // ── M6-A · Día limpio: los 4 simuladores en todos los inicios posibles ────
  {
    const r = await disp(15);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.horarios.length, 36, "día de semana con 36 inicios de 15 min");
      assert.ok(r.horarios.every((h) => h.simuladores === 4), "día limpio: 4 libres");
    }
    const r60 = await disp(60);
    assert.ok(r60.ok);
    if (r60.ok) assert.equal(r60.horarios.length, 33, "60 min recorta los 3 últimos inicios");
    // (M5C.1) El fin de semana es de Reservas normales: ahí la grilla corta de
    // 13 inicios sigue intacta. Mensualidades, en cambio, no opera ese día.
    const rFinde = await disp(15, FECHA_FINDE, "reserva");
    assert.ok(rFinde.ok && rFinde.horarios.length === 13,
      "fin de semana con 13 inicios para Reservas normales");
    const rFindeMens = await disp(15, FECHA_FINDE);
    assert.equal(rFindeMens.ok, false, "Mensualidades no opera el fin de semana");
  }
  console.log("M6-A día limpio y recorte por duración OK");

  // ── M6-21/22/23 · Reserva existente en cada bloque de una de 60 min ───────
  // 60 min desde 12:00 ocupa 12:00, 12:20, 12:40 y 13:00.
  for (const [nota, horaOcupada] of [
    ["primer bloque", "12:00"], ["bloque intermedio", "12:20"],
    ["otro intermedio", "12:40"], ["último bloque", "13:00"],
  ] as const) {
    const id = await crearReserva(horaOcupada, 15, ["Ferrari"]);
    const libres = await libresEn("12:00", 60);
    assert.equal(libres, 3, `M6-21/22/23 Ferrari ocupado en el ${nota} lo saca de toda la duración`);
    // Y para 15 min en otro horario sigue habiendo 4.
    assert.equal(await libresEn("15:00", 15), 4, "el resto del día no se ve afectado");
    await supabaseAdmin.from("reserva_slots").delete().eq("reserva_id", id);
    await supabaseAdmin.from("reservas").delete().eq("id", id);
    creadas.splice(creadas.indexOf(id), 1);
  }
  console.log("M6-21/22/23 reserva en primer, intermedios y último bloque OK");

  // ── M6-28/29 · Intersección y el falso positivo ──────────────────────────
  // Ferrari y McLaren ocupados en 14:00; Red Bull y Alpine ocupados en 14:20.
  // En CADA bloque quedan 2 libres, pero NINGUNO está libre en los dos.
  await crearReserva("14:00", 15, ["Ferrari", "McLaren"]);
  await crearReserva("14:20", 15, ["Red Bull", "Alpine"]);
  assert.equal(await libresEn("14:00", 15), 2, "en el primer bloque hay 2 libres");
  assert.equal(await libresEn("14:20", 15), 2, "en el segundo bloque hay 2 libres");
  assert.equal(await libresEn("14:00", 30), 0,
    "M6-29 sumar por bloque daría 2, pero la intersección es 0: nadie está libre en ambos");
  // Y el chequeo puntual coincide.
  const noHay = await hayDisponibilidadPara({
    fecha: FECHA, hora: "14:00", duracion: 30, simuladores: ["Ferrari"],
    producto: "mensualidad", hoy: HOY,
  });
  assert.equal(noHay.ok, false, "M6-28 no se puede reservar 30 min ahí");
  // Con un solo simulador ocupado en cada bloque, el que queda libre en ambos sí sirve.
  await limpiar();
  await crearReserva("16:00", 15, ["Ferrari"]);
  await crearReserva("16:20", 15, ["McLaren"]);
  assert.equal(await libresEn("16:00", 30), 2, "Red Bull y Alpine libres en los dos bloques");
  console.log("M6-28/29 intersección de simuladores OK");

  // ── M6-30/31 · Cantidades y simuladores CONCRETOS ────────────────────────
  // Seguimos con Ferrari ocupado en 16:00 y McLaren en 16:20: para 30 min los
  // únicos libres en los DOS bloques son Red Bull y Alpine.
  const LIBRES = ["Red Bull", "Alpine"];
  const pedir30 = (simuladores: string[]) => hayDisponibilidadPara({
    fecha: FECHA, hora: "16:00", duracion: 30, simuladores,
    producto: "mensualidad", hoy: HOY,
  });
  for (const n of [1, 2]) {
    assert.equal((await pedir30(LIBRES.slice(0, n))).ok, true,
      `M6-30 ${n} simuladores realmente libres entran`);
  }
  // No es un chequeo por cantidad: el cliente elige escudería, así que pedir una
  // tomada tiene que fallar aunque queden otras dos libres.
  const tomado = await pedir30(["Ferrari"]);
  assert.equal(tomado.ok, false, "M6-31 pedir un simulador ocupado falla aunque sobren otros");
  if (!tomado.ok) {
    assert.equal(tomado.status, 409);
    assert.equal(tomado.error, "Uno o más simuladores ya están reservados en ese horario",
      "M6-31 conserva el mensaje histórico de Mercado Pago");
  }
  assert.equal((await pedir30([...LIBRES, "Ferrari"])).ok, false,
    "M6-31 dos libres más uno tomado tampoco entra");
  await limpiar();
  for (const n of [1, 2, 3, 4]) {
    const r = await hayDisponibilidadPara({
      fecha: FECHA, hora: "16:00", duracion: 60, simuladores: SIMS.slice(0, n) as unknown as string[],
      producto: "mensualidad", hoy: HOY,
    });
    assert.equal(r.ok, true, `M6-30 con el día limpio entran ${n} simuladores`);
  }
  console.log("M6-30/31 cantidades 1..4 y simuladores concretos OK");

  // ── M6-24 · Bloqueo de día completo ──────────────────────────────────────
  {
    const id = await crearBloqueo({ todo_el_dia: true });
    const r = await disp(15);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.horarios.length, 0, "M6-24 día completo bloqueado: sin horarios");
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", id);
    bloqueosCreados.splice(bloqueosCreados.indexOf(id), 1);
  }
  console.log("M6-24 bloqueo de día completo OK");

  // ── M6-25/26/27 · Bloqueos parciales y por simulador ─────────────────────
  {
    // Parcial de 18:00 a 18:40 para TODOS los simuladores.
    const id = await crearBloqueo({ hora_inicio: "18:00", hora_fin: "18:40" });
    assert.equal(await libresEn("18:00", 15), 0, "M6-25 bloqueo parcial deja el horario sin nada");
    assert.equal(await libresEn("18:20", 15), 0);
    assert.equal(await libresEn("19:00", 15), 4, "fuera del rango no afecta");
    // Una experiencia larga que ATRAVIESA el bloqueo tampoco entra.
    assert.equal(await libresEn("17:40", 30), 0, "M6-27 el bloqueo cae en el segundo bloque");
    assert.equal(await libresEn("17:20", 60), 0, "M6-27 el bloqueo cae en un bloque intermedio");
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", id);
    bloqueosCreados.splice(bloqueosCreados.indexOf(id), 1);
  }
  {
    // Solo Ferrari, en un tramo.
    const id = await crearBloqueo({ hora_inicio: "20:00", hora_fin: "20:20", simulador: "Ferrari" });
    assert.equal(await libresEn("20:00", 15), 3, "M6-26 bloqueo de UN simulador deja 3");
    assert.equal(await libresEn("20:40", 15), 4, "fuera del tramo, los 4");
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", id);
    bloqueosCreados.splice(bloqueosCreados.indexOf(id), 1);
  }
  {
    // Dos simuladores bloqueados + una reserva: se combinan.
    const b1 = await crearBloqueo({ hora_inicio: "11:00", hora_fin: "11:20", simulador: "Ferrari" });
    const b2 = await crearBloqueo({ hora_inicio: "11:00", hora_fin: "11:20", simulador: "McLaren" });
    await crearReserva("11:00", 15, ["Red Bull"]);
    assert.equal(await libresEn("11:00", 15), 1, "quedan bloqueados 2 y reservado 1: sobra Alpine");
    await supabaseAdmin.from("bloqueos_reservas").delete().in("id", [b1, b2]);
    for (const b of [b1, b2]) bloqueosCreados.splice(bloqueosCreados.indexOf(b), 1);
    await limpiar();
  }
  console.log("M6-25/26/27 bloqueos parciales, por simulador y combinados OK");

  // ── M6-16/17 · Duraciones por producto en la disponibilidad ──────────────
  for (const d of [45, 60]) {
    const r = await disponibilidadDelDia({ fecha: FECHA, duracion: d, producto: "reserva", hoy: HOY });
    assert.equal(r.ok, false, `M6-16 una reserva normal no puede pedir ${d} min`);
    const rm = await disponibilidadDelDia({ fecha: FECHA, duracion: d, producto: "mensualidad", hoy: HOY });
    assert.equal(rm.ok, true, `M6-17 mensualidad sí puede pedir ${d} min`);
  }
  // Fuera de la ventana pública, ningún producto.
  const fuera = await disponibilidadDelDia({ fecha: HOY, duracion: 15, producto: "reserva", hoy: HOY });
  assert.equal(fuera.ok, false, "hoy nunca está disponible");
  console.log("M6-16/17 duraciones por producto OK");

  // ── M6-33/34/35 · El endpoint público ────────────────────────────────────
  const { GET } = await import("@/app/api/disponibilidad/route");
  const pedir = (qs: string) =>
    GET(new Request(`https://simexperience.com.ar/api/disponibilidad?${qs}`, {
      headers: { "x-real-ip": `10.6.0.${Math.floor(Math.random() * 250)}` },
    }));

  const okRes = await pedir(`fecha=${FECHA}&duracion=15&producto=reserva`);
  // La fecha 2030 está fuera de la ventana real, así que responde 400: eso ya
  // prueba que el endpoint valida la ventana con el "hoy" real.
  assert.equal(okRes.status, 400, "el endpoint valida la ventana con el hoy real");

  const hoyReal = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const manana = (() => {
    const [y, m, d] = hoyReal.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  })();

  const res = await pedir(`fecha=${manana}&duracion=15&producto=reserva`);
  assert.equal(res.status, 200);
  assert.ok(/no-store/i.test(res.headers.get("cache-control") ?? ""), "M6-34 Cache-Control no-store");
  const cuerpo = await res.json();
  assert.equal(cuerpo.fecha, manana);
  assert.deepEqual(cuerpo.duraciones, [15, 30], "una reserva normal solo ve 15 y 30");
  assert.equal(cuerpo.fechas.length, 15, "la ventana viaja en el DTO");
  assert.ok(Array.isArray(cuerpo.horarios));
  // M6-33 · Nada de PII ni datos internos.
  const crudo = JSON.stringify(cuerpo);
  for (const prohibido of ["nombre", "telefono", "email", "reserva_id", "id\":", "simuladores\":[", "estado"]) {
    assert.ok(!crudo.includes(prohibido), `M6-33 la API no puede devolver "${prohibido}"`);
  }
  for (const h of cuerpo.horarios) {
    assert.deepEqual(Object.keys(h).sort(), ["hora", "simuladores"], "M6-33 solo hora y cantidad");
    assert.equal(typeof h.simuladores, "number", "M6-33 cantidad, no identificadores");
  }
  // Una reserva normal no puede pedir 45/60 ni por query.
  assert.equal((await pedir(`fecha=${manana}&duracion=45&producto=reserva`)).status, 400);
  assert.equal((await pedir(`fecha=${manana}&duracion=abc&producto=reserva`)).status, 400);
  assert.equal((await pedir(`fecha=${manana}&duracion=15&producto=hackeado`)).status, 400);
  // M6-35 · Con la flag apagada, Mensualidades no expone disponibilidad.
  const flagPrevia = process.env.MENSUALIDADES_ENABLED;
  delete process.env.MENSUALIDADES_ENABLED;
  const oculto = await pedir(`fecha=${manana}&duracion=45&producto=mensualidad`);
  assert.equal(oculto.status, 404, "M6-35 mensualidad oculta con la flag apagada");
  assert.equal((await oculto.json()).error, "No encontrado");
  process.env.MENSUALIDADES_ENABLED = "true";
  const visible = await pedir(`fecha=${manana}&duracion=45&producto=mensualidad`);
  assert.equal(visible.status, 200, "con la flag encendida sí responde");
  assert.deepEqual((await visible.json()).duraciones, [15, 30, 45, 60]);
  if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
  else delete process.env.MENSUALIDADES_ENABLED;
  console.log("M6-33/34/35 endpoint público OK");

  // ── M6-36/37 · Precios de reservas normales sin cambios ──────────────────
  assert.equal(precioPorSimulador(FECHA, 15), 12000, "M6-36 precio 15 min");
  assert.equal(precioPorSimulador(FECHA, 30), 18000, "M6-36 precio 30 min día de semana");
  assert.equal(precioPorSimulador(FECHA_FINDE, 30), 20000, "M6-36 precio 30 min finde");
  console.log("M6-36 precios normales sin cambios OK");

  // ── M6-38 · Empresas conserva su política de fechas ──────────────────────
  // Empresas nunca pasó por validarReservaInput: sigue pudiendo reservar fuera
  // de la ventana pública de 15 días. Se comprueba que el rechazo NO sea por
  // fecha (el código de prueba no existe, así que falla por el código).
  {
    const r = await reservarConCodigo("ZZ-CODIGO-INEXISTENTE", { nombre: "Zz" }, "2030-06-05", "10:00", ["Ferrari"], null);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, "Código inválido o no disponible.",
        "M6-38 Empresas falla por el código, no por la ventana de 15 días");
    }
  }
  console.log("M6-38 Empresas conserva su política OK");

  // ── M6-40 · El índice y el trigger anti-solapamiento siguen vigentes ─────
  {
    await crearReserva("10:00", 30, ["Ferrari"]);
    // Mismo (fecha, hora, simulador) activo → 23505.
    const { error } = await supabaseAdmin.from("reserva_slots").insert({
      reserva_id: creadas[creadas.length - 1], fecha: FECHA, hora: "10:20",
      simulador: "Ferrari", estado: "activa",
    });
    assert.equal((error as { code?: string } | null)?.code, "23505",
      "M6-40 el índice único parcial sigue impidiendo el solapamiento");
    // Y el trigger de bloqueos sigue rechazando con 23514.
    const idB = await crearBloqueo({ fecha: "2030-06-06", todo_el_dia: true });
    const { error: e2 } = await supabaseAdmin.from("reserva_slots").insert({
      reserva_id: creadas[creadas.length - 1], fecha: "2030-06-06", hora: "10:00",
      simulador: "Alpine", estado: "activa",
    });
    assert.equal((e2 as { code?: string } | null)?.code, "23514",
      "M6-40 el trigger de bloqueos sigue activo");
    await supabaseAdmin.from("bloqueos_reservas").delete().eq("id", idB);
    bloqueosCreados.splice(bloqueosCreados.indexOf(idB), 1);
    await limpiar();
  }
  console.log("M6-40 índice único y trigger intactos OK");

  // ── M6-39 · Una reserva pendiente retiene el turno y no se rompe ─────────
  {
    const { data, error } = await supabaseAdmin.from("reservas").insert({
      nombre: MARCA, telefono: "3515123456", fecha: FECHA, hora: "19:00",
      simuladores: ["Ferrari"], cantidad_turnos: 1, total: 12000, total_original: 12000,
      estado: "pendiente_pago", acepto_condiciones: true, duracion_minutos: 15,
    }).select("id").single();
    if (error) throw new Error(error.message);
    creadas.push(data.id);
    assert.equal(await libresEn("19:00", 15), 3,
      "M6-39 una pendiente reciente retiene el turno igual que antes");
    // Envejecida más allá del TTL, deja de retener.
    await supabaseAdmin.from("reservas")
      .update({ created_at: new Date(Date.now() - 60 * 60_000).toISOString() })
      .eq("id", data.id);
    assert.equal(await libresEn("19:00", 15), 4,
      "M6-39 una pendiente vieja libera el turno, como antes");
    await limpiar();
  }
  console.log("M6-39 reservas pendientes sin cambios OK");

  // ── COMPROBACIÓN M4 (pedida por M6) ──────────────────────────────────────
  // 1) El DELETE de cierre de sesión no acepta una mutación cross-origin.
  // 2) El rate limit de identificación mira IP **y** una huella no reversible
  //    del código, no una sola clave global.
  {
    const { POST: postSesion, DELETE: deleteSesion } =
      await import("@/app/api/mensualidades/sesion/route");
    const { LIMITE_POR_CODIGO } = await import("@/lib/mensualidadHuella");

    const flagPrevia = process.env.MENSUALIDADES_ENABLED;
    process.env.MENSUALIDADES_ENABLED = "true";

    // ── M4-V1 · originCheck en el DELETE ──
    const salir = (origin: string) =>
      deleteSesion(new Request("https://simexperience.com.ar/api/mensualidades/sesion", {
        method: "DELETE",
        headers: { origin, "x-real-ip": `10.9.9.${Math.floor(Math.random() * 250)}` },
      }));
    const cruzado = await salir("https://evil.example");
    assert.equal(cruzado.status, 403, "M4-V1 el DELETE rechaza el cross-origin");
    assert.equal(cruzado.headers.get("set-cookie"), null,
      "M4-V1 una petición cruzada no llega a tocar la cookie");
    const propio = await salir("https://simexperience.com.ar");
    assert.equal(propio.status, 200, "M4-V1 cerrar sesión desde el sitio sigue funcionando");

    // ── M4-V2 · Límite por huella del código, con IPs rotativas ──
    // Se usan códigos con formato válido que NO existen: el límite tiene que
    // contar igual, porque si contara solo los aciertos sería un oráculo.
    let ipSeq = 0;
    const identificar = (codigo: string) =>
      postSesion(new Request("https://simexperience.com.ar/api/mensualidades/sesion", {
        method: "POST",
        headers: {
          origin: "https://simexperience.com.ar",
          "content-type": "application/json",
          // IP DISTINTA en cada intento: el carril por IP (8/min) no puede ser
          // el que corte, si no la prueba no demostraría nada.
          "x-real-ip": `10.7.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`,
        },
        body: JSON.stringify({ codigo, telefono: "2966970000" }),
      }));

    const CODIGO_A = "MEN-ZZZZ-ZZZZ";
    const CODIGO_B = "MEN-ZZZZ-ZZZY";
    const estados: number[] = [];
    for (let i = 0; i < LIMITE_POR_CODIGO + 2; i++) {
      estados.push((await identificar(CODIGO_A)).status);
    }
    assert.ok(estados.slice(0, LIMITE_POR_CODIGO).every((s) => s === 401),
      `M4-V2 los primeros ${LIMITE_POR_CODIGO} intentos responden 401, no 429`);
    assert.ok(estados.slice(LIMITE_POR_CODIGO).every((s) => s === 429),
      "M4-V2 pasado el límite el mismo código se corta aunque cambie la IP");

    // Y es POR CÓDIGO: otro código, desde IPs igual de nuevas, sigue entrando.
    const otro = await identificar(CODIGO_B);
    assert.equal(otro.status, 401,
      "M4-V2 el límite es por huella del código, no una clave global");

    if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
    else delete process.env.MENSUALIDADES_ENABLED;
  }
  console.log("M4-V1/V2 originCheck en DELETE y límite por huella del código OK");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M6 OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count } = await supabaseAdmin
      .from("reservas").select("*", { count: "exact", head: true }).eq("nombre", MARCA);
    console.log(`limpieza: ${count ?? 0} reservas temporales restantes (debe ser 0)`);
  });

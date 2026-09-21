import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearSesion, leerSesion } from "@/lib/mensualidadSesion";
import { tieneMensualidadBloqueada } from "@/lib/mensualidadesCompra";
import { cancelarReserva, reprogramarReserva } from "@/lib/mensualidadesGestionReserva";
import {
  ajustarSaldo, cambiarBloqueo, cambiarTelefono, cancelarReservaAdmin,
  extenderVencimiento, getAuditoria, regenerarCodigo, reprogramarReservaAdmin,
} from "@/lib/mensualidadesAdminAcciones";
import { getDetalleMensualidad, listarMensualidades } from "@/lib/mensualidadesAdmin";
import {
  bloquesDeAgenda, esFinDeSemana, fechasPublicasPara, horariosPosiblesPara, sumarDias,
} from "@/lib/agenda";
import { simuladoresLibresDelDia } from "@/lib/disponibilidad";

// Integración del Bloque M7 contra la DB REAL, con datos TEMPORALES marcados y
// eliminados al final.
//
// Lo que se prueba es lo que un panel administrativo NO puede equivocar:
//   · que cada acción haga exactamente lo que dice y NADA más (extender no
//     toca saldo, ajustar no toca vencimiento, bloquear no cancela reservas);
//   · que un doble clic no aplique dos veces;
//   · que dos administradores simultáneos no dejen saldo ni auditoría rotos;
//   · que el bloqueo sea efectivo en el SERVIDOR, no en la interfaz;
//   · que staff vea menos que admin, decidido por el servidor;
//   · que la política de M5C no se altere en silencio por venir de adentro.
//
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM7.integration.ts

const MARCA = `zzm7_${Date.now()}`;
const EMAIL = `${MARCA}@test.local`;
const billeteras: string[] = [];

let seq = 0;
const nuevoTel = () => `2966${String(100000 + (Date.now() % 100000) + seq++).slice(-6)}`;
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};
let k = 0;
const clave = () => `k${MARCA}${String(k++).padStart(5, "0")}`.slice(0, 60);

const CTX = (rol: "admin" | "staff" = "admin") => ({
  actor: rol, rol, idempotencyKey: clave(),
});
const DOS = ["Ferrari", "McLaren"];

async function hoyCordoba(): Promise<string> {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}

async function crearBilletera(opts: {
  saldo?: number; diasVence?: number; bloqueada?: boolean; tel?: string;
} = {}): Promise<{ id: string; tel: string; codigo: string }> {
  const hoy = await hoyCordoba();
  const tel = opts.tel ?? nuevoTel();
  const codigo = nuevoCodigo();
  const { data, error } = await supabaseAdmin.from("mensualidades").insert({
    codigo, titular_nombre: "Probe", titular_apellido: MARCA,
    titular_telefono: tel, telefono_norm: tel, titular_email: EMAIL,
    saldo_minutos: opts.saldo ?? 600,
    vence_el: sumarDias(hoy, opts.diasVence ?? 40),
    bloqueada: opts.bloqueada ?? false,
  }).select("id").single();
  if (error) throw new Error(`crearBilletera: ${error.message}`);
  billeteras.push(data.id as string);
  return { id: data.id as string, tel, codigo };
}

const saldoDe = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidades").select("saldo_minutos").eq("id", id).single();
  return Number(data?.saldo_minutos);
};
const filaDe = async (id: string) => {
  const { data } = await supabaseAdmin.from("mensualidades")
    .select("codigo, telefono_norm, titular_telefono, vence_el, bloqueada, bloqueo_motivo, saldo_minutos")
    .eq("id", id).single();
  return data!;
};
const contar = async (tabla: string, col: string, val: string) => {
  const { count } = await supabaseAdmin.from(tabla).select("*", { count: "exact", head: true }).eq(col, val);
  return count ?? 0;
};
const movimientos = async (id: string, tipo?: string) => {
  let q = supabaseAdmin.from("mensualidad_movimientos").select("tipo, minutos, saldo_anterior, saldo_posterior, motivo, actor").eq("mensualidad_id", id);
  if (tipo) q = q.eq("tipo", tipo);
  const { data } = await q;
  return data ?? [];
};

async function crearReserva(id: string, fecha: string, hora: string, duracion = 30, sims = DOS) {
  const { data, error } = await supabaseAdmin.rpc("crear_reserva_mensualidad", {
    p_mensualidad_id: id, p_fecha: fecha, p_hora: hora, p_duracion: duracion,
    p_simuladores: sims, p_slots: bloquesDeAgenda(fecha, hora, duracion) ?? [hora],
    p_idempotency_key: clave(), p_condiciones_version: "cond-m7",
  });
  if (error) throw new Error(`crearReserva: ${error.message}`);
  const f = (Array.isArray(data) ? data[0] : data) as { referencia_publica: string; reserva_id: number };
  return { referencia: f.referencia_publica, id: Number(f.reserva_id) };
}

/** Horarios de ese día con los cuatro simuladores libres. */
async function libres(fecha: string, duracion: number): Promise<string[]> {
  const d = await simuladoresLibresDelDia({ fecha, duracion, producto: "mensualidad" });
  if (!d.ok) return [];
  const posibles = horariosPosiblesPara("mensualidad", fecha, duracion);
  return d.horarios.filter((h) => h.simuladores.length === 4 && posibles.includes(h.hora)).map((h) => h.hora);
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
  await supabaseAdmin.from("reservas").delete().eq("nombre", MARCA);
}

async function main() {
  const hoy = await hoyCordoba();
  const habiles = fechasPublicasPara("mensualidad", hoy);
  assert.ok(habiles.length >= 5, "la ventana necesita días hábiles");

  const contarTodo = async () => ({
    mensualidades: await contar("mensualidades", "titular_email", EMAIL),
    reservas: (await supabaseAdmin.from("reservas").select("*", { count: "exact", head: true }).eq("origen", "mensualidad")).count ?? 0,
  });
  const antes = await contarTodo();
  console.log(`base: hoy=${hoy} · contadores antes ${JSON.stringify(antes)}`);

  // ── M7-1 · EXTENDER VENCIMIENTO ─────────────────────────────────────────
  {
    const m = await crearBilletera({ saldo: 300, diasVence: 5 });
    const original = (await filaDe(m.id)).vence_el;
    const nueva = sumarDias(hoy, 30);

    // No se puede acortar, ni dejar igual: desde acá solo se extiende.
    for (const mala of [sumarDias(hoy, 1), original]) {
      const r = await extenderVencimiento(m.id, mala, "acortar no", CTX());
      assert.equal(r.ok, false, `M7-1 ${mala} no es posterior al vencimiento`);
      if (!r.ok) assert.equal(r.codigo, "fecha_no_posterior");
    }
    assert.equal((await filaDe(m.id)).vence_el, original, "M7-1 ningún rechazo movió la fecha");

    const ctx = CTX();
    const ok = await extenderVencimiento(m.id, nueva, "el cliente estuvo internado", ctx);
    assert.ok(ok.ok, `M7-1 la extensión tiene que entrar: ${!ok.ok ? ok.error : ""}`);
    if (ok.ok) {
      assert.equal(ok.data.vence_anterior, original);
      assert.equal(ok.data.vence_nuevo, nueva);
      assert.equal(ok.data.estado_resultante, "vigente");
      assert.equal(ok.data.idempotente, false);
    }
    assert.equal((await filaDe(m.id)).vence_el, nueva, "M7-1 la fecha quedó movida");

    // Lo que NO hizo: ni compra, ni saldo, ni movimiento.
    assert.equal(await saldoDe(m.id), 300, "M7-1 el saldo no se toca");
    assert.equal(await contar("mensualidad_compras", "mensualidad_id", m.id), 0,
      "M7-1 NO se crea una compra: extender no es renovar");
    assert.equal((await movimientos(m.id)).length, 0, "M7-1 no deja movimiento de saldo");

    // Idempotencia: la misma clave no vuelve a mover nada.
    const replay = await extenderVencimiento(m.id, nueva, "el cliente estuvo internado", ctx);
    assert.ok(replay.ok && replay.data.idempotente === true, "M7-1 el reintento es un replay");
    assert.equal(await contar("mensualidad_auditoria", "mensualidad_id", m.id), 1,
      "M7-1 una sola línea de auditoría");

    // La misma clave con OTRA fecha se rechaza: no es el mismo intento.
    const otra = await extenderVencimiento(m.id, sumarDias(hoy, 31), "otra cosa", ctx);
    assert.equal(otra.ok, false);
    if (!otra.ok) assert.equal(otra.codigo, "idempotency_key_con_otro_payload");

    // Una VENCIDA que se extiende recupera el estado calculado.
    const v = await crearBilletera({ saldo: 300, diasVence: -3 });
    assert.equal((await getDetalleMensualidad(v.id, "admin"))!.titular.estado, "vencida");
    const rv = await extenderVencimiento(v.id, sumarDias(hoy, 10), "reactivación comercial", CTX());
    assert.ok(rv.ok && rv.data.estado_resultante === "vigente", "M7-1 vencida + extensión = vigente");

    // Pero si además está bloqueada, sigue bloqueada: el bloqueo gana.
    const b = await crearBilletera({ saldo: 300, diasVence: -3, bloqueada: true });
    const rb = await extenderVencimiento(b.id, sumarDias(hoy, 10), "extensión con bloqueo", CTX());
    assert.ok(rb.ok && rb.data.estado_resultante === "bloqueada",
      "M7-1 extender no desbloquea");
  }
  console.log("M7-1 extender vencimiento: solo extiende, no cobra, no toca saldo OK");

  // ── M7-2 · AJUSTAR SALDO ────────────────────────────────────────────────
  {
    const m = await crearBilletera({ saldo: 300 });

    const sumar = await ajustarSaldo(m.id, "agregar", 60, "compensación por corte de luz", CTX());
    assert.ok(sumar.ok, `M7-2 agregar: ${!sumar.ok ? sumar.error : ""}`);
    if (sumar.ok) {
      assert.equal(sumar.data.saldo_anterior, 300);
      assert.equal(sumar.data.saldo_posterior, 360);
      assert.equal(sumar.data.minutos_aplicados, 60);
    }

    const restar = await ajustarSaldo(m.id, "descontar", 45, "carga duplicada", CTX());
    assert.ok(restar.ok);
    if (restar.ok) assert.equal(restar.data.saldo_posterior, 315);
    assert.equal(await saldoDe(m.id), 315);

    // Exactamente un movimiento por ajuste, con el signo correcto.
    const movs = await movimientos(m.id, "ajuste_admin");
    assert.equal(movs.length, 2, "M7-2 un movimiento por ajuste, ni uno más");
    assert.deepEqual(movs.map((x) => x.minutos).sort((a, b) => a - b), [-45, 60]);
    for (const mv of movs) {
      assert.equal(mv.saldo_posterior, mv.saldo_anterior + mv.minutos, "M7-2 cada movimiento cierra");
      assert.ok(mv.motivo && mv.motivo.length > 0, "M7-2 el movimiento guarda el motivo");
      assert.equal(mv.actor, "admin");
    }

    // El saldo NUNCA queda negativo.
    const imposible = await ajustarSaldo(m.id, "descontar", 600, "descontar de más", CTX());
    assert.equal(imposible.ok, false);
    if (!imposible.ok) assert.equal(imposible.codigo, "saldo_insuficiente");
    assert.equal(await saldoDe(m.id), 315, "M7-2 el rechazo no dejó rastro");
    assert.equal((await movimientos(m.id, "ajuste_admin")).length, 2);

    // Descontar TODO sí se puede: cero es un saldo válido.
    const aCero = await ajustarSaldo(m.id, "descontar", 315, "baja del plan", CTX());
    assert.ok(aCero.ok && aCero.data.saldo_posterior === 0);
    assert.equal(aCero.ok && aCero.data.estado_resultante, "agotada",
      "M7-2 sin minutos, el estado lo dice");

    // El ajuste no crea compras ni mueve el vencimiento.
    const antesFecha = (await filaDe(m.id)).vence_el;
    await ajustarSaldo(m.id, "agregar", 120, "reintegro", CTX());
    assert.equal((await filaDe(m.id)).vence_el, antesFecha, "M7-2 el vencimiento no se mueve");
    assert.equal(await contar("mensualidad_compras", "mensualidad_id", m.id), 0,
      "M7-2 un ajuste no es una compra");
  }
  console.log("M7-2 ajustar saldo: exacto, sin negativos y sin compras OK");

  // ── M7-3 · Doble clic y concurrencia sobre el saldo ─────────────────────
  {
    const m = await crearBilletera({ saldo: 300 });
    const ctx = CTX();

    // Doble clic literal: la misma clave dos veces, en paralelo.
    const [a, b] = await Promise.all([
      ajustarSaldo(m.id, "agregar", 60, "doble clic", ctx),
      ajustarSaldo(m.id, "agregar", 60, "doble clic", ctx),
    ]);
    assert.ok(a.ok || b.ok, "M7-3 al menos una responde bien");
    assert.equal(await saldoDe(m.id), 360, "M7-3 el doble clic suma UNA vez");
    assert.equal((await movimientos(m.id, "ajuste_admin")).length, 1, "M7-3 un solo movimiento");

    // Dos administradores distintos, en paralelo, con claves distintas: los dos
    // se aplican y la cadena de saldos queda sin saltos.
    const [c, d] = await Promise.all([
      ajustarSaldo(m.id, "agregar", 30, "admin uno", CTX()),
      ajustarSaldo(m.id, "descontar", 15, "admin dos", CTX()),
    ]);
    assert.ok(c.ok && d.ok, "M7-3 dos ajustes distintos entran los dos");
    assert.equal(await saldoDe(m.id), 375, "M7-3 360 + 30 - 15");
    const movs = await movimientos(m.id, "ajuste_admin");
    assert.equal(movs.length, 3);
    for (const mv of movs) {
      assert.equal(mv.saldo_posterior, mv.saldo_anterior + mv.minutos,
        "M7-3 ningún movimiento quedó inconsistente consigo mismo");
    }
    // Y ninguno leyó un saldo viejo: los posteriores son todos distintos.
    const posteriores = movs.map((x) => x.saldo_posterior);
    assert.equal(new Set(posteriores).size, posteriores.length,
      "M7-3 dos ajustes concurrentes no escribieron el mismo saldo posterior");
  }
  console.log("M7-3 idempotencia y concurrencia del saldo OK");

  // ── M7-4 · BLOQUEAR Y REACTIVAR ─────────────────────────────────────────
  {
    const m = await crearBilletera({ saldo: 600 });
    const fecha = habiles[2];
    const horas = await libres(fecha, 30);
    assert.ok(horas.length, "M7-4 hace falta un horario libre");
    const r = await crearReserva(m.id, fecha, horas[horas.length - 1], 30);
    const saldoAntes = await saldoDe(m.id);
    const venceAntes = (await filaDe(m.id)).vence_el;

    // Sesión viva antes de bloquear.
    const token = (await crearSesion(m.id))!;
    assert.ok(await leerSesion(token), "M7-4 la sesión estaba viva");

    const bloq = await cambiarBloqueo(m.id, true, "pago rechazado reiterado", CTX());
    assert.ok(bloq.ok, `M7-4 bloquear: ${!bloq.ok ? bloq.error : ""}`);
    if (bloq.ok) {
      assert.equal(bloq.data.bloqueada_ahora, true);
      assert.equal(bloq.data.estado_resultante, "bloqueada");
      assert.ok(bloq.data.sesiones_cerradas >= 1, "M7-4 cerró la sesión abierta");
    }

    // Lo que el bloqueo NO hace.
    assert.equal(await saldoDe(m.id), saldoAntes, "M7-4 no toca el saldo");
    assert.equal((await filaDe(m.id)).vence_el, venceAntes, "M7-4 no toca el vencimiento");
    const { data: sigue } = await supabaseAdmin.from("reservas")
      .select("estado").eq("referencia_publica", r.referencia).single();
    assert.equal(sigue!.estado, "activa", "M7-4 NO cancela las reservas que ya existían");

    // Lo que sí hace, comprobado EN EL SERVIDOR.
    assert.equal(await leerSesion(token), null, "M7-4 la sesión abierta dejó de valer");
    assert.equal(await tieneMensualidadBloqueada(m.tel), true,
      "M7-4 no se puede iniciar una compra: no se cobra una mensualidad inutilizable");

    const otraFecha = habiles[3];
    const otrasHoras = await libres(otraFecha, 30);
    const nueva = await crearReserva(m.id, otraFecha, otrasHoras[0], 30).catch((e) => e as Error);
    assert.ok(nueva instanceof Error && /mensualidad_bloqueada/.test(nueva.message),
      "M7-4 bloqueada no puede reservar");

    // El titular NO puede reprogramar…
    const repCliente = await reprogramarReserva(m.id, r.referencia, otraFecha, otrasHoras[0], clave());
    assert.equal(repCliente.ok, false, "M7-4 el titular bloqueado no reprograma");
    if (!repCliente.ok) assert.equal(repCliente.codigo, "mensualidad_bloqueada");

    // …pero el administrador sí: el bloqueo es contra el cliente.
    const repAdmin = await reprogramarReservaAdmin(
      m.id, r.referencia, otraFecha, otrasHoras[0], "el cliente pidió moverlo", CTX(),
    );
    assert.ok(repAdmin.ok, `M7-4 la administración sí reprograma: ${!repAdmin.ok ? repAdmin.error : ""}`);

    // Y cancelar se sigue permitiendo: liberar un turno le sirve a la operación.
    const can = await cancelarReserva(m.id, r.referencia, clave());
    assert.ok(can.ok, "M7-4 una bloqueada igual puede cancelar su turno");

    // Reactivar no regala nada.
    const saldoBloqueada = await saldoDe(m.id);
    const react = await cambiarBloqueo(m.id, false, "regularizó", CTX());
    assert.ok(react.ok && react.data.bloqueada_ahora === false);
    assert.equal(await saldoDe(m.id), saldoBloqueada, "M7-4 reactivar no suma saldo");
    assert.equal((await filaDe(m.id)).vence_el, venceAntes, "M7-4 reactivar no extiende");
    assert.equal((await filaDe(m.id)).bloqueo_motivo, null, "M7-4 el motivo vivo se limpia");
    assert.equal(await tieneMensualidadBloqueada(m.tel), false);

    // Bloquear dos veces no es una acción.
    const repe = await cambiarBloqueo(m.id, false, "otra vez", CTX());
    assert.equal(repe.ok, false);
    if (!repe.ok) assert.equal(repe.codigo, "estado_sin_cambios");
  }
  console.log("M7-4 bloquear/reactivar: efectivo en servidor, sin daños colaterales OK");

  // ── M7-5 · CAMBIO DE TELÉFONO ───────────────────────────────────────────
  {
    const m = await crearBilletera({ saldo: 300 });
    const ocupado = await crearBilletera({ saldo: 90 });
    const fecha = habiles[1];
    const horas = await libres(fecha, 15);
    await crearReserva(m.id, fecha, horas[horas.length - 1], 15);
    await ajustarSaldo(m.id, "agregar", 15, "algo previo", CTX());

    const token = (await crearSesion(m.id))!;
    const codigoAntes = (await filaDe(m.id)).codigo;
    const reservasAntes = await contar("reservas", "mensualidad_id", m.id);
    const movsAntes = (await movimientos(m.id)).length;

    // Formato inválido: ni se intenta.
    for (const malo of ["123", "abcdefghij", "0000000000"]) {
      const r = await cambiarTelefono(m.id, malo, "corrección", CTX());
      assert.equal(r.ok, false, `M7-5 teléfono inválido: ${malo}`);
      if (!r.ok) assert.equal(r.codigo, "telefono_invalido");
    }

    // Ya es de otra billetera: se rechaza, NO se fusiona.
    const enUso = await cambiarTelefono(m.id, ocupado.tel, "unificar", CTX());
    assert.equal(enUso.ok, false, "M7-5 un teléfono ajeno no se toma");
    if (!enUso.ok) assert.equal(enUso.codigo, "telefono_en_uso");
    assert.equal((await filaDe(m.id)).telefono_norm, m.tel, "M7-5 el rechazo no cambió nada");
    assert.equal((await filaDe(ocupado.id)).telefono_norm, ocupado.tel,
      "M7-5 y la otra billetera quedó intacta");

    // El mismo que ya tenía tampoco es un cambio.
    const igual = await cambiarTelefono(m.id, m.tel, "mismo", CTX());
    assert.equal(igual.ok, false);
    if (!igual.ok) assert.equal(igual.codigo, "telefono_sin_cambios");

    // Cambio real, escrito como lo escribiría una persona.
    const nuevoNorm = nuevoTel();
    const comoLoEscriben = `+54 9 ${nuevoNorm.slice(0, 4)} ${nuevoNorm.slice(4)}`;
    const ok = await cambiarTelefono(m.id, comoLoEscriben, "cambió de número", CTX());
    assert.ok(ok.ok, `M7-5 el cambio tiene que entrar: ${!ok.ok ? ok.error : ""}`);
    if (ok.ok) {
      assert.equal(ok.data.telefono_anterior_fin, m.tel.slice(-4));
      assert.equal(ok.data.telefono_nuevo_fin, nuevoNorm.slice(-4));
      assert.ok(ok.data.sesiones_cerradas >= 1);
    }

    const fila = await filaDe(m.id);
    assert.equal(fila.telefono_norm, nuevoNorm, "M7-5 quedó normalizado a 10 dígitos");
    assert.equal(fila.codigo, codigoAntes, "M7-5 el código NO cambia por cambiar el teléfono");
    assert.equal(await leerSesion(token), null, "M7-5 el número anterior deja de autenticar YA");
    assert.equal(await contar("reservas", "mensualidad_id", m.id), reservasAntes,
      "M7-5 no se mueve ninguna reserva");
    assert.equal((await movimientos(m.id)).length, movsAntes, "M7-5 no se mueve ningún movimiento");

    // La auditoría guarda solo los últimos cuatro dígitos.
    const aud = await getAuditoria(m.id);
    const cambio = aud.find((a) => a.accion === "cambiar_telefono")!;
    assert.ok(cambio, "M7-5 quedó auditado");
    const crudo = JSON.stringify(cambio);
    assert.ok(!crudo.includes(m.tel) && !crudo.includes(nuevoNorm),
      "M7-5 la auditoría NO guarda teléfonos completos");
    assert.ok(crudo.includes(nuevoNorm.slice(-4)), "M7-5 pero sí alcanza para reconstruir qué pasó");
  }
  console.log("M7-5 cambio de teléfono: identidad, sesiones y sin fusionar nada OK");

  // ── M7-6 · REGENERAR EL CÓDIGO ──────────────────────────────────────────
  {
    const m = await crearBilletera({ saldo: 300 });
    const viejo = (await filaDe(m.id)).codigo;
    const token = (await crearSesion(m.id))!;

    const r = await regenerarCodigo(m.id, "el código se filtró por WhatsApp", CTX());
    assert.ok(r.ok, `M7-6 regenerar: ${!r.ok ? r.error : ""}`);
    const nuevo = r.ok ? r.data.codigo_nuevo : "";
    assert.match(nuevo, /^MEN-[A-Z2-9]{4}-[A-Z2-9]{4}$/, "M7-6 el nuevo tiene el formato público");
    assert.notEqual(nuevo, viejo, "M7-6 y es distinto del anterior");
    assert.equal((await filaDe(m.id)).codigo, nuevo);
    assert.equal(await leerSesion(token), null, "M7-6 las sesiones se cierran");

    // El código anterior ya no identifica a nadie.
    const { count } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("codigo", viejo);
    assert.equal(count ?? 0, 0, "M7-6 el código anterior dejó de existir");

    // Ni el viejo ni el nuevo quedan escritos en la auditoría.
    const aud = await getAuditoria(m.id);
    const linea = aud.find((a) => a.accion === "regenerar_codigo")!;
    assert.ok(linea, "M7-6 quedó auditado");
    const crudo = JSON.stringify(aud);
    assert.ok(!crudo.includes(viejo), "M7-6 la auditoría no guarda el código anterior");
    assert.ok(!crudo.includes(nuevo), "M7-6 ni el nuevo: sería dejarlo en claro en un registro");

    // Y el saldo, el vencimiento y las reservas siguen donde estaban.
    assert.equal(await saldoDe(m.id), 300);
  }
  console.log("M7-6 regenerar código: rota, cierra sesiones y no lo escribe en ningún registro OK");

  // ── M7-7 · LISTADO: búsqueda, filtros y paginación EN SERVIDOR ──────────
  {
    const a = await crearBilletera({ saldo: 300, diasVence: 20 });
    const b = await crearBilletera({ saldo: 0, diasVence: 20 });
    const c = await crearBilletera({ saldo: 300, diasVence: -2 });
    const d = await crearBilletera({ saldo: 300, diasVence: 20, bloqueada: true });
    const fecha = habiles[4];
    const horas = await libres(fecha, 15);
    const res = await crearReserva(a.id, fecha, horas[horas.length - 1], 15);

    const mios = (l: { filas: { id: string }[] }) =>
      l.filas.filter((f) => [a.id, b.id, c.id, d.id].includes(f.id));

    // Por cada campo que el bloque pide.
    for (const [nota, q, esperado] of [
      ["código", (await filaDe(a.id)).codigo as string, a.id],
      ["teléfono", a.tel, a.id],
      ["apellido", MARCA, null],
      ["correo", EMAIL, null],
      ["referencia", res.referencia, a.id],
    ] as const) {
      const l = await listarMensualidades({ busqueda: q, estado: "todas", pagina: 1 });
      if (esperado) {
        assert.ok(l.filas.some((f) => f.id === esperado), `M7-7 búsqueda por ${nota}`);
      } else {
        assert.ok(mios(l).length >= 4, `M7-7 búsqueda por ${nota} encuentra las cuatro`);
      }
    }
    // Un nombre parcial también sirve: es lo que se tiene cuando atiende alguien.
    const parcial = await listarMensualidades({ busqueda: "prob", estado: "todas", pagina: 1 });
    assert.ok(mios(parcial).length >= 4, "M7-7 búsqueda parcial por nombre");

    // Filtros: cada estado devuelve el suyo y ninguno de los otros.
    for (const [estado, id] of [["vigente", a.id], ["agotada", b.id], ["vencida", c.id], ["bloqueada", d.id]] as const) {
      const l = await listarMensualidades({ busqueda: MARCA, estado, pagina: 1 });
      const propias = mios(l);
      assert.ok(propias.some((f) => f.id === id), `M7-7 filtro ${estado} incluye la suya`);
      assert.equal(propias.length, 1, `M7-7 filtro ${estado} excluye las demás`);
      assert.ok(l.filas.every((f) => f.estado === estado), `M7-7 filtro ${estado} es homogéneo`);
    }

    // Paginación: en servidor, con total, y sin repetir ni perder filas.
    const p1 = await listarMensualidades({ busqueda: MARCA, estado: "todas", pagina: 1, porPagina: 2 });
    const p2 = await listarMensualidades({ busqueda: MARCA, estado: "todas", pagina: 2, porPagina: 2 });
    assert.equal(p1.filas.length, 2, "M7-7 la página trae exactamente lo pedido");
    assert.ok(p1.total >= 4 && p1.total === p2.total, "M7-7 el total no depende de la página");
    assert.ok(p1.paginas >= 2);
    const ids1 = p1.filas.map((f) => f.id);
    const ids2 = p2.filas.map((f) => f.id);
    assert.equal(ids1.filter((x) => ids2.includes(x)).length, 0,
      "M7-7 dos páginas seguidas no repiten filas: el orden es total");

    // El tope es duro: pedir 10.000 no baja la tabla entera.
    const enorme = await listarMensualidades({ busqueda: null, estado: "todas", pagina: 1, porPagina: 10_000 });
    assert.ok(enorme.filas.length <= 100, "M7-7 el servidor no devuelve más de 100 por página");

    // El listado no expone el código ni nada técnico.
    const crudo = JSON.stringify(p1);
    assert.ok(!crudo.includes((await filaDe(a.id)).codigo as string),
      "M7-7 el listado NO lleva el código de acceso");
    for (const prohibido of ["token", "hash", "idempotency", "mp_", "bloqueo_motivo"]) {
      assert.ok(!crudo.includes(prohibido), `M7-7 el listado no expone "${prohibido}"`);
    }
    // Y sí lleva lo que el bloque pide como columnas.
    const fila = p1.filas[0];
    assert.deepEqual(Object.keys(fila).sort(), [
      "apellido", "email", "estado", "id", "nombre", "plan_comprado_at", "plan_nombre",
      "proxima_fecha", "proxima_hora", "saldo_minutos", "telefono", "ultima_actividad", "vence_el",
    ], "M7-7 el listado tiene exactamente las columnas del bloque");
    const conReserva = (await listarMensualidades({ busqueda: a.tel, estado: "todas", pagina: 1 })).filas[0];
    assert.equal(conReserva.proxima_fecha, fecha, "M7-7 muestra la próxima reserva cuando existe");
  }
  console.log("M7-7 listado: búsqueda, filtros, paginación y orden estable OK");

  // ── M7-8 · DETALLE: staff ve menos que admin, y lo decide el servidor ───
  {
    const m = await crearBilletera({ saldo: 300 });
    await ajustarSaldo(m.id, "agregar", 60, "algo para el historial", CTX());
    await cambiarBloqueo(m.id, true, "para que haya auditoría", CTX());

    const comoAdmin = (await getDetalleMensualidad(m.id, "admin"))!;
    const comoStaff = (await getDetalleMensualidad(m.id, "staff"))!;

    // El código: solo admin.
    assert.equal(comoAdmin.codigo, (await filaDe(m.id)).codigo);
    assert.equal(comoAdmin.codigo_visible, true);
    assert.equal(comoStaff.codigo, null, "M7-8 staff NO recibe el código");
    assert.equal(comoStaff.codigo_visible, false);
    assert.ok(!JSON.stringify(comoStaff).includes(comoAdmin.codigo!),
      "M7-8 el código no se cuela por ningún otro campo");

    // Lo operativo lo ven los dos.
    for (const d of [comoAdmin, comoStaff]) {
      assert.equal(d.titular.estado, "bloqueada");
      assert.equal(d.saldo_minutos, 360);
      assert.ok(d.titular.telefono && d.titular.email);
      assert.ok(d.historial.some((h) => h.tipo === "ajuste_admin"),
        "M7-8 el movimiento de saldo explica el saldo: lo ven los dos");
    }

    // El rastro administrativo: solo admin.
    assert.ok(comoAdmin.historial.some((h) => h.tipo === "bloquear"),
      "M7-8 admin ve quién bloqueó");
    assert.ok(!comoStaff.historial.some((h) => h.tipo === "bloquear"),
      "M7-8 staff no ve el rastro administrativo");

    // El detalle no lleva ids internos ni nada técnico.
    const crudo = JSON.stringify(comoAdmin);
    for (const prohibido of ["token_hash", "idempotency", "mp_payment", "mp_preference", "external_reference"]) {
      assert.ok(!crudo.includes(prohibido), `M7-8 el detalle no expone "${prohibido}"`);
    }
  }
  console.log("M7-8 detalle: el rol lo decide el servidor OK");

  // ── M7-9 · RESERVAS DESDE LA ADMINISTRACIÓN: la política de M5C manda ───
  {
    const m = await crearBilletera({ saldo: 600 });
    const fecha = habiles[3];
    const horas = await libres(fecha, 30);
    const r = await crearReserva(m.id, fecha, horas[horas.length - 1], 30);
    const saldoTrasCrear = await saldoDe(m.id);

    // (M8C.1) El fin de semana YA opera, también para la administración: lo que
    // la sigue limitando es el cierre de las 14:00, igual que al titular.
    const finde = [...Array(16).keys()].map((i) => sumarDias(hoy, i))
      .find((f) => f > hoy && esFinDeSemana(f))!;
    assert.ok(finde, "M7-9 la ventana siempre tiene un fin de semana");
    const aFindeTarde = await reprogramarReservaAdmin(m.id, r.referencia, finde, "14:20", "prueba", CTX());
    assert.equal(aFindeTarde.ok, false,
      "M7-9 la administración tampoco puede empezar fuera de la grilla del fin de semana");
    if (!aFindeTarde.ok) assert.equal(aFindeTarde.codigo, "hora_invalida");

    const horasFinde = await libres(finde, 30);
    assert.ok(horasFinde.length, "M7-9 hace falta un horario libre el fin de semana");
    const aFinde = await reprogramarReservaAdmin(m.id, r.referencia, finde, horasFinde[0], "prueba", CTX());
    assert.equal(aFinde.ok, true,
      `M7-9 pero a la mañana del fin de semana sí: ${!aFinde.ok ? aFinde.error : ""}`);
    assert.equal(await saldoDe(m.id), saldoTrasCrear, "M7-9 reprogramar no cuesta saldo");

    // Reprogramación válida: no cuesta saldo.
    const destino = habiles[5];
    const horasDestino = await libres(destino, 30);
    const ok = await reprogramarReservaAdmin(
      m.id, r.referencia, destino, horasDestino[horasDestino.length - 1], "cambio pedido por teléfono", CTX(),
    );
    assert.ok(ok.ok, `M7-9 reprogramar: ${!ok.ok ? ok.error : ""}`);
    assert.equal(await saldoDe(m.id), saldoTrasCrear, "M7-9 reprogramar no cuesta saldo");

    // Cancelar con más de 24 h restituye, igual que para el titular.
    const can = await cancelarReservaAdmin(m.id, r.referencia, "el cliente no puede venir", CTX());
    assert.ok(can.ok, `M7-9 cancelar: ${!can.ok ? can.error : ""}`);
    if (can.ok) {
      assert.equal(can.data.restituyo, true);
      assert.equal(can.data.minutos_restituidos, 60, "M7-9 restitución exacta: 30 x 2");
    }
    assert.equal(await saldoDe(m.id), 600, "M7-9 el saldo volvió entero");

    // Las dos quedaron auditadas con su motivo y su referencia.
    const aud = await getAuditoria(m.id);
    for (const accion of ["reprogramar_reserva", "cancelar_reserva"]) {
      const linea = aud.find((a) => a.accion === accion);
      assert.ok(linea, `M7-9 ${accion} quedó auditada`);
      assert.equal(linea!.referencia, r.referencia, `M7-9 ${accion} guarda la referencia`);
      assert.ok(linea!.motivo.length > 0, `M7-9 ${accion} guarda el motivo`);
    }
  }
  console.log("M7-9 reservas desde la administración: misma política que M5C OK");

  // ── M7-10 · AUDITORÍA: toda acción deja rastro con motivo ───────────────
  {
    const m = await crearBilletera({ saldo: 300 });
    await extenderVencimiento(m.id, sumarDias(hoy, 60), "motivo extensión", CTX());
    await ajustarSaldo(m.id, "agregar", 15, "motivo ajuste", CTX());
    await cambiarBloqueo(m.id, true, "motivo bloqueo", CTX());
    await cambiarBloqueo(m.id, false, "motivo reactivación", CTX());
    await cambiarTelefono(m.id, nuevoTel(), "motivo teléfono", CTX());
    await regenerarCodigo(m.id, "motivo código", CTX());

    const aud = await getAuditoria(m.id);
    const acciones = aud.map((a) => a.accion).sort();
    assert.deepEqual(acciones, [
      "ajustar_saldo", "bloquear", "cambiar_telefono", "extender_vencimiento",
      "reactivar", "regenerar_codigo",
    ], "M7-10 las seis acciones dejaron rastro");
    for (const a of aud) {
      assert.ok(a.motivo && a.motivo.trim().length > 0, `M7-10 ${a.accion} tiene motivo`);
      assert.equal(a.actor_rol, "admin", `M7-10 ${a.accion} registra el rol que la ejecutó`);
      assert.ok(a.fecha, `M7-10 ${a.accion} tiene fecha`);
    }
    // Está ordenada de lo más nuevo a lo más viejo.
    const fechas = aud.map((a) => a.fecha);
    assert.deepEqual(fechas, [...fechas].sort().reverse(), "M7-10 la auditoría viene cronológica");
  }
  console.log("M7-10 auditoría completa con motivo obligatorio OK");

  // ── M7-11 · anon no puede ejecutar NADA de esto ─────────────────────────
  {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    for (const fn of [
      "mensualidad_admin_listar",
      "mensualidad_admin_extender_vencimiento",
      "mensualidad_admin_ajustar_saldo",
      "mensualidad_admin_cambiar_bloqueo",
      "mensualidad_admin_cambiar_telefono",
      "mensualidad_admin_regenerar_codigo",
      "mensualidad_auditar",
      "mensualidad_revocar_sesiones",
    ]) {
      const { error } = await anon.rpc(fn as never, {} as never);
      assert.ok(error, `M7-11 anon no puede ejecutar ${fn}`);
    }
    const { data, error } = await anon.from("mensualidad_auditoria").select("*").limit(1);
    assert.ok(error || (data ?? []).length === 0, "M7-11 anon no lee la auditoría");
  }
  console.log("M7-11 anon sin acceso a nada administrativo OK");

  await limpiar();
  billeteras.length = 0;
  const despues = await contarTodo();
  console.log(`contadores después ${JSON.stringify(despues)}`);
  assert.equal(despues.mensualidades, 0, "no quedó ninguna billetera de prueba");
  assert.equal(despues.reservas, antes.reservas, "no quedó ninguna reserva de prueba");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M7 OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("titular_email", EMAIL);
    console.log(`limpieza: ${count ?? 0} billeteras con la marca (debe ser 0)`);
  });

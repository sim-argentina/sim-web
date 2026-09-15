import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  nuevaExternalReference, nuevoTokenPublico, estadoPublicoCheckout,
  crearCheckoutYPreferencia, cupoOcupados, validarInscripcionPublica,
  montoDelCampeonato, TTL_CHECKOUT_MIN, TTL_PENDIENTES_MIN, GRACIA_CUPO_MIN,
} from "@/lib/campeonatosCheckout";
import { procesarPagoVerificado, PREFIJO_EXT_REF_LEGACY, type PagoMp } from "@/lib/campeonatosPago";
import { mensajeConfirmacion } from "@/lib/campeonatosMensajes";

// Integración del checkout de campeonatos contra la DB REAL, con campeonatos
// TEMPORALES que se ELIMINAN al final. NUNCA se hace un pago real: los pagos de
// Mercado Pago se inyectan como objetos en procesarPagoVerificado (la MISMA
// función que usa el webhook después de traer el pago con credenciales del
// servidor) y la creación de preferencia se ejercita con el access token apagado.
// No se toca ningún campeonato ni inscripción de producción.
//
// Ejecutar:
//   npx tsx --env-file=.env.local lib/campeonatosCheckout.integration.ts

const MARCA = `zzchk_${Date.now()}`;
const creados = { campeonatos: [] as string[] };

const CONFIG_ELIMINACION = {
  hora: "10:20",
  presentacion: { hora_inicio: "10:20", hora_limite: "10:40" },
  requiere_escuderia: false,
  inscripcion: {
    campos: {
      nombre: "required", apellido: "required", telefono: "required",
      dni: "hidden", instagram: "hidden", escuderia: "hidden",
      categoria: "hidden", mejor_tiempo: "hidden", monto: "hidden",
    },
  },
};

async function crearCampeonato(opts: {
  modalidad: "liga" | "eliminacion";
  precio: number;
  cupos: number;
  permiteStand: boolean;
}) {
  const { data, error } = await supabaseAdmin
    .from("campeonatos")
    .insert({
      nombre: `${MARCA} ${opts.modalidad}`,
      estado: "activo",
      modalidad: opts.modalidad,
      permite_pago_stand: opts.permiteStand,
      precio_inscripcion: opts.precio,
      cupos_maximos: opts.cupos,
      inscripcion_habilitada: true,
      fecha_inicio: "2026-09-19",
      fecha_fin: "2026-09-19",
      config: opts.modalidad === "eliminacion" ? CONFIG_ELIMINACION : {},
    })
    .select("id, nombre, modalidad, permite_pago_stand, precio_inscripcion, cupos_maximos, fecha_inicio, config, inscripcion_habilitada")
    .single();
  if (error || !data) throw new Error(`crearCampeonato: ${error?.message}`);
  creados.campeonatos.push(data.id);
  return data;
}

type Intento = { resultado: string; external_reference?: string; token_publico?: string; checkout_id?: string };

// Alta del intento por la MISMA vía transaccional que usa el endpoint público.
async function crearIntento(
  campeonatoId: string,
  datos: { nombre: string; apellido: string; telefono?: string; dni?: string; escuderia?: string | null },
  monto: number,
  idem?: string,
): Promise<Intento> {
  const { data, error } = await supabaseAdmin.rpc("campeonato_checkout_crear", {
    p_campeonato_id: campeonatoId,
    p_nombre: datos.nombre,
    p_apellido: datos.apellido,
    p_telefono: datos.telefono ?? "",
    p_dni: datos.dni ?? "",
    p_instagram: null,
    p_escuderia: datos.escuderia ?? null,
    p_monto: monto,
    p_external_reference: nuevaExternalReference(),
    p_token_publico: nuevoTokenPublico(),
    p_idempotency_key: idem ?? null,
    p_ttl_min: TTL_CHECKOUT_MIN,
    p_ttl_pendientes_min: TTL_PENDIENTES_MIN,
    p_gracia_min: GRACIA_CUPO_MIN,
  });
  if (error) throw new Error(`crearIntento: ${error.message}`);
  return data as Intento;
}

// Pago de Mercado Pago sintético, con la forma real de la API.
function pagoMp(over: Partial<PagoMp> & { external_reference: string; transaction_amount: number }): PagoMp {
  return {
    status: "approved",
    status_detail: "accredited",
    currency_id: "ARS",
    metadata: { producto: "campeonato" },
    ...over,
  };
}

async function inscripcionesDe(campeonatoId: string) {
  const { data } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("id, nombre, apellido, nombre_completo, telefono, dni, escuderia_favorita, monto, estado_pago, metodo_pago, payment_id, preference_id, categoria")
    .eq("campeonato_id", campeonatoId);
  return data ?? [];
}

async function leerCheckout(extRef: string) {
  const { data } = await supabaseAdmin
    .from("campeonato_checkouts")
    .select("id, estado, mp_status, payment_id, inscripcion_id, procesado_at, expira_el, monto, preference_id")
    .eq("external_reference", extRef)
    .single();
  return data as {
    id: string; estado: string; mp_status: string | null; payment_id: string | null;
    inscripcion_id: string | null; procesado_at: string | null; expira_el: string;
    monto: number | string; preference_id: string | null;
  };
}

let pagoSeq = 0;
const nuevoPagoId = () => `zzpay_${Date.now()}_${pagoSeq++}`;

async function limpiar() {
  for (const id of creados.campeonatos) {
    await supabaseAdmin.from("campeonato_checkouts").delete().eq("campeonato_id", id);
    await supabaseAdmin.from("campeonato_inscripciones").delete().eq("campeonato_id", id);
    await supabaseAdmin.from("campeonatos").delete().eq("id", id);
  }
}

async function main() {
  const duelo = await crearCampeonato({ modalidad: "eliminacion", precio: 20000, cupos: 10, permiteStand: false });
  const liga = await crearCampeonato({ modalidad: "liga", precio: 40000, cupos: 0, permiteStand: true });

  // ── CASO A · Abandono: tocar "Inscribirme" NO crea inscripción ─────────────
  const a = await crearIntento(duelo.id, { nombre: "Zz", apellido: "Abandona", telefono: "3515000001" }, 20000);
  assert.equal(a.resultado, "creado");
  assert.equal((await inscripcionesDe(duelo.id)).length, 0, "CASO A: 0 filas nuevas en campeonato_inscripciones");
  const chkA = await leerCheckout(a.external_reference!);
  assert.equal(chkA.estado, "pendiente");
  assert.equal(chkA.inscripcion_id, null);
  // El intento SÍ reserva cupo mientras está vigente.
  assert.equal(await cupoOcupados(duelo.id), 1, "CASO A: el intento vigente ocupa cupo");
  // Y la persona ve "confirmando/pendiente", nunca "inscripta".
  assert.equal(estadoPublicoCheckout(chkA), "pendiente");
  console.log("CASO A (abandono) OK");

  // Doble clic con la misma idempotency key: un solo intento, un solo cupo.
  const k = `zzidem${Date.now()}`;
  const d1 = await crearIntento(duelo.id, { nombre: "Zz", apellido: "DobleClick", telefono: "3515000009" }, 20000, k);
  const d2 = await crearIntento(duelo.id, { nombre: "Zz", apellido: "DobleClick", telefono: "3515000009" }, 20000, k);
  assert.equal(d1.resultado, "creado");
  assert.equal(d2.resultado, "reintento");
  assert.equal(d1.external_reference, d2.external_reference);
  assert.equal(await cupoOcupados(duelo.id), 2, "doble clic no consume dos cupos");
  console.log("doble clic idempotente OK");

  // ── CASO E · El navegador vuelve ANTES que el webhook ──────────────────────
  // Estado mientras tanto: pendiente ("Confirmando tu pago..."), sin inscripción.
  assert.equal(estadoPublicoCheckout(await leerCheckout(a.external_reference!)), "pendiente");
  assert.equal((await inscripcionesDe(duelo.id)).length, 0);

  // ── CASO B · Pago APROBADO: recién acá nace la inscripción ─────────────────
  const payA = nuevoPagoId();
  const rB = await procesarPagoVerificado(payA, pagoMp({ external_reference: a.external_reference!, transaction_amount: 20000 }));
  assert.equal(rB.ok, true);
  assert.equal((rB as { estado: string }).estado, "creado");

  const insB = await inscripcionesDe(duelo.id);
  assert.equal(insB.length, 1, "CASO B: exactamente 1 inscripción");
  assert.equal(insB[0].estado_pago, "pagado");
  assert.equal(Number(insB[0].monto), 20000);
  assert.equal(insB[0].metodo_pago, "mercadopago");
  assert.equal(insB[0].nombre, "Zz");
  assert.equal(insB[0].apellido, "Abandona");
  assert.equal(insB[0].nombre_completo, "Zz Abandona");
  assert.equal(insB[0].telefono, "3515000001");
  assert.equal(insB[0].dni, "", "campo oculto por config: no se inventa un DNI");
  assert.equal(insB[0].payment_id, payA);
  assert.equal(insB[0].categoria, null);

  const chkB = await leerCheckout(a.external_reference!);
  assert.equal(chkB.estado, "aprobado");
  assert.equal(chkB.inscripcion_id, insB[0].id);
  assert.ok(chkB.procesado_at, "el intento queda marcado como procesado");
  assert.equal(estadoPublicoCheckout(chkB), "confirmado");
  // Y el mensaje que ve es el de SU campeonato, derivado de fecha + hora.
  assert.equal(
    mensajeConfirmacion(duelo, 2026),
    "¡Listo! Te esperamos el 19 de septiembre a las 10:20 hs en SIM Argentina para correr el campeonato.",
  );
  console.log("CASO B (aprobado) OK · CASO E (redirect antes del webhook) OK");

  // ── CASO C · El MISMO webhook dos veces ───────────────────────────────────
  const rC = await procesarPagoVerificado(payA, pagoMp({ external_reference: a.external_reference!, transaction_amount: 20000 }));
  assert.equal((rC as { estado: string }).estado, "ya_aprobado");
  assert.equal((await inscripcionesDe(duelo.id)).length, 1, "CASO C: sigue habiendo 1 sola inscripción");
  // Tres veces tampoco.
  await procesarPagoVerificado(payA, pagoMp({ external_reference: a.external_reference!, transaction_amount: 20000 }));
  assert.equal((await inscripcionesDe(duelo.id)).length, 1);
  console.log("CASO C (webhook duplicado) OK");

  // ── CASO D · Pago RECHAZADO / CANCELADO ───────────────────────────────────
  const dRech = await crearIntento(duelo.id, { nombre: "Zz", apellido: "Rechazado", telefono: "3515000002" }, 20000);
  const rD = await procesarPagoVerificado(
    nuevoPagoId(),
    pagoMp({ external_reference: dRech.external_reference!, transaction_amount: 20000, status: "rejected", status_detail: "cc_rejected_other_reason" }),
  );
  assert.equal((rD as { estado: string }).estado, "registrado");
  assert.equal((await inscripcionesDe(duelo.id)).length, 1, "CASO D: 0 inscripciones definitivas nuevas");
  const chkD = await leerCheckout(dRech.external_reference!);
  assert.equal(chkD.mp_status, "rejected");
  assert.equal(chkD.inscripcion_id, null);
  assert.equal(estadoPublicoCheckout(chkD), "rechazado");
  console.log("CASO D (rechazado) OK");

  // Pago PENDING: tampoco confirma nada.
  const dPend = await crearIntento(duelo.id, { nombre: "Zz", apellido: "Pendiente", telefono: "3515000003" }, 20000);
  await procesarPagoVerificado(
    nuevoPagoId(),
    pagoMp({ external_reference: dPend.external_reference!, transaction_amount: 20000, status: "pending", status_detail: "pending_waiting_transfer" }),
  );
  const chkP = await leerCheckout(dPend.external_reference!);
  assert.equal(chkP.estado, "pendiente");
  assert.equal(chkP.inscripcion_id, null);
  assert.equal(estadoPublicoCheckout(chkP), "pendiente", "pending NO es 'confirmado'");
  assert.equal((await inscripcionesDe(duelo.id)).length, 1);
  // Si ese mismo pago después se aprueba, sí se acredita.
  const payPend = nuevoPagoId();
  const rPendOk = await procesarPagoVerificado(payPend, pagoMp({ external_reference: dPend.external_reference!, transaction_amount: 20000 }));
  assert.equal((rPendOk as { estado: string }).estado, "creado");
  assert.equal((await inscripcionesDe(duelo.id)).length, 2);
  console.log("CASO pending → aprobado OK");

  // ── CASO G · Precio manipulado ────────────────────────────────────────────
  const g = await crearIntento(duelo.id, { nombre: "Zz", apellido: "Precio", telefono: "3515000004" }, 20000);
  const antesG = (await inscripcionesDe(duelo.id)).length;
  const rG1 = await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: g.external_reference!, transaction_amount: 1 }));
  assert.equal(rG1.ok, false);
  assert.equal((rG1 as { motivo: string }).motivo, "importe_no_coincide");
  const rG2 = await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: g.external_reference!, transaction_amount: 20000, currency_id: "USD" }));
  assert.equal((rG2 as { motivo: string }).motivo, "moneda_invalida");
  // Metadata de otro producto tampoco pasa.
  const rG3 = await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: g.external_reference!, transaction_amount: 20000, metadata: { producto: "mensualidad" } }));
  assert.equal((rG3 as { motivo: string }).motivo, "metadata_producto_invalida");
  assert.equal((await inscripcionesDe(duelo.id)).length, antesG, "CASO G: ningún pago manipulado crea inscripción");
  // El monto guardado es el del SERVIDOR, no el del navegador.
  assert.equal(Number((await leerCheckout(g.external_reference!)).monto), 20000);
  assert.equal(montoDelCampeonato(duelo), 20000);
  console.log("CASO G (precio) OK");

  // ── CASO F · Último cupo con dos personas a la vez ────────────────────────
  const uno = await crearCampeonato({ modalidad: "eliminacion", precio: 20000, cupos: 1, permiteStand: false });
  const [c1, c2] = await Promise.all([
    crearIntento(uno.id, { nombre: "Zz", apellido: "Carrera1", telefono: "3515000005" }, 20000),
    crearIntento(uno.id, { nombre: "Zz", apellido: "Carrera2", telefono: "3515000006" }, 20000),
  ]);
  const resultados = [c1.resultado, c2.resultado].sort();
  assert.deepEqual(resultados, ["creado", "sin_cupo"], "CASO F: solo uno se queda con el último cupo");

  const ganador = c1.resultado === "creado" ? c1 : c2;
  await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: ganador.external_reference!, transaction_amount: 20000 }));
  assert.equal((await inscripcionesDe(uno.id)).length, 1);
  // Con el cupo lleno no se puede iniciar otro checkout.
  assert.equal((await crearIntento(uno.id, { nombre: "Zz", apellido: "Tarde", telefono: "3515000007" }, 20000)).resultado, "sin_cupo");
  console.log("CASO F (concurrencia último cupo) OK");

  // Pago hecho DESPUÉS de cerrada la ventana y con la retención ya caída, sobre
  // un cupo que mientras tanto se vendió: no se crea una inscripción de más.
  const dos = await crearCampeonato({ modalidad: "eliminacion", precio: 20000, cupos: 1, permiteStand: false });
  const tarde = await crearIntento(dos.id, { nombre: "Zz", apellido: "Vencido", telefono: "3515000008" }, 20000);
  await supabaseAdmin.from("campeonato_checkouts")
    .update({ expira_el: new Date(Date.now() - (GRACIA_CUPO_MIN + 1) * 60_000).toISOString() })
    .eq("external_reference", tarde.external_reference!);
  // Mientras tanto, otro completa el único cupo.
  const aTiempo = await crearIntento(dos.id, { nombre: "Zz", apellido: "ATiempo", telefono: "3515000010" }, 20000);
  assert.equal(aTiempo.resultado, "creado");
  await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: aTiempo.external_reference!, transaction_amount: 20000 }));
  // date_approved POSTERIOR al vencimiento: el pago es genuinamente tardío.
  const rTarde = await procesarPagoVerificado(nuevoPagoId(), pagoMp({
    external_reference: tarde.external_reference!, transaction_amount: 20000,
    date_approved: new Date().toISOString(),
  }));
  assert.equal((rTarde as { estado: string }).estado, "sin_cupo");
  assert.equal((await inscripcionesDe(dos.id)).length, 1, "nunca se supera cupos_maximos");
  assert.equal(estadoPublicoCheckout(await leerCheckout(tarde.external_reference!)), "sin_cupo");
  console.log("CASO F bis (pago tardío sin cupo) OK");

  // ── CASO K · pago minuto 19 / webhook minuto 21 ───────────────────────────
  // El lugar sigue RETENIDO durante la gracia: B no puede quedárselo mientras
  // esperamos el aviso de A, así que A se confirma y el total es exactamente 1.
  const tres = await crearCampeonato({ modalidad: "eliminacion", precio: 20000, cupos: 1, permiteStand: false });
  const A = await crearIntento(tres.id, { nombre: "Zz", apellido: "PagoEnVentana", telefono: "3515000015" }, 20000);
  assert.equal(A.resultado, "creado");

  // Reloj simulado: la ventana de pago cerró hace 1 minuto (T+21) —seguimos
  // dentro de la gracia— y Mercado Pago aprobó 2 minutos antes del cierre (T+19).
  const expiroT20 = new Date(Date.now() - 60_000);
  const aprobadoT19 = new Date(expiroT20.getTime() - 2 * 60_000);
  await supabaseAdmin.from("campeonato_checkouts")
    .update({ expira_el: expiroT20.toISOString() })
    .eq("external_reference", A.external_reference!);

  // T+21: el cupo sigue retenido por A → B recibe SIN CUPO.
  assert.equal(await cupoOcupados(tres.id), 1, "la retención sigue ocupando el lugar");
  const B = await crearIntento(tres.id, { nombre: "Zz", apellido: "Bloqueado", telefono: "3515000016" }, 20000);
  assert.equal(B.resultado, "sin_cupo", "CASO K: B no puede tomar el cupo retenido");

  // T+22: llega el webhook de A.
  const rA = await procesarPagoVerificado(nuevoPagoId(), pagoMp({
    external_reference: A.external_reference!, transaction_amount: 20000,
    date_approved: aprobadoT19.toISOString(),
  }));
  assert.equal((rA as { estado: string }).estado, "creado", "CASO K: A se confirma");
  const insA = await inscripcionesDe(tres.id);
  assert.equal(insA.length, 1, "CASO K: exactamente cupos_maximos, nunca +1");
  assert.equal(insA[0].apellido, "PagoEnVentana");
  assert.equal(insA[0].estado_pago, "pagado");
  const chkPagoA = await leerCheckout(A.external_reference!);
  assert.equal(estadoPublicoCheckout(chkPagoA), "confirmado");
  // Idempotencia intacta por este camino.
  const rARepetido = await procesarPagoVerificado(String(chkPagoA.payment_id), pagoMp({
    external_reference: A.external_reference!, transaction_amount: 20000,
    date_approved: aprobadoT19.toISOString(),
  }));
  assert.equal((rARepetido as { estado: string }).estado, "ya_aprobado");
  assert.equal((await inscripcionesDe(tres.id)).length, 1);
  console.log("CASO K (pago T+19 / webhook T+21) OK");

  // ── CASO L · abandono: el cupo se libera recién DESPUÉS de la gracia ───────
  const cuatro = await crearCampeonato({ modalidad: "eliminacion", precio: 20000, cupos: 1, permiteStand: false });
  const abandona = await crearIntento(cuatro.id, { nombre: "Zz", apellido: "Abandona2", telefono: "3515000018" }, 20000);
  assert.equal(abandona.resultado, "creado");

  // Dentro de la gracia (ventana de pago vencida, retención viva): nadie entra.
  await supabaseAdmin.from("campeonato_checkouts")
    .update({ expira_el: expiroT20.toISOString() })
    .eq("external_reference", abandona.external_reference!);
  assert.equal(await cupoOcupados(cuatro.id), 1);
  assert.equal(
    (await crearIntento(cuatro.id, { nombre: "Zz", apellido: "Espera", telefono: "3515000019" }, 20000)).resultado,
    "sin_cupo", "CASO L: durante la gracia el lugar sigue reservado",
  );

  // Pasada la gracia y sin pago: el lugar se libera solo, por fecha.
  await supabaseAdmin.from("campeonato_checkouts")
    .update({ expira_el: new Date(Date.now() - (GRACIA_CUPO_MIN + 1) * 60_000).toISOString() })
    .eq("external_reference", abandona.external_reference!);
  assert.equal(await cupoOcupados(cuatro.id), 0, "CASO L: pasada la gracia el cupo queda libre");
  const entraDespues = await crearIntento(cuatro.id, { nombre: "Zz", apellido: "Entra", telefono: "3515000020" }, 20000);
  assert.equal(entraDespues.resultado, "creado", "CASO L: ahora sí se puede tomar");
  assert.equal((await inscripcionesDe(cuatro.id)).length, 0, "CASO L: el abandono no dejó inscripción");
  assert.equal(estadoPublicoCheckout(await leerCheckout(abandona.external_reference!)), "expirado");
  console.log("CASO L (abandono y liberación tras la gracia) OK");

  // ── CASO M · aviso DESPUÉS de la gracia y lugar ya vendido ────────────────
  // El pago fue en tiempo, pero la retención cayó y otro pagó ese cupo. NO se
  // crea la inscripción de más: queda 'sin_cupo' con su payment_id, trazable.
  const cinco = await crearCampeonato({ modalidad: "eliminacion", precio: 20000, cupos: 1, permiteStand: false });
  const tardio = await crearIntento(cinco.id, { nombre: "Zz", apellido: "AvisoTardio", telefono: "3515000021" }, 20000);
  const expiroViejo = new Date(Date.now() - (GRACIA_CUPO_MIN + 10) * 60_000);
  await supabaseAdmin.from("campeonato_checkouts")
    .update({ expira_el: expiroViejo.toISOString() })
    .eq("external_reference", tardio.external_reference!);

  // Otro toma el único cupo y lo paga.
  const compro = await crearIntento(cinco.id, { nombre: "Zz", apellido: "Compro", telefono: "3515000022" }, 20000);
  assert.equal(compro.resultado, "creado");
  await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: compro.external_reference!, transaction_amount: 20000 }));

  const pagoTardioId = nuevoPagoId();
  const rTardio = await procesarPagoVerificado(pagoTardioId, pagoMp({
    external_reference: tardio.external_reference!, transaction_amount: 20000,
    // Pagó a tiempo: 1 minuto antes de que cerrara su ventana.
    date_approved: new Date(expiroViejo.getTime() - 60_000).toISOString(),
  }));
  assert.equal((rTardio as { estado: string }).estado, "sin_cupo");
  assert.equal((await inscripcionesDe(cinco.id)).length, 1, "CASO M: nunca la inscripción cupos_maximos + 1");
  const chkTardio = await leerCheckout(tardio.external_reference!);
  assert.equal(chkTardio.estado, "sin_cupo");
  assert.equal(chkTardio.payment_id, pagoTardioId, "CASO M: queda trazable con su payment_id");
  assert.equal(chkTardio.mp_status, "approved");
  assert.ok(chkTardio.procesado_at);
  assert.equal(chkTardio.inscripcion_id, null);
  assert.equal(estadoPublicoCheckout(chkTardio), "sin_cupo");
  console.log("CASO M (aviso fuera de gracia, cupo vendido) OK");

  // El monto se sigue validando con la misma dureza por el camino tardío.
  const seis = await crearCampeonato({ modalidad: "eliminacion", precio: 20000, cupos: 1, permiteStand: false });
  const montoMal = await crearIntento(seis.id, { nombre: "Zz", apellido: "MontoMal", telefono: "3515000017" }, 20000);
  await supabaseAdmin.from("campeonato_checkouts")
    .update({ expira_el: expiroT20.toISOString() })
    .eq("external_reference", montoMal.external_reference!);
  const rMontoMal = await procesarPagoVerificado(nuevoPagoId(), pagoMp({
    external_reference: montoMal.external_reference!, transaction_amount: 1,
    date_approved: aprobadoT19.toISOString(),
  }));
  assert.equal(rMontoMal.ok, false);
  assert.equal((rMontoMal as { motivo: string }).motivo, "importe_no_coincide");
  assert.equal((await inscripcionesDe(seis.id)).length, 0);

  // ── INVARIANTE DURO: confirmadas <= cupos_maximos en TODOS los campeonatos ─
  for (const id of creados.campeonatos) {
    const { data: camp } = await supabaseAdmin
      .from("campeonatos").select("nombre, cupos_maximos").eq("id", id).single();
    const limite = Number(camp?.cupos_maximos ?? 0);
    if (limite <= 0) continue; // 0 = ilimitado
    const confirmadas = (await inscripcionesDe(id)).filter(
      (i) => i.estado_pago === "pagado",
    ).length;
    assert.ok(
      confirmadas <= limite,
      `INVARIANTE roto en ${camp?.nombre}: ${confirmadas} confirmadas con cupos_maximos ${limite}`,
    );
  }
  console.log("invariante confirmadas <= cupos_maximos OK");

  // ── CASO I · Liga: formulario configurable y datos completos ──────────────
  // Liga exige DNI; la escudería es VISIBLE pero OPCIONAL.
  assert.equal(validarInscripcionPublica({ nombre: "Zz", apellido: "Liga", telefono: "3515000011", acepto_condiciones: true }, liga).ok, false);
  const okLiga = validarInscripcionPublica(
    { nombre: "Zz", apellido: "Liga", telefono: "3515000011", dni: "30111222", escuderia_favorita: "Ferrari", acepto_condiciones: true },
    liga,
  );
  assert.ok(okLiga.ok);

  // Liga + escuderia optional + SIN escudería → checkout e inscripción válidos.
  const sinEsc = validarInscripcionPublica(
    { nombre: "Zz", apellido: "SinEscuderia", telefono: "3515000014", dni: "30111444", acepto_condiciones: true },
    liga,
  );
  assert.ok(sinEsc.ok, "liga sin escudería tiene que validar");
  assert.equal(sinEsc.data.campos.escuderia, "optional");
  const iSinEsc = await crearIntento(
    liga.id, { nombre: "Zz", apellido: "SinEscuderia", telefono: "3515000014", dni: "30111444", escuderia: null }, 40000,
  );
  assert.equal(iSinEsc.resultado, "creado");
  await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: iSinEsc.external_reference!, transaction_amount: 40000 }));
  const insSinEsc = (await inscripcionesDe(liga.id)).find((i) => i.apellido === "SinEscuderia");
  assert.ok(insSinEsc, "la inscripción de liga sin escudería existe");
  assert.equal(insSinEsc!.estado_pago, "pagado");
  assert.equal(insSinEsc!.escuderia_favorita, null);
  assert.equal(insSinEsc!.dni, "30111444", "el DNI sigue exigido y guardado");
  console.log("CASO I bis (liga sin escudería) OK");
  const iLiga = await crearIntento(
    liga.id,
    { nombre: "Zz", apellido: "Liga", telefono: "3515000011", dni: "30111222", escuderia: "Ferrari" },
    40000,
  );
  assert.equal(iLiga.resultado, "creado", "cupos_maximos 0 = ilimitado");
  await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: iLiga.external_reference!, transaction_amount: 40000 }));
  const insLiga = (await inscripcionesDe(liga.id)).filter((i) => i.apellido === "Liga");
  assert.equal(insLiga.length, 1);
  assert.equal(insLiga[0].dni, "30111222");
  assert.equal(insLiga[0].escuderia_favorita, "Ferrari");
  assert.equal(Number(insLiga[0].monto), 40000);
  assert.ok(mensajeConfirmacion(liga, 2026).includes("tanda clasificatoria"), "la liga conserva su instrucción");
  console.log("CASO I (liga) OK");

  // ── Compatibilidad: preferencias VIEJAS siguen acreditando ────────────────
  const { data: legacy } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .insert({
      campeonato_id: liga.id, nombre: "Zz", apellido: "Legacy", nombre_completo: "Zz Legacy",
      telefono: "3515000012", dni: "30111333", monto: 40000,
      estado_pago: "pendiente_pago_online", metodo_pago: "mercadopago",
    })
    .select("id").single();
  const rLegacy = await procesarPagoVerificado(
    nuevoPagoId(),
    pagoMp({ external_reference: `${PREFIJO_EXT_REF_LEGACY}${legacy!.id}`, transaction_amount: 40000 }),
  );
  assert.equal((rLegacy as { estado: string }).estado, "creado");
  const insLegacy = (await inscripcionesDe(liga.id)).find((i) => i.id === legacy!.id);
  assert.equal(insLegacy?.estado_pago, "pagado");
  assert.equal((await inscripcionesDe(liga.id)).length, 3, "el flujo viejo NO duplica filas");
  console.log("compatibilidad flujo viejo OK");

  // Pago de otro producto: se ignora sin tocar nada.
  const rOtro = await procesarPagoVerificado(nuevoPagoId(), pagoMp({ external_reference: "mensualidad_xxx", transaction_amount: 1 }));
  assert.equal((rOtro as { estado: string }).estado, "ignorado");

  // ── Sin Mercado Pago disponible: falla limpio y sin inscripción ───────────
  const tokenMp = process.env.MERCADOPAGO_ACCESS_TOKEN;
  delete process.env.MERCADOPAGO_ACCESS_TOKEN;
  const sinMp = await crearCheckoutYPreferencia(
    duelo,
    { nombre: "Zz", apellido: "SinMp", telefono: "3515000013", dni: "", instagram: null, escuderia_favorita: null, metodoStand: false, idempotencyKey: `zzmp${Date.now()}` },
    20000,
    "https://simexperience.com.ar",
  );
  if (tokenMp) process.env.MERCADOPAGO_ACCESS_TOKEN = tokenMp;
  assert.equal(sinMp.ok, false);
  assert.equal((sinMp as { status: number }).status, 503);
  assert.equal((await inscripcionesDe(duelo.id)).length, 2, "un fallo de MP no crea inscripciones");
  console.log("fallo de Mercado Pago sin efectos OK");

  // ── Bracket: solo inscripciones pagadas; los intentos no existen para él ──
  const { data: elegibles } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("id").eq("campeonato_id", duelo.id).eq("estado_pago", "pagado").is("eliminada_at", null);
  assert.equal((elegibles ?? []).length, 2, "solo las pagadas son elegibles para el Bracket");
  const { data: pendientesEnInscripciones } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("id").eq("campeonato_id", duelo.id).in("estado_pago", ["pendiente_pago", "pendiente_pago_online", "pendiente_pago_stand"]);
  assert.equal((pendientesEnInscripciones ?? []).length, 0, "el flujo público ya no genera pendientes");
  console.log("elegibilidad de Bracket OK");
}

main()
  .then(async () => {
    await limpiar();
    console.log("\ncampeonatosCheckout.integration.ts OK · datos temporales eliminados");
  })
  .catch(async (e) => {
    await limpiar();
    console.error("\nFALLÓ:", e);
    process.exit(1);
  });

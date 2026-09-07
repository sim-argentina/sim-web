import { createHash, randomBytes } from "crypto";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hayDisponibilidadPara } from "@/lib/disponibilidad";
import { getPrecioEspecial, resolverPrecioReserva } from "@/lib/reservasPricing";
import { esFinDeSemana } from "@/lib/agenda";
import { CONDICIONES_RESERVA_VERSION } from "@/lib/mensualidadesCondiciones";
import { PREFIJO_EXT_REF_RESERVA } from "@/lib/mensualidadesPago";
import type { SeleccionReserva } from "@/lib/mensualidadesReserva";

// Reserva MIXTA: parte con saldo, parte pagada con Mercado Pago (Bloque M5B).
// SOLO SERVIDOR.
//
// La regla de negocio cerrada: si el saldo es mayor que 0 pero no alcanza, se
// usa TODO el saldo y se cobra únicamente el faltante, a precios normales
// vigentes de la fecha. Saldo 0 no entra por acá (hay que renovar o hacer una
// reserva normal) y saldo suficiente tampoco (eso es M5A).
//
// El faltante se cobra armándolo con bloques de 30 primero y a lo sumo un
// bloque de 15, porque 45 = 30 + 15 y 60 = 30 + 30: no hay tarifas nuevas.

/** Cuánto vive una retención. Igual que el TTL de una reserva normal pendiente
 *  de pago, para que las dos formas de "estoy pagando" duren lo mismo. */
export const RETENCION_MINUTOS = 15;

// Se define en lib/mensualidadesPago.ts (junto al de las compras) para que aquel
// módulo pueda excluirlo sin depender de éste. Acá se re-exporta por comodidad.
export { PREFIJO_EXT_REF_RESERVA };

export type OrigenPrecio = "normal_semana" | "normal_finde" | "especial";

export type Desglose = {
  minutos_requeridos: number;
  minutos_saldo: number;
  minutos_faltantes: number;
  bloques_30: number;
  bloques_15: number;
  precio_15: number;
  precio_30: number;
  origen_precio: OrigenPrecio;
  importe: number;
};

/**
 * Descomposición PURA del faltante. Se exporta sola para poder testear los
 * ejemplos obligatorios sin base ni red.
 *
 * Prioriza bloques de 30 y deja a lo sumo uno de 15, que es lo más barato para
 * el cliente siempre que precio_30 <= 2 x precio_15 (que es el caso: 18000 y
 * 20000 contra 24000).
 */
export function descomponerFaltante(minutosFaltantes: number): { bloques_30: number; bloques_15: number } {
  return {
    bloques_30: Math.floor(minutosFaltantes / 30),
    bloques_15: (minutosFaltantes % 30) / 15,
  };
}

/** Desglose completo a partir de precios ya resueltos. Puro. */
export function calcularDesglose(args: {
  duracion: number;
  cantidadSimuladores: number;
  saldoMinutos: number;
  precio15: number;
  precio30: number;
  origenPrecio: OrigenPrecio;
}): Desglose | { error: "saldo_cero" | "saldo_suficiente" } {
  const requeridos = args.duracion * args.cantidadSimuladores;
  if (args.saldoMinutos <= 0) return { error: "saldo_cero" };
  if (args.saldoMinutos >= requeridos) return { error: "saldo_suficiente" };

  const faltantes = requeridos - args.saldoMinutos;
  const { bloques_30, bloques_15 } = descomponerFaltante(faltantes);
  return {
    minutos_requeridos: requeridos,
    minutos_saldo: args.saldoMinutos,
    minutos_faltantes: faltantes,
    bloques_30,
    bloques_15,
    precio_15: args.precio15,
    precio_30: args.precio30,
    origen_precio: args.origenPrecio,
    importe: bloques_30 * args.precio30 + bloques_15 * args.precio15,
  };
}

/**
 * Precios vigentes de la fecha, por la MISMA fuente que Reservas normales:
 * precio especial de la fecha si existe (con override parcial y fallback al
 * normal), si no el normal de semana o de fin de semana.
 */
export async function preciosDeLaFecha(fecha: string): Promise<{
  precio15: number; precio30: number; origenPrecio: OrigenPrecio;
}> {
  const especial = await getPrecioEspecial(fecha);
  const precio15 = resolverPrecioReserva(especial, fecha, 15);
  const precio30 = resolverPrecioReserva(especial, fecha, 30);

  // "especial" solo si el override realmente se aplicó a alguno de los dos.
  const hubo15 = especial?.precio_15 != null;
  const hubo30 = especial?.precio_30 != null;
  const origenPrecio: OrigenPrecio = hubo15 || hubo30
    ? "especial"
    : esFinDeSemana(fecha) ? "normal_finde" : "normal_semana";

  return { precio15, precio30, origenPrecio };
}

// ── Identificadores ─────────────────────────────────────────────────────────

export function nuevaExternalReferenceReserva(): string {
  return `${PREFIJO_EXT_REF_RESERVA}${randomBytes(12).toString("base64url")}`;
}

/** Token que ve el cliente en la URL del resultado. En la base va el hash. */
export function nuevoTokenResultado(): string {
  return randomBytes(24).toString("base64url");
}

export function hashTokenResultado(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const TOKEN_RESULTADO_RE = /^[A-Za-z0-9_-]{24,64}$/;

// ── Resultado ───────────────────────────────────────────────────────────────

export type RetencionCreada = {
  referencia: string;
  init_point: string;
  token_publico: string;
  minutos_requeridos: number;
  minutos_saldo: number;
  minutos_faltantes: number;
  bloques_30: number;
  bloques_15: number;
  precio_15: number;
  precio_30: number;
  importe: number;
  retencion_vence_at: string;
  idempotente: boolean;
};

export type ResultadoMixta =
  | { ok: true; data: RetencionCreada }
  | { ok: false; status: number; codigo: string; error: string };

const fail = (status: number, codigo: string, error: string): ResultadoMixta =>
  ({ ok: false, status, codigo, error });

// Errores de la RPC → mensaje público. Nunca se filtra SQL ni saldo interno.
const MAPA: Record<string, { status: number; error: string }> = {
  retencion_en_curso: {
    status: 409,
    error: "Ya tenés una reserva esperando el pago. Terminá ese pago o esperá a que venza para empezar otra.",
  },
  saldo_cero: {
    status: 422,
    error: "No te quedan minutos. Renová tu mensualidad o hacé una reserva normal.",
  },
  saldo_suficiente: {
    status: 409,
    error: "Te alcanza el saldo para esa reserva: confirmala sin pagar nada.",
  },
  mensualidad_bloqueada: { status: 422, error: "Tu mensualidad necesita revisión. Escribinos y lo resolvemos." },
  mensualidad_vencida: { status: 422, error: "Tu mensualidad está vencida." },
  turno_posterior_al_vencimiento: {
    status: 422,
    error: "Ese turno cae después del vencimiento de tu mensualidad. Elegí una fecha anterior.",
  },
  fecha_fuera_de_ventana: {
    status: 422,
    error: "Solo se puede reservar desde mañana y hasta 15 días de anticipación.",
  },
  simuladores_duplicados: { status: 422, error: "No se puede repetir una escudería." },
  simulador_desconocido: { status: 422, error: "Elegí escuderías de la lista." },
  cantidad_simuladores_invalida: { status: 422, error: "Elegí entre 1 y 4 escuderías." },
  duracion_invalida: { status: 422, error: "Elegí una duración de 15, 30, 45 o 60 minutos." },
  condiciones_requeridas: { status: 422, error: "Tenés que aceptar las condiciones para reservar." },
  idempotency_key_con_otro_payload: {
    status: 409,
    error: "Esa solicitud ya se usó para otra reserva. Volvé a intentar desde el principio.",
  },
  idempotency_key_invalida: { status: 400, error: "Solicitud inválida." },
  bloques_incoherentes: { status: 400, error: "Solicitud inválida." },
  bloques_desordenados: { status: 400, error: "Solicitud inválida." },
  importe_invalido: { status: 400, error: "Solicitud inválida." },
  precio_invalido: { status: 400, error: "Solicitud inválida." },
  mensualidad_inexistente: { status: 404, error: "No encontrado" },
};

function traducir(mensaje: string, code: string): ResultadoMixta {
  for (const clave of Object.keys(MAPA)) {
    if (mensaje.includes(clave)) return fail(MAPA[clave].status, clave, MAPA[clave].error);
  }
  if (code === "23514" || (code === "23505" && mensaje.includes("reserva_slots_activa_uq"))) {
    return fail(409, "turno_ocupado", "Ese turno se ocupó mientras elegías. Elegí otro horario.");
  }
  return fail(500, "error", "No pudimos preparar el pago. Probá de nuevo.");
}

type FilaRpc = {
  pago_id: string;
  reserva_id: number;
  referencia_publica: string;
  minutos_requeridos: number;
  minutos_saldo: number;
  minutos_faltantes: number;
  bloques_30: number;
  bloques_15: number;
  importe_bruto: number;
  retencion_vence_at: string;
  external_reference: string;
  idempotente: boolean;
};

async function saldoDe(mensualidadId: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("mensualidades").select("saldo_minutos").eq("id", mensualidadId).maybeSingle();
  return data ? Number(data.saldo_minutos) || 0 : null;
}

/** Preferencia de Mercado Pago del COMPLEMENTO. Sin PII en ningún lado. */
async function crearPreferencia(args: {
  externalReference: string;
  importe: number;
  tokenPublico: string;
  venceAt: string;
}): Promise<{ init_point: string; preference_id: string } | null> {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!accessToken || !baseUrl || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    return null;
  }
  const client = new MercadoPagoConfig({ accessToken });
  // La vuelta lleva SOLO el token opaco: ni código, ni teléfono, ni ids internos.
  const volver = `${baseUrl}/mensualidades/reserva-resultado?t=${encodeURIComponent(args.tokenPublico)}`;

  const r = await new Preference(client).create({
    body: {
      items: [{
        id: "mensualidad-complemento",
        title: "Complemento reserva Mensualidad SIM",
        quantity: 1,
        unit_price: args.importe,
        currency_id: "ARS",
      }],
      external_reference: args.externalReference,
      // Metadata mínima: identifica el producto y nada más. El vínculo con la
      // reserva se resuelve server-side por external_reference.
      metadata: { producto: "mensualidad_reserva" },
      back_urls: { success: volver, pending: volver, failure: volver },
      auto_return: "approved",
      notification_url: `${baseUrl}/api/mensualidades/webhook`,
      // La preferencia muere junto con la retención: no se puede pagar un turno
      // cuyos slots ya se liberaron.
      expires: true,
      expiration_date_to: args.venceAt,
    },
  });
  const init = r?.init_point ?? r?.sandbox_init_point;
  if (!init || !r?.id) return null;
  return { init_point: String(init), preference_id: String(r.id) };
}

/**
 * Crea la retención atómica y la preferencia. `mensualidadId` viene de la sesión
 * de M4: el navegador nunca lo manda, igual que en M5A.
 */
export async function reservarConSaldoYPago(
  mensualidadId: string,
  seleccion: SeleccionReserva & { bloques: string[] },
): Promise<ResultadoMixta> {
  // 1) Disponibilidad real (M6) antes de tocar nada. La garantía definitiva
  //    contra carreras siguen siendo reserva_slots_activa_uq y el trigger, que
  //    actúan DENTRO de la RPC: no hay ventana entre mirar y bloquear.
  const disp = await hayDisponibilidadPara({
    fecha: seleccion.fecha, hora: seleccion.hora, duracion: seleccion.duracion,
    simuladores: seleccion.simuladores, producto: "mensualidad",
  });
  if (!disp.ok) {
    const status = disp.status === 409 ? 409 : 422;
    return fail(status, status === 409 ? "turno_ocupado" : "seleccion_invalida", disp.error);
  }

  // 2) Precios vigentes de la fecha. Se calculan acá y viajan a la RPC como
  //    SNAPSHOT: un cambio de tarifas posterior no mueve este importe.
  const { precio15, precio30, origenPrecio } = await preciosDeLaFecha(seleccion.fecha);

  // 3) Saldo (informativo: la autoridad es la RPC, que lo relee bajo lock).
  const saldo = await saldoDe(mensualidadId);
  if (saldo === null) return fail(404, "mensualidad_inexistente", "No encontrado");
  const previo = calcularDesglose({
    duracion: seleccion.duracion,
    cantidadSimuladores: seleccion.simuladores.length,
    saldoMinutos: saldo,
    precio15, precio30, origenPrecio,
  });
  if ("error" in previo) {
    const m = MAPA[previo.error];
    return fail(m.status, previo.error, m.error);
  }

  const token = nuevoTokenResultado();
  const extRef = nuevaExternalReferenceReserva();

  // 4) Retención atómica: reserva pendiente + slots + consumo + snapshot.
  const { data, error } = await supabaseAdmin.rpc("crear_retencion_reserva_mensualidad", {
    p_mensualidad_id: mensualidadId,
    p_fecha: seleccion.fecha,
    p_hora: seleccion.hora,
    p_duracion: seleccion.duracion,
    p_simuladores: seleccion.simuladores,
    p_slots: seleccion.bloques,
    p_idempotency_key: seleccion.idempotencyKey,
    p_condiciones_version: CONDICIONES_RESERVA_VERSION,
    p_precio_15: precio15,
    p_precio_30: precio30,
    p_origen_precio: origenPrecio,
    p_external_reference: extRef,
    p_token_hash: hashTokenResultado(token),
    p_retencion_minutos: RETENCION_MINUTOS,
  });
  if (error) return traducir(String(error.message ?? ""), String((error as { code?: string }).code ?? ""));

  const fila = (Array.isArray(data) ? data[0] : data) as FilaRpc | undefined;
  if (!fila) return fail(500, "error", "No pudimos preparar el pago. Probá de nuevo.");

  // 5) Reintento idempotente: la retención ya existía. Se devuelve la MISMA
  //    preferencia guardada, sin crear una segunda en Mercado Pago.
  if (fila.idempotente) {
    const { data: prev } = await supabaseAdmin
      .from("mensualidad_reserva_pagos")
      .select("mp_preference_id, token_hash")
      .eq("id", fila.pago_id).maybeSingle();
    const init = await initPointGuardado(prev?.mp_preference_id ?? null);
    if (!init) {
      return fail(409, "retencion_en_curso",
        "Ya tenés una reserva esperando el pago. Abrila desde Mi mensualidad.");
    }
    return {
      ok: true,
      data: {
        referencia: fila.referencia_publica, init_point: init,
        // El token original no se puede reconstruir (en la base va hasheado):
        // el reintento vuelve por Mi mensualidad, no por la pantalla de resultado.
        token_publico: "",
        minutos_requeridos: fila.minutos_requeridos, minutos_saldo: fila.minutos_saldo,
        minutos_faltantes: fila.minutos_faltantes, bloques_30: fila.bloques_30,
        bloques_15: fila.bloques_15, precio_15: precio15, precio_30: precio30,
        importe: Number(fila.importe_bruto), retencion_vence_at: fila.retencion_vence_at,
        idempotente: true,
      },
    };
  }

  // 6) Preferencia. Si Mercado Pago falla, la retención NO puede quedar viva
  //    ocupando slots y minutos: se libera enseguida.
  let pref: { init_point: string; preference_id: string } | null = null;
  try {
    pref = await crearPreferencia({
      externalReference: fila.external_reference,
      importe: Number(fila.importe_bruto),
      tokenPublico: token,
      venceAt: fila.retencion_vence_at,
    });
  } catch {
    pref = null;
  }
  if (!pref) {
    // Mercado Pago no dio la preferencia: la retención NO puede quedar viva
    // ocupando slots y minutos por un pago que nunca va a empezar. Se vence a
    // mano y se libera por la MISMA vía atómica que usa el barrido, así los
    // minutos vuelven con su movimiento 'devolucion' y los slots se sueltan.
    // Solo se toca si sigue 'pendiente': si en el medio alguien la confirmó, no.
    try {
      await supabaseAdmin
        .from("mensualidad_reserva_pagos")
        .update({ retencion_vence_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", fila.pago_id)
        .eq("estado", "pendiente");
      await supabaseAdmin.rpc("liberar_retencion_reserva_mensualidad", { p_pago_id: fila.pago_id });
    } catch {
      // Si tampoco se pudo liberar, el barrido periódico la va a levantar: está
      // vencida y sin pago aprobado. No se pierde nada.
    }
    return fail(502, "preferencia_fallida", "No pudimos abrir el pago. Probá de nuevo en un momento.");
  }

  await supabaseAdmin.from("mensualidad_reserva_pagos")
    .update({ mp_preference_id: pref.preference_id }).eq("id", fila.pago_id);

  return {
    ok: true,
    data: {
      referencia: fila.referencia_publica,
      init_point: pref.init_point,
      token_publico: token,
      minutos_requeridos: fila.minutos_requeridos,
      minutos_saldo: fila.minutos_saldo,
      minutos_faltantes: fila.minutos_faltantes,
      bloques_30: fila.bloques_30,
      bloques_15: fila.bloques_15,
      precio_15: precio15,
      precio_30: precio30,
      importe: Number(fila.importe_bruto),
      retencion_vence_at: fila.retencion_vence_at,
      idempotente: false,
    },
  };
}

/** Recupera el init_point de una preferencia ya creada. */
async function initPointGuardado(preferenceId: string | null): Promise<string | null> {
  if (!preferenceId) return null;
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return null;
  try {
    const client = new MercadoPagoConfig({ accessToken });
    const r = await new Preference(client).get({ preferenceId });
    const init = r?.init_point ?? r?.sandbox_init_point;
    return init ? String(init) : null;
  } catch {
    return null;
  }
}

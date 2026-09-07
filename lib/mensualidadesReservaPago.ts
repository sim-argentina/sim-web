import MercadoPagoConfig, { Payment } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calcularMontos, type PagoMp } from "@/lib/mensualidadesPago";
import { PREFIJO_EXT_REF_RESERVA } from "@/lib/mensualidadesReservaMixta";

// Procesador ÚNICO del COMPLEMENTO de una reserva mixta (Bloque M5B).
// Lo usan el webhook y la reconciliación de la pantalla de resultado.
//
// Reutiliza de M3 la extracción de bruto/comisión/neto (calcularMontos) y la
// misma disciplina: nada de lo que llega en la notificación se usa como dato;
// el pago se vuelve a consultar a Mercado Pago con las credenciales del
// servidor y se contrasta contra el SNAPSHOT guardado al retener.
//
// OJO con el prefijo: "mensualidad_reserva_" también empieza con
// "mensualidad_", que es el de las COMPRAS de M3. Por eso el webhook tiene que
// probar este prefijo PRIMERO; si no, una compra y un complemento se
// confundirían. La comprobación de acá es la que decide.
//
// NO depende de la feature flag: apagar la venta no puede dejar sin acreditar a
// alguien que ya pagó.

const MONEDA = "ARS";
const EPSILON = 0.01;

export type ResultadoPagoReserva =
  | { ok: true; estado: "confirmado"; pagoId: string; yaEstaba: boolean }
  | { ok: true; estado: "revision"; pagoId: string; motivo: string }
  | { ok: true; estado: "registrado"; pagoId: string; mpStatus: string }
  | { ok: true; estado: "ignorado"; motivo: string }
  | { ok: false; motivo: string; status: number };

const ignorado = (motivo: string): ResultadoPagoReserva => ({ ok: true, estado: "ignorado", motivo });
const falla = (motivo: string, status = 400): ResultadoPagoReserva => ({ ok: false, motivo, status });

function clienteMp(): MercadoPagoConfig | null {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return null;
  return new MercadoPagoConfig({ accessToken });
}

/** ¿Esta external_reference pertenece a un complemento de reserva? */
export function esComplementoDeReserva(extRef: string): boolean {
  return String(extRef || "").startsWith(PREFIJO_EXT_REF_RESERVA);
}

type FilaPago = {
  id: string;
  estado: string;
  importe_bruto: number | string;
  external_reference: string;
  mp_payment_id: string | null;
};

export async function procesarPagoReserva(paymentId: string): Promise<ResultadoPagoReserva> {
  const id = String(paymentId || "").trim();
  if (!id) return falla("payment_id_ausente", 400);

  const client = clienteMp();
  if (!client) return falla("servicio_no_disponible", 500);

  let pago: PagoMp;
  try {
    pago = (await new Payment(client).get({ id })) as PagoMp;
  } catch {
    return falla("pago_no_consultable", 502);
  }
  return procesarPagoReservaVerificado(id, pago);
}

/**
 * Verificación + aplicación sobre un pago YA traído de Mercado Pago. Separada
 * para que los tests ejerciten todas las validaciones sin red, igual que M3.
 */
export async function procesarPagoReservaVerificado(
  id: string,
  pago: PagoMp,
): Promise<ResultadoPagoReserva> {
  // 1) ¿Es nuestro? El prefijo específico separa el complemento de la compra.
  const extRef = String(pago.external_reference || "");
  if (!esComplementoDeReserva(extRef)) return ignorado("otro_producto");

  // 2) El intento tiene que existir.
  const { data, error } = await supabaseAdmin
    .from("mensualidad_reserva_pagos")
    .select("id, estado, importe_bruto, external_reference, mp_payment_id")
    .eq("external_reference", extRef)
    .maybeSingle();
  if (error) return falla("error_leyendo_intento", 500);
  if (!data) return ignorado("intento_inexistente");
  const intento = data as unknown as FilaPago;

  // 3) Metadata: si viene, tiene que ser coherente. Nunca reemplaza lo persistido.
  const meta = (pago.metadata ?? {}) as Record<string, unknown>;
  const metaProducto = meta.producto ?? meta.Producto;
  if (metaProducto && String(metaProducto) !== "mensualidad_reserva") {
    return falla("metadata_producto_invalida", 409);
  }

  // 4) Moneda e importe contra el SNAPSHOT, nunca contra las tarifas de hoy.
  if (String(pago.currency_id || "") !== MONEDA) return falla("moneda_invalida", 409);

  const montos = calcularMontos(pago);
  const esperado = Number(intento.importe_bruto);
  const estadoMp = String(pago.status || "desconocido");
  const detalleMp = pago.status_detail ? String(pago.status_detail) : null;

  if (estadoMp === "approved") {
    if (!Number.isFinite(esperado) || Math.abs(montos.bruto - esperado) > EPSILON) {
      return falla("importe_no_coincide", 409);
    }

    const yaEstaba = intento.estado === "aprobado";
    const { data: fila, error: rpcError } = await supabaseAdmin.rpc(
      "confirmar_reserva_mensualidad_pagada",
      {
        p_external_reference: extRef,
        p_mp_payment_id: id,
        p_importe_bruto: montos.bruto,
        p_comision_mp: montos.comision,
        p_importe_neto: montos.neto,
        p_aprobado_at: pago.date_approved || new Date().toISOString(),
      },
    );
    if (rpcError) {
      const msg = String(rpcError.message ?? "");
      if (msg.includes("payment_id_de_otro_intento")) return falla("payment_id_de_otro_intento", 409);
      if (msg.includes("importe_no_coincide")) return falla("importe_no_coincide", 409);
      return falla("no_se_pudo_confirmar", 500);
    }

    const r = (Array.isArray(fila) ? fila[0] : fila) as { id?: string; estado?: string; revision_motivo?: string } | null;
    await supabaseAdmin
      .from("mensualidad_reserva_pagos")
      .update({ mp_status: estadoMp, mp_status_detail: detalleMp })
      .eq("id", intento.id);

    // Un pago cobrado que no se pudo aplicar NUNCA se devuelve como éxito: se
    // informa como revisión para que quede visible arriba.
    if (r?.estado === "requiere_revision") {
      return { ok: true, estado: "revision", pagoId: intento.id, motivo: String(r.revision_motivo ?? "revision") };
    }
    return { ok: true, estado: "confirmado", pagoId: intento.id, yaEstaba };
  }

  // 5) Rechazado / cancelado / pendiente: se registra el estado real y nada más.
  //    La retención sigue viva hasta que venza: la preferencia se puede volver a
  //    pagar y ese pago posterior tiene que poder confirmarse.
  const nuevoEstado = estadoMp === "rejected" || estadoMp === "cancelled" ? "rechazado" : "pendiente";
  await supabaseAdmin
    .from("mensualidad_reserva_pagos")
    .update({ mp_status: estadoMp, mp_status_detail: detalleMp, estado: nuevoEstado })
    .eq("id", intento.id)
    .in("estado", ["pendiente", "rechazado"]);

  return { ok: true, estado: "registrado", pagoId: intento.id, mpStatus: estadoMp };
}

/**
 * Reconciliación: el webhook puede tardar o perderse. El SERVIDOR le pregunta a
 * Mercado Pago por los pagos de este intento. El cliente nunca elige un
 * payment_id: solo tiene el token, y el id se descubre por external_reference.
 */
export async function reconciliarReserva(externalReference: string): Promise<ResultadoPagoReserva | null> {
  const client = clienteMp();
  if (!client) return null;

  let encontrados: Array<{ id?: string; status?: string; date_created?: string }> = [];
  try {
    const r = await new Payment(client).search({
      options: { external_reference: externalReference, limit: 10 },
    });
    encontrados = (r?.results ?? []) as typeof encontrados;
  } catch {
    return null;
  }
  if (encontrados.length === 0) return null;

  const aprobado = encontrados.find((p) => p.status === "approved");
  const elegido = aprobado ?? [...encontrados].sort((a, b) =>
    String(b.date_created ?? "").localeCompare(String(a.date_created ?? ""))
  )[0];
  if (!elegido?.id) return null;

  return procesarPagoReserva(String(elegido.id));
}

// ── Barrido de retenciones vencidas ─────────────────────────────────────────

export type ResultadoBarrido = {
  revisados: number;
  liberados: number;
  confirmados: number;
  pospuestos: number;
};

/**
 * Libera las retenciones vencidas. Antes de soltar una, le pregunta a Mercado
 * Pago si hay un pago aprobado:
 *   · si lo hay, se confirma en vez de liberar (pago aprobado a tiempo con
 *     webhook tardío: el turno es suyo);
 *   · si MP no responde, se POSPONE. Mejor demorar la liberación que vender dos
 *     veces el mismo turno.
 */
export async function liberarRetencionesVencidas(limite = 50): Promise<ResultadoBarrido> {
  const out: ResultadoBarrido = { revisados: 0, liberados: 0, confirmados: 0, pospuestos: 0 };

  const { data } = await supabaseAdmin
    .from("mensualidad_reserva_pagos")
    .select("id, external_reference")
    .in("estado", ["pendiente", "rechazado"])
    .lt("retencion_vence_at", new Date().toISOString())
    .order("retencion_vence_at", { ascending: true })
    .limit(limite);

  for (const fila of (data ?? []) as Array<{ id: string; external_reference: string }>) {
    out.revisados++;

    // 1) ¿Mercado Pago dice que está pagado?
    const r = await reconciliarReserva(fila.external_reference).catch(() => null);
    if (r === null) {
      // MP no contestó (o no hay credenciales). No se libera: se pospone.
      out.pospuestos++;
      continue;
    }
    if (r.ok && (r.estado === "confirmado" || r.estado === "revision")) {
      out.confirmados++;
      continue;
    }

    // 2) No hay pago aprobado: liberar.
    const { data: lib } = await supabaseAdmin.rpc("liberar_retencion_reserva_mensualidad", {
      p_pago_id: fila.id,
    });
    const l = (Array.isArray(lib) ? lib[0] : lib) as { liberado?: boolean } | null;
    if (l?.liberado) out.liberados++;
  }

  return out;
}

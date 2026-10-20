import { NextResponse } from "next/server";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  evaluarPedido, filaReservaWeb, precioDelPedido, prepararReservaWeb, type Fallo, type PedidoReservaWeb,
} from "@/lib/reservasComercial";
import { evaluarCodigoDescuento, validarCodigoDescuento } from "@/lib/codigosDescuento";
import {
  huellaIntento, intentoDe, liberarRetencion, pasoReintento, retencionDeIntento, retenerCupon, vencimientoPreferencia, vincularRetencion,
  type EstadoCompraIntento, type FalloCupon, type Retencion,
} from "@/lib/cuponesRetencion";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { experimentoPostpayActivo, retornoExperimental } from "@/lib/reservaPostpay";
import { registrarPromosCheckout } from "@/lib/marketing/checkoutPromos";

const falloJson = (f: Fallo) =>
  NextResponse.json(
    { error: f.error, ...(f.codigo ? { codigo: f.codigo } : {}), ...(f.duraciones ? { duraciones: f.duraciones } : {}) },
    { status: f.status },
  );
const falloCuponJson = (f: FalloCupon) => NextResponse.json({ error: f.error, codigo: f.codigo }, { status: f.status });

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

const client = new MercadoPagoConfig({ accessToken: accessToken! });

function isInvalidBaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

/** Lo que identifica el pedido de un intento: si cambia, es otro intento. */
function huellaReserva(pedido: PedidoReservaWeb, codigo: string, totalOriginal: number) {
  return huellaIntento({
    producto: "reserva", codigo, modalidad: pedido.modalidad, fecha: pedido.fecha, hora: pedido.hora,
    duracion: pedido.duracion, simuladores: [...pedido.simuladores].sort(), nombre: pedido.nombre,
    telefono: pedido.telefono, total_original: totalOriginal,
  });
}

export async function POST(req: Request) {
  if (!(await rateLimit(`pref-resv:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  let reservaPendienteId: number | null = null;
  // Cupón de usos limitados: retenido ANTES de habilitar el pago con descuento.
  let retencion: Retencion | null = null;
  let conPagoMarcado = false;
  try {
    if (!accessToken) {
      return failResponse(500, "Servicio de pago no disponible", {
        logContext: "pref-resv sin access token",
      });
    }
    if (!baseUrl || isInvalidBaseUrl(baseUrl)) {
      return failResponse(500, "Servicio de pago mal configurado", {
        logContext: "pref-resv baseUrl inválida",
      });
    }

    const body = await req.json().catch(() => null);

    // (B3) La modalidad se resuelve UNA vez en este request y queda guardada en
    // la reserva pendiente: el webhook la usa aunque el pago llegue después del
    // corte. Catálogo visto distinto del vigente → 409: ni reserva, ni
    // preferencia, ni cobro.
    const preparado = await prepararReservaWeb(body);
    if (!preparado.ok) return falloJson(preparado);
    const pedido = preparado.pedido;
    const { fecha, duracion, codigo_descuento } = pedido;

    // Bloqueos y disponibilidad por el motor de intervalos con las reglas de SU
    // modalidad. Bloqueado → 400 acá, como siempre; la ocupación se informa más
    // abajo, en el mismo orden de antes.
    const veredicto = await evaluarPedido(pedido);
    if (veredicto.bloqueado) {
      return NextResponse.json(
        { error: "Ese horario no está disponible." },
        { status: 400 }
      );
    }

    // Precio recalculado server-side por SU modalidad (incluye precio especial
    // de la fecha si existe); se ignora cualquier total enviado por el cliente.
    const precio = await precioDelPedido(pedido, body);
    if (!precio.ok) return falloJson(precio);
    const totalOriginal = precio.totalOriginal;
    if (!Number.isFinite(totalOriginal) || totalOriginal <= 0) {
      return NextResponse.json(
        { error: "No se pudo calcular el precio de la reserva" },
        { status: 400 }
      );
    }

    let descuentoAplicado = 0;
    let codigoAplicado: string | null = null;
    let limitado = false;
    const intento = intentoDe(body);
    if (codigo_descuento) {
      const r = await validarCodigoDescuento(codigo_descuento, totalOriginal, fecha, duracion);
      const previa = r.valido ? null : await retencionDeIntento(intento, codigo_descuento);
      // Un reintento de una compra que ya usó el cupón no vuelve a validar: manda el
      // estado de su propia retención (misma compra, mismo link, o "ya se pagó").
      if (!r.valido && !previa) {
        return NextResponse.json({ error: r.error || "Código inválido" }, { status: 400 });
      }
      descuentoAplicado = previa ? Number(previa.descuento ?? 0) : Number(r.descuento || 0);
      codigoAplicado = previa ? previa.codigo : r.codigo;
      limitado = previa ? true : Boolean(r.limitado);
    }

    let totalFinal = Math.round(Math.max(totalOriginal - descuentoAplicado, 0));
    if (!Number.isFinite(totalFinal) || totalFinal <= 0) {
      return NextResponse.json(
        { error: "El total final debe ser mayor a $0 para pagar con Mercado Pago." },
        { status: 400 }
      );
    }

    // Cupón de usos limitados: se retiene en la base (exclusivo entre Reservas y
    // Gift Cards) y el descuento se recalcula sobre la fila bloqueada. Un
    // reintento del mismo intento sigue su propio camino (reintentoReserva).
    let reintentar: "rehacer_preferencia" | null = null;
    if (codigoAplicado && limitado) {
      const h = await retenerCupon({
        codigo: codigoAplicado, producto: "reserva", intento, huella: huellaReserva(pedido, codigoAplicado, totalOriginal),
      });
      if (!h.ok) return falloCuponJson(h);
      retencion = h.retencion;
      if (h.reutilizada) {
        const paso = pasoReintento(h.retencion, await estadoReservaDelIntento(h.retencion), new Date(), true);
        if (paso.paso === "rechazar") return falloCuponJson(paso.fallo);
        if (paso.paso === "devolver") {
          return NextResponse.json({
            id: paso.preferencia_id,
            init_point: paso.init_point,
            sandbox_init_point: null,
            reserva_id: h.retencion.reserva_id,
            total_original: Number(h.retencion.total_original),
            descuento_aplicado: Number(h.retencion.descuento),
            total_final: Number(h.retencion.total_final),
            codigo_descuento: h.retencion.codigo,
            promos: "no_solicitada",
          });
        }
        if (paso.paso === "rehacer_preferencia") {
          // Los importes son los que quedaron fijados en la retención.
          reintentar = "rehacer_preferencia";
          descuentoAplicado = Number(h.retencion.descuento);
          totalFinal = Number(h.retencion.total_final);
        }
      }
      if (!reintentar) {
        const ev = evaluarCodigoDescuento(h.fila, totalOriginal, fecha, duracion, new Date(), { ignorarCupo: true });
        if (!ev.valido || Math.round(ev.descuento) !== Math.round(descuentoAplicado)) {
          await liberarRetencion(h.retencion.id, "sin_oportunidad_de_pago");
          retencion = null;
          return NextResponse.json(
            { error: ev.valido ? "El código de descuento cambió mientras comprabas. Probá de nuevo." : ev.error || "Código inválido", codigo: "codigo_cambiado" },
            { status: 409 },
          );
        }
      }
    }

    let reservaId: number;
    if (reintentar && retencion?.reserva_id) {
      // El intento anterior creó la reserva pero no entregó link: se rehace la
      // preferencia de ESA reserva (misma external_reference), sin otra reserva.
      const revivida = await revivirReserva(retencion.reserva_id, pedido);
      if (!revivida.ok) return revivida.respuesta;
      reservaId = retencion.reserva_id;
    } else {
      // Disponibilidad real (motor por intervalos): reservas activas + pendientes
      // recientes + bloqueos; cada simulador pedido libre durante TODO el turno,
      // buffer incluido en v2.
      if (veredicto.ocupado) {
        if (retencion) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
        retencion = null;
        return falloJson(veredicto.ocupado);
      }

      const { data: reservaPendiente, error: insertError } = await supabaseAdmin
        .from("reservas")
        .insert([
          filaReservaWeb(pedido, {
            estado: "pendiente_pago",
            total: totalFinal,
            total_original: totalOriginal,
            descuento_aplicado: Math.round(descuentoAplicado),
            codigo_descuento: codigoAplicado,
          }),
        ])
        .select("id")
        .single();

      if (insertError || !reservaPendiente) {
        if (retencion) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
        retencion = null;
        return failResponse(500, "Error creando la reserva", {
          logContext: "pref-resv insert",
          error: insertError,
        });
      }
      reservaId = reservaPendiente.id;
    }
    reservaPendienteId = reservaId;

    // La oportunidad de pago se anota en la retención ANTES de pedirle la
    // preferencia a Mercado Pago: si la respuesta no llega, la retención igual
    // sabe que pudo existir un pago hasta `expira` y no se libera antes.
    const vencimiento = retencion ? vencimientoPreferencia(new Date()) : null;
    if (retencion && vencimiento) {
      await vincularRetencion(retencion.id, {
        reserva_id: reservaId,
        external_reference: `reserva_${reservaId}`,
        total_original: totalOriginal,
        descuento: Math.round(descuentoAplicado),
        total_final: totalFinal,
        con_pago: true,
        expira: vencimiento.expira,
      });
      conPagoMarcado = true;
    }

    // Experiencia post-pago nueva, con kill switch: con
    // EXPERIMENTAL_RESERVA_POSTPAY=true vuelve a /reservas/confirmacion (cualquier
    // cliente); si no, el retorno de siempre, idéntico (ver lib/reservaPostpay.ts).
    const experimental = (await experimentoPostpayActivo())
      ? retornoExperimental(baseUrl, reservaId)
      : null;

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: `reserva-sim-${reservaId}`,
            title: "Reserva SIM Argentina",
            quantity: 1,
            unit_price: totalFinal,
            currency_id: "ARS",
          },
        ],
        external_reference: `reserva_${reservaId}`,
        back_urls: experimental ?? {
          success: `${baseUrl}/reservas/exito`,
          failure: `${baseUrl}/reservas/error`,
          pending: `${baseUrl}/reservas/pendiente`,
        },
        ...(experimental ? { auto_return: "approved" } : {}),
        notification_url: `${baseUrl}/api/mercadopago/webhook`,
        // Con cupón limitado la preferencia vence: es lo que acota la retención.
        ...(vencimiento ? vencimiento.campos : {}),
      },
    });

    // El link queda en la retención: un reintento del mismo intento recibe ESTE
    // link y no uno nuevo. Si no se puede guardar, no se entrega.
    if (retencion) {
      await vincularRetencion(retencion.id, { preferencia_id: String(result.id), init_point: String(result.init_point) });
    }

    // Casilla voluntaria de promociones: aparte de la compra, nunca la bloquea ni
    // la cambia (lib/marketing/checkoutPromos.ts). Sin casilla, no hace nada.
    const promos = await registrarPromosCheckout({
      body, fuente: "checkout_reserva", telefono: pedido.telefono, nombre: pedido.nombre,
      compra: { reserva_id: String(reservaId) }, ip: clientIp(req),
    });

    return NextResponse.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      reserva_id: reservaId,
      total_original: totalOriginal,
      descuento_aplicado: Math.round(descuentoAplicado),
      total_final: totalFinal,
      codigo_descuento: codigoAplicado,
      promos: promos.estado,
    });
  } catch (error) {
    if (reservaPendienteId) {
      await supabaseAdmin
        .from("reservas")
        .update({ estado: "error_pago" })
        .eq("id", reservaPendienteId);
    }
    // Sin oportunidad de pago anotada, nada pudo cobrarse con este cupón. Con
    // ella, la preferencia pudo crearse aunque no llegó la respuesta: la
    // retención queda hasta su vencimiento y la verificación en Mercado Pago.
    if (retencion && !conPagoMarcado) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
    return failResponse(500, "No se pudo crear la preferencia", {
      logContext: "pref-resv",
      error,
    });
  }
}

/** Estado de la reserva de un intento que se reintenta. */
async function estadoReservaDelIntento(r: Retencion): Promise<EstadoCompraIntento> {
  if (!r.reserva_id) return "sin_compra";
  const { data } = await supabaseAdmin.from("reservas").select("estado, mercado_pago_payment_id").eq("id", r.reserva_id).maybeSingle();
  if (!data) return "sin_compra";
  if (data.mercado_pago_payment_id || data.estado === "activa") return "completada";
  if (data.estado === "error_pago") return "fallida";
  return "en_preparacion";
}

/**
 * La reserva del intento vuelve a pendiente_pago para rehacer su preferencia.
 * Si había quedado en error_pago dejó de ocupar el turno: se vuelve a verificar
 * que siga libre (sin contarse a sí misma, porque no está pendiente).
 */
async function revivirReserva(
  reservaId: number,
  pedido: PedidoReservaWeb,
): Promise<{ ok: true } | { ok: false; respuesta: NextResponse }> {
  const { data } = await supabaseAdmin.from("reservas").select("estado").eq("id", reservaId).maybeSingle();
  if (data?.estado === "pendiente_pago") return { ok: true };
  if (data?.estado !== "error_pago") {
    return { ok: false, respuesta: NextResponse.json({ error: "Este intento de pago venció. Volvé a armar tu compra.", codigo: "intento_vencido" }, { status: 409 }) };
  }
  const veredicto = await evaluarPedido(pedido);
  if (veredicto.bloqueado) {
    return { ok: false, respuesta: NextResponse.json({ error: "Ese horario no está disponible." }, { status: 400 }) };
  }
  if (veredicto.ocupado) return { ok: false, respuesta: falloJson(veredicto.ocupado) };
  const { data: revivida } = await supabaseAdmin
    .from("reservas")
    .update({ estado: "pendiente_pago" })
    .eq("id", reservaId)
    .eq("estado", "error_pago")
    .is("mercado_pago_payment_id", null)
    .select("id");
  if (!revivida || revivida.length === 0) {
    return { ok: false, respuesta: NextResponse.json({ error: "Este intento de pago venció. Volvé a armar tu compra.", codigo: "intento_vencido" }, { status: 409 }) };
  }
  return { ok: true };
}

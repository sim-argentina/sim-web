import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  productoGiftCardDe,
  generarCodigoGiftCard,
  repartirMonto,
  calcularVencimientoGiftCard,
  GIFT_CARD_MAX_CANTIDAD,
  type ModoUso,
} from "@/lib/giftCards";
import { MENSAJE_GIFT_CARDS_ACTUALIZADAS, modalidadParaNuevaGiftCard } from "@/lib/giftCardsComercial";
import {
  validarCodigoDescuento,
  consumirCodigoDescuento,
  evaluarCodigoDescuento,
} from "@/lib/codigosDescuento";
import {
  CONSUMO_OK, consumirRetencion, huellaIntento, intentoDe, liberarRetencion, pasoReintento, prepararPagoConRetencion,
  retencionDeIntento, retenerCupon, vincularRetencion, type EstadoCompraIntento, type FalloCupon, type Retencion,
} from "@/lib/cuponesRetencion";
import { mercadoPago } from "@/lib/mercadoPagoApi";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { registrarPromosCheckout } from "@/lib/marketing/checkoutPromos";

// Flujo de pago de Gift Cards, totalmente separado del de reservas.
// external_reference usa el prefijo "gift_card_" + grupo_compra_id y la
// notificación va a /api/gift-cards/webhook. No toca la tabla "reservas".
//
// Código de descuento con varias Gift Cards (regla de siempre, sin cambios): se
// valida y se descuenta UNA vez sobre el total de la compra (precio × cantidad),
// se reparte entre las tarjetas (separadas) o va entero en la única fila
// (juntas), y cuenta UN uso del código por compra, sea 1 o 10 tarjetas.
// Con un cupón de usos limitados la compra entera tiene UNA retención.

const falloCuponJson = (f: FalloCupon) => NextResponse.json({ error: f.error, codigo: f.codigo }, { status: f.status });

/** Estado de la compra de un intento que se reintenta. */
async function estadoGrupoDelIntento(r: Retencion): Promise<EstadoCompraIntento> {
  if (!r.grupo_compra_id) return "sin_compra";
  const { data } = await supabaseAdmin
    .from("gift_cards")
    .select("estado_pago, mercado_pago_payment_id")
    .eq("grupo_compra_id", r.grupo_compra_id);
  if (!data || data.length === 0) return "sin_compra";
  if (data.some((g) => g.mercado_pago_payment_id || g.estado_pago === "pagado")) return "completada";
  if (data.every((g) => g.estado_pago === "cancelado")) return "fallida";
  return "en_preparacion";
}

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;


function isInvalidBaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

// Genera N códigos únicos distintos entre sí.
function generarCodigosUnicos(n: number): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(generarCodigoGiftCard());
  return Array.from(set);
}

export async function POST(req: Request) {
  if (!(await rateLimit(`pref-gift:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  let grupoId: string | null = null;
  // Cupón de usos limitados: retenido ANTES de habilitar el pago con descuento.
  let retencion: Retencion | null = null;

  try {
    const body = await req.json().catch(() => ({}));

    // (B5) La modalidad se resuelve UNA vez en este request: con ella se eligen
    // duración y precio de lo que se crea. Una pestaña armada con otro catálogo
    // → 409, antes de crear filas, preferencia o cobro.
    const vigente = await modalidadParaNuevaGiftCard(body, { mensaje: MENSAJE_GIFT_CARDS_ACTUALIZADAS });
    if (!vigente.ok) {
      return NextResponse.json({ error: vigente.error, codigo: vigente.codigo }, { status: vigente.status });
    }

    const comprador_nombre = String(body?.comprador_nombre ?? "").trim();
    const comprador_telefono = String(body?.comprador_telefono ?? "").trim();
    const destinatario_nombre = body?.destinatario_nombre
      ? String(body.destinatario_nombre).trim().slice(0, 80)
      : null;
    const duracion_minutos = body?.duracion_minutos;
    const codigo_descuento = body?.codigo_descuento;

    if (!comprador_nombre || comprador_nombre.length > 80) {
      return NextResponse.json({ error: "Nombre del comprador inválido" }, { status: 400 });
    }
    if (!/^[0-9+()\s-]{6,30}$/.test(comprador_telefono)) {
      return NextResponse.json({ error: "Teléfono del comprador inválido" }, { status: 400 });
    }

    const producto = productoGiftCardDe(vigente.modalidad, duracion_minutos);
    if (!producto) {
      return NextResponse.json(
        { error: "Duración de Gift Card inválida" },
        { status: 400 }
      );
    }

    const cantidad = Math.round(Number(body.cantidad) || 1);
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > GIFT_CARD_MAX_CANTIDAD) {
      return NextResponse.json(
        { error: `La cantidad debe estar entre 1 y ${GIFT_CARD_MAX_CANTIDAD}` },
        { status: 400 }
      );
    }

    const modo_uso: ModoUso = body.modo_uso === "juntas" ? "juntas" : "separadas";

    const unit = producto.monto;
    const montoOriginal = unit * cantidad;

    // Validar código de descuento sobre el total (misma lógica que reservas)
    let codigoAplicado: string | null = null;
    let descuentoAplicado = 0;
    let limitado = false;

    const intento = intentoDe(body);
    let previa: Retencion | null = null;
    if (codigo_descuento && String(codigo_descuento).trim()) {
      const resultado = await validarCodigoDescuento(
        String(codigo_descuento),
        montoOriginal
      );
      previa = resultado.valido ? null : await retencionDeIntento(intento, String(codigo_descuento));
      // Un reintento de una compra que ya usó el cupón no vuelve a validar: manda el
      // estado de su propia retención (misma compra, mismo link, o "ya se pagó").
      if (previa) {
        resultado.valido = true;
        resultado.codigo = previa.codigo;
        resultado.descuento = Number(previa.descuento ?? 0);
        resultado.limitado = true;
      }
      if (!resultado.valido) {
        return NextResponse.json(
          { error: resultado.error || "Código inválido" },
          { status: 400 }
        );
      }
      codigoAplicado = resultado.codigo;
      descuentoAplicado = Math.round(resultado.descuento || 0);
      limitado = Boolean(resultado.limitado);
    }

    let montoFinal = Math.max(montoOriginal - descuentoAplicado, 0);
    const nowIso = new Date().toISOString();

    // Cupón de usos limitados: retención exclusiva en la base (compartida con
    // Reservas) y descuento recalculado sobre la fila bloqueada. Un reintento
    // del mismo intento reutiliza su compra y su link.
    let rehacer = false;
    if (codigoAplicado && limitado) {
      const h = await retenerCupon({
        codigo: codigoAplicado, producto: "gift_card", intento,
        huella: huellaIntento({
          producto: "gift_card", codigo: codigoAplicado, modalidad: vigente.modalidad, duracion: producto.duracion,
          cantidad, modo_uso, comprador_nombre, comprador_telefono, destinatario_nombre, monto_original: montoOriginal,
        }),
      });
      if (!h.ok) return falloCuponJson(h);
      retencion = h.retencion;
      if (h.reutilizada) {
        const paso = pasoReintento(h.retencion, await estadoGrupoDelIntento(h.retencion), new Date(), montoFinal > 0);
        if (paso.paso === "rechazar") return falloCuponJson(paso.fallo);
        if (paso.paso === "devolver") {
          return NextResponse.json({
            id: paso.preferencia_id, grupo_compra_id: h.retencion.grupo_compra_id,
            init_point: paso.init_point, sandbox_init_point: null, promos: "no_solicitada",
          });
        }
        if (paso.paso === "completada") {
          if (!h.retencion.grupo_compra_id) return falloCuponJson({ ok: false, status: 409, error: "Este intento de pago venció. Volvé a armar tu compra.", codigo: "intento_vencido" });
          if (h.retencion.estado === "retenido" && !CONSUMO_OK.has(await consumirRetencion(h.retencion.id, null))) {
            return falloCuponJson({ ok: false, status: 409, error: "El código de descuento ya no está disponible", codigo: "agotado" });
          }
          // Si el pedido anterior murió entre el consumo y la activación, se
          // completa acá: misma vigencia que cualquier Gift Card (30 días).
          if (Number(h.retencion.total_final) === 0) {
            const activadaEn = new Date().toISOString();
            await supabaseAdmin
              .from("gift_cards")
              .update({
                estado_pago: "pagado", estado_uso: "pendiente", fecha_pago: activadaEn,
                fecha_vencimiento: calcularVencimientoGiftCard(activadaEn), updated_at: activadaEn,
              })
              .eq("grupo_compra_id", h.retencion.grupo_compra_id)
              .eq("estado_pago", "pendiente_pago")
              .is("mercado_pago_payment_id", null);
          }
          return NextResponse.json({ free: true, grupo_compra_id: h.retencion.grupo_compra_id, promos: "no_solicitada" });
        }
        if (paso.paso === "rehacer_preferencia" && h.retencion.grupo_compra_id) {
          // La compra del intento anterior se reabre (si había quedado cancelada
          // por el error) y se le rehace la preferencia: misma external_reference.
          await supabaseAdmin
            .from("gift_cards")
            .update({ estado_pago: "pendiente_pago", updated_at: nowIso })
            .eq("grupo_compra_id", h.retencion.grupo_compra_id)
            .eq("estado_pago", "cancelado")
            .is("mercado_pago_payment_id", null);
          rehacer = true;
          grupoId = h.retencion.grupo_compra_id;
          descuentoAplicado = Number(h.retencion.descuento);
          montoFinal = Number(h.retencion.total_final);
        }
      }
      if (!rehacer) {
        const ev = evaluarCodigoDescuento(h.fila, montoOriginal, null, null, new Date(), { ignorarCupo: true });
        if (!ev.valido || Math.round(ev.descuento) !== descuentoAplicado) {
          await liberarRetencion(h.retencion.id, "sin_oportunidad_de_pago");
          retencion = null;
          return NextResponse.json(
            { error: ev.valido ? "El código de descuento cambió mientras comprabas. Probá de nuevo." : ev.error || "Código inválido", codigo: "codigo_cambiado" },
            { status: 409 },
          );
        }
      }
    }

    if (!rehacer) grupoId = randomUUID();
    if (!grupoId) throw new Error("Gift Card sin grupo de compra");

    const base = {
      comprador_nombre: comprador_nombre.trim(),
      comprador_telefono: comprador_telefono.trim(),
      destinatario_nombre: destinatario_nombre?.trim() || null,
      duracion_minutos: producto.duracion,
      codigo_descuento: codigoAplicado,
      modo_uso,
      grupo_compra_id: grupoId,
      estado_pago: "pendiente_pago",
      estado_uso: "pendiente",
    };

    // Construir las filas a insertar según el modo de uso.
    let rows: Record<string, unknown>[];
    if (modo_uso === "juntas") {
      // Una sola fila que representa toda la compra (cantidad usos).
      rows = [
        {
          ...base,
          codigo_unico: generarCodigosUnicos(1)[0],
          cantidad,
          usos_totales: cantidad,
          usos_disponibles: cantidad,
          monto: montoFinal,
          monto_original: montoOriginal,
          descuento_aplicado: descuentoAplicado,
        },
      ];
    } else {
      // Una fila por gift card, cada una con su código único.
      const codigos = generarCodigosUnicos(cantidad);
      const montos = repartirMonto(montoFinal, cantidad);
      rows = codigos.map((codigo, i) => ({
        ...base,
        codigo_unico: codigo,
        cantidad: 1,
        usos_totales: 1,
        usos_disponibles: 1,
        monto: montos[i],
        monto_original: unit,
        descuento_aplicado: unit - montos[i],
      }));
    }

    const { error: insertError } = rehacer ? { error: null } : await supabaseAdmin
      .from("gift_cards")
      .insert(rows);

    if (insertError) {
      if (retencion) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
      retencion = null;
      grupoId = null;
      return failResponse(500, "Error creando la Gift Card", {
        logContext: "pref-gift insert",
        error: insertError,
      });
    }

    // Gift Card 100% bonificada: no pasa por Mercado Pago.
    if (montoFinal <= 0) {
      // Consumir el código ANTES de habilitar la gift card gratis. Limitado: la
      // retención de este intento; sin límite: el consumo atómico de siempre.
      if (retencion) {
        await vincularRetencion(retencion.id, {
          grupo_compra_id: grupoId, total_original: montoOriginal, descuento: descuentoAplicado, total_final: 0,
        });
        if (!CONSUMO_OK.has(await consumirRetencion(retencion.id, null, { nombre: comprador_nombre, telefono: comprador_telefono }))) {
          retencion = null;
          await supabaseAdmin
            .from("gift_cards")
            .update({ estado_pago: "cancelado", updated_at: nowIso })
            .eq("grupo_compra_id", grupoId);
          return NextResponse.json(
            { error: "El código de descuento ya no está disponible" },
            { status: 409 }
          );
        }
        retencion = null;
      } else if (codigoAplicado) {
        const consumido = await consumirCodigoDescuento(codigoAplicado);
        if (!consumido) {
          await supabaseAdmin
            .from("gift_cards")
            .update({ estado_pago: "cancelado", updated_at: nowIso })
            .eq("grupo_compra_id", grupoId);
          return NextResponse.json(
            { error: "El código de descuento ya no está disponible" },
            { status: 409 }
          );
        }
      }

      await supabaseAdmin
        .from("gift_cards")
        .update({
          estado_pago: "pagado",
          estado_uso: "pendiente",
          fecha_pago: nowIso,
          // Misma vigencia que cualquier otra Gift Card: acá el pago ya está
          // confirmado (no hay nada que cobrar), así que arranca ahora.
          fecha_vencimiento: calcularVencimientoGiftCard(nowIso),
          updated_at: nowIso,
        })
        .eq("grupo_compra_id", grupoId);

      // Casilla voluntaria de promociones: aparte de la compra, nunca la bloquea
      // ni la cambia (lib/marketing/checkoutPromos.ts). Sin casilla, no hace nada.
      const promos = await registrarPromosCheckout({
        body, fuente: "checkout_gift_card", telefono: comprador_telefono, nombre: comprador_nombre,
        compra: { grupo_compra_id: grupoId }, ip: clientIp(req),
      });
      return NextResponse.json({ free: true, grupo_compra_id: grupoId, promos: promos.estado });
    }

    if (!accessToken || !baseUrl || isInvalidBaseUrl(baseUrl)) {
      return failResponse(500, "Servicio de pago no disponible", {
        logContext: "pref-gift config",
      });
    }

    const titulo =
      cantidad > 1
        ? `${cantidad} Gift Cards SIM · ${producto.duracion} min${modo_uso === "juntas" ? " (juntas)" : ""}`
        : `Gift Card SIM Argentina · ${producto.duracion} min`;

    const cuerpo = (extra: Record<string, unknown> = {}) => ({
      items: [
        {
          id: `gift-card-${grupoId}`,
          title: titulo,
          quantity: 1,
          unit_price: montoFinal,
          currency_id: "ARS",
        },
      ],
      external_reference: `gift_card_${grupoId}`,
      back_urls: {
        success: `${baseUrl}/gift-cards/exito`,
        failure: `${baseUrl}/gift-cards/error`,
        pending: `${baseUrl}/gift-cards/pendiente`,
      },
      notification_url: `${baseUrl}/api/gift-cards/webhook`,
      ...extra,
    });

    let result: { id: string; init_point?: string | null; sandbox_init_point?: string | null };
    if (retencion) {
      // Turno + oportunidad de pago anotada ANTES de pedirle la preferencia a
      // Mercado Pago, con vencimiento (es lo que acota la retención), y el link
      // guardado en la retención: un reintento recibe ESTE link, no otro. En un
      // reintento, primero se recupera la que pudo quedar creada.
      const pago = await prepararPagoConRetencion({
        retencion,
        reintento: rehacer,
        vinculo: {
          grupo_compra_id: grupoId, external_reference: `gift_card_${grupoId}`,
          total_original: montoOriginal, descuento: descuentoAplicado, total_final: montoFinal,
        },
        crear: (campos) => mercadoPago.crearPreferencia(cuerpo(campos)),
      });
      if (!pago.ok) {
        if (pago.fallo.codigo === "verificando_pago") {
          await supabaseAdmin
            .from("gift_cards")
            .update({ estado_pago: "cancelado", updated_at: nowIso })
            .eq("grupo_compra_id", grupoId)
            .is("mercado_pago_payment_id", null);
        }
        return falloCuponJson(pago.fallo);
      }
      result = { ...pago.preferencia, sandbox_init_point: null };
    } else {
      result = await mercadoPago.crearPreferencia(cuerpo());
    }

    await supabaseAdmin
      .from("gift_cards")
      .update({ mercado_pago_preference_id: result.id || null, updated_at: nowIso })
      .eq("grupo_compra_id", grupoId);

    const promos = await registrarPromosCheckout({
      body, fuente: "checkout_gift_card", telefono: comprador_telefono, nombre: comprador_nombre,
      compra: { grupo_compra_id: grupoId }, ip: clientIp(req),
    });

    return NextResponse.json({
      id: result.id,
      grupo_compra_id: grupoId,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      promos: promos.estado,
    });
  } catch (error: unknown) {
    if (grupoId) {
      await supabaseAdmin
        .from("gift_cards")
        .update({ estado_pago: "cancelado", updated_at: new Date().toISOString() })
        .eq("grupo_compra_id", grupoId)
        .is("mercado_pago_payment_id", null);
    }
    // Sin oportunidad de pago anotada, nada pudo cobrarse con este cupón y se
    // libera. Con ella, la preferencia pudo crearse aunque no llegó la respuesta:
    // la base se niega a liberar y la retención queda hasta vencer y verificarse.
    if (retencion) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
    return failResponse(500, "No se pudo crear la preferencia de Gift Card", {
      logContext: "pref-gift",
      error,
    });
  }
}

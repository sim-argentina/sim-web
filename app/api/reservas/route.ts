import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { filasSlotsReserva } from "@/lib/reservasSlots";
import {
  evaluarPedido, filaReservaWeb, precioDelPedido, prepararReservaWeb, type Fallo,
} from "@/lib/reservasComercial";
import {
  validarCodigoDescuento,
  consumirCodigoDescuento,
  evaluarCodigoDescuento,
} from "@/lib/codigosDescuento";
import {
  consumirRetencion, huellaIntento, intentoDe, liberarRetencion, pasoReintento, retencionDeIntento, retenerCupon, vincularRetencion,
  type FalloCupon, type Retencion,
} from "@/lib/cuponesRetencion";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { registrarPromosCheckout } from "@/lib/marketing/checkoutPromos";

// GET: disponibilidad. Público requiere ?fecha (evita scraping del calendario
// completo) y recibe un DTO sin PII. El admin autenticado recibe datos completos.
export async function GET(req: Request) {
  if (!(await rateLimit(`resv-get:${clientIp(req)}`, 60, 60_000))) {
    return tooManyResponse();
  }
  try {
    const role = await getCurrentAdminRole();
    const { searchParams } = new URL(req.url);
    const fecha = searchParams.get("fecha");
    const estado = searchParams.get("estado");

    if (!role && !fecha) {
      return NextResponse.json({ error: "Especificá una fecha" }, { status: 400 });
    }
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    }

    // (B3) `modalidad` no es PII: le permite a quien todavía calcula por bloques
    // (la página de Empresas) ver la ocupación real de una reserva v2.
    const cols = role
      ? "*"
      : "fecha, hora, simuladores, estado, duracion_minutos, cantidad_turnos, modalidad";

    let query = supabaseAdmin
      .from("reservas")
      .select(cols)
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });

    if (fecha) query = query.eq("fecha", fecha);
    if (estado) query = query.eq("estado", estado);

    const { data, error } = await query;
    if (error) {
      return failResponse(500, "Error al obtener reservas", {
        logContext: "reservas GET",
        error,
      });
    }

    // Solo el ADMIN recibe el detalle del reembolso (monto/fecha/motivo). Staff puede
    // ver el estado "reembolsada" (viene en la columna estado) pero NUNCA el detalle.
    let rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    if (role === "admin" && rows.length > 0) {
      const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
      if (ids.length > 0) {
        const { data: refs } = await supabaseAdmin
          .from("reservas_reembolsos")
          .select("reserva_id, monto_reembolsado, fecha_reembolso, motivo, origen_registro, actor, created_at")
          .in("reserva_id", ids);
        const byId = new Map((refs ?? []).map((r) => [Number(r.reserva_id), r]));
        rows = rows.map((r) => ({ ...r, reembolso: byId.get(Number(r.id)) ?? null }));
      }
    }
    return NextResponse.json(rows, { status: 200 });
  } catch (error) {
    return failResponse(500, "Error al obtener reservas", {
      logContext: "reservas GET",
      error,
    });
  }
}

const falloJson = (f: Fallo) =>
  NextResponse.json(
    { error: f.error, ...(f.codigo ? { codigo: f.codigo } : {}), ...(f.duraciones ? { duraciones: f.duraciones } : {}) },
    { status: f.status },
  );
const falloCuponJson = (f: FalloCupon) => NextResponse.json({ error: f.error, codigo: f.codigo }, { status: f.status });
const USADO = new Set(["consumida", "ya_consumida", "consumida_tras_liberar"]);

// POST: SOLO crea reservas 100% bonificadas (gratis). Con saldo > 0 se exige
// pago online. Precio recalculado server-side; turno reservado con garantía DB.
export async function POST(req: Request) {
  if (!(await rateLimit(`resv-post:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  let reservaCreadaId: number | null = null;
  // Cupón de usos limitados: retenido antes de crear la reserva y consumido en
  // este mismo pedido (no hay pago). Si algo falla antes, se libera.
  let retencion: Retencion | null = null;
  try {
    const body = await req.json().catch(() => null);

    // (B3) La modalidad se resuelve UNA vez en este request y queda guardada en
    // la reserva. Un catálogo visto distinto del vigente → 409, sin crear nada.
    const preparado = await prepararReservaWeb(body);
    if (!preparado.ok) return falloJson(preparado);
    const pedido = preparado.pedido;
    const { codigo_descuento, fecha, duracion } = pedido;

    // Bloqueos y disponibilidad por el motor de intervalos, con las reglas de
    // SU modalidad: bloqueado → 400 como siempre; ocupado → 409. La garantía
    // definitiva contra carreras sigue siendo la base (índice único + trigger).
    const veredicto = await evaluarPedido(pedido);
    if (veredicto.bloqueado) {
      return NextResponse.json(
        { error: "Ese horario no está disponible." },
        { status: 400 }
      );
    }

    // ── Precio recalculado server-side por SU modalidad (precio especial de la
    // fecha si existe; nunca se confía en el cliente) ──
    const precio = await precioDelPedido(pedido, body);
    if (!precio.ok) return falloJson(precio);
    const totalOriginal = precio.totalOriginal;

    let descuento = 0;
    let codigoValido: string | null = null;
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
      descuento = previa ? Math.round(Number(previa.descuento ?? 0)) : Math.round(r.descuento || 0);
      codigoValido = previa ? previa.codigo : r.codigo;
      limitado = previa ? true : Boolean(r.limitado);
    }

    const totalFinal = Math.max(totalOriginal - descuento, 0);
    if (totalFinal > 0) {
      return NextResponse.json(
        { error: "Esta reserva requiere pago online con Mercado Pago." },
        { status: 400 }
      );
    }

    // Cupón de usos limitados: retención exclusiva en la base ANTES de crear
    // nada. El mismo intento ya completado devuelve la misma reserva.
    if (codigoValido && limitado) {
      const h = await retenerCupon({
        codigo: codigoValido, producto: "reserva", intento,
        huella: huellaIntento({
          producto: "reserva", codigo: codigoValido, modalidad: pedido.modalidad, fecha, hora: pedido.hora, duracion,
          simuladores: [...pedido.simuladores].sort(), nombre: pedido.nombre, telefono: pedido.telefono, total_original: totalOriginal,
        }),
      });
      if (!h.ok) return falloCuponJson(h);
      retencion = h.retencion;
      if (h.reutilizada) {
        const previa = h.retencion.reserva_id
          ? (await supabaseAdmin.from("reservas").select("*").eq("id", h.retencion.reserva_id).maybeSingle()).data
          : null;
        const paso = pasoReintento(h.retencion, previa?.estado === "activa" ? "completada" : "sin_compra", new Date(), false);
        if (paso.paso === "rechazar") return falloCuponJson(paso.fallo);
        if (paso.paso === "completada") {
          if (!previa) return falloCuponJson({ ok: false, status: 409, error: "Este intento de pago venció. Volvé a armar tu compra.", codigo: "intento_vencido" });
          if (h.retencion.estado === "retenido" && !USADO.has(await consumirRetencion(h.retencion.id, null))) {
            return falloCuponJson({ ok: false, status: 409, error: "El código de descuento ya no está disponible", codigo: "agotado" });
          }
          return NextResponse.json({ ...previa, promos: "no_solicitada" }, { status: 201 });
        }
      }
      const ev = evaluarCodigoDescuento(h.fila, totalOriginal, fecha, duracion, new Date(), { ignorarCupo: true });
      if (!ev.valido || Math.round(ev.descuento) !== descuento) {
        await liberarRetencion(h.retencion.id, "sin_oportunidad_de_pago");
        retencion = null;
        return NextResponse.json(
          { error: ev.valido ? "El código de descuento cambió mientras reservabas. Probá de nuevo." : ev.error || "Código inválido", codigo: "codigo_cambiado" },
          { status: 409 },
        );
      }
    }

    if (veredicto.ocupado) {
      if (retencion) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
      retencion = null;
      return falloJson(veredicto.ocupado);
    }

    // 1) Crear la reserva activa, con SU modalidad explícita.
    const { data, error } = await supabaseAdmin
      .from("reservas")
      .insert([
        filaReservaWeb(pedido, {
          estado: "activa",
          total: 0,
          total_original: totalOriginal,
          descuento_aplicado: descuento,
          codigo_descuento: codigoValido,
        }),
      ])
      .select()
      .single();

    if (error || !data) {
      if (retencion) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
      retencion = null;
      return failResponse(500, "Error al guardar la reserva", {
        logContext: "reservas POST insert",
        error,
      });
    }
    reservaCreadaId = data.id;

    // 2) Reservar los slots (garantía DB anti doble-reserva) según la modalidad
    // guardada: legacy, bloques de 20 como siempre; v2, una fila por simulador
    // con la ocupación completa (duración + buffer).
    const slotRows = filasSlotsReserva(data);
    const { error: slotErr } = await supabaseAdmin
      .from("reserva_slots")
      .insert(slotRows);
    if (slotErr) {
      await supabaseAdmin.from("reservas").delete().eq("id", data.id);
      reservaCreadaId = null;
      if (retencion) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
      retencion = null;
      if ((slotErr as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Uno o más simuladores ya están reservados en ese horario" },
          { status: 409 }
        );
      }
      // 23514 = el trigger rechazó el slot por un bloqueo administrativo activo
      // (creado concurrentemente). Rollback ya hecho; el turno no queda reservado.
      if ((slotErr as { code?: string }).code === "23514") {
        return NextResponse.json(
          { error: "Ese horario no está disponible." },
          { status: 409 }
        );
      }
      return failResponse(500, "Error al reservar el turno", {
        logContext: "reservas POST slots",
        error: slotErr,
      });
    }

    // 3) Consumir el código. Limitado: la retención de ESTE intento, vinculada a la
    // reserva para la auditoría. Sin límite: el consumo atómico de siempre. Si ya
    // no está disponible, revertir.
    if (retencion) {
      await vincularRetencion(retencion.id, { reserva_id: data.id, total_original: totalOriginal, descuento, total_final: 0 });
      const r = await consumirRetencion(retencion.id, null, {
        nombre: data.nombre, telefono: data.telefono, fecha_reserva: data.fecha, hora_reserva: data.hora,
      });
      if (!USADO.has(r)) {
        await supabaseAdmin.from("reservas").delete().eq("id", data.id);
        reservaCreadaId = null;
        return NextResponse.json(
          { error: "El código de descuento ya no está disponible" },
          { status: 409 }
        );
      }
      retencion = null;
    } else if (codigoValido) {
      const consumido = await consumirCodigoDescuento(codigoValido, {
        reserva_id: data.id,
        nombre: data.nombre,
        telefono: data.telefono,
        fecha_reserva: data.fecha,
        hora_reserva: data.hora,
        total_original: data.total_original,
        descuento_aplicado: data.descuento_aplicado,
        total_final: data.total,
      });
      if (!consumido) {
        await supabaseAdmin.from("reservas").delete().eq("id", data.id);
        reservaCreadaId = null;
        return NextResponse.json(
          { error: "El código de descuento ya no está disponible" },
          { status: 409 }
        );
      }
    }

    // Casilla voluntaria de promociones: aparte de la reserva, nunca la bloquea ni
    // la cambia (lib/marketing/checkoutPromos.ts). Sin casilla, no hace nada.
    const promos = await registrarPromosCheckout({
      body, fuente: "checkout_reserva", telefono: data.telefono, nombre: data.nombre,
      compra: { reserva_id: String(data.id) }, ip: clientIp(req),
    });

    return NextResponse.json({ ...data, promos: promos.estado }, { status: 201 });
  } catch (error) {
    if (reservaCreadaId) {
      try {
        await supabaseAdmin.from("reservas").delete().eq("id", reservaCreadaId);
      } catch {
        /* best-effort */
      }
    }
    // Sin pago de por medio: si la reserva no quedó, el cupón vuelve.
    if (retencion) await liberarRetencion(retencion.id, "sin_oportunidad_de_pago");
    return failResponse(500, "Error interno del servidor", {
      logContext: "reservas POST",
      error,
    });
  }
}

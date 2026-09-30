import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { filasSlotsReserva } from "@/lib/reservasSlots";
import {
  evaluarPedido, filaReservaWeb, precioDelPedido, prepararReservaWeb, type Fallo,
} from "@/lib/reservasComercial";
import {
  validarCodigoDescuento,
  consumirCodigoDescuento,
} from "@/lib/codigosDescuento";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";

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

// POST: SOLO crea reservas 100% bonificadas (gratis). Con saldo > 0 se exige
// pago online. Precio recalculado server-side; turno reservado con garantía DB.
export async function POST(req: Request) {
  if (!(await rateLimit(`resv-post:${clientIp(req)}`, 10, 60_000))) {
    return tooManyResponse();
  }
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  let reservaCreadaId: number | null = null;
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
    if (veredicto.ocupado) return falloJson(veredicto.ocupado);

    // ── Precio recalculado server-side por SU modalidad (precio especial de la
    // fecha si existe; nunca se confía en el cliente) ──
    const precio = await precioDelPedido(pedido, body);
    if (!precio.ok) return falloJson(precio);
    const totalOriginal = precio.totalOriginal;

    let descuento = 0;
    let codigoValido: string | null = null;
    if (codigo_descuento) {
      const r = await validarCodigoDescuento(codigo_descuento, totalOriginal, fecha, duracion);
      if (!r.valido) {
        return NextResponse.json({ error: r.error || "Código inválido" }, { status: 400 });
      }
      descuento = Math.round(r.descuento || 0);
      codigoValido = r.codigo;
    }

    const totalFinal = Math.max(totalOriginal - descuento, 0);
    if (totalFinal > 0) {
      return NextResponse.json(
        { error: "Esta reserva requiere pago online con Mercado Pago." },
        { status: 400 }
      );
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

    // 3) Consumir el código atómicamente. Si ya no está disponible, revertir.
    if (codigoValido) {
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

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (reservaCreadaId) {
      try {
        await supabaseAdmin.from("reservas").delete().eq("id", reservaCreadaId);
      } catch {
        /* best-effort */
      }
    }
    return failResponse(500, "Error interno del servidor", {
      logContext: "reservas POST",
      error,
    });
  }
}

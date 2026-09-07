import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { reconciliarReserva } from "@/lib/mensualidadesReservaPago";
import { hashTokenResultado, TOKEN_RESULTADO_RE } from "@/lib/mensualidadesReservaMixta";

// Estado público de una reserva mixta, identificada SOLO por su token (M5B).
//
// NO depende de la feature flag: apagar la venta no puede dejar a alguien que ya
// pagó sin poder ver si su turno quedó confirmado.
//
// Los query params que agrega Mercado Pago al volver (collection_status y
// compañía) se IGNORAN por completo: la única verdad es lo que dice la base,
// y si todavía no dice nada, lo que responda Mercado Pago consultado por el
// servidor. El cliente nunca elige un payment_id.

export const dynamic = "force-dynamic";

const COOLDOWN_RECONCILIACION_MS = 15_000;
const sinCache = { "Cache-Control": "no-store, max-age=0" };

type FilaResultado = {
  id: string;
  estado: string;
  external_reference: string;
  minutos_requeridos: number;
  minutos_saldo: number;
  minutos_faltantes: number;
  bloques_30: number;
  bloques_15: number;
  precio_15_snapshot: number | string;
  precio_30_snapshot: number | string;
  importe_bruto: number | string;
  retencion_vence_at: string;
  reconciliado_at: string | null;
  mp_preference_id: string | null;
  reserva_id: number;
  mensualidad_id: string;
};

const COLUMNAS =
  "id, estado, external_reference, minutos_requeridos, minutos_saldo, minutos_faltantes, " +
  "bloques_30, bloques_15, precio_15_snapshot, precio_30_snapshot, importe_bruto, " +
  "retencion_vence_at, reconciliado_at, mp_preference_id, reserva_id, mensualidad_id";

async function leer(tokenHash: string): Promise<FilaResultado | null> {
  const { data } = await supabaseAdmin
    .from("mensualidad_reserva_pagos").select(COLUMNAS).eq("token_hash", tokenHash).maybeSingle();
  return (data ?? null) as FilaResultado | null;
}

// Respuesta idéntica para token mal formado, inexistente o ajeno: no se pueden
// enumerar reservas probando tokens.
const noEncontrado = () =>
  NextResponse.json({ error: "No encontramos esa reserva." }, { status: 404, headers: sinCache });

export async function GET(req: Request) {
  if (!(await rateLimit(`mens-resresult:${clientIp(req)}`, 60, 60_000))) return tooManyResponse();

  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!TOKEN_RESULTADO_RE.test(token)) return noEncontrado();

  try {
    // En la base va el HASH: el token en claro no se guarda en ningún lado.
    const hash = hashTokenResultado(token);
    let fila = await leer(hash);
    if (!fila) return noEncontrado();

    // Si todavía no está resuelto, el SERVIDOR le pregunta a Mercado Pago. Con
    // cooldown para no consultar en cada refresh.
    if (fila.estado === "pendiente" || fila.estado === "rechazado") {
      const ultima = fila.reconciliado_at ? Date.parse(String(fila.reconciliado_at)) : 0;
      if (Date.now() - ultima > COOLDOWN_RECONCILIACION_MS) {
        await supabaseAdmin
          .from("mensualidad_reserva_pagos")
          .update({ reconciliado_at: new Date().toISOString() })
          .eq("id", fila.id);
        await reconciliarReserva(fila.external_reference).catch(() => null);
        const refrescada = await leer(hash);
        if (refrescada) fila = refrescada;
      }
    }

    // Datos del turno. Sin ids internos, sin PII, sin importes financieros
    // internos (comisión y neto son de SIM, no del cliente).
    const { data: reserva } = await supabaseAdmin
      .from("reservas")
      .select("referencia_publica, fecha, hora, duracion_minutos, simuladores, estado")
      .eq("id", fila.reserva_id)
      .maybeSingle();

    const vencida = Date.parse(String(fila.retencion_vence_at)) <= Date.now();
    const estado =
      fila.estado === "aprobado" ? "aprobado"
      : fila.estado === "vencido" ? "vencido"
      : fila.estado === "requiere_revision" ? "en_revision"
      : fila.estado === "rechazado" ? (vencida ? "vencido" : "rechazado")
      : (vencida ? "vencido" : "pendiente");

    // El saldo restante solo se muestra cuando la reserva quedó confirmada.
    let saldoRestante: number | null = null;
    if (estado === "aprobado") {
      const { data: m } = await supabaseAdmin
        .from("mensualidades").select("saldo_minutos").eq("id", fila.mensualidad_id).maybeSingle();
      saldoRestante = m ? Number(m.saldo_minutos) || 0 : null;
    }

    return NextResponse.json({
      estado,
      referencia: reserva?.referencia_publica ?? null,
      fecha: reserva?.fecha ?? null,
      hora: reserva?.hora ?? null,
      duracion: Number(reserva?.duracion_minutos) || null,
      simuladores: Array.isArray(reserva?.simuladores) ? reserva.simuladores.map(String) : [],
      minutos_requeridos: fila.minutos_requeridos,
      minutos_saldo: fila.minutos_saldo,
      minutos_faltantes: fila.minutos_faltantes,
      bloques_30: fila.bloques_30,
      bloques_15: fila.bloques_15,
      precio_15: Number(fila.precio_15_snapshot),
      precio_30: Number(fila.precio_30_snapshot),
      importe: Number(fila.importe_bruto),
      // Solo mientras siga pagable: para saber si conviene reintentar.
      ...(estado === "pendiente" || estado === "rechazado"
        ? { retencion_vence_at: fila.retencion_vence_at }
        : {}),
      ...(saldoRestante !== null ? { saldo_restante: saldoRestante } : {}),
    }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo consultar la reserva.", {
      logContext: "mens-resresult", error,
    });
  }
}

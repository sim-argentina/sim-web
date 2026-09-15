import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { reconciliarCheckout } from "@/lib/campeonatosPago";
import { estadoPublicoCheckout } from "@/lib/campeonatosCheckout";
import { mensajeConfirmacion } from "@/lib/campeonatosMensajes";

// Estado REAL de un intento de inscripción, identificado SOLO por su token opaco.
//
// Los query params que agrega Mercado Pago al volver (collection_status,
// payment_id, preference_id…) se ignoran por completo: son del navegador y se
// pueden escribir a mano. La única verdad es lo que la base dice que se confirmó,
// y esa confirmación la hace el webhook (o esta misma reconciliación) después de
// consultarle el pago a Mercado Pago con credenciales del servidor.

export const dynamic = "force-dynamic";

// Cada cuánto se le puede preguntar a Mercado Pago por este intento.
const COOLDOWN_RECONCILIACION_MS = 10_000;

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

const COLUMNAS =
  "id, campeonato_id, nombre, apellido, telefono, monto, estado, mp_status, " +
  "external_reference, preference_id, expira_el, reconciliado_at";

type CheckoutRow = {
  id: string;
  campeonato_id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  monto: number | string;
  estado: string;
  mp_status: string | null;
  external_reference: string;
  preference_id: string | null;
  expira_el: string;
  reconciliado_at: string | null;
};

async function leerCheckout(token: string): Promise<CheckoutRow | null> {
  const { data } = await supabaseAdmin
    .from("campeonato_checkouts").select(COLUMNAS).eq("token_publico", token).maybeSingle();
  return (data ?? null) as CheckoutRow | null;
}

// Respuesta idéntica para token mal formado, inexistente o ajeno: no se pueden
// enumerar inscripciones probando tokens.
const noEncontrado = () =>
  NextResponse.json({ error: "No encontramos esa inscripción." }, { status: 404 });

export async function GET(req: Request) {
  if (!(await rateLimit(`camp-status:${clientIp(req)}`, 60, 60_000))) return tooManyResponse();

  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!TOKEN_RE.test(token)) return noEncontrado();

  try {
    let chk = await leerCheckout(token);
    if (!chk) return noEncontrado();

    // Carrera normal: el navegador vuelve antes de que llegue el webhook. Acá el
    // SERVIDOR le pregunta a Mercado Pago, con cooldown para no consultar en cada
    // ciclo del polling. Mismo procesador que el webhook: nada duplicado.
    if (chk.estado === "pendiente" && chk.preference_id) {
      const ultima = chk.reconciliado_at ? Date.parse(String(chk.reconciliado_at)) : 0;
      if (Date.now() - ultima > COOLDOWN_RECONCILIACION_MS) {
        await supabaseAdmin
          .from("campeonato_checkouts")
          .update({ reconciliado_at: new Date().toISOString() })
          .eq("id", chk.id);
        await reconciliarCheckout(chk.external_reference).catch(() => null);
        const refrescado = await leerCheckout(token);
        if (refrescado) chk = refrescado;
      }
    }

    const { data: camp } = await supabaseAdmin
      .from("campeonatos")
      .select("nombre, modalidad, fecha_inicio, config")
      .eq("id", chk.campeonato_id)
      .maybeSingle();

    const estado = estadoPublicoCheckout(chk);
    const confirmado = estado === "confirmado";

    // Los datos personales se devuelven SOLO con la inscripción confirmada: antes
    // de eso la pantalla no los necesita.
    return NextResponse.json(
      {
        estado,
        campeonato: camp?.nombre ?? "",
        monto: Number(chk.monto),
        ...(confirmado
          ? {
              nombre: chk.nombre,
              apellido: chk.apellido,
              telefono: chk.telefono,
              mensaje: mensajeConfirmacion(camp ?? {}),
              // Id de conversión estable y sin PII (mismo criterio que /exito).
              transaction_id: chk.external_reference,
            }
          : {}),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    return failResponse(500, "No se pudo consultar la inscripción.", {
      logContext: "camp-inscripcion-status",
      error,
    });
  }
}

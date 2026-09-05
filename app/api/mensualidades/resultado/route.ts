import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { reconciliarCompra } from "@/lib/mensualidadesPago";

// Estado público de una compra, identificada SOLO por su token (Bloque M3).
//
// NO depende de la feature flag: apagar la venta no puede dejar a alguien que ya
// pagó sin poder ver su código. Los query params que agrega Mercado Pago al
// volver (collection_status y compañía) se ignoran por completo: la única verdad
// es lo que la base dice que se aplicó.

export const dynamic = "force-dynamic";

// Cada cuánto se le puede preguntar a Mercado Pago por esta compra.
const COOLDOWN_RECONCILIACION_MS = 15_000;

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

// El proyecto no genera tipos de Supabase, así que la fila se tipa acá.
type CompraResultado = {
  id: string;
  external_reference: string | null;
  procesamiento: string;
  estado_pago: string;
  mp_status: string | null;
  mp_preference_id: string | null;
  reconciliado_at: string | null;
  tipo: string | null;
  plan_nombre: string;
  plan_minutos: number;
  plan_precio: number | string;
  minutos_trasladados: number | null;
  minutos_descartados: number | null;
  saldo_resultante: number | null;
  vence_el: string | null;
  mensualidad_id: string | null;
};

const COLUMNAS =
  "id, external_reference, procesamiento, estado_pago, mp_status, mp_preference_id, " +
  "reconciliado_at, tipo, plan_nombre, plan_minutos, plan_precio, minutos_trasladados, " +
  "minutos_descartados, saldo_resultante, vence_el, mensualidad_id";

async function leerCompra(token: string): Promise<CompraResultado | null> {
  const { data } = await supabaseAdmin
    .from("mensualidad_compras").select(COLUMNAS).eq("token_publico", token).maybeSingle();
  return (data ?? null) as CompraResultado | null;
}
// Respuesta idéntica para token mal formado, inexistente o ajeno: no se puede
// enumerar compras probando tokens.
const noEncontrado = () =>
  NextResponse.json({ error: "No encontramos esa compra." }, { status: 404 });

export async function GET(req: Request) {
  if (!(await rateLimit(`mens-result:${clientIp(req)}`, 60, 60_000))) return tooManyResponse();

  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!TOKEN_RE.test(token)) return noEncontrado();

  try {
    let compra = await leerCompra(token);
    if (!compra) return noEncontrado();

    // Si sigue sin aplicarse, el SERVIDOR le pregunta a Mercado Pago. Con cooldown
    // para no consultar en cada refresh del comprador.
    if (compra.procesamiento !== "aplicado" && compra.mp_preference_id) {
      const ultima = compra.reconciliado_at ? Date.parse(String(compra.reconciliado_at)) : 0;
      if (Date.now() - ultima > COOLDOWN_RECONCILIACION_MS) {
        await supabaseAdmin
          .from("mensualidad_compras")
          .update({ reconciliado_at: new Date().toISOString() })
          .eq("id", compra.id);
        // Mismo procesador que el webhook: la lógica crítica no está duplicada.
        await reconciliarCompra(String(compra.external_reference)).catch(() => null);
        const refrescada = await leerCompra(token);
        if (refrescada) compra = refrescada;
      }
    }

    const aplicada = compra.procesamiento === "aplicado";

    // El código SOLO se revela cuando la base confirma que la compra se aplicó.
    let codigo: string | null = null;
    let saldoActual: number | null = null;
    if (aplicada && compra.mensualidad_id) {
      const { data: m } = await supabaseAdmin
        .from("mensualidades").select("codigo, saldo_minutos").eq("id", compra.mensualidad_id).maybeSingle();
      codigo = m?.codigo ?? null;
      saldoActual = m?.saldo_minutos ?? null;
    }

    const mp = String(compra.mp_status ?? "");
    const estado = aplicada
      ? "aprobado"
      : mp === "rejected" || mp === "cancelled"
        ? "rechazado"
        : "pendiente";

    // Sin PII, sin ids internos, sin movimientos: solo lo que el comprador necesita.
    return NextResponse.json({
      estado,
      plan: compra.plan_nombre,
      precio: Number(compra.plan_precio),
      minutos_plan: compra.plan_minutos,
      ...(aplicada
        ? {
            tipo: compra.tipo,
            codigo,
            saldo_minutos: saldoActual,
            minutos_trasladados: compra.minutos_trasladados,
            minutos_descartados: compra.minutos_descartados,
            vence_el: compra.vence_el,
          }
        : {}),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return failResponse(500, "No se pudo consultar la compra.", {
      logContext: "mens-resultado", error,
    });
  }
}

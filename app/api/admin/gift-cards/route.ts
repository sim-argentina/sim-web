import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin, requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { emitirGiftCardAdmin, validarAltaGiftCard } from "@/lib/giftCardsAdminAlta";

// Listado de Gift Cards para el panel (admin y staff).
export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const codigo = url.searchParams.get("codigo");
    const estado_uso = url.searchParams.get("estado_uso");
    // Archivadas (deleted_at) ocultas por defecto. Solo admin puede pedir verlas.
    const mostrar = url.searchParams.get("mostrar");
    const verArchivadas = auth.role === "admin" && mostrar === "eliminadas";

    // El panel solo muestra Gift Cards efectivamente vendidas (pago aprobado).
    let query = supabaseAdmin
      .from("gift_cards")
      .select("*")
      .eq("estado_pago", "pagado")
      .order("created_at", { ascending: false });

    if (verArchivadas) query = query.not("deleted_at", "is", null);
    else query = query.is("deleted_at", null);

    if (codigo) query = query.ilike("codigo_unico", `%${codigo.trim().toUpperCase()}%`);
    if (estado_uso) query = query.eq("estado_uso", estado_uso);

    const { data, error } = await query;
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/gift-cards", error });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// Emisión manual de una Gift Card desde el panel (sin Mercado Pago).
//
// requireAdmin() rechaza: sin sesión → 401, staff → 403. Staff es de consulta y
// no llega a escribir por ningún camino, arme el request a mano o no: esconder
// el botón no es el control.
//
// El cuerpo NO decide nada sensible. Monto, estado, código, fecha de pago,
// vencimiento, canal y procesador los resuelve el servidor: el navegador manda
// la duración del producto, los datos del comprador y cómo se cobró.
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 4096;

export async function POST(req: Request) {
  // La cookie administrativa es SameSite=strict, así que un POST cruzado ni
  // siquiera la lleva. Esto es la segunda cerradura, no la única.
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const crudo = await req.text();
    if (crudo.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers: sinCache });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(crudo || "{}") as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers: sinCache });
    }

    const validado = validarAltaGiftCard(body);
    if (!validado.ok) {
      return NextResponse.json(
        { error: validado.error, codigo: validado.codigo, campo: validado.campo },
        { status: validado.status, headers: sinCache },
      );
    }

    const r = await emitirGiftCardAdmin(validado.data, { rol: auth.role });
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, codigo: r.codigo },
        { status: r.status, headers: sinCache },
      );
    }

    // Constancia técnica de la escritura, sin PII y sin el código.
    logSecurityEvent("gift_card_alta_admin", {
      rol: auth.role,
      cantidad: r.data.cantidad,
      medio_pago: r.data.medio_pago,
    });

    return NextResponse.json({ ok: true, ...r.data }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo emitir la Gift Card", {
      logContext: "admin/gift-cards POST",
      error,
    });
  }
}

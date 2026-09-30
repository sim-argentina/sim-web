import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { previsualizarAlta, type Modalidad } from "@/lib/mensualidadesAdminAlta";
import { MENSAJE_MENSUALIDADES_ACTUALIZADAS_ADMIN, catalogoParaCrear } from "@/lib/mensualidadesComercial";

// Vista previa del alta administrativa (Bloque M7.4).
//
// Es POST, no GET, a propósito: lleva el teléfono del titular y el teléfono es
// PII. En una URL terminaría en logs de acceso, en el historial y en cualquier
// proxy del camino.
//
// Solo LEE. No crea nada, no toca saldo y no reserva ninguna clave. Lo que
// devuelve es una previsualización calculada en el servidor con los mismos
// helpers que replican la RPC; la verdad la sigue escribiendo la base al
// confirmar, que puede ver un estado distinto si algo cambió en el medio.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 1024;

export async function POST(req: Request) {
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

    // (B6) Mismo 409 que el alta: la vista previa no muestra un precio que ya
    // no es el que se va a cobrar.
    const cat = await catalogoParaCrear(body, { mensaje: MENSAJE_MENSUALIDADES_ACTUALIZADAS_ADMIN });
    if (!cat.ok) {
      return NextResponse.json({ error: cat.error, codigo: cat.codigo }, { status: cat.status, headers: sinCache });
    }

    const r = await previsualizarAlta(
      String(body.telefono ?? ""),
      String(body.plan_slug ?? ""),
      String(body.modalidad ?? "") as Modalidad,
      cat.catalogo,
    );
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, codigo: r.codigo, campo: r.campo },
        { status: r.status, headers: sinCache },
      );
    }
    return NextResponse.json({ ok: true, ...r.data }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo calcular la vista previa", {
      logContext: "admin-mensualidades-alta-previa", error,
    });
  }
}

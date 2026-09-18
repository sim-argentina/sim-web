import { NextResponse } from "next/server";
import { requireAdmin, requireStaffOrAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { cambiarVentasPublicas, getEstadoComercial } from "@/lib/mensualidadesVentas";

// Estado comercial de Mensualidades (Bloque M8A).
//
// GET  → lo pueden LEER admin y staff. Es información operativa: quien atiende
//        necesita saber si el producto se está vendiendo para responder bien.
// POST → solo admin. staff recibe 403 aunque arme el request a mano.
//
// El cuerpo no decide el actor ni el estado anterior: los pone el servidor desde
// la sesión firmada y desde la base. Lo único que llega del navegador es el
// estado deseado (booleano estricto), el motivo y la clave idempotente.
//
// NO depende de MENSUALIDADES_ENABLED: hay que poder preparar y pausar las
// ventas antes de que el módulo sea visible.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 2048;

const malaSolicitud = () =>
  NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers: sinCache });

export async function GET() {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  try {
    const estado = await getEstadoComercial();
    return NextResponse.json(
      // staff ve el estado, pero la pantalla no le ofrece cambiarlo y esta ruta
      // se lo rechaza igual.
      { ...estado, puedeEditar: auth.role === "admin" },
      { headers: sinCache },
    );
  } catch (error) {
    return failResponse(500, "No se pudo leer el estado", {
      logContext: "admin-mensualidades-ventas-get", error,
    });
  }
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const crudo = await req.text();
    if (crudo.length > MAX_BODY_BYTES) return malaSolicitud();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(crudo || "{}") as Record<string, unknown>;
    } catch {
      return malaSolicitud();
    }

    // Booleano ESTRICTO: "true", 1 o "on" no habilitan nada.
    const habilitadas = body.habilitadas;
    if (typeof habilitadas !== "boolean") return malaSolicitud();

    const r = await cambiarVentasPublicas(habilitadas, String(body.motivo ?? ""), {
      // El actor sale de la sesión firmada. El cuerpo no participa.
      actor: auth.role,
      rol: auth.role,
      idempotencyKey: String(body.idempotency_key ?? ""),
    });

    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, codigo: r.codigo },
        { status: r.status, headers: sinCache },
      );
    }

    // Constancia técnica sin motivo ni datos personales: el detalle vive en
    // mensualidad_auditoria.
    logSecurityEvent("mens_admin_ventas", {
      rol: auth.role,
      estado: r.data.estado_nuevo ? 1 : 0,
      idempotente: r.data.idempotente ? 1 : 0,
    });

    return NextResponse.json({ ok: true, ...r.data }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo cambiar el estado de las ventas", {
      logContext: "admin-mensualidades-ventas", error,
    });
  }
}

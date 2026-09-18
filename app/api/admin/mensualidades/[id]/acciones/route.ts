import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import {
  ajustarSaldo, cambiarBloqueo, cambiarTelefono, cancelarReservaAdmin,
  extenderVencimiento, regenerarCodigo, reprogramarReservaAdmin,
} from "@/lib/mensualidadesAdminAcciones";

// ÚNICA puerta de ESCRITURA de la administración de Mensualidades (Bloque M7).
//
// Todas las mutaciones entran por acá y por eso hay un solo `requireAdmin()`
// que las cubre a todas: no existe un segundo camino que se pueda olvidar de
// poner el guard. Staff llega hasta acá con sesión válida y se va con 403,
// aunque arme el request a mano: esconder botones no es el control.
//
// Cada acción exige MOTIVO y CLAVE DE IDEMPOTENCIA. La clave la genera el
// navegador por intento lógico, así un doble clic no aplica dos veces.
//
// El cuerpo nunca trae el actor ni el rol: los pone el servidor desde la sesión
// firmada. Mandarlos en el body no cambia nada.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4096;

const ACCIONES = [
  "extender_vencimiento", "ajustar_saldo", "bloquear", "reactivar",
  "cambiar_telefono", "regenerar_codigo", "cancelar_reserva", "reprogramar_reserva",
] as const;
type Accion = (typeof ACCIONES)[number];

function esAccion(v: unknown): v is Accion {
  return typeof v === "string" && (ACCIONES as readonly string[]).includes(v);
}

const malaSolicitud = () =>
  NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers: sinCache });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // La cookie de administración es SameSite=strict, así que un POST cruzado ni
  // siquiera la lleva. Esto es la segunda cerradura, no la única.
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
    }

    const crudo = await req.text();
    if (crudo.length > MAX_BODY_BYTES) return malaSolicitud();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(crudo || "{}") as Record<string, unknown>;
    } catch {
      return malaSolicitud();
    }

    const accion = body.accion;
    if (!esAccion(accion)) return malaSolicitud();

    const motivo = String(body.motivo ?? "");
    const idempotencyKey = String(body.idempotency_key ?? "");
    // El actor NO se acepta del cuerpo: sale de la sesión firmada.
    const ctx = { actor: auth.role, rol: auth.role, idempotencyKey };

    let r;
    switch (accion) {
      case "extender_vencimiento":
        r = await extenderVencimiento(id, String(body.fecha ?? ""), motivo, ctx);
        break;

      case "ajustar_saldo": {
        const operacion = body.operacion;
        if (operacion !== "agregar" && operacion !== "descontar") return malaSolicitud();
        r = await ajustarSaldo(id, operacion, Number(body.minutos), motivo, ctx);
        break;
      }

      case "bloquear":
        r = await cambiarBloqueo(id, true, motivo, ctx);
        break;

      case "reactivar":
        r = await cambiarBloqueo(id, false, motivo, ctx);
        break;

      case "cambiar_telefono":
        r = await cambiarTelefono(id, String(body.telefono ?? ""), motivo, ctx);
        break;

      case "regenerar_codigo":
        r = await regenerarCodigo(id, motivo, ctx);
        break;

      case "cancelar_reserva":
        r = await cancelarReservaAdmin(id, String(body.referencia ?? ""), motivo, ctx);
        break;

      case "reprogramar_reserva":
        r = await reprogramarReservaAdmin(
          id, String(body.referencia ?? ""), String(body.fecha ?? ""), String(body.hora ?? ""),
          motivo, ctx,
        );
        break;
    }

    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, codigo: r.codigo },
        { status: r.status, headers: sinCache },
      );
    }

    // Queda constancia técnica de que una escritura administrativa ocurrió, sin
    // el motivo, sin el código nuevo y sin el teléfono: eso vive en la auditoría.
    logSecurityEvent("mens_admin_accion", { accion, rol: auth.role });

    return NextResponse.json({ ok: true, ...r.data }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo completar la operación", {
      logContext: "admin-mensualidades-accion", error,
    });
  }
}

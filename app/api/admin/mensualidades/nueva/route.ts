import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { registrarAltaAdministrativa, validarAlta } from "@/lib/mensualidadesAdminAlta";

// Alta y renovación administrativa de una mensualidad (Bloque M7.4).
//
// requireAdmin() rechaza: sin sesión → 401, staff → 403. Staff es de consulta y
// no llega a escribir por ningún camino, arme el request a mano o no: esconder
// el botón no es el control. La RPC vuelve a exigir rol 'admin' por su cuenta.
//
// El cuerpo NO decide nada sensible. Precio, minutos, vencimiento, código,
// comisión y actor los resuelve el servidor: el navegador manda el SLUG del
// plan, los datos del titular, la modalidad y el motivo. Cualquier intento de
// mandar precio, minutos, vencimiento, código, canal, actor o un pago aprobado
// se ignora porque no se lee.
//
// NO depende de MENSUALIDADES_ENABLED: esa bandera controla la exposición
// pública del producto, no la gestión interna.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 4096;

const malaSolicitud = () =>
  NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers: sinCache });

export async function POST(req: Request) {
  // La cookie administrativa es SameSite=strict, así que un POST cruzado ni
  // siquiera la lleva. Esto es la segunda cerradura, no la única.
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

    const validado = validarAlta(body);
    if (!validado.ok) {
      return NextResponse.json(
        { error: validado.error, codigo: validado.codigo, campo: validado.campo },
        { status: validado.status, headers: sinCache },
      );
    }

    // El actor sale de la sesión firmada. El cuerpo no participa.
    const r = await registrarAltaAdministrativa(validado.data, {
      actor: auth.role,
      rol: auth.role,
      idempotencyKey: String(body.idempotency_key ?? ""),
    });

    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, codigo: r.codigo, campo: r.campo },
        { status: r.status, headers: sinCache },
      );
    }

    // Constancia técnica de que hubo una escritura, sin PII y sin el código:
    // el detalle completo vive en mensualidad_auditoria.
    logSecurityEvent("mens_admin_alta", {
      rol: auth.role,
      modalidad: validado.data.modalidad,
      tipo: r.data.tipo,
      idempotente: r.data.idempotente ? 1 : 0,
    });

    return NextResponse.json({ ok: true, ...r.data }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo registrar la mensualidad", {
      logContext: "admin-mensualidades-alta", error,
    });
  }
}

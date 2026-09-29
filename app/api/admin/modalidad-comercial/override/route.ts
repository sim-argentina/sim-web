import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse, logSecurityEvent } from "@/lib/apiError";
import { cambiarOverride, validarPedidoOverride } from "@/lib/modalidadComercial";

// Override de la modalidad comercial (Bloque B0). SOLO ADMIN.
//
// Es el mecanismo de CONTINGENCIA: null vuelve al calendario; "legacy" o
// "v2_10" fuerzan esa modalidad para las operaciones NUEVAS de los flujos que
// lean la modalidad. Nunca reescribe operaciones existentes, pagos ni slots.
//
// Del navegador solo llegan el valor deseado y el motivo. El actor y el rol
// salen de la sesión firmada; la RPC vuelve a exigir rol admin por su cuenta.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 2048;

const malaSolicitud = () =>
  NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers: sinCache });

export async function POST(req: Request) {
  // La cookie administrativa es SameSite=strict: esto es la segunda cerradura.
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const crudo = await req.text();
    if (crudo.length > MAX_BODY_BYTES) return malaSolicitud();
    let body: unknown;
    try {
      body = JSON.parse(crudo || "{}");
    } catch {
      return malaSolicitud();
    }

    const pedido = validarPedidoOverride(body);
    if (!pedido.ok) {
      return NextResponse.json(
        { error: pedido.error, codigo: pedido.codigo },
        { status: pedido.status, headers: sinCache },
      );
    }

    const r = await cambiarOverride(pedido.data, { actor: auth.role, rol: auth.role });
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, codigo: r.codigo },
        { status: r.status, headers: sinCache },
      );
    }

    // Constancia técnica sin el motivo: el motivo queda guardado en la base.
    logSecurityEvent("modalidad_override", {
      rol: auth.role,
      anterior: r.data.override_anterior ?? "null",
      nuevo: r.data.override_nuevo ?? "null",
    });

    return NextResponse.json({ ok: true, ...r.data }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo cambiar la modalidad comercial", {
      logContext: "admin-modalidad-override", error,
    });
  }
}

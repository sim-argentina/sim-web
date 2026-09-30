import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { guardarPrecioEspecial, vistaPreciosEspeciales } from "@/lib/preciosEspeciales";

// Precios especiales de reserva por fecha. ADMIN-ONLY. No expone escritura pública.
//
// (B4) Qué duraciones se editan lo decide la modalidad EFECTIVA, resuelta en el
// servidor en cada request (override > calendario): legacy 15/30, v2_10
// 10/20/30. Guardar solo escribe las columnas de esa modalidad; las de la otra
// se conservan. Un formulario armado con otro catálogo recibe 409 y no escribe.
// Sin caché: el cambio de modalidad se ve en el primer request posterior.
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await vistaPreciosEspeciales(), { headers: sinCache });
  } catch (error) {
    return failResponse(500, "Error cargando precios especiales", { logContext: "precios GET", error });
  }
}

export async function POST(req: Request) {
  // La cookie administrativa es SameSite=strict: esto es la segunda cerradura.
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  try {
    const r = await guardarPrecioEspecial(body, { actor: auth.role });
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, ...(r.codigo ? { codigo: r.codigo } : {}) },
        { status: r.status, headers: sinCache },
      );
    }
    return NextResponse.json({ precio: r.precio }, { status: 201, headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo guardar el precio especial", { logContext: "precios POST", error });
  }
}

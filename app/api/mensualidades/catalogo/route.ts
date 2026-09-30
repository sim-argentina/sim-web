import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { catalogoMensualidadesVigente } from "@/lib/mensualidadesComercial";

// Catálogo público de Mensualidades (Bloque B6): modalidad efectiva, planes con
// su precio VIGENTE (mensualidad_plan_precios), duraciones por reserva y las
// condiciones de esa modalidad. Lo usa el formulario de compra para recargarse
// después de un 409 catalogo_actualizado sin perder los datos personales.
//
// Se resuelve en CADA request: nada se cachea (ni acá, ni en la CDN), así la
// oferta nueva aparece en el primer request posterior al corte. Detrás de la
// flag, igual que la landing: con el módulo oculto no filtra planes ni precios.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  if (!mensualidadesHabilitadas()) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
  }
  if (!(await rateLimit(`mens-cat:${clientIp(req)}`, 120, 60_000))) return tooManyResponse();
  try {
    const c = await catalogoMensualidadesVigente();
    return NextResponse.json({
      modalidad: c.modalidad,
      resuelto_en: c.resuelto_en,
      // Solo lo que la pantalla muestra: nada de ids internos.
      planes: c.planes.map((p) => ({
        slug: p.slug, nombre: p.nombre, minutos: p.minutos, precio: p.precio,
        vigencia_dias: p.vigencia_dias, etiqueta: p.etiqueta,
      })),
      duraciones: c.duraciones,
      condiciones: c.condiciones,
    }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo cargar el catálogo", { logContext: "mens-catalogo", error });
  }
}

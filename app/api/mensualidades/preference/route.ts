import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import {
  validarDatosCompra, tieneMensualidadBloqueada, crearCompraYPreferencia,
} from "@/lib/mensualidadesCompra";

// Inicio de compra de una Mensualidad SIM (Bloque M3).
// Detrás de la feature flag: con la venta apagada la ruta no existe (404), sin
// filtrar planes ni revelar que la función está en construcción.
// El precio SIEMPRE sale de mensualidad_planes; el navegador solo manda el slug.

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

export async function POST(req: Request) {
  // 1) Flag primero: mismo 404 que la página, sin pistas.
  if (!mensualidadesHabilitadas()) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  // 2) Rate limit + origen, igual que el resto de los endpoints públicos mutantes.
  if (!(await rateLimit(`pref-mens:${clientIp(req)}`, 10, 60_000))) return tooManyResponse();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  // 3) Content-Type y tamaño acotados.
  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Formato inválido." }, { status: 415 });
  }
  const crudo = await req.text().catch(() => "");
  if (crudo.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413 });
  }
  let body: unknown;
  try { body = JSON.parse(crudo); } catch {
    return NextResponse.json({ error: "Formato inválido." }, { status: 400 });
  }

  try {
    const v = validarDatosCompra(body);
    if (!v.ok) return NextResponse.json({ error: v.error, campo: v.campo }, { status: v.status });

    // 4) Mensualidad vigente y bloqueada → no se inicia el pago. Mensaje neutral:
    //    nunca se dice el motivo interno ni se confirma qué mensualidad existe.
    if (await tieneMensualidadBloqueada(v.data.telefonoNorm)) {
      return NextResponse.json(
        { error: "No podemos procesar la compra con esos datos. Escribinos y lo resolvemos." },
        { status: 409 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
      return failResponse(500, "El pago no está disponible en este momento.", {
        logContext: "pref-mens baseUrl inválida",
      });
    }

    const r = await crearCompraYPreferencia(v.data, baseUrl);
    if (!r.ok) return NextResponse.json({ error: r.error, campo: r.campo }, { status: r.status });

    // 5) Solo lo imprescindible: a dónde ir a pagar y el token del resultado.
    return NextResponse.json({
      init_point: r.data.init_point,
      token: r.data.token_publico,
      plan: r.data.plan,
      precio: r.data.precio,
    });
  } catch (error) {
    return failResponse(500, "No se pudo iniciar la compra.", { logContext: "pref-mens", error });
  }
}

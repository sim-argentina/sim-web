import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { leerSesion, tokenDeRequest } from "@/lib/mensualidadSesion";
import { huellaCodigo } from "@/lib/mensualidadHuella";
import { validarSeleccion, reservarConSaldo } from "@/lib/mensualidadesReserva";

// Confirmación de una reserva pagada 100% con saldo (Bloque M5A).
//
// Convención de códigos, adaptada a la que ya usa el proyecto:
//   201 creada · 200 replay idempotente · 404 sesión inválida o flag apagada
//   409 la disponibilidad cambió · 422 selección o saldo insuficiente
//   429 rate limit · 400 cuerpo inválido · 415 content-type · 413 cuerpo grande
// (El resto del sitio usa 400 para validación; acá se usa 422 para separar
// "mandaste algo mal" de "lo que pediste ya no se puede", que es lo que el
// front necesita para saber si refrescar la disponibilidad o mostrar el saldo.)

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const sinCache = { "Cache-Control": "no-store, max-age=0" };

const sinSesion = () =>
  NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });

export async function POST(req: Request) {
  // Reservar es un acceso NUEVO: con la venta apagada no existe.
  if (!mensualidadesHabilitadas()) return sinSesion();
  if (!(await rateLimit(`mens-reservar-ip:${clientIp(req)}`, 20, 60_000))) return tooManyResponse();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Formato inválido." }, { status: 415, headers: sinCache });
  }
  const crudo = await req.text().catch(() => "");
  if (crudo.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413, headers: sinCache });
  }

  try {
    const sesion = await leerSesion(tokenDeRequest(req));
    if (!sesion) return sinSesion();

    // Carril por sesión además del de IP: un titular no puede martillar la
    // creación de reservas desde muchas IPs. La clave es una huella no reversible.
    if (!(await rateLimit(`mens-reservar-ses:${huellaCodigo(sesion.sesionId)}`, 12, 60_000))) {
      return tooManyResponse();
    }

    let body: Record<string, unknown>;
    try { body = JSON.parse(crudo) as Record<string, unknown>; } catch {
      return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: sinCache });
    }

    const v = validarSeleccion(body);
    if (!v.ok) {
      // 400 para lo que nunca fue una solicitud válida; 422 para una selección
      // bien formada que no se puede aceptar.
      const status = v.codigo === "idempotency_invalida" ? 400 : 422;
      return NextResponse.json(
        { error: v.error, codigo: v.codigo }, { status, headers: sinCache },
      );
    }

    const r = await reservarConSaldo(sesion.mensualidadId, v.value);
    if (!r.ok) {
      // La mensualidad borrada se responde como sesión inválida, sin revelar más.
      if (r.codigo === "mensualidad_inexistente") return sinSesion();
      return NextResponse.json(
        {
          error: r.error,
          codigo: r.codigo,
          // Solo en saldo insuficiente: lo que M5B va a necesitar para ofrecer
          // el pago de la diferencia. No hay ningún otro dato de la billetera.
          ...(r.saldo !== undefined ? { saldo_minutos: r.saldo } : {}),
          ...(r.faltan !== undefined ? { minutos_faltantes: r.faltan } : {}),
        },
        { status: r.status, headers: sinCache },
      );
    }

    // 200 si es un reintento de la misma clave; 201 si se creó ahora.
    return NextResponse.json(r.data, {
      status: r.data.idempotente ? 200 : 201,
      headers: sinCache,
    });
  } catch (error) {
    // Sin código, teléfono, email ni nombre en el log.
    return failResponse(500, "No pudimos confirmar la reserva. Probá de nuevo.", {
      logContext: "mens-reservar", error,
    });
  }
}

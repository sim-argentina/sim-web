import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { leerSesion, tokenDeRequest } from "@/lib/mensualidadSesion";
import { huellaCodigo } from "@/lib/mensualidadHuella";
import { validarSeleccion } from "@/lib/mensualidadesReserva";
import { reservarConSaldoYPago } from "@/lib/mensualidadesReservaMixta";

// Inicio de una reserva MIXTA: saldo + complemento en Mercado Pago (M5B).
//
// Misma convención de códigos que M5A:
//   201 retención creada · 200 replay idempotente · 404 sesión inválida o flag
//   apagada · 409 disponibilidad cambiada / retención en curso / ya alcanza el
//   saldo · 422 selección inválida o saldo 0 · 429 rate limit · 502 Mercado Pago
//
// La reserva NO queda confirmada acá: nace 'pendiente_pago' con sus slots ya
// tomados y sus minutos ya comprometidos, y se confirma cuando el pago se
// aprueba. El cliente recibe el init_point y el token del resultado.

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const sinCache = { "Cache-Control": "no-store, max-age=0" };

const sinSesion = () =>
  NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });

export async function POST(req: Request) {
  // Empezar a pagar es un acceso NUEVO: con la venta apagada no existe.
  if (!mensualidadesHabilitadas()) return sinSesion();
  if (!(await rateLimit(`mens-mixta-ip:${clientIp(req)}`, 12, 60_000))) return tooManyResponse();
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

    // Carril por sesión además del de IP, con huella no reversible: crear
    // retenciones es caro (bloquea slots) y no puede martillarse rotando IPs.
    if (!(await rateLimit(`mens-mixta-ses:${huellaCodigo(sesion.sesionId)}`, 6, 60_000))) {
      return tooManyResponse();
    }

    let body: Record<string, unknown>;
    try { body = JSON.parse(crudo) as Record<string, unknown>; } catch {
      return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: sinCache });
    }

    // Misma validación de selección que M5A: una sola definición de qué es una
    // selección válida, con la fuente de agenda de M6.
    const v = validarSeleccion(body);
    if (!v.ok) {
      const status = v.codigo === "idempotency_invalida" ? 400 : 422;
      return NextResponse.json({ error: v.error, codigo: v.codigo }, { status, headers: sinCache });
    }

    const r = await reservarConSaldoYPago(sesion.mensualidadId, v.value);
    if (!r.ok) {
      if (r.codigo === "mensualidad_inexistente") return sinSesion();
      return NextResponse.json({ error: r.error, codigo: r.codigo }, { status: r.status, headers: sinCache });
    }

    // DTO mínimo: el desglose que el titular ya vio, el link de pago y el token
    // opaco del resultado. Ni ids internos, ni saldo de la billetera, ni PII.
    return NextResponse.json(r.data, {
      status: r.data.idempotente ? 200 : 201,
      headers: sinCache,
    });
  } catch (error) {
    return failResponse(500, "No pudimos preparar el pago. Probá de nuevo.", {
      logContext: "mens-mixta", error,
    });
  }
}

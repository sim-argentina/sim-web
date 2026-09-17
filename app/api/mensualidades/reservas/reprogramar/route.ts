import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { leerSesion, tokenDeRequest } from "@/lib/mensualidadSesion";
import { huellaCodigo } from "@/lib/mensualidadHuella";
import { reprogramarReserva } from "@/lib/mensualidadesGestionReserva";

// Reprogramación de una reserva hecha con la Mensualidad (Bloque M5C).
//
// Solo cambia fecha y hora. La duración, los simuladores y los minutos ya
// consumidos salen de la reserva existente, no del cuerpo: no hay forma de
// cambiarlos por acá, ni el saldo se mueve.
//
// Solo con 24 h o más de anticipación sobre la reserva ORIGINAL. Con menos, la
// RPC lo rechaza aunque alguien llame directo a la API.
//
// Códigos:
//   200 reprogramada (o sin cambios si ya estaba en ese turno) · 404 sesión
//   inválida, flag apagada o reserva ajena · 409 fuera de plazo / turno ocupado
//   · 422 fecha u horario inválidos · 429 rate limit

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const sinCache = { "Cache-Control": "no-store, max-age=0" };

const sinSesion = () =>
  NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });

export async function POST(req: Request) {
  if (!mensualidadesHabilitadas()) return sinSesion();
  if (!(await rateLimit(`mens-repro-ip:${clientIp(req)}`, 20, 60_000))) return tooManyResponse();
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

    if (!(await rateLimit(`mens-repro-ses:${huellaCodigo(sesion.sesionId)}`, 10, 60_000))) {
      return tooManyResponse();
    }

    let body: Record<string, unknown>;
    try { body = JSON.parse(crudo) as Record<string, unknown>; } catch {
      return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: sinCache });
    }

    const referencia = String(body.referencia ?? "").trim().toUpperCase();
    const fecha = String(body.fecha ?? "");
    const hora = String(body.hora ?? "");
    const idempotencyKey = String(body.idempotency_key ?? "");

    const r = await reprogramarReserva(
      sesion.mensualidadId, referencia, fecha, hora, idempotencyKey,
    );
    if (!r.ok) {
      if (r.codigo === "mensualidad_inexistente") return sinSesion();
      return NextResponse.json({ error: r.error, codigo: r.codigo }, { status: r.status, headers: sinCache });
    }

    return NextResponse.json(r.data, { status: 200, headers: sinCache });
  } catch (error) {
    return failResponse(500, "No pudimos reprogramar la reserva. Probá de nuevo.", {
      logContext: "mens-reprogramar", error,
    });
  }
}

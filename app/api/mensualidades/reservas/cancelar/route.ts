import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { leerSesion, tokenDeRequest } from "@/lib/mensualidadSesion";
import { huellaCodigo } from "@/lib/mensualidadHuella";
import { cancelarReserva } from "@/lib/mensualidadesGestionReserva";

// Cancelación de una reserva hecha con la Mensualidad (Bloque M5C).
//
// Con 24 h o más se restituyen los minutos; con menos, se libera el turno pero
// los minutos se pierden. Quien decide es la RPC, con la hora de Córdoba: el
// navegador solo muestra de antemano lo que va a pasar.
//
// Códigos, con la misma convención de M5A:
//   200 cancelada (o replay idempotente) · 404 sesión inválida, flag apagada o
//   reserva ajena/inexistente · 409 ya no se puede cancelar · 429 rate limit

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const sinCache = { "Cache-Control": "no-store, max-age=0" };

const sinSesion = () =>
  NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });

export async function POST(req: Request) {
  // Gestionar reservas es parte del módulo: con la venta apagada no existe.
  if (!mensualidadesHabilitadas()) return sinSesion();
  if (!(await rateLimit(`mens-cancel-ip:${clientIp(req)}`, 20, 60_000))) return tooManyResponse();
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

    // Carril por sesión además del de IP, con huella no reversible.
    if (!(await rateLimit(`mens-cancel-ses:${huellaCodigo(sesion.sesionId)}`, 10, 60_000))) {
      return tooManyResponse();
    }

    let body: Record<string, unknown>;
    try { body = JSON.parse(crudo) as Record<string, unknown>; } catch {
      return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: sinCache });
    }

    // La reserva se identifica por su REFERENCIA PÚBLICA. El id interno nunca
    // sale ni entra, y la pertenencia la exige la RPC contra la billetera de la
    // sesión: no se confía en nada del cuerpo para autorizar.
    const referencia = String(body.referencia ?? "").trim().toUpperCase();
    const idempotencyKey = String(body.idempotency_key ?? "");

    const r = await cancelarReserva(sesion.mensualidadId, referencia, idempotencyKey);
    if (!r.ok) {
      if (r.codigo === "mensualidad_inexistente") return sinSesion();
      return NextResponse.json({ error: r.error, codigo: r.codigo }, { status: r.status, headers: sinCache });
    }

    return NextResponse.json(r.data, { status: 200, headers: sinCache });
  } catch (error) {
    // Sin código, teléfono, email ni nombre en el log.
    return failResponse(500, "No pudimos cancelar la reserva. Probá de nuevo.", {
      logContext: "mens-cancelar", error,
    });
  }
}

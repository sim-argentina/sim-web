import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent, newRequestId } from "@/lib/apiError";
import { clientIp, rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { autenticarTerminal } from "@/lib/simControlAuth";
import { HEADER_PROTOCOL, HEADER_TERMINAL, PROTOCOL_VERSION } from "@/lib/simControlProtocol";
import { buscarCredencialPorHash, marcarTerminalVista, simControlSyncHabilitado } from "@/lib/simControlServer";

// Handshake de una terminal de SIM Control.
//
// Responde a "¿puedo sincronizar?" SIN enviar ni un dato de la jornada. Lo usa el botón VERIFICAR
// CONEXIÓN de la pantalla de fin de jornada, que el empleado aprieta antes de sincronizar.
//
// Comprueba, en este orden: que la función esté habilitada, que el servidor hable la versión del
// protocolo, que la credencial sirva, y que la terminal siga dada de alta.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const requestId = newRequestId();

  // Apagado por configuración: el endpoint existe pero no atiende. Evita que un deploy futuro lo
  // deje abierto por accidente antes de que la integración esté lista.
  if (!simControlSyncHabilitado()) {
    return NextResponse.json(
      { error: "SIM Control sync no está habilitado", requestId },
      { status: 503, headers: sinCache }
    );
  }

  const ip = clientIp(req);
  if (!(await rateLimit(`simctl:health:${ip}`, 60, 60_000))) {
    return tooManyResponse();
  }

  const protocolo = req.headers.get(HEADER_PROTOCOL);
  if (protocolo !== null && Number(protocolo) !== PROTOCOL_VERSION) {
    return NextResponse.json(
      { error: "Versión de protocolo no soportada", protocolVersion: PROTOCOL_VERSION, requestId },
      { status: 422, headers: sinCache }
    );
  }

  const terminalKey = (req.headers.get(HEADER_TERMINAL) ?? "").trim();

  try {
    const auth = await autenticarTerminal({
      authorization: req.headers.get("authorization"),
      terminalKey,
      buscar: buscarCredencialPorHash,
    });

    if (!auth.ok) {
      // En el log va la terminal y el motivo; nunca el token ni parte de él.
      logSecurityEvent("simctl_health_rechazado", { terminal: terminalKey || "?", motivo: auth.code });

      const status = auth.code === "terminal_disabled" ? 403 : auth.code === "temporarily_unavailable" ? 503 : 401;
      return NextResponse.json(
        { error: auth.code, requestId },
        { status, headers: sinCache }
      );
    }

    await marcarTerminalVista(auth.terminal.id);

    return NextResponse.json(
      {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        serverTimeUtc: new Date().toISOString(),
        terminalId: auth.terminal.terminalKey,
      },
      { headers: sinCache }
    );
  } catch (error) {
    return failResponse(500, "No se pudo completar la verificación", {
      requestId,
      logContext: "sim-control/health",
      error,
    });
  }
}

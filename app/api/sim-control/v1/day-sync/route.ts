import { NextResponse } from "next/server";
import { failResponse, logSecurityEvent, newRequestId } from "@/lib/apiError";
import { clientIp, rateLimit, tooManyResponse } from "@/lib/rateLimit";
import { autenticarTerminal } from "@/lib/simControlAuth";
import { procesarPaquete } from "@/lib/simControlIngest";
import {
  HTTP_POR_CODIGO,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  validarCabeceras,
} from "@/lib/simControlProtocol";
import {
  buscarCredencialPorHash,
  puertoIngestionSupabase,
  simControlSyncHabilitado,
} from "@/lib/simControlServer";

// Recepción del paquete de cierre de jornada de una terminal de SIM Control.
//
// ── Autenticación de MÁQUINA, no de persona ────────────────────────────────────
// Esta ruta NO mira cookies del panel: usa la credencial propia de cada terminal en
// `Authorization: Bearer`. Un admin logueado no puede subir una jornada desde el navegador, y una
// terminal no puede entrar al panel. Son dos mundos separados a propósito.
//
// ── El hash se calcula sobre los BYTES QUE LLEGARON ────────────────────────────
// El cuerpo se lee como TEXTO una sola vez y se hashea ESE texto. Parsear y volver a serializar
// cambiaría espacios y orden de claves, y daría un hash distinto al que calculó la terminal — con
// el agravante de que el error aparecería recién en producción, con una jornada real que ya no se
// puede regenerar.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function POST(req: Request) {
  const requestId = newRequestId();
  const inicio = Date.now();

  if (!simControlSyncHabilitado()) {
    return NextResponse.json(
      { error: "SIM Control sync no está habilitado", requestId },
      { status: 503, headers: sinCache }
    );
  }

  const ip = clientIp(req);
  if (!(await rateLimit(`simctl:sync:${ip}`, 30, 60_000))) {
    return tooManyResponse();
  }

  const tipo = req.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "invalid_payload", detail: "Content-Type debe ser application/json", requestId },
      { status: 400, headers: sinCache }
    );
  }

  // Corte por tamaño antes de leer el cuerpo, si el cliente declaró largo.
  const largoDeclarado = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(largoDeclarado) && largoDeclarado > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "payload_too_large", requestId },
      { status: 413, headers: sinCache }
    );
  }

  const cabeceras = validarCabeceras(req.headers);
  if (!cabeceras.ok) {
    return NextResponse.json(
      { error: cabeceras.code, requestId },
      { status: HTTP_POR_CODIGO[cabeceras.code], headers: sinCache }
    );
  }

  try {
    const auth = await autenticarTerminal({
      authorization: req.headers.get("authorization"),
      terminalKey: cabeceras.terminalKey,
      buscar: buscarCredencialPorHash,
    });

    if (!auth.ok) {
      logSecurityEvent("simctl_sync_rechazado", { terminal: cabeceras.terminalKey, motivo: auth.code });
      const status = auth.code === "terminal_disabled" ? 403 : auth.code === "temporarily_unavailable" ? 503 : 401;
      return NextResponse.json({ error: auth.code, requestId }, { status, headers: sinCache });
    }

    // Una lectura, un texto. Todo lo demás se deriva de acá.
    const cuerpo = await req.text();
    if (Buffer.byteLength(cuerpo, "utf8") > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "payload_too_large", requestId }, { status: 413, headers: sinCache });
    }

    const resultado = await procesarPaquete({
      terminal: auth.terminal,
      cuerpoCrudo: cuerpo,
      hashDeclarado: cabeceras.hashDeclarado,
      puerto: puertoIngestionSupabase(),
    });

    if (!resultado.ok) {
      // Log operativo: terminal, motivo y hash abreviado. Nunca el payload ni la credencial.
      console.warn(
        `[${requestId}] simctl_sync rechazado terminal=${auth.terminal.terminalKey} ` +
          `motivo=${resultado.code} hash=${cabeceras.hashDeclarado.slice(0, 12)} ms=${Date.now() - inicio}`
      );
      return NextResponse.json(
        { error: resultado.code, detail: resultado.motivo, requestId },
        { status: HTTP_POR_CODIGO[resultado.code], headers: sinCache }
      );
    }

    const ack = resultado.ack;
    console.info(
      `[${requestId}] simctl_sync ok terminal=${auth.terminal.terminalKey} ` +
        `package=${ack.packageId} hash=${ack.payloadSha256.slice(0, 12)} ` +
        `status=${ack.status} verificacion=${ack.verificationStatus} ms=${Date.now() - inicio}`
    );

    return NextResponse.json(ack, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo procesar el paquete", {
      requestId,
      logContext: "sim-control/day-sync",
      error,
    });
  }
}

/**
 * GET sobre la misma URL = handshake, igual que `/health`.
 *
 * Existe para que una terminal con un endpoint configurado "plano" (sin la ruta hermana) pueda
 * igual verificar la conexión. NUNCA devuelve datos de jornadas.
 */
export async function GET() {
  if (!simControlSyncHabilitado()) {
    return NextResponse.json({ error: "SIM Control sync no está habilitado" }, { status: 503, headers: sinCache });
  }

  return NextResponse.json(
    { ok: true, protocolVersion: PROTOCOL_VERSION, serverTimeUtc: new Date().toISOString() },
    { headers: sinCache }
  );
}

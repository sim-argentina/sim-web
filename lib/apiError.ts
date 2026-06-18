import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

// Manejo de errores seguro: el cliente recibe un mensaje genérico + requestId;
// el detalle real se loguea server-side (nunca se expone error.message crudo de
// Postgres / Mercado Pago / stack traces).

export function newRequestId(): string {
  return randomUUID();
}

type FailOpts = {
  requestId?: string;
  logContext?: string;
  error?: unknown;
};

export function failResponse(
  status: number,
  publicMessage: string,
  opts: FailOpts = {}
): NextResponse {
  const requestId = opts.requestId ?? randomUUID();
  if (opts.error !== undefined || opts.logContext) {
    const detail =
      opts.error instanceof Error
        ? `${opts.error.name}: ${opts.error.message}`
        : opts.error !== undefined
        ? String(opts.error)
        : "";
    console.error(
      `[${requestId}] ${opts.logContext ?? "error"}${detail ? " :: " + detail : ""}`
    );
  }
  return NextResponse.json({ error: publicMessage, requestId }, { status });
}

// Log estructurado mínimo de eventos de seguridad (sin PII sensible).
export function logSecurityEvent(
  event: string,
  data: Record<string, string | number | undefined> = {}
): void {
  const parts = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.warn(`[sec] ${event} ${parts}`.trim());
}

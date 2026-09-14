import { esHashValido } from "@/lib/simControlHash";

// Contrato del protocolo de sincronización de jornada, versión 1.
//
// Este archivo es el espejo TypeScript de lo que SIM Control genera en C#
// (`DayPackageBuilder` / `DayPackagePayload`). Los fixtures de
// `tests/contracts/day-sync-v1/` existen justamente para que los dos lados no se
// separen sin que nadie se entere.
//
// Módulo PURO: valida formas, no toca la base ni la red.

export const PROTOCOL_VERSION = 1;
export const SCHEMA_VERSION = "simcontrol.day-closure.v1";

/** Tope del cuerpo aceptado. Una jornada real de una terminal son unos pocos KB. */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

export const HEADER_TERMINAL = "x-simcontrol-terminal-id";
export const HEADER_HASH = "x-simcontrol-payload-sha256";
export const HEADER_PROTOCOL = "x-simcontrol-protocol-version";
export const HEADER_IDEMPOTENCY = "idempotency-key";

/** Estado de ingestión del paquete. */
export type PackageStatus =
  | "received"
  | "data_verified"
  | "verified"
  | "reconciliation_pending"
  | "mismatch";

/** Lo que el ACK le informa a la terminal. `rejected` no llega a persistirse. */
export type VerificationStatus = PackageStatus | "rejected";

/** Códigos de error del contrato. La terminal mapea por CÓDIGO, nunca por el texto. */
export type ApiErrorCode =
  | "invalid_payload"
  | "unauthorized"
  | "terminal_disabled"
  | "package_hash_conflict"
  | "payload_too_large"
  | "unsupported_protocol"
  | "entity_conflict"
  | "internal_error"
  | "temporarily_unavailable";

export const HTTP_POR_CODIGO: Record<ApiErrorCode, number> = {
  invalid_payload: 400,
  unauthorized: 401,
  terminal_disabled: 403,
  package_hash_conflict: 409,
  payload_too_large: 413,
  unsupported_protocol: 422,
  entity_conflict: 422,
  internal_error: 500,
  temporarily_unavailable: 503,
};

// ── Forma del payload ───────────────────────────────────────────────────────────

export type PayloadSession = {
  sessionId: string;
  sessionType: string;
  status: string;
  billable: boolean;
  countsForReconciliation: boolean;
  baseDurationMinutes: number;
  extensionMinutesTotal: number;
  authorizedDurationMinutes: number;
  actualCommercialSeconds: number;
  startedAtUtc: string;
  activeStartedAtUtc: string | null;
  finishedAtUtc: string | null;
  openedByOperatorId: string | null;
  openedByDisplayName: string | null;
  restartOfSessionId: string | null;
  replacedBySessionId: string | null;
  resetCount: number;
};

export type PayloadIntervention = {
  interventionId: string;
  sessionId: string;
  type: string;
  reasonCode: string;
  reasonText: string | null;
  minutesAdded: number | null;
  operatorId: string;
  operatorDisplayName: string;
  createdAtUtc: string;
};

export type PayloadPerformance = {
  sessionId: string;
  sessionKind: string | null;
  circuit: string | null;
  lapsCompleted: number | null;
  bestLapMs: number | null;
  bestValidLapMs: number | null;
  finishingPosition: number | null;
  result: string | null;
  timeUsedSeconds: number | null;
  isDemoData: boolean;
};

export type PayloadTotals = {
  reconcilableSessions: number;
  nonReconcilableSessions: number;
  maintenanceSessions: number;
  restartedIncidentSessions: number;
  interventions: number;
  extensionMinutesTotal: number;
  reconcilableMinutesTotal: number;
};

export type DayPackagePayload = {
  schemaVersion: string;
  protocolVersion: number;
  packageId: string;
  terminalId: string;
  businessDate: string;
  sequence: number;
  closureId: string;
  periodStartUtc: string;
  periodEndUtc: string;
  generatedAtUtc: string;
  totals: PayloadTotals;
  sessions: PayloadSession[];
  interventions: PayloadIntervention[];
  /** Agregado en M7. Un paquete de una versión anterior puede no traerlo. */
  performance?: PayloadPerformance[];
};

export type ValidacionPayload =
  | { ok: true; payload: DayPackagePayload }
  | { ok: false; code: ApiErrorCode; motivo: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function esEntero(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function esEnteroNoNegativo(v: unknown): v is number {
  return esEntero(v) && v >= 0;
}

function esUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function esUuidOpcional(v: unknown): boolean {
  return v === null || v === undefined || esUuid(v);
}

function esTextoOpcional(v: unknown): boolean {
  return v === null || v === undefined || typeof v === "string";
}

function esEnteroOpcional(v: unknown): boolean {
  return v === null || v === undefined || esEntero(v);
}

/**
 * Valida la forma del payload.
 *
 * Deliberadamente estricto con lo que la conciliación usa (ids, minutos, banderas)
 * y tolerante con lo que solo es descriptivo: agregar un campo nuevo opcional en
 * una versión futura no puede romper la ingestión de un paquete viejo, que es lo
 * que pide la compatibilidad hacia adelante.
 */
export function validarPayload(raw: unknown): ValidacionPayload {
  if (!esObjeto(raw)) {
    return { ok: false, code: "invalid_payload", motivo: "el cuerpo no es un objeto JSON" };
  }

  if (!esEntero(raw.protocolVersion)) {
    return { ok: false, code: "unsupported_protocol", motivo: "falta protocolVersion" };
  }

  if (raw.protocolVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "unsupported_protocol",
      motivo: `protocolVersion ${raw.protocolVersion} no soportada`,
    };
  }

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, code: "unsupported_protocol", motivo: "schemaVersion desconocida" };
  }

  if (!esUuid(raw.packageId)) return fallo("packageId inválido");
  if (!esUuid(raw.closureId)) return fallo("closureId inválido");
  if (typeof raw.terminalId !== "string" || !raw.terminalId.trim()) return fallo("terminalId vacío");
  if (typeof raw.businessDate !== "string" || !FECHA_RE.test(raw.businessDate)) return fallo("businessDate inválida");
  if (!esEntero(raw.sequence) || raw.sequence < 1) return fallo("sequence inválida");

  for (const campo of ["periodStartUtc", "periodEndUtc", "generatedAtUtc"] as const) {
    if (typeof raw[campo] !== "string" || Number.isNaN(Date.parse(raw[campo] as string))) {
      return fallo(`${campo} inválido`);
    }
  }

  if (!esObjeto(raw.totals)) return fallo("faltan totals");
  for (const campo of [
    "reconcilableSessions",
    "nonReconcilableSessions",
    "maintenanceSessions",
    "restartedIncidentSessions",
    "interventions",
    "extensionMinutesTotal",
    "reconcilableMinutesTotal",
  ] as const) {
    if (!esEnteroNoNegativo(raw.totals[campo])) return fallo(`totals.${campo} inválido`);
  }

  if (!Array.isArray(raw.sessions)) return fallo("sessions no es una lista");
  if (!Array.isArray(raw.interventions)) return fallo("interventions no es una lista");
  if (raw.performance !== undefined && !Array.isArray(raw.performance)) {
    return fallo("performance no es una lista");
  }

  const idsDeSesion = new Set<string>();
  for (const s of raw.sessions) {
    if (!esObjeto(s)) return fallo("una sesión no es un objeto");
    if (!esUuid(s.sessionId)) return fallo("sessionId inválido");
    if (idsDeSesion.has(s.sessionId)) return fallo(`sessionId repetido: ${s.sessionId}`);
    idsDeSesion.add(s.sessionId);

    if (typeof s.sessionType !== "string" || !s.sessionType) return fallo("sessionType inválido");
    if (typeof s.status !== "string" || !s.status) return fallo("status de sesión inválido");
    if (typeof s.billable !== "boolean") return fallo("billable inválido");
    // El campo AUTORITATIVO de la conciliación: si no viene bien tipado, no se ingiere.
    if (typeof s.countsForReconciliation !== "boolean") return fallo("countsForReconciliation inválido");
    if (!esEnteroNoNegativo(s.authorizedDurationMinutes)) return fallo("authorizedDurationMinutes inválido");
    if (!esEnteroNoNegativo(s.baseDurationMinutes)) return fallo("baseDurationMinutes inválido");
    if (!esEnteroNoNegativo(s.extensionMinutesTotal)) return fallo("extensionMinutesTotal inválido");
    if (!esUuidOpcional(s.openedByOperatorId)) return fallo("openedByOperatorId inválido");
    if (!esUuidOpcional(s.restartOfSessionId)) return fallo("restartOfSessionId inválido");
    if (!esUuidOpcional(s.replacedBySessionId)) return fallo("replacedBySessionId inválido");
  }

  const idsDeIntervencion = new Set<string>();
  for (const i of raw.interventions) {
    if (!esObjeto(i)) return fallo("una intervención no es un objeto");
    if (!esUuid(i.interventionId)) return fallo("interventionId inválido");
    if (idsDeIntervencion.has(i.interventionId)) return fallo(`interventionId repetido: ${i.interventionId}`);
    idsDeIntervencion.add(i.interventionId);

    if (!esUuid(i.sessionId)) return fallo("sessionId de intervención inválido");
    // Una intervención siempre pertenece a una sesión del MISMO paquete.
    if (!idsDeSesion.has(i.sessionId)) return fallo("intervención de una sesión que no viaja en el paquete");
    if (typeof i.type !== "string" || !i.type) return fallo("type de intervención inválido");
    if (typeof i.reasonCode !== "string" || !i.reasonCode) return fallo("reasonCode inválido");
    if (!esTextoOpcional(i.reasonText)) return fallo("reasonText inválido");
    if (!esEnteroOpcional(i.minutesAdded)) return fallo("minutesAdded inválido");
  }

  for (const p of (raw.performance ?? []) as unknown[]) {
    if (!esObjeto(p)) return fallo("un performance no es un objeto");
    if (!esUuid(p.sessionId)) return fallo("sessionId de performance inválido");
    if (!idsDeSesion.has(p.sessionId)) return fallo("performance de una sesión que no viaja en el paquete");
    if (typeof p.isDemoData !== "boolean") return fallo("isDemoData inválido");
    for (const campo of ["lapsCompleted", "bestLapMs", "bestValidLapMs", "finishingPosition", "timeUsedSeconds"] as const) {
      if (!esEnteroOpcional(p[campo])) return fallo(`performance.${campo} inválido`);
    }
  }

  return { ok: true, payload: raw as unknown as DayPackagePayload };
}

function fallo(motivo: string): ValidacionPayload {
  return { ok: false, code: "invalid_payload", motivo };
}

// ── Cabeceras ───────────────────────────────────────────────────────────────────

export type ValidacionCabeceras =
  | { ok: true; terminalKey: string; hashDeclarado: string; idempotencyKey: string | null }
  | { ok: false; code: ApiErrorCode; motivo: string };

export function validarCabeceras(headers: Headers): ValidacionCabeceras {
  const protocolo = headers.get(HEADER_PROTOCOL);
  if (protocolo !== null && Number(protocolo) !== PROTOCOL_VERSION) {
    return { ok: false, code: "unsupported_protocol", motivo: "versión de protocolo no soportada" };
  }

  const terminalKey = (headers.get(HEADER_TERMINAL) ?? "").trim();
  if (!terminalKey) {
    return { ok: false, code: "unauthorized", motivo: "falta la terminal" };
  }

  const hashDeclarado = (headers.get(HEADER_HASH) ?? "").trim().toLowerCase();
  if (!esHashValido(hashDeclarado)) {
    return { ok: false, code: "invalid_payload", motivo: "falta o es inválido el hash declarado" };
  }

  return {
    ok: true,
    terminalKey,
    hashDeclarado,
    idempotencyKey: headers.get(HEADER_IDEMPOTENCY),
  };
}

// ── ACK ─────────────────────────────────────────────────────────────────────────

export type DaySyncAck = {
  protocolVersion: number;
  packageId: string;
  payloadSha256: string;
  terminalId: string;
  receivedAtUtc: string;
  status: "accepted" | "already_processed";
  receiptId: string;
  verificationStatus: VerificationStatus;
  reconciliationSummary?: string;
};

/**
 * Arma el ACK.
 *
 * La terminal valida packageId, hash, terminal y versión antes de creerle, y solo
 * cierra la jornada con `verificationStatus: "verified"`. Un 200 con cuerpo vacío
 * no le sirve de nada — por diseño.
 */
export function construirAck(args: {
  packageId: string;
  payloadSha256: string;
  terminalId: string;
  receivedAtUtc: string;
  yaProcesado: boolean;
  receiptId: string;
  verificationStatus: VerificationStatus;
  reconciliationSummary?: string | null;
}): DaySyncAck {
  const ack: DaySyncAck = {
    protocolVersion: PROTOCOL_VERSION,
    packageId: args.packageId,
    payloadSha256: args.payloadSha256,
    terminalId: args.terminalId,
    receivedAtUtc: args.receivedAtUtc,
    status: args.yaProcesado ? "already_processed" : "accepted",
    receiptId: args.receiptId,
    verificationStatus: args.verificationStatus,
  };

  if (args.reconciliationSummary) {
    ack.reconciliationSummary = args.reconciliationSummary;
  }

  return ack;
}

/** Estado que le corresponde a un paquete según cómo cerró la conciliación de su fecha. */
export function estadoDePaquete(estadoConciliacion: "pending" | "verified" | "mismatch"): PackageStatus {
  if (estadoConciliacion === "verified") return "verified";
  if (estadoConciliacion === "mismatch") return "mismatch";
  return "reconciliation_pending";
}

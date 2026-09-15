import { sha256Hex, hashesIguales } from "@/lib/simControlHash";
import {
  construirAck,
  validarPayload,
  MAX_PAYLOAD_BYTES,
  type ApiErrorCode,
  type DayPackagePayload,
  type DaySyncAck,
  type PackageStatus,
} from "@/lib/simControlProtocol";
import {
  conciliarCierre,
  estadoDePaqueteTrasCorrida,
  type FilaReservaConciliable,
  type FilaStandConciliable,
  type ResultadoConciliacion,
  type SesionConciliable,
} from "@/lib/simControlReconciliation";
import type { TerminalAutenticada } from "@/lib/simControlAuth";

// Orquestación de la ingestión de un paquete de jornada.
//
// La escritura atómica vive en la función de Postgres `sim_control_ingest_package` (PostgREST no
// expone transacciones al cliente). Acá está lo que la rodea: validar, calcular hashes, decidir qué
// conflicto es cuál, y volver a conciliar la fecha después de guardar.
//
// El acceso a datos entra por un puerto para poder testear TODO el flujo —incluidos el ACK perdido,
// el conflicto de hash y la reevaluación— sin tocar Supabase.

export type ResultadoRpcIngest =
  | { outcome: "inserted"; receiptId: string; status: PackageStatus }
  | { outcome: "already_processed"; receiptId: string; status: PackageStatus }
  | { outcome: "hash_conflict"; receiptId: string; status: PackageStatus }
  | { outcome: "entity_conflict"; entityType: string; localEntityId: string };

export type PaqueteAEvaluar = {
  packageId: string;
  cutoffUtc: string;
  status: PackageStatus;
  receiptId: string;
};

export type EntidadParaIdempotencia = {
  entityType: "session" | "intervention" | "performance";
  localEntityId: string;
  contentSha256: string;
};

/** Todo lo que la ingestión necesita de la base. Se implementa con Supabase en el route handler. */
export type PuertoIngestion = {
  ingestar(args: {
    terminalId: string;
    payload: DayPackagePayload;
    meta: { payloadSha256: string; payloadBytes: number; receiptId: string; entities: EntidadParaIdempotencia[] };
  }): Promise<ResultadoRpcIngest>;

  actividadCentral(businessDate: string): Promise<{
    stand: FilaStandConciliable[];
    reservas: FilaReservaConciliable[];
  }>;

  sesionesDeLaFecha(businessDate: string): Promise<SesionConciliable[]>;

  /** Paquetes de la fecha que todavía no están verificados: hay que reevaluarlos. */
  paquetesAEvaluar(businessDate: string): Promise<PaqueteAEvaluar[]>;

  registrarConciliacion(args: {
    businessDate: string;
    cutoffUtc: string;
    resultado: ResultadoConciliacion;
  }): Promise<void>;

  estadoDePaquete(packageId: string): Promise<{ status: PackageStatus; receiptId: string } | null>;

  marcarCredencialUsada(credentialId: string): Promise<void>;
};

export type ResultadoIngestion =
  | { ok: true; ack: DaySyncAck; httpStatus: 200 }
  | { ok: false; code: ApiErrorCode; motivo: string };

/**
 * Identificador central del comprobante. Estable por paquete: el mismo PackageId produce siempre el
 * mismo receipt, así un reintento devuelve el comprobante que ya existía en vez de uno nuevo.
 */
export function receiptIdDe(packageId: string): string {
  return `rcpt_${packageId.replace(/-/g, "")}`;
}

/**
 * Hash del contenido de una entidad, para detectar que la MISMA entidad vuelva con datos distintos.
 *
 * Se ordenan las claves antes de serializar: dos representaciones equivalentes tienen que dar el
 * mismo hash, o un reenvío legítimo parecería una reescritura de la historia.
 */
export function hashDeEntidad(entidad: Record<string, unknown>): string {
  return sha256Hex(JSON.stringify(entidad, Object.keys(entidad).sort()));
}

function entidadesDe(payload: DayPackagePayload): EntidadParaIdempotencia[] {
  const entidades: EntidadParaIdempotencia[] = [];

  for (const s of payload.sessions) {
    entidades.push({ entityType: "session", localEntityId: s.sessionId, contentSha256: hashDeEntidad(s) });
  }
  for (const i of payload.interventions) {
    entidades.push({ entityType: "intervention", localEntityId: i.interventionId, contentSha256: hashDeEntidad(i) });
  }
  for (const p of payload.performance ?? []) {
    entidades.push({ entityType: "performance", localEntityId: p.sessionId, contentSha256: hashDeEntidad(p) });
  }

  return entidades;
}

/**
 * Procesa un paquete de punta a punta.
 *
 * `cuerpoCrudo` es el TEXTO tal como llegó. El hash se calcula sobre esos bytes y nunca sobre un
 * JSON re-serializado: parsear y volver a serializar cambia espacios y orden de claves, y daría un
 * hash distinto al que calculó la terminal.
 */
export async function procesarPaquete(args: {
  terminal: TerminalAutenticada;
  cuerpoCrudo: string;
  hashDeclarado: string;
  puerto: PuertoIngestion;
  ahoraUtc?: string;
}): Promise<ResultadoIngestion> {
  const { terminal, cuerpoCrudo, hashDeclarado, puerto } = args;
  const ahora = args.ahoraUtc ?? new Date().toISOString();

  const bytes = Buffer.byteLength(cuerpoCrudo, "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) {
    return { ok: false, code: "payload_too_large", motivo: `cuerpo de ${bytes} bytes` };
  }

  // El hash de lo que REALMENTE llegó.
  const hashReal = sha256Hex(cuerpoCrudo);
  if (!hashesIguales(hashReal, hashDeclarado)) {
    return { ok: false, code: "invalid_payload", motivo: "el hash declarado no coincide con el cuerpo" };
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(cuerpoCrudo);
  } catch {
    return { ok: false, code: "invalid_payload", motivo: "el cuerpo no es JSON válido" };
  }

  const validacion = validarPayload(crudo);
  if (!validacion.ok) {
    return { ok: false, code: validacion.code, motivo: validacion.motivo };
  }

  const payload = validacion.payload;

  // La terminal autenticada tiene que ser la del payload. Si no, alguien está subiendo la jornada
  // de otra máquina con su propia credencial.
  if (payload.terminalId !== terminal.terminalKey) {
    return { ok: false, code: "unauthorized", motivo: "el paquete es de otra terminal" };
  }

  const receiptId = receiptIdDe(payload.packageId);

  const resultado = await puerto.ingestar({
    terminalId: terminal.id,
    payload,
    meta: { payloadSha256: hashReal, payloadBytes: bytes, receiptId, entities: entidadesDe(payload) },
  });

  if (resultado.outcome === "hash_conflict") {
    // Mismo PackageId con otro contenido. Nunca se sobrescribe el original.
    return { ok: false, code: "package_hash_conflict", motivo: "el paquete ya existe con otro contenido" };
  }

  if (resultado.outcome === "entity_conflict") {
    return {
      ok: false,
      code: "entity_conflict",
      motivo: `la entidad ${resultado.entityType} ${resultado.localEntityId} ya existe con otro contenido`,
    };
  }

  await puerto.marcarCredencialUsada(terminal.credentialId);

  // Reevaluar la fecha: puede haber cierres anteriores que ESTE paquete completa.
  const corridas = await reevaluarFecha({ businessDate: payload.businessDate, puerto });

  const estadoFinal = (await puerto.estadoDePaquete(payload.packageId)) ?? {
    status: resultado.status,
    receiptId,
  };

  // El resumen que viaja en el ACK es el de ESTE cierre, no el de la fecha entera.
  const propia = corridas.get(payload.periodEndUtc);

  return {
    ok: true,
    httpStatus: 200,
    ack: construirAck({
      packageId: payload.packageId,
      payloadSha256: hashReal,
      terminalId: terminal.terminalKey,
      receivedAtUtc: ahora,
      yaProcesado: resultado.outcome === "already_processed",
      receiptId: estadoFinal.receiptId,
      verificationStatus: estadoFinal.status,
      reconciliationSummary: propia?.resumen ?? null,
    }),
  };
}

/**
 * Vuelve a conciliar TODOS los cierres no verificados de una fecha, cada uno contra SU corte.
 *
 * Es lo que hace que un paquete que llega tarde pueda completar a uno anterior: si T2 sincroniza a
 * las 19:10 una sesión de las 18:40, el cierre de las 19:00 —que estaba `pending`— pasa a
 * `verified`. Y al revés, un paquete nuevo NUNCA altera a uno ya verificado.
 *
 * También es el camino del reintento: reevaluar no reinserta nada, solo recalcula.
 */
export async function reevaluarFecha(args: {
  businessDate: string;
  puerto: PuertoIngestion;
}): Promise<Map<string, ResultadoConciliacion>> {
  const { businessDate, puerto } = args;
  const corridas = new Map<string, ResultadoConciliacion>();

  const pendientes = await puerto.paquetesAEvaluar(businessDate);
  if (pendientes.length === 0) {
    return corridas;
  }

  // Se leen una sola vez y se reutilizan para todos los cortes de la fecha.
  const [{ stand, reservas }, sesiones] = await Promise.all([
    puerto.actividadCentral(businessDate),
    puerto.sesionesDeLaFecha(businessDate),
  ]);

  for (const paquete of pendientes) {
    const resultado = conciliarCierre({
      businessDate,
      cierreUtc: paquete.cutoffUtc,
      stand,
      reservas,
      sesiones,
    });

    corridas.set(paquete.cutoffUtc, resultado);
    await puerto.registrarConciliacion({ businessDate, cutoffUtc: paquete.cutoffUtc, resultado });
  }

  return corridas;
}

/** Estado que le corresponde a un paquete tras una corrida. Reexportado para las rutas y los tests. */
export { estadoDePaqueteTrasCorrida };

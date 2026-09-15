import { strict as assert } from "node:assert";
import { autenticarTerminal, type CredencialCentral } from "@/lib/simControlAuth";
import { generarCredencial, hashearToken } from "@/lib/simControlCredentials";
import { sha256Hex } from "@/lib/simControlHash";
import {
  hashDeEntidad,
  procesarPaquete,
  receiptIdDe,
  reevaluarFecha,
  type PaqueteAEvaluar,
  type PuertoIngestion,
  type ResultadoRpcIngest,
} from "@/lib/simControlIngest";
import {
  estadoDePaqueteTrasCorrida,
  type FilaStandConciliable,
  type SesionConciliable,
} from "@/lib/simControlReconciliation";
import type { DayPackagePayload, PackageStatus } from "@/lib/simControlProtocol";
import { PROTOCOL_VERSION, SCHEMA_VERSION } from "@/lib/simControlProtocol";

// Ejecutar: npx tsx lib/simControlIngest.test.ts
//
// Ingestión de punta a punta contra una base FALSA que reproduce la semántica de la real: claves
// primarias, índices únicos por entidad, y el estado pegajoso de `verified`.
//
// No toca Supabase. Los casos que importan —ACK perdido, conflicto de hash, entidad incompatible,
// paquete tardío que completa a uno anterior— son justamente los que no se pueden probar en vivo.

process.env.SIM_CONTROL_CREDENTIAL_PEPPER = "pepper-de-pruebas-con-mas-de-32-caracteres";

const FECHA = "2026-09-13";
const CIERRE_P1 = "2026-09-13T22:00:00.000Z"; // 19:00 local
const CIERRE_P2 = "2026-09-14T01:00:00.000Z"; // 22:00 local
const TERMINAL = { id: "term-uuid-1", terminalKey: "sim-01", displayName: "Cabina 1", credentialId: "cred-1" };

// ── Base falsa ──────────────────────────────────────────────────────────────────

type FilaPaquete = {
  packageId: string;
  terminalId: string;
  businessDate: string;
  cutoffUtc: string;
  payloadSha256: string;
  status: PackageStatus;
  receiptId: string;
  verifiedAt: string | null;
};

class BaseFalsa {
  paquetes = new Map<string, FilaPaquete>();
  entidades = new Map<string, { contentSha256: string; firstPackageId: string }>();
  sesiones: SesionConciliable[] = [];
  stand: FilaStandConciliable[] = [];
  corridas: { businessDate: string; cutoffUtc: string; status: string }[] = [];
  credencialesUsadas: string[] = [];
  /** Simula un fallo al insertar entidades, para probar el rollback. */
  fallarAlInsertar = false;

  private clave(terminalId: string, tipo: string, id: string) {
    return `${terminalId}|${tipo}|${id}`;
  }

  puerto(): PuertoIngestion {
    return {
      ingestar: async ({ terminalId, payload, meta }): Promise<ResultadoRpcIngest> => {
        const existente = this.paquetes.get(payload.packageId);
        if (existente) {
          if (existente.payloadSha256 !== meta.payloadSha256) {
            return { outcome: "hash_conflict", receiptId: existente.receiptId, status: existente.status };
          }
          return { outcome: "already_processed", receiptId: existente.receiptId, status: existente.status };
        }

        // Entidad ya conocida con OTRO contenido: se rechaza el paquete entero.
        for (const e of meta.entities) {
          const previa = this.entidades.get(this.clave(terminalId, e.entityType, e.localEntityId));
          if (previa && previa.contentSha256 !== e.contentSha256) {
            return { outcome: "entity_conflict", entityType: e.entityType, localEntityId: e.localEntityId };
          }
        }

        // Todo o nada: se prepara en memoria y recién al final se aplica.
        if (this.fallarAlInsertar) {
          throw new Error("fallo simulado al insertar entidades");
        }

        this.paquetes.set(payload.packageId, {
          packageId: payload.packageId,
          terminalId,
          businessDate: payload.businessDate,
          cutoffUtc: payload.periodEndUtc,
          payloadSha256: meta.payloadSha256,
          status: "data_verified",
          receiptId: meta.receiptId,
          verifiedAt: null,
        });

        for (const s of payload.sessions) {
          const k = this.clave(terminalId, "session", s.sessionId);
          if (!this.entidades.has(k)) {
            this.sesiones.push({
              terminal_key: payload.terminalId,
              local_session_id: s.sessionId,
              counts_for_reconciliation: s.countsForReconciliation,
              authorized_duration_minutes: s.authorizedDurationMinutes,
              session_type: s.sessionType,
              status: s.status,
              started_at_utc: s.startedAtUtc,
              finished_at_utc: s.finishedAtUtc,
            });
          }
        }

        for (const e of meta.entities) {
          const k = this.clave(terminalId, e.entityType, e.localEntityId);
          if (!this.entidades.has(k)) {
            this.entidades.set(k, { contentSha256: e.contentSha256, firstPackageId: payload.packageId });
          }
        }

        return { outcome: "inserted", receiptId: meta.receiptId, status: "data_verified" };
      },

      actividadCentral: async () => ({ stand: this.stand, reservas: [] }),

      sesionesDeLaFecha: async (businessDate) =>
        this.sesiones.filter(() => businessDate === FECHA),

      paquetesAEvaluar: async (businessDate): Promise<PaqueteAEvaluar[]> =>
        [...this.paquetes.values()]
          .filter((p) => p.businessDate === businessDate && p.status !== "verified")
          .map((p) => ({ packageId: p.packageId, cutoffUtc: p.cutoffUtc, status: p.status, receiptId: p.receiptId })),

      registrarConciliacion: async ({ businessDate, cutoffUtc, resultado }) => {
        this.corridas.push({ businessDate, cutoffUtc, status: resultado.estado });
        for (const p of this.paquetes.values()) {
          if (p.businessDate !== businessDate || p.cutoffUtc !== cutoffUtc) continue;
          // El estado pegajoso: un verificado no vuelve atrás.
          const nuevo = estadoDePaqueteTrasCorrida(p.status, resultado.estado);
          p.status = nuevo;
          if (nuevo === "verified" && !p.verifiedAt) p.verifiedAt = "2026-09-13T22:05:00.000Z";
        }
      },

      estadoDePaquete: async (packageId) => {
        const p = this.paquetes.get(packageId);
        return p ? { status: p.status, receiptId: p.receiptId } : null;
      },

      marcarCredencialUsada: async (credentialId) => {
        this.credencialesUsadas.push(credentialId);
      },
    };
  }
}

// ── Constructor de payloads ─────────────────────────────────────────────────────

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function payloadDe(args: {
  packageId: string;
  cutoffUtc: string;
  sequence: number;
  sesiones: { id: string; minutos: number; inicioUtc: string; finUtc: string; cuenta?: boolean }[];
  terminalId?: string;
}): DayPackagePayload {
  const sessions = args.sesiones.map((s) => ({
    sessionId: s.id,
    sessionType: "Commercial",
    status: "Completed",
    billable: s.cuenta !== false,
    countsForReconciliation: s.cuenta !== false,
    baseDurationMinutes: s.minutos,
    extensionMinutesTotal: 0,
    authorizedDurationMinutes: s.minutos,
    actualCommercialSeconds: s.minutos * 60,
    startedAtUtc: s.inicioUtc,
    activeStartedAtUtc: s.inicioUtc,
    finishedAtUtc: s.finUtc,
    openedByOperatorId: null,
    openedByDisplayName: "Fran",
    restartOfSessionId: null,
    replacedBySessionId: null,
    resetCount: 0,
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    packageId: args.packageId,
    terminalId: args.terminalId ?? TERMINAL.terminalKey,
    businessDate: FECHA,
    sequence: args.sequence,
    closureId: uuid(900 + args.sequence),
    periodStartUtc: "2026-09-13T13:00:00.000Z",
    periodEndUtc: args.cutoffUtc,
    generatedAtUtc: args.cutoffUtc,
    totals: {
      reconcilableSessions: sessions.filter((s) => s.countsForReconciliation).length,
      nonReconcilableSessions: sessions.filter((s) => !s.countsForReconciliation).length,
      maintenanceSessions: 0,
      restartedIncidentSessions: 0,
      interventions: 0,
      extensionMinutesTotal: 0,
      reconcilableMinutesTotal: sessions
        .filter((s) => s.countsForReconciliation)
        .reduce((a, s) => a + s.authorizedDurationMinutes, 0),
    },
    sessions,
    interventions: [],
    performance: [],
  };
}

async function enviar(base: BaseFalsa, payload: DayPackagePayload, terminal = TERMINAL) {
  const cuerpo = JSON.stringify(payload);
  return procesarPaquete({
    terminal,
    cuerpoCrudo: cuerpo,
    hashDeclarado: sha256Hex(cuerpo),
    puerto: base.puerto(),
    ahoraUtc: "2026-09-13T22:05:00.000Z",
  });
}

async function main() {

// ── CASO A — camino feliz: llega, se guarda, cuadra ─────────────────────────────
{
  const base = new BaseFalsa();
  base.stand = [
    { id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 30 },
  ];

  const r = await enviar(
    base,
    payloadDe({
      packageId: uuid(1),
      cutoffUtc: CIERRE_P1,
      sequence: 1,
      sesiones: [{ id: uuid(11), minutos: 30, inicioUtc: "2026-09-13T21:00:00Z", finUtc: "2026-09-13T21:30:00Z" }],
    })
  );

  assert.ok(r.ok, "el paquete tiene que entrar");
  assert.equal(r.ok && r.ack.status, "accepted");
  assert.equal(r.ok && r.ack.verificationStatus, "verified");
  assert.equal(r.ok && r.ack.receiptId, receiptIdDe(uuid(1)));
  assert.equal(r.ok && r.ack.terminalId, "sim-01");
  assert.equal(base.credencialesUsadas.length, 1, "se marca la credencial como usada");
}

// ── CASO B — ACK PERDIDO: el reintento no duplica y devuelve el MISMO receipt ───
// El caso más importante del protocolo: el backend guardó, el ACK se perdió en la red, la terminal
// reintenta. No puede insertarse una segunda vez ni cambiar el comprobante.
{
  const base = new BaseFalsa();
  base.stand = [
    { id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 30 },
  ];
  const payload = payloadDe({
    packageId: uuid(2),
    cutoffUtc: CIERRE_P1,
    sequence: 1,
    sesiones: [{ id: uuid(21), minutos: 30, inicioUtc: "2026-09-13T21:00:00Z", finUtc: "2026-09-13T21:30:00Z" }],
  });

  const primero = await enviar(base, payload);
  assert.ok(primero.ok);
  assert.equal(primero.ok && primero.ack.status, "accepted");

  const reintento = await enviar(base, payload);
  assert.ok(reintento.ok);
  assert.equal(reintento.ok && reintento.ack.status, "already_processed");
  assert.equal(
    reintento.ok && reintento.ack.receiptId,
    primero.ok ? primero.ack.receiptId : "",
    "el mismo paquete devuelve el mismo comprobante"
  );
  assert.equal(reintento.ok && reintento.ack.verificationStatus, "verified");

  assert.equal(base.paquetes.size, 1, "una sola fila de paquete");
  assert.equal(base.sesiones.length, 1, "una sola sesión");
}

// ── CASO C — mismo PackageId con OTRO contenido: conflicto, nunca sobrescribir ──
{
  const base = new BaseFalsa();
  const original = payloadDe({
    packageId: uuid(3),
    cutoffUtc: CIERRE_P1,
    sequence: 1,
    sesiones: [{ id: uuid(31), minutos: 30, inicioUtc: "2026-09-13T21:00:00Z", finUtc: "2026-09-13T21:30:00Z" }],
  });
  await enviar(base, original);

  const adulterado = { ...original, sequence: 2 };
  const r = await enviar(base, adulterado as DayPackagePayload);

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "package_hash_conflict");
  assert.equal(base.paquetes.get(uuid(3))?.payloadSha256, sha256Hex(JSON.stringify(original)), "el original intacto");
}

// ── CASO D — la MISMA entidad en dos paquetes ──────────────────────────────────
// Pasa de verdad tras un override de OWNER. Con el mismo contenido es idempotente; con contenido
// distinto es alguien reescribiendo historia y se rechaza.
{
  const base = new BaseFalsa();
  const sesionCompartida = { id: uuid(41), minutos: 15, inicioUtc: "2026-09-13T21:00:00Z", finUtc: "2026-09-13T21:15:00Z" };

  await enviar(base, payloadDe({ packageId: uuid(4), cutoffUtc: CIERRE_P1, sequence: 1, sesiones: [sesionCompartida] }));

  // P2 la reenvía igual: idempotente.
  const repetida = await enviar(
    base,
    payloadDe({ packageId: uuid(5), cutoffUtc: CIERRE_P2, sequence: 2, sesiones: [sesionCompartida] })
  );
  assert.ok(repetida.ok, "reenviar la misma entidad no es un error");
  assert.equal(base.sesiones.length, 1, "la sesión no se duplica");

  // Ahora con otra duración: conflicto.
  const conflictiva = await enviar(
    base,
    payloadDe({
      packageId: uuid(6),
      cutoffUtc: CIERRE_P2,
      sequence: 3,
      sesiones: [{ ...sesionCompartida, minutos: 30 }],
    })
  );
  assert.equal(conflictiva.ok, false);
  assert.equal(conflictiva.ok === false && conflictiva.code, "entity_conflict");
}

// ── CASO E — un paquete que llega tarde COMPLETA a uno anterior ────────────────
// P1 de T1 cierra 19:00 y queda Pending porque faltan 30 minutos de T2, ocurridos a las 18:40.
// Cuando T2 sincroniza, P1 pasa a Verified sin que nadie lo toque.
{
  const base = new BaseFalsa();
  base.stand = [
    { id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 30 },
    { id: "s2", estado: "activo", fecha: FECHA, hora: "18:40", cantidad_simuladores: 1, cantidad_minutos: 30 },
  ];

  const p1 = await enviar(
    base,
    payloadDe({
      packageId: uuid(7),
      cutoffUtc: CIERRE_P1,
      sequence: 1,
      sesiones: [{ id: uuid(71), minutos: 30, inicioUtc: "2026-09-13T21:00:00Z", finUtc: "2026-09-13T21:30:00Z" }],
    })
  );
  assert.equal(p1.ok && p1.ack.verificationStatus, "reconciliation_pending", "faltan los 30 de T2");

  // T2 sincroniza: su sesión empezó 18:40, ANTES del corte de P1.
  const p2 = await enviar(
    base,
    payloadDe({
      packageId: uuid(8),
      cutoffUtc: CIERRE_P1,
      sequence: 1,
      terminalId: "sim-02",
      sesiones: [{ id: uuid(81), minutos: 30, inicioUtc: "2026-09-13T21:40:00Z", finUtc: "2026-09-13T22:10:00Z" }],
    }),
    { ...TERMINAL, id: "term-uuid-2", terminalKey: "sim-02" }
  );

  assert.ok(p2.ok);
  assert.equal(base.paquetes.get(uuid(7))?.status, "verified", "P1 se completó solo");
  assert.equal(p2.ok && p2.ack.verificationStatus, "verified");
}

// ── CASO F — actividad nueva NO invalida un cierre ya verificado ───────────────
{
  const base = new BaseFalsa();
  base.stand = [
    { id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 30 },
  ];

  const p1 = await enviar(
    base,
    payloadDe({
      packageId: uuid(9),
      cutoffUtc: CIERRE_P1,
      sequence: 1,
      sesiones: [{ id: uuid(91), minutos: 30, inicioUtc: "2026-09-13T21:00:00Z", finUtc: "2026-09-13T21:30:00Z" }],
    })
  );
  assert.equal(p1.ok && p1.ack.verificationStatus, "verified");

  // Se vuelve a operar: aparece actividad central nueva de las 20:00.
  base.stand.push({ id: "s2", estado: "activo", fecha: FECHA, hora: "20:00", cantidad_simuladores: 1, cantidad_minutos: 30 });
  await reevaluarFecha({ businessDate: FECHA, puerto: base.puerto() });

  assert.equal(base.paquetes.get(uuid(9))?.status, "verified", "P1 no retrocede");
  assert.ok(base.paquetes.get(uuid(9))?.verifiedAt, "conserva su sello de verificación");

  // P2 cierra a las 22:00 con el acumulado completo.
  const p2 = await enviar(
    base,
    payloadDe({
      packageId: uuid(10),
      cutoffUtc: CIERRE_P2,
      sequence: 2,
      sesiones: [{ id: uuid(101), minutos: 30, inicioUtc: "2026-09-13T23:00:00Z", finUtc: "2026-09-13T23:30:00Z" }],
    })
  );
  assert.equal(p2.ok && p2.ack.verificationStatus, "verified");
}

// ── CASO G — SIM Control reporta MÁS de lo que el central respalda ─────────────
{
  const base = new BaseFalsa();
  base.stand = [
    { id: "s1", estado: "activo", fecha: FECHA, hora: "18:00", cantidad_simuladores: 1, cantidad_minutos: 15 },
  ];

  const r = await enviar(
    base,
    payloadDe({
      packageId: uuid(11),
      cutoffUtc: CIERRE_P1,
      sequence: 1,
      sesiones: [{ id: uuid(111), minutos: 30, inicioUtc: "2026-09-13T21:00:00Z", finUtc: "2026-09-13T21:30:00Z" }],
    })
  );

  assert.ok(r.ok, "el paquete se guarda igual: los datos no se pierden");
  assert.equal(r.ok && r.ack.verificationStatus, "mismatch");
  assert.ok(r.ok && r.ack.reconciliationSummary?.includes("15"), "el resumen dice cuánto sobra");
}

// ── CASO H — rechazos del protocolo ───────────────────────────────────────────

// Hash declarado que no coincide con el cuerpo.
{
  const base = new BaseFalsa();
  const payload = payloadDe({ packageId: uuid(12), cutoffUtc: CIERRE_P1, sequence: 1, sesiones: [] });
  const r = await procesarPaquete({
    terminal: TERMINAL,
    cuerpoCrudo: JSON.stringify(payload),
    hashDeclarado: "0".repeat(64),
    puerto: base.puerto(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "invalid_payload");
  assert.equal(base.paquetes.size, 0, "no se guarda nada");
}

// Paquete de OTRA terminal con credencial válida propia.
{
  const base = new BaseFalsa();
  const payload = payloadDe({ packageId: uuid(13), cutoffUtc: CIERRE_P1, sequence: 1, sesiones: [], terminalId: "sim-99" });
  const r = await enviar(base, payload);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "unauthorized");
  assert.equal(base.paquetes.size, 0);
}

// Versión de protocolo desconocida.
{
  const base = new BaseFalsa();
  const payload = { ...payloadDe({ packageId: uuid(14), cutoffUtc: CIERRE_P1, sequence: 1, sesiones: [] }), protocolVersion: 99 };
  const r = await enviar(base, payload as DayPackagePayload);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "unsupported_protocol");
}

// Cuerpo que no es JSON.
{
  const base = new BaseFalsa();
  const basura = "no soy json";
  const r = await procesarPaquete({
    terminal: TERMINAL,
    cuerpoCrudo: basura,
    hashDeclarado: sha256Hex(basura),
    puerto: base.puerto(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "invalid_payload");
}

// Cuerpo enorme: se corta antes de parsear.
{
  const base = new BaseFalsa();
  const gigante = JSON.stringify({ relleno: "x".repeat(3 * 1024 * 1024) });
  const r = await procesarPaquete({
    terminal: TERMINAL,
    cuerpoCrudo: gigante,
    hashDeclarado: sha256Hex(gigante),
    puerto: base.puerto(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "payload_too_large");
}

// ── CASO I — fallo de base: no queda paquete fantasma ─────────────────────────
{
  const base = new BaseFalsa();
  base.fallarAlInsertar = true;
  const payload = payloadDe({
    packageId: uuid(15),
    cutoffUtc: CIERRE_P1,
    sequence: 1,
    sesiones: [{ id: uuid(151), minutos: 30, inicioUtc: "2026-09-13T21:00:00Z", finUtc: "2026-09-13T21:30:00Z" }],
  });

  await assert.rejects(() => enviar(base, payload), /fallo simulado/);
  assert.equal(base.paquetes.size, 0, "nada a medio guardar");
  assert.equal(base.sesiones.length, 0);

  // El reintento posterior funciona.
  base.fallarAlInsertar = false;
  const reintento = await enviar(base, payload);
  assert.ok(reintento.ok);
  assert.equal(base.paquetes.size, 1);
}

// ── CASO J — autenticación de terminal ────────────────────────────────────────
{
  const credencial = generarCredencial();
  const fila: CredencialCentral = {
    credentialId: "cred-1",
    terminalId: "term-uuid-1",
    terminalKey: "sim-01",
    displayName: "Cabina 1",
    terminalActiva: true,
    credencialRevocada: false,
  };
  const buscar = async (hash: string) => (hash === credencial.tokenHash ? fila : null);

  // Válida.
  const ok = await autenticarTerminal({ authorization: `Bearer ${credencial.token}`, terminalKey: "sim-01", buscar });
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.terminal.terminalKey, "sim-01");

  // Token desconocido.
  const otro = generarCredencial();
  const desconocida = await autenticarTerminal({ authorization: `Bearer ${otro.token}`, terminalKey: "sim-01", buscar });
  assert.equal(desconocida.ok === false && desconocida.code, "unauthorized");

  // Credencial válida pero declarando OTRA terminal.
  const cruzada = await autenticarTerminal({ authorization: `Bearer ${credencial.token}`, terminalKey: "sim-02", buscar });
  assert.equal(cruzada.ok === false && cruzada.code, "unauthorized", "no se revela que el token existe");

  // Sin header.
  const sinHeader = await autenticarTerminal({ authorization: null, terminalKey: "sim-01", buscar });
  assert.equal(sinHeader.ok === false && sinHeader.code, "unauthorized");

  // Formato raro.
  for (const header of ["Basic abc", "Bearer", "Bearer no-es-un-token", `Bearer ${"x".repeat(200)}`]) {
    const r = await autenticarTerminal({ authorization: header, terminalKey: "sim-01", buscar });
    assert.equal(r.ok, false, `"${header}" no puede autenticar`);
  }

  // Credencial revocada → unauthorized (no "disabled": el problema es la credencial).
  const revocada = await autenticarTerminal({
    authorization: `Bearer ${credencial.token}`,
    terminalKey: "sim-01",
    buscar: async () => ({ ...fila, credencialRevocada: true }),
  });
  assert.equal(revocada.ok === false && revocada.code, "unauthorized");

  // Terminal dada de baja → se distingue, pero recién después de validar el token.
  const baja = await autenticarTerminal({
    authorization: `Bearer ${credencial.token}`,
    terminalKey: "sim-01",
    buscar: async () => ({ ...fila, terminalActiva: false }),
  });
  assert.equal(baja.ok === false && baja.code, "terminal_disabled");

  // Sin pepper la autenticación se APAGA en vez de degradarse.
  const pepper = process.env.SIM_CONTROL_CREDENTIAL_PEPPER;
  delete process.env.SIM_CONTROL_CREDENTIAL_PEPPER;
  const sinPepper = await autenticarTerminal({ authorization: `Bearer ${credencial.token}`, terminalKey: "sim-01", buscar });
  assert.equal(sinPepper.ok === false && sinPepper.code, "temporarily_unavailable");
  process.env.SIM_CONTROL_CREDENTIAL_PEPPER = pepper;
}

// ── CASO K — la credencial se guarda hasheada, nunca en claro ─────────────────
{
  const c = generarCredencial();
  assert.ok(c.token.startsWith("sct_"));
  assert.ok(c.token.length > 40, "256 bits de entropía");
  assert.match(c.tokenHash, /^[0-9a-f]{64}$/);
  assert.ok(!c.tokenHash.includes(c.token), "el hash no contiene el token");
  assert.equal(c.tokenPrefix, c.token.slice(0, 8));
  assert.equal(hashearToken(c.token), c.tokenHash, "hash determinístico: se puede buscar por índice");

  // Dos credenciales seguidas nunca coinciden.
  assert.notEqual(generarCredencial().token, generarCredencial().token);
}

// ── CASO L — el hash de entidad no depende del orden de las claves ────────────
{
  const a = hashDeEntidad({ sessionId: "x", minutos: 15 });
  const b = hashDeEntidad({ minutos: 15, sessionId: "x" });
  assert.equal(a, b, "un reenvío legítimo no puede parecer una reescritura");
  assert.notEqual(a, hashDeEntidad({ sessionId: "x", minutos: 30 }));
}

}

main().then(
  () => console.log("simControlIngest.test.ts OK"),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

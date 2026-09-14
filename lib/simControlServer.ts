import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { BuscarCredencialPorHash, CredencialCentral } from "@/lib/simControlAuth";
import type { PaqueteAEvaluar, PuertoIngestion, ResultadoRpcIngest } from "@/lib/simControlIngest";
import type { PackageStatus } from "@/lib/simControlProtocol";
import type {
  FilaReservaConciliable,
  FilaStandConciliable,
  SesionConciliable,
} from "@/lib/simControlReconciliation";

// Acceso a datos de SIM Control. SOLO servidor: importa `supabaseAdmin`, que usa la service_role.
//
// Nunca debe importarse desde un archivo "use client" — la clave quedaría en el bundle del
// navegador. Las tablas tienen RLS habilitada y sin policies, así que este es el único camino.

/** ¿Está habilitada la recepción de jornadas? Flag estricta: solo el string exacto "true". */
export function simControlSyncHabilitado(): boolean {
  return process.env.SIM_CONTROL_SYNC_ENABLED === "true";
}

// ── Credenciales ────────────────────────────────────────────────────────────────

export const buscarCredencialPorHash: BuscarCredencialPorHash = async (tokenHash) => {
  const { data, error } = await supabaseAdmin
    .from("sim_control_terminal_credentials")
    .select("id, revoked_at, terminal:sim_control_terminals!inner(id, terminal_key, display_name, active)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;

  const terminal = data.terminal as unknown as {
    id: string;
    terminal_key: string;
    display_name: string;
    active: boolean;
  };

  const credencial: CredencialCentral = {
    credentialId: data.id as string,
    terminalId: terminal.id,
    terminalKey: terminal.terminal_key,
    displayName: terminal.display_name,
    terminalActiva: terminal.active,
    credencialRevocada: data.revoked_at !== null,
  };
  return credencial;
};

// ── Actividad central del día ───────────────────────────────────────────────────

/**
 * Actividad comercial de una fecha: turnos del stand + reservas confirmadas con su registro
 * operativo.
 *
 * Son dominios SEPARADOS —dar de alta una reserva nunca escribe en `turnos_stand`— así que se suman
 * sin riesgo de contar dos veces el mismo uso.
 *
 * Se traen solo las columnas que la conciliación necesita. `nombre` y `telefono` NO se leen: son
 * datos personales que el motor no usa para nada.
 */
export async function actividadCentralDelDia(businessDate: string): Promise<{
  stand: FilaStandConciliable[];
  reservas: FilaReservaConciliable[];
}> {
  const [standRes, reservasRes] = await Promise.all([
    supabaseAdmin
      .from("turnos_stand")
      .select(
        "id, estado, fecha, hora, cantidad_simuladores, cantidad_minutos, cantidad_turnos, cantidad_personas, hora_subida, hora_bajada, turno_listo"
      )
      .eq("fecha", businessDate),
    supabaseAdmin
      .from("reservas")
      .select("id, estado, no_show, fecha, hora, duracion_minutos, simuladores, cantidad_turnos")
      .eq("fecha", businessDate)
      .eq("estado", "activa"),
  ]);

  const stand = (standRes.data ?? []) as FilaStandConciliable[];
  const reservasBase = (reservasRes.data ?? []) as FilaReservaConciliable[];

  // El uso real de una reserva vive en `reserva_operacion`, que carga el Turnero.
  const ids = reservasBase.map((r) => r.id).filter((id): id is number => typeof id === "number");
  const operacionPorReserva = new Map<number, { hora_subida: string | null; hora_bajada: string | null; listo: boolean }>();

  if (ids.length > 0) {
    const { data } = await supabaseAdmin
      .from("reserva_operacion")
      .select("reserva_id, hora_subida, hora_bajada, listo")
      .in("reserva_id", ids);

    for (const op of data ?? []) {
      operacionPorReserva.set(op.reserva_id as number, {
        hora_subida: (op.hora_subida as string | null) ?? null,
        hora_bajada: (op.hora_bajada as string | null) ?? null,
        listo: Boolean(op.listo),
      });
    }
  }

  const reservas = reservasBase.map((r) => {
    const op = typeof r.id === "number" ? operacionPorReserva.get(r.id) : undefined;
    return { ...r, hora_subida: op?.hora_subida ?? null, hora_bajada: op?.hora_bajada ?? null, listo: op?.listo ?? false };
  });

  return { stand, reservas };
}

// ── Puerto de ingestión sobre Supabase ──────────────────────────────────────────

export function puertoIngestionSupabase(): PuertoIngestion {
  return {
    async ingestar({ terminalId, payload, meta }) {
      // Toda la escritura ocurre dentro de la función de Postgres: o entra el paquete entero con
      // sus entidades, o no entra nada.
      const { data, error } = await supabaseAdmin.rpc("sim_control_ingest_package", {
        p_terminal_id: terminalId,
        p_payload: payload,
        p_meta: meta,
      });

      if (error) {
        throw new Error(`sim_control_ingest_package: ${error.message}`);
      }

      return data as unknown as ResultadoRpcIngest;
    },

    actividadCentral: (businessDate) => actividadCentralDelDia(businessDate),

    async sesionesDeLaFecha(businessDate) {
      const { data, error } = await supabaseAdmin
        .from("sim_control_sessions")
        .select(
          "terminal_key, local_session_id, counts_for_reconciliation, authorized_duration_minutes, session_type, status, started_at_utc, finished_at_utc"
        )
        .eq("business_date", businessDate);

      if (error) throw new Error(`sim_control_sessions: ${error.message}`);
      return (data ?? []) as SesionConciliable[];
    },

    async paquetesAEvaluar(businessDate): Promise<PaqueteAEvaluar[]> {
      const { data, error } = await supabaseAdmin
        .from("sim_control_sync_packages")
        .select("id, cutoff_utc, status, receipt_id")
        .eq("business_date", businessDate)
        .neq("status", "verified");

      if (error) throw new Error(`sim_control_sync_packages: ${error.message}`);

      return (data ?? []).map((p) => ({
        packageId: p.id as string,
        cutoffUtc: p.cutoff_utc as string,
        status: p.status as PackageStatus,
        receiptId: p.receipt_id as string,
      }));
    },

    async registrarConciliacion({ businessDate, cutoffUtc, resultado }) {
      const { error } = await supabaseAdmin.rpc("sim_control_record_reconciliation", {
        p_business_date: businessDate,
        p_cutoff_utc: cutoffUtc,
        p_result: {
          status: resultado.estado,
          centralSimulatorMinutes: resultado.central.simuladorMinutos,
          localSimulatorMinutes: resultado.simControl.simuladorMinutos,
          centralOperations: resultado.central.operaciones,
          localSessions: resultado.simControl.sesionesConciliables,
          terminalKeys: resultado.terminalesQueAportaron,
          summary: resultado.resumen,
          detail: {
            bloquesCentral: resultado.central.bloques,
            bloquesSimControl: resultado.simControl.bloques,
            excluidas: resultado.central.excluidas,
            noUsadasTodavia: resultado.central.noUsadasTodavia,
            sesionesPosterioresAlCorte: resultado.simControl.sesionesPosterioresAlCorte,
            mantenimiento: resultado.simControl.sesionesMantenimiento,
            reiniciadas: resultado.simControl.sesionesReiniciadas,
          },
        },
        // Solo los aportes que suman o que se excluyeron por un motivo: sirven para explicar el
        // total fila por fila sin volver a consultar el Turnero.
        p_items: resultado.central.aportes.map((a) => ({
          source: a.fuente,
          sourceId: a.id,
          simulatorMinutes: a.simuladorMinutos,
          formula: a.formula,
          excludedReason: a.excluidaPor ?? null,
        })),
      });

      if (error) throw new Error(`sim_control_record_reconciliation: ${error.message}`);
    },

    async estadoDePaquete(packageId) {
      const { data, error } = await supabaseAdmin
        .from("sim_control_sync_packages")
        .select("status, receipt_id")
        .eq("id", packageId)
        .maybeSingle();

      if (error || !data) return null;
      return { status: data.status as PackageStatus, receiptId: data.receipt_id as string };
    },

    async marcarCredencialUsada(credentialId) {
      // Best-effort: que falle el sello de "última vez usada" no puede tumbar una sincronización.
      await supabaseAdmin
        .from("sim_control_terminal_credentials")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", credentialId);
    },
  };
}

/** Sella el "última vez vista" de una terminal tras un health check. Best-effort. */
export async function marcarTerminalVista(terminalId: string): Promise<void> {
  await supabaseAdmin
    .from("sim_control_terminals")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", terminalId);
}

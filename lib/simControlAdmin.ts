import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generarCredencial } from "@/lib/simControlCredentials";

// Administración de terminales de SIM Control. SOLO servidor (usa service_role).
//
// Todo lo que expone está pensado para el panel: nunca devuelve el payload completo de un paquete
// ni, por supuesto, el token de una credencial — del token solo existe su hash, y ni siquiera eso
// sale de acá.

export type TerminalAdmin = {
  id: string;
  terminalKey: string;
  displayName: string;
  simulatorLabel: string | null;
  active: boolean;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  credencial: { prefijo: string; creada: string; ultimoUso: string | null } | null;
};

export type PaqueteAdmin = {
  id: string;
  terminalKey: string;
  businessDate: string;
  sequence: number;
  cutoffUtc: string;
  status: string;
  hashCorto: string;
  sessionCount: number;
  interventionCount: number;
  reconcilableMinutes: number;
  receivedAt: string;
  verifiedAt: string | null;
};

export type ConciliacionAdmin = {
  businessDate: string;
  cutoffUtc: string;
  status: string;
  centralMinutes: number;
  localMinutes: number;
  differenceMinutes: number;
  summary: string | null;
  computedAt: string;
};

// ── Terminales ──────────────────────────────────────────────────────────────────

export async function listarTerminales(): Promise<TerminalAdmin[]> {
  const { data, error } = await supabaseAdmin
    .from("sim_control_terminals")
    .select("id, terminal_key, display_name, simulator_label, active, last_seen_at, last_sync_at, credenciales:sim_control_terminal_credentials(id, token_prefix, created_at, revoked_at, last_used_at)")
    .order("terminal_key");

  if (error) throw new Error(`listarTerminales: ${error.message}`);

  return (data ?? []).map((t) => {
    const credenciales = (t.credenciales ?? []) as {
      token_prefix: string;
      created_at: string;
      revoked_at: string | null;
      last_used_at: string | null;
    }[];
    const activa = credenciales.find((c) => c.revoked_at === null);

    return {
      id: t.id as string,
      terminalKey: t.terminal_key as string,
      displayName: t.display_name as string,
      simulatorLabel: (t.simulator_label as string | null) ?? null,
      active: Boolean(t.active),
      lastSeenAt: (t.last_seen_at as string | null) ?? null,
      lastSyncAt: (t.last_sync_at as string | null) ?? null,
      credencial: activa
        ? { prefijo: activa.token_prefix, creada: activa.created_at, ultimoUso: activa.last_used_at }
        : null,
    };
  });
}

export async function crearTerminal(args: {
  terminalKey: string;
  displayName: string;
  simulatorLabel?: string | null;
  actor: string;
}): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const { data, error } = await supabaseAdmin
    .from("sim_control_terminals")
    .insert({
      terminal_key: args.terminalKey.trim(),
      display_name: args.displayName.trim(),
      simulator_label: args.simulatorLabel?.trim() || null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = ya existe una terminal con ese TerminalId.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, motivo: "Ya existe una terminal con ese identificador." };
    }
    return { ok: false, motivo: "No se pudo crear la terminal." };
  }

  await auditar({ action: "terminal_created", terminalId: data!.id as string, terminalKey: args.terminalKey, actor: args.actor });
  return { ok: true, id: data!.id as string };
}

export async function cambiarEstadoTerminal(args: {
  terminalId: string;
  activa: boolean;
  actor: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("sim_control_terminals")
    .update({
      active: args.activa,
      deactivated_at: args.activa ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.terminalId)
    .select("terminal_key")
    .maybeSingle();

  if (error) throw new Error(`cambiarEstadoTerminal: ${error.message}`);

  await auditar({
    action: args.activa ? "terminal_reactivated" : "terminal_deactivated",
    terminalId: args.terminalId,
    terminalKey: (data?.terminal_key as string) ?? null,
    actor: args.actor,
  });
}

// ── Credenciales ────────────────────────────────────────────────────────────────

/**
 * Genera una credencial nueva y revoca la anterior.
 *
 * Devuelve el token EN CLARO una sola vez. No se guarda en ningún lado: del lado del servidor queda
 * solo su hash, así que si se pierde la única salida es rotarla de nuevo. Es a propósito — un token
 * recuperable es un token que alguien puede robar del panel.
 */
export async function rotarCredencial(args: {
  terminalId: string;
  actor: string;
}): Promise<{ ok: true; token: string; prefijo: string } | { ok: false; motivo: string }> {
  const { data: terminal } = await supabaseAdmin
    .from("sim_control_terminals")
    .select("id, terminal_key")
    .eq("id", args.terminalId)
    .maybeSingle();

  if (!terminal) return { ok: false, motivo: "La terminal no existe." };

  const tenia = await revocarCredencialesActivas(args.terminalId, args.actor, auditarNo);

  const credencial = generarCredencial();
  const { error } = await supabaseAdmin.from("sim_control_terminal_credentials").insert({
    terminal_id: args.terminalId,
    token_hash: credencial.tokenHash,
    token_prefix: credencial.tokenPrefix,
    created_by: args.actor,
  });

  if (error) return { ok: false, motivo: "No se pudo generar la credencial." };

  await auditar({
    action: tenia ? "credential_rotated" : "credential_created",
    terminalId: args.terminalId,
    terminalKey: terminal.terminal_key as string,
    actor: args.actor,
  });

  return { ok: true, token: credencial.token, prefijo: credencial.tokenPrefix };
}

/**
 * Revoca la credencial activa sin generar otra.
 *
 * La terminal deja de poder sincronizar, pero sus datos locales NO se tocan: siguen pendientes y se
 * envían cuando tenga una credencial nueva.
 */
export async function revocarCredencial(args: { terminalId: string; actor: string }): Promise<void> {
  await revocarCredencialesActivas(args.terminalId, args.actor, auditar);
}

async function revocarCredencialesActivas(
  terminalId: string,
  actor: string,
  registrar: (args: { action: AccionAuditada; terminalId: string; terminalKey: string | null; actor: string }) => Promise<void>
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sim_control_terminal_credentials")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actor })
    .eq("terminal_id", terminalId)
    .is("revoked_at", null)
    .select("id");

  const habia = (data ?? []).length > 0;
  if (habia) {
    await registrar({ action: "credential_revoked", terminalId, terminalKey: null, actor });
  }

  return habia;
}

// ── Paquetes y conciliaciones ───────────────────────────────────────────────────

export async function listarPaquetes(limite = 100): Promise<PaqueteAdmin[]> {
  const { data, error } = await supabaseAdmin
    .from("sim_control_sync_packages")
    // A propósito NO se trae `payload`: puede ser grande y contiene el detalle operativo del día.
    .select("id, terminal_key, business_date, sequence, cutoff_utc, status, payload_sha256, session_count, intervention_count, reconcilable_minutes, received_at, verified_at")
    .order("received_at", { ascending: false })
    .limit(limite);

  if (error) throw new Error(`listarPaquetes: ${error.message}`);

  return (data ?? []).map((p) => ({
    id: p.id as string,
    terminalKey: p.terminal_key as string,
    businessDate: p.business_date as string,
    sequence: p.sequence as number,
    cutoffUtc: p.cutoff_utc as string,
    status: p.status as string,
    hashCorto: (p.payload_sha256 as string).slice(0, 12),
    sessionCount: p.session_count as number,
    interventionCount: p.intervention_count as number,
    reconcilableMinutes: p.reconcilable_minutes as number,
    receivedAt: p.received_at as string,
    verifiedAt: (p.verified_at as string | null) ?? null,
  }));
}

export async function listarConciliaciones(limite = 100): Promise<ConciliacionAdmin[]> {
  const { data, error } = await supabaseAdmin
    .from("sim_control_reconciliations")
    .select("business_date, cutoff_utc, status, central_simulator_minutes, local_simulator_minutes, difference_minutes, summary, computed_at")
    .eq("is_latest", true)
    .order("business_date", { ascending: false })
    .limit(limite);

  if (error) throw new Error(`listarConciliaciones: ${error.message}`);

  return (data ?? []).map((r) => ({
    businessDate: r.business_date as string,
    cutoffUtc: r.cutoff_utc as string,
    status: r.status as string,
    centralMinutes: r.central_simulator_minutes as number,
    localMinutes: r.local_simulator_minutes as number,
    differenceMinutes: r.difference_minutes as number,
    summary: (r.summary as string | null) ?? null,
    computedAt: r.computed_at as string,
  }));
}

// ── Auditoría de acciones humanas ───────────────────────────────────────────────

type AccionAuditada =
  | "terminal_created"
  | "terminal_updated"
  | "terminal_deactivated"
  | "terminal_reactivated"
  | "credential_created"
  | "credential_rotated"
  | "credential_revoked";

async function auditar(args: {
  action: AccionAuditada;
  terminalId: string;
  terminalKey: string | null;
  actor: string;
}): Promise<void> {
  // Queda constancia de quién dio de alta, rotó o dio de baja qué. Nunca se registra el token.
  await supabaseAdmin.from("sim_control_admin_audit").insert({
    action: args.action,
    terminal_id: args.terminalId,
    terminal_key: args.terminalKey,
    actor: args.actor,
  });
}

/** No-op: la rotación audita una sola vez, como "rotated", en vez de "revoked" + "created". */
async function auditarNo(): Promise<void> {}

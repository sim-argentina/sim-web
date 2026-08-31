import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Reembolsos completos de Reservas web (IA SIM · Bloque 3A). SIM solo REGISTRA que
// el dinero ya fue devuelto por fuera (Mercado Pago); no ejecuta reembolsos en MP.
// La RPC atómica pone estado='reembolsada' y libera el cupo. Este módulo expone el
// registro + helpers de lectura, incluido el CONTRATO para el Bloque 3B:
//   "Toda reserva con un reembolso registrado se excluye por completo de turnos,
//    personas, operaciones, minutos y facturación atribuible."

export type Reembolso = {
  id: string;
  reserva_id: number;
  monto_reembolsado: number;
  fecha_reembolso: string;
  origen_registro: string;
  motivo: string | null;
  actor: string;
  created_at: string;
};

export type Fail = { ok: false; status: number; error: string };
export type Ok<T> = { ok: true; data: T };

// Detalle del reembolso de una reserva (admin-only). null si no está reembolsada.
export async function getReembolsoDeReserva(reservaId: number): Promise<Reembolso | null> {
  const { data, error } = await supabaseAdmin
    .from("reservas_reembolsos")
    .select("*")
    .eq("reserva_id", reservaId)
    .maybeSingle();
  if (error) throw error;
  return (data as Reembolso) ?? null;
}

// ── Contrato Bloque 3B (determinístico y reutilizable) ────────────────────────
export type EstadoReembolso = { reembolsada: boolean; monto: number; fecha: string | null; excluirDeMetricas: boolean };

export async function getEstadoReembolso(reservaId: number): Promise<EstadoReembolso> {
  const r = await getReembolsoDeReserva(reservaId);
  return { reembolsada: !!r, monto: r ? Number(r.monto_reembolsado) : 0, fecha: r?.fecha_reembolso ?? null, excluirDeMetricas: !!r };
}

// Una reserva con reembolso registrado se excluye SIEMPRE de métricas operativas y
// de empleados, sin importar cuándo ocurrió el reembolso. (Una reserva pagada sin
// reembolso sigue siendo válida aunque sea no-show.)
export async function debeExcluirseDeMetricas(reservaId: number): Promise<boolean> {
  return (await getReembolsoDeReserva(reservaId)) !== null;
}

// IDs de reservas reembolsadas dentro de un conjunto (para excluir en lote en 3B).
export async function idsReembolsadas(reservaIds: number[]): Promise<Set<number>> {
  if (reservaIds.length === 0) return new Set();
  const { data, error } = await supabaseAdmin.from("reservas_reembolsos").select("reserva_id").in("reserva_id", reservaIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => Number(r.reserva_id)));
}

// ── Finanzas: total de reembolsos de reservas por mes (de fecha_reembolso) ────
export async function getReembolsosReservasMes(mes: string): Promise<number> {
  // mes = 'YYYY-MM'. fecha_reembolso es date; el rango [inicio, finExclusivo).
  const [y, m] = mes.split("-").map(Number);
  const inicio = `${y}-${String(m).padStart(2, "0")}-01`;
  const finY = m === 12 ? y + 1 : y;
  const finM = m === 12 ? 1 : m + 1;
  const fin = `${finY}-${String(finM).padStart(2, "0")}-01`;
  const { data, error } = await supabaseAdmin
    .from("reservas_reembolsos")
    .select("monto_reembolsado")
    .gte("fecha_reembolso", inicio)
    .lt("fecha_reembolso", fin);
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + (Number(r.monto_reembolsado) || 0), 0);
}

// ── Registro atómico del reembolso ────────────────────────────────────────────
function mapErr(error: unknown): Fail {
  const code = (error as { code?: string } | null)?.code;
  const msg = (error as { message?: string } | null)?.message ?? "";
  if (code === "P0002") return { ok: false, status: 404, error: "La reserva no existe." };
  if (code === "23505") return { ok: false, status: 409, error: "La reserva ya fue reembolsada." };
  if (code === "22023" && /mes_cerrado/.test(msg)) return { ok: false, status: 409, error: "El mes financiero del reembolso está cerrado. Reabrilo en Finanzas antes de registrar." };
  if (code === "22023") return { ok: false, status: 409, error: "Solo se puede reembolsar una reserva pagada (aprobada)." };
  if (code === "22007" && /fecha_futura/.test(msg)) return { ok: false, status: 400, error: "La fecha del reembolso no puede ser futura." };
  if (code === "22007") return { ok: false, status: 400, error: "La fecha del reembolso no puede ser anterior al cobro." };
  return { ok: false, status: 500, error: "No se pudo registrar el reembolso." };
}

export async function registrarReembolso(reservaId: number, fechaReembolso: string, motivo: string | null): Promise<Ok<Reembolso> | Fail> {
  if (!Number.isInteger(reservaId) || reservaId <= 0) return { ok: false, status: 400, error: "Reserva inválida." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaReembolso)) return { ok: false, status: 400, error: "Fecha inválida." };
  const { data, error } = await supabaseAdmin.rpc("reservas_registrar_reembolso", {
    p_reserva_id: reservaId,
    p_fecha_reembolso: fechaReembolso,
    p_motivo: motivo,
  });
  if (error) return mapErr(error);
  return { ok: true, data: data as Reembolso };
}

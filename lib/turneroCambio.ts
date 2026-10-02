// ============================================================================
// Turnero del Stand — Cambio diario de caja. SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// Al cerrar, quien está en el stand anota cuánto efectivo queda físicamente en
// la caja como cambio; al día siguiente el Turnero muestra el del cierre
// anterior. Es una NOTA OPERATIVA: no es Finanzas (no crea movimientos, no toca
// saldos ni conciliaciones, no se compara con las ventas en efectivo), no entra
// en métricas ni en la IA y no depende del modelo comercial.
//
//   · La fecha la decide el servidor: hoyEnSim(), la fecha comercial de
//     Argentina. El staff solo trabaja sobre hoy; un admin puede ver y corregir
//     otro día (nunca uno futuro).
//   · Una fila por fecha: la RPC turnero_cambio_guardar hace el upsert atómico
//     (UNIQUE(fecha) + ON CONFLICT). Guardar de nuevo actualiza esa fila; dos
//     guardados simultáneos dejan una sola y prevalece el último.
//   · "Quién lo guardó" es lo único que firma la sesión: el rol. Nunca un nombre
//     que mande el navegador.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim } from "@/lib/agenda";
import type { AdminRole } from "@/lib/adminSession";

const TABLA = "turnero_cambio_diario";
const RPC_GUARDAR = "turnero_cambio_guardar";

/** Tope de cordura, el mismo que el CHECK de la tabla. */
export const MONTO_CAMBIO_MAXIMO = 10_000_000;

export const MENSAJE_MONTO_INVALIDO = "Ingresá el cambio en pesos, sin centavos: de $0 a $10.000.000.";

export type RegistroCambio = {
  fecha: string;
  monto: number;
  creado_por: AdminRole;
  actualizado_por: AdminRole;
  updated_at: string;
};

export type CambioAnterior = { fecha: string; monto: number };

export type VistaCambio = {
  /** Fecha comercial de Argentina, resuelta en el servidor. */
  hoy: string;
  /** El día que se muestra y se guarda: hoy, o el que eligió un admin. */
  fecha: string;
  registro: RegistroCambio | null;
  /** El registro más reciente ANTERIOR a `fecha` (el "cierre anterior"). */
  anterior: CambioAnterior | null;
  /** Solo un admin puede ver o corregir otro día. */
  puede_elegir_fecha: boolean;
};

export type FalloCambio = { ok: false; status: number; codigo: string; error: string };

const fail = (status: number, codigo: string, error: string): FalloCambio => ({ ok: false, status, codigo, error });

/**
 * Pesos enteros entre 0 y el tope. Acepta un número o una cadena de dígitos;
 * decimales, negativos, texto o vacío → null (y no se escribe nada).
 */
export function normalizarMonto(valor: unknown): number | null {
  let n: number;
  if (typeof valor === "number") n = valor;
  else if (typeof valor === "string" && /^\d{1,9}$/.test(valor.trim())) n = Number(valor.trim());
  else return null;
  if (!Number.isInteger(n) || n < 0 || n > MONTO_CAMBIO_MAXIMO) return null;
  return n === 0 ? 0 : n;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** AAAA-MM-DD que existe en el calendario (sin pasar por la zona horaria). */
function fechaReal(f: string): boolean {
  if (!FECHA_RE.test(f)) return false;
  const [y, m, d] = f.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * El día sobre el que se trabaja. Sin fecha pedida: hoy en Argentina. Pedir
 * otro día es solo de admin, con una fecha real y nunca futura; el staff no
 * elige (mandar la de hoy es inocuo).
 */
export function resolverFecha(
  pedida: unknown,
  rol: AdminRole,
  ahora: Date = new Date(),
): { ok: true; fecha: string; hoy: string } | FalloCambio {
  const hoy = hoyEnSim(ahora);
  if (pedida === undefined || pedida === null || pedida === "") return { ok: true, fecha: hoy, hoy };
  if (typeof pedida !== "string" || !fechaReal(pedida)) return fail(400, "fecha_invalida", "Fecha inválida.");
  if (pedida === hoy) return { ok: true, fecha: hoy, hoy };
  if (rol !== "admin") return fail(403, "fecha_no_permitida", "Solo un admin puede ver o corregir otro día.");
  if (pedida > hoy) return fail(400, "fecha_futura", "Ese día todavía no cerró.");
  return { ok: true, fecha: pedida, hoy };
}

function aRegistro(f: Record<string, unknown>): RegistroCambio {
  return {
    fecha: String(f.fecha).slice(0, 10),
    monto: Number(f.monto),
    creado_por: f.creado_por === "admin" ? "admin" : "staff",
    actualizado_por: f.actualizado_por === "admin" ? "admin" : "staff",
    updated_at: String(f.updated_at),
  };
}

/** El registro del día y el más reciente anterior. Dos lecturas, nada más. */
async function leer(fecha: string): Promise<{ registro: RegistroCambio | null; anterior: CambioAnterior | null }> {
  const [delDia, previo] = await Promise.all([
    supabaseAdmin
      .from(TABLA)
      .select("fecha, monto, creado_por, actualizado_por, updated_at")
      .eq("fecha", fecha)
      .maybeSingle(),
    supabaseAdmin
      .from(TABLA)
      .select("fecha, monto")
      .lt("fecha", fecha)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (delDia.error) throw new Error(delDia.error.message);
  if (previo.error) throw new Error(previo.error.message);
  const p = previo.data as Record<string, unknown> | null;
  return {
    registro: delDia.data ? aRegistro(delDia.data as Record<string, unknown>) : null,
    anterior: p ? { fecha: String(p.fecha).slice(0, 10), monto: Number(p.monto) } : null,
  };
}

/** Lo que muestra la sección: el día (hoy o el que pidió un admin) y el cierre anterior. */
export async function vistaCambio(args: {
  rol: AdminRole;
  fecha?: unknown;
  ahora?: Date;
}): Promise<{ ok: true; data: VistaCambio } | FalloCambio> {
  const r = resolverFecha(args.fecha, args.rol, args.ahora);
  if (!r.ok) return r;
  const { registro, anterior } = await leer(r.fecha);
  return { ok: true, data: { hoy: r.hoy, fecha: r.fecha, registro, anterior, puede_elegir_fecha: args.rol === "admin" } };
}

/**
 * Guarda el cambio del día: crea la fila o actualiza la existente (nunca una
 * segunda). Un monto inválido o un día no permitido no escriben nada.
 */
export async function guardarCambio(
  body: unknown,
  ctx: { rol: AdminRole; ahora?: Date },
): Promise<{ ok: true; data: VistaCambio } | FalloCambio> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "solicitud_invalida", "Solicitud inválida.");
  }
  const b = body as Record<string, unknown>;
  const monto = normalizarMonto(b.monto);
  if (monto === null) return fail(422, "monto_invalido", MENSAJE_MONTO_INVALIDO);
  const r = resolverFecha(b.fecha, ctx.rol, ctx.ahora);
  if (!r.ok) return r;

  const { error } = await supabaseAdmin.rpc(RPC_GUARDAR, { p_fecha: r.fecha, p_monto: monto, p_actor: ctx.rol });
  if (error) {
    if (String(error.message ?? "").includes("monto_invalido")) return fail(422, "monto_invalido", MENSAJE_MONTO_INVALIDO);
    throw new Error(error.message);
  }
  const { registro, anterior } = await leer(r.fecha);
  return { ok: true, data: { hoy: r.hoy, fecha: r.fecha, registro, anterior, puede_elegir_fecha: ctx.rol === "admin" } };
}

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import type { AdminRole } from "@/lib/adminSession";

// Las DOS llaves de Mensualidades (Bloque M8A). SOLO SERVIDOR.
//
//   1. MENSUALIDADES_ENABLED (entorno) → ¿el módulo público EXISTE?
//      Cambiarla exige un redeploy. Es la llave general y SIEMPRE prevalece.
//
//   2. ventas_publicas_habilitadas (base) → ¿se puede COMPRAR ahora?
//      Se cambia desde el panel, sin redeploy, y solo gobierna el inicio de
//      ventas nuevas.
//
// La segunda no puede encender lo que la primera apaga: con el módulo oculto no
// hay superficie pública que habilitar.
//
// LO QUE LA PAUSA NO TOCA — a propósito:
//   · el webhook de Mercado Pago;
//   · la pantalla de resultado y la reconciliación;
//   · la sesión de Mi Plan, el saldo, la vigencia y el código;
//   · la disponibilidad, las reservas con saldo, cancelar y reprogramar;
//   · el alta administrativa y el resto de las acciones de M7.
// Pausar impide EMPEZAR una venta, no deja plata cobrada sin mensualidad.

/** Código interno estable para "las ventas están pausadas ahora mismo". */
export const VENTAS_PAUSADAS = "ventas_publicas_pausadas";

/**
 * 503 y no 403: la pausa es temporal y no es un problema de permisos de quien
 * pregunta. Un 403 le diría a un cliente que hizo algo mal, y no lo hizo.
 */
export const VENTAS_PAUSADAS_STATUS = 503;

export const VENTAS_PAUSADAS_MENSAJE =
  "Las compras y renovaciones están temporalmente pausadas. Si ya tenés una mensualidad, " +
  "podés ingresar a Mi Plan y usar tu saldo normalmente.";

/**
 * ¿Se pueden iniciar ventas públicas AHORA?
 *
 * Se lee por request, sin caché: una pausa tiene que surtir efecto enseguida, y
 * el costo de una consulta es despreciable frente a vender algo que se decidió
 * dejar de vender. Ante cualquier error de lectura devuelve false: si no se
 * puede saber si está permitido vender, no se vende.
 */
export async function ventasPublicasHabilitadas(): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("mensualidad_ventas_habilitadas");
  if (error) return false;
  return data === true;
}

export type EstadoComercial = {
  /** La llave general de entorno. Informativa: no se cambia desde el panel. */
  moduloPublico: boolean;
  /** La llave administrable. */
  ventasPublicas: boolean;
  /** Lo que ve realmente un cliente: exige las dos. */
  sePuedeComprar: boolean;
  actualizadoAt: string | null;
};

/** Estado completo para el panel. La llave general se lee del entorno. */
export async function getEstadoComercial(): Promise<EstadoComercial> {
  const moduloPublico = mensualidadesHabilitadas();
  const { data } = await supabaseAdmin
    .from("mensualidad_config")
    .select("ventas_publicas_habilitadas, actualizado_at")
    .eq("id", 1)
    .maybeSingle();

  const ventasPublicas = data?.ventas_publicas_habilitadas === true;
  return {
    moduloPublico,
    ventasPublicas,
    // La llave general prevalece: con el módulo oculto no se puede comprar
    // aunque las ventas figuren habilitadas.
    sePuedeComprar: moduloPublico && ventasPublicas,
    actualizadoAt: data?.actualizado_at ? String(data.actualizado_at) : null,
  };
}

// ── Cambio de estado ────────────────────────────────────────────────────────

export const MOTIVO_MAX = 500;
const IDEM_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type FalloVentas = { ok: false; status: number; codigo: string; error: string };
export type ResultadoVentas<T> = { ok: true; data: T } | FalloVentas;

const fail = (status: number, codigo: string, error: string): FalloVentas =>
  ({ ok: false, status, codigo, error });

const MAPA: Record<string, { status: number; error: string }> = {
  motivo_requerido: { status: 422, error: "Escribí el motivo del cambio." },
  motivo_demasiado_largo: { status: 422, error: `El motivo no puede superar los ${MOTIVO_MAX} caracteres.` },
  actor_requerido: { status: 400, error: "Solicitud inválida." },
  idempotency_key_invalida: { status: 400, error: "Solicitud inválida." },
  rol_no_autorizado: { status: 403, error: "No tenés permiso para cambiar el estado de las ventas." },
  estado_invalido: { status: 400, error: "Solicitud inválida." },
  clave_de_otra_operacion: {
    status: 409,
    error: "Esa operación ya se registró con otros datos. Recargá y volvé a intentar.",
  },
};

function traducir(mensaje: string): FalloVentas {
  for (const clave of Object.keys(MAPA)) {
    if (mensaje.includes(clave)) return fail(MAPA[clave].status, clave, MAPA[clave].error);
  }
  return fail(500, "error", "No pudimos cambiar el estado. Probá de nuevo.");
}

export type CambioVentas = {
  estado_anterior: boolean;
  estado_nuevo: boolean;
  sin_cambios: boolean;
  idempotente: boolean;
  actualizado_at: string;
};

export type ContextoVentas = { actor: string; rol: AdminRole; idempotencyKey: string };

/**
 * Pausa o reanuda las ventas públicas. Una sola llamada a una RPC que valida,
 * bloquea la fila, aplica y audita dentro de la misma transacción.
 *
 * El estado lo decide `habilitadas`, un booleano estricto: no se acepta "true"
 * como cadena ni ningún valor que haya que interpretar.
 */
export async function cambiarVentasPublicas(
  habilitadas: boolean,
  motivo: string,
  ctx: ContextoVentas,
): Promise<ResultadoVentas<CambioVentas>> {
  if (typeof habilitadas !== "boolean") {
    return fail(400, "estado_invalido", "Solicitud inválida.");
  }
  const m = String(motivo ?? "").trim();
  if (!m) return fail(422, "motivo_requerido", "Escribí el motivo del cambio.");
  if (m.length > MOTIVO_MAX) {
    return fail(422, "motivo_demasiado_largo", `El motivo no puede superar los ${MOTIVO_MAX} caracteres.`);
  }
  if (!IDEM_RE.test(ctx.idempotencyKey)) {
    return fail(400, "idempotency_invalida", "Solicitud inválida.");
  }
  // Segunda puerta, además de requireAdmin() en la ruta. La RPC lo comprueba de
  // nuevo: staff no cambia el estado comercial por ningún camino.
  if (ctx.rol !== "admin") {
    return fail(403, "rol_no_autorizado", "No tenés permiso para cambiar el estado de las ventas.");
  }

  const { data, error } = await supabaseAdmin.rpc("mensualidad_admin_set_ventas", {
    p_habilitadas: habilitadas,
    p_motivo: m,
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
    p_idempotency_key: ctx.idempotencyKey,
  });
  if (error) return traducir(String(error.message ?? ""));

  const fila = (Array.isArray(data) ? data[0] : data) as CambioVentas | undefined;
  if (!fila) return fail(500, "error", "No pudimos cambiar el estado. Probá de nuevo.");
  return { ok: true, data: fila };
}

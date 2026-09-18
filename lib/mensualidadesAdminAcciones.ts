import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logSecurityEvent } from "@/lib/apiError";
import type { AdminRole } from "@/lib/adminSession";
import { cancelarReserva, reprogramarReserva } from "@/lib/mensualidadesGestionReserva";
import { fechaValida } from "@/lib/agenda";

// Acciones administrativas sobre una mensualidad (Bloque M7). SOLO SERVIDOR.
//
// Cada función de acá es una sola llamada a una RPC que hace TODO adentro de una
// transacción: valida, bloquea la billetera, aplica y audita. Este módulo no
// decide reglas de negocio —las decide la base— y su trabajo es:
//   1. validar la forma de la solicitud antes de molestar a la base;
//   2. traducir los errores del motor a algo que se le puede mostrar a una
//      persona, sin filtrar SQL, nombres de constraints ni estructura;
//   3. no dejar pasar nunca una acción sin motivo.
//
// EL PERMISO NO SE COMPRUEBA ACÁ. Lo comprueban los route handlers con
// requireAdmin(); este módulo se usa únicamente después de esa puerta.
//
// Sobre el ACTOR: la sesión administrativa del proyecto guarda un ROL firmado,
// no una persona. Así que la auditoría registra el rol que ejecutó la acción,
// que es lo máximo que el modelo de autenticación actual permite afirmar con
// honestidad. El día que exista identidad por empleado, se cambia acá.

/** Clave de idempotencia por intento lógico, la genera quien llama. */
const IDEM_RE = /^[A-Za-z0-9_-]{16,64}$/;
const REF_RE = /^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export const MOTIVO_MAX = 500;

export type FalloAccion = { ok: false; status: number; codigo: string; error: string };
export type ResultadoAccion<T> = { ok: true; data: T } | FalloAccion;

const fail = (status: number, codigo: string, error: string): FalloAccion =>
  ({ ok: false, status, codigo, error });

// Errores de las RPC → respuesta pública. Nunca se devuelve el texto crudo.
const MAPA: Record<string, { status: number; error: string }> = {
  motivo_requerido: { status: 422, error: "Escribí el motivo de la operación." },
  motivo_demasiado_largo: { status: 422, error: `El motivo no puede superar los ${MOTIVO_MAX} caracteres.` },
  actor_requerido: { status: 400, error: "Solicitud inválida." },
  idempotency_key_invalida: { status: 400, error: "Solicitud inválida." },
  idempotency_key_con_otro_payload: {
    status: 409,
    error: "Esa operación ya se registró con otros datos. Recargá y volvé a intentar.",
  },
  mensualidad_inexistente: { status: 404, error: "No encontramos esa mensualidad." },
  fecha_invalida: { status: 422, error: "Elegí una fecha válida." },
  fecha_no_posterior: {
    status: 422,
    error: "La fecha nueva tiene que ser posterior al vencimiento actual. Desde acá el vencimiento solo se extiende.",
  },
  operacion_invalida: { status: 400, error: "Solicitud inválida." },
  minutos_invalidos: { status: 422, error: "La cantidad de minutos tiene que ser mayor a cero." },
  minutos_no_multiplo_15: { status: 422, error: "Los minutos tienen que ser múltiplo de 15." },
  saldo_insuficiente: {
    status: 422,
    error: "No se puede descontar esa cantidad: el saldo quedaría negativo.",
  },
  estado_sin_cambios: { status: 409, error: "La mensualidad ya estaba en ese estado." },
  telefono_invalido: { status: 422, error: "Ese teléfono no es válido. Usá código de área y número, sin 0 ni 15." },
  telefono_sin_cambios: { status: 409, error: "Es el mismo teléfono que ya tenía." },
  telefono_en_uso: {
    status: 409,
    error: "Ese teléfono ya pertenece a otra mensualidad. Unificar cuentas no se hace desde acá.",
  },
  no_se_pudo_generar_codigo: { status: 500, error: "No pudimos generar un código nuevo. Probá otra vez." },
};

function traducir(mensaje: string): FalloAccion {
  for (const clave of Object.keys(MAPA)) {
    if (mensaje.includes(clave)) {
      const m = MAPA[clave];
      return fail(m.status, clave, m.error);
    }
  }
  return fail(500, "error", "No pudimos completar la operación. Probá de nuevo.");
}

/** Forma de la solicitud: motivo y clave. Lo demás lo valida cada acción. */
function validarComun(motivo: unknown, idempotencyKey: unknown): FalloAccion | null {
  const m = String(motivo ?? "").trim();
  if (!m) return fail(422, "motivo_requerido", "Escribí el motivo de la operación.");
  if (m.length > MOTIVO_MAX) {
    return fail(422, "motivo_demasiado_largo", `El motivo no puede superar los ${MOTIVO_MAX} caracteres.`);
  }
  if (!IDEM_RE.test(String(idempotencyKey ?? ""))) {
    return fail(400, "idempotency_invalida", "Solicitud inválida.");
  }
  return null;
}

type Contexto = { actor: string; rol: AdminRole; idempotencyKey: string };

async function llamar<T>(fn: string, args: Record<string, unknown>): Promise<ResultadoAccion<T>> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) return traducir(String(error.message ?? ""));
  const fila = (Array.isArray(data) ? data[0] : data) as T | undefined;
  if (!fila) return fail(500, "error", "No pudimos completar la operación. Probá de nuevo.");
  return { ok: true, data: fila };
}

// ── Extender vencimiento ────────────────────────────────────────────────────

export type VencimientoExtendido = {
  vence_anterior: string;
  vence_nuevo: string;
  estado_resultante: string;
  saldo_actual: number;
  idempotente: boolean;
};

/**
 * Mueve el vencimiento hacia adelante. No crea compra, no toca saldo y no
 * simula una renovación: la billetera simplemente dura más.
 */
export async function extenderVencimiento(
  mensualidadId: string,
  fecha: string,
  motivo: string,
  ctx: Contexto,
): Promise<ResultadoAccion<VencimientoExtendido>> {
  const malo = validarComun(motivo, ctx.idempotencyKey);
  if (malo) return malo;
  // fechaValida() rechaza además lo que el regex deja pasar y el calendario no
  // tiene: 2026-13-01 o 2026-02-31 no llegan nunca a la base.
  if (!fechaValida(fecha)) return fail(422, "fecha_invalida", "Elegí una fecha válida.");

  return llamar<VencimientoExtendido>("mensualidad_admin_extender_vencimiento", {
    p_mensualidad_id: mensualidadId,
    p_nueva_fecha: fecha,
    p_motivo: motivo.trim(),
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
    p_idempotency_key: ctx.idempotencyKey,
  });
}

// ── Agregar o descontar saldo ───────────────────────────────────────────────

export type SaldoAjustado = {
  saldo_anterior: number;
  saldo_posterior: number;
  minutos_aplicados: number;
  estado_resultante: string;
  idempotente: boolean;
};

export type OperacionSaldo = "agregar" | "descontar";

/**
 * Ajuste administrativo de saldo. La cantidad llega SIEMPRE positiva y la
 * dirección viaja aparte: así no hay forma de descontar por un signo perdido.
 *
 * Deja exactamente un movimiento 'ajuste_admin'. Un doble clic con la misma
 * clave devuelve el mismo resultado sin volver a mover nada.
 */
export async function ajustarSaldo(
  mensualidadId: string,
  operacion: OperacionSaldo,
  minutos: number,
  motivo: string,
  ctx: Contexto,
): Promise<ResultadoAccion<SaldoAjustado>> {
  const malo = validarComun(motivo, ctx.idempotencyKey);
  if (malo) return malo;
  if (operacion !== "agregar" && operacion !== "descontar") {
    return fail(400, "operacion_invalida", "Solicitud inválida.");
  }
  if (!Number.isInteger(minutos) || minutos <= 0) {
    return fail(422, "minutos_invalidos", "La cantidad de minutos tiene que ser mayor a cero.");
  }
  if (minutos % 15 !== 0) {
    return fail(422, "minutos_no_multiplo_15", "Los minutos tienen que ser múltiplo de 15.");
  }

  return llamar<SaldoAjustado>("mensualidad_admin_ajustar_saldo", {
    p_mensualidad_id: mensualidadId,
    p_operacion: operacion,
    p_minutos: minutos,
    p_motivo: motivo.trim(),
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
    p_idempotency_key: ctx.idempotencyKey,
  });
}

// ── Bloquear y reactivar ────────────────────────────────────────────────────

export type BloqueoCambiado = {
  bloqueada_antes: boolean;
  bloqueada_ahora: boolean;
  estado_resultante: string;
  sesiones_cerradas: number;
  idempotente: boolean;
};

/**
 * Bloquear no cancela reservas, no toca saldo y no mueve el vencimiento: lo
 * único que cambia es que la billetera deja de poder operar. Las sesiones
 * abiertas se cierran para que el bloqueo sea efectivo YA; el titular puede
 * volver a identificarse y ver que está bloqueada.
 */
export async function cambiarBloqueo(
  mensualidadId: string,
  bloquear: boolean,
  motivo: string,
  ctx: Contexto,
): Promise<ResultadoAccion<BloqueoCambiado>> {
  const malo = validarComun(motivo, ctx.idempotencyKey);
  if (malo) return malo;
  if (typeof bloquear !== "boolean") return fail(400, "operacion_invalida", "Solicitud inválida.");

  return llamar<BloqueoCambiado>("mensualidad_admin_cambiar_bloqueo", {
    p_mensualidad_id: mensualidadId,
    p_bloquear: bloquear,
    p_motivo: motivo.trim(),
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
    p_idempotency_key: ctx.idempotencyKey,
  });
}

// ── Cambio de teléfono ──────────────────────────────────────────────────────

export type TelefonoCambiado = {
  telefono_anterior_fin: string;
  telefono_nuevo_fin: string;
  sesiones_cerradas: number;
  idempotente: boolean;
};

/**
 * El teléfono normalizado es la identidad con la que se renueva y se entra a
 * Mi Plan, así que cambiarlo cierra todas las sesiones y el número anterior
 * deja de autenticar en el acto. Si el nuevo ya es de otra billetera se
 * rechaza: unificar cuentas no es parte de M7.
 */
export async function cambiarTelefono(
  mensualidadId: string,
  telefono: string,
  motivo: string,
  ctx: Contexto,
): Promise<ResultadoAccion<TelefonoCambiado>> {
  const malo = validarComun(motivo, ctx.idempotencyKey);
  if (malo) return malo;
  const t = String(telefono ?? "").trim();
  if (!t || t.length > 40) {
    return fail(422, "telefono_invalido", "Ese teléfono no es válido.");
  }

  return llamar<TelefonoCambiado>("mensualidad_admin_cambiar_telefono", {
    p_mensualidad_id: mensualidadId,
    p_telefono: t,
    p_motivo: motivo.trim(),
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
    p_idempotency_key: ctx.idempotencyKey,
  });
}

// ── Regenerar el código de acceso ───────────────────────────────────────────

export type CodigoRegenerado = {
  codigo_nuevo: string;
  sesiones_cerradas: number;
  idempotente: boolean;
};

/**
 * Rota el código. El anterior deja de servir en el mismo instante y las
 * sesiones se cierran. El código nuevo NO queda escrito en la auditoría: se
 * devuelve una vez a quien lo pidió y vive únicamente en la billetera.
 */
export async function regenerarCodigo(
  mensualidadId: string,
  motivo: string,
  ctx: Contexto,
): Promise<ResultadoAccion<CodigoRegenerado>> {
  const malo = validarComun(motivo, ctx.idempotencyKey);
  if (malo) return malo;

  return llamar<CodigoRegenerado>("mensualidad_admin_regenerar_codigo", {
    p_mensualidad_id: mensualidadId,
    p_motivo: motivo.trim(),
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
    p_idempotency_key: ctx.idempotencyKey,
  });
}

// ── Reservas: cancelar y reprogramar desde la administración ────────────────
//
// Las dos reusan EXACTAMENTE las funciones de M5C. La política no cambia por
// venir de la administración: la regla de las 24 h sigue decidiendo si los
// minutos vuelven, y una reserva a menos de 24 h se puede cancelar pero no
// reprogramar. Si hace falta una excepción por una cancelación fuera de
// término, se hace con un ajuste de saldo aparte y con su propio motivo, que
// es lo que deja rastro de que fue una decisión y no un agujero.
//
// Lo único que el administrador sí puede saltear es el BLOQUEO: esa restricción
// existe contra el titular, no contra la operación interna.

/** La auditoría de estas dos se escribe después, sin poder deshacer la acción. */
async function auditarReserva(
  mensualidadId: string,
  accion: string,
  referencia: string,
  motivo: string,
  ctx: Contexto,
  detalle: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("mensualidad_auditar", {
    p_mensualidad_id: mensualidadId,
    p_accion: accion,
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
    p_motivo: motivo.trim(),
    p_valor_anterior: null,
    p_valor_nuevo: detalle,
    p_referencia: referencia,
    p_idempotency_key: null,
  });
  if (error) {
    // La operación ya ocurrió: no se la puede deshacer por no haber podido
    // anotarla. Queda el registro técnico para poder reconstruirlo.
    logSecurityEvent("mens_admin_auditoria_fallida", { accion });
  }
}

export async function cancelarReservaAdmin(
  mensualidadId: string,
  referencia: string,
  motivo: string,
  ctx: Contexto,
) {
  const malo = validarComun(motivo, ctx.idempotencyKey);
  if (malo) return malo;
  if (!REF_RE.test(referencia)) {
    return fail(404, "reserva_inexistente", "No encontramos esa reserva.");
  }

  // (M5C.2) "admin" lo pone el servidor, después de requireAdmin(). El cuerpo
  // de la solicitud no participa: no hay forma de que alguien se atribuya esto.
  const r = await cancelarReserva(mensualidadId, referencia, ctx.idempotencyKey, "admin");
  if (r.ok && !r.data.idempotente) {
    await auditarReserva(mensualidadId, "cancelar_reserva", referencia, motivo, ctx, {
      restituyo: r.data.restituyo,
      minutos_restituidos: r.data.minutos_restituidos,
    });
  }
  return r;
}

export async function reprogramarReservaAdmin(
  mensualidadId: string,
  referencia: string,
  fecha: string,
  hora: string,
  motivo: string,
  ctx: Contexto,
) {
  const malo = validarComun(motivo, ctx.idempotencyKey);
  if (malo) return malo;
  if (!REF_RE.test(referencia)) {
    return fail(404, "reserva_inexistente", "No encontramos esa reserva.");
  }

  const r = await reprogramarReserva(mensualidadId, referencia, fecha, hora, ctx.idempotencyKey, {
    ignorarBloqueo: true,
  });
  if (r.ok && !r.data.sin_cambios) {
    await auditarReserva(mensualidadId, "reprogramar_reserva", referencia, motivo, ctx, {
      fecha: r.data.fecha,
      hora: r.data.hora,
    });
  }
  return r;
}

// ── Auditoría ───────────────────────────────────────────────────────────────

export type EntradaAuditoria = {
  accion: string;
  actor: string;
  actor_rol: string;
  motivo: string;
  referencia: string | null;
  anterior: unknown;
  nuevo: unknown;
  fecha: string;
};

export const LIMITE_AUDITORIA = 100;

/** Auditoría completa de una billetera. La pueden leer admin y staff. */
export async function getAuditoria(mensualidadId: string): Promise<EntradaAuditoria[]> {
  const { data } = await supabaseAdmin
    .from("mensualidad_auditoria")
    .select("accion, actor, actor_rol, motivo, referencia, valor_anterior, valor_nuevo, created_at")
    .eq("mensualidad_id", mensualidadId)
    .order("created_at", { ascending: false })
    .limit(LIMITE_AUDITORIA);

  return (data ?? []).map((a) => ({
    accion: String(a.accion),
    actor: String(a.actor),
    actor_rol: String(a.actor_rol),
    motivo: String(a.motivo),
    referencia: a.referencia ?? null,
    anterior: a.valor_anterior ?? null,
    nuevo: a.valor_nuevo ?? null,
    fecha: String(a.created_at),
  }));
}

// ============================================================================
// Modalidad comercial VIGENTE (Bloque B0). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// Acá, y SOLO acá, vive el instante del corte. lib/modalidadComercial.test.ts
// falla si esa fecha aparece como corte en cualquier otro archivo del repo.
//
//   · El corte es un INSTANTE absoluto, escrito con su offset, y se compara en
//     milisegundos epoch. Nunca `new Date("AAAA-MM-DD")` (se interpreta como
//     00:00 UTC, las 21:00 del día anterior en Argentina) ni
//     `new Date(año, mes, día)` (usa la zona del servidor, que en Vercel es UTC).
//   · El navegador NUNCA decide la modalidad: la recibe del servidor. Este
//     archivo lee la base y no se importa desde componentes "use client" (lo
//     vigila el test).
//   · La modalidad de una operación se fija al CREARLA y no cambia. Las filas
//     históricas quedan en NULL, que significa legacy. Nada acá infiere la
//     modalidad a partir de un created_at.
//   · El override administrativo es solo contingencia (rollback): NULL sigue el
//     calendario; 'legacy' o 'v2_10' fuerzan esa modalidad para las operaciones
//     NUEVAS. Nunca reescribe operaciones existentes.
//
// (B0/B1) Todavía no lo consume ningún flujo comercial: solo el diagnóstico
// administrativo. Conectarlo a Reservas, Gift Cards, etc. es de los bloques
// siguientes.
// ============================================================================

import { esModalidad, type Modalidad } from "@/lib/catalogoComercial";
import type { AdminRole } from "@/lib/adminSession";

/** El corte: 01/10/2026 00:00:00 en Argentina. ÚNICA aparición en el repo. */
export const CORTE_MODALIDAD_V2 = "2026-10-01T00:00:00-03:00";

/** El mismo instante en milisegundos epoch (2026-10-01T03:00:00.000Z). */
export const CORTE_MODALIDAD_V2_MS: number = Date.parse(CORTE_MODALIDAD_V2);

/** Zona en la que se EXPRESA el corte. El cálculo no depende de ella: es epoch. */
export const ZONA_CORTE = "America/Argentina/Buenos_Aires";

/**
 * Qué modalidad corresponde, por calendario, a un instante. Pura: los tests le
 * pasan el reloj. Antes del corte legacy; desde el corte (inclusive) v2_10.
 */
export function modalidadProgramada(ahora: Date = new Date()): Modalidad {
  const t = ahora instanceof Date ? ahora.getTime() : Number.NaN;
  if (!Number.isFinite(t)) {
    throw new TypeError("modalidadProgramada: el instante no es válido");
  }
  return t >= CORTE_MODALIDAD_V2_MS ? "v2_10" : "legacy";
}

/** La modalidad efectiva: el override, si hay, gana sobre el calendario. Pura. */
export function modalidadEfectiva(programada: Modalidad, override: Modalidad | null): Modalidad {
  return override ?? programada;
}

const INSTANTE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Lee un instante ISO 8601 CON zona ("…Z" o "…-03:00"). Cualquier otra forma
 * devuelve null: una fecha sola o una hora sin zona se interpretan distinto
 * según quién las lea, que es justo lo que no puede pasar con el corte.
 * Solo lo usa el diagnóstico, para SIMULAR un instante.
 */
export function leerInstante(valor: unknown): Date | null {
  if (typeof valor !== "string" || valor.length > 40 || !INSTANTE_RE.test(valor)) return null;
  const t = Date.parse(valor);
  return Number.isFinite(t) ? new Date(t) : null;
}

// ── Override administrativo (lectura) ───────────────────────────────────────

type ClienteAdmin = (typeof import("@/lib/supabaseAdmin"))["supabaseAdmin"];

// Import diferido: las funciones puras de arriba se prueban sin credenciales, y
// el cliente con service_role se carga recién cuando hace falta la base.
async function db(): Promise<ClienteAdmin> {
  const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
  return supabaseAdmin;
}

export type EstadoOverride = {
  override: Modalidad | null;
  motivo: string | null;
  actualizadoPor: string | null;
  updatedAt: string | null;
  /**
   * true si no se pudo leer (error, fila ausente o valor desconocido). En ese
   * caso se sigue el CALENDARIO: el override es solo contingencia, y un error de
   * lectura no puede activar ni desactivar una modalidad por su cuenta.
   */
  errorLectura: boolean;
};

export async function leerOverride(): Promise<EstadoOverride> {
  const sinOverride = (errorLectura: boolean): EstadoOverride => ({
    override: null, motivo: null, actualizadoPor: null, updatedAt: null, errorLectura,
  });
  try {
    const supabase = await db();
    const { data, error } = await supabase
      .from("modalidad_comercial_config")
      .select("modalidad_override, motivo, actualizado_por, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return sinOverride(true);
    const valor: unknown = data.modalidad_override ?? null;
    let override: Modalidad | null = null;
    if (valor !== null) {
      // La base lo impide con un check; si igual apareciera algo raro, no se
      // adivina: se sigue el calendario y el diagnóstico lo muestra.
      if (!esModalidad(valor)) return sinOverride(true);
      override = valor;
    }
    return {
      override,
      motivo: data.motivo ?? null,
      actualizadoPor: data.actualizado_por ?? null,
      updatedAt: data.updated_at ? String(data.updated_at) : null,
      errorLectura: false,
    };
  } catch {
    return sinOverride(true);
  }
}

export type ModalidadResuelta = {
  modalidad: Modalidad;
  programada: Modalidad;
  override: Modalidad | null;
  errorLecturaOverride: boolean;
  /** Instante (ISO UTC) con el que se resolvió. */
  instante: string;
};

/**
 * La modalidad que rige para una operación NUEVA en `ahora`. Los flujos que
 * vendan la van a resolver UNA vez por request y a persistirla en la fila que
 * crean; desde ahí, todo lo demás lee la fila y nunca el reloj.
 */
export async function modalidadVigente(ahora: Date = new Date()): Promise<ModalidadResuelta> {
  const programada = modalidadProgramada(ahora);
  const o = await leerOverride();
  return {
    modalidad: modalidadEfectiva(programada, o.override),
    programada,
    override: o.override,
    errorLecturaOverride: o.errorLectura,
    instante: ahora.toISOString(),
  };
}

// ── Override administrativo (escritura) ─────────────────────────────────────

export const MOTIVO_OVERRIDE_MAX = 500;

export type FalloOverride = { ok: false; status: number; codigo: string; error: string };
export type PedidoOverride = { override: Modalidad | null; motivo: string };
export type CambioOverride = {
  override_anterior: Modalidad | null;
  override_nuevo: Modalidad | null;
  sin_cambios: boolean;
  updated_at: string;
};

const fail = (status: number, codigo: string, error: string): FalloOverride =>
  ({ ok: false, status, codigo, error });

const MENSAJE_OVERRIDE_INVALIDO = 'Indicá la modalidad: null (seguir el calendario), "legacy" o "v2_10".';

/**
 * Valida la FORMA del pedido. `override` tiene que VENIR (ausente no significa
 * "sin override") y ser null, "legacy" o "v2_10" exactos. El motivo es
 * obligatorio siempre, también para volver al calendario. Nada más del cuerpo
 * se lee: el actor sale de la sesión firmada.
 */
export function validarPedidoOverride(
  body: unknown,
): { ok: true; data: PedidoOverride } | FalloOverride {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "solicitud_invalida", "Solicitud inválida.");
  }
  const b = body as Record<string, unknown>;
  if (!("override" in b)) return fail(400, "override_invalido", MENSAJE_OVERRIDE_INVALIDO);
  let override: Modalidad | null = null;
  if (b.override !== null) {
    if (!esModalidad(b.override)) return fail(400, "override_invalido", MENSAJE_OVERRIDE_INVALIDO);
    override = b.override;
  }
  const motivo = typeof b.motivo === "string" ? b.motivo.trim() : "";
  if (!motivo) return fail(422, "motivo_requerido", "Escribí el motivo del cambio.");
  if (motivo.length > MOTIVO_OVERRIDE_MAX) {
    return fail(422, "motivo_demasiado_largo",
      `El motivo no puede superar los ${MOTIVO_OVERRIDE_MAX} caracteres.`);
  }
  return { ok: true, data: { override, motivo } };
}

// Errores de la RPC → respuesta pública. Nunca se devuelve el texto crudo.
const MAPA_ERRORES_OVERRIDE: Record<string, { status: number; error: string }> = {
  rol_no_autorizado: { status: 403, error: "No tenés permiso para cambiar la modalidad comercial." },
  actor_requerido: { status: 400, error: "Solicitud inválida." },
  override_invalido: { status: 400, error: MENSAJE_OVERRIDE_INVALIDO },
  motivo_requerido: { status: 422, error: "Escribí el motivo del cambio." },
  motivo_demasiado_largo: {
    status: 422,
    error: `El motivo no puede superar los ${MOTIVO_OVERRIDE_MAX} caracteres.`,
  },
};

type FilaCambio = {
  override_anterior: string | null;
  override_nuevo: string | null;
  sin_cambios: boolean;
  updated_at: string;
};

/**
 * Cambia el override con UNA llamada a una RPC que exige rol admin por su
 * cuenta (además del requireAdmin de la ruta), bloquea la fila y guarda motivo,
 * actor y fecha. Solo afecta a operaciones NUEVAS de los bloques que la lean.
 */
export async function cambiarOverride(
  pedido: PedidoOverride,
  ctx: { actor: string; rol: AdminRole },
): Promise<{ ok: true; data: CambioOverride } | FalloOverride> {
  if (ctx.rol !== "admin") {
    return fail(403, "rol_no_autorizado", MAPA_ERRORES_OVERRIDE.rol_no_autorizado.error);
  }
  const supabase = await db();
  const { data, error } = await supabase.rpc("modalidad_comercial_set_override", {
    p_override: pedido.override,
    p_motivo: pedido.motivo,
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
  });
  if (error) {
    const mensaje = String(error.message ?? "");
    for (const clave of Object.keys(MAPA_ERRORES_OVERRIDE)) {
      if (mensaje.includes(clave)) {
        const m = MAPA_ERRORES_OVERRIDE[clave];
        return fail(m.status, clave, m.error);
      }
    }
    return fail(500, "error", "No se pudo cambiar la modalidad. Probá de nuevo.");
  }
  const fila = (Array.isArray(data) ? data[0] : data) as FilaCambio | undefined;
  if (!fila) return fail(500, "error", "No se pudo cambiar la modalidad. Probá de nuevo.");
  const anterior = fila.override_anterior;
  const nuevo = fila.override_nuevo;
  return {
    ok: true,
    data: {
      override_anterior: esModalidad(anterior) ? anterior : null,
      override_nuevo: esModalidad(nuevo) ? nuevo : null,
      sin_cambios: Boolean(fila.sin_cambios),
      updated_at: String(fila.updated_at),
    },
  };
}

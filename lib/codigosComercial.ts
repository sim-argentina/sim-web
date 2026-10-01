// ============================================================================
// Códigos de descuento con modalidad comercial (Bloque B9). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// `duraciones_permitidas` de un código restringe la duración REAL de la
// operación en la que se usa (validarCodigoDescuento). Lo que cambia con B9 es
// qué se puede elegir al CREAR uno y cómo se cuida lo existente:
//
//   · Alta: las duraciones elegibles son las del catálogo de la modalidad
//     VIGENTE (override > calendario): legacy 15/30, v2 10/20/30. El formulario
//     manda la modalidad con la que se armó (`modalidad_vista`; sin el campo =
//     legacy, una pestaña anterior a B9); si no es la vigente → 409 sin escribir.
//   · Códigos existentes: nunca se migran ni se reinterpretan. [15] sigue siendo
//     solo 15 (no vale para 10 ni 20) y [30] vale para cualquier operación REAL
//     de 30 minutos. Al editar, una duración que el código ya tenía se conserva
//     aunque ya no esté en la oferta ("duración legacy conservada").
//   · La duración no decide la modalidad: 30 existe en las dos.
// ============================================================================

import { CATALOGO_ACTUALIZADO, duracionesPermitidas, esModalidad, type Modalidad } from "@/lib/catalogoComercial";
import { modalidadVigente } from "@/lib/modalidadComercial";

export const MENSAJE_CODIGOS_ACTUALIZADO =
  "Cambió la modalidad comercial. Revisá las duraciones antes de guardar el código.";

export type CatalogoCodigos = {
  modalidad: Modalidad;
  /** Instante con el que el servidor resolvió la modalidad. */
  resuelto_en: string;
  /** Duraciones elegibles para un código NUEVO (minutos por operación). */
  duraciones: number[];
};

export function catalogoCodigosPara(modalidad: Modalidad, ahora: Date): CatalogoCodigos {
  return { modalidad, resuelto_en: ahora.toISOString(), duraciones: [...duracionesPermitidas(modalidad, "reserva")] };
}

export async function catalogoCodigosVigente(ahora: Date = new Date()): Promise<CatalogoCodigos> {
  const { modalidad } = await modalidadVigente(ahora);
  return catalogoCodigosPara(modalidad, ahora);
}

export type FalloCodigos = { ok: false; status: number; codigo: string; error: string; catalogo?: CatalogoCodigos };
const fail = (status: number, codigo: string, error: string): FalloCodigos => ({ ok: false, status, codigo, error });

/**
 * Lista de duraciones del cuerpo: null = sin restricción (lista ausente o
 * vacía, como siempre). Enteros positivos, sin repetidos, ordenados.
 */
function leerDuraciones(valor: unknown): { ok: true; duraciones: number[] | null } | FalloCodigos {
  if (valor === null || valor === undefined) return { ok: true, duraciones: null };
  if (!Array.isArray(valor)) return fail(400, "duraciones_invalidas", "Duraciones inválidas.");
  if (valor.length === 0) return { ok: true, duraciones: null };
  const nums = valor.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) return fail(400, "duraciones_invalidas", "Duraciones inválidas.");
  return { ok: true, duraciones: [...new Set(nums)].sort((a, b) => a - b) };
}

/**
 * Alta de un código: la modalidad la decide el servidor; el cuerpo solo informa
 * con qué catálogo se armó el formulario. Duraciones fuera de la oferta → 422.
 */
export async function prepararDuracionesAlta(
  body: Record<string, unknown>,
  opts: { ahora?: Date } = {},
): Promise<{ ok: true; duraciones: number[] | null; catalogo: CatalogoCodigos } | FalloCodigos> {
  const catalogo = await catalogoCodigosVigente(opts.ahora ?? new Date());
  const vista = body.modalidad_vista === undefined ? "legacy" : body.modalidad_vista;
  if (!esModalidad(vista)) return fail(400, "modalidad_invalida", "Modalidad inválida.");
  if (vista !== catalogo.modalidad) {
    return { ...fail(CATALOGO_ACTUALIZADO.status, CATALOGO_ACTUALIZADO.codigo, MENSAJE_CODIGOS_ACTUALIZADO), catalogo };
  }
  const leidas = leerDuraciones(body.duraciones_permitidas);
  if (!leidas.ok) return leidas;
  const fuera = (leidas.duraciones ?? []).filter((d) => !catalogo.duraciones.includes(d));
  if (fuera.length > 0) {
    return { ...fail(422, "duracion_no_disponible", `Las duraciones disponibles son ${catalogo.duraciones.join(", ")} minutos.`), catalogo };
  }
  return { ok: true, duraciones: leidas.duraciones, catalogo };
}

/**
 * Edición de las duraciones de un código existente: valen las de la oferta
 * vigente MÁS las que el código ya tenía (una duración legacy no se pierde ni se
 * vuelve inválida por editar).
 */
export async function prepararDuracionesEdicion(
  valor: unknown,
  actuales: unknown,
  opts: { ahora?: Date } = {},
): Promise<{ ok: true; duraciones: number[] | null } | FalloCodigos> {
  const leidas = leerDuraciones(valor);
  if (!leidas.ok) return leidas;
  const catalogo = await catalogoCodigosVigente(opts.ahora ?? new Date());
  const propias = Array.isArray(actuales) ? actuales.map(Number) : [];
  const fuera = (leidas.duraciones ?? []).filter((d) => !catalogo.duraciones.includes(d) && !propias.includes(d));
  if (fuera.length > 0) {
    return { ...fail(422, "duracion_no_disponible", `Las duraciones disponibles son ${catalogo.duraciones.join(", ")} minutos (más las que el código ya tenía).`), catalogo };
  }
  return { ok: true, duraciones: leidas.duraciones };
}

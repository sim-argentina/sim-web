// ============================================================================
// Mensualidades con modalidad comercial (Bloque B6). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// La única puerta que resuelve la modalidad para VENDER una Mensualidad: el
// catálogo público (planes, precio vigente, condiciones), la compra web y el
// alta del panel. Resuelve modalidadVigente() UNA vez por request.
//
// Un plan que YA existe usa SIEMPRE su modalidad persistida
// (mensualidades.modalidad, NULL = legacy), nunca el reloj ni la modalidad
// global: la compra aprobada es la que la fijó.
//
// Precios: mensualidad_plan_precios (versionada desde B1). mensualidad_planes
// .precio queda como está, histórico legacy: no se actualiza ni se lee para
// vender.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CATALOGO_ACTUALIZADO, catalogoVistoVigente, duracionesPermitidas, type Modalidad,
} from "@/lib/catalogoComercial";
import { CORTE_MODALIDAD_V2_MS, modalidadVigente } from "@/lib/modalidadComercial";
import {
  condicionesMensualidad, versionCondicionesMensualidad, type Condicion,
} from "@/lib/mensualidadesCondiciones";

/** Mensaje del 409 de la compra pública (texto aprobado). */
export const MENSAJE_MENSUALIDADES_ACTUALIZADAS =
  "Actualizamos nuestras Mensualidades y precios. Revisá los nuevos planes antes de continuar.";

/** Mensaje del 409 del alta del panel. */
export const MENSAJE_MENSUALIDADES_ACTUALIZADAS_ADMIN =
  "Cambió la modalidad comercial. Revisá los nuevos planes antes de registrar la mensualidad.";

/** Mensaje del 409 de una reserva: el plan cambió de modalidad con la pantalla abierta. */
export const MENSAJE_PLAN_ACTUALIZADO =
  "Tu mensualidad se actualizó. Revisá los turnos disponibles antes de confirmar.";

export type Fallo409 = { ok: false; status: 409; codigo: typeof CATALOGO_ACTUALIZADO.codigo; error: string };
export const falloMensualidadesActualizadas = (error: string = MENSAJE_MENSUALIDADES_ACTUALIZADAS): Fallo409 =>
  ({ ok: false, status: 409, codigo: CATALOGO_ACTUALIZADO.codigo, error });

// ── Modalidad persistida ────────────────────────────────────────────────────

/** NULL (histórico) o 'legacy' → legacy; 'v2_10' → v2_10. Nunca mira el reloj. */
export function modalidadPersistida(valor: unknown): Modalidad {
  return valor === "v2_10" ? "v2_10" : "legacy";
}

/** La modalidad del PLAN, leída en este momento. null si la mensualidad no existe. */
export async function modalidadDeMensualidad(mensualidadId: string): Promise<Modalidad | null> {
  const { data, error } = await supabaseAdmin
    .from("mensualidades")
    .select("modalidad")
    .eq("id", mensualidadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return modalidadPersistida((data as { modalidad?: unknown }).modalidad);
}

/**
 * La modalidad que la pantalla VIO. Un cliente anterior a B6 no manda el campo
 * y solo pudo ver legacy: se lo trata como 'legacy', igual que en B3.
 */
export function modalidadVista(body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  return b.modalidad_vista === undefined ? "legacy" : b.modalidad_vista;
}

// ── Precios versionados ─────────────────────────────────────────────────────

export type VersionPrecio = { plan_id: string; precio: number | string; vigente_desde: string };

/**
 * El precio de un plan en una modalidad, a partir de sus versiones. PURA.
 *
 *   · legacy: la última versión anterior al corte (la que regía hasta el
 *     30/09). Con el override en legacy después del corte vuelve a ser esa.
 *   · v2_10: la última versión desde el corte que ya rige. Si el override
 *     adelantara v2 antes del corte, la del corte. Una versión futura (otro
 *     aumento) empieza a valer sola cuando llega su vigente_desde.
 *
 * null si esa modalidad no tiene precio para el plan: ese plan no se vende.
 */
export function precioDePlan(
  versiones: readonly VersionPrecio[],
  planId: string,
  modalidad: Modalidad,
  ahora: Date,
): number | null {
  const propias = versiones
    .filter((v) => v.plan_id === planId)
    .map((v) => ({ precio: Number(v.precio), t: Date.parse(String(v.vigente_desde)) }))
    .filter((v) => Number.isFinite(v.t) && Number.isFinite(v.precio) && v.precio > 0);
  const limite = modalidad === "legacy"
    ? Math.min(ahora.getTime(), CORTE_MODALIDAD_V2_MS - 1)
    : Math.max(ahora.getTime(), CORTE_MODALIDAD_V2_MS);
  const candidatas = propias.filter((v) =>
    v.t <= limite && (modalidad === "legacy" ? v.t < CORTE_MODALIDAD_V2_MS : v.t >= CORTE_MODALIDAD_V2_MS));
  if (candidatas.length === 0) return null;
  candidatas.sort((a, b) => b.t - a.t);
  return candidatas[0].precio;
}

// ── Catálogo ────────────────────────────────────────────────────────────────

export type PlanCatalogo = {
  id: string;
  slug: string;
  nombre: string;
  minutos: number;
  /** Precio de ESTA modalidad (mensualidad_plan_precios). */
  precio: number;
  vigencia_dias: number;
  etiqueta: string | null;
  orden: number;
};

export type CatalogoMensualidades = {
  modalidad: Modalidad;
  /** Instante con el que el servidor resolvió la modalidad (diagnóstico). */
  resuelto_en: string;
  planes: PlanCatalogo[];
  /** Duraciones por reserva de un plan comprado en esta modalidad. */
  duraciones: number[];
  condiciones: Condicion[];
  condiciones_version: string;
};

type FilaPlan = {
  id: string; slug: string; nombre: string; minutos: number | string; precio: number | string;
  vigencia_dias: number | string; etiqueta: string | null; orden: number | string; activo: boolean;
};

/** El catálogo de una modalidad EXPLÍCITA. Dos consultas: planes y versiones. */
export async function catalogoMensualidadesPara(modalidad: Modalidad, ahora: Date): Promise<CatalogoMensualidades> {
  const { data: planes, error } = await supabaseAdmin
    .from("mensualidad_planes")
    .select("id, slug, nombre, minutos, precio, vigencia_dias, etiqueta, orden, activo")
    .eq("activo", true)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  const filas = (planes ?? []) as FilaPlan[];

  let versiones: VersionPrecio[] = [];
  if (filas.length > 0) {
    const { data: v, error: errV } = await supabaseAdmin
      .from("mensualidad_plan_precios")
      .select("plan_id, precio, vigente_desde")
      .in("plan_id", filas.map((p) => p.id));
    if (errV) throw new Error(errV.message);
    versiones = (v ?? []) as VersionPrecio[];
  }

  const lista: PlanCatalogo[] = [];
  for (const p of filas) {
    const precio = precioDePlan(versiones, p.id, modalidad, ahora);
    const minutos = Number(p.minutos);
    const vigencia = Number(p.vigencia_dias);
    // Sin precio en esta modalidad o con datos rotos, el plan no se ofrece.
    if (precio === null || !(minutos > 0) || !(vigencia > 0)) continue;
    lista.push({
      id: p.id, slug: p.slug, nombre: p.nombre, minutos, precio, vigencia_dias: vigencia,
      etiqueta: p.etiqueta ?? null, orden: Number(p.orden) || 0,
    });
  }

  return {
    modalidad,
    resuelto_en: ahora.toISOString(),
    planes: lista,
    duraciones: [...duracionesPermitidas(modalidad, "mensualidad")],
    condiciones: [...condicionesMensualidad(modalidad)],
    condiciones_version: versionCondicionesMensualidad(modalidad),
  };
}

/** El catálogo VIGENTE: resuelve la modalidad en este request. */
export async function catalogoMensualidadesVigente(ahora: Date = new Date()): Promise<CatalogoMensualidades> {
  const { modalidad } = await modalidadVigente(ahora);
  return catalogoMensualidadesPara(modalidad, ahora);
}

/**
 * Para CREAR una compra (web o panel): resuelve la modalidad UNA vez y exige que
 * la pantalla haya visto esa misma. Si no → 409, antes de crear nada. Si la
 * pantalla manda el precio que mostró (`precio_visto`) y no es el vigente para
 * ese plan → también 409: nunca se cobra un precio que la persona no vio.
 */
export async function catalogoParaCrear(
  body: unknown,
  opts: { ahora?: Date; mensaje?: string } = {},
): Promise<{ ok: true; catalogo: CatalogoMensualidades } | Fallo409> {
  const ahora = opts.ahora ?? new Date();
  const { modalidad } = await modalidadVigente(ahora);
  if (!catalogoVistoVigente(modalidadVista(body), modalidad)) {
    return falloMensualidadesActualizadas(opts.mensaje);
  }
  const catalogo = await catalogoMensualidadesPara(modalidad, ahora);
  const b = (body ?? {}) as Record<string, unknown>;
  const visto = b.precio_visto;
  if (visto !== undefined && visto !== null) {
    const slug = String(b.plan_slug ?? "").trim();
    const plan = catalogo.planes.find((p) => p.slug === slug);
    if (plan && Number(visto) !== plan.precio) return falloMensualidadesActualizadas(opts.mensaje);
  }
  return { ok: true, catalogo };
}

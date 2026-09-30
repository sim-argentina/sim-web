// ============================================================================
// Precios especiales de Reserva por fecha (Bloque B4). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// Una fila por fecha (reservas_precios_especiales) con una columna por duración
// de Reserva: precio_10, precio_15, precio_20 y precio_30. NULL = precio normal.
//
// Qué columnas EDITA el admin lo decide el catálogo de la modalidad EFECTIVA
// (override > calendario), resuelta en el servidor en cada request:
//   · legacy: 15 y 30;
//   · v2_10:  10, 20 y 30.
// precio_30 es UNA sola columna, compartida por las dos modalidades.
//
// Guardar solo escribe las columnas de la modalidad vigente: las de la otra no
// se borran ni se convierten (precio_15 nunca pasa a ser precio_10). Un
// formulario armado con otro catálogo recibe 409 y no escribe nada.
//
// Un precio especial solo afecta operaciones NUEVAS: las reservas ya creadas
// guardaron su total, y Finanzas lee ese total.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CATALOGO_ACTUALIZADO, MODALIDADES, duracionesPermitidas, esModalidad, precioBaseReserva,
  type Modalidad,
} from "@/lib/catalogoComercial";
import { modalidadVigente } from "@/lib/modalidadComercial";
import { fechaValida } from "@/lib/agenda";

const TABLA = "reservas_precios_especiales";

/** Tope de cordura para un precio por simulador (la columna es integer). */
export const PRECIO_ESPECIAL_MAXIMO = 10_000_000;

/** El 409 del panel: el formulario se armó con otro catálogo. */
export const MENSAJE_CATALOGO_ADMIN = "Cambió la modalidad comercial. Recargá los precios antes de guardar.";

export type CampoPrecio = { duracion: number; columna: string };

/** La columna de una duración de Reserva. */
export const columnaPrecio = (duracion: number): string => `precio_${duracion}`;

/**
 * Todas las columnas guardadas: una por duración de Reserva de CUALQUIER
 * modalidad del catálogo (legacy 15/30 ∪ v2 10/20/30).
 */
export const CAMPOS_PRECIO_ESPECIAL: readonly CampoPrecio[] = [
  ...new Set(MODALIDADES.flatMap((m) => duracionesPermitidas(m, "reserva"))),
]
  .sort((a, b) => a - b)
  .map((duracion) => ({ duracion, columna: columnaPrecio(duracion) }));

const COLUMNAS_SELECT = ["id", "fecha", ...CAMPOS_PRECIO_ESPECIAL.map((c) => c.columna)].join(", ");

/** Una fila tal como la ve el panel: id, fecha y un precio (o null) por columna. */
export type FilaPrecioEspecial = { id: string; fecha: string } & Record<string, string | number | null>;

function normalizarFila(fila: Record<string, unknown>): FilaPrecioEspecial {
  const out: FilaPrecioEspecial = { id: String(fila.id), fecha: String(fila.fecha).slice(0, 10) };
  for (const { columna } of CAMPOS_PRECIO_ESPECIAL) {
    out[columna] = fila[columna] == null ? null : Number(fila[columna]);
  }
  return out;
}

export type CatalogoPreciosEspeciales = {
  /** Duraciones de Reserva de la modalidad: las que se editan. */
  duraciones: number[];
  campos: CampoPrecio[];
  /** Columnas guardadas que esta modalidad NO usa: se muestran, no se editan ni se borran. */
  otros: CampoPrecio[];
  /** Precio normal por simulador de cada duración editable, por tipo de día. */
  precios_base: { semana: Record<string, number>; fin_de_semana: Record<string, number> };
};

/** Qué edita el panel en una modalidad EXPLÍCITA. Puro: no consulta la base. */
export function catalogoPreciosEspeciales(modalidad: Modalidad): CatalogoPreciosEspeciales {
  const duraciones = [...duracionesPermitidas(modalidad, "reserva")];
  const campos = duraciones.map((duracion) => ({ duracion, columna: columnaPrecio(duracion) }));
  const editables = new Set(campos.map((c) => c.columna));
  const semana: Record<string, number> = {};
  const finDeSemana: Record<string, number> = {};
  for (const d of duraciones) {
    semana[d] = precioBaseReserva(modalidad, d, "semana") ?? 0;
    finDeSemana[d] = precioBaseReserva(modalidad, d, "finde") ?? 0;
  }
  return {
    duraciones,
    campos,
    otros: CAMPOS_PRECIO_ESPECIAL.filter((c) => !editables.has(c.columna)),
    precios_base: { semana, fin_de_semana: finDeSemana },
  };
}

export type VistaPreciosEspeciales = CatalogoPreciosEspeciales & {
  modalidad: Modalidad;
  /** Instante con el que el servidor resolvió la modalidad. */
  resuelto_en: string;
  precios: FilaPrecioEspecial[];
};

/** Lo que muestra el panel: el catálogo VIGENTE (resuelto en este request) y las filas. */
export async function vistaPreciosEspeciales(ahora: Date = new Date()): Promise<VistaPreciosEspeciales> {
  const { modalidad } = await modalidadVigente(ahora);
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select(COLUMNAS_SELECT)
    .order("fecha", { ascending: false });
  if (error) throw new Error(error.message);
  return {
    modalidad,
    resuelto_en: ahora.toISOString(),
    ...catalogoPreciosEspeciales(modalidad),
    precios: ((data ?? []) as unknown as Record<string, unknown>[]).map(normalizarFila),
  };
}

// ── Guardar ─────────────────────────────────────────────────────────────────

export type FalloPrecioEspecial = { ok: false; status: number; error: string; codigo?: string };
const fallo = (status: number, error: string, codigo?: string): FalloPrecioEspecial =>
  ({ ok: false, status, error, ...(codigo ? { codigo } : {}) });

/** "15 o 30", "10, 20 o 30". */
const listaDuraciones = (ds: readonly number[]) =>
  ds.length <= 1 ? ds.join("") : `${ds.slice(0, -1).join(", ")} o ${ds[ds.length - 1]}`;

/**
 * null o "" → null (precio normal). Si no, un entero de 0 a PRECIO_ESPECIAL_MAXIMO,
 * como número o como texto de solo dígitos. Nada de decimales, negativos,
 * exponentes ni NaN: no se redondea ni se adivina.
 */
export function normalizarPrecioEspecial(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return { ok: true, value: null };
    if (!/^\d{1,9}$/.test(t)) return { ok: false };
    n = Number(t);
  } else {
    return { ok: false };
  }
  if (!Number.isSafeInteger(n) || n < 0 || n > PRECIO_ESPECIAL_MAXIMO) return { ok: false };
  return { ok: true, value: n };
}

/**
 * Lo que se escribe: SOLO las columnas editadas y la auditoría. Las columnas
 * que no vienen quedan como están en la base.
 */
export function cambiosConAuditoria(
  cambios: Readonly<Record<string, number | null>>,
  actor: string,
  ahora: Date,
): Record<string, unknown> {
  return { ...cambios, created_by: actor, updated_at: ahora.toISOString() };
}

/**
 * Crea o actualiza el precio especial de una fecha con las duraciones de la
 * modalidad vigente. `body`: { fecha, modalidad_vista, precio_<d>: número | "" | null }.
 *
 *   · `modalidad_vista` es el catálogo con el que se armó el formulario. Sin el
 *     campo es un panel anterior a B4, que solo conocía legacy. Si no es la
 *     vigente → 409 y no se escribe nada.
 *   · Solo se aceptan las columnas de la modalidad vigente. Una columna que
 *     viene se escribe (null = volver al precio normal); una que no viene no
 *     se toca.
 *   · Se valida todo antes de escribir, y se escribe en UNA sentencia.
 */
export async function guardarPrecioEspecial(
  body: unknown,
  opts: { actor: string; ahora?: Date },
): Promise<{ ok: true; precio: FilaPrecioEspecial } | FalloPrecioEspecial> {
  const ahora = opts.ahora ?? new Date();
  const { modalidad } = await modalidadVigente(ahora);
  if (!body || typeof body !== "object" || Array.isArray(body)) return fallo(400, "Solicitud inválida.");
  const b = body as Record<string, unknown>;

  const vista = b.modalidad_vista === undefined ? "legacy" : b.modalidad_vista;
  if (!esModalidad(vista)) return fallo(400, "Modalidad inválida.");
  if (vista !== modalidad) return fallo(409, MENSAJE_CATALOGO_ADMIN, CATALOGO_ACTUALIZADO.codigo);

  const fecha = typeof b.fecha === "string" ? b.fecha.trim() : "";
  if (!fechaValida(fecha)) return fallo(400, "Fecha inválida");

  const { campos, duraciones } = catalogoPreciosEspeciales(modalidad);
  const editables = new Map(campos.map((c) => [c.columna, c]));
  const cambios: Record<string, number | null> = {};
  for (const [clave, valor] of Object.entries(b)) {
    if (!clave.startsWith("precio_")) continue;
    const campo = editables.get(clave);
    if (!campo) return fallo(400, `Duración no soportada en la modalidad vigente (${clave}).`);
    const p = normalizarPrecioEspecial(valor);
    if (!p.ok) {
      return fallo(400, `Precio ${campo.duracion} min inválido: usá un número entero entre 0 y ${PRECIO_ESPECIAL_MAXIMO.toLocaleString("es-AR")}.`);
    }
    cambios[clave] = p.value;
  }
  const alMenosUno = `Cargá al menos un precio (${listaDuraciones(duraciones)} min).`;
  if (Object.keys(cambios).length === 0) return fallo(400, alMenosUno);

  // La fila tiene que quedar con algún precio (la base también lo exige).
  const { data: actual, error: errorLectura } = await supabaseAdmin
    .from(TABLA)
    .select(COLUMNAS_SELECT)
    .eq("fecha", fecha)
    .maybeSingle();
  if (errorLectura) throw new Error(errorLectura.message);
  const resultado: Record<string, unknown> = { ...((actual ?? {}) as Record<string, unknown>), ...cambios };
  if (CAMPOS_PRECIO_ESPECIAL.every((c) => resultado[c.columna] == null)) {
    return fallo(400, actual ? "Para quitar todos los precios de esa fecha usá Eliminar." : alMenosUno);
  }

  // UPDATE si la fecha ya existe, INSERT si no. No un upsert: en un INSERT …
  // ON CONFLICT, Postgres valida el CHECK al_menos_un_precio sobre la fila
  // CANDIDATA antes de ver el conflicto, y rechazaría vaciar las columnas de
  // esta modalidad aunque la fila siga viva por las de la otra.
  const escritura = cambiosConAuditoria(cambios, opts.actor, ahora);
  const { data, error } = actual
    ? await supabaseAdmin.from(TABLA).update(escritura).eq("fecha", fecha).select(COLUMNAS_SELECT)
    : await supabaseAdmin.from(TABLA).insert({ fecha, ...escritura }).select(COLUMNAS_SELECT);
  // Otro cambio sobre la misma fecha entre la lectura y la escritura: se creó
  // (23505), se borró (0 filas) o quedaría sin precios (23514). No se escribe.
  const code = (error as { code?: string } | null)?.code;
  const filas = (data ?? []) as unknown as Record<string, unknown>[];
  if (code === "23505" || code === "23514" || (!error && filas.length !== 1)) {
    return fallo(409, "Los precios de esa fecha cambiaron mientras guardabas. Recargá y volvé a intentar.");
  }
  if (error) throw new Error(error.message);
  return { ok: true, precio: normalizarFila(filas[0]) };
}

/** Elimina TODA la configuración especial de una fecha (acción explícita del admin). */
export async function eliminarPrecioEspecial(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLA).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

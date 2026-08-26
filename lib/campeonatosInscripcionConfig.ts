// Configuración del FORMULARIO DE INSCRIPCIÓN por campeonato (pura, sin secretos).
// Fuente de verdad ÚNICA para admin, público y backend: qué campos aparecen y cuáles
// son obligatorios. Nada hardcodeado a un campeonato puntual (p. ej. "Duelo"): todo
// sale de la modalidad (preset por defecto) + `config.inscripcion.campos` de la fila.
//
// Compatibilidad: los campeonatos históricos (liga sin config custom) conservan
// EXACTAMENTE el comportamiento actual gracias al preset de liga (todos los campos
// visibles; obligatorios nombre/apellido/teléfono/DNI).

import { esEliminacion } from "@/lib/campeonatosConfig";

export type EstadoCampo = "required" | "optional" | "hidden";
export const ESTADOS_CAMPO: readonly EstadoCampo[] = ["required", "optional", "hidden"] as const;

export type CampoInscripcion =
  | "nombre" | "apellido" | "telefono" | "dni" | "instagram"
  | "escuderia" | "categoria" | "mejor_tiempo"
  | "forma_pago" | "monto"
  | "hora_toma" | "hora_estimada_subida" | "hora_subida" | "hora_bajada" | "cantidad_minutos";

export type CamposInscripcion = Record<CampoInscripcion, EstadoCampo>;

// Metadatos de cada campo configurable: etiqueta, grupo visual y clave real del body
// del formulario/API. `estructural` = existe siempre internamente (no se puede ocultar).
export const CAMPOS_INSCRIPCION: ReadonlyArray<{
  key: CampoInscripcion; label: string; grupo: string; bodyKey: string; estructural?: boolean;
}> = [
  { key: "nombre", label: "Nombre", grupo: "Datos personales", bodyKey: "nombre", estructural: true },
  { key: "apellido", label: "Apellido", grupo: "Datos personales", bodyKey: "apellido", estructural: true },
  { key: "telefono", label: "Teléfono", grupo: "Datos personales", bodyKey: "telefono" },
  { key: "dni", label: "DNI", grupo: "Datos personales", bodyKey: "dni" },
  { key: "instagram", label: "Instagram", grupo: "Datos personales", bodyKey: "instagram" },
  { key: "escuderia", label: "Escudería", grupo: "Datos deportivos", bodyKey: "escuderia_favorita" },
  { key: "categoria", label: "Categoría", grupo: "Datos deportivos", bodyKey: "categoria" },
  { key: "mejor_tiempo", label: "Mejor tiempo", grupo: "Datos deportivos", bodyKey: "tiempo_clasificacion" },
  { key: "forma_pago", label: "Forma de pago", grupo: "Pago", bodyKey: "metodo_pago" },
  { key: "monto", label: "Monto", grupo: "Pago", bodyKey: "monto" },
  { key: "hora_toma", label: "Hora de toma", grupo: "Operativo (turno)", bodyKey: "hora_toma" },
  { key: "hora_estimada_subida", label: "Hora estimada de subida", grupo: "Operativo (turno)", bodyKey: "hora_estimada_subida" },
  { key: "hora_subida", label: "Hora de subida", grupo: "Operativo (turno)", bodyKey: "hora_subida" },
  { key: "hora_bajada", label: "Hora de bajada", grupo: "Operativo (turno)", bodyKey: "hora_bajada" },
  { key: "cantidad_minutos", label: "Minutos del turno", grupo: "Operativo (turno)", bodyKey: "cantidad_minutos" },
];

export const CAMPO_KEYS: readonly CampoInscripcion[] = CAMPOS_INSCRIPCION.map((c) => c.key);

// ── Presets por modalidad (solo DEFAULTS; el campeonato puede sobrescribir) ─────

// Liga = comportamiento histórico EXACTO: todos visibles; requeridos los mismos de
// siempre (nombre/apellido/teléfono/DNI). El resto opcional.
export const PRESET_LIGA: CamposInscripcion = {
  nombre: "required", apellido: "required", telefono: "required", dni: "required", instagram: "optional",
  escuderia: "optional", categoria: "optional", mejor_tiempo: "optional",
  forma_pago: "optional", monto: "optional",
  hora_toma: "optional", hora_estimada_subida: "optional", hora_subida: "optional", hora_bajada: "optional", cantidad_minutos: "optional",
};

// Eliminación = alta simple (Duelo). Solo datos personales mínimos + pago; el resto
// oculto. El mejor tiempo se carga después en Bracket → Clasificación.
export const PRESET_ELIMINACION: CamposInscripcion = {
  nombre: "required", apellido: "required", telefono: "required", dni: "hidden", instagram: "hidden",
  escuderia: "hidden", categoria: "hidden", mejor_tiempo: "hidden",
  forma_pago: "optional", monto: "hidden",
  hora_toma: "hidden", hora_estimada_subida: "hidden", hora_subida: "hidden", hora_bajada: "hidden", cantidad_minutos: "hidden",
};

export function presetInscripcion(modalidad: unknown): CamposInscripcion {
  return esEliminacion(modalidad) ? { ...PRESET_ELIMINACION } : { ...PRESET_LIGA };
}

function normalizarEstado(v: unknown): EstadoCampo | null {
  return v === "required" || v === "optional" || v === "hidden" ? v : null;
}

// Configuración normalizada del formulario para una fila de campeonato:
// preset por modalidad + overrides de `config.inscripcion.campos`. Estructurales
// (nombre/apellido) quedan SIEMPRE required (no se permite un alta sin identidad).
export function getInscripcionCampos(
  row: { modalidad?: string | null; config?: Record<string, unknown> | null } | null | undefined,
): CamposInscripcion {
  const base = presetInscripcion(row?.modalidad);
  const cfg = row?.config as { inscripcion?: { campos?: Record<string, unknown> } } | null | undefined;
  const overrides = cfg?.inscripcion?.campos;
  if (overrides && typeof overrides === "object") {
    for (const key of CAMPO_KEYS) {
      const e = normalizarEstado((overrides as Record<string, unknown>)[key]);
      if (e) base[key] = e;
    }
  }
  base.nombre = "required";
  base.apellido = "required";
  return base;
}

export const campoVisible = (c: CamposInscripcion, k: CampoInscripcion): boolean => c[k] !== "hidden";
export const campoRequerido = (c: CamposInscripcion, k: CampoInscripcion): boolean => c[k] === "required";

// Estado de pago cuando la inscripción queda PENDIENTE (sin método de pago). Gate
// server-side: sin pago en el stand NUNCA puede quedar "pendiente de cobro en stand".
export function estadoPendientePago(permiteStand: boolean): "pendiente_pago_stand" | "pendiente_pago_online" {
  return permiteStand ? "pendiente_pago_stand" : "pendiente_pago_online";
}

// Campos de TEXTO cuya obligatoriedad se valida directamente. Monto y forma de pago
// tienen su propia lógica (monto se deriva del precio; el pago puede quedar pendiente).
const CAMPOS_TEXTO_VALIDABLES: readonly CampoInscripcion[] = [
  "nombre", "apellido", "telefono", "dni", "instagram", "escuderia", "categoria", "mejor_tiempo",
];

// Devuelve las ETIQUETAS de los campos requeridos que faltan en `valores` (indexado
// por bodyKey). Misma función para frontend y backend → validación idéntica.
export function faltantesRequeridos(campos: CamposInscripcion, valores: Record<string, unknown>): string[] {
  const faltan: string[] = [];
  for (const def of CAMPOS_INSCRIPCION) {
    if (!CAMPOS_TEXTO_VALIDABLES.includes(def.key)) continue;
    if (campos[def.key] !== "required") continue;
    const v = valores[def.bodyKey];
    if (v == null || String(v).trim() === "") faltan.push(def.label);
  }
  return faltan;
}

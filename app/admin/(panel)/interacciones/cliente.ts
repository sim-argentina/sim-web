// Interacciones · cliente de la pantalla del personal (Bloque 3).
// Llamadas a /api/admin/interacciones con timeout, borradores en sessionStorage
// y conversión entre el formulario y el contrato del Bloque 2 (lib/interacciones).
// Sin secretos: la sesión viaja en la cookie httpOnly del panel, nunca acá.

import {
  instanteDeParedSim, paredSim,
  type DatosInteraccion, type Iniciador, type InteraccionDto, type Motivo, type RangoEtario,
  type Respuesta, type Resultado, type TurnoVinculableDto,
} from "@/lib/interacciones";

// ── Llamadas ───────────────────────────────────────────────────────────────
export type FalloApi = {
  ok: false;
  /** red = no hubo respuesta (timeout o conexión): el resultado de una escritura es INCIERTO. */
  tipo: "red" | "http";
  status: number;
  codigo: string | null;
  error: string;
  turnos?: string[];
  turno_stand_id?: string;
  campo?: string;
};
export type RespuestaApi<T> = { ok: true; status: number; data: T } | FalloApi;

const TIMEOUT_MS = 15_000;

export async function pedir<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<RespuestaApi<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const cortar = () => ctrl.abort();
  signal?.addEventListener("abort", cortar);
  try {
    const res = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: ctrl.signal,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    const codigo = typeof json?.codigo === "string" ? json.codigo : null;
    return {
      ok: false, tipo: "http", status: res.status, codigo,
      error: mensajeDeFallo(res.status, typeof json?.error === "string" ? json.error : null),
      turnos: Array.isArray(json?.turnos) ? (json.turnos as unknown[]).map(String) : undefined,
      turno_stand_id: typeof json?.turno_stand_id === "string" ? json.turno_stand_id : undefined,
      campo: typeof json?.campo === "string" ? json.campo : undefined,
    };
  } catch {
    return {
      ok: false, tipo: "red", status: 0, codigo: signal?.aborted ? "cancelado" : null,
      error: "No pudimos comunicarnos con el servidor.",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cortar);
  }
}

function mensajeDeFallo(status: number, delServidor: string | null): string {
  if (status === 401) return "Tu sesión venció. Volvé a ingresar al panel.";
  if (status >= 500 && status !== 503) return "No se pudo completar la operación. Reintentá en un momento.";
  return delServidor ?? "No se pudo completar la operación.";
}

/** Escritura cuyo resultado no se conoce: no hubo respuesta o el servidor falló a mitad. */
export function esIncierto(f: FalloApi): boolean {
  return (f.tipo === "red" && f.codigo !== "cancelado") || (f.status >= 500 && f.status !== 503);
}

export function moduloNoDisponible(f: FalloApi): boolean {
  return f.codigo === "modulo_no_habilitado" || f.codigo === "modulo_no_instalado";
}

const json = (b: unknown) => JSON.stringify(b);
const BASE = "/api/admin/interacciones";

export type EstadoModulo = { instalado: boolean; habilitado: boolean; inicio_registro: string | null };
export type Pagina = { items: InteraccionDto[]; siguiente: string | null; modulo: EstadoModulo };
export type Escritura = { interaccion: InteraccionDto; repetida?: boolean; sin_cambios?: boolean };
export type Vinculables = {
  ventana: { alcance: string; ancla: { instante: string; fecha: string; hora: string }; fecha_desde: string; fecha_hasta: string };
  interaccion: string | null;
  turnos: TurnoVinculableDto[];
};
export type Empleados = {
  empleados: Array<{ id: string; nombre: string }>;
  sugeridos: string[];
  cronograma: { estado: string; fuente: string; oficial: boolean } | null;
};

export const api = {
  listar: (q: URLSearchParams, s?: AbortSignal) => pedir<Pagina>(`${BASE}?${q}`, {}, s),
  obtener: (id: string, s?: AbortSignal) => pedir<{ interaccion: InteraccionDto }>(`${BASE}/${id}`, {}, s),
  registrar: (b: { idempotency_key: string; datos: DatosInteraccion; turnos?: string[] }) =>
    pedir<Escritura>(BASE, { method: "POST", body: json(b) }),
  editar: (id: string, b: { version: number; cambios: DatosInteraccion; confirmar_liberacion?: boolean }) =>
    pedir<Escritura>(`${BASE}/${id}`, { method: "PATCH", body: json(b) }),
  anular: (id: string, b: { version: number; motivo?: string | null }) =>
    pedir<Escritura>(`${BASE}/${id}/anular`, { method: "POST", body: json(b) }),
  vincular: (id: string, b: { version: number; turnos: string[] }) =>
    pedir<Escritura>(`${BASE}/${id}/turnos`, { method: "POST", body: json(b) }),
  desvincular: (id: string, turno: string, version: number) =>
    pedir<Escritura>(`${BASE}/${id}/turnos?${new URLSearchParams({ turno, version: String(version) })}`, { method: "DELETE" }),
  cerrar: (id: string, b: { version: number; motivo: string; nota?: string | null }) =>
    pedir<Escritura>(`${BASE}/${id}/cierre`, { method: "POST", body: json(b) }),
  vinculables: (q: URLSearchParams, s?: AbortSignal) => pedir<Vinculables>(`${BASE}/turnos-vinculables?${q}`, {}, s),
  empleados: (ocurrida: string | null, s?: AbortSignal) =>
    pedir<Empleados>(`${BASE}/empleados${ocurrida ? `?${new URLSearchParams({ ocurrida_en: ocurrida })}` : ""}`, {}, s),
};

// ── Formulario ─────────────────────────────────────────────────────────────
export type Ocurrida =
  | { modo: "ahora" }
  /** valor = "YYYY-MM-DDTHH:MM" en hora de Córdoba. original = el instante guardado (edición). */
  | { modo: "manual"; valor: string; original?: string };

export type EstadoFormulario = {
  resultado: Resultado;
  personas: number;
  hombres: number | null;
  mujeres: number | null;
  rango_etario: RangoEtario | null;
  conocia_sim: Respuesta | null;
  se_subio_antes: Respuesta | null;
  iniciador: Iniciador | null;
  atendio_empleado_id: string | null;
  motivo: Motivo | null;
  observaciones: string;
  ocurrida: Ocurrida;
};

/** Datos mínimos de un turno elegido, para mostrarlo y recordarlo en el borrador. */
export type TurnoElegido = { id: string; fecha: string; hora: string; personas: number | null; minutos: number | null; total: number };

export function formularioVacio(resultado: Resultado): EstadoFormulario {
  return {
    resultado, personas: 1, hombres: null, mujeres: null, rango_etario: null, conocia_sim: null,
    se_subio_antes: null, iniciador: null, atendio_empleado_id: null, motivo: null, observaciones: "",
    ocurrida: { modo: "ahora" },
  };
}

export function formularioDesdeDto(i: InteraccionDto): EstadoFormulario {
  return {
    resultado: i.resultado, personas: i.personas_grupo, hombres: i.hombres, mujeres: i.mujeres,
    rango_etario: i.rango_etario, conocia_sim: i.conocia_sim, se_subio_antes: i.se_subio_antes, iniciador: i.iniciador,
    atendio_empleado_id: i.atendio?.empleado_id ?? null, motivo: i.motivo, observaciones: i.observaciones ?? "",
    ocurrida: { modo: "manual", valor: paredSim(new Date(i.ocurrida_en)).valor, original: i.ocurrida_en },
  };
}

/** Instante ISO de la ocurrida, o null = "ahora" (lo pone el servidor). */
export function instanteDeOcurrida(o: Ocurrida): string | null {
  if (o.modo === "ahora") return null;
  if (o.original && paredSim(new Date(o.original)).valor === o.valor) return o.original;
  const [fecha, hora] = o.valor.split("T");
  return instanteDeParedSim(fecha ?? "", hora ?? "");
}

/** Desglose: los dos cargados o ninguno. */
export function desgloseCompleto(f: EstadoFormulario): boolean {
  return (f.hombres === null) === (f.mujeres === null);
}

/** Datos para la API. "Se subió" nunca lleva motivo; el desglose va de a par. */
export function datosDesdeFormulario(f: EstadoFormulario): DatosInteraccion {
  const obs = f.observaciones.trim();
  return {
    ocurrida_en: instanteDeOcurrida(f.ocurrida),
    resultado: f.resultado,
    personas_grupo: f.personas,
    hombres: f.hombres,
    mujeres: f.mujeres,
    rango_etario: f.rango_etario,
    conocia_sim: f.conocia_sim,
    se_subio_antes: f.se_subio_antes,
    iniciador: f.iniciador,
    atendio_empleado_id: f.atendio_empleado_id,
    motivo: f.resultado === "subio" ? null : f.motivo,
    observaciones: obs === "" ? null : obs,
  };
}

/** Lo que la versión cargada tiene, con la misma forma que datosDesdeFormulario. */
export function datosDesdeDto(i: InteraccionDto): DatosInteraccion {
  return datosDesdeFormulario(formularioDesdeDto(i));
}

/**
 * Rebase de una edición: parte de la versión NUEVA y le vuelve a aplicar solo lo
 * que el usuario cambió (cambiosDeEdicion contra la versión que tenía). Así un
 * campo que el usuario no tocó toma el valor del otro dispositivo, en vez de
 * pisarlo con el valor viejo.
 */
export function rebaseEdicion(nueva: InteraccionDto, cambiosDelUsuario: DatosInteraccion): EstadoFormulario {
  const f = formularioDesdeDto(nueva);
  const c = cambiosDelUsuario;
  if (c.ocurrida_en !== undefined && c.ocurrida_en !== null) f.ocurrida = { modo: "manual", valor: paredSim(new Date(c.ocurrida_en)).valor };
  if (c.resultado !== undefined) f.resultado = c.resultado;
  if (c.personas_grupo !== undefined) f.personas = c.personas_grupo;
  if (c.hombres !== undefined) f.hombres = c.hombres ?? null;
  if (c.mujeres !== undefined) f.mujeres = c.mujeres ?? null;
  if (c.rango_etario !== undefined) f.rango_etario = c.rango_etario ?? null;
  if (c.conocia_sim !== undefined) f.conocia_sim = c.conocia_sim ?? null;
  if (c.se_subio_antes !== undefined) f.se_subio_antes = c.se_subio_antes ?? null;
  if (c.iniciador !== undefined) f.iniciador = c.iniciador ?? null;
  if (c.atendio_empleado_id !== undefined) f.atendio_empleado_id = c.atendio_empleado_id ?? null;
  if (c.motivo !== undefined) f.motivo = c.motivo ?? null;
  if (c.observaciones !== undefined) f.observaciones = c.observaciones ?? "";
  return f;
}

// ── Borradores (sessionStorage) ────────────────────────────────────────────
// Uno para la carga nueva y uno por interacción en edición: nunca se mezclan.
// Sin tokens ni datos de sesión: solo lo que se está cargando.
const CLAVE_ALTA = "sim.interacciones.borrador.alta.v1";
const PREFIJO_EDICION = "sim.interacciones.borrador.edicion.v1.";

export type BorradorAlta = {
  clave: string;
  form: EstadoFormulario;
  turnos: TurnoElegido[];
  /** incierto = se envió y no se sabe si se guardó: misma clave y mismo contenido hasta resolverlo. */
  estado: "editando" | "incierto";
  actualizado: string;
};
export type BorradorEdicion = { id: string; version: number; form: EstadoFormulario; actualizado: string };

function leer<T>(k: string): T | null {
  try {
    const s = window.sessionStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function escribir(k: string, v: unknown) {
  try {
    window.sessionStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: la carga sigue, solo no se recuerda */
  }
}
function borrar(k: string) {
  try {
    window.sessionStorage.removeItem(k);
  } catch {
    /* nada que hacer */
  }
}

function esFormulario(f: unknown): f is EstadoFormulario {
  const o = f as Record<string, unknown> | null;
  return !!o && typeof o.resultado === "string" && typeof o.personas === "number" && typeof o.observaciones === "string"
    && typeof o.ocurrida === "object" && o.ocurrida !== null;
}

export const borradores = {
  alta(): BorradorAlta | null {
    const b = leer<BorradorAlta>(CLAVE_ALTA);
    return b && typeof b.clave === "string" && esFormulario(b.form) && Array.isArray(b.turnos) ? b : null;
  },
  guardarAlta(b: Omit<BorradorAlta, "actualizado">) {
    escribir(CLAVE_ALTA, { ...b, actualizado: new Date().toISOString() });
  },
  borrarAlta() {
    borrar(CLAVE_ALTA);
  },
  edicion(id: string): BorradorEdicion | null {
    const b = leer<BorradorEdicion>(PREFIJO_EDICION + id);
    return b && b.id === id && typeof b.version === "number" && esFormulario(b.form) ? b : null;
  },
  guardarEdicion(b: Omit<BorradorEdicion, "actualizado">) {
    escribir(PREFIJO_EDICION + b.id, { ...b, actualizado: new Date().toISOString() });
  },
  borrarEdicion(id: string) {
    borrar(PREFIJO_EDICION + id);
  },
};

export function nuevaClave(): string {
  return crypto.randomUUID();
}

// ── Presentación ───────────────────────────────────────────────────────────
const MONTO = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const formatoMonto = (n: number) => MONTO.format(n);

export function etiquetaFecha(fecha: string, hoy: string, ayer: string): string {
  if (fecha === hoy) return "Hoy";
  if (fecha === ayer) return "Ayer";
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}${y === hoy.slice(0, 4) ? "" : `/${y}`}`;
}

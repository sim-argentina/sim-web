// Interacciones del stand — contrato PURO (sin servidor ni base). Lo usan las
// rutas de /api/admin/interacciones (Bloque 2) y la pantalla del personal
// (Bloque 3). Es seguro importarlo desde un componente "use client".
//
// La AUTORIDAD es la base (db/interacciones-bloque1.sql): las RPCs vuelven a
// validar todo al escribir. Esto existe para contestar 400 claros y temprano,
// para no aceptar nunca atributos de autoridad desde el cliente y para dar a la
// pantalla las mismas reglas (ventanas, límites) que aplica la base.
//
// Definiciones y contrato HTTP: docs/interacciones.md.

import { ZONA_SIM, diasEntre, fechaValida, hoyEnSim, sumarDias } from "@/lib/agenda";

// ── Límites ────────────────────────────────────────────────────────────────
// Espejo EXACTO de interacciones_limites() (mismas claves y valores). Lo
// controla lib/interacciones.integration.ts contra la base.
export const LIMITES = {
  zona: ZONA_SIM,
  max_turnos_por_interaccion: 4,
  tolerancia_dias_turno: 1,
  staff_dias_retro: 1,
  staff_horas_correccion: 48,
  margen_futuro_minutos: 2,
  personas_grupo_max: 50,
  observaciones_max: 500,
  nota_cierre_max: 300,
  motivo_anulacion_max: 200,
  motivo_eliminacion_max: 200,
} as const;

// Solo de la API (no existen en la base).
export const VENTANA_VINCULABLES_HORAS = 2;
export const LISTADO = {
  limite_defecto: 20,
  limite_max: 100,
  // Staff lista hoy y los dos días anteriores (fecha SIM); las pendientes, de cualquier fecha.
  staff_dias_atras: 2,
} as const;
export const MAX_CUERPO_BYTES = 8192;

// ── Valores permitidos (los mismos CHECK que la base) ──────────────────────
export const RESULTADOS = ["miro", "pregunto", "subio"] as const;
export const RANGOS_ETARIOS = ["menos_14", "14_17", "18_24", "25_34", "35_49", "50_mas"] as const;
export const RESPUESTAS = ["si", "no", "no_sabe"] as const;
export const INICIADORES = ["cliente", "empleado"] as const;
export const MOTIVOS = ["precio", "tiempo", "espera", "vuelve_despues", "no_interesa", "requisitos", "acompanantes", "paseando", "otro"] as const;
// Tipo de grupo: categoría principal, opcional (sin dato ≠ "otro"). No se carga en "Solo miró".
export const TIPOS_GRUPO = ["familia", "amigos", "pareja", "solo", "companeros", "otro"] as const;
export const MOTIVOS_CIERRE = ["sin_turno_en_turnero", "turno_no_identificable", "otro"] as const;
export const ESTADOS_VINCULO = ["no_aplica", "con_turno", "turno_no_activo", "cerrada_sin_turno", "pendiente", "anulada"] as const;
export const ALCANCES_VINCULABLES = ["2h", "dia", "tolerancia"] as const;

export type Resultado = (typeof RESULTADOS)[number];
export type RangoEtario = (typeof RANGOS_ETARIOS)[number];
export type TipoGrupo = (typeof TIPOS_GRUPO)[number];
export type Respuesta = (typeof RESPUESTAS)[number];
export type Iniciador = (typeof INICIADORES)[number];
export type Motivo = (typeof MOTIVOS)[number];
export type MotivoCierre = (typeof MOTIVOS_CIERRE)[number];
export type EstadoVinculo = (typeof ESTADOS_VINCULO)[number];
export type AlcanceVinculables = (typeof ALCANCES_VINCULABLES)[number];
export type Rol = "admin" | "staff";

export const ETIQUETAS = {
  resultado: { miro: "Solo miró", pregunto: "Miró y preguntó", subio: "Se subió" },
  rango_etario: { menos_14: "Menos de 14", "14_17": "14–17", "18_24": "18–24", "25_34": "25–34", "35_49": "35–49", "50_mas": "50+" },
  tipo_grupo: { familia: "Familia", amigos: "Amigos", pareja: "Pareja/s", solo: "Solo/a", companeros: "Compañeros", otro: "Otro" },
  respuesta: { si: "Sí", no: "No", no_sabe: "No sabe" },
  iniciador: { cliente: "Cliente", empleado: "Empleado" },
  motivo: {
    precio: "Precio", tiempo: "Falta de tiempo", espera: "Espera", vuelve_despues: "Volvía después",
    no_interesa: "No le interesó", requisitos: "Requisitos/altura", acompanantes: "Acompañantes", paseando: "Paseando", otro: "Otro",
  },
  motivo_cierre: {
    sin_turno_en_turnero: "Se subió pero el turno no está en el Turnero",
    turno_no_identificable: "No se puede identificar el turno",
    otro: "Otro",
  },
  vinculo: {
    no_aplica: "Sin turno (no se subió)", con_turno: "Con turno vinculado", turno_no_activo: "Turno no activo",
    cerrada_sin_turno: "Subida declarada sin turno", pendiente: "Pendiente de vincular", anulada: "Anulada",
  },
} as const;

// Campos de datos que acepta el alta y la edición (los mismos que la RPC).
// rango_etario (un solo valor) es la forma de la pantalla ANTERIOR: se acepta
// para que una pestaña vieja o un borrador viejo sigan funcionando; la base lo
// convierte en una lista de uno y rechaza (cliente_desactualizado) la edición
// que truncaría varios rangos. La forma nueva es rangos_etarios.
export const CAMPOS_DATOS = [
  "ocurrida_en", "resultado", "personas_grupo", "hombres", "mujeres", "rango_etario", "rangos_etarios", "tipo_grupo",
  "conocia_sim", "se_subio_antes", "iniciador", "atendio_empleado_id", "motivo", "observaciones",
] as const;
export type CampoDatos = (typeof CAMPOS_DATOS)[number];

// Atributos de autoridad o auditoría: NUNCA vienen del cliente. Se rechazan con
// 400 (no se ignoran en silencio) para que un cliente roto o malicioso se note.
export const CAMPOS_PROHIBIDOS = [
  "rol", "role", "actor", "registrada_por_rol", "registrada_en", "actualizada_por_rol", "actualizada_en",
  "anulada_en", "anulada_por_rol", "cerrada_en", "cerrada_por_rol", "vinculado_por_rol", "vinculado_en",
  "alta_huella", "id", "fecha_negocio", "hora_negocio", "cierre_motivo", "cierre_nota", "anulada_motivo",
  "eliminada_en", "eliminada_por_rol", "eliminada_motivo",
  "nombre", "telefono",
] as const;

// ── Errores ────────────────────────────────────────────────────────────────
export type ErrorApi = {
  status: 400 | 401 | 403 | 404 | 409 | 503;
  codigo: string;
  error: string;
  campo?: string;
  turno_stand_id?: string;
  turnos?: string[];
};
export type Resultado400<T> = { ok: true; valor: T } | { ok: false; e: ErrorApi };

const MENSAJES: Record<string, { status: ErrorApi["status"]; error: string }> = {
  // 400 · entrada inválida
  campo_invalido: { status: 400, error: "Hay un dato inválido." },
  campo_desconocido: { status: 400, error: "La solicitud trae un dato que no corresponde." },
  campo_no_permitido: { status: 400, error: "La solicitud trae un dato que no se puede enviar." },
  datos_invalidos: { status: 400, error: "Solicitud inválida." },
  desglose_incompleto: { status: 400, error: "Completá hombres y mujeres, o dejá los dos vacíos." },
  desglose_no_suma: { status: 400, error: "Hombres y mujeres tienen que sumar la cantidad de personas." },
  motivo_no_aplica: { status: 400, error: "Si se subió no corresponde un motivo de no compra: quitá el motivo." },
  rangos_repetidos: { status: 400, error: "Hay rangos de edad repetidos." },
  rangos_superan_personas: { status: 400, error: "Hay más rangos de edad marcados que personas en el grupo: quitá rangos o sumá personas." },
  turnos_repetidos: { status: 400, error: "Hay turnos repetidos." },
  ocurrida_en_futura: { status: 400, error: "La hora de la interacción no puede ser futura." },
  ocurrida_en_antes_del_inicio: { status: 400, error: "La fecha es anterior al inicio del registro de interacciones." },
  empleado_no_disponible: { status: 400, error: "Ese integrante no está disponible." },
  turno_fuera_de_tolerancia: { status: 400, error: "Ese turno es de otro día: no corresponde a esta interacción." },
  maximo_turnos_por_interaccion_pedido: { status: 400, error: `Se pueden vincular hasta ${LIMITES.max_turnos_por_interaccion} turnos.` },
  // 403 · rol, ventana u operación no permitida
  fuera_de_ventana: { status: 403, error: "Ya no se puede hacer este cambio desde staff." },
  solo_admin: { status: 403, error: "Solo un administrador puede hacer esto." },
  actor_invalido: { status: 403, error: "No autorizado." },
  // 404
  interaccion_inexistente: { status: 404, error: "La interacción no existe." },
  interaccion_eliminada: { status: 404, error: "Esta interacción fue borrada por un administrador." },
  turno_inexistente: { status: 404, error: "El turno no existe (¿se borró en el Turnero?)." },
  vinculo_inexistente: { status: 404, error: "Ese turno no está vinculado a esta interacción." },
  // 409 · conflicto de estado
  version_desactualizada: { status: 409, error: "Otro dispositivo cambió esta interacción. Recargá y volvé a intentar." },
  idempotency_key_con_otro_payload: { status: 409, error: "Ya se registró una interacción con esta clave y otros datos." },
  turno_ya_vinculado: { status: 409, error: "Ese turno ya está vinculado a otra interacción." },
  maximo_turnos_por_interaccion: { status: 409, error: `La interacción ya tiene ${LIMITES.max_turnos_por_interaccion} turnos vinculados.` },
  interaccion_anulada: { status: 409, error: "La interacción está anulada." },
  resultado_no_admite_vinculos: { status: 409, error: "Solo una interacción \"Se subió\" puede tener turnos." },
  resultado_no_admite_cierre: { status: 409, error: "Solo una interacción \"Se subió\" se puede cerrar sin turno." },
  tiene_turnos_vinculados: { status: 409, error: "La interacción tiene turnos vinculados." },
  cierre_vigente: { status: 409, error: "La interacción está cerrada sin turno." },
  turno_no_activo: { status: 409, error: "Ese turno no está activo." },
  confirmar_liberacion: { status: 409, error: "Este cambio libera los turnos vinculados o retira el cierre: confirmalo para seguir." },
  cliente_desactualizado: { status: 409, error: "Esta pantalla quedó desactualizada y no puede cambiar las edades sin perder rangos: recargá la página y volvé a intentar." },
  // 503 · módulo
  modulo_no_habilitado: { status: 503, error: "El registro de interacciones todavía no está habilitado." },
  altas_pausadas: { status: 503, error: "La carga de nuevas interacciones está pausada. Las ya registradas se pueden consultar y corregir." },
  modulo_no_instalado: { status: 503, error: "El módulo de interacciones no está disponible." },
};

export function errorApi(codigo: string, extra: Partial<ErrorApi> = {}): ErrorApi {
  const m = MENSAJES[codigo] ?? MENSAJES.datos_invalidos;
  return { status: m.status, codigo: MENSAJES[codigo] ? codigo : "datos_invalidos", error: m.error, ...extra };
}

function falla<T>(codigo: string, extra: Partial<ErrorApi> = {}): Resultado400<T> {
  return { ok: false, e: errorApi(codigo, extra) };
}

// Códigos de PostgREST/Postgres que significan "la migración no está aplicada".
const CODIGOS_NO_INSTALADO = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

// Traduce un error de las RPCs ({ code, message } de PostgREST) a la respuesta
// HTTP. Devuelve null si no es un error conocido: la ruta contesta 500 genérico
// y lo registra en el servidor. Nunca reenvía el mensaje SQL al navegador.
export function errorDeRpc(err: { code?: string | null; message?: string | null } | null | undefined): ErrorApi | null {
  if (!err) return null;
  if (err.code && CODIGOS_NO_INSTALADO.has(err.code)) return errorApi("modulo_no_instalado");
  const msg = String(err.message ?? "");
  const i = msg.indexOf(":");
  const codigo = i >= 0 ? msg.slice(0, i) : msg;
  const detalle = i >= 0 ? msg.slice(i + 1) : "";
  if (codigo === "registro_no_iniciado") return errorApi("modulo_no_habilitado");
  if (codigo === "campo_invalido" || codigo === "campo_desconocido") {
    return /^[a-z_]{1,40}$/.test(detalle) ? errorApi(codigo, { campo: detalle }) : errorApi(codigo);
  }
  if (["turno_ya_vinculado", "turno_inexistente", "turno_fuera_de_tolerancia", "turno_no_activo"].includes(codigo)) {
    const id = normalizarIdTurno(detalle);
    return errorApi(codigo, id ? { turno_stand_id: id } : {});
  }
  return MENSAJES[codigo] ? errorApi(codigo) : null;
}

// ── IDs ────────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT8_MIN = BigInt("-9223372036854775808");
const INT8_MAX = BigInt("9223372036854775807");

export function esUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// IDs bigint de turnos: SIEMPRE como cadena decimal canónica (sin "+", sin ceros
// a la izquierda, dentro de int8). Un número de JSON se rechaza: por encima de
// 2^53 ya llegó redondeado y no hay forma de saber cuál era.
export function normalizarIdTurno(v: unknown): string | null {
  if (typeof v !== "string" || !/^-?(0|[1-9]\d{0,18})$/.test(v) || v === "-0") return null;
  const b = BigInt(v);
  return b >= INT8_MIN && b <= INT8_MAX ? b.toString() : null;
}

function listaDeTurnos(v: unknown, min: number): Resultado400<string[]> {
  if (v === undefined || v === null) return min === 0 ? { ok: true, valor: [] } : falla("campo_invalido", { campo: "turnos" });
  if (!Array.isArray(v)) return falla("campo_invalido", { campo: "turnos" });
  const ids: string[] = [];
  for (const x of v) {
    const id = normalizarIdTurno(x);
    if (!id) return falla("campo_invalido", { campo: "turnos" });
    if (ids.includes(id)) return falla("turnos_repetidos");
    ids.push(id);
  }
  if (ids.length < min) return falla("campo_invalido", { campo: "turnos" });
  if (ids.length > LIMITES.max_turnos_por_interaccion) return falla("maximo_turnos_por_interaccion_pedido");
  return { ok: true, valor: ids };
}

// ── Datos de la interacción ────────────────────────────────────────────────
export type DatosInteraccion = {
  ocurrida_en?: string | null;
  resultado?: Resultado;
  personas_grupo?: number;
  hombres?: number | null;
  mujeres?: number | null;
  /** Rangos presentes (orden canónico). [] = sin dato; omitido = no cambia. */
  rangos_etarios?: RangoEtario[];
  tipo_grupo?: TipoGrupo | null;
  /** Solo de la pantalla anterior (un valor); nunca junto con rangos_etarios. */
  rango_etario?: RangoEtario | null;
  conocia_sim?: Respuesta | null;
  se_subio_antes?: Respuesta | null;
  iniciador?: Iniciador | null;
  atendio_empleado_id?: string | null;
  motivo?: Motivo | null;
  observaciones?: string | null;
};

// ISO con zona explícita (Z u offset), igual que la base: sin zona, la hora
// dependería de dónde corre el servidor.
const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

export function instanteValido(v: unknown): v is string {
  return typeof v === "string" && ISO_CON_ZONA.test(v) && !Number.isNaN(Date.parse(v.replace(" ", "T")));
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function claveProhibida(o: Record<string, unknown>): string | null {
  for (const k of Object.keys(o)) if ((CAMPOS_PROHIBIDOS as readonly string[]).includes(k)) return k;
  return null;
}

function enumOpcional<T extends string>(v: unknown, lista: readonly T[]): v is T | null {
  return v === null || (typeof v === "string" && (lista as readonly string[]).includes(v));
}

function enteroEn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Rangos sin repetidos y en el orden fijo de las opciones (el orden de los clics no cambia el dato). */
export function rangosCanonicos(lista: readonly RangoEtario[]): RangoEtario[] {
  return RANGOS_ETARIOS.filter((r) => lista.includes(r));
}

/**
 * Valida los datos de una interacción.
 *  · "alta": resultado y personas_grupo obligatorios; el resto opcional y anulable.
 *  · "cambios": edición PARCIAL. Solo se validan las claves presentes; una clave
 *    ausente no cambia nada y null la vacía. Al menos una clave.
 * Rechaza claves desconocidas y atributos de autoridad. No completa ni borra nada
 * por su cuenta: un motivo con "subio" es un error, no se descarta en silencio.
 */
export function validarDatos(input: unknown, modo: "alta" | "cambios"): Resultado400<DatosInteraccion> {
  if (!esObjeto(input)) return falla("datos_invalidos");
  const prohibida = claveProhibida(input);
  if (prohibida) return falla("campo_no_permitido", { campo: prohibida });
  for (const k of Object.keys(input)) {
    if (!(CAMPOS_DATOS as readonly string[]).includes(k)) return falla("campo_desconocido", { campo: k.slice(0, 40) });
  }
  const tiene = (k: CampoDatos) => Object.prototype.hasOwnProperty.call(input, k);
  if (modo === "cambios" && Object.keys(input).length === 0) return falla("datos_invalidos");
  const d: DatosInteraccion = {};

  if (tiene("ocurrida_en")) {
    const v = input.ocurrida_en;
    if (v === null && modo === "alta") d.ocurrida_en = null;
    else if (!instanteValido(v)) return falla("campo_invalido", { campo: "ocurrida_en" });
    else d.ocurrida_en = v;
  }
  if (tiene("resultado") || modo === "alta") {
    if (!(RESULTADOS as readonly unknown[]).includes(input.resultado)) return falla("campo_invalido", { campo: "resultado" });
    d.resultado = input.resultado as Resultado;
  }
  if (tiene("personas_grupo") || modo === "alta") {
    if (!enteroEn(input.personas_grupo, 1, LIMITES.personas_grupo_max)) return falla("campo_invalido", { campo: "personas_grupo" });
    d.personas_grupo = input.personas_grupo;
  }
  if (tiene("hombres") !== tiene("mujeres")) {
    // El desglose es un par: se carga, cambia o vacía junto.
    if (modo === "cambios" || (input.hombres ?? null) !== null || (input.mujeres ?? null) !== null) return falla("desglose_incompleto");
  }
  if (tiene("hombres") || tiene("mujeres")) {
    const h = input.hombres ?? null;
    const m = input.mujeres ?? null;
    if ((h === null) !== (m === null)) return falla("desglose_incompleto");
    if (h !== null && !enteroEn(h, 0, LIMITES.personas_grupo_max)) return falla("campo_invalido", { campo: "hombres" });
    if (m !== null && !enteroEn(m, 0, LIMITES.personas_grupo_max)) return falla("campo_invalido", { campo: "mujeres" });
    if (h !== null && m !== null && d.personas_grupo !== undefined && h + m !== d.personas_grupo) return falla("desglose_no_suma");
    d.hombres = h as number | null;
    d.mujeres = m as number | null;
  }
  if (tiene("rangos_etarios")) {
    if (tiene("rango_etario")) return falla("campo_invalido", { campo: "rangos_etarios" });
    const v = input.rangos_etarios ?? [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !(RANGOS_ETARIOS as readonly string[]).includes(x))) {
      return falla("campo_invalido", { campo: "rangos_etarios" });
    }
    if (new Set(v).size !== v.length) return falla("rangos_repetidos");
    const rangos = rangosCanonicos(v as RangoEtario[]);
    if (d.personas_grupo !== undefined && rangos.length > d.personas_grupo) return falla("rangos_superan_personas");
    d.rangos_etarios = rangos;
  }
  for (const [campo, lista] of [
    ["rango_etario", RANGOS_ETARIOS], ["tipo_grupo", TIPOS_GRUPO], ["conocia_sim", RESPUESTAS], ["se_subio_antes", RESPUESTAS], ["iniciador", INICIADORES],
  ] as const) {
    if (!tiene(campo)) continue;
    if (!enumOpcional(input[campo], lista)) return falla("campo_invalido", { campo });
    (d as Record<string, unknown>)[campo] = input[campo];
  }
  if (tiene("motivo")) {
    if (!enumOpcional(input.motivo, MOTIVOS)) return falla("campo_invalido", { campo: "motivo" });
    if (input.motivo !== null && d.resultado === "subio") return falla("motivo_no_aplica");
    d.motivo = input.motivo as Motivo | null;
  }
  if (tiene("observaciones")) {
    const v = input.observaciones;
    if (v !== null && typeof v !== "string") return falla("campo_invalido", { campo: "observaciones" });
    const t = typeof v === "string" ? v.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "") : "";
    if (t.length > LIMITES.observaciones_max) return falla("campo_invalido", { campo: "observaciones" });
    d.observaciones = t === "" ? null : t;
  }
  if (tiene("atendio_empleado_id")) {
    const v = input.atendio_empleado_id;
    if (v !== null && !esUuid(v)) return falla("campo_invalido", { campo: "atendio_empleado_id" });
    d.atendio_empleado_id = v === null ? null : (v as string).toLowerCase();
  }
  return { ok: true, valor: d };
}

// ── Cuerpos de cada operación ──────────────────────────────────────────────
function soloClaves(o: Record<string, unknown>, permitidas: readonly string[]): Resultado400<true> {
  const prohibida = claveProhibida(o);
  if (prohibida) return falla("campo_no_permitido", { campo: prohibida });
  for (const k of Object.keys(o)) if (!permitidas.includes(k)) return falla("campo_desconocido", { campo: k.slice(0, 40) });
  return { ok: true, valor: true };
}

function version(v: unknown): Resultado400<number> {
  return enteroEn(v, 1, 2_147_483_647) ? { ok: true, valor: v } : falla("campo_invalido", { campo: "version" });
}

export type CuerpoAlta = { idempotency_key: string; datos: DatosInteraccion; turnos: string[] };

/** POST /api/admin/interacciones → { idempotency_key, datos, turnos? }. */
export function validarCuerpoAlta(body: unknown): Resultado400<CuerpoAlta> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const c = soloClaves(body, ["idempotency_key", "datos", "turnos"]);
  if (!c.ok) return c;
  if (!esUuid(body.idempotency_key)) return falla("campo_invalido", { campo: "idempotency_key" });
  const datos = validarDatos(body.datos, "alta");
  if (!datos.ok) return datos;
  const turnos = listaDeTurnos(body.turnos, 0);
  if (!turnos.ok) return turnos;
  if (turnos.valor.length > 0 && datos.valor.resultado !== "subio") return falla("resultado_no_admite_vinculos", { status: 400 });
  return { ok: true, valor: { idempotency_key: body.idempotency_key.toLowerCase(), datos: datos.valor, turnos: turnos.valor } };
}

export type CuerpoEdicion = { version: number; cambios: DatosInteraccion; confirmar_liberacion: boolean };

/** PATCH /api/admin/interacciones/[id] → { version, cambios, confirmar_liberacion? }. */
export function validarCuerpoEdicion(body: unknown): Resultado400<CuerpoEdicion> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const c = soloClaves(body, ["version", "cambios", "confirmar_liberacion"]);
  if (!c.ok) return c;
  const v = version(body.version);
  if (!v.ok) return v;
  const cambios = validarDatos(body.cambios, "cambios");
  if (!cambios.ok) return cambios;
  const confirmar = body.confirmar_liberacion;
  if (confirmar !== undefined && typeof confirmar !== "boolean") return falla("campo_invalido", { campo: "confirmar_liberacion" });
  return { ok: true, valor: { version: v.valor, cambios: cambios.valor, confirmar_liberacion: confirmar === true } };
}

/** POST /api/admin/interacciones/[id]/turnos → { version, turnos }. */
export function validarCuerpoVinculo(body: unknown): Resultado400<{ version: number; turnos: string[] }> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const c = soloClaves(body, ["version", "turnos"]);
  if (!c.ok) return c;
  const v = version(body.version);
  if (!v.ok) return v;
  const t = listaDeTurnos(body.turnos, 1);
  if (!t.ok) return t;
  return { ok: true, valor: { version: v.valor, turnos: t.valor } };
}

/** DELETE /api/admin/interacciones/[id]/turnos?turno=<id>&version=<n>. */
export function validarDesvinculo(params: URLSearchParams): Resultado400<{ version: number; turno: string }> {
  for (const k of params.keys()) if (k !== "turno" && k !== "version") return falla("campo_desconocido", { campo: k.slice(0, 40) });
  const turno = normalizarIdTurno(params.get("turno"));
  if (!turno) return falla("campo_invalido", { campo: "turno" });
  const crudo = params.get("version") ?? "";
  if (!/^[1-9]\d{0,9}$/.test(crudo)) return falla("campo_invalido", { campo: "version" });
  const v = version(Number(crudo));
  if (!v.ok) return v;
  return { ok: true, valor: { version: v.valor, turno } };
}

function textoOpcional(v: unknown, max: number, campo: string): Resultado400<string | null> {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== "string") return falla("campo_invalido", { campo });
  const t = v.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (t.length > max) return falla("campo_invalido", { campo });
  return { ok: true, valor: t === "" ? null : t };
}

/** POST /api/admin/interacciones/[id]/anular → { version, motivo? }. */
export function validarCuerpoAnulacion(body: unknown): Resultado400<{ version: number; motivo: string | null }> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const c = soloClaves(body, ["version", "motivo"]);
  if (!c.ok) return c;
  const v = version(body.version);
  if (!v.ok) return v;
  const m = textoOpcional(body.motivo, LIMITES.motivo_anulacion_max, "motivo");
  if (!m.ok) return m;
  return { ok: true, valor: { version: v.valor, motivo: m.valor } };
}

/** POST /api/admin/interacciones/[id]/eliminar → { version, motivo? } (solo admin; el motivo es opcional). */
export function validarCuerpoEliminacion(body: unknown): Resultado400<{ version: number; motivo: string | null }> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const c = soloClaves(body, ["version", "motivo"]);
  if (!c.ok) return c;
  const v = version(body.version);
  if (!v.ok) return v;
  const m = textoOpcional(body.motivo, LIMITES.motivo_eliminacion_max, "motivo");
  if (!m.ok) return m;
  return { ok: true, valor: { version: v.valor, motivo: m.valor } };
}

/** POST /api/admin/interacciones/[id]/cierre → { version, motivo, nota? } (solo admin). */
export function validarCuerpoCierre(body: unknown): Resultado400<{ version: number; motivo: MotivoCierre; nota: string | null }> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const c = soloClaves(body, ["version", "motivo", "nota"]);
  if (!c.ok) return c;
  const v = version(body.version);
  if (!v.ok) return v;
  if (!(MOTIVOS_CIERRE as readonly unknown[]).includes(body.motivo)) return falla("campo_invalido", { campo: "cierre_motivo" });
  const n = textoOpcional(body.nota, LIMITES.nota_cierre_max, "cierre_nota");
  if (!n.ok) return n;
  if (body.motivo === "otro" && n.valor === null) return falla("campo_invalido", { campo: "cierre_nota" });
  return { ok: true, valor: { version: v.valor, motivo: body.motivo as MotivoCierre, nota: n.valor } };
}

// ── Fechas y ventanas (hora de Córdoba, reloj inyectable) ──────────────────
const FMT_HORA = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_SIM, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Fecha SIM (YYYY-MM-DD) de un instante. */
export function fechaSim(instante: Date): string {
  return hoyEnSim(instante);
}

/** Hora SIM (HH:MM) de un instante. */
export function horaSim(instante: Date): string {
  return FMT_HORA.format(instante);
}

/** Minuto absoluto de una fecha+hora de pared de SIM (para comparar sin zona). */
export function minutoLocal(fecha: string, hora: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(hora);
  if (!fechaValida(fecha) || !m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return diasEntre("1970-01-01", fecha) * 1440 + h * 60 + mi;
}

/**
 * Staff: ¿puede declarar que la interacción ocurrió en `ocurrida`? Desde las
 * 00:00:00 (Córdoba) del día calendario ANTERIOR al de `referencia` (el alta),
 * nunca 24 h móviles. Igual que interacciones_validar_ocurrida().
 */
export function staffPuedeDeclarar(ocurrida: Date, referencia: Date): boolean {
  return fechaSim(ocurrida) >= sumarDias(fechaSim(referencia), -LIMITES.staff_dias_retro);
}

/** Staff: edita, anula y desvincula hasta registrada_en + 48 h (inclusive). */
export function staffPuedeCorregir(registrada: Date, ahora: Date): boolean {
  return ahora.getTime() <= registrada.getTime() + LIMITES.staff_horas_correccion * 3_600_000;
}

/** ¿El instante es "futuro" para la base (más allá del margen de reloj)? */
export function esFuturo(ocurrida: Date, ahora: Date): boolean {
  return ocurrida.getTime() > ahora.getTime() + LIMITES.margen_futuro_minutos * 60_000;
}

/** Fecha y hora de pared de SIM de un instante (para un <input type="datetime-local">). */
export function paredSim(instante: Date): { fecha: string; hora: string; valor: string } {
  const fecha = fechaSim(instante);
  const hora = horaSim(instante);
  return { fecha, hora, valor: `${fecha}T${hora}` };
}

/**
 * Instante (ISO UTC) cuya hora de pared en SIM es fecha+hora. No supone el
 * huso: lo deduce con la misma zona que usa todo el módulo. Null si es inválida.
 */
export function instanteDeParedSim(fecha: string, hora: string): string | null {
  const objetivo = minutoLocal(fecha, hora);
  if (objetivo === null) return null;
  const [y, mo, d] = fecha.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = paredSim(new Date(t));
    const actual = minutoLocal(p.fecha, p.hora)!;
    if (actual === objetivo) return new Date(t).toISOString();
    t += (objetivo - actual) * 60_000;
  }
  return null;
}

/** Primer instante que staff puede declarar hoy: 00:00 del día calendario anterior (SIM). */
export function minimoDeclarableStaff(ahora: Date): string {
  return `${sumarDias(fechaSim(ahora), -LIMITES.staff_dias_retro)}T00:00`;
}

/**
 * Cambios de una edición: SOLO las claves que cambiaron respecto de la versión
 * cargada (`base`). Una clave vaciada viaja como null; una que no se tocó no
 * viaja (el servidor la conserva). El desglose viaja de a par. Pasar a "subio"
 * con un motivo cargado incluye motivo: null, que la pantalla muestra antes.
 */
export function cambiosDeEdicion(base: DatosInteraccion, nuevo: DatosInteraccion): DatosInteraccion {
  const c: DatosInteraccion = {};
  const mismoInstante = (a?: string | null, b?: string | null) =>
    (a ?? null) === (b ?? null) || (a != null && b != null && Date.parse(a.replace(" ", "T")) === Date.parse(b.replace(" ", "T")));
  if (nuevo.ocurrida_en !== undefined && !mismoInstante(base.ocurrida_en, nuevo.ocurrida_en)) c.ocurrida_en = nuevo.ocurrida_en;
  for (const k of ["resultado", "personas_grupo", "tipo_grupo", "conocia_sim", "se_subio_antes", "iniciador", "atendio_empleado_id", "motivo", "observaciones"] as const) {
    if (nuevo[k] === undefined) continue;
    const a = base[k] ?? null;
    const b = nuevo[k] ?? null;
    if (a !== b) (c as Record<string, unknown>)[k] = b;
  }
  if (nuevo.rangos_etarios !== undefined) {
    const a = rangosCanonicos(base.rangos_etarios ?? []);
    const b = rangosCanonicos(nuevo.rangos_etarios);
    if (a.join(",") !== b.join(",")) c.rangos_etarios = b;
  }
  if ((nuevo.hombres !== undefined || nuevo.mujeres !== undefined)
      && ((base.hombres ?? null) !== (nuevo.hombres ?? null) || (base.mujeres ?? null) !== (nuevo.mujeres ?? null))) {
    c.hombres = nuevo.hombres ?? null;
    c.mujeres = nuevo.mujeres ?? null;
  }
  if (c.resultado === "subio" && (base.motivo ?? null) !== null) c.motivo = null;
  return c;
}

export type VentanaVinculables = {
  alcance: AlcanceVinculables;
  ancla: { instante: string; fecha: string; hora: string };
  fecha_desde: string;
  fecha_hasta: string;
  // Rango de minutos locales (inclusive) para filtrar por fecha+hora del turno.
  minuto_desde: number;
  minuto_hasta: number;
};

/**
 * Ventana de turnos sugeridos alrededor de `ancla` (la hora de la interacción):
 *  · "2h"         las dos horas PREVIAS (hora de toma del turno), cruzando la medianoche si hace falta;
 *  · "dia"        todo el día SIM de la interacción;
 *  · "tolerancia" el día anterior, el de la interacción y el siguiente (el máximo que acepta la base).
 * Nunca sale de la tolerancia: lo que esta ventana muestra, la RPC lo acepta (salvo
 * que otro lo vincule antes).
 */
export function ventanaVinculables(ancla: Date, alcance: AlcanceVinculables = "2h"): VentanaVinculables {
  const fecha = fechaSim(ancla);
  const hora = horaSim(ancla);
  const m = minutoLocal(fecha, hora)!;
  const base = { alcance, ancla: { instante: ancla.toISOString(), fecha, hora } };
  if (alcance === "dia") {
    const ini = minutoLocal(fecha, "00:00")!;
    return { ...base, fecha_desde: fecha, fecha_hasta: fecha, minuto_desde: ini, minuto_hasta: ini + 1439 };
  }
  if (alcance === "tolerancia") {
    const desde = sumarDias(fecha, -LIMITES.tolerancia_dias_turno);
    const hasta = sumarDias(fecha, LIMITES.tolerancia_dias_turno);
    return { ...base, fecha_desde: desde, fecha_hasta: hasta, minuto_desde: minutoLocal(desde, "00:00")!, minuto_hasta: minutoLocal(hasta, "23:59")! };
  }
  const desde = m - VENTANA_VINCULABLES_HORAS * 60;
  const fechaDesde = desde < minutoLocal(fecha, "00:00")! ? sumarDias(fecha, -1) : fecha;
  return { ...base, fecha_desde: fechaDesde, fecha_hasta: fecha, minuto_desde: desde, minuto_hasta: m };
}

// ── Listados ───────────────────────────────────────────────────────────────
export type FiltrosListado = {
  desde: string | null;
  hasta: string | null;
  resultado: Resultado | null;
  estado: EstadoVinculo | null;
  incluir_anuladas: boolean;
  limite: number;
  cursor: { ocurrida_en: string; id: string } | null;
};

const PARAMS_LISTADO = ["desde", "hasta", "resultado", "estado", "incluir_anuladas", "limite", "cursor"];

// Cursor opaco: base64url de [ocurrida_en, id]. Solo ASCII, así que btoa/atob
// alcanzan (y existen igual en el navegador y en Node).
export function codificarCursor(c: { ocurrida_en: string; id: string }): string {
  return btoa(JSON.stringify([c.ocurrida_en, c.id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodificarCursor(s: string): { ocurrida_en: string; id: string } | null {
  try {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(s)) return null;
    const v = JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
    if (!Array.isArray(v) || v.length !== 2 || !esUuid(v[1]) || typeof v[0] !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)$/.test(v[0])) return null;
    return { ocurrida_en: v[0], id: v[1] };
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/interacciones. Sin fechas: hoy (SIM). Orden estable:
 * ocurrida_en desc, id desc; paginación por cursor (no por offset).
 * Staff: fechas dentro de hoy − 2 … hoy, salvo estado=pendiente (cualquier fecha),
 * que es lo que necesita para completar pendientes viejas.
 */
export function validarFiltrosListado(params: URLSearchParams, rol: Rol, ahora: Date): Resultado400<FiltrosListado> {
  for (const k of params.keys()) if (!PARAMS_LISTADO.includes(k)) return falla("campo_desconocido", { campo: k.slice(0, 40) });
  const hoy = fechaSim(ahora);
  const estado = params.get("estado");
  if (estado !== null && !(ESTADOS_VINCULO as readonly string[]).includes(estado)) return falla("campo_invalido", { campo: "estado" });
  const resultado = params.get("resultado");
  if (resultado !== null && !(RESULTADOS as readonly string[]).includes(resultado)) return falla("campo_invalido", { campo: "resultado" });
  const pendientes = estado === "pendiente";
  let desde = params.get("desde");
  let hasta = params.get("hasta");
  if (desde !== null && !fechaValida(desde)) return falla("campo_invalido", { campo: "desde" });
  if (hasta !== null && !fechaValida(hasta)) return falla("campo_invalido", { campo: "hasta" });
  if (desde === null && hasta === null && !pendientes) {
    desde = hoy;
    hasta = hoy;
  }
  if (desde !== null && hasta !== null && desde > hasta) return falla("campo_invalido", { campo: "desde" });
  if (rol === "staff" && !pendientes) {
    const minimo = sumarDias(hoy, -LISTADO.staff_dias_atras);
    if ((desde ?? minimo) < minimo || (hasta ?? hoy) > hoy || desde === null) return falla("fuera_de_ventana");
  }
  const incl = params.get("incluir_anuladas");
  if (incl !== null && incl !== "0" && incl !== "1") return falla("campo_invalido", { campo: "incluir_anuladas" });
  const limCrudo = params.get("limite");
  let limite: number = LISTADO.limite_defecto;
  if (limCrudo !== null) {
    if (!/^\d{1,3}$/.test(limCrudo) || Number(limCrudo) < 1 || Number(limCrudo) > LISTADO.limite_max) return falla("campo_invalido", { campo: "limite" });
    limite = Number(limCrudo);
  }
  const cursorCrudo = params.get("cursor");
  const cursor = cursorCrudo === null ? null : decodificarCursor(cursorCrudo);
  if (cursorCrudo !== null && !cursor) return falla("campo_invalido", { campo: "cursor" });
  return {
    ok: true,
    valor: {
      desde, hasta, resultado: resultado as Resultado | null, estado: estado as EstadoVinculo | null,
      incluir_anuladas: incl === "1" || estado === "anulada", limite, cursor,
    },
  };
}

export type ParamsVinculables = {
  interaccion: string | null;
  ocurrida_en: string | null;
  alcance: AlcanceVinculables;
  hora: string | null;
  personas: number | null;
  minutos: number | null;
  incluir_vinculados: boolean;
};

/**
 * GET /api/admin/interacciones/turnos-vinculables. Ancla: la interacción
 * (?interaccion=<uuid>), una hora (?ocurrida_en=ISO con zona) o, sin nada, ahora.
 * Búsqueda: hora (prefijo literal de "HH:MM": "19", "19:5"), personas, minutos.
 */
export function validarParamsVinculables(params: URLSearchParams): Resultado400<ParamsVinculables> {
  const permitidos = ["interaccion", "ocurrida_en", "alcance", "hora", "personas", "minutos", "incluir_vinculados"];
  for (const k of params.keys()) if (!permitidos.includes(k)) return falla("campo_desconocido", { campo: k.slice(0, 40) });
  const interaccion = params.get("interaccion");
  const ocurrida = params.get("ocurrida_en");
  if (interaccion !== null && !esUuid(interaccion)) return falla("campo_invalido", { campo: "interaccion" });
  if (ocurrida !== null && !instanteValido(ocurrida)) return falla("campo_invalido", { campo: "ocurrida_en" });
  if (interaccion !== null && ocurrida !== null) return falla("campo_invalido", { campo: "ocurrida_en" });
  const alcance = params.get("alcance") ?? "2h";
  if (!(ALCANCES_VINCULABLES as readonly string[]).includes(alcance)) return falla("campo_invalido", { campo: "alcance" });
  const hora = params.get("hora");
  if (hora !== null && !/^\d{1,2}(:\d{0,2})?$/.test(hora)) return falla("campo_invalido", { campo: "hora" });
  const entero = (k: string, max: number): Resultado400<number | null> => {
    const v = params.get(k);
    if (v === null) return { ok: true, valor: null };
    return /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= max ? { ok: true, valor: Number(v) } : falla("campo_invalido", { campo: k });
  };
  const personas = entero("personas", 20);
  if (!personas.ok) return personas;
  const minutos = entero("minutos", 600);
  if (!minutos.ok) return minutos;
  const incl = params.get("incluir_vinculados");
  if (incl !== null && incl !== "0" && incl !== "1") return falla("campo_invalido", { campo: "incluir_vinculados" });
  return {
    ok: true,
    valor: {
      interaccion: interaccion?.toLowerCase() ?? null, ocurrida_en: ocurrida, alcance: alcance as AlcanceVinculables,
      hora, personas: personas.valor, minutos: minutos.valor, incluir_vinculados: incl !== "0",
    },
  };
}

// ── Respuesta: interacción ─────────────────────────────────────────────────
// Entrada: la forma de interaccion_detalle() de la base ({ interaccion, estado,
// turnos }). Los listados arman esa misma forma, así hay UNA sola conversión.
export type DetalleBase = {
  interaccion: Record<string, unknown>;
  estado: Record<string, unknown>;
  turnos: Array<Record<string, unknown>>;
};

export type Advertencia = { codigo: string; turno_stand_id?: string; turnos?: string[] };

export type TurnoVinculadoDto = {
  turno_stand_id: string;
  fecha: string;
  hora: string | null;
  hora_subida: string | null;
  personas: number | null;
  minutos: number | null;
  modalidad: string | null;
  total: number;
  es_pago: boolean;
  metodo_pago: string | null;
  pago_contradictorio: boolean;
  activo: boolean;
  dias_diferencia: number;
  fuera_de_tolerancia: boolean;
  turno_modificado: boolean;
  vinculado_en: string;
  vinculado_por_rol: Rol;
};

export type InteraccionDto = {
  id: string;
  version: number;
  ocurrida_en: string;
  fecha_negocio: string;
  hora_negocio: string;
  registrada_en: string;
  registrada_por_rol: Rol;
  actualizada_en: string | null;
  actualizada_por_rol: Rol | "sistema" | null;
  resultado: Resultado;
  personas_grupo: number;
  hombres: number | null;
  mujeres: number | null;
  /** Rangos presentes (orden canónico); [] = sin dato. */
  rangos_etarios: RangoEtario[];
  tipo_grupo: TipoGrupo | null;
  /** Forma anterior (un valor, o null si hay 0 o varios): solo para pantallas viejas. */
  rango_etario: RangoEtario | null;
  conocia_sim: Respuesta | null;
  se_subio_antes: Respuesta | null;
  iniciador: Iniciador | null;
  atendio: { empleado_id: string; nombre: string | null; activo: boolean; declarado: true } | null;
  motivo: Motivo | null;
  observaciones: string | null;
  cierre: { motivo: MotivoCierre; nota: string | null; cerrada_en: string } | null;
  anulacion: { anulada_en: string; por_rol: Rol; motivo: string | null } | null;
  vinculo: {
    estado: EstadoVinculo;
    turnos_vinculados: number;
    turnos_activos: number;
    turnos_pagos: number;
    turnos_gratis: number;
    turnos_pago_contradictorio: number;
    participaciones: number;
    venta_verificada: boolean;
  };
  turnos: TurnoVinculadoDto[];
  permisos: { editar: boolean; anular: boolean; vincular: boolean; desvincular: boolean; cerrar_sin_vinculo: boolean; eliminar: boolean };
  advertencias: Advertencia[];
};

const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * Qué puede hacer este rol ahora (la base lo vuelve a exigir al escribir).
 * eliminar: solo admin, en cualquier estado y fecha (también una anulada). Una
 * eliminada nunca llega acá: no aparece en ninguna vista operativa.
 */
export function permisosPara(rol: Rol, i: { registrada_en: string; resultado: string; anulada: boolean; estado: EstadoVinculo; turnos: number }, ahora: Date) {
  const corregir = rol === "admin" || staffPuedeCorregir(new Date(i.registrada_en), ahora);
  const viva = !i.anulada;
  const subio = i.resultado === "subio";
  return {
    editar: viva && corregir,
    anular: viva && corregir,
    vincular: viva && subio && i.turnos < LIMITES.max_turnos_por_interaccion,
    desvincular: viva && subio && i.turnos > 0 && corregir,
    cerrar_sin_vinculo: viva && rol === "admin" && subio && i.turnos === 0,
    eliminar: rol === "admin",
  };
}

export function dtoInteraccion(
  d: DetalleBase,
  ctx: { rol: Rol; ahora: Date; atendio?: { nombre: string | null; activo: boolean } | null },
  extra: { turnos_liberados?: string[]; cierre_retirado?: boolean } = {},
): InteraccionDto {
  const i = d.interaccion;
  const e = d.estado;
  const turnos: TurnoVinculadoDto[] = (d.turnos ?? []).map((t) => ({
    turno_stand_id: String(t.turno_stand_id),
    fecha: String(t.turno_fecha),
    hora: txt(t.turno_hora),
    hora_subida: txt(t.turno_hora_subida),
    personas: num(t.turno_personas),
    minutos: num(t.turno_minutos),
    modalidad: txt(t.turno_modalidad),
    total: Number(t.turno_total ?? 0),
    es_pago: Boolean(t.turno_pago),
    metodo_pago: txt(t.turno_metodo_pago),
    pago_contradictorio: Boolean(t.pago_contradictorio),
    activo: Boolean(t.turno_activo),
    dias_diferencia: Number(t.dias_diferencia ?? 0),
    fuera_de_tolerancia: Boolean(t.fuera_de_tolerancia),
    turno_modificado: Boolean(t.turno_modificado),
    vinculado_en: String(t.vinculado_en),
    vinculado_por_rol: t.vinculado_por_rol as Rol,
  }));
  const estado = e.vinculo_estado as EstadoVinculo;
  const anulada = i.anulada_en !== null && i.anulada_en !== undefined;
  const atendioId = txt(i.atendio_empleado_id);
  const advertencias: Advertencia[] = [];
  if (estado === "pendiente") advertencias.push({ codigo: "pendiente_de_vinculo" });
  if (estado === "cerrada_sin_turno") advertencias.push({ codigo: "subida_declarada_sin_turno" });
  if (estado === "turno_no_activo") advertencias.push({ codigo: "turno_no_activo" });
  for (const t of turnos) {
    if (t.fuera_de_tolerancia) advertencias.push({ codigo: "turno_fuera_de_tolerancia", turno_stand_id: t.turno_stand_id });
    if (t.turno_modificado) advertencias.push({ codigo: "turno_modificado", turno_stand_id: t.turno_stand_id });
    if (t.pago_contradictorio) advertencias.push({ codigo: "pago_contradictorio", turno_stand_id: t.turno_stand_id });
  }
  if (extra.turnos_liberados && extra.turnos_liberados.length > 0) {
    advertencias.push({ codigo: "turnos_liberados", turnos: extra.turnos_liberados.map(String) });
  }
  if (extra.cierre_retirado) advertencias.push({ codigo: "cierre_retirado" });
  return {
    id: String(i.id),
    version: Number(i.version),
    ocurrida_en: String(i.ocurrida_en),
    fecha_negocio: String(i.fecha_negocio),
    hora_negocio: String(i.hora_negocio ?? "").slice(0, 5),
    registrada_en: String(i.registrada_en),
    registrada_por_rol: i.registrada_por_rol as Rol,
    actualizada_en: txt(i.actualizada_en),
    actualizada_por_rol: (i.actualizada_por_rol ?? null) as InteraccionDto["actualizada_por_rol"],
    resultado: i.resultado as Resultado,
    personas_grupo: Number(i.personas_grupo),
    hombres: num(i.hombres),
    mujeres: num(i.mujeres),
    rangos_etarios: rangosCanonicos(Array.isArray(i.rangos_etarios) ? (i.rangos_etarios as RangoEtario[]) : []),
    tipo_grupo: (i.tipo_grupo ?? null) as TipoGrupo | null,
    rango_etario: (i.rango_etario ?? null) as RangoEtario | null,
    conocia_sim: (i.conocia_sim ?? null) as Respuesta | null,
    se_subio_antes: (i.se_subio_antes ?? null) as Respuesta | null,
    iniciador: (i.iniciador ?? null) as Iniciador | null,
    atendio: atendioId
      ? { empleado_id: atendioId, nombre: ctx.atendio?.nombre ?? null, activo: ctx.atendio?.activo ?? false, declarado: true }
      : null,
    motivo: (i.motivo ?? null) as Motivo | null,
    observaciones: txt(i.observaciones),
    cierre: i.cierre_motivo
      ? { motivo: i.cierre_motivo as MotivoCierre, nota: txt(i.cierre_nota), cerrada_en: String(i.cerrada_en) }
      : null,
    anulacion: anulada
      ? { anulada_en: String(i.anulada_en), por_rol: i.anulada_por_rol as Rol, motivo: txt(i.anulada_motivo) }
      : null,
    vinculo: {
      estado,
      turnos_vinculados: Number(e.turnos_vinculados ?? 0),
      turnos_activos: Number(e.turnos_activos ?? 0),
      turnos_pagos: Number(e.turnos_pagos ?? 0),
      turnos_gratis: Number(e.turnos_gratis ?? 0),
      turnos_pago_contradictorio: Number(e.turnos_pago_contradictorio ?? 0),
      participaciones: Number(e.participaciones ?? 0),
      venta_verificada: Boolean(e.venta_verificada),
    },
    turnos,
    permisos: permisosPara(
      ctx.rol,
      { registrada_en: String(i.registrada_en), resultado: String(i.resultado), anulada, estado, turnos: turnos.length },
      ctx.ahora,
    ),
    advertencias,
  };
}

// ── Respuesta: turno vinculable ────────────────────────────────────────────
export type TurnoVinculableDto = {
  id: string;
  fecha: string;
  hora: string;
  hora_subida: string | null;
  personas: number | null;
  minutos: number | null;
  modalidad: string | null;
  total: number;
  es_pago: boolean;
  pago_contradictorio: boolean;
  vinculacion: "libre" | "esta" | "otra";
  disponible: boolean;
};

/** Datos de pago contradictorios: misma regla que interacciones_pago_contradictorio(). */
export function pagoContradictorio(total: number | null, metodo: string | null): boolean {
  const t = Number(total ?? 0);
  return (t > 0 && metodo === "gratis") || (t <= 0 && metodo !== "gratis");
}

/** ¿El turno coincide con la búsqueda? hora = prefijo ("19", "19:5"). */
export function coincideBusqueda(t: { hora: string; personas: number | null; minutos: number | null }, p: Pick<ParamsVinculables, "hora" | "personas" | "minutos">): boolean {
  if (p.hora !== null && !t.hora.startsWith(p.hora)) return false;
  if (p.personas !== null && t.personas !== p.personas) return false;
  if (p.minutos !== null && t.minutos !== p.minutos) return false;
  return true;
}

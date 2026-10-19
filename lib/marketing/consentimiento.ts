// ============================================================================
// Marketing · consentimiento promocional y bajas — contrato PURO (Etapa 3).
// ----------------------------------------------------------------------------
// Client-safe: sin base, sin red y sin secretos. Lo usan las rutas públicas
// (/api/promos/*), las del panel (/api/admin/marketing/*) y las pantallas.
// La autoridad es la base (db/marketing-consentimiento.sql): acá se valida antes
// para dar errores claros y armar exactamente los datos que espera la RPC.
//
//   · Teléfono: normalizarTelefonoDetallado (espejo de la base). No se adivina.
//   · Alta pública: casilla marcada y versión + huella del texto que se mostró.
//   · Campo "sitio" vacío: trampa para bots. Si viene lleno se contesta igual que
//     siempre y no se registra nada.
//   · Panel: un alta exige evidencia escrita y rol admin; una baja la puede cargar
//     staff. La fecha de origen es conservadora: un alta del pasado cuenta desde
//     el inicio de ese día y una baja hasta el final (en Argentina).
// ============================================================================

import { hoyEnSim, sumarDias } from "@/lib/agenda";
import { normalizarTelefonoDetallado } from "@/lib/mensualidades";
import { enmascararTelefono } from "@/lib/marketing/audiencia";

export const RUTA_ALTA = "/promos";
export const RUTA_BAJA = "/promos/baja";

export const FUENTES = ["formulario_web", "admin_evidencia", "admin_pedido"] as const;
export type Fuente = (typeof FUENTES)[number];

export const ETIQUETA_FUENTE: Record<Fuente, string> = {
  formulario_web: "Formulario web",
  admin_evidencia: "Panel, con evidencia",
  admin_pedido: "Panel, a pedido",
};

export const TIPOS_EVIDENCIA = [
  { valor: "papel_firmado", etiqueta: "Planilla o formulario firmado" },
  { valor: "mensaje_del_titular", etiqueta: "Mensaje escrito del titular" },
  { valor: "email_del_titular", etiqueta: "Email del titular" },
] as const;
export type TipoEvidencia = (typeof TIPOS_EVIDENCIA)[number]["valor"];

export const CANALES_BAJA = [
  { valor: "presencial", etiqueta: "En el stand" },
  { valor: "whatsapp", etiqueta: "Por WhatsApp" },
  { valor: "telefono", etiqueta: "Por teléfono" },
  { valor: "email", etiqueta: "Por email" },
  { valor: "otro", etiqueta: "Otro" },
] as const;
export type CanalBaja = (typeof CANALES_BAJA)[number]["valor"];

export const LIMITES = {
  nombre: 80,
  localidadMin: 2,
  localidad: 80,
  referenciaMin: 3,
  referencia: 200,
  nota: 300,
  diasHaciaAtras: 365,
  cuerpoBytes: 4096,
} as const;

export const MENSAJE_ALTA_OK =
  "¡Listo! Vas a recibir nuestras promociones por WhatsApp en ese número. Podés darte de baja cuando quieras.";
export const MENSAJE_BAJA_OK =
  "Listo. Si ese número estaba anotado, no va a recibir más promociones de SIM Argentina.";

// ── Errores ────────────────────────────────────────────────────────────────
const MENSAJES: Record<string, { status: number; error: string }> = {
  datos_invalidos: { status: 400, error: "Los datos enviados no son válidos." },
  campo_invalido: { status: 400, error: "Revisá el dato marcado." },
  campo_desconocido: { status: 400, error: "Se envió un dato que no corresponde." },
  campo_no_aplica: { status: 400, error: "Se envió un dato que no corresponde a esta acción." },
  telefono_invalido: {
    status: 400,
    error: "Ese teléfono no parece un número argentino válido. Escribilo con el código de área, por ejemplo 351 555 1234.",
  },
  falta_aceptacion: { status: 400, error: "Para recibir promociones tenés que marcar la aceptación." },
  texto_no_publicado: { status: 400, error: "Esa versión del texto no está publicada." },
  accion_invalida: { status: 400, error: "Acción desconocida." },
  actor_invalido: { status: 403, error: "No tenés permiso para esta acción." },
  fuente_no_permitida: { status: 403, error: "No tenés permiso para esta acción." },
  solo_admin: { status: 403, error: "Solo un administrador puede hacer esto." },
  texto_inexistente: { status: 404, error: "Ese texto no existe." },
  texto_desactualizado: { status: 409, error: "El texto de la aceptación cambió. Leelo de nuevo antes de confirmar." },
  baja_vigente: {
    status: 409,
    error: "Este número pidió la baja. Solo la persona puede volver a anotarse, desde el formulario.",
  },
  idempotency_key_con_otro_payload: { status: 409, error: "Este pedido ya se registró con otros datos." },
  texto_no_borrador: { status: 409, error: "Solo se puede publicar un borrador." },
  texto_no_vigente: { status: 409, error: "Solo se puede retirar el texto vigente." },
  demasiados_intentos: { status: 429, error: "Demasiados intentos. Esperá un minuto y volvé a probar." },
  consentimiento_no_habilitado: { status: 503, error: "La inscripción a promociones todavía no está disponible." },
  modulo_no_instalado: { status: 503, error: "El registro de promociones no está disponible." },
};

export type ErrorApi = { status: number; codigo: string; error: string; campo?: string };

export function errorApi(codigo: string, extra: { campo?: string } = {}): ErrorApi {
  const m = MENSAJES[codigo] ?? { status: 500, error: "No se pudo completar la operación." };
  return { status: m.status, codigo, error: m.error, ...extra };
}

const CODIGOS_NO_INSTALADO = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

/** Error de PostgREST/RPC → error conocido; null = inesperado (500 con el detalle solo en el log). */
export function errorDeRpc(err: { code?: string | null; message?: string | null } | null | undefined): ErrorApi | null {
  if (!err) return null;
  if (err.code && CODIGOS_NO_INSTALADO.has(err.code)) return errorApi("modulo_no_instalado");
  const msg = String(err.message ?? "");
  const i = msg.indexOf(":");
  const codigo = i >= 0 ? msg.slice(0, i) : msg;
  const detalle = i >= 0 ? msg.slice(i + 1) : "";
  if (codigo === "campo_invalido" || codigo === "campo_desconocido" || codigo === "campo_no_aplica") {
    return /^[a-z_.]{1,40}$/.test(detalle) ? errorApi(codigo, { campo: detalle }) : errorApi(codigo);
  }
  return MENSAJES[codigo] ? errorApi(codigo) : null;
}

// ── Utilidades de validación ──────────────────────────────────────────────
type Ok<T> = { ok: true; valor: T };
type Falla = { ok: false; e: ErrorApi };
export type Resultado<T> = Ok<T> | Falla;
const ok = <T>(valor: T): Ok<T> => ({ ok: true, valor });
const falla = (codigo: string, campo?: string): Falla => ({ ok: false, e: errorApi(codigo, campo ? { campo } : {}) });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HUELLA_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function esUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function soloClaves(body: Record<string, unknown>, permitidas: readonly string[]): Falla | null {
  for (const k of Object.keys(body)) if (!permitidas.includes(k)) return falla("campo_desconocido", k);
  return null;
}

/** Texto opcional: espacios colapsados; vacío = null; fuera de largo = error. */
function textoOpcional(v: unknown, campo: string, min: number, max: number): Resultado<string | null> {
  if (v === undefined || v === null) return ok(null);
  if (typeof v !== "string") return falla("campo_invalido", campo);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return ok(null);
  if (t.length < min || t.length > max) return falla("campo_invalido", campo);
  return ok(t);
}

function telefono(v: unknown): Resultado<string> {
  if (typeof v !== "string") return falla("telefono_invalido");
  const r = normalizarTelefonoDetallado(v);
  return r.ok ? ok(r.valor) : falla("telefono_invalido");
}

function clave(v: unknown): Resultado<string> {
  return esUuid(v) ? ok(v.toLowerCase()) : falla("campo_invalido", "idempotency_key");
}

/** Lo que recibe la RPC mkt_consentimiento_registrar en p_datos. */
export type DatosRpc = {
  tipo: "alta" | "baja";
  fuente: Fuente;
  telefono: string;
  texto_version?: string;
  texto_huella?: string;
  nombre?: string | null;
  localidad?: string | null;
  evidencia?: Record<string, string>;
  ocurrido_en?: string;
};

export type Pedido = { clave: string; datos: DatosRpc; bot: boolean };

// ── Formularios públicos ──────────────────────────────────────────────────
const CLAVES_ALTA_PUBLICA = ["idempotency_key", "telefono", "nombre", "localidad", "acepto", "texto_version", "texto_huella", "sitio"] as const;
const CLAVES_BAJA_PUBLICA = ["idempotency_key", "telefono", "sitio"] as const;

function esBot(body: Record<string, unknown>): boolean {
  return typeof body.sitio === "string" ? body.sitio.trim() !== "" : body.sitio !== undefined && body.sitio !== null;
}

export function validarAltaPublica(body: unknown): Resultado<Pedido> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const desconocido = soloClaves(body, CLAVES_ALTA_PUBLICA);
  if (desconocido) return desconocido;
  const k = clave(body.idempotency_key);
  if (!k.ok) return k;
  const tel = telefono(body.telefono);
  if (!tel.ok) return tel;
  const nombre = textoOpcional(body.nombre, "nombre", 1, LIMITES.nombre);
  if (!nombre.ok) return nombre;
  const localidad = textoOpcional(body.localidad, "localidad", LIMITES.localidadMin, LIMITES.localidad);
  if (!localidad.ok) return localidad;
  if (body.acepto !== true) return falla("falta_aceptacion");
  if (typeof body.texto_version !== "string" || !VERSION_RE.test(body.texto_version)) return falla("campo_invalido", "texto_version");
  if (typeof body.texto_huella !== "string" || !HUELLA_RE.test(body.texto_huella)) return falla("campo_invalido", "texto_huella");
  return ok({
    clave: k.valor,
    bot: esBot(body),
    datos: {
      tipo: "alta",
      fuente: "formulario_web",
      telefono: tel.valor,
      texto_version: body.texto_version,
      texto_huella: body.texto_huella,
      nombre: nombre.valor,
      localidad: localidad.valor,
    },
  });
}

export function validarBajaPublica(body: unknown): Resultado<Pedido> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const desconocido = soloClaves(body, CLAVES_BAJA_PUBLICA);
  if (desconocido) return desconocido;
  const k = clave(body.idempotency_key);
  if (!k.ok) return k;
  const tel = telefono(body.telefono);
  if (!tel.ok) return tel;
  return ok({ clave: k.valor, bot: esBot(body), datos: { tipo: "baja", fuente: "formulario_web", telefono: tel.valor } });
}

// ── Fecha de origen de una carga del panel ────────────────────────────────
/**
 * Fecha calendario de Argentina → instante para la base. Hoy = ahora (nunca en
 * el futuro). Un día pasado: un ALTA cuenta desde las 00:00 y una BAJA hasta las
 * 23:59:59.999, así una baja del mismo día nunca queda tapada. Más de 365 días
 * atrás o en el futuro → error.
 */
export function instanteDeOrigen(fecha: unknown, tipo: "alta" | "baja", ahora: Date): Resultado<string | undefined> {
  if (fecha === undefined || fecha === null || fecha === "") return ok(undefined);
  if (typeof fecha !== "string" || !FECHA_RE.test(fecha)) return falla("campo_invalido", "ocurrido_en");
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return falla("campo_invalido", "ocurrido_en");
  const hoy = hoyEnSim(ahora);
  if (fecha > hoy || fecha < sumarDias(hoy, -LIMITES.diasHaciaAtras)) return falla("campo_invalido", "ocurrido_en");
  if (fecha === hoy) return ok(undefined);
  // Argentina = UTC−3 todo el año (sin horario de verano).
  return ok(tipo === "alta" ? `${fecha}T00:00:00.000-03:00` : `${fecha}T23:59:59.999-03:00`);
}

// ── Acciones del panel ────────────────────────────────────────────────────
export type Rol = "admin" | "staff";

const CLAVES_BAJA_PANEL = ["accion", "idempotency_key", "telefono", "canal", "nota", "fecha_origen"] as const;
const CLAVES_ALTA_PANEL = [
  "accion", "idempotency_key", "telefono", "texto_version", "tipo_evidencia", "referencia", "nota", "fecha_origen", "nombre", "localidad",
] as const;

export function validarAccionPanel(body: unknown, rol: Rol, ahora: Date): Resultado<Pedido> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  if (body.accion !== "alta" && body.accion !== "baja") return falla("accion_invalida");
  if (body.accion === "alta" && rol !== "admin") return falla("solo_admin");
  const desconocido = soloClaves(body, body.accion === "alta" ? CLAVES_ALTA_PANEL : CLAVES_BAJA_PANEL);
  if (desconocido) return desconocido;
  const k = clave(body.idempotency_key);
  if (!k.ok) return k;
  const tel = telefono(body.telefono);
  if (!tel.ok) return tel;
  const nota = textoOpcional(body.nota, "nota", 1, LIMITES.nota);
  if (!nota.ok) return nota;
  const origen = instanteDeOrigen(body.fecha_origen, body.accion, ahora);
  if (!origen.ok) return origen;

  if (body.accion === "baja") {
    if (!CANALES_BAJA.some((c) => c.valor === body.canal)) return falla("campo_invalido", "canal");
    const evidencia: Record<string, string> = { canal: body.canal as CanalBaja };
    if (nota.valor) evidencia.nota = nota.valor;
    return ok({
      clave: k.valor,
      bot: false,
      datos: { tipo: "baja", fuente: "admin_pedido", telefono: tel.valor, evidencia, ...(origen.valor ? { ocurrido_en: origen.valor } : {}) },
    });
  }

  if (typeof body.texto_version !== "string" || !VERSION_RE.test(body.texto_version)) return falla("campo_invalido", "texto_version");
  if (!TIPOS_EVIDENCIA.some((t) => t.valor === body.tipo_evidencia)) return falla("campo_invalido", "tipo_evidencia");
  const referencia = textoOpcional(body.referencia, "referencia", LIMITES.referenciaMin, LIMITES.referencia);
  if (!referencia.ok) return referencia;
  if (!referencia.valor) return falla("campo_invalido", "referencia");
  const nombre = textoOpcional(body.nombre, "nombre", 1, LIMITES.nombre);
  if (!nombre.ok) return nombre;
  const localidad = textoOpcional(body.localidad, "localidad", LIMITES.localidadMin, LIMITES.localidad);
  if (!localidad.ok) return localidad;
  const evidencia: Record<string, string> = { tipo: body.tipo_evidencia as TipoEvidencia, referencia: referencia.valor };
  if (nota.valor) evidencia.nota = nota.valor;
  return ok({
    clave: k.valor,
    bot: false,
    datos: {
      tipo: "alta",
      fuente: "admin_evidencia",
      telefono: tel.valor,
      texto_version: body.texto_version,
      nombre: nombre.valor,
      localidad: localidad.valor,
      evidencia,
      ...(origen.valor ? { ocurrido_en: origen.valor } : {}),
    },
  });
}

export function validarAccionTexto(body: unknown): Resultado<{ accion: "publicar" | "retirar"; version: string }> {
  if (!esObjeto(body)) return falla("datos_invalidos");
  const desconocido = soloClaves(body, ["accion", "version"]);
  if (desconocido) return desconocido;
  if (body.accion !== "publicar" && body.accion !== "retirar") return falla("accion_invalida");
  if (typeof body.version !== "string" || !VERSION_RE.test(body.version)) return falla("campo_invalido", "version");
  return ok({ accion: body.accion, version: body.version });
}

/** Consulta del panel por teléfono: vacío = sin consulta; ilegible = error. */
export function telefonoDeConsulta(v: string | null): Resultado<string | null> {
  if (v === null || v.trim() === "") return ok(null);
  const r = normalizarTelefonoDetallado(v);
  return r.ok ? ok(r.valor) : falla("telefono_invalido");
}

// ── Lo que se muestra ─────────────────────────────────────────────────────
export type EventoDto = {
  id: string;
  telefono: string;
  tipo: "alta" | "baja";
  fuente: Fuente;
  actor_rol: string;
  texto_version: string | null;
  nombre: string | null;
  localidad: string | null;
  evidencia: Record<string, string>;
  ocurrido_en: string;
  registrado_en: string;
};

/** Para listados: teléfono enmascarado y sin nombre, localidad ni evidencia. */
export function eventoParaListado(e: EventoDto): EventoDto {
  return { ...e, telefono: enmascararTelefono(e.telefono), nombre: null, localidad: null, evidencia: {} };
}

export type TextoDto = {
  version: string;
  titulo: string;
  texto: string;
  huella: string;
  estado: "borrador" | "vigente" | "retirado";
  creado_en: string;
  publicado_en: string | null;
  retirado_en: string | null;
};

/** Lo único que ve el público del texto vigente. */
export function textoPublico(t: TextoDto) {
  return { version: t.version, titulo: t.titulo, texto: t.texto, huella: t.huella };
}

// ============================================================================
// Marketing · consentimiento y bajas — acceso de SERVIDOR (service_role).
// ----------------------------------------------------------------------------
// Solo lo importan las rutas /api/promos/* y /api/admin/marketing/*, y la
// simulación de audiencia. Toda escritura pasa por las RPCs de
// db/marketing-consentimiento.sql: service_role no tiene INSERT/UPDATE/DELETE
// sobre las tablas mkt_*, a propósito. El rol que reciben las RPCs lo decide la
// ruta ('publico' o el de la sesión firmada), nunca el navegador.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { leerRegistroParaAudiencia, type RegistroParaAudiencia } from "@/lib/marketing/registroLectura";
import { emitirTokenFormulario } from "@/lib/marketing/tokenFormulario";
import {
  textoPublico,
  errorDeRpc,
  type DatosRpc,
  type ErrorApi,
  type EventoDto,
  type Fuente,
  type TextoDto,
} from "@/lib/marketing/consentimiento";

/** ok · error conocido (e) · error inesperado (e = null: la ruta contesta 500 y lo registra). */
export type R<T> = { ok: true; valor: T } | { ok: false; e: ErrorApi | null; causa?: string };

type ErrorPg = { code?: string | null; message?: string | null } | null;

function fallo<T>(error: ErrorPg): R<T> {
  const e = errorDeRpc(error);
  return e ? { ok: false, e } : { ok: false, e: null, causa: `${error?.code ?? ""} ${error?.message ?? ""}`.trim() };
}

const COLS_TEXTO = "version, titulo, texto, huella, estado, creado_en, publicado_en, retirado_en";
const COLS_EVENTO =
  "id, telefono, tipo, fuente, actor_rol, texto_version, nombre, localidad, evidencia, ocurrido_en, registrado_en";

// ── Textos ────────────────────────────────────────────────────────────────
export async function listarTextos(): Promise<R<TextoDto[]>> {
  const { data, error } = await supabaseAdmin.from("mkt_textos_consentimiento").select(COLS_TEXTO).order("creado_en", { ascending: false });
  if (error) return fallo(error);
  return { ok: true, valor: (data ?? []) as TextoDto[] };
}

/** El texto vigente, o null si no hay (las altas públicas están cerradas). */
export async function textoVigente(): Promise<R<TextoDto | null>> {
  const { data, error } = await supabaseAdmin
    .from("mkt_textos_consentimiento").select(COLS_TEXTO).eq("estado", "vigente").maybeSingle();
  if (error) return fallo(error);
  return { ok: true, valor: (data as TextoDto | null) ?? null };
}

export type TextoParaFormulario = { texto: ReturnType<typeof textoPublico>; token: string };

/**
 * El texto vigente, tal como lo ve el público, con el token firmado del momento
 * en que se muestra. null si no hay texto publicado o no hay secreto para firmar
 * (las altas quedan cerradas: falla cerrada).
 */
export async function textoParaFormulario(ahora: Date): Promise<R<TextoParaFormulario | null>> {
  const t = await textoVigente();
  if (!t.ok) return t;
  if (!t.valor) return { ok: true, valor: null };
  const token = emitirTokenFormulario(t.valor.version, ahora);
  return { ok: true, valor: token ? { texto: textoPublico(t.valor), token } : null };
}

export async function publicarTexto(version: string): Promise<R<Record<string, unknown>>> {
  const { data, error } = await supabaseAdmin.rpc("mkt_texto_publicar", { p_version: version, p_rol: "admin" });
  if (error) return fallo(error);
  return { ok: true, valor: (data ?? {}) as Record<string, unknown> };
}

export async function retirarTexto(version: string): Promise<R<Record<string, unknown>>> {
  const { data, error } = await supabaseAdmin.rpc("mkt_texto_retirar", { p_version: version, p_rol: "admin" });
  if (error) return fallo(error);
  return { ok: true, valor: (data ?? {}) as Record<string, unknown> };
}

// ── Registro ──────────────────────────────────────────────────────────────
export type Registrado = {
  telefono: string;
  estado: "alta" | "baja";
  repetida: boolean;
  evento: { id: string; tipo: string; fuente: string; ocurrido_en: string; registrado_en: string };
};

export async function registrar(clave: string, datos: DatosRpc, rol: "publico" | "staff" | "admin"): Promise<R<Registrado>> {
  const { data, error } = await supabaseAdmin.rpc("mkt_consentimiento_registrar", {
    p_idempotency_key: clave,
    p_datos: datos,
    p_rol: rol,
  });
  if (error) return fallo(error);
  if (!data) return { ok: false, e: null, causa: "mkt_consentimiento_registrar sin respuesta" };
  return { ok: true, valor: data as Registrado };
}

// ── Lecturas del panel ────────────────────────────────────────────────────
export type EstadoTelefono = {
  telefono: string;
  estado: "alta" | "baja";
  alta_en: string | null;
  alta_fuente: Fuente | null;
  alta_texto_version: string | null;
  nombre: string | null;
  localidad: string | null;
  baja_en: string | null;
  bajas: number;
  eventos: number;
  ultimo_registro: string;
};

export async function consultarTelefono(canonico: string): Promise<R<{ estado: EstadoTelefono | null; historial: EventoDto[] }>> {
  const [est, hist] = await Promise.all([
    supabaseAdmin.from("mkt_consentimiento_estado").select("*").eq("telefono", canonico).maybeSingle(),
    supabaseAdmin.from("mkt_consentimiento_eventos").select(COLS_EVENTO).eq("telefono", canonico)
      .order("ocurrido_en", { ascending: false }).order("registrado_en", { ascending: false }).limit(100),
  ]);
  if (est.error) return fallo(est.error);
  if (hist.error) return fallo(hist.error);
  return { ok: true, valor: { estado: (est.data as EstadoTelefono | null) ?? null, historial: (hist.data ?? []) as EventoDto[] } };
}

export async function recientes(limite = 30): Promise<R<EventoDto[]>> {
  const { data, error } = await supabaseAdmin.from("mkt_consentimiento_eventos").select(COLS_EVENTO)
    .order("registrado_en", { ascending: false }).limit(limite);
  if (error) return fallo(error);
  return { ok: true, valor: (data ?? []) as EventoDto[] };
}

export type Resumen = {
  telefonos: number;
  altas_vigentes: number;
  bajas_vigentes: number;
  altas_por_fuente: Partial<Record<Fuente, number>>;
  desde: string;
  altas_desde: number;
  bajas_desde: number;
};

export async function resumen(desde: Date): Promise<R<Resumen>> {
  const { data, error } = await supabaseAdmin.rpc("mkt_consentimiento_resumen", { p_desde: desde.toISOString() });
  if (error) return fallo(error);
  return { ok: true, valor: data as Resumen };
}

/** ¿Está instalada la migración? (sin tablas → false, no un error). */
export async function moduloInstalado(): Promise<R<boolean>> {
  const { error } = await supabaseAdmin.from("mkt_textos_consentimiento").select("version").limit(1);
  if (!error) return { ok: true, valor: true };
  const e = errorDeRpc(error);
  if (e?.codigo === "modulo_no_instalado") return { ok: true, valor: false };
  return fallo(error);
}

// ── Para la audiencia de campañas ─────────────────────────────────────────
export type { RegistroParaAudiencia };

/** Estado vigente de todos los teléfonos (lectura paginada en lib/marketing/registroLectura.ts). */
export async function registroParaAudiencia(): Promise<R<RegistroParaAudiencia>> {
  const r = await leerRegistroParaAudiencia(supabaseAdmin);
  return r.ok ? r : { ok: false, e: null, causa: r.causa };
}

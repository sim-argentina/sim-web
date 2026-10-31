// Usuarios comerciales del CRM (B0) — validación y contrato de la API, puros.
// Sin dependencias de servidor: lo usan las rutas, la pantalla de configuración y
// las pruebas. El acceso a datos vive en lib/crmUsuariosServer.ts.

export const USUARIO_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const NOMBRE_MAX = 80;

export const ACCIONES_USUARIO = ["restablecer", "desactivar", "reactivar", "revocar"] as const;
export type AccionUsuario = (typeof ACCIONES_USUARIO)[number];

/** Lo único que la administración ve de un usuario comercial. */
export type UsuarioComercialDto = {
  id: string;
  usuario: string;
  nombre: string;
  activo: boolean;
  creado_en: string;
  desactivado_en: string | null;
  contrasena_cambiada_en: string;
  ultimo_ingreso_en: string | null;
};

const CAMPOS_DTO = ["id", "usuario", "nombre", "activo", "creado_en", "desactivado_en", "contrasena_cambiada_en", "ultimo_ingreso_en"] as const;

/** Columnas que se leen de crm_usuarios (service_role no tiene SELECT sobre password_hash). */
export const COLUMNAS_DTO = CAMPOS_DTO.join(", ");

/** Copia SOLO los campos del DTO: lo demás que venga en la fila no sale. */
export function dtoUsuario(fila: Record<string, unknown>): UsuarioComercialDto {
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS_DTO) out[k] = fila[k] ?? null;
  out.activo = Boolean(fila.activo);
  return out as UsuarioComercialDto;
}

export function normalizarUsuario(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function normalizarNombre(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

export function problemaUsuario(usuario: string): string | null {
  if (!USUARIO_RE.test(usuario)) {
    return "El usuario tiene que tener de 3 a 40 caracteres: letras minúsculas, números, punto, guion o guion bajo, y empezar con letra o número.";
  }
  return null;
}

export function problemaNombre(nombre: string): string | null {
  if (nombre.length < 1) return "El nombre es obligatorio.";
  if (nombre.length > NOMBRE_MAX) return `El nombre no puede superar ${NOMBRE_MAX} caracteres.`;
  return null;
}

export const CONTRASENA_MIN = 10;
export const CONTRASENA_MAX = 128;

/** Política de contraseñas nuevas. Devuelve el motivo o null si sirve. */
export function problemaContrasenaNueva(contrasena: unknown, usuario: string): string | null {
  if (typeof contrasena !== "string" || contrasena.length === 0) return "La contraseña es obligatoria.";
  if (contrasena.length < CONTRASENA_MIN) return `La contraseña tiene que tener al menos ${CONTRASENA_MIN} caracteres.`;
  if (contrasena.length > CONTRASENA_MAX) return `La contraseña no puede superar ${CONTRASENA_MAX} caracteres.`;
  if (contrasena.trim() !== contrasena) return "La contraseña no puede empezar ni terminar con espacios.";
  if (usuario && contrasena.toLowerCase().includes(usuario.toLowerCase())) return "La contraseña no puede contener el usuario.";
  if (new Set(contrasena).size < 4) return "La contraseña es demasiado repetitiva.";
  return null;
}

export function esAccionUsuario(v: unknown): v is AccionUsuario {
  return typeof v === "string" && (ACCIONES_USUARIO as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ── Errores de las RPCs (db/crm-b0-identidad.sql) ─────────────────────────
// El mensaje de la excepción ES el código. Nada del error de Postgres llega al
// navegador: solo el código conocido y un texto propio.
export type ErrorUsuarios = { status: number; codigo: string; error: string };

const ERRORES: Record<string, ErrorUsuarios> = {
  usuario_existente: { status: 409, codigo: "usuario_existente", error: "Ya existe un usuario con ese nombre de usuario." },
  usuario_inexistente: { status: 404, codigo: "usuario_inexistente", error: "El usuario no existe." },
  sin_cambio: { status: 409, codigo: "sin_cambio", error: "El usuario ya está en ese estado." },
  usuario_invalido: { status: 400, codigo: "usuario_invalido", error: "Usuario inválido." },
  nombre_invalido: { status: 400, codigo: "nombre_invalido", error: "Nombre inválido." },
};

/** Error conocido de una RPC, o null (la ruta contesta 500 genérico y lo registra). */
export function errorDeRpcUsuarios(err: { code?: string | null; message?: string | null } | null | undefined): ErrorUsuarios | null {
  if (!err) return null;
  return ERRORES[String(err.message ?? "")] ?? null;
}

/** Texto de diagnóstico para el log del servidor: solo código y mensaje, nunca detalles con valores. */
export function causaPg(err: { code?: string | null; message?: string | null } | null | undefined): string {
  if (!err) return "";
  return `${err.code ?? ""} ${String(err.message ?? "").slice(0, 200)}`.trim();
}

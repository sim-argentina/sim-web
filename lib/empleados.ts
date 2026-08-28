// Integrantes del equipo (base de Cronograma, IA SIM · Bloque 1) — lógica PURA.
// Sin dependencias de servidor (no importa supabaseAdmin): normalización de alias
// + validación. Es la ÚNICA fuente de verdad de normalización (compartida y
// testeada). El acceso a datos vive en lib/empleadosServer.ts.

export const NOMBRE_MAX = 80;
export const ALIAS_MAX = 60;
export const MAX_ALIASES = 20;

export type Alias = { alias: string; alias_normalizado: string };

export type Empleado = {
  id: string;
  nombre_formal: string;
  activo: boolean;
  es_fallback: boolean;
  created_at: string;
  updated_at: string;
  empleado_aliases: Array<{ id: string; alias: string; alias_normalizado: string }>;
};

// Normalización de alias: minúsculas, trim, espacios internos colapsados y sin
// diacríticos. Ej.: "  José  María " → "jose maria"; "FEDE" → "fede".
export function normalizarAlias(input: unknown): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos (combining marks)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " "); // colapsa espacios internos
}

export type ValidacionOk = { ok: true; nombre: string; aliases: Alias[] };
export type ValidacionFail = { ok: false; error: string };

// Valida y normaliza el payload de crear/editar un integrante. No confía en el
// cliente: recorta, descarta vacíos, deduplica por alias normalizado y exige
// nombre + al menos un alias (por defecto, el nombre). Nunca acepta campos
// internos (activo, es_fallback, id…): solo devuelve nombre + aliases.
export function validarEmpleadoInput(body: unknown): ValidacionOk | ValidacionFail {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const nombre = String(obj.nombre ?? "").trim();
  if (nombre.length < 1) return { ok: false, error: "El nombre es obligatorio." };
  if (nombre.length > NOMBRE_MAX) return { ok: false, error: `El nombre no puede superar ${NOMBRE_MAX} caracteres.` };

  const rawAliases = Array.isArray(obj.aliases) ? obj.aliases : [];
  const aliases: Alias[] = [];
  const vistos = new Set<string>();
  for (const raw of rawAliases) {
    const alias = String(raw ?? "").trim();
    if (alias.length < 1) continue; // descarta vacíos
    if (alias.length > ALIAS_MAX) return { ok: false, error: `Cada alias no puede superar ${ALIAS_MAX} caracteres.` };
    const norm = normalizarAlias(alias);
    if (norm.length < 1) continue;
    if (vistos.has(norm)) continue; // deduplica dentro del payload
    vistos.add(norm);
    aliases.push({ alias, alias_normalizado: norm });
  }

  // Si no se cargó ningún alias válido, se usa el nombre como alias por defecto
  // (autoridad server-side: no depende del cliente).
  if (aliases.length < 1) {
    const norm = normalizarAlias(nombre);
    if (norm.length >= 1) aliases.push({ alias: nombre, alias_normalizado: norm });
  }
  if (aliases.length < 1) return { ok: false, error: "Cargá al menos un alias." };
  if (aliases.length > MAX_ALIASES) return { ok: false, error: `Máximo ${MAX_ALIASES} alias por integrante.` };

  return { ok: true, nombre, aliases };
}

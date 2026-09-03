// IA SIM · Bloque 4D.3 — Matriz CENTRALIZADA de capacidades de búsqueda web por modelo.
// No se asume soporte por el nombre: cada capacidad moderna queda DESHABILITADA por defecto y
// solo se activa por configuración explícita (cuando se confirme con la API/documentación).
// El filtrado dinámico y response_inclusion requieren versiones/ modelos recientes; ante duda,
// se usa la versión básica compatible y se degrada con seguridad.

export type CapacidadesWeb = {
  version: string;              // versión del server tool web_search a enviar
  filtradoDinamico: boolean;    // el modelo filtra resultados antes de que entren al contexto
  responseInclusionExcluded: boolean; // pedir response_inclusion:"excluded" (no reenvía brutos)
};

const BASICA: CapacidadesWeb = { version: "web_search_20250305", filtradoDinamico: false, responseInclusionExcluded: false };

// Versión moderna configurable (cuando se confirme el soporte del modelo potente en la Console).
function modernaSiConfigurada(): CapacidadesWeb | null {
  const ver = (process.env.IA_WEB_VERSION_MODERNA || "").trim(); // ej. "web_search_20260318"
  if (!ver) return null;
  return {
    version: ver,
    filtradoDinamico: (process.env.IA_WEB_FILTRADO_DINAMICO ?? "0") === "1",
    responseInclusionExcluded: (process.env.IA_WEB_RESPONSE_EXCLUDED ?? "0") === "1",
  };
}

export function capacidadesWeb(modelo: string): CapacidadesWeb {
  const moderna = modernaSiConfigurada();
  // Prefijos de modelos que PUEDEN usar la versión moderna SOLO si además está configurada.
  // (No se activa por el nombre solo; requiere IA_WEB_VERSION_MODERNA y, típicamente, Claude 4.6+.)
  const habilita = (process.env.IA_WEB_MODELOS_MODERNOS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (moderna && habilita.some((p) => (modelo || "").startsWith(p))) return moderna;
  return BASICA;
}

// Localización de la búsqueda (Córdoba, Argentina). Soportada por la versión básica y las
// modernas: acota resultados y reduce contexto irrelevante. No expone datos internos.
export const UBICACION_BUSQUEDA = {
  type: "approximate" as const,
  city: "Córdoba",
  region: "Córdoba",
  country: "AR",
  timezone: "America/Argentina/Cordoba",
};

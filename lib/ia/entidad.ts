// IA SIM · Bloque 4D.1 — Fuente de verdad ÚNICA de identidad de SIM y clasificación de
// entidades externas. Reutilizable (no duplicar en otros archivos). SIM Café Racer es una
// denominación HISTÓRICA de SIM Argentina, no un competidor independiente.

export const SIM_IDENTIDAD = {
  nombre_canonico: "SIM Argentina",
  aliases_actuales: ["SIM", "SIM Argentina", "SIM Experience"],
  // Denominaciones históricas de la MISMA empresa (no describen la operación actual; no hay bar).
  denominaciones_historicas: ["SIM Café Racer", "SIM Cafe Racer", "Café Racer", "Cafe Racer", "SimCafé Racer", "SimCafe Racer", "SimCafé", "SimCafe"],
  dominio: "simexperience.com.ar",
  ciudad: "Córdoba",
  pais: "Argentina",
} as const;

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

const SIM_TOKENS = new Set([SIM_IDENTIDAD.nombre_canonico, ...SIM_IDENTIDAD.aliases_actuales, ...SIM_IDENTIDAD.denominaciones_historicas].map(norm));

// ¿El texto/nombre refiere a la MISMA empresa SIM (nombre actual o histórico)?
export function esMismaEntidadSIM(nombre: string): boolean {
  const n = norm(nombre);
  if (!n) return false;
  if (SIM_TOKENS.has(n)) return true;
  // Coincidencia por contención de una denominación (evita falsos positivos de "sim" suelto:
  // exige "café racer"/"sim café"/dominio, no la sílaba "sim" dentro de otra palabra).
  const hist = ["cafe racer", "café racer", "sim cafe", "sim café", "simcafe", "simcafé", "sim experience", "sim argentina"];
  if (hist.some((h) => n.includes(norm(h)))) return true;
  if (n.includes(SIM_IDENTIDAD.dominio)) return true;
  return false;
}

export type ClaseEntidad =
  | "misma_entidad"
  | "competidor_directo_confirmado"
  | "competidor_potencial_o_ambiguo"
  | "sustituto"
  | "proveedor_o_fabricante"
  | "red_o_plataforma"
  | "evento"
  | "irrelevante";

export type SenalesEntidad = {
  nombre: string;
  actividadComparable?: boolean;   // ofrece simuladores/experiencia comparable a SIM
  ubicacionCordoba?: boolean;      // sede local en Córdoba, respaldada
  vigenciaReciente?: boolean;      // operación vigente / evidencia reciente
  tieneFuente?: boolean;           // fuente identificable
  esFabricante?: boolean;          // vende equipamiento (cabinas/butacas/hardware)
  esRedNacional?: boolean;         // red/plataforma nacional sin sede local confirmada
  esEvento?: boolean;              // evento/feria puntual
};

// Clasificación DETERMINÍSTICA y conservadora. "Competidor directo confirmado" exige
// actividad comparable + Córdoba + vigencia + fuente + ser distinta de SIM.
export function clasificarEntidad(s: SenalesEntidad): { clase: ClaseEntidad; motivo: string } {
  if (esMismaEntidadSIM(s.nombre)) return { clase: "misma_entidad", motivo: "denominación (actual o histórica) de SIM Argentina" };
  if (s.esEvento) return { clase: "evento", motivo: "evento/feria puntual, no un operador permanente" };
  if (s.esFabricante) return { clase: "proveedor_o_fabricante", motivo: "vende equipamiento; no opera un local de experiencia comparable" };
  if (s.esRedNacional && !s.ubicacionCordoba) return { clase: "red_o_plataforma", motivo: "red/plataforma nacional sin sede local confirmada en Córdoba" };
  if (s.actividadComparable && s.ubicacionCordoba && s.vigenciaReciente && s.tieneFuente) {
    return { clase: "competidor_directo_confirmado", motivo: "actividad comparable, sede en Córdoba, vigente y con fuente identificable" };
  }
  if (s.actividadComparable) return { clase: "competidor_potencial_o_ambiguo", motivo: "actividad comparable pero falta confirmar sede local, vigencia o fuente" };
  return { clase: "irrelevante", motivo: "sin actividad comparable ni señales de competencia" };
}

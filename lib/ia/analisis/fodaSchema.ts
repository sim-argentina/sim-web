// IA SIM · Bloque 4E — Esquema ESTRUCTURADO y TERMINAL para el FODA (interno o mixto). Mismo
// patrón que 4D.5.2/4D.5.3 (lib/ia/web/analisisWebSchema.ts): tool_choice forzado, longitudes
// acotadas por campo, ids de fuente que el servidor ofrece (nunca inventados), recorte NATURAL
// (nunca a mitad de palabra/oración) y sin completar artificialmente cuatro puntos por cuadrante.

import { recortarNatural } from "@/lib/ia/web/recorteNatural";
import type { FuenteInternaDisponible, FuenteExternaDisponible } from "@/lib/ia/web/analisisWebSchema";
export type { FuenteInternaDisponible, FuenteExternaDisponible };

export const NOMBRE_EMITIR_FODA = "emitir_foda";

export const LIMITES_FODA = {
  puntosPorCuadranteMax: 6,
  textoPuntoLen: 220,
  conclusionLen: 700,
  fuenteIdsPorPuntoMax: 2,
};
const L = LIMITES_FODA;

export const DESCRIPCION_EMITIR_FODA =
  "Emite el FODA final en una estructura acotada. Es la ÚNICA forma de responder: no generes texto libre aparte, el servidor arma la presentación. " +
  "Citá SOLO ids de 'datos_internos_disponibles' y (si están disponibles) 'fuentes_externas_disponibles' que te dio el servidor — nunca inventes ids, urls ni nombres de fuente. " +
  "Fortalezas y debilidades deben apoyarse principalmente en datos internos; oportunidades y amenazas externas deben citar fuentes web vigentes (si no hay búsqueda web disponible, dejá esos cuadrantes vacíos o solo con lo que el conocimiento interno respalde). " +
  "NO completes artificialmente hasta 6 puntos por cuadrante: incluí solo lo que esté genuinamente respaldado por una fuente. Un cuadrante sin evidencia queda con arreglo vacío, no se inventa contenido. " +
  "SIM Café Racer es la misma empresa que SIM Argentina (denominación histórica), nunca un competidor. Un fabricante de equipamiento no es un competidor. No afirmes liderazgo o superioridad sin benchmark comparable. Separá hechos de inferencias/recomendaciones.";

const SCHEMA_PUNTO_FODA: Record<string, unknown> = {
  type: "object",
  properties: {
    texto: { type: "string", description: `Un solo punto, concreto y verificable, máx ${L.textoPuntoLen} caracteres.` },
    fuente_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: L.fuenteIdsPorPuntoMax, description: "1 a 2 ids de las fuentes ofrecidas (internas y/o externas) que respaldan este punto." },
    confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza de este punto según la evidencia disponible." },
  },
  required: ["texto", "fuente_ids", "confianza"],
  additionalProperties: false,
};
const SCHEMA_CUADRANTE: Record<string, unknown> = { type: "array", maxItems: L.puntosPorCuadranteMax, items: SCHEMA_PUNTO_FODA };

export const SCHEMA_EMITIR_FODA: Record<string, unknown> = {
  type: "object",
  properties: {
    fortalezas: { ...SCHEMA_CUADRANTE, description: "Fortalezas de SIM, respaldadas principalmente en datos internos." },
    debilidades: { ...SCHEMA_CUADRANTE, description: "Debilidades de SIM, respaldadas principalmente en datos internos." },
    oportunidades: { ...SCHEMA_CUADRANTE, description: "Oportunidades externas vigentes (requieren fuente externa citable si hubo búsqueda web)." },
    amenazas: { ...SCHEMA_CUADRANTE, description: "Amenazas externas vigentes (requieren fuente externa citable si hubo búsqueda web)." },
    conclusion: { type: "string", description: `Conclusión prudente, separando hechos de inferencias, máx ${L.conclusionLen} caracteres.` },
  },
  required: ["fortalezas", "debilidades", "oportunidades", "amenazas", "conclusion"],
  additionalProperties: false,
};

export type PuntoFodaValidado = { texto: string; fuenteIds: string[]; confianza: "alta" | "media" | "baja" };
export type FodaValidado = { fortalezas: PuntoFodaValidado[]; debilidades: PuntoFodaValidado[]; oportunidades: PuntoFodaValidado[]; amenazas: PuntoFodaValidado[]; conclusion: string };
export type ResultadoValidacionFoda = { ok: true; spec: FodaValidado } | { ok: false; errores: string[] };

function esObj(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function unaLinea(v: unknown, max: number): string {
  const limpio = typeof v === "string" ? v.replace(/\s*\r?\n\s*/g, " ").trim() : "";
  return recortarNatural(limpio, max);
}

export function validarFoda(entrada: unknown, ctx: { internas: FuenteInternaDisponible[]; externas: FuenteExternaDisponible[] }): ResultadoValidacionFoda {
  const errores: string[] = [];
  const o = esObj(entrada) ? entrada : {};
  const idsValidos = new Set([...ctx.internas.map((f) => f.id), ...ctx.externas.map((f) => f.id)]);

  const validarCuadrante = (v: unknown, nombre: string): PuntoFodaValidado[] => {
    return arr(v).slice(0, L.puntosPorCuadranteMax).map((p, i): PuntoFodaValidado | null => {
      const pp = esObj(p) ? p : {};
      const texto = unaLinea(pp.texto, L.textoPuntoLen);
      if (!texto) { errores.push(`${nombre}[${i}] sin texto.`); return null; }
      const fuenteIdsRaw = arr(pp.fuente_ids).map((x) => String(x)).slice(0, L.fuenteIdsPorPuntoMax);
      if (fuenteIdsRaw.length === 0) { errores.push(`${nombre}[${i}] ("${texto.slice(0, 40)}…") sin fuente_ids: todo punto debe citar procedencia.`); return null; }
      for (const id of fuenteIdsRaw) if (!idsValidos.has(id)) errores.push(`${nombre}[${i}] referencia un id de fuente inexistente: "${id}".`);
      const confianza = pp.confianza === "alta" || pp.confianza === "media" || pp.confianza === "baja" ? pp.confianza : "media";
      return { texto, fuenteIds: [...new Set(fuenteIdsRaw)], confianza };
    }).filter((p): p is PuntoFodaValidado => p !== null);
  };

  const fortalezas = validarCuadrante(o.fortalezas, "fortalezas");
  const debilidades = validarCuadrante(o.debilidades, "debilidades");
  const oportunidades = validarCuadrante(o.oportunidades, "oportunidades");
  const amenazas = validarCuadrante(o.amenazas, "amenazas");
  const conclusion = unaLinea(o.conclusion, L.conclusionLen);
  if (!conclusion) errores.push("Falta conclusion.");
  if (fortalezas.length + debilidades.length + oportunidades.length + amenazas.length === 0) errores.push("El FODA no tiene ningún punto respaldado en los cuatro cuadrantes.");

  if (errores.length > 0) return { ok: false, errores };
  return { ok: true, spec: { fortalezas, debilidades, oportunidades, amenazas, conclusion } };
}

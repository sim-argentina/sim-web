import { LIMITES_DEFAULT, type LimitesExtraccion } from "@/lib/ia/docs/extractors";

// IA SIM · Bloque 4B — Límites de archivos/conocimiento, configurables por entorno.
function num(name: string, def: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export type LimitesDocs = LimitesExtraccion & {
  maxBytesArchivo: number;
  maxArchivosPorMensaje: number;
};

export function getLimitesDocs(): LimitesDocs {
  return {
    maxBytesArchivo: num("IA_DOC_MAX_BYTES", 25 * 1024 * 1024),
    maxArchivosPorMensaje: num("IA_DOC_MAX_ARCHIVOS", 5),
    maxPaginas: num("IA_DOC_MAX_PAGINAS", LIMITES_DEFAULT.maxPaginas),
    maxHojas: num("IA_DOC_MAX_HOJAS", LIMITES_DEFAULT.maxHojas),
    maxFilas: num("IA_DOC_MAX_FILAS", LIMITES_DEFAULT.maxFilas),
    maxDiapositivas: num("IA_DOC_MAX_DIAPOS", LIMITES_DEFAULT.maxDiapositivas),
    maxCaracteres: num("IA_DOC_MAX_CARACTERES", LIMITES_DEFAULT.maxCaracteres),
  };
}

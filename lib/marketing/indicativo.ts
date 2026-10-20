// ============================================================================
// Indicativo interurbano de un teléfono argentino (Marketing). PURO.
// ----------------------------------------------------------------------------
// El número nacional tiene siempre 10 dígitos: indicativo de 2, 3 o 4 dígitos +
// abonado de 8, 7 o 6. Como 49 indicativos de 4 dígitos empiezan con uno de 3
// (2646 / 264, 3584 / 358, 2945 / 294…), un número como 2646xxxxxx admite dos
// lecturas. Se decide SOLO con fuentes oficiales, en este orden:
//
//   1. Tabla de indicativos de ENACOM (lib/indicativosArgentina.ts): si un solo
//      indicativo oficial es prefijo del número, es ese.
//   2. Plan Fundamental de Numeración Nacional (Res. SC 46/97, III.2.1.2): la
//      característica de central, es decir el primer dígito del abonado, no puede
//      ser 0 ni 1. Si una de las dos lecturas deja un abonado que empieza con 0 o
//      1, esa lectura no existe (2940xxxxxx solo puede ser 2940; 35841xxxxx no
//      puede ser 3584 y queda 358).
//   3. Bloques asignados por ENACOM (lib/bloquesNumeracionAmbiguos.ts): cada
//      bloque es el comienzo de un rango asignado a UN indicativo, y en toda la
//      planilla ningún rango se superpone con otro de distinto indicativo. Si el
//      número cae en un bloque de una lectura, es esa: la otra queda descartada.
//   4. Si ninguna de las tres lo decide (dos lecturas válidas y el número no está
//      en ningún bloque asignado), el indicativo queda INDETERMINADO.
//
// "Gana el más largo" NO es una regla válida: en 17 de los 49 pares el indicativo
// de 3 tiene bloques asignados que empiezan con el 4.º dígito del de 4 (264 tiene
// 264 661…, que se escribe 2646 61…; 358 tiene 358 4xx…, que se escribe 3584 xx…).
//
// Contraprueba con el número tal como se escribió: si traía el "15" (0294 15-…),
// la posición del 15 dice qué indicativo usó la persona. Si contradice lo que dicen
// las fuentes, queda INDETERMINADO. Lo escrito nunca decide por sí solo: puede
// estar mal cargado.
//
// Lo que no se determina no recibe área ni localidad. Y aun determinado, el
// indicativo es el área donde se dio de alta la línea: aproximación geográfica,
// nunca prueba de residencia.
// ============================================================================

import { BLOQUES_AMBIGUOS } from "@/lib/bloquesNumeracionAmbiguos";
import { INDICATIVOS_ARGENTINA } from "@/lib/indicativosArgentina";

type Fila = { indicativo: string; area: string; provincia: string };

const POR_INDICATIVO: ReadonlyMap<string, Fila> = new Map(
  INDICATIVOS_ARGENTINA.map(([indicativo, area, provincia]) => [indicativo, { indicativo, area, provincia }]),
);
const DE_3: ReadonlySet<string> = new Set(INDICATIVOS_ARGENTINA.filter(([i]) => i.length === 3).map(([i]) => i));

const aConjunto = (lista: string) => new Set(lista.split(" ").filter(Boolean));
const BLOQUES: ReadonlyMap<string, { corto: string; delLargo: ReadonlySet<string>; delCorto: ReadonlySet<string> }> = new Map(
  Object.entries(BLOQUES_AMBIGUOS).map(([largo, b]) => [largo, { corto: b.corto, delLargo: aConjunto(b.delLargo), delCorto: aConjunto(b.delCorto) }]),
);

export function esIndicativoOficial(codigo: string): boolean {
  return POR_INDICATIVO.has(codigo);
}

export function areaDeIndicativo(codigo: string): { area: string; provincia: string } | null {
  const f = POR_INDICATIVO.get(codigo);
  return f ? { area: f.area, provincia: f.provincia } : null;
}

/** Qué fuente decidió: la tabla (una sola lectura), el plan (0/1 inicial) o un bloque asignado. */
export type BaseIndicativo = "tabla" | "plan_numeracion" | "bloque_asignado";

export type Indicativo =
  | { ok: true; indicativo: string; area: string; provincia: string; base: BaseIndicativo }
  | { ok: false; motivo: "sin_indicativo_oficial" | "sin_bloque_asignado" | "contradice_lo_escrito"; candidatos: string[] };

const CANONICO_RE = /^[0-9]{10}$/;
const SIMBOLOS_PERMITIDOS = /^[0-9+().\-\s]+$/;

/**
 * Indicativo que la persona escribió, cuando se puede leer de la forma vieja con
 * "15" (12 dígitos tras el mismo recorte que hace normalizarTelefonoDetallado).
 * Sin "15" no hay forma de saber dónde termina el indicativo: null.
 */
export function indicativoEscrito(crudo: string | null | undefined): string | null {
  const t = String(crudo ?? "").trim();
  if (!t || !SIMBOLOS_PERMITIDOS.test(t)) return null;
  const conMas = t.startsWith("+");
  let d = t.replace(/[^0-9]/g, "");
  if (conMas) {
    if (!d.startsWith("54")) return null;
    d = d.slice(2);
  } else if (d.startsWith("00")) {
    d = d.slice(2);
    if (!d.startsWith("54")) return null;
    d = d.slice(2);
  } else if (d.startsWith("54") && d.length >= 12) {
    d = d.slice(2);
  }
  while (d.length > 10 && (d[0] === "0" || d[0] === "9")) d = d.slice(1);
  if (d.length !== 12) return null;
  const largos: number[] = [];
  if (d.startsWith("11")) largos.push(2);
  if (DE_3.has(d.slice(0, 3))) largos.push(3);
  if (d[0] === "2" || d[0] === "3") largos.push(4);
  const conQuince = largos.filter((a) => d.slice(a, a + 2) === "15");
  return conQuince.length === 1 ? d.slice(0, conQuince[0]) : null;
}

/** ¿El abonado (lo que sigue al indicativo) empieza con un bloque del conjunto? */
function enBloque(abonado: string, bloques: ReadonlySet<string>): boolean {
  for (let n = 1; n <= abonado.length; n++) if (bloques.has(abonado.slice(0, n))) return true;
  return false;
}

/** Lectura según las fuentes oficiales, antes de mirar cómo se escribió. */
function segunFuentes(canonico: string): { indicativo: string; base: BaseIndicativo } | { motivo: "sin_indicativo_oficial" | "sin_bloque_asignado"; candidatos: string[] } {
  const candidatos = [canonico.slice(0, 4), canonico.slice(0, 3), canonico.slice(0, 2)].filter((c) => POR_INDICATIVO.has(c));
  if (candidatos.length === 0) return { motivo: "sin_indicativo_oficial", candidatos: [] };
  if (candidatos.length === 1) return { indicativo: candidatos[0], base: "tabla" };
  // Dos lecturas: un indicativo de 4 y su prefijo de 3 (el 11 no es prefijo de ninguno).
  const [largo, corto] = candidatos;
  const b = BLOQUES.get(largo);
  if (candidatos.length !== 2 || !b || b.corto !== corto) {
    throw new Error(`indicativo ambiguo sin bloques generados: ${candidatos.join("/")}`);
  }
  // Res. SC 46/97, III.2.1.2: el abonado no empieza con 0 ni con 1.
  const validas = candidatos.filter((c) => canonico[c.length] !== "0" && canonico[c.length] !== "1");
  if (validas.length === 1) return { indicativo: validas[0], base: "plan_numeracion" };
  const ambos = [...candidatos].sort();
  if (validas.length === 0) return { motivo: "sin_bloque_asignado", candidatos: ambos };
  const enLargo = enBloque(canonico.slice(4), b.delLargo);
  const enCorto = enBloque(canonico.slice(3), b.delCorto);
  if (enLargo !== enCorto) return { indicativo: enLargo ? largo : corto, base: "bloque_asignado" };
  return { motivo: "sin_bloque_asignado", candidatos: ambos };
}

/**
 * Indicativo oficial de un número canónico de 10 dígitos. `escritos` son las
 * formas en que apareció el número (para la contraprueba del "15").
 */
export function indicativoDe(canonico: string, escritos: readonly (string | null | undefined)[] = []): Indicativo {
  if (!CANONICO_RE.test(canonico)) return { ok: false, motivo: "sin_indicativo_oficial", candidatos: [] };
  const r = segunFuentes(canonico);
  if ("motivo" in r) return { ok: false, motivo: r.motivo, candidatos: r.candidatos };
  for (const e of escritos) {
    const escrito = indicativoEscrito(e);
    if (escrito && escrito !== r.indicativo) {
      return { ok: false, motivo: "contradice_lo_escrito", candidatos: [...new Set([r.indicativo, escrito])].sort() };
    }
  }
  const f = POR_INDICATIVO.get(r.indicativo)!;
  return { ok: true, indicativo: f.indicativo, area: f.area, provincia: f.provincia, base: r.base };
}

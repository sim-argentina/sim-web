// ============================================================================
// Indicativo interurbano de un teléfono argentino (Marketing). PURO.
// ----------------------------------------------------------------------------
// Fuente: lib/indicativosArgentina.ts (planilla oficial de ENACOM, 300
// indicativos). El número nacional tiene siempre 10 dígitos: indicativo de 2, 3
// o 4 dígitos + abonado de 8, 7 o 6. Como 49 indicativos de 4 dígitos empiezan
// con uno de 3 (353 / 3532, 358 / 3582, 294 / 2945…), comparar por prefijo
// corto mete en un segmento números de otra área.
//
// Regla: gana el indicativo oficial MÁS LARGO que coincide con el número. Se
// apoya en el plan de numeración cerrado de 10 dígitos: si existe 3532, el área
// 353 no asigna abonados que empiecen con 2 (dos números distintos no pueden
// tener los mismos 10 dígitos). No se pudo verificar bloque por bloque: ENACOM
// publica los indicativos, no la asignación de cada bloque de abonados.
//
// Contraprueba con el número tal como se escribió: si traía el "15" (0294 15-…),
// la posición del 15 dice qué indicativo usó la persona. Si contradice la regla
// del más largo, el indicativo queda INDETERMINADO: no se elige uno en silencio.
//
// Lo que no se determina no recibe área ni localidad. Y aun determinado, el
// indicativo es el área donde se dio de alta la línea: aproximación geográfica,
// nunca prueba de residencia.
// ============================================================================

import { INDICATIVOS_ARGENTINA } from "@/lib/indicativosArgentina";

type Fila = { indicativo: string; area: string; provincia: string };

const POR_INDICATIVO: ReadonlyMap<string, Fila> = new Map(
  INDICATIVOS_ARGENTINA.map(([indicativo, area, provincia]) => [indicativo, { indicativo, area, provincia }]),
);
const DE_3: ReadonlySet<string> = new Set(INDICATIVOS_ARGENTINA.filter(([i]) => i.length === 3).map(([i]) => i));

export function esIndicativoOficial(codigo: string): boolean {
  return POR_INDICATIVO.has(codigo);
}

export function areaDeIndicativo(codigo: string): { area: string; provincia: string } | null {
  const f = POR_INDICATIVO.get(codigo);
  return f ? { area: f.area, provincia: f.provincia } : null;
}

export type Indicativo =
  | { ok: true; indicativo: string; area: string; provincia: string }
  | { ok: false; motivo: "sin_indicativo_oficial" | "contradice_lo_escrito"; candidatos: string[] };

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

/**
 * Indicativo oficial de un número canónico de 10 dígitos. `escritos` son las
 * formas en que apareció el número (para la contraprueba del "15").
 */
export function indicativoDe(canonico: string, escritos: readonly (string | null | undefined)[] = []): Indicativo {
  if (!CANONICO_RE.test(canonico)) return { ok: false, motivo: "sin_indicativo_oficial", candidatos: [] };
  const candidatos = [canonico.slice(0, 4), canonico.slice(0, 3), canonico.slice(0, 2)].filter((c) => POR_INDICATIVO.has(c));
  if (candidatos.length === 0) return { ok: false, motivo: "sin_indicativo_oficial", candidatos: [] };
  const elegido = candidatos[0]; // el más largo
  for (const e of escritos) {
    const escrito = indicativoEscrito(e);
    if (escrito && escrito !== elegido) {
      return { ok: false, motivo: "contradice_lo_escrito", candidatos: [...new Set([elegido, escrito])].sort() };
    }
  }
  const f = POR_INDICATIVO.get(elegido)!;
  return { ok: true, indicativo: f.indicativo, area: f.area, provincia: f.provincia };
}

// IA SIM · Bloque 5C — DIRECCIÓN DEL CAMBIO. Puro.
//
// Un número correcto con el verbo equivocado miente igual: "la facturación subió 22,4%" usa una
// cifra que sale de la evidencia y dice exactamente lo contrario de lo que pasó. Acá se verifica
// la dirección, en dos capas:
//
//  1) ESTRUCTURADA y autoritativa: cada afirmación de la síntesis declara `metrica` y `direccion`
//     con valores de listas cerradas, y el servidor los compara contra el signo que calculó.
//     No hay interpretación de prosa: o el enum coincide con el dato, o la síntesis se descarta.
//  2) PROSA, como red secundaria: el texto libre (la conclusión, y el texto de cada afirmación)
//     se revisa buscando verbos de dirección y atribuyéndolos al sujeto nombrado más cerca.
//     Esta capa es conservadora a propósito: si declara un cambio y no se puede saber de qué
//     métrica habla, NO se publica. El fallback es la respuesta determinística, que ya dice las
//     direcciones correctas.
//
// La capa 2 entiende negación ("no subió"), orden inverso de cláusulas, varias métricas en la
// misma oración y los alias con los que un administrador nombra cada métrica.

import { UMBRAL_ESTABLE_PCT, UMBRAL_CLARO_PCT, sinAcentos } from "@/lib/ia/plan/compatibilidad";
import { METRICAS_SEMANTICAS } from "@/lib/ia/analisis/catalogoSemantico";

/** Direcciones que una afirmación puede declarar. Lista cerrada: va en el schema de la herramienta. */
export const DIRECCIONES = ["subio", "bajo", "estable", "sin_direccion"] as const;
export type Direccion = (typeof DIRECCIONES)[number];

/** Métricas del planificador que no viven en el catálogo semántico de 5B, con sus alias. */
const ALIAS_PLANIFICADOR: Record<string, readonly string[]> = {
  horas_programadas: ["horas programadas", "horas", "disponibilidad", "jornadas programadas", "horas de cronograma"],
  dias_abiertos: ["dias abiertos", "dias de apertura", "apertura"],
  ingresos_brutos: ["ingresos brutos", "bruto", "facturacion bruta"],
  ingresos_netos: ["ingresos netos", "neto"],
  comisiones: ["comisiones", "comision"],
  ganancia_sim: ["ganancia", "ganancia sim", "resultado"],
};

/**
 * Cómo se nombra una métrica al hablar. Sale del catálogo semántico cuando la métrica está ahí
 * (una sola declaración para la definición y para el lenguaje) y de la tabla de arriba para las
 * que solo existen en el planificador. La etiqueta siempre cuenta como alias.
 */
export function aliasDeMetrica(metrica: string, etiqueta: string): string[] {
  const delCatalogo = METRICAS_SEMANTICAS[metrica]?.alias ?? ALIAS_PLANIFICADOR[metrica] ?? [];
  const lista = [...delCatalogo, etiqueta];
  // Las palabras largas de la etiqueta también sirven: "Turnos comerciales" se nombra "turnos".
  for (const w of sinAcentos(etiqueta).toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 5) lista.push(w);
  }
  return [...new Set(lista.map((a) => sinAcentos(a).toLowerCase().trim()).filter(Boolean))];
}

/** Un sujeto verificable: una métrica comparada, o una fuente dentro de un desglose. */
export type SujetoDireccion = {
  /** Identificador del sujeto, para explicar un rechazo sin exponer ids internos. */
  clave: string;
  etiqueta: string;
  alias: string[];
  diferencia: number;
  /** Null cuando la base es cero: la magnitud no se puede juzgar. */
  variacionPct: number | null;
};

/** La dirección que los datos muestran. */
export function direccionReal(s: { diferencia: number; variacionPct: number | null }): Exclude<Direccion, "sin_direccion"> {
  if (s.variacionPct != null && Math.abs(s.variacionPct) < UMBRAL_ESTABLE_PCT) return "estable";
  if (s.diferencia > 0) return "subio";
  if (s.diferencia < 0) return "bajo";
  return "estable";
}

const NOMBRE_DIRECCION: Record<Exclude<Direccion, "sin_direccion">, string> = {
  subio: "subió",
  bajo: "bajó",
  estable: "se mantuvo estable",
};

/**
 * Capa 1 — la dirección DECLARADA contra el dato. Devuelve el motivo del rechazo, o null.
 * Un cambio por debajo del umbral de estabilidad se considera estable: declarar "subió" o "bajó"
 * ahí también se rechaza, porque el servidor publica "se mantuvo estable" para ese caso.
 */
export function verificarDireccionDeclarada(sujeto: SujetoDireccion, declarada: Direccion): string | null {
  if (declarada === "sin_direccion") return null;
  const real = direccionReal(sujeto);
  if (declarada === real) return null;
  const etq = sujeto.etiqueta.toLowerCase();
  if (real === "estable") {
    const pct = sujeto.variacionPct == null ? "" : ` (cambió ${Math.abs(sujeto.variacionPct).toFixed(1).replace(".", ",")}%, por debajo del ${UMBRAL_ESTABLE_PCT}% que el servidor considera estable)`;
    return `dice que ${etq} ${NOMBRE_DIRECCION[declarada]} y los datos la muestran estable${pct}`;
  }
  return `dice que ${etq} ${NOMBRE_DIRECCION[declarada]} y en realidad ${NOMBRE_DIRECCION[real]}`;
}

// ── Capa 2: la prosa ────────────────────────────────────────────────────────────
// Verbos de dirección, en singular y plural. Se buscan sobre el texto sin acentos.
const RE_SUBE = /\b(subio|subieron|aumento|aumentaron|crecio|crecieron|mejoro|mejoraron|repunto|repuntaron|trepo|al alza|mas alt[oa]s?)\b/g;
const RE_BAJA = /\b(cayo|cayeron|bajo|bajaron|disminuyo|disminuyeron|descendio|descendieron|retrocedio|retrocedieron|empeoro|empeoraron|a la baja|mas baj[oa]s?)\b/g;
const RE_ESTABLE = /\b(se mantuvo|se mantuvieron|se sostuvo|se sostuvieron|estable|estables|sin cambios|sin variacion|casi igual(es)?|practicamente igual(es)?|igual que)\b/g;
// Palabras que convierten un cambio en un cambio "claro": se miden contra el umbral.
const RE_ENFASIS = /\b(claramente|marcadamente|fuertemente|notablemente|muy|much[oa]s?|drasticamente|se desplomo|se derrumbo)\b/;
// Negación inmediatamente antes del verbo: "no subió", "ni cayó", "tampoco bajó", "sin caer".
const RE_NEGACION = /\b(no|ni|tampoco|sin)\b[^.;]{0,14}$/;

/** Hasta dónde se le atribuye una dirección al sujeto nombrado más cerca. */
export const VENTANA_ATRIBUCION = 140;

type Marcador = { direccion: Exclude<Direccion, "sin_direccion">; negada: boolean; enfasis: boolean; posicion: number; largo: number };

/** Todas las direcciones que un texto declara, con su posición, negación y énfasis. */
export function marcadoresDe(texto: string): Marcador[] {
  const t = sinAcentos(texto).toLowerCase();
  const out: Marcador[] = [];
  const buscar = (re: RegExp, direccion: Marcador["direccion"]) => {
    for (const m of t.matchAll(new RegExp(re.source, "g"))) {
      const posicion = m.index ?? 0;
      const antes = t.slice(Math.max(0, posicion - 22), posicion);
      const ventana = t.slice(Math.max(0, posicion - 25), posicion + m[0].length + 25);
      out.push({ direccion, negada: RE_NEGACION.test(antes), enfasis: RE_ENFASIS.test(ventana), posicion, largo: m[0].length });
    }
  };
  buscar(RE_SUBE, "subio");
  buscar(RE_BAJA, "bajo");
  buscar(RE_ESTABLE, "estable");
  return out.sort((a, b) => a.posicion - b.posicion);
}

/** Dónde nombra el texto a un sujeto, y con cuántos caracteres (para resolver empates). */
function mencionesDe(t: string, sujeto: SujetoDireccion): Array<{ posicion: number; largo: number }> {
  const out: Array<{ posicion: number; largo: number }> = [];
  for (const a of sujeto.alias) {
    let i = t.indexOf(a);
    while (i >= 0) { out.push({ posicion: i, largo: a.length }); i = t.indexOf(a, i + 1); }
  }
  return out;
}

/**
 * Corta el texto en CLÁUSULAS, con el offset donde empieza cada una. Un verbo de dirección solo
 * se atribuye a un sujeto de SU cláusula: sin esto, "mientras las horas programadas se
 * mantuvieron estables, la facturación cayó" le colgaba "estables" a la facturación, que está
 * más cerca en caracteres pero pertenece a la otra mitad de la oración.
 *
 * Los separadores de miles y la coma decimal NO cortan: "$3.014.000" y "22,4%" son un solo dato.
 */
export function clausulas(t: string): Array<{ inicio: number; texto: string }> {
  const out: Array<{ inicio: number; texto: string }> = [];
  const re = /(?<![0-9])[,;:.](?![0-9])|\s+(?:mientras que|mientras|aunque|pero|en cambio|sin embargo|y)\s+/g;
  let desde = 0;
  for (const m of t.matchAll(re)) {
    const fin = m.index ?? 0;
    out.push({ inicio: desde, texto: t.slice(desde, fin) });
    desde = fin + m[0].length;
  }
  out.push({ inicio: desde, texto: t.slice(desde) });
  return out.filter((c) => c.texto.trim().length > 0);
}

export type ResultadoProsa = { ok: true } | { ok: false; motivo: string };

/**
 * Capa 2 — revisa la prosa. Cada verbo de dirección se atribuye a un sujeto de su misma cláusula
 * (con el alias más largo, para que "los ingresos manuales" no se confunda con "los ingresos") y
 * se compara con el dato. Si un verbo declara un cambio y su cláusula no nombra ningún sujeto
 * verificable, la dirección NO se puede validar y la síntesis se descarta: el fallback es la
 * respuesta determinística, que ya publica las direcciones correctas.
 */
export function verificarProsa(texto: string, sujetos: SujetoDireccion[]): ResultadoProsa {
  const t = sinAcentos(texto).toLowerCase();
  const marcadores = marcadoresDe(texto);
  if (marcadores.length === 0) return { ok: true };
  const partes = clausulas(t);

  for (const m of marcadores) {
    const clausula = [...partes].reverse().find((c) => m.posicion >= c.inicio) ?? partes[0];
    const relativo = m.posicion - clausula.inicio;
    // Candidato: el sujeto nombrado en ESTA cláusula; ante empate, el alias más largo.
    let mejor: { sujeto: SujetoDireccion; distancia: number; largo: number } | null = null;
    for (const sujeto of sujetos) {
      for (const men of mencionesDe(clausula.texto, sujeto)) {
        const bruta = men.posicion <= relativo ? relativo - (men.posicion + men.largo) : men.posicion - (relativo + m.largo);
        const d = Math.max(0, bruta);
        if (d > VENTANA_ATRIBUCION) continue;
        if (!mejor || men.largo > mejor.largo || (men.largo === mejor.largo && d < mejor.distancia)) {
          mejor = { sujeto, distancia: d, largo: men.largo };
        }
      }
    }
    if (!mejor) {
      return {
        ok: false,
        motivo: "declara un cambio sin decir de qué métrica, así que la dirección no se puede verificar contra los datos",
      };
    }
    const real = direccionReal(mejor.sujeto);
    const etq = mejor.sujeto.etiqueta.toLowerCase();

    if (m.negada) {
      // "no subió" solo es falso si realmente subió. Con negación no se juzga la magnitud.
      if (m.direccion === real) {
        return { ok: false, motivo: `dice que ${etq} no ${NOMBRE_DIRECCION[m.direccion]} y los datos muestran que sí` };
      }
      continue;
    }

    if (m.direccion !== real) {
      if (real === "estable") {
        const pct = mejor.sujeto.variacionPct == null ? "" : ` (cambió ${Math.abs(mejor.sujeto.variacionPct).toFixed(1).replace(".", ",")}%, por debajo del ${UMBRAL_ESTABLE_PCT}%)`;
        return { ok: false, motivo: `dice que ${etq} ${NOMBRE_DIRECCION[m.direccion]} y los datos la muestran estable${pct}` };
      }
      if (m.direccion === "estable") {
        const pct = mejor.sujeto.variacionPct == null ? "" : ` y cambió ${Math.abs(mejor.sujeto.variacionPct).toFixed(1).replace(".", ",")}%, por encima del ${UMBRAL_ESTABLE_PCT}% que el servidor considera estable`;
        return { ok: false, motivo: `dice que ${etq} se mantuvo estable${pct}` };
      }
      return { ok: false, motivo: `dice que ${etq} ${NOMBRE_DIRECCION[m.direccion]} y en realidad ${NOMBRE_DIRECCION[real]}` };
    }

    // Dirección correcta: queda el énfasis, que también tiene umbral escrito.
    if (m.enfasis && m.direccion !== "estable" && mejor.sujeto.variacionPct != null && Math.abs(mejor.sujeto.variacionPct) < UMBRAL_CLARO_PCT) {
      return {
        ok: false,
        motivo: `enfatiza el cambio de ${etq} y la variación (${Math.abs(mejor.sujeto.variacionPct).toFixed(1).replace(".", ",")}%) no llega al ${UMBRAL_CLARO_PCT}% que el servidor considera un cambio claro`,
      };
    }
  }
  return { ok: true };
}

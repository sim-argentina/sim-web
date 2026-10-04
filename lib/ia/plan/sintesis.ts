// IA SIM · Bloque 5C — VALIDACIÓN de la síntesis que propone el modelo. Puro.
//
// El modelo puede redactar una conclusión, pero cada afirmación cuantitativa tiene que apoyarse
// en una evidencia que el servidor calculó. Acá se verifica, en este orden:
//
//  1) FORMA: la conclusión existe, no es larga de más, y cada afirmación cita evidencias reales.
//  2) DIRECCIÓN DECLARADA: cada afirmación trae `metrica` y `direccion` de listas cerradas, y el
//     servidor las compara contra el signo que calculó. Esta es la capa autoritativa: no hay
//     interpretación de prosa, o el enum coincide con el dato o la síntesis se descarta.
//  3) NÚMEROS: ninguna cifra que no salga de la evidencia o de un cálculo del servidor.
//  4) PROSA: red secundaria sobre el texto libre (conclusión y texto de cada afirmación), con
//     verbos, negación y umbrales. Es conservadora: si declara un cambio y no se puede saber de
//     qué métrica habla, se descarta.
//  5) LO QUE NO SE PUBLICA: causas afirmadas, ids internos, datos técnicos.
//
// Si algo no cierra, la síntesis se descarta entera y queda la respuesta determinística, que ya
// publica los números y las direcciones correctas.

import { afirmaCausa, UMBRAL_ESTABLE_PCT, UMBRAL_CLARO_PCT } from "@/lib/ia/plan/compatibilidad";
import { DIRECCIONES, aliasDeMetrica, verificarDireccionDeclarada, verificarProsa, type Direccion, type SujetoDireccion } from "@/lib/ia/plan/direccion";
import type { Evidencia, ComparacionCalculada } from "@/lib/ia/plan/ejecutorPlan";

export const MAX_AFIRMACIONES = 3;
export const MAX_LARGO_CONCLUSION = 600;
export const MAX_LARGO_AFIRMACION = 300;

export type SintesisPropuesta = {
  conclusion?: unknown;
  afirmaciones?: unknown;
};

export type SintesisValida = { ok: true; texto: string; evidenciasCitadas: string[] };
export type SintesisInvalida = { ok: false; motivo: string };

/** Normaliza un número que aparece en un texto a una clave comparable. */
function clave(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

/** Extrae los números de un texto, tolerando $, %, separadores de miles y coma decimal. */
function numerosDe(texto: string): number[] {
  const out: number[] = [];
  const re = /-?\$?\s?\d[\d.]*(?:,\d+)?\s?%?/g;
  for (const m of texto.match(re) ?? []) {
    const limpio = m.replace(/[$%\s]/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(limpio);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Todos los valores que el modelo TIENE derecho a mencionar. */
function valoresPermitidos(evidencias: Evidencia[], comparaciones: ComparacionCalculada[]): Set<string> {
  const s = new Set<string>();
  const agregar = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    s.add(clave(n));
    s.add(clave(Math.abs(n)));
    // Un porcentaje o un importe redondeado a entero sigue siendo el mismo dato.
    s.add(clave(Math.round(n)));
    s.add(clave(Math.abs(Math.round(n))));
    s.add(clave(Math.round(n * 10) / 10));
    s.add(clave(Math.abs(Math.round(n * 10) / 10)));
  };
  for (const e of evidencias) agregar(e.valor);
  for (const c of comparaciones) {
    agregar(c.base.valor);
    agregar(c.comparado.valor);
    agregar(c.diferencia);
    agregar(c.variacionPct);
    for (const f of c.porFuente ?? []) { agregar(f.base); agregar(f.comparado); agregar(f.delta); }
  }
  // Umbrales publicados y años de los períodos: no son cifras de negocio inventadas.
  agregar(UMBRAL_ESTABLE_PCT);
  agregar(UMBRAL_CLARO_PCT);
  for (let anio = 2020; anio <= 2100; anio++) s.add(clave(anio));
  return s;
}

/**
 * Sujetos cuya dirección se puede verificar: cada métrica comparada y cada fuente de su
 * desglose. Una fuente también es verificable porque tiene su propio delta y su propia base.
 */
export function sujetosDe(comparaciones: ComparacionCalculada[]): SujetoDireccion[] {
  const out: SujetoDireccion[] = [];
  for (const c of comparaciones) {
    out.push({
      clave: c.metrica,
      etiqueta: c.etiqueta,
      alias: aliasDeMetrica(c.metrica, c.etiqueta),
      diferencia: c.diferencia,
      variacionPct: c.variacionPct,
    });
    for (const f of c.porFuente ?? []) {
      out.push({
        clave: `fuente:${f.fuente}`,
        etiqueta: f.etiqueta,
        alias: aliasDeMetrica(`fuente:${f.fuente}`, f.etiqueta),
        diferencia: f.delta,
        variacionPct: f.base === 0 ? null : Math.round((f.delta / Math.abs(f.base)) * 1000) / 10,
      });
    }
  }
  return out;
}

/** Ningún id interno puede salir publicado. */
const RE_IDS_INTERNOS = /\b(p[1-9][0-9]?\.[a-z_]+|c[1-9][0-9]?\b|evidenciaId|calculoId|paso\s*p[1-9])\b/i;
const RE_TECNICO = /\{|\}|\[\s*\{|select\s|from\s+\w+\s+where|null|undefined|NaN|Infinity|<!--/i;

export function validarSintesis(
  propuesta: SintesisPropuesta,
  evidencias: Evidencia[],
  comparaciones: ComparacionCalculada[],
): SintesisValida | SintesisInvalida {
  const conclusion = String(propuesta.conclusion ?? "").trim();
  if (!conclusion) return { ok: false, motivo: "la síntesis vino vacía" };
  if (conclusion.length > MAX_LARGO_CONCLUSION) return { ok: false, motivo: "la conclusión es más larga de lo permitido" };

  const crudoAfirm = Array.isArray(propuesta.afirmaciones) ? propuesta.afirmaciones : [];
  if (crudoAfirm.length > MAX_AFIRMACIONES) return { ok: false, motivo: `trae ${crudoAfirm.length} afirmaciones y el máximo es ${MAX_AFIRMACIONES}` };

  const idsEvidencia = new Set(evidencias.map((e) => e.evidenciaId));
  const permitidos = valoresPermitidos(evidencias, comparaciones);
  const sujetos = sujetosDe(comparaciones);
  const porClave = new Map(sujetos.map((s) => [s.clave, s]));
  const citadas: string[] = [];
  const textos: string[] = [conclusion];

  for (const [i, cruda] of crudoAfirm.entries()) {
    if (!cruda || typeof cruda !== "object") return { ok: false, motivo: `la afirmación ${i + 1} no tiene la forma esperada` };
    const a = cruda as Record<string, unknown>;
    const texto = String(a.texto ?? "").trim();
    if (!texto) return { ok: false, motivo: `la afirmación ${i + 1} vino vacía` };
    if (texto.length > MAX_LARGO_AFIRMACION) return { ok: false, motivo: `la afirmación ${i + 1} es demasiado larga` };
    const refs = (Array.isArray(a.evidencias) ? a.evidencias : []).map((x) => String(x));
    if (refs.length === 0) return { ok: false, motivo: `la afirmación ${i + 1} no cita ninguna evidencia` };
    for (const ref of refs) {
      if (!idsEvidencia.has(ref)) return { ok: false, motivo: `la afirmación ${i + 1} cita una evidencia que no existe` };
      citadas.push(ref);
    }

    // ── Capa autoritativa: la dirección DECLARADA, con enums, contra el dato calculado ──
    const direccion = String(a.direccion ?? "").trim() as Direccion;
    if (!DIRECCIONES.includes(direccion)) {
      return { ok: false, motivo: `la afirmación ${i + 1} no declara una dirección válida (${DIRECCIONES.join(", ")})` };
    }
    if (direccion !== "sin_direccion") {
      const metrica = String(a.metrica ?? "").trim();
      if (!metrica) return { ok: false, motivo: `la afirmación ${i + 1} declara una dirección sin decir de qué métrica` };
      const sujeto = porClave.get(metrica);
      if (!sujeto) {
        return {
          ok: false,
          motivo: `la afirmación ${i + 1} declara la dirección de "${metrica}", que no es una métrica comparada en este análisis`,
        };
      }
      const choque = verificarDireccionDeclarada(sujeto, direccion);
      if (choque) return { ok: false, motivo: choque };
    }

    textos.push(texto);
  }

  for (const t of textos) {
    if (afirmaCausa(t)) {
      return { ok: false, motivo: "afirma una causa como hecho, y los datos solo muestran qué cambió" };
    }
    if (RE_IDS_INTERNOS.test(t)) return { ok: false, motivo: "menciona identificadores internos" };
    if (RE_TECNICO.test(t)) return { ok: false, motivo: "incluye datos técnicos que no van en una respuesta" };
    for (const n of numerosDe(t)) {
      if (!permitidos.has(clave(n))) {
        return { ok: false, motivo: `menciona un número (${n}) que no sale de la evidencia calculada` };
      }
    }
    // ── Red secundaria: la prosa. Si la dirección no se puede verificar, no se publica ──
    const prosa = verificarProsa(t, sujetos);
    if (!prosa.ok) return { ok: false, motivo: prosa.motivo };
  }

  const texto = [`**${conclusion}**`, ...textos.slice(1).map((t) => `- ${t}`)].join("\n");
  return { ok: true, texto, evidenciasCitadas: [...new Set(citadas)] };
}

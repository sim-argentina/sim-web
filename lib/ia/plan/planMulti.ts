// IA SIM · Bloque 5C — Contrato y VALIDACIÓN del plan multiherramienta. Puro (sin DB).
//
// El modelo traduce una pregunta de varios pasos a un plan CERRADO. El servidor lo valida contra
// el catálogo de capacidades y los schemas REALES de cada herramienta, y lo RECONSTRUYE desde
// cero: lo que venga de más se descarta. Nada de SQL, tablas, columnas, fórmulas ni texto
// ejecutable; las dependencias son referencias TIPADAS a pasos anteriores, nunca interpolación
// de resultados dentro de un argumento.

import {
  CAPACIDADES, CAPACIDADES_IDS, FUERA_DEL_PLANIFICADOR, capacidadDe, type AccesoSchemas,
} from "@/lib/ia/plan/capacidades";
import { CALCULOS_PLAN_IDS, type CalculoPlan } from "@/lib/ia/plan/compatibilidad";

// ── Límites ─────────────────────────────────────────────────────────────────────
export const MAX_PASOS = 6;
export const MAX_PROFUNDIDAD = 3;
export const MAX_CALCULOS = 8;
export const MAX_LARGO_OBJETIVO = 200;
export const TIMEOUT_PLAN_MS = 45_000;
export const MAX_REPARACIONES = 1;

export const PRESENTACIONES = ["comparacion_multidominio", "descomposicion_variacion", "serie_simple", "diagnostico"] as const;
export type Presentacion = (typeof PRESENTACIONES)[number];

export type ReferenciaEvidencia = { paso: string; metrica: string };

export type PasoPlan = {
  id: string;
  herramienta: string;
  argumentos: Record<string, unknown>;
  dependeDe: string[];
};

export type CalculoPlanificado = {
  tipo: CalculoPlan;
  base: ReferenciaEvidencia;
  comparado: ReferenciaEvidencia;
};

export type PlanMulti = {
  objetivo: string;
  pasos: PasoPlan[];
  calculos: CalculoPlanificado[];
  presentacion: Presentacion;
  /** Pasos que se descartaron por pedir exactamente lo mismo que otro, con a quién apuntan. */
  deduplicados: Array<{ descartado: string; reutiliza: string }>;
};

export type PlanInvalido = { ok: false; error: string; campo?: string; aclaracion?: boolean };
export type PlanValidoMulti = { ok: true; plan: PlanMulti };

const RE_ID_PASO = /^p[1-9][0-9]?$/;
// Cualquier cosa que huela a SQL, a nombre de tabla o a código no entra ni en el objetivo ni en
// un argumento de texto.
const RE_PELIGROSO = /\b(select|insert|update|delete|drop|truncate|alter|union|from|where|join|exec|script)\b|--|;|\$\{|<\?|<script/i;

const esInvalido = (x: unknown): x is PlanInvalido => typeof x === "object" && x !== null && (x as PlanInvalido).ok === false;

/** Texto plano, corto y sin nada ejecutable. */
function textoSeguro(valor: unknown, campo: string, max: number): string | PlanInvalido {
  const s = String(valor ?? "").trim();
  if (!s) return { ok: false, error: `Falta ${campo}.`, campo };
  if (s.length > max) return { ok: false, error: `${campo} es demasiado largo (máximo ${max} caracteres).`, campo };
  if (RE_PELIGROSO.test(s)) return { ok: false, error: `${campo} contiene algo que no puede ir en un plan (SQL, código o nombres de tablas).`, campo };
  return s;
}

/**
 * Valida los argumentos de un paso contra el schema REAL de su herramienta: solo las claves que
 * esa herramienta declara, todas las requeridas, y ningún valor con pinta de SQL o de código.
 * No se valida el TIPO en detalle: de eso se encarga la propia herramienta cuando ejecuta, que
 * es la única que conoce su contrato completo.
 */
function validarArgumentos(herramienta: string, crudo: unknown, campo: string, acceso: AccesoSchemas): Record<string, unknown> | PlanInvalido {
  if (crudo != null && (typeof crudo !== "object" || Array.isArray(crudo))) {
    return { ok: false, error: `Los argumentos de ${herramienta} tienen que ser un objeto.`, campo };
  }
  const args = (crudo ?? {}) as Record<string, unknown>;
  const permitidos = acceso.permitidos(herramienta);
  const requeridos = acceso.requeridos(herramienta);

  const limpio: Record<string, unknown> = {};
  for (const clave of Object.keys(args)) {
    if (!permitidos.includes(clave)) {
      return {
        ok: false,
        error: `"${clave}" no es un argumento de ${herramienta}. Admite: ${permitidos.join(", ") || "(ninguno)"}.`,
        campo,
      };
    }
    limpio[clave] = args[clave];
  }
  for (const req of requeridos) {
    if (limpio[req] === undefined) {
      return { ok: false, error: `${herramienta} necesita "${req}".`, campo };
    }
  }
  // Ningún valor de texto, en ningún nivel, puede traer SQL ni código.
  const revisar = (v: unknown, ruta: string): PlanInvalido | null => {
    if (typeof v === "string") {
      return RE_PELIGROSO.test(v) ? { ok: false, error: `El argumento ${ruta} contiene algo que no puede ir en un plan.`, campo } : null;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) { const r = revisar(v[i], `${ruta}[${i}]`); if (r) return r; }
      return null;
    }
    if (v && typeof v === "object") {
      for (const [k, sub] of Object.entries(v as Record<string, unknown>)) {
        if (RE_PELIGROSO.test(k)) return { ok: false, error: `El argumento ${ruta}.${k} no está permitido.`, campo };
        const r = revisar(sub, `${ruta}.${k}`); if (r) return r;
      }
      return null;
    }
    return null;
  };
  for (const [k, v] of Object.entries(limpio)) {
    const r = revisar(v, k);
    if (r) return r;
  }
  return limpio;
}

/** Referencia tipada a la evidencia de un paso: nada de interpolar texto. */
function validarReferencia(crudo: unknown, idsValidos: string[], campo: string): ReferenciaEvidencia | PlanInvalido {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
    return { ok: false, error: `${campo} tiene que ser una referencia {"paso":"p1","metrica":"…"}.`, campo };
  }
  const r = crudo as Record<string, unknown>;
  const paso = String(r.paso ?? "").trim();
  const metrica = String(r.metrica ?? "").trim();
  if (!idsValidos.includes(paso)) {
    return { ok: false, error: `${campo} apunta a "${paso}", que no es un paso del plan.`, campo };
  }
  if (!metrica || !/^[a-z][a-z0-9_]{1,40}$/.test(metrica)) {
    return { ok: false, error: `${campo} tiene que nombrar una métrica del paso.`, campo };
  }
  return { paso, metrica };
}

/** Clave de equivalencia de un paso: misma herramienta y mismos argumentos = mismo pedido. */
function clavePaso(p: { herramienta: string; argumentos: Record<string, unknown> }): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, sub]) => [k, ordenar(sub)]));
    }
    return v;
  };
  return `${p.herramienta}|${JSON.stringify(ordenar(p.argumentos))}`;
}

/** Profundidad de la cadena de dependencias de un paso. */
function profundidad(id: string, porId: Map<string, PasoPlan>, visitados = new Set<string>()): number {
  if (visitados.has(id)) return Infinity; // ciclo
  const paso = porId.get(id);
  if (!paso || paso.dependeDe.length === 0) return 1;
  visitados.add(id);
  const hijos = paso.dependeDe.map((d) => profundidad(d, porId, new Set(visitados)));
  return 1 + Math.max(...hijos);
}

// ── Validación completa ─────────────────────────────────────────────────────────
export function validarPlanMulti(input: Record<string, unknown>, acceso: AccesoSchemas): PlanValidoMulti | PlanInvalido {
  const objetivo = textoSeguro(input.objetivo, "el objetivo del plan", MAX_LARGO_OBJETIVO);
  if (esInvalido(objetivo)) return objetivo;

  const crudoPasos = input.pasos;
  if (!Array.isArray(crudoPasos) || crudoPasos.length === 0) {
    return { ok: false, error: "El plan necesita al menos un paso.", campo: "pasos" };
  }
  if (crudoPasos.length > MAX_PASOS) {
    return { ok: false, error: `El plan tiene ${crudoPasos.length} pasos y el máximo es ${MAX_PASOS}. Acotá la pregunta o pedila en dos partes.`, campo: "pasos" };
  }

  // Primera pasada: ids, herramientas y argumentos.
  const pasos: PasoPlan[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < crudoPasos.length; i++) {
    const crudo = (crudoPasos[i] ?? {}) as Record<string, unknown>;
    const id = String(crudo.id ?? "").trim();
    if (!RE_ID_PASO.test(id)) {
      return { ok: false, error: `El paso ${i + 1} necesita un id con la forma "p1", "p2", …`, campo: `pasos[${i}].id` };
    }
    if (vistos.has(id)) {
      return { ok: false, error: `El id "${id}" está repetido: cada paso necesita uno propio.`, campo: `pasos[${i}].id` };
    }
    vistos.add(id);

    const herramienta = String(crudo.herramienta ?? "").trim();
    if (!capacidadDe(herramienta)) {
      const motivo = FUERA_DEL_PLANIFICADOR[herramienta];
      if (motivo) {
        return { ok: false, error: `"${herramienta}" no participa de un plan multiherramienta: ${motivo}`, campo: `pasos[${i}].herramienta` };
      }
      return { ok: false, error: `"${herramienta}" no es una herramienta disponible para un plan. Disponibles: ${CAPACIDADES_IDS.join(", ")}.`, campo: `pasos[${i}].herramienta` };
    }

    const argumentos = validarArgumentos(herramienta, crudo.argumentos, `pasos[${i}].argumentos`, acceso);
    if (esInvalido(argumentos)) return argumentos;

    const dependeCrudo = crudo.dependeDe ?? crudo.depende_de ?? [];
    if (!Array.isArray(dependeCrudo)) {
      return { ok: false, error: `Las dependencias del paso ${id} tienen que ser una lista de ids.`, campo: `pasos[${i}].dependeDe` };
    }
    const dependeDe = dependeCrudo.map((d) => String(d).trim());
    for (const d of dependeDe) {
      if (!vistos.has(d) || d === id) {
        // Solo pasos ANTERIORES: así no hay referencias al futuro ni ciclos por construcción.
        return {
          ok: false,
          error: d === id
            ? `El paso ${id} no puede depender de sí mismo.`
            : `El paso ${id} depende de "${d}", que no es un paso anterior. Las dependencias solo pueden apuntar hacia atrás.`,
          campo: `pasos[${i}].dependeDe`,
        };
      }
    }

    pasos.push({ id, herramienta, argumentos: argumentos as Record<string, unknown>, dependeDe: [...new Set(dependeDe)] });
  }

  // Profundidad y ciclos (el orden ya los evita, pero se verifica igual).
  const porId = new Map(pasos.map((p) => [p.id, p]));
  for (const p of pasos) {
    const prof = profundidad(p.id, porId);
    if (!Number.isFinite(prof)) {
      return { ok: false, error: `Las dependencias del paso ${p.id} forman un ciclo.`, campo: "pasos" };
    }
    if (prof > MAX_PROFUNDIDAD) {
      return { ok: false, error: `El paso ${p.id} queda a ${prof} niveles de dependencia y el máximo es ${MAX_PROFUNDIDAD}.`, campo: "pasos" };
    }
  }

  // Incompatibilidades declaradas entre capacidades.
  const usadas = pasos.map((p) => p.herramienta);
  for (const p of pasos) {
    for (const malaCompania of CAPACIDADES[p.herramienta].incompatibleCon) {
      if (usadas.includes(malaCompania)) {
        return {
          ok: false,
          error: `${p.herramienta} y ${malaCompania} no se combinan en el mismo plan: una estima y la otra informa un cierre, y ponerlas lado a lado haría pasar una proyección por un hecho.`,
          campo: "pasos",
        };
      }
    }
  }

  // Deduplicación: dos pasos que piden exactamente lo mismo se ejecutan una sola vez.
  const porClave = new Map<string, string>();
  const deduplicados: Array<{ descartado: string; reutiliza: string }> = [];
  const remapeo = new Map<string, string>();
  const pasosFinales: PasoPlan[] = [];
  for (const p of pasos) {
    const clave = clavePaso(p);
    const yaEsta = porClave.get(clave);
    if (yaEsta) {
      deduplicados.push({ descartado: p.id, reutiliza: yaEsta });
      remapeo.set(p.id, yaEsta);
      continue;
    }
    porClave.set(clave, p.id);
    pasosFinales.push(p);
  }
  // Las dependencias que apuntaban a un paso descartado pasan a apuntar al que se conserva.
  for (const p of pasosFinales) {
    p.dependeDe = [...new Set(p.dependeDe.map((d) => remapeo.get(d) ?? d))].filter((d) => d !== p.id);
  }

  // Cálculos: referencias tipadas a pasos que existen, del tipo permitido.
  const idsFinales = pasosFinales.map((p) => p.id);
  const crudoCalculos = input.calculos ?? [];
  if (!Array.isArray(crudoCalculos)) {
    return { ok: false, error: "Los cálculos tienen que ser una lista.", campo: "calculos" };
  }
  if (crudoCalculos.length > MAX_CALCULOS) {
    return { ok: false, error: `Demasiados cálculos (${crudoCalculos.length}). El máximo es ${MAX_CALCULOS}.`, campo: "calculos" };
  }
  const calculos: CalculoPlanificado[] = [];
  for (let i = 0; i < crudoCalculos.length; i++) {
    const c = (crudoCalculos[i] ?? {}) as Record<string, unknown>;
    const tipo = String(c.tipo ?? "").trim();
    if (!CALCULOS_PLAN_IDS.includes(tipo as CalculoPlan)) {
      return { ok: false, error: `Cálculo no permitido: "${tipo}". Permitidos: ${CALCULOS_PLAN_IDS.join(", ")}.`, campo: `calculos[${i}].tipo` };
    }
    const base = validarReferencia(remapearRef(c.base, remapeo), idsFinales, `calculos[${i}].base`);
    if (esInvalido(base)) return base;
    const comparado = validarReferencia(remapearRef(c.comparado, remapeo), idsFinales, `calculos[${i}].comparado`);
    if (esInvalido(comparado)) return comparado;
    if (base.paso === comparado.paso && base.metrica === comparado.metrica) {
      return { ok: false, error: `El cálculo ${i + 1} compara un valor contra sí mismo.`, campo: `calculos[${i}]` };
    }
    if (base.metrica !== comparado.metrica) {
      return {
        ok: false,
        error: `El cálculo ${i + 1} intenta comparar "${base.metrica}" contra "${comparado.metrica}". Una diferencia o una variación se calculan sobre la MISMA métrica en dos períodos; entre métricas distintas solo se puede mirar si se movieron para el mismo lado.`,
        campo: `calculos[${i}]`,
      };
    }
    calculos.push({ tipo: tipo as CalculoPlan, base, comparado });
  }

  const presentacionRaw = String(input.presentacion && typeof input.presentacion === "object"
    ? (input.presentacion as Record<string, unknown>).tipo ?? ""
    : input.presentacion ?? "").trim() || "comparacion_multidominio";
  if (!PRESENTACIONES.includes(presentacionRaw as Presentacion)) {
    return { ok: false, error: `Presentación no permitida: "${presentacionRaw}". Permitidas: ${PRESENTACIONES.join(", ")}.`, campo: "presentacion" };
  }

  return {
    ok: true,
    plan: {
      objetivo: objetivo as string,
      pasos: pasosFinales,
      calculos,
      presentacion: presentacionRaw as Presentacion,
      deduplicados,
    },
  };
}

function remapearRef(crudo: unknown, remapeo: Map<string, string>): unknown {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return crudo;
  const r = { ...(crudo as Record<string, unknown>) };
  const paso = String(r.paso ?? "");
  if (remapeo.has(paso)) r.paso = remapeo.get(paso);
  return r;
}

/** Los pasos agrupados en tandas: todo lo de una tanda se puede ejecutar en paralelo. */
export function tandas(plan: PlanMulti): PasoPlan[][] {
  const pendientes = [...plan.pasos];
  const listos = new Set<string>();
  const out: PasoPlan[][] = [];
  while (pendientes.length > 0) {
    const tanda = pendientes.filter((p) => p.dependeDe.every((d) => listos.has(d)));
    if (tanda.length === 0) break; // no debería pasar: la validación ya descartó ciclos
    out.push(tanda);
    for (const p of tanda) {
      listos.add(p.id);
      pendientes.splice(pendientes.indexOf(p), 1);
    }
  }
  return out;
}

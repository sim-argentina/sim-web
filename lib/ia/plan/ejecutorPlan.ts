// IA SIM · Bloque 5C — EJECUTOR del plan multiherramienta. Solo lectura.
//
// Ejecuta los pasos ya validados: las tandas sin dependencias van en paralelo, las dependientes
// en orden, con timeout global. Cada paso aporta EVIDENCIAS con identificador estable, y los
// cálculos (diferencia, variación, delta por fuente) los hace el SERVIDOR sobre esas evidencias
// — nunca el modelo.
//
// Si una herramienta falla, no se tira el análisis: se publica lo comprobado y se declara con
// nombre y apellido qué no se pudo verificar. Nunca se completa el hueco con una suposición ni
// se sale a internet.

import { CAPACIDADES, UNIVERSOS_PLAN, type UniversoPlan } from "@/lib/ia/plan/capacidades";
import { tandas, TIMEOUT_PLAN_MS, type PlanMulti, type PasoPlan, type CalculoPlanificado } from "@/lib/ia/plan/planMulti";
import { leerDemandaDisponibilidad, magnitud, type LecturaDemanda } from "@/lib/ia/plan/compatibilidad";

export type Evidencia = {
  evidenciaId: string;
  paso: string;
  herramienta: string;
  dominio: string;
  universo: UniversoPlan;
  metrica: string;
  etiqueta: string;
  periodo: string;
  valor: number;
  unidad: string;
  valorFormateado: string;
  criterio: string;
  fuenteInterna: string;
};

export type DesgloseFuente = { paso: string; periodo: string; fuente: string; etiqueta: string; valor: number };

export type ResultadoPaso = {
  id: string;
  herramienta: string;
  ok: boolean;
  motivo?: string;
  periodo?: string;
  reutilizadoDe?: string;
};

export type ComparacionCalculada = {
  calculoId: string;
  tipo: string;
  metrica: string;
  etiqueta: string;
  unidad: string;
  universo: UniversoPlan;
  base: { evidenciaId: string; periodo: string; valor: number };
  comparado: { evidenciaId: string; periodo: string; valor: number };
  diferencia: number;
  variacionPct: number | null;
  motivoNoCalculable?: string;
  /** Deltas por fuente, cuando el cálculo lo pidió y los dos pasos los traen. */
  porFuente: Array<{ fuente: string; etiqueta: string; base: number; comparado: number; delta: number }> | null;
  /** Hubo fuentes que empujaron para lados opuestos. */
  huboCompensacion: boolean;
};

export type ResultadoPlan = {
  ok: true;
  objetivo: string;
  presentacion: string;
  pasos: ResultadoPaso[];
  evidencias: Evidencia[];
  comparaciones: ComparacionCalculada[];
  lectura: LecturaDemanda | null;
  /** Herramientas que fallaron, para declararlo sin inventar el hueco. */
  faltantes: Array<{ paso: string; herramienta: string; motivo: string }>;
  advertencias: string[];
  duracionMs: number;
};

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "a, b y c" — para que una lista de tres no quede con dos "y" pegadas. */
function enumerar(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

function formatear(valor: number, unidad: string): string {
  const nAR = (n: number, dec: number) => n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (!Number.isFinite(valor)) return "—";
  switch (unidad) {
    case "ars": return `${valor < 0 ? "-" : ""}$${nAR(Math.abs(valor), Number.isInteger(valor) ? 0 : 2)}`;
    case "minutos": return `${nAR(Math.round(valor), 0)} min`;
    case "horas": return `${nAR(valor, Number.isInteger(valor) ? 0 : 2)} h`;
    case "porcentaje": return `${valor < 0 ? "-" : ""}${nAR(Math.abs(valor), 1)}%`;
    default: return nAR(valor, Number.isInteger(valor) ? 0 : 1);
  }
}

/** El universo real de un paso: para la analítica lo decide la métrica pedida. */
function universoDePaso(paso: PasoPlan): UniversoPlan {
  const cap = CAPACIDADES[paso.herramienta];
  if (paso.herramienta !== "consulta_analitica_interna") return cap.universo;
  const metricas = (paso.argumentos.metricas ?? paso.argumentos.metrica) as unknown;
  const lista = (Array.isArray(metricas) ? metricas : [metricas]).map((m) => String(m));
  return lista.some((m) => m.startsWith("turnos") || m === "personas" || m === "operaciones" || m === "minutos_actividad") ? "actividad" : "facturacion";
}

type BloqueEvidencia = {
  periodo?: string;
  metricas?: Array<{ metrica: string; valor: number; unidad: string; etiqueta: string }>;
  porFuente?: Array<{ fuente: string; etiqueta: string; valor: number }>;
};

/** Lee el bloque `evidencia` que cada capacidad del planificador publica en su resumen. */
function bloqueDe(resumen: unknown): BloqueEvidencia | null {
  if (!resumen || typeof resumen !== "object") return null;
  const e = (resumen as Record<string, unknown>).evidencia;
  return e && typeof e === "object" ? (e as BloqueEvidencia) : null;
}

export async function ejecutarPlanMulti(plan: PlanMulti): Promise<ResultadoPlan> {
  const inicio = Date.now();
  // Import diferido: lib/ia/tools.ts importa el planificador, así que pedirle el registro en el
  // nivel superior armaría un ciclo. Acá ya está inicializado.
  const { HERRAMIENTAS } = await import("@/lib/ia/tools");
  const advertencias: string[] = [];
  const pasos: ResultadoPaso[] = [];
  const evidencias: Evidencia[] = [];
  const porFuentePorPaso = new Map<string, DesgloseFuente[]>();
  const faltantes: Array<{ paso: string; herramienta: string; motivo: string }> = [];

  for (const d of plan.deduplicados) {
    pasos.push({ id: d.descartado, herramienta: "", ok: true, reutilizadoDe: d.reutiliza });
    advertencias.push(`El paso ${d.descartado} pedía exactamente lo mismo que ${d.reutiliza}: se ejecutó una sola vez.`);
  }

  const vencido = () => Date.now() - inicio > TIMEOUT_PLAN_MS;

  for (const tanda of tandas(plan)) {
    if (vencido()) {
      for (const p of tanda) {
        pasos.push({ id: p.id, herramienta: p.herramienta, ok: false, motivo: "no se alcanzó a ejecutar dentro del tiempo del plan" });
        faltantes.push({ paso: p.id, herramienta: p.herramienta, motivo: "el plan superó el tiempo máximo" });
      }
      continue;
    }
    // Los pasos de una misma tanda no dependen entre sí: van en paralelo.
    const resultados = await Promise.all(
      tanda.map(async (p) => {
        try {
          const salida = await HERRAMIENTAS[p.herramienta].ejecutar(p.argumentos);
          return { paso: p, salida, error: null as string | null };
        } catch (e) {
          return { paso: p, salida: null, error: e instanceof Error ? e.message : "la herramienta falló" };
        }
      }),
    );

    for (const { paso, salida, error } of resultados) {
      const cap = CAPACIDADES[paso.herramienta];
      if (error || !salida) {
        pasos.push({ id: paso.id, herramienta: paso.herramienta, ok: false, motivo: error ?? "sin resultado" });
        faltantes.push({ paso: paso.id, herramienta: paso.herramienta, motivo: `${cap.dominio}: no se pudo leer` });
        continue;
      }
      const resumen = salida.resumen as Record<string, unknown> | null;
      // Una herramienta puede devolver un rechazo estructurado (plan interno inválido, por ej.).
      if (resumen && resumen.ok === false) {
        const motivo = String(resumen.motivo ?? "el pedido no era válido");
        pasos.push({ id: paso.id, herramienta: paso.herramienta, ok: false, motivo });
        faltantes.push({ paso: paso.id, herramienta: paso.herramienta, motivo });
        continue;
      }

      const bloque = bloqueDe(resumen);
      const periodo = String(bloque?.periodo ?? (salida.fuente as Record<string, unknown> | undefined)?.periodo ?? "");
      pasos.push({ id: paso.id, herramienta: paso.herramienta, ok: true, periodo });

      if (!bloque?.metricas?.length) {
        // Capacidad de diagnóstico: aporta contexto, no cifras comparables.
        continue;
      }
      const universo = universoDePaso(paso);
      for (const m of bloque.metricas) {
        evidencias.push({
          evidenciaId: `${paso.id}.${m.metrica}`,
          paso: paso.id,
          herramienta: paso.herramienta,
          dominio: cap.dominio,
          universo,
          metrica: m.metrica,
          etiqueta: m.etiqueta,
          periodo,
          valor: redondear(Number(m.valor) || 0),
          unidad: m.unidad,
          valorFormateado: formatear(Number(m.valor) || 0, m.unidad),
          criterio: UNIVERSOS_PLAN[universo].regla,
          fuenteInterna: cap.dominio,
        });
      }
      if (bloque.porFuente?.length) {
        porFuentePorPaso.set(paso.id, bloque.porFuente.map((f) => ({ paso: paso.id, periodo, fuente: f.fuente, etiqueta: f.etiqueta, valor: redondear(Number(f.valor) || 0) })));
      }
    }
  }

  // ── Cálculos, SIEMPRE del lado del servidor ───────────────────────────────────
  const comparaciones: ComparacionCalculada[] = [];
  const buscar = (ref: { paso: string; metrica: string }) => evidencias.find((e) => e.paso === ref.paso && e.metrica === ref.metrica);

  plan.calculos.forEach((c: CalculoPlanificado, i) => {
    const eBase = buscar(c.base);
    const eComp = buscar(c.comparado);
    if (!eBase || !eComp) {
      const cual = !eBase ? c.base : c.comparado;
      advertencias.push(`No se pudo calcular ${c.tipo} de ${cual.metrica}: falta el resultado del paso ${cual.paso}.`);
      return;
    }
    if (eBase.universo !== eComp.universo) {
      advertencias.push(`No se comparó ${eBase.etiqueta} contra ${eComp.etiqueta}: pertenecen a universos distintos y no se restan entre sí.`);
      return;
    }
    // Base = el período cronológicamente más antiguo, pase lo que pase en el plan.
    const [base, comparado] = eBase.periodo <= eComp.periodo ? [eBase, eComp] : [eComp, eBase];
    const diferencia = redondear(comparado.valor - base.valor);
    const variacionPct = base.valor === 0 ? null : redondear((diferencia / Math.abs(base.valor)) * 100);

    let porFuente: ComparacionCalculada["porFuente"] = null;
    let huboCompensacion = false;
    if (c.tipo === "delta_por_fuente") {
      const fBase = porFuentePorPaso.get(base.paso) ?? [];
      const fComp = porFuentePorPaso.get(comparado.paso) ?? [];
      if (fBase.length === 0 && fComp.length === 0) {
        advertencias.push(`El desglose por fuente de ${base.etiqueta} no está disponible: los pasos no lo pidieron.`);
      } else {
        const claves = [...new Set([...fBase.map((f) => f.fuente), ...fComp.map((f) => f.fuente)])];
        porFuente = claves
          .map((fuente) => {
            const b = fBase.find((f) => f.fuente === fuente)?.valor ?? 0;
            const c2 = fComp.find((f) => f.fuente === fuente)?.valor ?? 0;
            const etiqueta = fComp.find((f) => f.fuente === fuente)?.etiqueta ?? fBase.find((f) => f.fuente === fuente)?.etiqueta ?? fuente;
            return { fuente, etiqueta, base: b, comparado: c2, delta: redondear(c2 - b) };
          })
          // Por impacto ABSOLUTO: lo que más movió la aguja primero, sin importar el signo.
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.fuente.localeCompare(b.fuente));
        huboCompensacion = porFuente.some((f) => f.delta > 0) && porFuente.some((f) => f.delta < 0);
      }
    }

    comparaciones.push({
      calculoId: `c${i + 1}`,
      tipo: c.tipo,
      metrica: base.metrica,
      etiqueta: base.etiqueta,
      unidad: base.unidad,
      universo: base.universo,
      base: { evidenciaId: base.evidenciaId, periodo: base.periodo, valor: base.valor },
      comparado: { evidenciaId: comparado.evidenciaId, periodo: comparado.periodo, valor: comparado.valor },
      diferencia,
      variacionPct,
      motivoNoCalculable: variacionPct == null ? "la base es cero: la variación porcentual no es calculable" : undefined,
      porFuente,
      huboCompensacion,
    });
  });

  // ── Lectura demanda / disponibilidad, con la regla escrita ────────────────────
  const varDe = (metricas: string[]) => {
    const c = comparaciones.find((x) => metricas.includes(x.metrica));
    return c ? c.variacionPct : null;
  };
  const actividadPct = varDe(["turnos", "personas", "minutos_actividad", "operaciones"]);
  const disponibilidadPct = varDe(["horas_programadas"]);
  const lectura = actividadPct != null || disponibilidadPct != null ? leerDemandaDisponibilidad(actividadPct, disponibilidadPct) : null;

  // Aviso cuando se ponen lado a lado métricas con reglas de fecha distintas.
  const universosUsados = [...new Set(evidencias.map((e) => e.universo))];
  if (universosUsados.length > 1) {
    advertencias.push(
      `Este análisis mira ${enumerar(universosUsados.map((u) => UNIVERSOS_PLAN[u].etiqueta.toLowerCase()))} a la vez. Cada uno se imputa con su propia fecha, así que se comparan lado a lado pero no se dividen ni se restan entre sí.`,
    );
  }
  // Un cambio de facturación dominado por ingresos manuales no es demanda del Turnero.
  const deltaManual = comparaciones.find((c) => c.porFuente)?.porFuente?.find((f) => f.fuente === "manuales");
  const compFact = comparaciones.find((c) => c.metrica === "facturacion_bruta");
  if (deltaManual && compFact && compFact.diferencia !== 0 && Math.abs(deltaManual.delta) / Math.abs(compFact.diferencia) >= 0.5) {
    advertencias.push(
      "La mayor parte del cambio de facturación son ingresos manuales, que no pasan por el mostrador: no sirven para medir la demanda del Turnero.",
    );
  }
  if (magnitud(actividadPct) === "no_calculable" && disponibilidadPct != null) {
    advertencias.push("No hay una medición de actividad comparable, así que no se puede separar demanda de disponibilidad.");
  }

  return {
    ok: true,
    objetivo: plan.objetivo,
    presentacion: plan.presentacion,
    pasos,
    evidencias,
    comparaciones,
    lectura,
    faltantes,
    advertencias,
    duracionMs: Date.now() - inicio,
  };
}

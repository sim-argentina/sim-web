// Motor PURO de torneos eliminatorios (brackets). Sin dependencias de servidor:
// reglas deterministas y testeables. Principio: CAMPEONATOS DEFINE LAS REGLAS,
// BRACKET LAS EJECUTA. Nada acá depende del nombre de un campeonato.
//
// El motor trabaja solo con: configuración (modalidad eliminación) + participantes
// + resultados. Toda la lógica de estructura (seeding, distribución, emparejamiento,
// final, podio) vive acá y se testea en lib/bracketEngine.test.ts.

// ── Configuración leída del campeonato ────────────────────────────────────────

export type ConfigEliminacion = {
  clasificacion: { habilitada: boolean; vueltas: number; criterio: string };
  eliminatoria: {
    pilotosPorCarrera: number;
    avanzanPorCarrera: number;
    vueltas: number;
    finalPilotos: number;
  };
};

function num(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// Normaliza config.clasificacion y config.eliminatoria tolerando variantes de
// nombre (avanzan | avanzan_por_carrera, etc.) y aplicando defaults seguros.
// NO asume valores globales: cada campeonato trae los suyos.
export function configEliminacion(campeonato: {
  config?: Record<string, unknown> | null;
}): ConfigEliminacion {
  const cfg = (campeonato.config ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const cl = cfg.clasificacion ?? {};
  const el = cfg.eliminatoria ?? {};
  return {
    clasificacion: {
      habilitada: cl.habilitada !== false, // default true; false = seeding manual
      vueltas: Math.max(1, Math.floor(num(cl.vueltas, 3))),
      criterio: typeof cl.criterio === "string" ? cl.criterio : "mejor_vuelta",
    },
    eliminatoria: {
      pilotosPorCarrera: Math.floor(num(el.pilotos_por_carrera ?? el.pilotosPorCarrera, 4)),
      avanzanPorCarrera: Math.floor(num(el.avanzan_por_carrera ?? el.avanzan ?? el.avanzanPorCarrera, 2)),
      vueltas: Math.max(1, Math.floor(num(el.vueltas, 5))),
      finalPilotos: Math.floor(num(el.final_pilotos ?? el.finalPilotos, 4)),
    },
  };
}

export type ValidacionConfig = { ok: true } | { ok: false; error: string };

// Valida MATEMÁTICAMENTE que la config permita construir un torneo coherente.
// Si no, el bracket no se genera (se explica el parámetro en conflicto).
export function validarConfigEliminacion(cfg: ConfigEliminacion): ValidacionConfig {
  const { pilotosPorCarrera: K, avanzanPorCarrera: A, vueltas: V, finalPilotos: F } = cfg.eliminatoria;
  if (!Number.isFinite(K) || K < 2) return { ok: false, error: "pilotos_por_carrera debe ser ≥ 2." };
  if (!Number.isFinite(A) || A < 1) return { ok: false, error: "avanzan_por_carrera debe ser ≥ 1." };
  if (A >= K) return { ok: false, error: "avanzan_por_carrera debe ser menor que pilotos_por_carrera." };
  if (!Number.isFinite(V) || V < 1) return { ok: false, error: "vueltas por carrera debe ser > 0." };
  if (!Number.isFinite(F) || F < 2) return { ok: false, error: "final_pilotos debe ser ≥ 2." };
  if (F > K) return { ok: false, error: "final_pilotos no puede superar pilotos_por_carrera (la final es una sola carrera)." };
  if (cfg.clasificacion.vueltas < 1) return { ok: false, error: "vueltas de clasificación debe ser ≥ 1." };
  return { ok: true };
}

// ── Clasificación / qualifying ────────────────────────────────────────────────

// La clasificación opera con UN ÚNICO mejor tiempo por piloto (no vueltas
// individuales). Las "vueltas" configuradas del campeonato son solo reglamento
// (cuántos intentos tiene el piloto); el operador carga únicamente el mejor tiempo.
export type ParticipanteQuali = {
  inscripcion_id: string;
  presente: boolean;
  incluido: boolean; // decisión admin para "sin tiempo": incluir al final o excluir
  mejor_ms: number | null; // único mejor tiempo (ms); null = sin tiempo
  orden_inscripcion: number; // desempate determinista
};

export type ParticipanteSeed = {
  inscripcion_id: string;
  seed: number;
  mejor_ms: number | null;
};

// Calcula el seeding a partir de la clasificación. Reglas:
// - ausentes (presente=false) → excluidos.
// - presentes con mejor tiempo → ordenados por mejor_ms ascendente
//   (desempate: orden de inscripción, determinista).
// - presentes SIN tiempo → sólo si incluido=true, van al final por orden de
//   inscripción (§9). Si incluido=false → excluidos.
// El seed queda 1..N y debe CONGELARSE (no recalcular tras generar el bracket).
export function calcularSeeds(participantes: ParticipanteQuali[]): ParticipanteSeed[] {
  const presentes = participantes.filter((p) => p.presente);
  const conTiempo = presentes.filter((p) => p.mejor_ms != null);
  const sinTiempo = presentes.filter((p) => p.mejor_ms == null && p.incluido);

  conTiempo.sort((a, b) => (a.mejor_ms as number) - (b.mejor_ms as number) || a.orden_inscripcion - b.orden_inscripcion);
  sinTiempo.sort((a, b) => a.orden_inscripcion - b.orden_inscripcion);

  return [...conTiempo, ...sinTiempo].map((p, i) => ({
    inscripcion_id: p.inscripcion_id,
    seed: i + 1,
    mejor_ms: p.mejor_ms,
  }));
}

// ── Distribución serpentina (balanceada por seed) ─────────────────────────────

// Reparte `items` (ya ordenados por seed) en `numCarreras` grupos con patrón
// serpentina/snake: columnas alternadas de ida y vuelta. Con 32 seeds y 8 carreras
// produce 1/16/17/32, 2/15/18/31, … (equilibrado: evita juntar a los mejores).
export function serpentina<T>(items: T[], numCarreras: number): T[][] {
  const C = Math.max(1, numCarreras);
  const carreras: T[][] = Array.from({ length: C }, () => []);
  items.forEach((item, i) => {
    const col = Math.floor(i / C);
    const pos = i % C;
    const idx = col % 2 === 0 ? pos : C - 1 - pos;
    carreras[idx].push(item);
  });
  return carreras;
}

export function numCarreras(nParticipantes: number, pilotosPorCarrera: number): number {
  return Math.ceil(nParticipantes / Math.max(1, pilotosPorCarrera));
}

// Distribuye clasificados en C carreras evitando rematches (dos con el mismo
// origen en la misma carrera) de forma DETERMINISTA y balanceada: cada uno va a la
// carrera menos llena que aún no contiene su origen y no supera `maxPorCarrera`.
// Si es imposible sin rematch (más copias de un origen que carreras), coloca en la
// menos llena — mejor esfuerzo. Recorriendo primero ganadores separa 1.º y 2.º.
export function distribuirClasificados(
  items: Clasificado[],
  cantCarreras: number,
  maxPorCarrera: number,
): Clasificado[][] {
  const C = Math.max(1, cantCarreras);
  const grupos: Clasificado[][] = Array.from({ length: C }, () => []);
  const origenes: Array<Set<string>> = Array.from({ length: C }, () => new Set());
  const maxSize = Math.max(maxPorCarrera, Math.ceil(items.length / C));

  const elegir = (item: Clasificado): number => {
    let best = -1;
    for (let g = 0; g < C; g++) {
      if (grupos[g].length >= maxSize) continue;
      if (origenes[g].has(item.origen_carrera_id)) continue;
      if (best === -1 || grupos[g].length < grupos[best].length) best = g;
    }
    if (best !== -1) return best;
    // No hay carrera libre de su origen: elegir la menos llena bajo el máximo.
    for (let g = 0; g < C; g++) {
      if (grupos[g].length >= maxSize) continue;
      if (best === -1 || grupos[g].length < grupos[best].length) best = g;
    }
    if (best !== -1) return best;
    // Último recurso: la menos llena en absoluto.
    best = 0;
    for (let g = 1; g < C; g++) if (grupos[g].length < grupos[best].length) best = g;
    return best;
  };

  for (const item of items) {
    const g = elegir(item);
    grupos[g].push(item);
    origenes[g].add(item.origen_carrera_id);
  }
  return grupos;
}

// ¿La ronda con N participantes ya es la Gran Final? Cuando N no supera
// final_pilotos, o no se puede partir en 2+ carreras.
export function esGranFinal(n: number, cfg: ConfigEliminacion): boolean {
  const K = cfg.eliminatoria.pilotosPorCarrera;
  const F = cfg.eliminatoria.finalPilotos;
  return n <= F || numCarreras(n, K) <= 1;
}

// ── Planificación de rondas ───────────────────────────────────────────────────

export type PlanParticipante = {
  inscripcion_id: string;
  seed: number; // seed original congelado (para balance y display)
  origen_carrera_id?: string | null;
  origen_posicion?: number | null;
};
export type PlanCarrera = { participantes: PlanParticipante[]; es_bye: boolean };
export type PlanRonda = { tipo: "principal" | "final"; carreras: PlanCarrera[] };

// Primera ronda: distribuye los seeds congelados con serpentina. Si ya entran en
// una final, arma la final directamente.
export function armarPrimeraRonda(seeds: ParticipanteSeed[], cfg: ConfigEliminacion): PlanRonda {
  const items = [...seeds].sort((a, b) => a.seed - b.seed);
  if (esGranFinal(items.length, cfg)) {
    return {
      tipo: "final",
      carreras: [{ participantes: items.map((s) => ({ inscripcion_id: s.inscripcion_id, seed: s.seed })), es_bye: false }],
    };
  }
  const C = numCarreras(items.length, cfg.eliminatoria.pilotosPorCarrera);
  const grupos = serpentina(items, C);
  return {
    tipo: "principal",
    carreras: grupos.map((g) => ({
      participantes: g.map((s) => ({ inscripcion_id: s.inscripcion_id, seed: s.seed })),
      es_bye: g.length === 1,
    })),
  };
}

export type Clasificado = {
  inscripcion_id: string;
  seed: number; // seed original congelado
  origen_carrera_id: string;
  origen_posicion: number; // 1 = ganador de su carrera, 2 = segundo, …
};

// Ronda siguiente: ordena a los clasificados (ganadores primero, luego por seed),
// los distribuye con serpentina y REPARA para evitar rematches inmediatos
// (dos clasificados de la misma carrera de origen en el mismo grupo).
export function armarSiguienteRonda(clasificados: Clasificado[], cfg: ConfigEliminacion): PlanRonda {
  const items = [...clasificados].sort(
    (a, b) => a.origen_posicion - b.origen_posicion || a.seed - b.seed,
  );
  const toPlan = (c: Clasificado): PlanParticipante => ({
    inscripcion_id: c.inscripcion_id,
    seed: c.seed,
    origen_carrera_id: c.origen_carrera_id,
    origen_posicion: c.origen_posicion,
  });

  if (esGranFinal(items.length, cfg)) {
    return { tipo: "final", carreras: [{ participantes: items.map(toPlan), es_bye: false }] };
  }
  const C = numCarreras(items.length, cfg.eliminatoria.pilotosPorCarrera);
  const grupos = distribuirClasificados(items, C, cfg.eliminatoria.pilotosPorCarrera);
  return {
    tipo: "principal",
    carreras: grupos.map((g) => ({ participantes: g.map(toPlan), es_bye: g.length === 1 })),
  };
}

// ── Resultados / avance ───────────────────────────────────────────────────────

export type ResultadoParticipante = {
  inscripcion_id: string;
  posicion_final: number; // 1..N
  estado?: "activo" | "dnf" | "dsq";
};

export type ValidacionResultado = { ok: true } | { ok: false; error: string };

// Valida el resultado de una carrera antes de finalizarla (§27, §29):
// posiciones 1..N sin duplicados, cubriendo a todos los participantes.
export function validarResultadoCarrera(
  participantesIds: string[],
  resultado: ResultadoParticipante[],
): ValidacionResultado {
  const n = participantesIds.length;
  if (resultado.length !== n) return { ok: false, error: "Faltan posiciones por asignar." };
  const ids = new Set(participantesIds);
  const posiciones = new Set<number>();
  for (const r of resultado) {
    if (!ids.has(r.inscripcion_id)) return { ok: false, error: "Participante ajeno a la carrera." };
    if (!Number.isInteger(r.posicion_final) || r.posicion_final < 1 || r.posicion_final > n) {
      return { ok: false, error: `Posición fuera de rango (1..${n}).` };
    }
    if (posiciones.has(r.posicion_final)) return { ok: false, error: "Posiciones duplicadas." };
    posiciones.add(r.posicion_final);
  }
  return { ok: true };
}

// Determina quiénes avanzan de una carrera finalizada: los primeros
// `avanzan_por_carrera` por posición, excluyendo DNF/DSQ. Si hay menos
// participantes “sanos” que cupos de avance, avanzan los que haya.
export function clasificadosDeCarrera(
  resultado: ResultadoParticipante[],
  avanzanPorCarrera: number,
): ResultadoParticipante[] {
  return [...resultado]
    .filter((r) => r.estado !== "dnf" && r.estado !== "dsq")
    .sort((a, b) => a.posicion_final - b.posicion_final)
    .slice(0, Math.max(0, avanzanPorCarrera));
}

// Podio final: 1.º/2.º/3.º (según cantidad real de participantes de la final).
export function calcularPodio(resultadoFinal: ResultadoParticipante[]): Array<{ puesto: number; inscripcion_id: string }> {
  return [...resultadoFinal]
    .sort((a, b) => a.posicion_final - b.posicion_final)
    .slice(0, 3)
    .map((r, i) => ({ puesto: i + 1, inscripcion_id: r.inscripcion_id }));
}

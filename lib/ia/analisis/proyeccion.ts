// IA SIM · Bloque 4E — Proyección de cierre por escenarios, PURA. Usa percentiles de la
// distribución histórica REAL por día de semana (no porcentajes arbitrarios tipo "±10%").

export type DiaHistorico = { fecha: string; diaSemana: number; valor: number }; // diaSemana: 0=domingo..6=sábado
export type DiaFuturo = { fecha: string; diaSemana: number; abierto: boolean };

export type NombreEscenario = "conservador" | "base" | "optimista";
export type Escenario = {
  nombre: NombreEscenario;
  valorProyectado: number;
  formula: string;
  percentilUsado: number;
  diasProyectados: number;
};

export type ResultadoProyeccion =
  | {
      ok: true;
      escenarios: Escenario[];
      datosHistoricosUtilizados: number;
      diasFuturosConsiderados: number;
      diasFuturosCerrados: number;
      supuestos: string[];
      confianza: "alta" | "media" | "baja";
      fechaCorte: string;
      realAcumulado: number;
      diferenciaVsProyectado: Record<NombreEscenario, number>;
    }
  | { ok: false; motivo: "muestra_insuficiente"; explicacion: string };

const PERCENTILES: Record<NombreEscenario, number> = { conservador: 20, base: 50, optimista: 80 };
const MUESTRA_MINIMA_TOTAL = 8; // días históricos mínimos para poder proyectar algo
const MUESTRA_MINIMA_BUCKET = 4; // por día de semana; si no alcanza, se usa el global de ese día

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const s = [...valores].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function proyectarCierre(params: {
  historico: DiaHistorico[];
  diasFuturosDelPeriodo: DiaFuturo[];
  realAcumuladoPeriodoActual: number;
  fechaCorte: string;
  cronogramaOficial: boolean;
}): ResultadoProyeccion {
  const { historico, diasFuturosDelPeriodo, realAcumuladoPeriodoActual, fechaCorte, cronogramaOficial } = params;
  if (historico.length < MUESTRA_MINIMA_TOTAL) {
    return { ok: false, motivo: "muestra_insuficiente", explicacion: `Hay ${historico.length} días históricos disponibles; se necesitan al menos ${MUESTRA_MINIMA_TOTAL} para proyectar con una metodología estadística robusta. No se arma una proyección con esta muestra.` };
  }

  const porDiaSemana: Record<number, number[]> = {};
  for (const d of historico) (porDiaSemana[d.diaSemana] ??= []).push(d.valor);
  const globalValores = historico.map((d) => d.valor);

  const abiertos = diasFuturosDelPeriodo.filter((d) => d.abierto);
  const cerrados = diasFuturosDelPeriodo.length - abiertos.length;

  const supuestos: string[] = [
    `Distribución histórica de ${historico.length} días reales, por día de semana (percentiles ${PERCENTILES.conservador}/${PERCENTILES.base}/${PERCENTILES.optimista}).`,
    cronogramaOficial ? "Días futuros según cronograma CONFIRMADO (oficial)." : "Cronograma en BORRADOR: los días abiertos/cerrados usados son un supuesto no oficial, no confirmado.",
    `${cerrados} día(s) futuro(s) del período están cerrados según cronograma y se proyectan en $0 / 0 (no se les asigna actividad).`,
  ];

  const escenarios: Escenario[] = (Object.keys(PERCENTILES) as NombreEscenario[]).map((nombre) => {
    const p = PERCENTILES[nombre];
    let total = 0;
    let usoGlobalEnAlgunDia = false;
    for (const d of abiertos) {
      const bucket = porDiaSemana[d.diaSemana] ?? [];
      const valores = bucket.length >= MUESTRA_MINIMA_BUCKET ? bucket : globalValores;
      if (bucket.length < MUESTRA_MINIMA_BUCKET) usoGlobalEnAlgunDia = true;
      total += percentil(valores, p);
    }
    if (usoGlobalEnAlgunDia) supuestos.push(`Para algunos días de la semana no hay ${MUESTRA_MINIMA_BUCKET}+ muestras históricas: se usó el percentil ${p} de TODOS los días históricos en su lugar (menos preciso, declarado).`);
    return {
      nombre, valorProyectado: Math.round((realAcumuladoPeriodoActual + total) * 100) / 100,
      formula: `real_acumulado + Σ(percentil ${p} del valor histórico por día de semana, días abiertos restantes)`,
      percentilUsado: p, diasProyectados: abiertos.length,
    };
  });

  const bucketsConMuestra = Object.values(porDiaSemana).filter((v) => v.length >= MUESTRA_MINIMA_BUCKET).length;
  const confianza: "alta" | "media" | "baja" = !cronogramaOficial ? "baja" : (historico.length >= 30 && bucketsConMuestra >= 5) ? "alta" : historico.length >= 14 ? "media" : "baja";

  const diferenciaVsProyectado = Object.fromEntries(escenarios.map((e) => [e.nombre, Math.round((e.valorProyectado - realAcumuladoPeriodoActual) * 100) / 100])) as Record<NombreEscenario, number>;

  return {
    ok: true, escenarios, datosHistoricosUtilizados: historico.length,
    diasFuturosConsiderados: diasFuturosDelPeriodo.length, diasFuturosCerrados: cerrados,
    supuestos, confianza, fechaCorte, realAcumulado: Math.round(realAcumuladoPeriodoActual * 100) / 100, diferenciaVsProyectado,
  };
}

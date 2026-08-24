// Agregación pura de las métricas del Stand (Turnero). La usan la página de
// métricas (app/admin/(panel)/metricas/page.tsx) y los tests. Sin dependencias
// de servidor: es seguro importarla desde un componente "use client".
//
// Modelo de datos verificado sobre turnos_stand (datos reales de SIM):
//   cantidad_turnos = cantidad_personas × (cantidad_minutos / 15)
// Es decir, 1 turno = 1 bloque de 15 min por persona. Ejemplos:
//   1 persona · 15 min  → 1 turno   (15 min vendidos)
//   2 personas · 15 min → 2 turnos  (30 min vendidos)
//   1 persona · 30 min  → 2 turnos  (30 min vendidos)
//   4 personas · 30 min → 8 turnos  (120 min vendidos)
// Por eso "minutos vendidos = turnos × 15" coincide con los minutos-persona
// reales, y garantiza el invariante turnos > 0 ⟹ minutos > 0 ⟹ horas > 0.

export const MINUTOS_POR_TURNO = 15; // 1 turno = bloque de 15 minutos
export const CANTIDAD_SIMULADORES_FISICOS = 4; // SIM opera 4 simuladores

export type FilaStand = {
  total?: number | string | null;
  monto?: number | string | null;
  cantidad_turnos?: number | string | null;
  cantidad_personas?: number | string | null;
  cantidad_simuladores?: number | string | null;
  personas?: number | string | null;
};

// Parseo numérico tolerante (mismo criterio que numberValue en la página):
// admite "$", separador de miles "." y decimal ",".
export function numeroStand(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return (
    Number(
      String(value)
        .replace("$", "")
        .replace(/\./g, "")
        .replace(",", ".")
        .trim(),
    ) || 0
  );
}

// Turnos de una fila. En vivo usa cantidad_turnos (fuente de verdad). Para filas
// históricas de Excel sin ese dato, cae a cantidad_simuladores o personas.
export function turnosDeFila(t: FilaStand): number {
  const cant = numeroStand(t.cantidad_turnos);
  if (cant > 0) return cant;
  const sims = numeroStand(t.cantidad_simuladores);
  if (sims > 0) return sims;
  return numeroStand(t.personas) || 1;
}

// Personas reales de una fila. En vivo usa cantidad_personas; para Excel (sin esa
// columna) cae a cantidad_simuladores/personas; nunca menos de 1.
export function personasDeFila(t: FilaStand): number {
  return (
    numeroStand(t.cantidad_personas) ||
    numeroStand(t.cantidad_simuladores) ||
    numeroStand(t.personas) ||
    1
  );
}

export function totalDeFila(t: FilaStand): number {
  return numeroStand(t.total ?? t.monto);
}

export type AgregadoStand = {
  ventas: number;
  turnos: number;
  personas: number;
  minutos: number;
  horas: number;
  facturacion: number;
  ticketPromedio: number;
  promedioPersonas: number;
  ingresoPorMinuto: number;
  ingresoPorPersona: number;
  ingresoPromedioPorSimulador: number;
};

// Agrega las filas ya filtradas (por fecha/estado) en los KPIs numéricos del
// Stand. Cada fila cuenta como 1 venta (aunque tenga varias personas/turnos).
export function agregarStand(filas: FilaStand[]): AgregadoStand {
  const ventas = filas.length;
  const facturacion = filas.reduce((acc, t) => acc + totalDeFila(t), 0);
  const turnos = filas.reduce((acc, t) => acc + turnosDeFila(t), 0);
  const personas = filas.reduce((acc, t) => acc + personasDeFila(t), 0);
  const minutos = turnos * MINUTOS_POR_TURNO;
  const horas = minutos / 60;

  return {
    ventas,
    turnos,
    personas,
    minutos,
    horas,
    facturacion,
    ticketPromedio: ventas ? facturacion / ventas : 0,
    promedioPersonas: ventas ? personas / ventas : 0,
    ingresoPorMinuto: minutos ? facturacion / minutos : 0,
    ingresoPorPersona: personas ? facturacion / personas : 0,
    ingresoPromedioPorSimulador: facturacion / CANTIDAD_SIMULADORES_FISICOS,
  };
}

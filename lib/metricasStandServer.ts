// Carga de operaciones del Stand para el dashboard de Métricas (SERVIDOR).
// Lee solo el rango pedido y solo las columnas que usan las métricas; la
// definición de cada métrica vive en lib/metricasStandDashboard.ts (puro).
//
// Caché breve por rango (30 s, en memoria del proceso): el resumen pide el
// período actual y el de comparación, y el detalle vuelve a pedir el actual;
// cambiar de filtro o de página no vuelve a leer la base. "Actualizar" la salta.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { operacionesDeFilas, type FilaExcel, type FilaTurnero, type OperacionStand } from "@/lib/metricasStandDashboard";

const COLS_TURNERO =
  "id, fecha, hora, hora_subida, hora_estimada_subida, cantidad_personas, cantidad_simuladores, cantidad_minutos, cantidad_turnos, total, metodo_pago, pagos_detalle, estado, modalidad, nombre";
const COLS_EXCEL =
  "id, fecha, archivo_key, archivo_nombre, hora_tomado, hora_subida, hora_bajada, metodo_pago, total, cantidad_simuladores, cantidad_turnos, duracion, escuderia, origen";

const PAGINA = 1000;
const TTL_MS = 30_000;
const MAX_ENTRADAS = 24;

type Consulta = (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;

async function todas<T>(consulta: Consulta): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGINA) break;
  }
  return out;
}

async function leer(desde: string, hasta: string): Promise<OperacionStand[]> {
  const [turnero, excel] = await Promise.all([
    todas<FilaTurnero>((a, b) =>
      supabaseAdmin.from("turnos_stand").select(COLS_TURNERO).gte("fecha", desde).lte("fecha", hasta).order("id").range(a, b),
    ),
    // turnos_historicos.fecha es texto ISO: el orden lexicográfico es el cronológico.
    todas<FilaExcel>((a, b) =>
      supabaseAdmin.from("turnos_historicos").select(COLS_EXCEL).gte("fecha", desde).lte("fecha", hasta).order("id").range(a, b),
    ),
  ]);
  return operacionesDeFilas(turnero, excel);
}

const cache = new Map<string, { t: number; p: Promise<OperacionStand[]> }>();

/** Operaciones con fecha entre `desde` y `hasta` (ambas incluidas). */
export function operacionesEntre(desde: string, hasta: string, opciones: { fresco?: boolean } = {}): Promise<OperacionStand[]> {
  const clave = `${desde}|${hasta}`;
  const ahora = Date.now();
  const previa = cache.get(clave);
  if (previa && !opciones.fresco && ahora - previa.t < TTL_MS) return previa.p;
  const p = leer(desde, hasta);
  cache.set(clave, { t: ahora, p });
  p.catch(() => cache.delete(clave));
  if (cache.size > MAX_ENTRADAS) {
    const masVieja = [...cache.entries()].sort((a, b) => a[1].t - b[1].t)[0]?.[0];
    if (masVieja) cache.delete(masVieja);
  }
  return p;
}

let primeraFecha: { t: number; p: Promise<string | null> } | null = null;

/** Primera fecha con datos del Stand (Turnero o Excel), para avisar comparaciones sin datos. */
export function primeraFechaConDatos(): Promise<string | null> {
  if (primeraFecha && Date.now() - primeraFecha.t < 10 * 60_000) return primeraFecha.p;
  const p = Promise.all([
    supabaseAdmin.from("turnos_stand").select("fecha").order("fecha").limit(1),
    supabaseAdmin.from("turnos_historicos").select("fecha").order("fecha").limit(1),
  ]).then(([a, b]) => {
    const fechas = [a.data?.[0]?.fecha, b.data?.[0]?.fecha].filter((f): f is string => typeof f === "string").sort();
    return fechas[0] ?? null;
  });
  primeraFecha = { t: Date.now(), p };
  return p;
}

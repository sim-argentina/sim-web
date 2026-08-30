// Copiar semanas/meses y plantillas (IA SIM · Bloque 2D) — lógica PURA y testeable.
// Sin dependencias de servidor: matemática de fechas (semana lunes→domingo, meses
// por día-de-semana + número de aparición) y clasificación de conflictos
// (comparador compartido, reutilizado también por el importador PDF).

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function parseFecha(fecha: string): { y: number; m: number; d: number } | null {
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!mm) return null;
  const y = Number(mm[1]), m = Number(mm[2]), d = Number(mm[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

// Lunes = 0 … Domingo = 6.
export function weekday(fecha: string): number {
  const p = parseFecha(fecha)!;
  return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
}
export function esLunes(fecha: string): boolean {
  return parseFecha(fecha) !== null && weekday(fecha) === 0;
}
export function addDias(fecha: string, n: number): string {
  const p = parseFecha(fecha)!;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export const diasEnMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

// Número de aparición de un weekday dentro de su mes (1ª, 2ª, …): floor((día-1)/7)+1.
export function ocurrencia(fecha: string): number {
  return Math.floor((parseFecha(fecha)!.d - 1) / 7) + 1;
}

// ── Semana (lunes → domingo) ──────────────────────────────────────────────────
export function fechasSemana(lunes: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDias(lunes, i));
}
// Pares origen→destino de una semana (mismo día de la semana).
export function mapearSemana(lunesOrigen: string, lunesDestino: string): Array<{ origen: string; destino: string }> {
  const o = fechasSemana(lunesOrigen);
  const d = fechasSemana(lunesDestino);
  return o.map((origen, i) => ({ origen, destino: d[i] }));
}

// ── Mes por (día de la semana, número de aparición) ───────────────────────────
export type CeldaMes = { fecha: string; weekday: number; ocurrencia: number };
export function celdasMes(anio: number, mes: number): CeldaMes[] {
  const total = diasEnMes(anio, mes);
  const celdas: CeldaMes[] = [];
  for (let d = 1; d <= total; d++) {
    const fecha = ymd(anio, mes, d);
    celdas.push({ fecha, weekday: weekday(fecha), ocurrencia: Math.floor((d - 1) / 7) + 1 });
  }
  return celdas;
}
export type MapeoMes = {
  pares: Array<{ origen: string; destino: string; weekday: number; ocurrencia: number }>;
  soloOrigen: string[]; // apariciones del origen sin equivalente en destino (se ignoran)
  soloDestino: string[]; // apariciones del destino sin equivalente en origen (se conservan)
};
// Relaciona por día-de-semana + aparición (1º lunes↔1º lunes, etc.). NO por número de fecha.
export function mapearMes(anioO: number, mesO: number, anioD: number, mesD: number): MapeoMes {
  const key = (c: CeldaMes) => `${c.weekday}-${c.ocurrencia}`;
  const o = new Map(celdasMes(anioO, mesO).map((c) => [key(c), c]));
  const d = new Map(celdasMes(anioD, mesD).map((c) => [key(c), c]));
  const pares: MapeoMes["pares"] = [];
  const soloOrigen: string[] = [];
  for (const [k, co] of o) {
    const cd = d.get(k);
    if (cd) pares.push({ origen: co.fecha, destino: cd.fecha, weekday: co.weekday, ocurrencia: co.ocurrencia });
    else soloOrigen.push(co.fecha);
  }
  const soloDestino: string[] = [];
  for (const [k, cd] of d) if (!o.has(k)) soloDestino.push(cd.fecha);
  pares.sort((a, b) => a.destino.localeCompare(b.destino));
  soloOrigen.sort();
  soloDestino.sort();
  return { pares, soloOrigen, soloDestino };
}

// ── Comparador de conflictos (compartido) ─────────────────────────────────────
export type DiaCmp = {
  cerrado: boolean;
  apertura: string;
  cierre: string;
  jornadas: Array<{ key: string; hora_inicio: string; hora_fin: string }>;
};
const hhmm = (t: string) => String(t).slice(0, 5);

// Firma canónica de un día para comparar (independiente del orden de jornadas).
export function firmaDia(d: DiaCmp): string {
  if (d.cerrado) return "CERRADO";
  const js = d.jornadas.map((j) => `${j.key}:${hhmm(j.hora_inicio)}-${hhmm(j.hora_fin)}`).sort().join("|");
  return `${hhmm(d.apertura)}-${hhmm(d.cierre)}#${js}`;
}

export type ClaseConflicto = "sin_cambios" | "solo_propuesta" | "solo_destino" | "diferente";
export function clasificar(actual: DiaCmp | null, propuesta: DiaCmp | null): ClaseConflicto {
  if (actual && propuesta) return firmaDia(actual) === firmaDia(propuesta) ? "sin_cambios" : "diferente";
  if (propuesta) return "solo_propuesta";
  return "solo_destino";
}

// ── Normalización de nombre de plantilla (1..80; sin duplicados activos) ───────
export function normalizarNombrePlantilla(input: unknown): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

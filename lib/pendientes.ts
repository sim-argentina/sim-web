// Lógica pura y compartida de Pendientes (validación + clasificación de fechas +
// agrupación/orden). La usan las rutas API, el cliente y los tests. Sin dependencias
// de servidor: es seguro importarla desde un componente "use client".

export const MAX_TITULO = 200;
export const MAX_DESCRIPCION = 2000;
// "Vence pronto": fecha límite dentro de los próximos N días (hoy no incluido).
export const DIAS_PRONTO = 3;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EstadoFecha = "vencido" | "hoy" | "pronto" | "futuro" | "sinfecha";
export type GrupoFecha = "vencidos" | "proximos" | "sinfecha";

// Índice de día calendario a partir de 'YYYY-MM-DD'. Usa Date.UTC sobre los
// componentes numéricos (NO parsea la cadena ISO), así la diferencia entre dos
// fechas es exacta en días de calendario sin corrimientos por zona horaria.
function diaIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

// Clasifica una fecha límite (date, no timestamp) respecto de `hoy` (YYYY-MM-DD,
// típicamente el día actual en Argentina).
export function estadoFecha(
  fechaLimite: string | null | undefined,
  hoy: string,
  diasPronto = DIAS_PRONTO,
): EstadoFecha {
  if (!fechaLimite) return "sinfecha";
  const f = fechaLimite.slice(0, 10);
  if (!FECHA_RE.test(f) || !FECHA_RE.test(hoy)) return "sinfecha";
  const diff = diaIndex(f) - diaIndex(hoy);
  if (diff < 0) return "vencido";
  if (diff === 0) return "hoy";
  if (diff <= diasPronto) return "pronto";
  return "futuro";
}

export function grupoDe(estado: EstadoFecha): GrupoFecha {
  if (estado === "vencido") return "vencidos";
  if (estado === "sinfecha") return "sinfecha";
  return "proximos"; // hoy | pronto | futuro
}

// ── Validación (misma en front y back) ───────────────────────────────────────

export type ValidacionTexto = { ok: true; value: string } | { ok: false; error: string };
export type ValidacionOpcional = { ok: true; value: string | null } | { ok: false; error: string };

export function validarTitulo(v: unknown): ValidacionTexto {
  const t = String(v ?? "").trim();
  if (!t) return { ok: false, error: "El título es obligatorio" };
  if (t.length > MAX_TITULO) return { ok: false, error: "El título es demasiado largo" };
  return { ok: true, value: t };
}

// Descripción opcional: "" o solo espacios → null; valida longitud máxima.
export function normalizarDescripcion(v: unknown): ValidacionOpcional {
  if (v === undefined || v === null) return { ok: true, value: null };
  const d = String(v).trim();
  if (!d) return { ok: true, value: null };
  if (d.length > MAX_DESCRIPCION) return { ok: false, error: "La descripción es demasiado larga" };
  return { ok: true, value: d };
}

// Fecha límite opcional: 'YYYY-MM-DD' válido o null. undefined/""/null → null.
export function parseFechaLimite(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v === "string") {
    const s = v.trim();
    if (FECHA_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime())) {
      return { ok: true, value: s };
    }
  }
  return { ok: false };
}

// ── Agrupación / orden de la vista de abiertos ───────────────────────────────

export type PendienteOrden = {
  fecha_limite: string | null;
  created_at: string;
  completado?: boolean;
  completado_at?: string | null;
};

function porFechaAsc<T extends PendienteOrden>(a: T, b: T): number {
  const fa = a.fecha_limite ?? "";
  const fb = b.fecha_limite ?? "";
  if (fa !== fb) return fa < fb ? -1 : 1; // fecha ascendente (más próxima primero)
  return (b.created_at || "").localeCompare(a.created_at || ""); // desempate created_at desc
}
function porCreadoDesc<T extends PendienteOrden>(a: T, b: T): number {
  return (b.created_at || "").localeCompare(a.created_at || "");
}

// Agrupa los pendientes ABIERTOS en vencidos / próximos / sin fecha, ya ordenados.
export function agruparAbiertos<T extends PendienteOrden>(
  items: T[],
  hoy: string,
): { vencidos: T[]; proximos: T[]; sinfecha: T[] } {
  const vencidos: T[] = [];
  const proximos: T[] = [];
  const sinfecha: T[] = [];
  for (const p of items) {
    if (p.completado) continue;
    const g = grupoDe(estadoFecha(p.fecha_limite, hoy));
    if (g === "vencidos") vencidos.push(p);
    else if (g === "proximos") proximos.push(p);
    else sinfecha.push(p);
  }
  vencidos.sort(porFechaAsc); // cronológico ascendente
  proximos.sort(porFechaAsc); // cronológico ascendente
  sinfecha.sort(porCreadoDesc);
  return { vencidos, proximos, sinfecha };
}

// Completados ordenados por completado_at descendente.
export function ordenarCompletados<T extends PendienteOrden>(items: T[]): T[] {
  return items
    .filter((p) => p.completado)
    .sort((a, b) => (b.completado_at || "").localeCompare(a.completado_at || ""));
}

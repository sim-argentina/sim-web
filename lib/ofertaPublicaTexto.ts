// ============================================================================
// Textos públicos de la oferta comercial (bloque final: Home y Viví SIM).
// Módulo PURO y client-safe: no resuelve la modalidad ni lee la base. Recibe lo
// que ya decidió el servidor (catálogo vigente) y lo convierte en texto, así la
// web nunca escribe a mano "15 y 30 minutos" ni "Desde $12.000".
// ============================================================================

/** [15, 30] → "15 y 30"; [10, 20, 30] → "10, 20 y 30"; [30] → "30". */
export function listaDuraciones(duraciones: readonly number[]): string {
  const ds = [...new Set(duraciones.map(Number).filter((d) => Number.isInteger(d) && d > 0))].sort((a, b) => a - b);
  if (ds.length <= 1) return ds.map(String).join("");
  return `${ds.slice(0, -1).join(", ")} y ${ds[ds.length - 1]}`;
}

/** [15, 30] → "15 / 30"; [10, 20, 30] → "10/20/30" (más de dos, sin espacios para no desbordar la stat). */
export function duracionesCompactas(duraciones: readonly number[]): string {
  const ds = [...new Set(duraciones.map(Number).filter((d) => Number.isInteger(d) && d > 0))].sort((a, b) => a - b);
  return ds.join(ds.length > 2 ? "/" : " / ");
}

/** El menor precio positivo de una lista, o null si no hay ninguno. */
export function precioDesde(precios: readonly number[]): number | null {
  const validos = precios.map(Number).filter((p) => Number.isFinite(p) && p > 0);
  return validos.length ? Math.min(...validos) : null;
}

/** 30000 → "$30.000" (separador de miles argentino, sin depender del ICU del entorno). */
export function formatoPrecio(valor: number): string {
  return `$${String(Math.round(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

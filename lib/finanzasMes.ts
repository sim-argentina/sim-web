// Finanzas — utilidades de mes PURAS (sin acceso a DB, sin imports pesados) para
// que la regresión de rangos corra sin credenciales. lib/finanzas.ts las re-exporta:
// el resto del código las sigue importando desde "@/lib/finanzas".

export function diasEnMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Rango [desde, hastaExclusivo) de un mes. Es el ÚNICO modo válido de acotar un
// mes contra una columna `date`/`timestamptz`.
//
// NUNCA construir el fin de mes concatenando el día 31: en meses de 30 días y en
// febrero esa fecha no existe y Postgres rechaza la consulta ENTERA con
// 22008 (date/time field value out of range), no solo la fila.
export function rangoMes(mes: string): { desde: string; hastaExclusivo: string } {
  const [y, m] = mes.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { desde: `${mes}-01`, hastaExclusivo: `${ny}-${String(nm).padStart(2, "0")}-01` };
}

// Último día REAL del mes ("2026-09-30"), para las comparaciones inclusivas.
export function ultimoDiaMes(mes: string): string {
  return `${mes}-${String(diasEnMes(mes)).padStart(2, "0")}`;
}

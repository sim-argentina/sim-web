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

// Rango [desde, hastaExclusivo) de un mes contra una columna `timestamptz`, con
// los límites puestos en HORA ARGENTINA. Es el equivalente en la aplicación de
// `to_char(col at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') = mes`,
// que es el criterio con el que fin_ingresos_por_mes decide a qué mes contable
// pertenece un cobro. Usarlo es lo que garantiza que un bruto y su comisión
// caigan siempre en el mismo mes.
//
// Argentina es UTC-3 y no aplica horario de verano, así que el offset es fijo:
// no hace falta una librería de zonas horarias para esto.
export function rangoMesAr(mes: string): { desde: string; hastaExclusivo: string } {
  const { desde, hastaExclusivo } = rangoMes(mes);
  return { desde: `${desde}T00:00:00-03:00`, hastaExclusivo: `${hastaExclusivo}T00:00:00-03:00` };
}

// Último día REAL del mes ("2026-09-30"), para las comparaciones inclusivas.
export function ultimoDiaMes(mes: string): string {
  return `${mes}-${String(diasEnMes(mes)).padStart(2, "0")}`;
}

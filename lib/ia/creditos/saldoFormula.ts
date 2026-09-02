// IA SIM · Bloque 4B.5.1 — Fórmula PURA del saldo conciliado (sin dependencias de DB).
// saldo = S + M − (C − B)
//   S = saldo real observado en la última conciliación
//   M = movimientos monetarios posteriores (con signo; excluye conciliaciones)
//   C = costo interno acumulado actual
//   B = costo interno acumulado al momento de conciliar
// Todo en nano-USD (BigInt): sin floating point. Permite saldo negativo.
export function saldoConciliado(sNano: bigint, mNano: bigint, cNano: bigint, bNano: bigint): bigint {
  return sNano + mNano - (cNano - bNano);
}

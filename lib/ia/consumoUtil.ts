// IA SIM · Bloque 4B.4 — Rango de mes local seguro. NUNCA usa "-31" (rompía en meses
// de 30 días: '2026-09-31' es una fecha inválida y hacía fallar la query del panel).
export function rangoMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { desde: `${mes}-01`, hasta: `${ny}-${String(nm).padStart(2, "0")}-01` };
}

// IA SIM · Bloque 4D — Costo de la búsqueda web, VERSIONADO y auditable.
// Anthropic cobra la búsqueda web aparte de los tokens: US$10 por 1.000 búsquedas
// (US$0,01 por búsqueda exitosa). El importe no se dispersa como número mágico.

export const PRECIOS_WEB_VERSION = "2026-08";

// USD por 1.000 búsquedas web exitosas (documentación oficial vigente).
export const USD_POR_1000_BUSQUEDAS = 10;
// USD por búsqueda exitosa.
export const USD_POR_BUSQUEDA = USD_POR_1000_BUSQUEDAS / 1000; // 0.01

// Costo (USD) de N búsquedas FACTURABLES (las fallidas no facturables no cuentan).
export function costoBusquedasUSD(busquedasFacturables: number): number {
  const n = Number.isFinite(busquedasFacturables) && busquedasFacturables > 0 ? Math.floor(busquedasFacturables) : 0;
  return n * USD_POR_BUSQUEDA;
}

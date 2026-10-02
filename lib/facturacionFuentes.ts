// Catálogo de fuentes de facturación de SIM. Puro, sin base de datos: lo usan
// validaciones que corren sin conexión (p. ej. el plan analítico de IA SIM).
//
// IMPORTANTE: esto NO es la composición de la facturación. Lo que se suma sale
// íntegramente de la función canónica `fin_eventos_facturacion`
// (db/facturacion-eventos-canonica.sql, leída por lib/facturacionEventos.ts), y
// una fuente nueva allá entra en los totales sin tocar este archivo.
//
// Esta lista existe solo para rechazar un valor inventado —que el modelo no
// pueda pasar un nombre de tabla como si fuera una fuente—. La prueba
// contractual (lib/facturacionEventos.contrato.integration.ts) exige que sea
// exactamente lo que emite el SQL, así que no puede quedarse atrás en silencio.
export const FUENTES_FACTURACION = [
  "turnero",
  "reservas_online",
  "gift_cards",
  "campeonatos",
  "mensualidades",
  "manuales",
] as const;

export type FuenteFacturacion = (typeof FUENTES_FACTURACION)[number];

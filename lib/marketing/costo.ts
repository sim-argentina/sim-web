// ============================================================================
// Costo estimado de un envío de marketing por WhatsApp (Marketing · Etapa 1). PURO.
// ----------------------------------------------------------------------------
// Meta cobra por mensaje ENTREGADO, con tarifas por mercado que cambian cada
// trimestre. Por eso la tarifa es SIEMPRE un parámetro: nada de valores fijos en
// el código. El tope de destinatarios y el presupuesto recortan la cantidad
// enviable; el costo máximo supone que se entregan todos.
// ============================================================================

export type ParamsCosto = {
  destinatarios: number;
  /** Tarifa de marketing por mensaje entregado, en `moneda` (tarifario oficial vigente). */
  tarifaPorEntregado: number;
  moneda: string;
  limiteDestinatarios?: number | null;
  presupuestoMaximo?: number | null;
};

export type EstimacionCosto = {
  destinatarios: number;
  enviables: number;
  recortadoPor: ("limite" | "presupuesto")[];
  tarifaPorEntregado: number;
  moneda: string;
  /** Si se entregan todos los enviables. Los no entregados no se cobran. */
  costoMaximo: number;
};

// Escala entera para no perder centavos con tarifas de 4 decimales (0,0618).
const ESCALA = 1_000_000;
const aEscala = (n: number) => Math.round(n * ESCALA);

export function estimarCosto(p: ParamsCosto): EstimacionCosto {
  if (!Number.isInteger(p.destinatarios) || p.destinatarios < 0) throw new Error("Cantidad de destinatarios inválida.");
  if (!Number.isFinite(p.tarifaPorEntregado) || p.tarifaPorEntregado <= 0) throw new Error("La tarifa tiene que ser un número positivo.");
  if (!p.moneda?.trim()) throw new Error("Falta la moneda de la tarifa.");
  const limite = p.limiteDestinatarios ?? null;
  if (limite !== null && (!Number.isInteger(limite) || limite < 0)) throw new Error("Límite de destinatarios inválido.");
  const presupuesto = p.presupuestoMaximo ?? null;
  if (presupuesto !== null && (!Number.isFinite(presupuesto) || presupuesto < 0)) throw new Error("Presupuesto inválido.");

  let enviables = p.destinatarios;
  const recortadoPor: EstimacionCosto["recortadoPor"] = [];
  if (limite !== null && limite < enviables) {
    enviables = limite;
    recortadoPor.push("limite");
  }
  if (presupuesto !== null) {
    const alcanza = Math.floor(aEscala(presupuesto) / aEscala(p.tarifaPorEntregado));
    if (alcanza < enviables) {
      enviables = alcanza;
      recortadoPor.push("presupuesto");
    }
  }

  return {
    destinatarios: p.destinatarios,
    enviables,
    recortadoPor,
    tarifaPorEntregado: p.tarifaPorEntregado,
    moneda: p.moneda.trim(),
    costoMaximo: Math.round((enviables * aEscala(p.tarifaPorEntregado)) / (ESCALA / 100)) / 100,
  };
}

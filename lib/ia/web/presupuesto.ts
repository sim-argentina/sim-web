// IA SIM · Bloque 4D.5 — Presupuesto PREVIO a llamar a Claude. Estima tokens/costo con lo que
// realmente se va a enviar (system + tools + historial + contexto interno + contexto web +
// salida reservada) y decide ANTES de la llamada, no después de pagarla.

import { estimarCostoUSD } from "@/lib/ia/config";

export type PresupuestoConfig = {
  maxBusquedas: number;
  maxRondas: number;
  maxTokensInEstimados: number;
  maxTokensSalida: number;
  maxCostoUsd: number;
};

// Estándar: 1 búsqueda, 2 rondas, ≤25k tokens de entrada estimados, ≤US$0,15.
// maxTokensSalida=2600 (Corrección 4D.5.2): 4D.5.1 subió el tope de salida a 3200 confiando en
// que el modelo respetara un "contrato de respuesta compacta" en Markdown LIBRE — la ejecución
// real 192ef058 (11.781 in / 3.200 out) demostró que ese contrato es un pedido, no una garantía:
// el modelo volvió a agotar el tope, esta vez el nuevo. 4D.5.2 reemplaza el Markdown libre por
// una salida ESTRUCTURADA con longitudes acotadas por campo (ver analisisWebSchema.ts): el peor
// caso teórico del esquema (5 actores + 6 filas de comparación + textos al máximo) son ~2.000-
// 2.200 tokens de JSON: 2.600 deja margen sin depender de que el modelo "se comporte". Peor caso
// de costo (25.000 in de tope + 2.600 out de tope): 25000*3/1e6 + 2600*15/1e6 = US$0,114 ≤ US$0,15.
export const PRESUPUESTO_ESTANDAR: PresupuestoConfig = { maxBusquedas: 1, maxRondas: 2, maxTokensInEstimados: 25000, maxTokensSalida: 2600, maxCostoUsd: 0.15 };
// Ampliado: requiere confirmación EXPLÍCITA del administrador ANTES de cualquier consumo (ver
// IAChat.tsx, botón de investigación profunda — ya no aparece como rescate automático de una
// consulta estándar). Mismo esquema acotado (mismo tope de salida); más margen de entrada/costo
// para conversaciones largas. Peor caso: 60000*3/1e6 + 2600*15/1e6 = US$0,219 ≤ US$0,6.
export const PRESUPUESTO_AMPLIADO: PresupuestoConfig = { maxBusquedas: 1, maxRondas: 4, maxTokensInEstimados: 60000, maxTokensSalida: 2600, maxCostoUsd: 0.6 };

const tk = (chars: number) => Math.ceil(Math.max(0, chars) / 4);

export type EstimacionPresupuesto = { tokensInEstimados: number; costoProyectadoUsd: number };

export function estimarPresupuesto(input: {
  modelo: string; systemPromptChars: number; toolsJsonChars: number; historialChars: number; contextoInternoChars: number; contextoWebChars: number; maxTokensSalida: number;
}): EstimacionPresupuesto {
  const tokensInEstimados = tk(input.systemPromptChars) + tk(input.toolsJsonChars) + tk(input.historialChars) + tk(input.contextoInternoChars) + tk(input.contextoWebChars);
  const costoProyectadoUsd = estimarCostoUSD(input.modelo, tokensInEstimados, input.maxTokensSalida) ?? 0;
  return { tokensInEstimados, costoProyectadoUsd };
}

export function evaluarPresupuesto(estim: EstimacionPresupuesto, cfg: PresupuestoConfig): { ok: boolean; motivo?: string } {
  if (estim.tokensInEstimados > cfg.maxTokensInEstimados) return { ok: false, motivo: "tokens_estimados_excedidos" };
  if (estim.costoProyectadoUsd > cfg.maxCostoUsd) return { ok: false, motivo: "costo_proyectado_excedido" };
  return { ok: true };
}

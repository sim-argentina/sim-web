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

// Estándar: 1 búsqueda, 2 rondas, ≤25k tokens de entrada estimados, ≤2k de salida, ≤US$0,15.
export const PRESUPUESTO_ESTANDAR: PresupuestoConfig = { maxBusquedas: 1, maxRondas: 2, maxTokensInEstimados: 25000, maxTokensSalida: 2000, maxCostoUsd: 0.15 };
// Ampliado: requiere confirmación EXPLÍCITA del administrador (ver server.ts). Mismo tope de 1
// búsqueda por respuesta (evita el patrón que causó la ejecución cara); más margen de síntesis.
export const PRESUPUESTO_AMPLIADO: PresupuestoConfig = { maxBusquedas: 1, maxRondas: 4, maxTokensInEstimados: 60000, maxTokensSalida: 2500, maxCostoUsd: 0.6 };

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

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
// maxTokensSalida=3200 (Corrección 4D.5.1): la ejecución real auditada (20.033 in / 2.692 out,
// stop_reason=max_tokens con el tope previo de 2000) demostró que un análisis competitivo bien
// fundamentado (5 fuentes + datos internos + clasificación por actor + tabla + conclusión) no
// entra en 2000 tokens de salida. En el PEOR caso (25.000 in de tope + 3200 out de tope) el
// costo proyectado es 25000*3/1e6 + 3200*15/1e6 = US$0,123 ≤ US$0,15: sigue dentro del techo de
// costo sin tocarlo. El contrato de respuesta compacta del prompt (ver systemPrompt.ts) acota el
// contenido para que, en el caso típico, no haga falta llegar a ese tope.
export const PRESUPUESTO_ESTANDAR: PresupuestoConfig = { maxBusquedas: 1, maxRondas: 2, maxTokensInEstimados: 25000, maxTokensSalida: 3200, maxCostoUsd: 0.15 };
// Ampliado: requiere confirmación EXPLÍCITA del administrador (ver server.ts). Mismo tope de 1
// búsqueda por respuesta (evita el patrón que causó la ejecución cara); más margen de síntesis.
// Peor caso: 60000*3/1e6 + 4000*15/1e6 = US$0,24 ≤ US$0,6.
export const PRESUPUESTO_AMPLIADO: PresupuestoConfig = { maxBusquedas: 1, maxRondas: 4, maxTokensInEstimados: 60000, maxTokensSalida: 4000, maxCostoUsd: 0.6 };

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

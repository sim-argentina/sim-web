// IA SIM · Helpers compartidos entre lib/ia/tools.ts y lib/ia/analisis/herramientas.ts. En un
// módulo aparte para evitar un import circular (tools.ts → analisis/herramientas.ts → tools.ts).

import { validarAnioMes } from "@/lib/cronograma";

export class ToolParamError extends Error {}

export function pedirAnioMes(input: Record<string, unknown>): { anio: number; mes: number } {
  const v = validarAnioMes(input.anio, input.mes);
  if (!v.ok) throw new ToolParamError(v.error);
  return { anio: v.anio, mes: v.mes };
}

export const schemaAnioMes = {
  type: "object",
  properties: {
    anio: { type: "integer", description: "Año (2020-2100)" },
    mes: { type: "integer", description: "Mes 1-12" },
  },
  required: ["anio", "mes"],
  additionalProperties: false,
};

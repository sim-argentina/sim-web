// IA SIM · Bloque 4C — Contexto común de render (mismo snapshot para todos los formatos).
import type { InformeSpec } from "@/lib/ia/informes/schema";

export type ContextoRender = {
  spec: InformeSpec;
  generadoISO: string;   // fecha/hora de generación (congelada en el snapshot)
  version: number;
};

// IA SIM · Bloque 4C.2 — Validación determinística de integridad del borrador.
// Compara los REQUISITOS solicitados con el contenido real del borrador, los formatos
// seleccionados, las fuentes vinculadas y la reconciliación. Un borrador con requisitos
// faltantes NO puede confirmarse; con contradicciones queda BLOQUEADO.

import type { InformeSpec } from "@/lib/ia/informes/schema";
import { COMPONENTES, COMPONENTE_LABEL, type Componente, type Requisitos } from "@/lib/ia/informes/requisitos";
import type { FormatoArchivo } from "@/lib/ia/informes/limites";

export type Integridad = {
  estado: "completo" | "incompleto" | "bloqueado";
  faltantes: Componente[];
  faltantes_labels: string[];
  formatos_faltantes: FormatoArchivo[];
  contradicciones: string[];
  presencia: Record<Componente, boolean>;
};

function tienePeriodo(spec: InformeSpec): boolean { return Boolean(spec.periodo && spec.periodo.trim()); }

export function presenciaComponentes(spec: InformeSpec, fuentesVinculadas: number): Record<Componente, boolean> {
  return {
    resumen_ejecutivo: Boolean(spec.resumen_ejecutivo && spec.resumen_ejecutivo.trim()),
    conclusiones: spec.conclusiones.length > 0,
    tablas: spec.tablas.length > 0,
    graficos: spec.graficos.length > 0,
    fuentes: fuentesVinculadas > 0 || spec.fuentes.length > 0,
    periodo: tienePeriodo(spec),
    metodologia: Boolean(spec.metodologia && spec.metodologia.trim()),
    anexo: spec.anexo.length > 0,
  };
}

export function evaluarIntegridad(input: {
  spec: InformeSpec;
  requisitos: Requisitos;
  formatosSeleccionados: FormatoArchivo[];
  fuentesVinculadas: number;
  reconciliacion?: { ok: boolean; contradicciones: Array<{ etiqueta: string; detalle?: string }> };
}): Integridad {
  const presencia = presenciaComponentes(input.spec, input.fuentesVinculadas);
  const faltantes = (input.requisitos.componentes ?? []).filter((c) => !presencia[c]);
  const sel = new Set(input.formatosSeleccionados ?? []);
  const formatos_faltantes = (input.requisitos.formatos ?? []).filter((f) => !sel.has(f));
  const contradicciones = (input.reconciliacion && !input.reconciliacion.ok)
    ? input.reconciliacion.contradicciones.map((c) => c.etiqueta + (c.detalle ? ` — ${c.detalle}` : ""))
    : [];

  const estado: Integridad["estado"] = contradicciones.length > 0 ? "bloqueado"
    : (faltantes.length > 0 || formatos_faltantes.length > 0) ? "incompleto"
    : "completo";

  return { estado, faltantes, faltantes_labels: faltantes.map((c) => COMPONENTE_LABEL[c]), formatos_faltantes, contradicciones, presencia };
}

// ¿Se puede completar localmente lo que falta? (hay una tool de métricas en el snapshot)
export function faltantesCompletablesLocalmente(faltantes: Componente[]): Componente[] {
  const completables: Componente[] = ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo", "conclusiones"];
  return faltantes.filter((f) => completables.includes(f));
}

export { COMPONENTES };

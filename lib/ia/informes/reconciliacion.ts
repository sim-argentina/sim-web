// IA SIM · Bloque 4C — Reconciliación numérica determinística del informe contra
// el SNAPSHOT de herramientas usado (los resúmenes reales de las tools que corrieron).
// Objetivo: no dejar pasar cifras que CONTRADICEN el sistema. No inventa valores.
//
// Reglas:
//  • Toda cifra que el informe presenta como del SISTEMA (celdas numéricas de tablas
//    NO marcadas como cambio manual) debería tener respaldo en el snapshot. Las que no
//    lo tienen se REPORTAN (pueden ser agregados legítimos: suma/resta), no bloquean.
//  • Un cambio manual declara valor_original (lo del sistema) y valor_nuevo (lo del
//    admin). Si valor_original es numérico y NO aparece en el snapshot → CONTRADICCIÓN
//    (afirma un origen de sistema que no existe) → BLOQUEA.
//  • Los valores manuales quedan marcados; nunca se presentan como del sistema.

import type { InformeSpec, CeldaValor } from "@/lib/ia/informes/schema";

const TOL = 0.005; // tolerancia absoluta pequeña (redondeos)

function esNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }

// Extrae recursivamente TODOS los números finitos de un objeto (los resúmenes de tools).
export function extraerNumeros(valor: unknown, acc: number[] = []): number[] {
  if (esNum(valor)) { acc.push(valor); return acc; }
  if (Array.isArray(valor)) { for (const x of valor) extraerNumeros(x, acc); return acc; }
  if (valor && typeof valor === "object") { for (const k of Object.keys(valor)) extraerNumeros((valor as Record<string, unknown>)[k], acc); return acc; }
  if (typeof valor === "string") {
    // Números embebidos en strings formateados ("US$ 1.234,50", "191 h").
    const limpio = valor.replace(/[^\d.,-]/g, " ");
    for (const m of limpio.matchAll(/-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g)) {
      const raw = m[0];
      // Normalizar: quitar separadores de miles y usar punto decimal.
      const n = Number(raw.replace(/\.(?=\d{3}\b)/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
      if (Number.isFinite(n)) acc.push(n);
    }
  }
  return acc;
}

function apareceEn(target: number, universo: number[]): boolean {
  const t = Math.abs(target);
  return universo.some((n) => Math.abs(Math.abs(n) - t) <= TOL + Math.abs(t) * 1e-6);
}

export type ResultadoReconciliacion = {
  ok: boolean;                                    // false → bloquear generación
  contradicciones: Array<{ ubicacion: string; etiqueta: string; valor_original: CeldaValor; detalle: string }>;
  respaldo: { total_cifras: number; respaldadas: number; sin_respaldo: number };
  sin_respaldo_muestra: Array<{ ubicacion: string; valor: number }>;
  manuales: number;
};

export function reconciliar(spec: InformeSpec, snapshotResumenes: unknown[]): ResultadoReconciliacion {
  const universo = extraerNumeros(snapshotResumenes);
  const contradicciones: ResultadoReconciliacion["contradicciones"] = [];
  const sinRespaldo: Array<{ ubicacion: string; valor: number }> = [];
  let total = 0, respaldadas = 0;

  // Ubicaciones marcadas como cambio manual (para excluirlas del chequeo de respaldo).
  const manualUbic = new Set(spec.cambios_manuales.map((c) => c.ubicacion));

  // 1) Cifras del sistema en tablas + anexo.
  const tablas = [...spec.tablas, ...spec.anexo];
  for (const t of tablas) {
    t.filas.forEach((fila, fi) => {
      fila.forEach((cel, ci) => {
        if (!esNum(cel)) return;
        const ubic = `tabla:${t.titulo}/fila ${fi + 1}/col ${t.columnas[ci]?.etiqueta ?? ci}`;
        if (manualUbic.has(ubic)) return;
        total++;
        if (apareceEn(cel, universo)) respaldadas++;
        else if (sinRespaldo.length < 50) sinRespaldo.push({ ubicacion: ubic, valor: cel });
      });
    });
  }

  // 2) Cambios manuales: valor_original debe existir en el snapshot (si es numérico).
  for (const c of spec.cambios_manuales) {
    if (esNum(c.valor_original) && !apareceEn(c.valor_original, universo)) {
      contradicciones.push({ ubicacion: c.ubicacion, etiqueta: c.etiqueta, valor_original: c.valor_original, detalle: "El valor_original declarado no aparece en las fuentes del sistema; no puede afirmarse que provino del sistema." });
    }
  }

  return {
    ok: contradicciones.length === 0,
    contradicciones,
    respaldo: { total_cifras: total, respaldadas, sin_respaldo: total - respaldadas },
    sin_respaldo_muestra: sinRespaldo,
    manuales: spec.cambios_manuales.length,
  };
}

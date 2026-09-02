// IA SIM · Bloque 4C — Formateo de valores por UNIDAD, consistente con el
// grounding del 4A: los minutos NUNCA se muestran como horas; pesos, dólares,
// porcentajes, horas y minutos conservan su unidad. Se usa para el render visual
// (PDF/DOCX/PNG). En Excel/CSV los números se exportan TIPADOS (ver valorTipado).

import type { CeldaValor, ColumnaTabla } from "@/lib/ia/informes/schema";
import type { TipoColumna } from "@/lib/ia/informes/limites";

const esNum = (v: CeldaValor): v is number => typeof v === "number" && Number.isFinite(v);

function nAR(n: number, dec = 0): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Minutos → "191 h" o "191 h 30 min" (nunca "11.460 horas").
export function minutosAHoras(min: number): string {
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.round(Math.abs(min) % 60);
  const s = min < 0 ? "-" : "";
  return m === 0 ? `${s}${nAR(h)} h` : `${s}${nAR(h)} h ${m} min`;
}

// Valor para PANTALLA (string ya formateado con su unidad).
export function formatearCelda(valor: CeldaValor, tipo: TipoColumna): string {
  if (valor == null) return "—";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  switch (tipo) {
    case "entero": return esNum(valor) ? nAR(Math.round(valor)) : String(valor);
    case "decimal": return esNum(valor) ? nAR(valor, 2) : String(valor);
    case "ars": return esNum(valor) ? `$ ${nAR(valor, 2)}` : String(valor);
    case "usd": return esNum(valor) ? `US$ ${valor.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(valor);
    case "porcentaje": return esNum(valor) ? `${nAR(valor, valor % 1 === 0 ? 0 : 1)} %` : String(valor);
    case "horas": return esNum(valor) ? `${nAR(valor, valor % 1 === 0 ? 0 : 1)} h` : String(valor);
    case "minutos": return esNum(valor) ? `${nAR(Math.round(valor))} min` : String(valor);
    case "fecha": return String(valor);
    case "texto":
    default: return String(valor);
  }
}

// Valor TIPADO para Excel/CSV: número puro cuando corresponde (no se guarda como
// texto sin motivo). Devuelve { v, z } con el código de formato numérico de la celda.
export function valorTipado(valor: CeldaValor, tipo: TipoColumna): { v: CeldaValor; z?: string } {
  if (valor == null) return { v: null };
  if (!esNum(valor)) return { v: valor };
  switch (tipo) {
    case "entero": return { v: valor, z: "#,##0" };
    case "decimal": return { v: valor, z: "#,##0.00" };
    case "ars": return { v: valor, z: "[$$-es-AR] #,##0.00" };
    case "usd": return { v: valor, z: "[$US$-en-US] #,##0.00" };
    case "porcentaje": return { v: valor / 100, z: "0.0%" }; // Excel usa fracción
    case "horas": return { v: valor, z: "#,##0.0" };
    case "minutos": return { v: valor, z: "#,##0" };
    default: return { v: valor };
  }
}

// Etiqueta corta de la unidad (para leyendas de gráficos y encabezados).
export function unidadDe(tipo: TipoColumna): string {
  switch (tipo) {
    case "ars": return "$";
    case "usd": return "US$";
    case "porcentaje": return "%";
    case "horas": return "h";
    case "minutos": return "min";
    default: return "";
  }
}

// Formatea una fila completa para pantalla.
export function formatearFila(fila: CeldaValor[], columnas: ColumnaTabla[]): string[] {
  return columnas.map((c, i) => formatearCelda(fila[i] ?? null, c.tipo));
}

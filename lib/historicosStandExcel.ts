// Lectura de un libro de Excel histórico del stand con la librería xlsx.
// Separado de lib/historicosStand.ts para que la API (servidor) pueda validar
// lotes sin arrastrar xlsx a su bundle.

import * as XLSX from "xlsx";
import type { HojaExcel } from "@/lib/historicosStand";

export function leerHojasExcel(datos: ArrayBuffer | Uint8Array): HojaExcel[] {
  const workbook = XLSX.read(datos instanceof Uint8Array ? datos : new Uint8Array(datos), {
    type: "array",
    cellDates: true,
  });

  return workbook.SheetNames.map((nombre) => {
    const sheet = workbook.Sheets[nombre];
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    // Fechas de calendario escritas en el libro (p. ej. la hoja AFLUENCIAS de las
    // plantillas). Las horas sueltas de Excel llegan como fechas de 1899 y no cuentan.
    const fechas: Date[] = [];
    for (const celda of Object.keys(sheet)) {
      if (celda.startsWith("!")) continue;
      const v = (sheet[celda] as XLSX.CellObject).v;
      if (v instanceof Date && v.getFullYear() >= 2000) fechas.push(v);
    }
    return { nombre, filas, fechas };
  });
}

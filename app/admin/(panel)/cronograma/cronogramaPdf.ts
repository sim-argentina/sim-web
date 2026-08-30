import { jsPDF } from "jspdf";

// Generador CLIENT-SIDE del PDF del cronograma confirmado (patrón del proyecto:
// jspdf ya presente; el servidor entrega los datos validados y confirmados vía
// /api/admin/cronograma/pdf-data, el cliente solo renderiza). No incluye cobertura
// de Ramiro, ni horas, ni auditoría: solo las jornadas cargadas manualmente.

type PdfJornada = { nombre: string; hora_inicio: string; hora_fin: string };
type PdfDia = { fecha: string; cerrado: boolean; apertura: string; cierre: string; jornadas: PdfJornada[] };
export type PdfData = {
  anio: number;
  mes: number;
  generado_at: string;
  apertura_default: string;
  cierre_default: string;
  dias: PdfDia[];
};

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const ROJO: [number, number, number] = [220, 38, 38];
const NEGRO: [number, number, number] = [17, 17, 17];
const TINTA: [number, number, number] = [40, 40, 40];
const GRIS: [number, number, number] = [130, 130, 130];
const LINEA: [number, number, number] = [210, 210, 210];

const pad = (n: number) => String(n).padStart(2, "0");
const fechaStr = (a: number, m: number, d: number) => `${a}-${pad(m)}-${pad(d)}`;
const diasEnMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const primerDiaSemana = (a: number, m: number) => (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7; // Lun=0

export function nombreArchivoPdf(data: PdfData): string {
  return `cronograma-sim-${MESES[data.mes - 1].toLowerCase()}-${data.anio}.pdf`;
}

// Descarga el PDF en el navegador (jspdf `save`).
export function descargarCronogramaPdf(data: PdfData): void {
  construirCronogramaPdf(data).save(nombreArchivoPdf(data));
}

// Construye el documento (reutilizable para test/render visual). No descarga.
export function construirCronogramaPdf(data: PdfData): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;

  const porFecha = new Map<string, PdfDia>();
  for (const d of data.dias) porFecha.set(d.fecha, d);

  // ── Encabezado ──────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ROJO);
  doc.setFontSize(9);
  doc.text("SIM ARGENTINA", M, M + 6);
  doc.setTextColor(...NEGRO);
  doc.setFontSize(20);
  doc.text(`${MESES[data.mes - 1]} ${data.anio}`, M, M + 30);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRIS);
  doc.setFontSize(9);
  doc.text("Cronograma confirmado", M, M + 45);

  // ── Grilla ──────────────────────────────────────────────────────────────────
  const headerH = 58;
  const footerH = 30;
  const gridTop = M + headerH;
  const gridBottom = H - M - footerH;
  const colW = (W - 2 * M) / 7;
  const weekdayH = 16;
  const filas = 6;
  const rowH = (gridBottom - gridTop - weekdayH) / filas;

  // Encabezado de días de la semana.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  for (let c = 0; c < 7; c++) {
    const x = M + c * colW;
    doc.setFillColor(...NEGRO);
    doc.rect(x, gridTop, colW, weekdayH, "F");
    doc.text(DIAS_SEMANA[c], x + 4, gridTop + 11);
  }

  const offset = primerDiaSemana(data.anio, data.mes);
  const totalDias = diasEnMes(data.anio, data.mes);
  const yGrid = gridTop + weekdayH;

  for (let r = 0; r < filas; r++) {
    for (let c = 0; c < 7; c++) {
      const x = M + c * colW;
      const y = yGrid + r * rowH;
      const dayNum = r * 7 + c - offset + 1;
      const enMes = dayNum >= 1 && dayNum <= totalDias;

      // Borde de celda.
      doc.setDrawColor(...LINEA);
      doc.setLineWidth(0.5);
      doc.rect(x, y, colW, rowH);

      if (!enMes) {
        // Días de otros meses: se omiten (celda vacía, discretamente marcada).
        doc.setFillColor(247, 247, 247);
        doc.rect(x + 0.5, y + 0.5, colW - 1, rowH - 1, "F");
        continue;
      }

      const fecha = fechaStr(data.anio, data.mes, dayNum);
      const dia = porFecha.get(fecha);

      // Número de día.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...NEGRO);
      doc.text(String(dayNum), x + 4, y + 12);

      if (dia?.cerrado) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...ROJO);
        doc.text("CERRADO", x + 4, y + 26);
        continue;
      }

      // Horario operativo especial (si difiere del predeterminado).
      let cursorY = y + 24;
      if (dia && (dia.apertura !== data.apertura_default || dia.cierre !== data.cierre_default)) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(6.5);
        doc.setTextColor(...GRIS);
        doc.text(`Horario ${dia.apertura}–${dia.cierre}`, x + 4, cursorY);
        cursorY += 9;
      }

      // Jornadas manuales.
      const jornadas = dia?.jornadas ?? [];
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...TINTA);
      for (const j of jornadas) {
        if (cursorY > y + rowH - 5) break; // no desbordar la celda
        const linea = `${j.nombre} ${j.hora_inicio}–${j.hora_fin}`;
        doc.text(doc.splitTextToSize(linea, colW - 8)[0], x + 4, cursorY);
        cursorY += 10;
      }
    }
  }

  // ── Pie ─────────────────────────────────────────────────────────────────────
  const gen = new Date(data.generado_at);
  const genTxt = gen.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...GRIS);
  doc.text("Este documento muestra únicamente las jornadas cargadas manualmente.", M, H - M - 8);
  doc.text(`SIM Argentina · Generado el ${genTxt}`, W - M, H - M - 8, { align: "right" });

  return doc;
}

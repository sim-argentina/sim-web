// Generadores de informe empresarial (cliente): PDF presentable + Excel granular.
// Se arman on-demand desde el dataset de /api/admin/empresas/campanias/[id]/informe.
// No guardan binarios en DB. Branding SIM (negro/rojo/blanco).
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

// Paleta SIM: negro estructural, rojo de acento, blanco de contraste. Grises discretos.
const ROJO: [number, number, number] = [220, 38, 38];
const NEGRO: [number, number, number] = [17, 17, 17];
const TINTA: [number, number, number] = [30, 30, 30];
const GRIS: [number, number, number] = [120, 120, 120];
const LINEA: [number, number, number] = [225, 225, 225];
const money = (n: unknown) => `$${Number(n || 0).toLocaleString("es-AR")}`;

// Minutos SIEMPRE; con equivalente en horas cuando aporta (>= 60 min). Ej: 375 min (6 h 15 min).
function duracionLegible(n: unknown): string {
  const m = Math.max(0, Math.round(Number(n) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${m} min (${h} h${r ? ` ${r} min` : ""})`;
}
// Fecha DD/MM/AAAA desde 'AAAA-MM-DD' (sin flechas ni caracteres fuera de Latin-1, sin tz).
function fechaCorta(iso: unknown): string {
  const s = String(iso ?? "").slice(0, 10);
  const [y, mo, d] = s.split("-");
  return d && mo && y ? `${d}/${mo}/${y}` : "—";
}
function rangoVigencia(a: unknown, b: unknown): string {
  const ini = fechaCorta(a), fin = fechaCorta(b);
  if (ini === "—" && fin === "—") return "—";
  return `${ini} al ${fin}`;
}
// "Generado": DD/MM/AAAA · HH:MM en hora local (el PDF lo arma el cliente, en AR).
function generadoLegible(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} · ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador", pendiente_pago: "Pendiente de pago", programada: "Programada",
  activa: "Activa", vencida: "Vencida", finalizada: "Finalizada", cancelada: "Cancelada",
};
const estadoLabel = (e: unknown) =>
  ESTADO_LABEL[String(e ?? "")] ?? (String(e ?? "") ? String(e).charAt(0).toUpperCase() + String(e).slice(1) : "—");
const modalidadLabel = (m: unknown) => (m === "mensual" ? "Pack mensual (30 días)" : "Compra única (60 días)");
// Campaña OPCIONAL → fallback de presentación limpio (nunca null/vacío/"-"/"Sin campaña").
const tituloCampania = (c: CampaniaInf) => String(c.nombre_campania ?? "").trim() || "Beneficio empresarial";

type CampaniaInf = {
  empresa?: string; nombre_campania?: string | null; modalidad?: string;
  fecha_inicio?: string | null; fecha_vencimiento?: string | null; duracion_minutos?: number;
  neto?: number; iva?: number; total?: number; precio_neto?: number; precio_total?: number;
  [k: string]: unknown;
};
type MetricasInf = { [k: string]: number | string | undefined };
type CodigoInf = { id?: string; codigo?: string; estado?: string; estado_efectivo?: string; usos_actuales?: number; usos_maximos?: number; created_at?: string };
type ReservaInf = { fecha?: string; hora?: string; duracion_minutos?: number; simuladores?: string[]; estado?: string; no_show?: boolean } | null;
type UsoInf = {
  codigo_id?: string; beneficiario_nombre?: string | null; beneficiario_apellido?: string | null;
  beneficiario_telefono?: string | null; beneficiario_email?: string | null; reserva_id?: number | null; estado?: string; created_at?: string;
  reserva?: ReservaInf;
};
export type InformeData = {
  tipo: "parcial" | "definitivo";
  generado_at: string;
  campania: CampaniaInf;
  metricas: MetricasInf;
  codigos: CodigoInf[];
  usos: UsoInf[];
  simuladores?: Array<{ nombre: string; usos: number }>;
  evolucion: Array<{ fecha: string; canjes: number }>;
};

// Estado legible de la reserva de un uso (para informes).
function estadoUso(u: UsoInf): string {
  const r = u.reserva;
  if (r) return r.no_show ? "No-show" : r.estado === "cancelada" ? "Cancelada" : r.estado === "activa" ? "Reservada" : String(r.estado || "");
  return u.estado === "cancelado" ? "Cancelado" : "Sin reserva";
}
const simsDe = (u: UsoInf) => Array.isArray(u.reserva?.simuladores) ? u.reserva!.simuladores!.join(", ") : "—";
const reservaTxt = (u: UsoInf) => u.reserva ? `${u.reserva.fecha ?? ""} ${u.reserva.hora ?? ""}`.trim() || "—" : "—";

function nombreArchivo(d: InformeData, ext: string) {
  const emp = String(d.campania.empresa || "empresa").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `informe-${emp}-${d.tipo}-${d.generado_at.slice(0, 10)}.${ext}`;
}

// Mapa codigo_id → código (para el detalle por persona).
function codigoDeUso(d: InformeData, uso: UsoInf): string {
  return d.codigos.find((c) => c.id === uso.codigo_id)?.codigo ?? "—";
}

// ── PDF ───────────────────────────────────────────────────────────────────────
export function generarInformePDF(d: InformeData) {
  const doc = new jsPDF();
  const c = d.campania;
  const m = d.metricas;
  const W = doc.internal.pageSize.getWidth();
  const M = 14;              // margen lateral
  const CW = W - M * 2;      // ancho de contenido

  // ── Encabezado NEGRO: la EMPRESA es la protagonista ─────────────────────────
  const HDR = 44;
  doc.setFillColor(...NEGRO);
  doc.rect(0, 0, W, HDR, "F");
  doc.setFillColor(...ROJO);          // filo de acento rojo
  doc.rect(0, HDR, W, 1.2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("SIM ARGENTINA", M, 13);
  doc.setTextColor(...ROJO);          // tipo de informe con acento rojo
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(d.tipo === "definitivo" ? "INFORME DEFINITIVO" : "INFORME PARCIAL", W - M, 13, { align: "right" });

  doc.setTextColor(...ROJO);
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
  doc.text("EMPRESA", M, 24);
  doc.setTextColor(255, 255, 255);    // nombre de la empresa, grande
  doc.setFont("helvetica", "bold"); doc.setFontSize(19);
  doc.text(String(c.empresa ?? "").trim() || "—", M, 33);
  doc.setTextColor(205, 205, 205);    // campaña (o fallback) en menor jerarquía
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
  doc.text(tituloCampania(c), M, 40.5);

  // ── Metadata (cuerpo blanco) ────────────────────────────────────────────────
  let y = HDR + 9;
  doc.setFontSize(9);
  const metaLinea = (label: string, valor: string) => {
    doc.setFont("helvetica", "bold"); doc.setTextColor(...TINTA);
    doc.text(label, M, y);
    doc.setFont("helvetica", "normal"); doc.setTextColor(70, 70, 70);
    doc.text(valor, M + 26, y);
    y += 5.1;
  };
  metaLinea("Modalidad", modalidadLabel(c.modalidad));
  metaLinea("Vigencia", rangoVigencia(c.fecha_inicio, c.fecha_vencimiento));
  metaLinea("Estado", estadoLabel(m.estado).toUpperCase());
  metaLinea("Generado", generadoLegible(d.generado_at));

  // ── Resumen ejecutivo: título + tira de KPIs (sin duplicarlo en tabla) ───────
  y += 2;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...NEGRO);
  doc.text("Resumen ejecutivo", M, y);
  doc.setFillColor(...ROJO); doc.rect(M, y + 1.8, 26, 0.8, "F");   // subrayado de acento
  y += 6;
  const kpis: Array<{ label: string; valor: string; acento?: boolean }> = [
    { label: "CONTRATADO", valor: String(m.turnos_contratados) },
    { label: "UTILIZADO", valor: String(m.utilizados) },
    { label: "RESTANTE", valor: String(m.turnos_restantes) },
    { label: "% UTILIZACIÓN", valor: `${m.pctUtilizacion}%`, acento: true },
  ];
  const gap = 3;
  const cw = (CW - gap * (kpis.length - 1)) / kpis.length;
  const kh = 18;
  kpis.forEach((k, i) => {
    const x = M + i * (cw + gap);
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.3); doc.setFillColor(250, 250, 250);
    doc.roundedRect(x, y, cw, kh, 1.6, 1.6, "FD");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...GRIS);
    doc.text(k.label, x + cw / 2, y + 5.5, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.setTextColor(...(k.acento ? ROJO : NEGRO));
    doc.text(k.valor, x + cw / 2, y + 14, { align: "center" });
  });
  y += kh + 4.5;

  // Equivalencia en minutos/horas (precisión) debajo de los KPIs.
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110, 110, 110);
  doc.text(
    `Contratado: ${duracionLegible(m.minutos_contratados)}   ·   Utilizado: ${duracionLegible(m.minutos_utilizados)}   ·   Restante: ${duracionLegible(m.minutos_restantes)}`,
    M, y,
  );
  y += 5;

  // ── Estilo común de las tablas (cabecera negra, cuerpo blanco, líneas discretas) ─
  const dosCol = {
    theme: "grid" as const,
    headStyles: { fillColor: NEGRO, textColor: 255 as const, fontStyle: "bold" as const, fontSize: 9.5 },
    styles: { fontSize: 9, textColor: TINTA, lineColor: LINEA, lineWidth: 0.1, cellPadding: 1.4 },
    columnStyles: { 0: { cellWidth: 64, textColor: [70, 70, 70] as [number, number, number] }, 1: { fontStyle: "bold" as const } },
    margin: { left: M, right: M, bottom: 20 },
  };

  autoTable(doc, {
    startY: y,
    head: [["Condiciones comerciales", ""]],
    body: [
      ["Modalidad", modalidadLabel(c.modalidad)],
      ["Cantidad contratada", `${m.turnos_contratados} experiencias`],
      ["Duración por experiencia", duracionLegible(c.duracion_minutos)],
      ["Neto", money(c.neto ?? c.precio_neto)],
      ["IVA", money(c.iva)],
      ["Total", money(c.total ?? c.precio_total)],
    ],
    ...dosCol,
  });

  autoTable(doc, {
    head: [["Estado de utilización", ""]],
    body: [
      ["Códigos generados", String(m.generados)],
      ["Usados", String(m.utilizados)],
      ["Disponibles", String(m.disponibles)],
      ["Vencidos", String(m.vencidos)],
      ["Cancelados", String(m.cancelados)],
      ["Personas que usaron el beneficio", String(d.usos.length)],
    ],
    ...dosCol,
  });

  // Distribución por simulador (de reservas reales).
  if (d.simuladores && d.simuladores.length) {
    autoTable(doc, {
      head: [
        [{ content: "Distribución por simulador", colSpan: 3, styles: { halign: "left" as const } }],
        ["Simulador", "Usos", "%"],
      ],
      body: d.simuladores.map((s) => {
        const totalUsos = d.usos.filter((u) => u.reserva).length || 1;
        return [s.nombre, String(s.usos), `${Math.round((s.usos / totalUsos) * 100)}%`];
      }),
      theme: "grid",
      headStyles: { fillColor: NEGRO, textColor: 255, fontStyle: "bold", fontSize: 9.5 },
      styles: { fontSize: 9, textColor: TINTA, lineColor: LINEA, lineWidth: 0.1, cellPadding: 1.4 },
      margin: { left: M, right: M, bottom: 20 },
    });
  }

  // Detalle de utilización (sin DNI, teléfono, email ni datos de pago — informe externo).
  if (d.usos.length) {
    autoTable(doc, {
      head: [
        [{ content: "Detalle de utilización", colSpan: 7, styles: { halign: "left" as const } }],
        ["Nombre", "Apellido", "Código", "Reserva", "Duración", "Simuladores", "Estado"],
      ],
      body: d.usos.map((u) => [
        u.beneficiario_nombre || "—", u.beneficiario_apellido || "—",
        codigoDeUso(d, u), reservaTxt(u), u.reserva?.duracion_minutos ? `${u.reserva.duracion_minutos} min` : "—",
        simsDe(u), estadoUso(u),
      ]),
      theme: "striped",
      headStyles: { fillColor: NEGRO, textColor: 255, fontStyle: "bold", fontSize: 8.5 },
      styles: { fontSize: 8, textColor: TINTA, lineColor: LINEA, lineWidth: 0.1, cellPadding: 1.4 },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      margin: { left: M, right: M, bottom: 20 },
    });
  }

  // ── Pie: franja inferior negra, texto discreto ──────────────────────────────
  const H = doc.internal.pageSize.getHeight();
  doc.setFillColor(...NEGRO);
  doc.rect(0, H - 14, W, 14, "F");
  doc.setTextColor(235, 235, 235);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("SIM Argentina", M, H - 8.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(150, 150, 150);
  doc.text("Informe generado automáticamente", M, H - 4);

  doc.save(nombreArchivo(d, "pdf"));
}

// ── Excel ─────────────────────────────────────────────────────────────────────
export function generarInformeExcel(d: InformeData) {
  const c = d.campania;
  const m = d.metricas;
  const wb = XLSX.utils.book_new();

  const resumen = [
    ["Empresa", c.empresa],
    ["Campaña", tituloCampania(c)],
    ["Modalidad", c.modalidad === "mensual" ? "Pack mensual" : "Compra única"],
    ["Inicio", c.fecha_inicio], ["Vencimiento", c.fecha_vencimiento],
    ["Contratado", m.turnos_contratados], ["Utilizado", m.utilizados], ["Restante", m.turnos_restantes],
    ["Vencidos", m.vencidos], ["Cancelados", m.cancelados], ["% utilización", `${m.pctUtilizacion}%`],
    ["Minutos contratados", m.minutos_contratados], ["Minutos utilizados", m.minutos_utilizados],
    ["Neto", c.neto ?? c.precio_neto], ["IVA", c.iva], ["Total", c.total ?? c.precio_total],
    ["Tipo de informe", d.tipo], ["Generado", d.generado_at],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), "Resumen");

  const codigos = d.codigos.map((cod) => ({
    Código: cod.codigo, Estado: cod.estado_efectivo || cod.estado,
    "Fecha creación": String(cod.created_at || "").slice(0, 10),
    Inicio: c.fecha_inicio, Vencimiento: c.fecha_vencimiento,
    Usos: `${cod.usos_actuales}/${cod.usos_maximos}`,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(codigos.length ? codigos : [{ Código: "" }]), "Códigos");

  const uso = d.usos.map((u) => ({
    Nombre: u.beneficiario_nombre || "", Apellido: u.beneficiario_apellido || "",
    Código: codigoDeUso(d, u),
    Fecha: u.reserva?.fecha || "", Hora: u.reserva?.hora || "",
    "Duración (min)": u.reserva?.duracion_minutos ?? "",
    Simuladores: Array.isArray(u.reserva?.simuladores) ? u.reserva!.simuladores!.join(", ") : "",
    Estado: estadoUso(u),
    "No-show": u.reserva?.no_show ? "sí" : "",
  }));
  // El nombre de hoja no puede contener "/" (Excel lo rechaza).
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(uso.length ? uso : [{ Nombre: "" }]), "Uso y reservas");

  XLSX.writeFile(wb, nombreArchivo(d, "xlsx"));
}

// Exportar SOLO los códigos (para reposición de archivo, sin generar nuevos).
export function exportarCodigosExcel(campania: CampaniaInf, codigos: CodigoInf[]) {
  const wb = XLSX.utils.book_new();
  const rows = codigos.map((c) => ({
    Empresa: campania.empresa, Campaña: tituloCampania(campania),
    Código: c.codigo, Estado: c.estado_efectivo || c.estado,
    Inicio: campania.fecha_inicio, Vencimiento: campania.fecha_vencimiento,
    "Duración (min)": campania.duracion_minutos,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Código: "" }]), "Códigos");
  const emp = String(campania.empresa || "empresa").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  XLSX.writeFile(wb, `codigos-${emp}.xlsx`);
}

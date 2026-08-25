// Generadores de informe empresarial (cliente): PDF presentable + Excel granular.
// Se arman on-demand desde el dataset de /api/admin/empresas/campanias/[id]/informe.
// No guardan binarios en DB. Branding SIM (negro/rojo/blanco).
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const ROJO: [number, number, number] = [220, 38, 38];
const money = (n: unknown) => `$${Number(n || 0).toLocaleString("es-AR")}`;
const min = (n: unknown) => `${Number(n || 0)} min`;

type CampaniaInf = {
  empresa?: string; nombre_campania?: string; modalidad?: string;
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

  // Encabezado
  doc.setFillColor(...ROJO);
  doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15); doc.setFont("helvetica", "bold");
  doc.text("SIM ARGENTINA", 14, 14);
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text(`Informe ${d.tipo === "definitivo" ? "definitivo" : "parcial"}`, W - 14, 14, { align: "right" });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text(`${c.empresa} — ${c.nombre_campania}`, 14, 32);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  const periodo = `${c.fecha_inicio || "—"} → ${c.fecha_vencimiento || "—"}`;
  doc.text(`Modalidad: ${c.modalidad === "mensual" ? "Pack mensual (30 días)" : "Compra única (60 días)"}  ·  Período: ${periodo}`, 14, 38);
  doc.text(`Generado: ${new Date(d.generado_at).toLocaleString("es-AR")}`, 14, 43);

  // Resumen ejecutivo
  autoTable(doc, {
    startY: 49,
    head: [["Resumen ejecutivo", ""]],
    body: [
      ["Contratado", `${m.turnos_contratados} experiencias (${min(m.minutos_contratados)})`],
      ["Utilizado", `${m.utilizados} (${min(m.minutos_utilizados)})`],
      ["Restante", `${m.turnos_restantes} (${min(m.minutos_restantes)})`],
      ["Vencidos / Cancelados", `${m.vencidos} / ${m.cancelados}`],
      ["% de utilización", `${m.pctUtilizacion}%`],
      ["Estado", String(m.estado).toUpperCase()],
    ],
    theme: "grid",
    headStyles: { fillColor: ROJO, textColor: 255 },
    styles: { fontSize: 9 },
  });

  // Datos económicos
  autoTable(doc, {
    head: [["Contratación", ""]],
    body: [["Neto", money(c.neto ?? c.precio_neto)], ["IVA", money(c.iva)], ["Total", money(c.total ?? c.precio_total)]],
    theme: "grid", headStyles: { fillColor: ROJO, textColor: 255 }, styles: { fontSize: 9 },
  });

  // Uso general
  autoTable(doc, {
    head: [["Uso general", ""]],
    body: [
      ["Códigos generados", String(m.generados)],
      ["Usados", String(m.utilizados)],
      ["Disponibles", String(m.disponibles)],
      ["Vencidos", String(m.vencidos)],
      ["Cancelados", String(m.cancelados)],
      ["Personas que usaron el beneficio", String(d.usos.length)],
    ],
    theme: "grid", headStyles: { fillColor: ROJO, textColor: 255 }, styles: { fontSize: 9 },
  });

  // Distribución por simulador (de reservas reales).
  if (d.simuladores && d.simuladores.length) {
    autoTable(doc, {
      head: [["Simulador", "Usos", "%"]],
      body: d.simuladores.map((s) => {
        const totalUsos = d.usos.filter((u) => u.reserva).length || 1;
        return [s.nombre, String(s.usos), `${Math.round((s.usos / totalUsos) * 100)}%`];
      }),
      theme: "grid", headStyles: { fillColor: ROJO, textColor: 255 }, styles: { fontSize: 9 },
    });
  }

  // Detalle por persona (sin DNI, teléfono, email ni datos de pago — informe externo).
  if (d.usos.length) {
    autoTable(doc, {
      head: [["Nombre", "Apellido", "Código", "Reserva", "Duración", "Simuladores", "Estado"]],
      body: d.usos.map((u) => [
        u.beneficiario_nombre || "—", u.beneficiario_apellido || "—",
        codigoDeUso(d, u), reservaTxt(u), u.reserva?.duracion_minutos ? `${u.reserva.duracion_minutos}m` : "—",
        simsDe(u), estadoUso(u),
      ]),
      theme: "striped", headStyles: { fillColor: ROJO, textColor: 255 }, styles: { fontSize: 8 },
    });
  }

  // Pie
  const H = doc.internal.pageSize.getHeight();
  doc.setFontSize(8); doc.setTextColor(140, 140, 140);
  doc.text("SIM Argentina · Informe generado automáticamente", 14, H - 8);

  doc.save(nombreArchivo(d, "pdf"));
}

// ── Excel ─────────────────────────────────────────────────────────────────────
export function generarInformeExcel(d: InformeData) {
  const c = d.campania;
  const m = d.metricas;
  const wb = XLSX.utils.book_new();

  const resumen = [
    ["Empresa", c.empresa],
    ["Campaña", c.nombre_campania],
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(uso.length ? uso : [{ Nombre: "" }]), "Uso / Reservas");

  XLSX.writeFile(wb, nombreArchivo(d, "xlsx"));
}

// Exportar SOLO los códigos (para reposición de archivo, sin generar nuevos).
export function exportarCodigosExcel(campania: CampaniaInf, codigos: CodigoInf[]) {
  const wb = XLSX.utils.book_new();
  const rows = codigos.map((c) => ({
    Empresa: campania.empresa, Campaña: campania.nombre_campania,
    Código: c.codigo, Estado: c.estado_efectivo || c.estado,
    Inicio: campania.fecha_inicio, Vencimiento: campania.fecha_vencimiento,
    "Duración (min)": campania.duracion_minutos,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Código: "" }]), "Códigos");
  const emp = String(campania.empresa || "empresa").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  XLSX.writeFile(wb, `codigos-${emp}.xlsx`);
}

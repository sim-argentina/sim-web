"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Vista = "reservas" | "stand";

type Reserva = {
  id: number;
  created_at: string;
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[];
  cantidad_turnos: number;
  total: number;
  estado: string;
};

type TurnoStand = {
  id?: number;
  created_at?: string;
  fecha: string;
  hora_bajada?: string;
  hora_subida?: string;
  hora_tomado?: string;
  simulador?: string;
  cantidad_simuladores?: number;
  cantidad_turnos?: number;
  duracion?: number | string;
  personas?: number | string;
  metodo_pago?: string;
  posnet?: string;
  total?: number | string;
  monto?: number | string;
};

type ChartItem = {
  label: string;
  value: number;
};

type QuickPeriod = "hoy" | "semana" | "mes" | "anio" | "todo" | "personalizado";

const STORAGE_KEY = "sim_metricas_excel_stand_v6";

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function numberValue(value: any) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;

  return (
    Number(
      String(value)
        .replace("$", "")
        .replace(/\./g, "")
        .replace(",", ".")
        .trim()
    ) || 0
  );
}

function normalizeText(value: any) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

function parseFechaLocal(fecha: string) {
  if (!fecha) return null;
  const parts = fecha.split("-");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeek(date: Date) {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  return d;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31);
}

function excelTimeToString(value: any) {
  if (!value) return "";

  if (value instanceof Date) {
    return value.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return String(value);
}

function monthFromFileName(fileName: string) {
  const name = normalizeText(fileName);

  const months: Record<string, string> = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    setiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };

  for (const key of Object.keys(months)) {
    if (name.includes(key)) return months[key];
  }

  return String(new Date().getMonth() + 1).padStart(2, "0");
}


function normalizarMetodoPago(value: any) {
  const v = normalizeText(value);

  if (!v) return "";
  if (v.includes("qr") || v.includes("mp") || v.includes("mercado")) return "QR";
  if (v === "ef" || v.includes("efectivo") || v.includes("cash")) return "EFECTIVO";
  if (v.includes("deb")) return "DÉBITO";
  if (v.includes("cred") || v.includes("credito")) return "CRÉDITO";
  if (v.includes("transf") || v.includes("transferencia")) return "TRANSFERENCIA";

  return v.toUpperCase();
}

function obtenerEscuderias(value: any) {
  const v = normalizeText(value);
  const escuderias: string[] = [];

  if (v.includes("ferrari")) escuderias.push("Ferrari");
  if (v.includes("red bull") || v.includes("redbull")) escuderias.push("Red Bull");
  if (v.includes("alpine")) escuderias.push("Alpine");
  if (v.includes("mclaren") || v.includes("mc laren")) escuderias.push("McLaren");

  return escuderias;
}

function obtenerHoraAgrupada(value: any) {
  const hora = String(value || "").slice(0, 5);
  if (!hora.includes(":")) return null;

  const h = Number(hora.split(":")[0]);
  if (Number.isNaN(h)) return null;

  return `${String(h).padStart(2, "0")} hs`;
}

function nombreDia(fecha: string) {
  const date = parseFechaLocal(fecha);
  if (!date) return "Sin dato";

  return date.toLocaleDateString("es-AR", {
    weekday: "long",
  });
}

function fechaCorta(fecha: string) {
  const date = parseFechaLocal(fecha);
  if (!date) return fecha || "Sin dato";

  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function fechaConDia(fecha: string) {
  const date = parseFechaLocal(fecha);
  if (!date) return fecha || "Sin dato";

  const dia = date.toLocaleDateString("es-AR", { weekday: "long" });
  const corto = date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

  return `${dia} ${corto}`;
}

function getRowValue(row: any, posiblesNombres: string[]) {
  const entries = Object.entries(row);

  for (const nombre of posiblesNombres) {
    const buscado = normalizeText(nombre);
    const match = entries.find(([key]) => normalizeText(key) === buscado);
    if (match) return match[1];
  }

  for (const nombre of posiblesNombres) {
    const buscado = normalizeText(nombre);
    const match = entries.find(([key]) => normalizeText(key).includes(buscado));
    if (match) return match[1];
  }

  return null;
}

function addToRecord(record: Record<string, number>, key: string | null | undefined, value = 1) {
  if (!key) return;
  record[key] = (record[key] || 0) + value;
}

function estadoEsActivo(value: any) {
  if (value === true) return true;
  if (typeof value === "string") {
    const v = normalizeText(value);
    return v === "true" || v === "verdadero" || v === "si" || v === "sí" || v === "activo" || v === "activa";
  }
  return false;
}

function crearClaveTurno(t: TurnoStand, extra = "") {
  return [
    t.fecha || "",
    extra || "",
    excelTimeToString(t.hora_tomado || ""),
    excelTimeToString(t.hora_subida || ""),
    excelTimeToString(t.hora_bajada || ""),
    numberValue(t.total ?? t.monto),
    normalizarMetodoPago(t.metodo_pago),
    numberValue(t.cantidad_turnos),
    numberValue(t.cantidad_simuladores || t.personas),
  ].join("|");
}

function chartPorHora(data: Record<string, number>) {
  return Object.entries(data)
    .sort((a, b) => Number(a[0].slice(0, 2)) - Number(b[0].slice(0, 2)))
    .map(([label, value]) => ({ label, value }));
}

function chartPorDiaSemana(data: Record<string, number>) {
  const orden = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

  return Object.entries(data)
    .sort((a, b) => orden.indexOf(a[0]) - orden.indexOf(b[0]))
    .map(([label, value]) => ({ label, value }));
}

function toChart(data: Record<string, number>, sortByValue = true): ChartItem[] {
  return Object.entries(data)
    .sort((a, b) => (sortByValue ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .map(([label, value]) => ({ label, value }));
}

function countBy<T>(items: T[], getter: (item: T) => string | number | undefined | null) {
  return items.reduce((acc: Record<string, number>, item) => {
    const key = String(getter(item) || "Sin dato");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sumBy<T>(items: T[], getter: (item: T) => number) {
  return items.reduce((acc, item) => acc + getter(item), 0);
}

function KpiCard({ title, value, subtext }: { title: string; value: string; subtext?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-white/45">{title}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
      {subtext ? <p className="mt-2 text-sm text-white/55">{subtext}</p> : null}
    </div>
  );
}

function BarChart({
  title,
  data,
  valueFormatter,
}: {
  title: string;
  data: ChartItem[];
  valueFormatter?: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <h3 className="mb-5 text-lg font-semibold text-white">{title}</h3>

      {data.length === 0 ? (
        <p className="text-sm text-white/55">Sin datos para este período.</p>
      ) : (
        <div className="space-y-4">
          {data.map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex justify-between gap-4 text-sm">
                <span className="text-white/75">{item.label}</span>
                <span className="font-medium text-white">
                  {valueFormatter ? valueFormatter(item.value) : item.value}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-red-500"
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineChart({
  title,
  data,
  valueFormatter,
}: {
  title: string;
  data: ChartItem[];
  valueFormatter?: (n: number) => string;
}) {
  const width = 900;
  const height = 280;
  const padding = 40;
  const max = Math.max(...data.map((d) => d.value), 1);

  const points = data.map((item, index) => {
    const x =
      data.length === 1
        ? width / 2
        : padding + (index * (width - padding * 2)) / (data.length - 1);

    const y = height - padding - (item.value / max) * (height - padding * 2);

    return { ...item, x, y };
  });

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <h3 className="mb-5 text-lg font-semibold text-white">{title}</h3>

      {data.length === 0 ? (
        <p className="text-sm text-white/55">Sin datos para este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full">
              <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.15)" />
              <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="rgba(255,255,255,0.15)" />
              <polyline
                fill="none"
                stroke="#ef4444"
                strokeWidth="4"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              />
              {points.map((p) => (
                <g key={p.label}>
                  <circle cx={p.x} cy={p.y} r="5" fill="#ef4444" />
                  <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="12" fill="white">
                    {valueFormatter ? valueFormatter(p.value) : p.value}
                  </text>
                  <text x={p.x} y={height - 10} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.7)">
                    {p.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

function PieChart({ title, data }: { title: string; data: ChartItem[] }) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7", "#f97316"];
  let cumulative = 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <h3 className="mb-5 text-lg font-semibold text-white">{title}</h3>

      {data.length === 0 || total === 0 ? (
        <p className="text-sm text-white/55">Sin datos para este período.</p>
      ) : (
        <div className="flex flex-col items-center gap-6">
          <svg width="220" height="220" viewBox="0 0 200 200">
            {data.map((item, i) => {
              const angle = (item.value / total) * 360;
              const startAngle = cumulative;
              cumulative += angle;
              const largeArc = angle > 180 ? 1 : 0;

              const x1 = 100 + 80 * Math.cos((Math.PI * startAngle) / 180);
              const y1 = 100 + 80 * Math.sin((Math.PI * startAngle) / 180);
              const x2 = 100 + 80 * Math.cos((Math.PI * cumulative) / 180);
              const y2 = 100 + 80 * Math.sin((Math.PI * cumulative) / 180);

              return (
                <path
                  key={item.label}
                  d={`M100,100 L${x1},${y1} A80,80 0 ${largeArc},1 ${x2},${y2} Z`}
                  fill={colors[i % colors.length]}
                />
              );
            })}
            <circle cx="100" cy="100" r="38" fill="#050505" />
          </svg>

          <div className="w-full space-y-2">
            {data.map((item, i) => (
              <div key={item.label} className="flex justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                  <span className="text-white/80">{item.label}</span>
                </div>
                <span className="text-white">
                  {item.value} ({((item.value / total) * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminMetricasPage() {
  const [vista, setVista] = useState<Vista>("reservas");

  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [turnosStand, setTurnosStand] = useState<TurnoStand[]>([]);
  const [excelStand, setExcelStand] = useState<TurnoStand[]>([]);

  const [loading, setLoading] = useState(true);
  const [quickPeriod, setQuickPeriod] = useState<QuickPeriod>("mes");
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"todas" | "activa" | "cancelada">("todas");

  const hoy = new Date();
  const [fechaDesde, setFechaDesde] = useState(toInputDate(startOfMonth(hoy)));
  const [fechaHasta, setFechaHasta] = useState(toInputDate(endOfMonth(hoy)));

  useEffect(() => {
    cargarDatos();

    const excelGuardado = localStorage.getItem(STORAGE_KEY);
    if (excelGuardado) {
      try {
        setExcelStand(JSON.parse(excelGuardado));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    const base = new Date();

    if (quickPeriod === "hoy") {
      setFechaDesde(toInputDate(base));
      setFechaHasta(toInputDate(base));
    } else if (quickPeriod === "semana") {
      setFechaDesde(toInputDate(startOfWeek(base)));
      setFechaHasta(toInputDate(endOfWeek(base)));
    } else if (quickPeriod === "mes") {
      setFechaDesde(toInputDate(startOfMonth(base)));
      setFechaHasta(toInputDate(endOfMonth(base)));
    } else if (quickPeriod === "anio") {
      setFechaDesde(toInputDate(startOfYear(base)));
      setFechaHasta(toInputDate(endOfYear(base)));
    } else if (quickPeriod === "todo") {
      setFechaDesde("");
      setFechaHasta("");
    }
  }, [quickPeriod]);

  async function cargarDatos() {
    try {
      setLoading(true);

      const [resReservas, resStand] = await Promise.all([
        fetch("/api/reservas", { cache: "no-store" }),
        fetch("/api/turnos-stand", { cache: "no-store" }),
      ]);

      const reservasJson = await resReservas.json();
      const standJson = await resStand.json();

      setReservas(
        (Array.isArray(reservasJson) ? reservasJson : reservasJson.reservas || []).map((r: Reserva) => ({
          ...r,
          simuladores: normalizeArray(r.simuladores),
        }))
      );

      setTurnosStand(Array.isArray(standJson) ? standJson : standJson.turnos || []);
    } catch (error) {
      console.error(error);
      alert("Error cargando métricas");
    } finally {
      setLoading(false);
    }
  }

  function importarExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);

      const workbook = XLSX.read(data, {
        type: "array",
        cellDates: true,
      });

      const year = new Date().getFullYear();
      const month = monthFromFileName(file.name);
      const turnosImportados: TurnoStand[] = [];
      const claves = new Set<string>();

      workbook.SheetNames.forEach((sheetName) => {
        const dayNumber = Number(sheetName);
        if (!dayNumber || dayNumber < 1 || dayNumber > 31) return;

        const sheet = workbook.Sheets[sheetName];

        const rows: any[] = XLSX.utils.sheet_to_json(sheet, {
          defval: null,
        });

        const day = String(dayNumber).padStart(2, "0");
        const fecha = `${year}-${month}-${day}`;

        rows.forEach((row) => {
          const monto = numberValue(getRowValue(row, ["Monto"]));
          const metodoPago = normalizarMetodoPago(getRowValue(row, ["Metodo de Pago", "Método de Pago", "Pago"]));

          // Punto clave: para que coincida con el resumen del Excel,
          // validamos por Monto + Método de Pago. No usamos Estado porque
          // en algunas filas reales viene vacío o distinto.
          if (!monto || monto <= 0) return;
          if (!metodoPago) return;

          const turno = getRowValue(row, ["Turno"]);
          const numeroTurno = numberValue(turno);
          const escuderia = getRowValue(row, ["Escuderia", "Escudería", "Simulador"]);
          const cantidadSimuladores = numberValue(getRowValue(row, ["Cant. de Sim.", "Cantidad de Sim", "Cant Sim"]));
          const cantidadTurnos = numberValue(getRowValue(row, ["Cant. Turnos", "Cantidad Turnos", "Turnos"]));
          const duracion = numberValue(getRowValue(row, ["Tiempo (Min)", "Tiempo", "Duracion", "Duración"]));

          const turnoParseado: TurnoStand = {
            fecha,
            hora_tomado: excelTimeToString(getRowValue(row, ["Hora que se tomo el turno", "Hora tomado"])),
            hora_subida: excelTimeToString(getRowValue(row, ["Hora de subida", "Hora subida"])),
            hora_bajada: excelTimeToString(getRowValue(row, ["Hora de bajada", "Hora bajada"])),
            simulador: escuderia ? String(escuderia) : "",
            cantidad_simuladores: cantidadSimuladores || 1,
            cantidad_turnos: cantidadTurnos || cantidadSimuladores || 1,
            personas: cantidadSimuladores || 1,
            duracion,
            metodo_pago: metodoPago,
            posnet: "",
            total: monto,
          };

          const clave = crearClaveTurno(turnoParseado, String(numeroTurno || ""));
          if (claves.has(clave)) return;

          claves.add(clave);
          turnosImportados.push(turnoParseado);
        });
      });

      localStorage.removeItem("sim_metricas_excel_stand");
      localStorage.removeItem("sim_excel_stand");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(turnosImportados));
      setExcelStand(turnosImportados);

      const facturacionImportada = turnosImportados.reduce((acc, t) => acc + numberValue(t.total), 0);
      const turnosVendidosImportados = turnosImportados.reduce((acc, t) => acc + numberValue(t.cantidad_turnos), 0);

      alert(
        `Excel importado correctamente.\nVentas: ${turnosImportados.length}\nTurnos vendidos: ${turnosVendidosImportados}\nFacturación: ${formatMoney(facturacionImportada)}`
      );
    };

    reader.readAsArrayBuffer(file);
  }

  function borrarExcelCargado() {
    localStorage.removeItem(STORAGE_KEY);
    setExcelStand([]);
  }

  function filtrarPorFecha<T extends { fecha?: string }>(items: T[]) {
    const desdeDate = fechaDesde ? parseFechaLocal(fechaDesde) : null;
    const hastaDate = fechaHasta ? parseFechaLocal(fechaHasta) : null;
    if (hastaDate) hastaDate.setHours(23, 59, 59, 999);

    return items.filter((item) => {
      const fecha = parseFechaLocal(item.fecha || "");
      if (!fecha) return false;

      return (!desdeDate || fecha >= desdeDate) && (!hastaDate || fecha <= hastaDate);
    });
  }

  const reservasFiltradas = useMemo(() => {
    return filtrarPorFecha(reservas).filter((r) => {
      const coincideEstado = estadoFiltro === "todas" ? true : r.estado === estadoFiltro;
      const texto = `${r.nombre} ${r.telefono} ${r.fecha} ${r.hora} ${r.simuladores.join(" ")}`.toLowerCase();
      return coincideEstado && texto.includes(busqueda.toLowerCase());
    });
  }, [reservas, estadoFiltro, busqueda, fechaDesde, fechaHasta]);

  const standFiltrado = useMemo(() => {
    // Mezclamos Supabase + Excel para poder ver el histórico completo.
    // Si una venta existe en ambos lados, se evita sumarla dos veces con una clave de deduplicación.
    const fuente = [...turnosStand, ...excelStand];
    const claves = new Set<string>();

    const dataSinDuplicados = fuente.filter((t) => {
      const clave = crearClaveTurno(t);
      if (claves.has(clave)) return false;
      claves.add(clave);
      return true;
    });

    return filtrarPorFecha(dataSinDuplicados).filter((t) => {
      const texto = `${t.fecha} ${t.hora_bajada} ${t.hora_subida} ${t.simulador} ${t.metodo_pago}`.toLowerCase();
      return texto.includes(busqueda.toLowerCase());
    });
  }, [turnosStand, excelStand, busqueda, fechaDesde, fechaHasta]);

  const metricasReservas = useMemo(() => {
    const activas = reservasFiltradas.filter((r) => r.estado === "activa");
    const canceladas = reservasFiltradas.filter((r) => r.estado === "cancelada");

    const facturacion = sumBy(activas, (r) => numberValue(r.total));
    const ticketPromedio = activas.length ? facturacion / activas.length : 0;
    const tasaCancelacion = reservasFiltradas.length ? (canceladas.length / reservasFiltradas.length) * 100 : 0;
    const turnosVendidos = sumBy(activas, (r) => numberValue(r.cantidad_turnos));
    const simuladoresUsados = sumBy(activas, (r) => r.simuladores.length);
    const promedioSims = activas.length ? simuladoresUsados / activas.length : 0;
    const ingresoPorTurno = turnosVendidos ? facturacion / turnosVendidos : 0;
    const ingresoPorSimulador = simuladoresUsados ? facturacion / simuladoresUsados : 0;

    const porHora = countBy(reservasFiltradas, (r) => r.hora);
    const porEstado = countBy(reservasFiltradas, (r) => r.estado);
    const porCantidadTurnos = countBy(activas, (r) => `${r.cantidad_turnos} turno/s`);
    const porDia = countBy(reservasFiltradas, (r) => r.fecha);

    const porSimulador: Record<string, number> = {};
    const ingresosPorDia: Record<string, number> = {};
    const ingresosPorSimulador: Record<string, number> = {};

    activas.forEach((r) => {
      ingresosPorDia[r.fecha] = (ingresosPorDia[r.fecha] || 0) + numberValue(r.total);

      r.simuladores.forEach((sim) => {
        porSimulador[sim] = (porSimulador[sim] || 0) + 1;
        ingresosPorSimulador[sim] =
          (ingresosPorSimulador[sim] || 0) + numberValue(r.total) / Math.max(r.simuladores.length, 1);
      });
    });

    const horaPico = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    return {
      total: reservasFiltradas.length,
      activas: activas.length,
      canceladas: canceladas.length,
      facturacion,
      ticketPromedio,
      tasaCancelacion,
      turnosVendidos,
      simuladoresUsados,
      promedioSims,
      ingresoPorTurno,
      ingresoPorSimulador,
      horaPico,
      reservasPorHora: toChart(porHora, false),
      reservasPorEstado: toChart(porEstado),
      reservasPorSimulador: toChart(porSimulador),
      reservasPorCantidadTurnos: toChart(porCantidadTurnos),
      reservasPorDia: toChart(porDia, false).map((i) => ({ ...i, label: i.label.slice(5) })),
      ingresosPorDia: toChart(ingresosPorDia, false).map((i) => ({ ...i, label: i.label.slice(5) })),
      ingresosPorSimulador: toChart(ingresosPorSimulador),
    };
  }, [reservasFiltradas]);

  const metricasStand = useMemo(() => {
    const ventasRegistradas = standFiltrado.length;
    const facturacion = sumBy(standFiltrado, (t) => numberValue(t.total ?? t.monto));

    const totalTurnos = sumBy(standFiltrado, (t) => {
      const cantTurnos = numberValue(t.cantidad_turnos);
      if (cantTurnos > 0) return cantTurnos;

      const sims = numberValue(t.cantidad_simuladores);
      if (sims > 0) return sims;

      return numberValue(t.personas) || 1;
    });

    const ticketPromedio = ventasRegistradas ? facturacion / ventasRegistradas : 0;

    const totalPersonas = sumBy(standFiltrado, (t) => {
      const sims = numberValue(t.cantidad_simuladores) || numberValue(t.personas) || 1;
      const cantTurnos = numberValue(t.cantidad_turnos) || 1;
      return sims * cantTurnos;
    });

    const promedioPersonas = totalTurnos ? totalPersonas / totalTurnos : 0;

    const totalMinutos = sumBy(standFiltrado, (t) => {
      const duracion = numberValue(t.duracion);
      const cantTurnos = numberValue(t.cantidad_turnos) || 1;
      return duracion > 0 ? duracion * cantTurnos : 0;
    });

    const horasVendidas = totalMinutos / 60;
    const ingresoPorMinuto = totalMinutos ? facturacion / totalMinutos : 0;
    const ingresoPorPersona = totalPersonas ? facturacion / totalPersonas : 0;
    const ingresoPromedioPorSimulador = facturacion / 4;

    const porMetodoPago: Record<string, number> = {};
    const porSimulador: Record<string, number> = {};
    const porDuracion: Record<string, number> = {};
    const porPersonas: Record<string, number> = {};
    const porHora: Record<string, number> = {};
    const porDiaSemana: Record<string, number> = {};
    const ingresosPorDia: Record<string, number> = {};
    const ingresosPorMetodo: Record<string, number> = {};

    standFiltrado.forEach((t) => {
      const monto = numberValue(t.total ?? t.monto);
      const metodo = normalizarMetodoPago(t.metodo_pago);
      const duracion = numberValue(t.duracion);
      const sims = numberValue(t.cantidad_simuladores) || numberValue(t.personas) || 1;
      const cantTurnos = numberValue(t.cantidad_turnos) || sims || 1;
      const hora = obtenerHoraAgrupada(t.hora_subida || t.hora_bajada || t.hora_tomado);
      const diaSemana = nombreDia(t.fecha);

      if (metodo) {
        addToRecord(porMetodoPago, metodo, cantTurnos);
        addToRecord(ingresosPorMetodo, metodo, monto);
      }

      addToRecord(ingresosPorDia, t.fecha, monto);
      addToRecord(porHora, hora, cantTurnos);
      addToRecord(porDiaSemana, diaSemana, cantTurnos);

      if (duracion > 0) addToRecord(porDuracion, `${duracion} min`, cantTurnos);
      if (sims > 0) addToRecord(porPersonas, `${sims} persona/s`, cantTurnos);

      obtenerEscuderias(t.simulador).forEach((escuderia) => {
        addToRecord(porSimulador, escuderia, 1);
      });
    });

    const horaPico = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const mejorDiaFecha = Object.entries(ingresosPorDia).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const simuladorMasUsado = Object.entries(porSimulador).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    return {
      ventasRegistradas,
      totalTurnos,
      facturacion,
      ticketPromedio,
      totalPersonas,
      promedioPersonas,
      totalMinutos,
      horasVendidas,
      ingresoPorMinuto,
      ingresoPorPersona,
      ingresoPromedioPorSimulador,
      horaPico,
      mejorDia: mejorDiaFecha ? fechaConDia(mejorDiaFecha) : "-",
      simuladorMasUsado,
      porMetodoPago: toChart(porMetodoPago),
      porSimulador: toChart(porSimulador),
      porDuracion: toChart(porDuracion),
      porPersonas: toChart(porPersonas),
      porHora: chartPorHora(porHora),
      porDia: chartPorDiaSemana(porDiaSemana),
      ingresosPorDia: toChart(ingresosPorDia, false).map((i) => ({
        ...i,
        label: fechaConDia(i.label),
      })),
      ingresosPorMetodo: toChart(ingresosPorMetodo),
    };
  }, [standFiltrado]);

  const rangoTexto = !fechaDesde && !fechaHasta ? "Todo el histórico" : `${fechaDesde || "Inicio"} → ${fechaHasta || "Hoy"}`;

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-sm uppercase tracking-[0.3em] text-red-500">
              Panel administrativo
            </p>
            <h1 className="text-4xl font-bold">Métricas de gestión</h1>
            <p className="mt-2 max-w-2xl text-white/60">
              Compará reservas online y turnos del stand desde una misma pantalla.
            </p>
          </div>

          <button
            onClick={cargarDatos}
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-3 text-sm font-medium text-white transition hover:bg-red-500/20"
          >
            Actualizar datos
          </button>
        </div>

        <div className="mb-6 flex w-fit rounded-2xl border border-white/10 bg-white/[0.04] p-1">
          <button
            onClick={() => setVista("reservas")}
            className={`rounded-xl px-6 py-3 text-sm font-bold ${
              vista === "reservas" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"
            }`}
          >
            Reservas
          </button>

          <button
            onClick={() => setVista("stand")}
            className={`rounded-xl px-6 py-3 text-sm font-bold ${
              vista === "stand" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"
            }`}
          >
            Stand
          </button>
        </div>

        <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="grid gap-4 lg:grid-cols-5">
            <div>
              <label className="mb-2 block text-sm text-white/70">Período rápido</label>
              <select
                value={quickPeriod}
                onChange={(e) => setQuickPeriod(e.target.value as QuickPeriod)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
              >
                <option value="hoy">Hoy</option>
                <option value="semana">Esta semana</option>
                <option value="mes">Este mes</option>
                <option value="anio">Este año</option>
                <option value="todo">Todo</option>
                <option value="personalizado">Personalizado</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/70">Desde</label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => {
                  setQuickPeriod("personalizado");
                  setFechaDesde(e.target.value);
                }}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/70">Hasta</label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => {
                  setQuickPeriod("personalizado");
                  setFechaHasta(e.target.value);
                }}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
              />
            </div>

            {vista === "reservas" ? (
              <div>
                <label className="mb-2 block text-sm text-white/70">Estado</label>
                <select
                  value={estadoFiltro}
                  onChange={(e) => setEstadoFiltro(e.target.value as any)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                >
                  <option value="todas">Todas</option>
                  <option value="activa">Activas</option>
                  <option value="cancelada">Canceladas</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-2 block text-sm text-white/70">Importar Excel</label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={importarExcel}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-red-500"
                />
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm text-white/70">Buscar</label>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar..."
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
              />
            </div>
          </div>

          {vista === "stand" && excelStand.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-green-300">
                Excel cargado y guardado en esta página: <b>{excelStand.length}</b> turnos importados.
              </p>

              <button
                onClick={borrarExcelCargado}
                className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80 hover:bg-black/50"
              >
                Borrar Excel cargado
              </button>
            </div>
          )}

          <div className="mt-4 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="text-sm text-white/50">Rango activo</p>
            <p className="mt-1 text-lg font-semibold text-white">{rangoTexto}</p>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-10 text-center text-white/60">
            Cargando métricas...
          </div>
        ) : vista === "reservas" ? (
          <>
            <div className="mb-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <KpiCard title="Reservas" value={String(metricasReservas.total)} subtext="Según filtros" />
              <KpiCard title="Activas" value={String(metricasReservas.activas)} />
              <KpiCard title="Canceladas" value={String(metricasReservas.canceladas)} />
              <KpiCard title="Facturación" value={formatMoney(metricasReservas.facturacion)} subtext="Solo activas" />
              <KpiCard title="Ticket promedio" value={formatMoney(metricasReservas.ticketPromedio)} />
              <KpiCard title="Cancelación" value={`${metricasReservas.tasaCancelacion.toFixed(1)}%`} />
              <KpiCard title="Turnos vendidos" value={String(metricasReservas.turnosVendidos)} />
              <KpiCard title="Sims usados" value={String(metricasReservas.simuladoresUsados)} />
              <KpiCard title="Prom. sims/reserva" value={metricasReservas.promedioSims.toFixed(2)} />
              <KpiCard title="Ingreso/turno" value={formatMoney(metricasReservas.ingresoPorTurno)} />
              <KpiCard title="Ingreso/simulador" value={formatMoney(metricasReservas.ingresoPorSimulador)} />
              <KpiCard title="Hora pico" value={metricasReservas.horaPico} />
            </div>

            <div className="mb-8">
              <LineChart title="Ingresos por día" data={metricasReservas.ingresosPorDia} valueFormatter={formatMoney} />
            </div>

            <div className="mb-8 grid gap-6 xl:grid-cols-3">
              <PieChart title="Reservas por simulador" data={metricasReservas.reservasPorSimulador} />
              <PieChart title="Estado de reservas" data={metricasReservas.reservasPorEstado} />
              <BarChart title="Reservas por hora" data={metricasReservas.reservasPorHora} />
              <BarChart title="Reservas por cantidad de turnos" data={metricasReservas.reservasPorCantidadTurnos} />
              <BarChart title="Ingresos por simulador" data={metricasReservas.ingresosPorSimulador} valueFormatter={formatMoney} />
              <BarChart title="Reservas por día" data={metricasReservas.reservasPorDia} />
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-sm text-white/60">
                Datos cargados desde Supabase: <b className="text-white">{turnosStand.length}</b> · Datos importados de Excel:{" "}
                <b className="text-white">{excelStand.length}</b> · Las métricas mezclan Supabase + Excel y evitan duplicados por venta
              </p>
            </div>

            <div className="mb-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <KpiCard title="Turnos vendidos" value={String(metricasStand.totalTurnos)} />
              <KpiCard title="Facturación" value={formatMoney(metricasStand.facturacion)} />
              <KpiCard title="Ticket promedio" value={formatMoney(metricasStand.ticketPromedio)} />
              <KpiCard title="Ventas registradas" value={String(metricasStand.ventasRegistradas)} />
              <KpiCard title="Prom. personas" value={metricasStand.promedioPersonas.toFixed(2)} />
              <KpiCard title="Horas vendidas" value={metricasStand.horasVendidas.toFixed(1)} />
              <KpiCard title="Minutos vendidos" value={String(metricasStand.totalMinutos)} />
              <KpiCard title="Ingreso/minuto" value={formatMoney(metricasStand.ingresoPorMinuto)} />
              <KpiCard title="Ingreso/persona" value={formatMoney(metricasStand.ingresoPorPersona)} />
              <KpiCard title="Ingreso prom. por simulador" value={formatMoney(metricasStand.ingresoPromedioPorSimulador)} />
              <KpiCard title="Hora pico" value={metricasStand.horaPico} />
              <KpiCard title="Mejor día" value={metricasStand.mejorDia} />
              <KpiCard title="Sim más usado" value={metricasStand.simuladorMasUsado} />
            </div>

            <div className="mb-8">
              <BarChart title="Ingresos por día" data={metricasStand.ingresosPorDia} valueFormatter={formatMoney} />
            </div>

            <div className="mb-8 grid gap-6 xl:grid-cols-3">
              <PieChart title="Turnos por simulador" data={metricasStand.porSimulador} />
              <PieChart title="Turnos por método de pago" data={metricasStand.porMetodoPago} />
              <BarChart title="Ingresos por método de pago" data={metricasStand.ingresosPorMetodo} valueFormatter={formatMoney} />
              <BarChart title="Turnos por duración" data={metricasStand.porDuracion} />
              <BarChart title="Turnos por cantidad de personas" data={metricasStand.porPersonas} />
              <BarChart title="Turnos por hora" data={metricasStand.porHora} />
              <BarChart title="Turnos por día" data={metricasStand.porDia} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
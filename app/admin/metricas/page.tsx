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
  simulador?: string;
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
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      const parseados: TurnoStand[] = rows.map((row) => {
        const item: TurnoStand = { fecha: "" };

        Object.keys(row).forEach((key) => {
          const k = normalizeText(key);

          if (k.includes("fecha")) item.fecha = String(row[key]);
          if (k.includes("bajada")) item.hora_bajada = String(row[key]);
          if (k.includes("subida")) item.hora_subida = String(row[key]);
          if (k.includes("hora") && !item.hora_bajada) item.hora_bajada = String(row[key]);
          if (k.includes("simu")) item.simulador = String(row[key]);
          if (k.includes("duracion")) item.duracion = row[key];
          if (k.includes("persona")) item.personas = row[key];
          if (k.includes("metodo") || k.includes("pago")) item.metodo_pago = String(row[key]);
          if (k.includes("posnet")) item.posnet = String(row[key]);
          if (k.includes("total") || k.includes("monto") || k.includes("facturado")) item.total = row[key];
        });

        return item;
      });

      setExcelStand(parseados);
    };

    reader.readAsArrayBuffer(file);
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
    const data = [...turnosStand, ...excelStand];

    return filtrarPorFecha(data).filter((t) => {
      const texto = `${t.fecha} ${t.hora_bajada} ${t.hora_subida} ${t.simulador} ${t.metodo_pago} ${t.posnet}`.toLowerCase();
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
        ingresosPorSimulador[sim] = (ingresosPorSimulador[sim] || 0) + numberValue(r.total) / Math.max(r.simuladores.length, 1);
      });
    });

    const horaPico = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const mejorDia = Object.entries(ingresosPorDia).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

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
      mejorDia,
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
    const totalTurnos = standFiltrado.length;
    const facturacion = sumBy(standFiltrado, (t) => numberValue(t.total ?? t.monto));
    const ticketPromedio = totalTurnos ? facturacion / totalTurnos : 0;

    const totalPersonas = sumBy(standFiltrado, (t) => numberValue(t.personas));
    const promedioPersonas = totalTurnos ? totalPersonas / totalTurnos : 0;

    const totalMinutos = sumBy(standFiltrado, (t) => numberValue(t.duracion));
    const horasVendidas = totalMinutos / 60;

    const ingresoPorMinuto = totalMinutos ? facturacion / totalMinutos : 0;
    const ingresoPorPersona = totalPersonas ? facturacion / totalPersonas : 0;

    const porMetodoPago = countBy(standFiltrado, (t) => t.metodo_pago);
    const porPosnet = countBy(standFiltrado, (t) => t.posnet);
    const porSimulador = countBy(standFiltrado, (t) => t.simulador);
    const porDuracion = countBy(standFiltrado, (t) => `${t.duracion || "Sin dato"} min`);
    const porPersonas = countBy(standFiltrado, (t) => `${t.personas || "Sin dato"} persona/s`);
    const porHora = countBy(standFiltrado, (t) => t.hora_bajada?.slice(0, 5));
    const porDia = countBy(standFiltrado, (t) => t.fecha);

    const ingresosPorDia: Record<string, number> = {};
    const ingresosPorMetodo: Record<string, number> = {};
    const ingresosPorPosnet: Record<string, number> = {};
    const ingresosPorSimulador: Record<string, number> = {};

    standFiltrado.forEach((t) => {
      const monto = numberValue(t.total ?? t.monto);
      const metodo = t.metodo_pago || "Sin dato";
      const posnet = t.posnet || "Sin dato";
      const sim = t.simulador || "Sin dato";

      ingresosPorDia[t.fecha] = (ingresosPorDia[t.fecha] || 0) + monto;
      ingresosPorMetodo[metodo] = (ingresosPorMetodo[metodo] || 0) + monto;
      ingresosPorPosnet[posnet] = (ingresosPorPosnet[posnet] || 0) + monto;
      ingresosPorSimulador[sim] = (ingresosPorSimulador[sim] || 0) + monto;
    });

    const horaPico = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const mejorDia = Object.entries(ingresosPorDia).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const simuladorMasUsado = Object.entries(porSimulador).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    return {
      totalTurnos,
      facturacion,
      ticketPromedio,
      totalPersonas,
      promedioPersonas,
      totalMinutos,
      horasVendidas,
      ingresoPorMinuto,
      ingresoPorPersona,
      horaPico,
      mejorDia,
      simuladorMasUsado,
      porMetodoPago: toChart(porMetodoPago),
      porPosnet: toChart(porPosnet),
      porSimulador: toChart(porSimulador),
      porDuracion: toChart(porDuracion),
      porPersonas: toChart(porPersonas),
      porHora: toChart(porHora, false),
      porDia: toChart(porDia, false).map((i) => ({ ...i, label: i.label.slice(5) })),
      ingresosPorDia: toChart(ingresosPorDia, false).map((i) => ({ ...i, label: i.label.slice(5) })),
      ingresosPorMetodo: toChart(ingresosPorMetodo),
      ingresosPorPosnet: toChart(ingresosPorPosnet),
      ingresosPorSimulador: toChart(ingresosPorSimulador),
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
                <b className="text-white">{excelStand.length}</b>
              </p>
            </div>

            <div className="mb-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <KpiCard title="Turnos" value={String(metricasStand.totalTurnos)} />
              <KpiCard title="Facturación" value={formatMoney(metricasStand.facturacion)} />
              <KpiCard title="Ticket promedio" value={formatMoney(metricasStand.ticketPromedio)} />
              <KpiCard title="Personas" value={String(metricasStand.totalPersonas)} />
              <KpiCard title="Prom. personas" value={metricasStand.promedioPersonas.toFixed(2)} />
              <KpiCard title="Horas vendidas" value={metricasStand.horasVendidas.toFixed(1)} />
              <KpiCard title="Minutos vendidos" value={String(metricasStand.totalMinutos)} />
              <KpiCard title="Ingreso/minuto" value={formatMoney(metricasStand.ingresoPorMinuto)} />
              <KpiCard title="Ingreso/persona" value={formatMoney(metricasStand.ingresoPorPersona)} />
              <KpiCard title="Hora pico" value={metricasStand.horaPico} />
              <KpiCard title="Mejor día" value={metricasStand.mejorDia} />
              <KpiCard title="Sim más usado" value={metricasStand.simuladorMasUsado} />
            </div>

            <div className="mb-8">
              <LineChart title="Ingresos por día" data={metricasStand.ingresosPorDia} valueFormatter={formatMoney} />
            </div>

            <div className="mb-8 grid gap-6 xl:grid-cols-3">
              <PieChart title="Turnos por simulador" data={metricasStand.porSimulador} />
              <PieChart title="Turnos por método de pago" data={metricasStand.porMetodoPago} />
              <PieChart title="Turnos por posnet" data={metricasStand.porPosnet} />
              <BarChart title="Ingresos por método de pago" data={metricasStand.ingresosPorMetodo} valueFormatter={formatMoney} />
              <BarChart title="Ingresos por posnet" data={metricasStand.ingresosPorPosnet} valueFormatter={formatMoney} />
              <BarChart title="Ingresos por simulador" data={metricasStand.ingresosPorSimulador} valueFormatter={formatMoney} />
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
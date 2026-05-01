"use client";

import { useEffect, useMemo, useState } from "react";

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

type ChartItem = {
  label: string;
  value: number;
};

type QuickPeriod =
  | "hoy"
  | "semana"
  | "mes"
  | "anio"
  | "todo"
  | "personalizado";

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
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
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date) {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

function KpiCard({
  title,
  value,
  subtext,
}: {
  title: string;
  value: string;
  subtext?: string;
}) {
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
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-white/55">Sin datos para este período.</p>
      ) : (
        <div className="space-y-4">
          {data.map((item) => {
            const width = `${(item.value / max) * 100}%`;

            return (
              <div key={item.label}>
                <div className="mb-1 flex items-center justify-between gap-4 text-sm">
                  <span className="text-white/75">{item.label}</span>
                  <span className="font-medium text-white">
                    {valueFormatter ? valueFormatter(item.value) : item.value}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-red-500"
                    style={{ width }}
                  />
                </div>
              </div>
            );
          })}
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

  const line = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {data.length > 0 ? (
          <p className="text-sm text-white/50">
            Máximo:{" "}
            <span className="font-medium text-white">
              {valueFormatter
                ? valueFormatter(Math.max(...data.map((d) => d.value)))
                : Math.max(...data.map((d) => d.value))}
            </span>
          </p>
        ) : null}
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-white/55">Sin datos para este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full">
              <line
                x1={padding}
                y1={height - padding}
                x2={width - padding}
                y2={height - padding}
                stroke="rgba(255,255,255,0.15)"
              />
              <line
                x1={padding}
                y1={padding}
                x2={padding}
                y2={height - padding}
                stroke="rgba(255,255,255,0.15)"
              />

              <polyline
                fill="none"
                stroke="#ef4444"
                strokeWidth="4"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={line}
              />

              {points.map((p) => (
                <g key={p.label}>
                  <circle cx={p.x} cy={p.y} r="5" fill="#ef4444" />
                  <text
                    x={p.x}
                    y={p.y - 12}
                    textAnchor="middle"
                    fontSize="12"
                    fill="white"
                  >
                    {valueFormatter ? valueFormatter(p.value) : p.value}
                  </text>
                  <text
                    x={p.x}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="11"
                    fill="rgba(255,255,255,0.7)"
                  >
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

function PieChart({
  title,
  data,
}: {
  title: string;
  data: ChartItem[];
}) {
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
              const value = item.value;
              const angle = (value / total) * 360;

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
              <div key={item.label} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: colors[i % colors.length] }}
                  />
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

export default function AdminPage() {
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelandoId, setCancelandoId] = useState<number | null>(null);

  const [estadoFiltro, setEstadoFiltro] = useState<"todas" | "activa" | "cancelada">("todas");
  const [busqueda, setBusqueda] = useState("");
  const [quickPeriod, setQuickPeriod] = useState<QuickPeriod>("mes");

  const hoy = new Date();

  const [fechaDesde, setFechaDesde] = useState<string>(toInputDate(startOfMonth(hoy)));
  const [fechaHasta, setFechaHasta] = useState<string>(toInputDate(endOfMonth(hoy)));

  const cargarReservas = async () => {
    try {
      setLoading(true);

      const res = await fetch("/api/reservas", { cache: "no-store" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "No se pudieron cargar las reservas");
      }

      const normalizadas: Reserva[] = (data || []).map((r: Reserva) => ({
        ...r,
        simuladores: normalizeArray(r.simuladores),
      }));

      setReservas(normalizadas);
    } catch (error) {
      console.error(error);
      alert("Error al cargar reservas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarReservas();
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

  const cancelarReserva = async (id: number) => {
    const confirmar = window.confirm("¿Querés cancelar esta reserva?");
    if (!confirmar) return;

    try {
      setCancelandoId(id);

      const res = await fetch(`/api/reservas/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ estado: "cancelada" }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "No se pudo cancelar la reserva");
      }

      setReservas((prev) =>
        prev.map((r) => (r.id === id ? { ...r, estado: "cancelada" } : r))
      );
    } catch (error) {
      console.error(error);
      alert("Error al cancelar la reserva");
    } finally {
      setCancelandoId(null);
    }
  };

  const reservasFiltradas = useMemo(() => {
    const desdeDate = fechaDesde ? parseFechaLocal(fechaDesde) : null;
    const hastaDate = fechaHasta ? parseFechaLocal(fechaHasta) : null;

    if (hastaDate) {
      hastaDate.setHours(23, 59, 59, 999);
    }

    return reservas.filter((r) => {
      const coincideEstado =
        estadoFiltro === "todas" ? true : r.estado === estadoFiltro;

      const texto = `${r.nombre} ${r.telefono} ${r.fecha} ${r.hora}`.toLowerCase();
      const coincideBusqueda = texto.includes(busqueda.toLowerCase());

      const fechaReserva = parseFechaLocal(r.fecha);

      const coincideRango =
        !fechaReserva
          ? false
          : (!desdeDate || fechaReserva >= desdeDate) &&
            (!hastaDate || fechaReserva <= hastaDate);

      return coincideEstado && coincideBusqueda && coincideRango;
    });
  }, [reservas, estadoFiltro, busqueda, fechaDesde, fechaHasta]);

  const metricas = useMemo(() => {
    const activas = reservasFiltradas.filter((r) => r.estado === "activa");
    const canceladas = reservasFiltradas.filter((r) => r.estado === "cancelada");

    const totalReservas = reservasFiltradas.length;
    const totalActivas = activas.reduce((acc, r) => acc + Number(r.total || 0), 0);
    const ticketPromedio = activas.length ? totalActivas / activas.length : 0;
    const tasaCancelacion = totalReservas
      ? (canceladas.length / totalReservas) * 100
      : 0;

    const totalTurnosVendidos = activas.reduce(
      (acc, r) => acc + Number(r.cantidad_turnos || 0),
      0
    );

    const promedioSimuladoresPorReserva = activas.length
      ? activas.reduce((acc, r) => acc + r.simuladores.length, 0) / activas.length
      : 0;

    const porHora: Record<string, number> = {};
    const porSimulador: Record<string, number> = {};
    const ingresosPorDia: Record<string, number> = {};
    const reservasPorDia: Record<string, number> = {};
    const estados: Record<string, number> = {
      activa: 0,
      cancelada: 0,
    };

    for (const r of reservasFiltradas) {
      porHora[r.hora] = (porHora[r.hora] || 0) + 1;
      reservasPorDia[r.fecha] = (reservasPorDia[r.fecha] || 0) + 1;
      estados[r.estado] = (estados[r.estado] || 0) + 1;

      if (r.estado === "activa") {
        ingresosPorDia[r.fecha] = (ingresosPorDia[r.fecha] || 0) + Number(r.total || 0);
      }

      for (const sim of r.simuladores) {
        porSimulador[sim] = (porSimulador[sim] || 0) + 1;
      }
    }

    const horaPico =
      Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    const chartHoras: ChartItem[] = Object.entries(porHora)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value }));

    const chartSimuladores: ChartItem[] = Object.entries(porSimulador)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));

    const chartIngresos: ChartItem[] = Object.entries(ingresosPorDia)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({
        label: label.slice(5),
        value,
      }));

    const chartReservasPorDia: ChartItem[] = Object.entries(reservasPorDia)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({
        label: label.slice(5),
        value,
      }));

    const chartEstados: ChartItem[] = Object.entries(estados)
      .filter(([, value]) => value > 0)
      .map(([label, value]) => ({ label, value }));

    return {
      totalReservas,
      activas: activas.length,
      canceladas: canceladas.length,
      totalActivas,
      ticketPromedio,
      tasaCancelacion,
      horaPico,
      totalTurnosVendidos,
      promedioSimuladoresPorReserva,
      chartHoras,
      chartSimuladores,
      chartIngresos,
      chartReservasPorDia,
      chartEstados,
    };
  }, [reservasFiltradas]);

  const rangoTexto =
    !fechaDesde && !fechaHasta
      ? "Todo el histórico"
      : `${fechaDesde || "Inicio"} → ${fechaHasta || "Hoy"}`;

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-sm uppercase tracking-[0.3em] text-red-500">
              Panel administrativo
            </p>
            <h1 className="text-4xl font-bold">Reservas SIM</h1>
            <p className="mt-2 max-w-2xl text-white/60">
              Analizá reservas, ingresos, cancelaciones y comportamiento por horario
              con períodos rápidos o rangos personalizados.
            </p>
          </div>

          <button
            onClick={cargarReservas}
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-3 text-sm font-medium text-white transition hover:bg-red-500/20"
          >
            Actualizar datos
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

            <div>
              <label className="mb-2 block text-sm text-white/70">Estado</label>
              <select
                value={estadoFiltro}
                onChange={(e) =>
                  setEstadoFiltro(e.target.value as "todas" | "activa" | "cancelada")
                }
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
              >
                <option value="todas">Todas</option>
                <option value="activa">Activas</option>
                <option value="cancelada">Canceladas</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/70">Buscar</label>
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre, teléfono, fecha..."
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
              />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="text-sm text-white/50">Rango activo</p>
            <p className="mt-1 text-lg font-semibold text-white">{rangoTexto}</p>
          </div>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            title="Reservas"
            value={String(metricas.totalReservas)}
            subtext="Según filtros"
          />
          <KpiCard
            title="Activas"
            value={String(metricas.activas)}
            subtext="Vigentes"
          />
          <KpiCard
            title="Canceladas"
            value={String(metricas.canceladas)}
            subtext="Dentro del rango"
          />
          <KpiCard
            title="Facturación"
            value={formatMoney(metricas.totalActivas)}
            subtext="Solo activas"
          />
          <KpiCard
            title="Ticket promedio"
            value={formatMoney(metricas.ticketPromedio)}
            subtext="Por reserva activa"
          />
          <KpiCard
            title="Cancelación"
            value={`${metricas.tasaCancelacion.toFixed(1)}%`}
            subtext="Tasa del período"
          />
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">
              Hora pico
            </p>
            <p className="mt-2 text-2xl font-bold text-white">{metricas.horaPico}</p>
            <p className="mt-2 text-sm text-white/55">
              Franja con mayor volumen de reservas.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">
              Turnos vendidos
            </p>
            <p className="mt-2 text-2xl font-bold text-white">
              {metricas.totalTurnosVendidos}
            </p>
            <p className="mt-2 text-sm text-white/55">
              Total de turnos activos vendidos en el rango.
            </p>
          </div>
        </div>

        <div className="mb-8">
          <LineChart
            title="Ingresos por día"
            data={metricas.chartIngresos}
            valueFormatter={(n) => `$${Math.round(n).toLocaleString("es-AR")}`}
          />
        </div>

        <div className="mb-8 grid gap-6 xl:grid-cols-3">
          <PieChart
            title="Uso de simuladores"
            data={metricas.chartSimuladores}
          />

          <PieChart
            title="Estado de reservas"
            data={metricas.chartEstados}
          />

          <BarChart
            title="Reservas por hora"
            data={metricas.chartHoras}
          />
        </div>

        <div className="mb-8 grid gap-6 xl:grid-cols-2">
          <BarChart
            title="Reservas por día"
            data={metricas.chartReservasPorDia}
          />
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h3 className="mb-5 text-lg font-semibold text-white">
              Métricas complementarias
            </h3>

            <div className="space-y-5">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm text-white/50">Promedio de simuladores por reserva</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {metricas.promedioSimuladoresPorReserva.toFixed(2)}
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm text-white/50">Reservas activas estimadas por día</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {metricas.chartReservasPorDia.length > 0
                    ? (
                        metricas.chartReservasPorDia.reduce((acc, item) => acc + item.value, 0) /
                        metricas.chartReservasPorDia.length
                      ).toFixed(1)
                    : "0"}
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm text-white/50">Ingreso promedio por día con movimiento</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {metricas.chartIngresos.length > 0
                    ? formatMoney(
                        metricas.chartIngresos.reduce((acc, item) => acc + item.value, 0) /
                          metricas.chartIngresos.length
                      )
                    : formatMoney(0)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <h2 className="text-2xl font-bold">Detalle de reservas</h2>
          <p className="mt-1 text-sm text-white/60">
            Resultados visibles: {reservasFiltradas.length}
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead className="bg-red-600/90 text-left">
                <tr>
                  <th className="px-4 py-4 text-sm font-semibold">ID</th>
                  <th className="px-4 py-4 text-sm font-semibold">Nombre</th>
                  <th className="px-4 py-4 text-sm font-semibold">Teléfono</th>
                  <th className="px-4 py-4 text-sm font-semibold">Fecha</th>
                  <th className="px-4 py-4 text-sm font-semibold">Hora</th>
                  <th className="px-4 py-4 text-sm font-semibold">Simuladores</th>
                  <th className="px-4 py-4 text-sm font-semibold">Turnos</th>
                  <th className="px-4 py-4 text-sm font-semibold">Total</th>
                  <th className="px-4 py-4 text-sm font-semibold">Estado</th>
                  <th className="px-4 py-4 text-sm font-semibold">Acción</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-white/60">
                      Cargando reservas...
                    </td>
                  </tr>
                ) : reservasFiltradas.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-white/60">
                      No hay reservas para mostrar.
                    </td>
                  </tr>
                ) : (
                  reservasFiltradas.map((reserva) => (
                    <tr
                      key={reserva.id}
                      className="border-t border-white/10 transition hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-4">{reserva.id}</td>
                      <td className="px-4 py-4 font-medium">{reserva.nombre}</td>
                      <td className="px-4 py-4 text-white/80">{reserva.telefono}</td>
                      <td className="px-4 py-4">{reserva.fecha}</td>
                      <td className="px-4 py-4">{reserva.hora}</td>
                      <td className="px-4 py-4">
                        {reserva.simuladores.length > 0
                          ? reserva.simuladores.join(", ")
                          : "-"}
                      </td>
                      <td className="px-4 py-4">{reserva.cantidad_turnos}</td>
                      <td className="px-4 py-4 font-medium">
                        {formatMoney(Number(reserva.total || 0))}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
                            reserva.estado === "cancelada"
                              ? "bg-gray-600/70 text-white"
                              : "bg-green-600/80 text-white"
                          }`}
                        >
                          {reserva.estado}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {reserva.estado === "cancelada" ? (
                          <span className="text-sm text-white/40">Cancelada</span>
                        ) : (
                          <button
                            onClick={() => cancelarReserva(reserva.id)}
                            disabled={cancelandoId === reserva.id}
                            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {cancelandoId === reserva.id ? "Cancelando..." : "Cancelar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
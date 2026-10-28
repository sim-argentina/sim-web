"use client";

// Métricas de Reservas web y Campeonatos (pestañas de Métricas). Se movieron tal
// cual desde page.tsx: mismos cálculos y la misma interfaz. Lo nuevo es que cada
// pestaña pide SOLO sus datos y recién cuando se abre (antes la página bajaba al
// abrir reservas, campeonatos y todo el historial del Stand).

import { useEffect, useMemo, useState } from "react";
import { normalizeText, numberValue } from "@/lib/historicosStand";
// (B8) Duración por la modalidad de cada fila: legacy conserva 15/30 como siempre;
// v2 muestra 10/20/30 reales (nunca convierte 10 o 20 en 15).
import { comparativoReservasPorDuracion } from "@/lib/minutosComerciales";

type QuickPeriod = "hoy" | "semana" | "mes" | "anio" | "todo" | "personalizado";

type Reserva = {
  id: number;
  created_at?: string;
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[];
  cantidad_turnos: number;
  total: number;
  estado: string;
  duracion_minutos?: number | null;
  /** (B8) NULL = legacy. */
  modalidad?: string | null;
};


type ChartItem = {
  label: string;
  value: number;
};

type CampRegistro = {
  id: string;
  fecha: string;
  nombre_completo: string;
  categoria: string;
  campeonato_id: string | null;
  circuito: string | null;
  estado: string;
  cantidad_turnos?: number | null;
  campeonatos?: { nombre: string } | null;
};

type CampInscripcion = {
  id: string;
  created_at: string;
  fecha?: string; // derivada de created_at para reutilizar el filtro por fecha
  categoria: string | null;
  campeonato_id: string | null;
  monto: number;
  estado_pago: string;
  nombre_completo?: string;
  campeonatos?: { nombre: string } | null;
};

type CampeonatoLite = { id: string; nombre: string };

/** Excel elegido, a la espera de que se confirmen su mes y su año. */
function formatMoney(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);
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

function capitalizar(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}


function addToRecord(record: Record<string, number>, key: string | null | undefined, value = 1) {
  if (!key) return;
  record[key] = (record[key] || 0) + value;
}

function toChart(data: Record<string, number>, sortByValue = true): ChartItem[] {
  return Object.entries(data)
    .sort((a, b) => (sortByValue ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .map(([label, value]) => ({ label, value }));
}


function sumBy<T>(items: T[], getter: (item: T) => number) {
  return items.reduce((acc, item) => acc + getter(item), 0);
}

function countBy<T>(items: T[], getter: (item: T) => string | number | null | undefined) {
  return items.reduce((acc: Record<string, number>, item) => {
    const key = String(getter(item) || "Sin dato");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
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

function LineChart({
  title,
  data,
  valueFormatter,
}: {
  title: string;
  data: ChartItem[];
  valueFormatter?: (n: number) => string;
}) {
  const width = 920;
  const height = 300;
  const padL = 70;
  const padR = 24;
  const padT = 22;
  const padB = 70;

  const { points, gridLines, labelEvery } = useMemo(() => {
    const max = Math.max(...data.map((d) => d.value), 1);
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;

    const points = data.map((item, index) => {
      const x =
        data.length === 1
          ? padL + innerW / 2
          : padL + (index * innerW) / (data.length - 1);
      const y = padT + innerH - (item.value / max) * innerH;
      return { ...item, x, y };
    });

    const steps = 4;
    const gridLines = Array.from({ length: steps + 1 }, (_, i) => {
      const value = (max * i) / steps;
      return { value, y: padT + innerH - (i / steps) * innerH };
    });

    // Como máximo ~12 etiquetas en el eje X para que no se pisen.
    const labelEvery = Math.max(1, Math.ceil(data.length / 12));

    return { points, gridLines, labelEvery };
  }, [data]);

  // Ancho mínimo dinámico: pocos períodos no se estiran, muchos hacen scroll.
  const minWidth = Math.min(1600, Math.max(560, data.length * 64));
  const showValues = data.length <= 14;
  const fmt = (n: number) =>
    valueFormatter ? valueFormatter(Math.round(n)) : String(Math.round(n));

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <h3 className="mb-5 text-lg font-semibold text-white">{title}</h3>

      {data.length === 0 ? (
        <p className="text-sm text-white/55">Sin datos para este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth }}>
            <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full">
              {/* grilla horizontal + escala Y en moneda */}
              {gridLines.map((g, i) => (
                <g key={i}>
                  <line
                    x1={padL}
                    y1={g.y}
                    x2={width - padR}
                    y2={g.y}
                    stroke="rgba(255,255,255,0.08)"
                  />
                  <text
                    x={padL - 12}
                    y={g.y + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="rgba(255,255,255,0.4)"
                  >
                    {fmt(g.value)}
                  </text>
                </g>
              ))}

              {/* área suave bajo la línea */}
              <polygon
                fill="rgba(239,68,68,0.12)"
                points={`${padL},${height - padB} ${points
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")} ${width - padR},${height - padB}`}
              />

              <polyline
                fill="none"
                stroke="#ef4444"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              />

              {points.map((p, i) => {
                const mostrar = i % labelEvery === 0 || i === points.length - 1;
                return (
                  <g key={`${p.label}-${i}`}>
                    <circle cx={p.x} cy={p.y} r="3.5" fill="#ef4444" />
                    {showValues && mostrar && (
                      <text
                        x={p.x}
                        y={p.y - 12}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="700"
                        fill="white"
                      >
                        {valueFormatter ? valueFormatter(p.value) : p.value}
                      </text>
                    )}
                    {mostrar && (
                      <text
                        x={p.x}
                        y={height - 50}
                        textAnchor="end"
                        fontSize="11"
                        fill="rgba(255,255,255,0.7)"
                        transform={`rotate(-32 ${p.x} ${height - 50})`}
                      >
                        {p.label.replace(/^Semana /, "Sem ")}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReservasCampeonatos({ vista }: { vista: "reservas" | "campeonatos" }) {
  const [reservas, setReservas] = useState<Reserva[]>([]);

  // Campeonatos
  const [campRegistros, setCampRegistros] = useState<CampRegistro[]>([]);
  const [campInscripciones, setCampInscripciones] = useState<CampInscripcion[]>([]);
  const [campeonatos, setCampeonatos] = useState<CampeonatoLite[]>([]);
  const [campFiltroCampeonato, setCampFiltroCampeonato] = useState("");
  const [campFiltroCategoria, setCampFiltroCategoria] = useState("");
  const [campFiltroCircuito, setCampFiltroCircuito] = useState("");

  const [loading, setLoading] = useState(true);

  const [quickPeriod, setQuickPeriod] = useState<QuickPeriod>("mes");
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"todas" | "activa" | "cancelada">("todas");

  const hoy = new Date();
  const [fechaDesde, setFechaDesde] = useState(toInputDate(startOfMonth(hoy)));
  const [fechaHasta, setFechaHasta] = useState(toInputDate(endOfMonth(hoy)));

  useEffect(() => {
    cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

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

  // Solo los datos de la pestaña abierta.
  async function cargarDatos() {
    try {
      setLoading(true);
      if (vista === "reservas") {
        const resReservas = await fetch("/api/reservas", { cache: "no-store" });
        const reservasJson = await resReservas.json();
        setReservas(
          (Array.isArray(reservasJson) ? reservasJson : reservasJson.reservas || [])
            // Solo reservas con pago aprobado (activa) o canceladas tras estar
            // activas. Se excluyen pendientes/errores de pago para no contarlas.
            .filter((r: Reserva) => r.estado === "activa" || r.estado === "cancelada")
            .map((r: Reserva) => ({
              ...r,
              simuladores: normalizeArray(r.simuladores),
            }))
        );
      } else {
        const [resCampReg, resCampIns, resCamp] = await Promise.all([
          fetch("/api/admin/campeonatos/registros", { cache: "no-store" }),
          fetch("/api/admin/campeonatos/inscripciones", { cache: "no-store" }),
          fetch("/api/admin/campeonatos", { cache: "no-store" }),
        ]);
        const campRegJson = await resCampReg.json();
        const campInsJson = await resCampIns.json();
        const campJson = await resCamp.json();
        setCampRegistros(Array.isArray(campRegJson) ? campRegJson : []);
        setCampInscripciones(
          (Array.isArray(campInsJson) ? campInsJson : []).map((i: CampInscripcion) => ({
            ...i,
            // reutiliza el filtro por fecha (created_at -> YYYY-MM-DD)
            fecha: (i.created_at || "").slice(0, 10),
          }))
        );
        setCampeonatos(Array.isArray(campJson) ? campJson : []);
      }
    } catch (error) {
      console.error(error);
      alert("Error cargando métricas");
    } finally {
      setLoading(false);
    }
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
    return filtrarPorFecha<Reserva>(reservas).filter((r) => {
      const coincideEstado = estadoFiltro === "todas" ? true : r.estado === estadoFiltro;
      const texto = `${r.nombre} ${r.telefono} ${r.fecha} ${r.hora} ${r.simuladores.join(
        " "
      )}`.toLowerCase();

      return coincideEstado && texto.includes(busqueda.toLowerCase());
    });
  }, [reservas, estadoFiltro, busqueda, fechaDesde, fechaHasta]);

  const metricasReservas = useMemo(() => {
    const activas = reservasFiltradas.filter((r) => r.estado === "activa");
    const canceladas = reservasFiltradas.filter((r) => r.estado === "cancelada");

    const facturacion = sumBy(activas, (r) => numberValue(r.total));
    const ticketPromedio = activas.length ? facturacion / activas.length : 0;
    const tasaCancelacion = reservasFiltradas.length
      ? (canceladas.length / reservasFiltradas.length) * 100
      : 0;

    const turnosVendidos = sumBy(activas, (r) => numberValue(r.cantidad_turnos));
    const simuladoresUsados = sumBy(activas, (r) => r.simuladores.length);
    const promedioSims = activas.length ? simuladoresUsados / activas.length : 0;
    const ingresoPorTurno = turnosVendidos ? facturacion / turnosVendidos : 0;
    const ingresoPorSimulador = simuladoresUsados ? facturacion / simuladoresUsados : 0;

    const porHora = countBy(reservasFiltradas, (r) => r.hora);
    const porEstado = countBy(reservasFiltradas, (r) => r.estado);
    const porCantidadTurnos = countBy(activas, (r) => `${r.cantidad_turnos} turno/s`);
    const porDia = countBy(reservasFiltradas, (r) => r.fecha);

    // Duración por la modalidad de cada reserva: legacy como siempre (sin duración
    // o distinta de 30 → 15); v2 su duración real (10/20/30).
    const reservasPorDuracion = comparativoReservasPorDuracion(reservasFiltradas);
    const reservas30 = reservasPorDuracion.find((i) => i.label === "30 min")?.value ?? 0;
    const reservas15 = reservasPorDuracion.find((i) => i.label === "15 min")?.value ?? 0;

    const porSimulador: Record<string, number> = {};
    const ingresosPorDia: Record<string, number> = {};
    const ingresosPorSimulador: Record<string, number> = {};

    activas.forEach((r) => {
      ingresosPorDia[r.fecha] = (ingresosPorDia[r.fecha] || 0) + numberValue(r.total);

      r.simuladores.forEach((sim) => {
        porSimulador[sim] = (porSimulador[sim] || 0) + 1;
        ingresosPorSimulador[sim] =
          (ingresosPorSimulador[sim] || 0) +
          numberValue(r.total) / Math.max(r.simuladores.length, 1);
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
      reservasPorDia: toChart(porDia, false).map((i) => ({
        ...i,
        label: i.label.slice(5),
      })),
      ingresosPorDia: toChart(ingresosPorDia, false).map((i) => ({
        ...i,
        label: i.label.slice(5),
      })),
      ingresosPorSimulador: toChart(ingresosPorSimulador),
      reservas15,
      reservas30,
      reservasPorDuracion: reservasPorDuracion as ChartItem[],
    };
  }, [reservasFiltradas]);

  // ── Campeonatos ──────────────────────────────────────────────────────────
  const campCircuitosOpciones = useMemo(() => {
    const set = new Set<string>();
    campRegistros.forEach((r) => {
      if (r.circuito) set.add(r.circuito);
    });
    return Array.from(set).sort();
  }, [campRegistros]);

  const campRegistrosFiltrados = useMemo(() => {
    const q = normalizeText(busqueda);
    return filtrarPorFecha<CampRegistro>(campRegistros)
      .filter((r) => r.estado === "valido") // ignora anulados/cancelados
      .filter((r) => !campFiltroCampeonato || r.campeonato_id === campFiltroCampeonato)
      .filter((r) => !campFiltroCategoria || normalizeText(r.categoria) === campFiltroCategoria)
      .filter((r) => !campFiltroCircuito || (r.circuito || "Sin circuito") === campFiltroCircuito)
      .filter((r) => !q || normalizeText(r.nombre_completo).includes(q));
  }, [
    campRegistros,
    fechaDesde,
    fechaHasta,
    campFiltroCampeonato,
    campFiltroCategoria,
    campFiltroCircuito,
    busqueda,
  ]);

  const campInscripcionesFiltradas = useMemo(() => {
    const q = normalizeText(busqueda);
    return filtrarPorFecha<CampInscripcion>(campInscripciones)
      .filter((i) => i.estado_pago !== "cancelado" && i.estado_pago !== "rechazado")
      .filter((i) => !campFiltroCampeonato || i.campeonato_id === campFiltroCampeonato)
      .filter((i) => !campFiltroCategoria || normalizeText(i.categoria || "") === campFiltroCategoria)
      .filter((i) => !q || normalizeText(i.nombre_completo || "").includes(q));
  }, [
    campInscripciones,
    fechaDesde,
    fechaHasta,
    campFiltroCampeonato,
    campFiltroCategoria,
    busqueda,
  ]);

  const metricasCampeonatos = useMemo(() => {
    const registros = campRegistrosFiltrados;
    const inscripciones = campInscripcionesFiltradas;
    const pagadas = inscripciones.filter((i) => i.estado_pago === "pagado");

    const nombreCamp = (id: string | null, fallback?: string | null) =>
      fallback || campeonatos.find((c) => c.id === id)?.nombre || "Sin campeonato";

    const totalInscriptos = inscripciones.length;
    const totalTurnos = sumBy(registros, (r) => numberValue(r.cantidad_turnos) || 1);
    const facturado = sumBy(pagadas, (i) => numberValue(i.monto));

    const turnosPorCampeonato: Record<string, number> = {};
    const turnosPorCategoria: Record<string, number> = {};
    const turnosPorCircuito: Record<string, number> = {};
    const personasPorCircuitoSet: Record<string, Set<string>> = {};

    registros.forEach((r) => {
      const camp = r.campeonatos?.nombre || nombreCamp(r.campeonato_id);
      const turnos = numberValue(r.cantidad_turnos) || 1;
      addToRecord(turnosPorCampeonato, camp, turnos);
      addToRecord(turnosPorCategoria, capitalizar(r.categoria || "Sin categoría"), turnos);
      const circ = r.circuito || "Sin circuito";
      addToRecord(turnosPorCircuito, circ, turnos);
      if (!personasPorCircuitoSet[circ]) personasPorCircuitoSet[circ] = new Set();
      personasPorCircuitoSet[circ].add(normalizeText(r.nombre_completo));
    });

    const personasPorCircuito: Record<string, number> = {};
    Object.entries(personasPorCircuitoSet).forEach(([k, v]) => {
      personasPorCircuito[k] = v.size;
    });

    const inscriptosPorCampeonato: Record<string, number> = {};
    const inscriptosPorCategoria: Record<string, number> = {};
    const facturacionPorCampeonato: Record<string, number> = {};

    inscripciones.forEach((i) => {
      addToRecord(inscriptosPorCampeonato, i.campeonatos?.nombre || nombreCamp(i.campeonato_id), 1);
      addToRecord(inscriptosPorCategoria, i.categoria ? capitalizar(i.categoria) : "Sin asignar", 1);
    });
    pagadas.forEach((i) => {
      addToRecord(
        facturacionPorCampeonato,
        i.campeonatos?.nombre || nombreCamp(i.campeonato_id),
        numberValue(i.monto)
      );
    });

    const campMasParticipacion =
      Object.entries(turnosPorCampeonato).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const categoriaMasParticipacion =
      Object.entries(turnosPorCategoria).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    return {
      totalInscriptos,
      totalTurnos,
      facturado,
      campMasParticipacion,
      categoriaMasParticipacion,
      turnosPorCampeonato: toChart(turnosPorCampeonato),
      turnosPorCategoria: toChart(turnosPorCategoria),
      turnosPorCircuito: toChart(turnosPorCircuito),
      personasPorCircuito: toChart(personasPorCircuito),
      inscriptosPorCampeonato: toChart(inscriptosPorCampeonato),
      inscriptosPorCategoria: toChart(inscriptosPorCategoria),
      facturacionPorCampeonato: toChart(facturacionPorCampeonato),
    };
  }, [campRegistrosFiltrados, campInscripcionesFiltradas, campeonatos]);

  const rangoTexto =
    !fechaDesde && !fechaHasta ? "Todo el histórico" : `${fechaDesde || "Inicio"} → ${fechaHasta || "Hoy"}`;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          onClick={cargarDatos}
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
                <label className="mb-2 block text-sm text-white/70">Campeonato</label>
                <select
                  value={campFiltroCampeonato}
                  onChange={(e) => setCampFiltroCampeonato(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                >
                  <option value="">Todos</option>
                  {campeonatos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
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

          {vista === "campeonatos" && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-white/70">Categoría</label>
                <select
                  value={campFiltroCategoria}
                  onChange={(e) => setCampFiltroCategoria(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                >
                  <option value="">Todas</option>
                  <option value="oro">Oro</option>
                  <option value="plata">Plata</option>
                  <option value="bronce">Bronce</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-white/70">Circuito / Carrera</label>
                <select
                  value={campFiltroCircuito}
                  onChange={(e) => setCampFiltroCircuito(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                >
                  <option value="">Todos</option>
                  {campCircuitosOpciones.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
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
              {/* (B9) Una tarjeta por duración real (legacy: 15 y 30 como siempre; v2: 10/20/30). */}
              {metricasReservas.reservasPorDuracion.map((item) => (
                <KpiCard key={item.label} title={`Reservas ${item.label}`} value={String(item.value)} />
              ))}
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
              <BarChart title="Reservas por duración" data={metricasReservas.reservasPorDuracion} />
            </div>
          </>
        ) : (
          <>
            <div className="mb-8 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
              <KpiCard title="Total inscriptos" value={String(metricasCampeonatos.totalInscriptos)} subtext="Según filtros" />
              <KpiCard title="Turnos realizados" value={String(metricasCampeonatos.totalTurnos)} subtext="Sin anulados" />
              <KpiCard title="Facturado" value={formatMoney(metricasCampeonatos.facturado)} subtext="Inscripciones pagadas" />
              <KpiCard title="Campeonato + participación" value={metricasCampeonatos.campMasParticipacion} />
              <KpiCard title="Categoría + participación" value={metricasCampeonatos.categoriaMasParticipacion} />
            </div>

            <div className="mb-8 grid gap-6 xl:grid-cols-3">
              <PieChart title="Turnos por categoría" data={metricasCampeonatos.turnosPorCategoria} />
              <PieChart title="Inscriptos por categoría" data={metricasCampeonatos.inscriptosPorCategoria} />
              <BarChart title="Turnos por campeonato" data={metricasCampeonatos.turnosPorCampeonato} />
              <BarChart title="Inscriptos por campeonato" data={metricasCampeonatos.inscriptosPorCampeonato} />
              <BarChart title="Turnos por circuito" data={metricasCampeonatos.turnosPorCircuito} />
              <BarChart title="Personas por circuito" data={metricasCampeonatos.personasPorCircuito} />
              <BarChart title="Facturación por campeonato" data={metricasCampeonatos.facturacionPorCampeonato} valueFormatter={formatMoney} />
            </div>
          </>
        )}
    </>
  );
}

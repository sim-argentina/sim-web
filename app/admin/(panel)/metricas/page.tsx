"use client";

import { useEffect, useMemo, useState } from "react";
import { agregarStand, comparativoStandPorDuracion, personasDeFila } from "@/lib/metricasStand";
import { hoyEnSim } from "@/lib/agenda";
import {
  aniosSeleccionables,
  analizarArchivo,
  construirTurnos,
  crearHashTurno,
  excelTimeToString,
  MESES,
  nombreMes,
  normalizarMetodoPago,
  normalizeText,
  numberValue,
  type ArchivoAnalizado,
  type TurnoHistoricoImportado,
} from "@/lib/historicosStand";
import { leerHojasExcel } from "@/lib/historicosStandExcel";
// (B8) Duración por la modalidad de cada fila: legacy conserva 15/30 como siempre;
// v2 muestra 10/20/30 reales (nunca convierte 10 o 20 en 15).
import { comparativoReservasPorDuracion } from "@/lib/minutosComerciales";
import WebTab from "./WebTab";
import EquipoTab from "./EquipoTab";

type Vista = "reservas" | "stand" | "campeonatos" | "web" | "equipo";
type QuickPeriod = "hoy" | "semana" | "mes" | "anio" | "todo" | "personalizado";
type Agrupacion = "dia" | "semana" | "mes";

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

type TurnoStand = {
  id?: number;
  created_at?: string;
  nombre?: string;
  telefono?: string;
  fecha: string;
  hora?: string;
  hora_subida?: string;
  hora_bajada?: string;
  hora_tomado?: string;
  hora_estimada_subida?: string;
  metodo_pago?: string;
  total?: number | string;
  monto?: number | string;
  cantidad_simuladores?: number;
  cantidad_turnos?: number;
  cantidad_minutos?: number | string;
  duracion?: number | string;
  escuderia?: string;
  simulador?: string;
  simuladores?: string[] | unknown;
  personas?: number | string;
  cantidad_personas?: number | string;
  estado?: string;
  archivo_nombre?: string;
  archivo_key?: string;
  hash_unico?: string;
  origen?: string;
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
type ArchivoPendiente = {
  analisis: ArchivoAnalizado;
  mes: string;
  anio: string;
};

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

  if (h < 10 || h > 22) return null;

  return `${String(h).padStart(2, "0")} hs`;
}

function normalizarHora(value: any) {
  const raw = excelTimeToString(value || "").trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);

  if (!match) return "";

  const horas = Number(match[1]);
  const minutos = Number(match[2]);

  if (Number.isNaN(horas) || Number.isNaN(minutos)) return "";

  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

function minutosEntre(horaInicio?: any, horaFin?: any) {
  const inicioNormalizado = normalizarHora(horaInicio);
  const finNormalizado = normalizarHora(horaFin);

  if (!inicioNormalizado || !finNormalizado) return null;

  const [h1, m1] = inicioNormalizado.split(":").map(Number);
  const [h2, m2] = finNormalizado.split(":").map(Number);

  const inicio = h1 * 60 + m1;
  const fin = h2 * 60 + m2;

  if (Number.isNaN(inicio) || Number.isNaN(fin)) return null;

  return fin >= inicio ? fin - inicio : fin + 1440 - inicio;
}

// Tiempo entre la toma del turno y la subida real, SIN asumir cambio de día.
// Devuelve null si la subida es anterior a la toma o el lapso es absurdo (> 4 h),
// para que el "Prom. subida sin demora" no dé valores disparatados.
function diferenciaSubidaMin(horaToma?: any, horaSubida?: any) {
  const toma = normalizarHora(horaToma);
  const subida = normalizarHora(horaSubida);
  if (!toma || !subida) return null;
  const [hT, mT] = toma.split(":").map(Number);
  const [hS, mS] = subida.split(":").map(Number);
  const diff = hS * 60 + mS - (hT * 60 + mT);
  if (diff < 0 || diff > 240) return null;
  return diff;
}

function promedioNumeros(valores: number[]) {
  if (!valores.length) return 0;
  return valores.reduce((acc, n) => acc + n, 0) / valores.length;
}

function obtenerHoraTomaTurno(turno: TurnoStand) {
  if (turno.hora) return turno.hora;
  if (turno.hora_tomado) return turno.hora_tomado;

  if (turno.created_at) {
    const fecha = new Date(turno.created_at);
    if (!Number.isNaN(fecha.getTime())) {
      return fecha.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
  }

  return "";
}

function obtenerSimuladoresTexto(turno: TurnoStand) {
  if (Array.isArray(turno.simuladores) && turno.simuladores.length) {
    return turno.simuladores.join(", ");
  }

  return turno.escuderia || turno.simulador || "-";
}

function capitalizar(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function nombreDia(fecha: string) {
  const date = parseFechaLocal(fecha);
  if (!date) return "Sin dato";

  return date.toLocaleDateString("es-AR", {
    weekday: "long",
  });
}

function fechaConDia(fecha: string) {
  const date = parseFechaLocal(fecha);
  if (!date) return fecha || "Sin dato";

  const dia = date.toLocaleDateString("es-AR", { weekday: "long" });
  // Con el año: los históricos ocupan 2025 y 2026, y "20/12" sola sería ambigua.
  const corto = date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return `${capitalizar(dia)} ${corto}`;
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

function chartPorHora(data: Record<string, number>) {
  return Object.entries(data)
    .sort((a, b) => Number(a[0].slice(0, 2)) - Number(b[0].slice(0, 2)))
    .map(([label, value]) => ({ label, value }));
}

function chartPorDiaSemana(data: Record<string, number>) {
  const orden = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

  return Object.entries(data)
    .sort((a, b) => orden.indexOf(a[0]) - orden.indexOf(b[0]))
    .map(([label, value]) => ({ label: capitalizar(label), value }));
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

function clavePeriodo(fecha: string, agrupacion: Agrupacion) {
  const date = parseFechaLocal(fecha);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  // Las etiquetas de día y semana llevan el año: con históricos de 2025 y datos de
  // 2026, "Semana 06/10 - 12/10" aparecería dos veces en el gráfico y en el selector.
  if (agrupacion === "dia") {
    return {
      key: `${year}-${month}-${day}`,
      label: capitalizar(
        date.toLocaleDateString("es-AR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      ),
      sortValue: `${year}-${month}-${day}`,
    };
  }

  if (agrupacion === "semana") {
    const start = startOfWeek(date);
    const end = endOfWeek(date);
    const startKey = toInputDate(start);

    return {
      key: startKey,
      label: `Semana ${start.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      })} - ${end.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      })}`,
      sortValue: startKey,
    };
  }

  return {
    key: `${year}-${month}`,
    label: capitalizar(
      date.toLocaleDateString("es-AR", {
        month: "long",
        year: "numeric",
      })
    ),
    sortValue: `${year}-${month}`,
  };
}

function agruparIngresos(items: TurnoStand[], agrupacion: Agrupacion, filtroExacto: string) {
  const acumulado: Record<string, { label: string; value: number; sortValue: string }> = {};

  items.forEach((item) => {
    const periodo = clavePeriodo(item.fecha, agrupacion);
    if (!periodo) return;

    if (
      filtroExacto &&
      filtroExacto !== "ultimos" &&
      filtroExacto !== "todos" &&
      periodo.key !== filtroExacto
    ) {
      return;
    }

    if (!acumulado[periodo.key]) {
      acumulado[periodo.key] = {
        label: periodo.label,
        value: 0,
        sortValue: periodo.sortValue,
      };
    }

    acumulado[periodo.key].value += numberValue(item.total ?? item.monto);
  });

  const ordenado = Object.values(acumulado).sort((a, b) =>
    a.sortValue.localeCompare(b.sortValue)
  );

  const visible = filtroExacto === "ultimos" ? ordenado.slice(-12) : ordenado;

  return visible.map(({ label, value }) => ({ label, value }));
}

function opcionesPeriodo(items: TurnoStand[], agrupacion: Agrupacion) {
  const map = new Map<string, { label: string; sortValue: string }>();

  items.forEach((item) => {
    const periodo = clavePeriodo(item.fecha, agrupacion);
    if (!periodo) return;
    map.set(periodo.key, {
      label: periodo.label,
      sortValue: periodo.sortValue,
    });
  });

  return Array.from(map.entries())
    .sort((a, b) => b[1].sortValue.localeCompare(a[1].sortValue))
    .map(([key, value]) => ({ key, label: value.label }));
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

export default function AdminMetricasPage() {
  const [vista, setVista] = useState<Vista>("reservas");
  // Rol para gatear la pestaña Equipo (admin-only). La API sigue siendo la autoridad.
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then((d) => setRole(d.role)).catch(() => {});
  }, []);
  const esAdmin = role === "admin";

  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [turnosStand, setTurnosStand] = useState<TurnoStand[]>([]);
  const [turnosHistoricos, setTurnosHistoricos] = useState<TurnoStand[]>([]);

  // Campeonatos
  const [campRegistros, setCampRegistros] = useState<CampRegistro[]>([]);
  const [campInscripciones, setCampInscripciones] = useState<CampInscripcion[]>([]);
  const [campeonatos, setCampeonatos] = useState<CampeonatoLite[]>([]);
  const [campFiltroCampeonato, setCampFiltroCampeonato] = useState("");
  const [campFiltroCategoria, setCampFiltroCategoria] = useState("");
  const [campFiltroCircuito, setCampFiltroCircuito] = useState("");

  const [loading, setLoading] = useState(true);
  const [importando, setImportando] = useState(false);
  // Excel elegidos que esperan la confirmación de mes y año (no se importa nada antes).
  const [pendientes, setPendientes] = useState<ArchivoPendiente[]>([]);

  const [quickPeriod, setQuickPeriod] = useState<QuickPeriod>("mes");
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"todas" | "activa" | "cancelada">("todas");

  const [agrupacionIngresos, setAgrupacionIngresos] = useState<Agrupacion>("semana");
  const [filtroIngresos, setFiltroIngresos] = useState("ultimos");
  const [limiteRankingDemora, setLimiteRankingDemora] = useState(5);

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

  useEffect(() => {
    setFiltroIngresos("ultimos");
  }, [agrupacionIngresos]);

  async function cargarDatos() {
    try {
      setLoading(true);

      const [resReservas, resStand, resHistoricos, resCampReg, resCampIns, resCamp] =
        await Promise.all([
          fetch("/api/reservas", { cache: "no-store" }),
          fetch("/api/turnos-stand", { cache: "no-store" }),
          fetch("/api/turnos-historicos", { cache: "no-store" }),
          fetch("/api/admin/campeonatos/registros", { cache: "no-store" }),
          fetch("/api/admin/campeonatos/inscripciones", { cache: "no-store" }),
          fetch("/api/admin/campeonatos", { cache: "no-store" }),
        ]);

      const reservasJson = await resReservas.json();
      const standJson = await resStand.json();
      const historicosJson = await resHistoricos.json();
      const campRegJson = await resCampReg.json();
      const campInsJson = await resCampIns.json();
      const campJson = await resCamp.json();

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

      setTurnosStand(Array.isArray(standJson) ? standJson : standJson.turnos || []);

      setTurnosHistoricos(
        (historicosJson.turnos || []).map((t: any) => ({
          ...t,
          simulador: t.escuderia || t.simulador || "",
          total: Number(t.total || 0),
        }))
      );

      // Campeonatos
      setCampRegistros(Array.isArray(campRegJson) ? campRegJson : []);
      setCampInscripciones(
        (Array.isArray(campInsJson) ? campInsJson : []).map((i: CampInscripcion) => ({
          ...i,
          // reutiliza el filtro por fecha (created_at -> YYYY-MM-DD)
          fecha: (i.created_at || "").slice(0, 10),
        }))
      );
      setCampeonatos(Array.isArray(campJson) ? campJson : []);
    } catch (error) {
      console.error(error);
      alert("Error cargando métricas");
    } finally {
      setLoading(false);
    }
  }

  // Paso 1: leer los Excel elegidos. Nada se guarda todavía: cada archivo espera
  // que se confirmen su mes y su año. El año NUNCA se toma de la fecha actual
  // (así se guardaron como 2026 los Excel de octubre a diciembre de 2025).
  async function elegirExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []) as File[];
    e.target.value = "";
    if (files.length === 0) return;

    // Validación defensiva antes de parsear (tamaño + extensión).
    const MAX_EXCEL_BYTES = 5 * 1024 * 1024;
    const hoy = hoyEnSim();
    const nuevos: ArchivoPendiente[] = [];
    const rechazados: string[] = [];

    for (const file of files) {
      if (file.size > MAX_EXCEL_BYTES) {
        rechazados.push(`${file.name}: supera el máximo de 5 MB.`);
        continue;
      }
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        rechazados.push(`${file.name}: formato inválido. Subí un archivo .xlsx.`);
        continue;
      }
      try {
        const analisis = analizarArchivo(file.name, leerHojasExcel(await file.arrayBuffer()), hoy);
        nuevos.push({
          analisis,
          mes: analisis.mesDetectado ?? "",
          anio: analisis.anioDetectado ? String(analisis.anioDetectado) : "",
        });
      } catch (error) {
        console.error(error);
        rechazados.push(`${file.name}: no se pudo leer el Excel.`);
      }
    }

    if (rechazados.length) alert(rechazados.join("\n"));
    if (nuevos.length) setPendientes(nuevos);
  }

  function actualizarPendiente(indice: number, cambios: Partial<Pick<ArchivoPendiente, "mes" | "anio">>) {
    setPendientes((prev) => prev.map((p, i) => (i === indice ? { ...p, ...cambios } : p)));
  }

  // Paso 2: con mes y año confirmados en TODOS los archivos, se guardan.
  async function confirmarImportacion() {
    if (!revisionPendientes.length || revisionPendientes.some((r) => r.bloqueado)) return;

    const turnos: TurnoHistoricoImportado[] = revisionPendientes.flatMap((r) => r.turnos);
    let insertados = 0;

    try {
      setImportando(true);

      for (let i = 0; i < turnos.length; i += 500) {
        const res = await fetch("/api/turnos-historicos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ turnos: turnos.slice(i, i + 500) }),
        });

        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "Error guardando turnos históricos");
        }
        insertados += Number(json.insertados ?? 0);
      }

      const facturacion = turnos.reduce((acc, t) => acc + numberValue(t.total), 0);
      const turnosVendidos = turnos.reduce(
        (acc, t) => acc + numberValue(t.cantidad_turnos),
        0
      );
      const detalle = pendientes
        .map((p) => `· ${p.analisis.nombre}: ${nombreMes(p.mes)} de ${p.anio}`)
        .join("\n");

      alert(
        `Excel importado y guardado en Supabase.\n${detalle}\nVentas leídas: ${turnos.length}\nVentas nuevas: ${insertados}\nYa importadas (ignoradas): ${turnos.length - insertados}\nTurnos vendidos leídos: ${turnosVendidos}\nFacturación leída: ${formatMoney(facturacion)}`
      );

      setPendientes([]);
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error && error.message ? error.message : "Error importando Excel");
      // Puede haberse guardado una parte: se refresca. Reintentar no duplica (hash).
      await cargarDatos();
    } finally {
      setImportando(false);
    }
  }

  async function borrarImportacion(archivoKey: string, anio: string, nombre: string) {
    const confirmar = confirm(
      `¿Seguro que querés borrar la importación "${nombre}"${anio ? ` de ${anio}` : ""}?`
    );
    if (!confirmar) return;

    try {
      // Con el año: el mismo archivo puede estar importado en dos años distintos.
      const params = new URLSearchParams({ archivo_key: archivoKey });
      if (/^\d{4}$/.test(anio)) params.set("anio", anio);
      const res = await fetch(`/api/turnos-historicos?${params.toString()}`, {
        method: "DELETE",
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Error borrando importación");
      }

      await cargarDatos();
    } catch (error: any) {
      console.error(error);
      alert(error.message || "Error borrando importación");
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

  const standFiltrado = useMemo(() => {
    const fuente = [...turnosStand, ...turnosHistoricos];
    const claves = new Set<string>();

    const dataSinDuplicados = fuente.filter((t) => {
      const clave = crearHashTurno(t, t.archivo_key || "");
      if (claves.has(clave)) return false;
      claves.add(clave);
      return true;
    });

    return filtrarPorFecha(dataSinDuplicados).filter((t) => {
      // Excluye ventas anuladas/canceladas de la facturación. Filas en vivo traen
      // estado (hoy todas "activo"); las de Excel no tienen estado → se conservan.
      const estado = normalizeText(t.estado);
      if (estado === "anulado" || estado === "cancelado") return false;
      const texto = `${t.fecha} ${t.hora_bajada} ${t.hora_subida} ${t.simulador} ${t.escuderia} ${t.metodo_pago}`.toLowerCase();
      return texto.includes(busqueda.toLowerCase());
    });
  }, [turnosStand, turnosHistoricos, busqueda, fechaDesde, fechaHasta]);

  // Una importación = archivo + año: el mismo Excel puede estar cargado en dos años.
  const importaciones = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        archivo_key: string;
        anio: string;
        archivo_nombre: string;
        meses: Set<string>;
        ventas: number;
        facturacion: number;
      }
    >();

    turnosHistoricos.forEach((t) => {
      const archivoKey = t.archivo_key || "sin-key";
      const anio = (t.fecha || "").slice(0, 4);
      const key = `${archivoKey}|${anio}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          archivo_key: archivoKey,
          anio,
          archivo_nombre: t.archivo_nombre || archivoKey,
          meses: new Set(),
          ventas: 0,
          facturacion: 0,
        });
      }

      const item = map.get(key)!;
      item.meses.add((t.fecha || "").slice(5, 7));
      item.ventas += 1;
      item.facturacion += numberValue(t.total);
    });

    return Array.from(map.values())
      .map((imp) => {
        const meses = [...imp.meses].filter(Boolean).sort();
        return {
          ...imp,
          orden: `${imp.anio}-${meses[0] ?? ""}`,
          periodo: meses.length
            ? `${meses.map((m) => nombreMes(m)).join(", ")} ${imp.anio}`
            : "Sin fecha",
        };
      })
      .sort(
        (a, b) =>
          a.orden.localeCompare(b.orden) || a.archivo_nombre.localeCompare(b.archivo_nombre)
      );
  }, [turnosHistoricos]);

  // Años en los que ya está cargado cada archivo: reimportarlo con el MISMO año
  // no duplica (mismo hash_unico); con OTRO año crea ventas nuevas en ese año.
  const aniosImportadosPorArchivo = useMemo(() => {
    const map = new Map<string, Set<string>>();
    turnosHistoricos.forEach((t) => {
      const archivoKey = t.archivo_key || "";
      const anio = (t.fecha || "").slice(0, 4);
      if (!archivoKey || !anio) return;
      if (!map.has(archivoKey)) map.set(archivoKey, new Set());
      map.get(archivoKey)!.add(anio);
    });
    return map;
  }, [turnosHistoricos]);

  const revisionPendientes = useMemo(() => {
    const hoy = hoyEnSim();
    return pendientes.map((p) => {
      const { turnos, errores } = construirTurnos(
        p.analisis,
        p.anio ? Number(p.anio) : null,
        p.mes || null,
        hoy
      );
      const sinVentas = errores.length === 0 && turnos.length === 0;
      const aniosPrevios = [...(aniosImportadosPorArchivo.get(p.analisis.archivoKey) ?? [])].sort();
      return {
        turnos,
        errores: sinVentas ? ["No se encontraron ventas en las hojas de días."] : errores,
        bloqueado: sinVentas || errores.length > 0,
        aniosPrevios,
      };
    });
  }, [pendientes, aniosImportadosPorArchivo]);

  const opcionesIngresos = useMemo(() => {
    return opcionesPeriodo(standFiltrado, agrupacionIngresos);
  }, [standFiltrado, agrupacionIngresos]);

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

  const metricasStand = useMemo(() => {
    // KPIs numéricos centralizados en lib/metricasStand (mismo código que testea
    // el suite). ventas = filas; turnos = Σ cantidad_turnos; personas = Σ
    // cantidad_personas; minutos = turnos × 15; horas = minutos / 60.
    const agg = agregarStand(standFiltrado);
    const ventasRegistradas = agg.ventas;
    const facturacion = agg.facturacion;
    const totalTurnos = agg.turnos;
    const ticketPromedio = agg.ticketPromedio;
    const totalPersonas = agg.personas;
    const promedioPersonas = agg.promedioPersonas;
    const totalMinutos = agg.minutos;
    const horasVendidas = agg.horas;
    const ingresoPorMinuto = agg.ingresoPorMinuto;
    const ingresoPorPersona = agg.ingresoPorPersona;
    const ingresoPromedioPorSimulador = agg.ingresoPromedioPorSimulador;

    const porMetodoPago: Record<string, number> = {};
    const porSimulador: Record<string, number> = {};
    const porDuracion: Record<string, number> = {};
    const porPersonas: Record<string, number> = {};
    const porHora: Record<string, number> = {};
    const porDiaSemana: Record<string, number> = {};
    const ingresosPorMetodo: Record<string, number> = {};
    const ingresosPorDia: Record<string, number> = {};
    const tiemposSubidaSinDemora: number[] = [];
    const tiemposSubidaConDemora: number[] = [];
    const turnosConDemoraRanking: Array<
      TurnoStand & {
        demora_minutos: number;
        hora_tomado_calculada: string;
        hora_subida_calculada: string;
        hora_estimada_calculada: string;
      }
    > = [];

    standFiltrado.forEach((t) => {
      const monto = numberValue(t.total ?? t.monto);
      const metodo = normalizarMetodoPago(t.metodo_pago);
      const duracion = numberValue(t.duracion);
      const personasTurno = personasDeFila(t);
      const cantTurnos = numberValue(t.cantidad_turnos) || personasTurno || 1;
      const hora = obtenerHoraAgrupada(t.hora_subida || t.hora_bajada || t.hora_tomado);
      const diaSemana = nombreDia(t.fecha);
      const escuderiaRaw = t.escuderia || t.simulador || "";
      const horaTomado = obtenerHoraTomaTurno(t);
      const horaSubida = normalizarHora(t.hora_subida);
      const horaEstimadaSubida = normalizarHora(t.hora_estimada_subida);
      const tiempoHastaSubida = diferenciaSubidaMin(horaTomado, horaSubida);
      const tieneDemora = Boolean(horaEstimadaSubida);

      // Demora/subida: SOLO turnos del turnero (no datos importados de Excel).
      if (t.origen !== "excel" && tiempoHastaSubida !== null) {
        if (tieneDemora) {
          tiemposSubidaConDemora.push(tiempoHastaSubida);
          turnosConDemoraRanking.push({
            ...t,
            demora_minutos: tiempoHastaSubida,
            hora_tomado_calculada: normalizarHora(horaTomado),
            hora_subida_calculada: horaSubida,
            hora_estimada_calculada: horaEstimadaSubida,
          });
        } else {
          tiemposSubidaSinDemora.push(tiempoHastaSubida);
        }
      }

      if (metodo) {
        addToRecord(porMetodoPago, metodo, cantTurnos);
        addToRecord(ingresosPorMetodo, metodo, monto);
      }

      addToRecord(ingresosPorDia, t.fecha, monto);
      addToRecord(porHora, hora, cantTurnos);
      addToRecord(porDiaSemana, diaSemana, cantTurnos);

      // Solo duraciones válidas (múltiplos de 15) y 1–4 personas (4 simuladores).
      if (duracion > 0 && duracion % 15 === 0) addToRecord(porDuracion, `${duracion} min`, 1);
      if (personasTurno >= 1 && personasTurno <= 4)
        addToRecord(porPersonas, `${personasTurno} persona/s`, 1);

      // Simulador: en vivo viene en el array `simuladores`; en Excel, en el texto
      // escuderia/simulador. Si no se registró, la fila no aporta al desglose.
      const simsEnVivo = Array.isArray(t.simuladores)
        ? (t.simuladores as unknown[]).filter(
            (s): s is string => typeof s === "string" && s.trim() !== "",
          )
        : [];
      if (simsEnVivo.length) {
        simsEnVivo.forEach((sim) => addToRecord(porSimulador, sim, 1));
      } else {
        obtenerEscuderias(escuderiaRaw).forEach((escuderia) => {
          addToRecord(porSimulador, escuderia, 1);
        });
      }
    });

    const horaPico = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const mejorDiaFecha =
      Object.entries(ingresosPorDia).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const simuladorMasUsado =
      Object.entries(porSimulador).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const cantidadRankingDemora = Math.max(1, Math.floor(Number(limiteRankingDemora) || 5));
    const rankingMayoresDemoras = [...turnosConDemoraRanking]
      .sort((a, b) => b.demora_minutos - a.demora_minutos)
      .slice(0, cantidadRankingDemora);
    const turnoMayorDemora = rankingMayoresDemoras[0];
    // Turnos por duración, con la etiqueta de la modalidad de cada fila (lib/metricasStand).
    const porDuracionComparativo = comparativoStandPorDuracion(standFiltrado);
    const standTurnos15 = porDuracionComparativo.find((i) => i.label === "15 min")?.value ?? 0;
    const standTurnos30 = porDuracionComparativo.find((i) => i.label === "30 min")?.value ?? 0;

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
      promedioSubidaSinDemora: promedioNumeros(tiemposSubidaSinDemora),
      promedioSubidaConDemora: promedioNumeros(tiemposSubidaConDemora),
      cantidadTurnosConDemora: tiemposSubidaConDemora.length,
      cantidadTurnosSinDemoraMedidos: tiemposSubidaSinDemora.length,
      cantidadTurnosConDemoraMedidos: tiemposSubidaConDemora.length,
      turnoMayorDemora,
      rankingMayoresDemoras,
      porMetodoPago: toChart(porMetodoPago),
      porSimulador: toChart(porSimulador),
      porDuracion: toChart(porDuracion),
      porPersonas: toChart(porPersonas),
      porHora: chartPorHora(porHora),
      porDia: chartPorDiaSemana(porDiaSemana),
      ingresosPorPeriodo: agruparIngresos(
        standFiltrado,
        agrupacionIngresos,
        filtroIngresos
      ),
      ingresosPorMetodo: toChart(ingresosPorMetodo),
      turnos15min: standTurnos15,
      turnos30min: standTurnos30,
      porDuracionComparativo: porDuracionComparativo as ChartItem[],
    };
  }, [standFiltrado, agrupacionIngresos, filtroIngresos, limiteRankingDemora]);

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
    <main className="min-h-screen bg-[#050505] text-white">
      {pendientes.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 md:p-10"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-confirmar-anio"
        >
          <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-6">
            <h2 id="titulo-confirmar-anio" className="text-2xl font-bold text-white">
              Confirmá el mes y el año de cada Excel
            </h2>
            <p className="mt-2 text-sm text-white/60">
              No se guarda nada hasta que confirmes. El año no se toma de la fecha de hoy: si el
              archivo lo indica se propone, y si no, elegilo.
            </p>

            <div className="mt-6 space-y-4">
              {pendientes.map((p, i) => {
                const r = revisionPendientes[i];
                if (!r) return null;
                const faltaElegir = !p.mes || !p.anio;
                const yaEnEseAnio = Boolean(p.anio) && r.aniosPrevios.includes(p.anio);
                const enOtroAnio =
                  Boolean(p.anio) && r.aniosPrevios.length > 0 && !r.aniosPrevios.includes(p.anio);
                const fechas = r.turnos.map((t) => t.fecha).sort();
                const fmt = (f: string) => f.split("-").reverse().join("/");

                return (
                  <div
                    key={`${p.analisis.archivoKey}-${i}`}
                    className="rounded-xl border border-white/10 bg-black/30 p-4"
                  >
                    <p className="break-words font-semibold text-white">{p.analisis.nombre}</p>
                    <p className="mt-1 text-sm text-white/50">
                      {p.analisis.ventasLeidas} {p.analisis.ventasLeidas === 1 ? "venta" : "ventas"} en{" "}
                      {p.analisis.dias.length} {p.analisis.dias.length === 1 ? "hoja de día" : "hojas de días"} ·{" "}
                      {p.analisis.motivoAnio}
                    </p>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`importar-mes-${i}`} className="mb-1 block text-xs text-white/60">
                          Mes
                        </label>
                        <select
                          id={`importar-mes-${i}`}
                          value={p.mes}
                          onChange={(e) => actualizarPendiente(i, { mes: e.target.value })}
                          disabled={importando}
                          className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                        >
                          <option value="">Elegí el mes</option>
                          {[...new Set(Object.values(MESES))].map((m) => (
                            <option key={m} value={m}>
                              {capitalizar(nombreMes(m))}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`importar-anio-${i}`} className="mb-1 block text-xs text-white/60">
                          Año
                        </label>
                        <select
                          id={`importar-anio-${i}`}
                          value={p.anio}
                          onChange={(e) => actualizarPendiente(i, { anio: e.target.value })}
                          disabled={importando}
                          className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                        >
                          <option value="">Elegí el año</option>
                          {aniosSeleccionables(hoyEnSim()).map((a) => (
                            <option key={a} value={String(a)}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {faltaElegir ? (
                      <p className="mt-3 text-sm text-amber-300">Elegí el mes y el año para continuar.</p>
                    ) : r.errores.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-sm text-red-400">
                        {r.errores.slice(0, 5).map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                        {r.errores.length > 5 && <li>…y {r.errores.length - 5} más.</li>}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-emerald-300">
                        {r.turnos.length === 1
                          ? `Se importa 1 venta, del ${fmt(fechas[0])}.`
                          : `Se importan ${r.turnos.length} ventas, del ${fmt(fechas[0])} al ${fmt(fechas[fechas.length - 1])}.`}
                      </p>
                    )}

                    {yaEnEseAnio && (
                      <p className="mt-2 text-sm text-white/60">
                        Este archivo ya está importado en {p.anio}: las ventas repetidas se ignoran.
                      </p>
                    )}
                    {enOtroAnio && (
                      <p className="mt-2 text-sm text-amber-300">
                        Atención: este archivo ya está importado en {r.aniosPrevios.join(", ")}.
                        Importarlo como {p.anio} agrega sus ventas también en {p.anio}: entre años
                        distintos no se deduplican.
                      </p>
                    )}
                    {p.analisis.hojasIgnoradas.length > 0 && (
                      <p className="mt-2 text-xs text-white/45">
                        Hojas que no son un día y no se importan:{" "}
                        {p.analisis.hojasIgnoradas.join(", ")}.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => setPendientes([])}
                disabled={importando}
                className="rounded-xl border border-white/15 px-4 py-3 text-sm text-white/80 hover:bg-white/5 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarImportacion}
                disabled={importando || revisionPendientes.some((r) => r.bloqueado)}
                className="rounded-xl border border-red-500/40 bg-red-500/20 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {importando
                  ? "Importando..."
                  : `Importar ${pendientes.length} ${pendientes.length === 1 ? "archivo" : "archivos"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-sm uppercase tracking-[0.3em] text-red-500">
              Panel administrativo
            </p>
            <h1 className="text-4xl font-bold">Métricas de gestión</h1>
            <p className="mt-2 max-w-2xl text-white/60">
              Compará reservas online, turnos del stand y turnos históricos importados.
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

          <button
            onClick={() => setVista("campeonatos")}
            className={`rounded-xl px-6 py-3 text-sm font-bold ${
              vista === "campeonatos" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"
            }`}
          >
            Campeonatos
          </button>

          <button
            onClick={() => setVista("web")}
            className={`rounded-xl px-6 py-3 text-sm font-bold ${
              vista === "web" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"
            }`}
          >
            Web
          </button>

          {esAdmin && (
            <button
              onClick={() => setVista("equipo")}
              className={`rounded-xl px-6 py-3 text-sm font-bold ${
                vista === "equipo" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"
              }`}
            >
              Equipo
            </button>
          )}
        </div>

        {vista !== "web" && vista !== "equipo" && (
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
            ) : vista === "stand" ? (
              <div>
  <label className="mb-2 block text-sm text-white/70">Importar Excel</label>

  <label className="flex h-[50px] cursor-pointer items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 px-4 text-sm font-semibold text-white transition hover:bg-red-500/20">
    {importando ? "Importando..." : "Subir Excel"}
    <input
      key={turnosHistoricos.length}
      type="file"
      multiple
      accept=".xlsx,.xls,.csv"
      onChange={elegirExcel}
      disabled={importando}
      className="hidden"
    />
  </label>
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
        )}

        {vista === "equipo" ? (
          esAdmin ? <EquipoTab /> : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-10 text-center text-white/60">
              Sección disponible solo para administradores.
            </div>
          )
        ) : vista === "web" ? (
          <WebTab />
        ) : loading ? (
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
        ) : vista === "stand" ? (
          <>
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-sm text-white/60">
                Datos de Supabase actual: <b className="text-white">{turnosStand.length}</b> ·
                Históricos importados: <b className="text-white">{turnosHistoricos.length}</b>
              </p>
            </div>

            {importaciones.length > 0 && (
              <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <h3 className="mb-4 text-lg font-semibold text-white">Importaciones guardadas</h3>
                <div className="space-y-3">
                  {importaciones.map((imp) => (
                    <div
                      key={imp.key}
                      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="font-semibold text-white">{imp.archivo_nombre}</p>
                        <p className="text-sm text-white/50">
                          Período: {capitalizar(imp.periodo)} · Ventas: {imp.ventas} · Facturación: {formatMoney(imp.facturacion)}
                        </p>
                      </div>

                      <button
                        onClick={() => borrarImportacion(imp.archivo_key, imp.anio, imp.archivo_nombre)}
                        className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-white hover:bg-red-500/20"
                      >
                        Borrar importación
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <KpiCard title="Ventas registradas" value={String(metricasStand.ventasRegistradas)} />
              <KpiCard title="Turnos vendidos" value={String(metricasStand.totalTurnos)} />
              <KpiCard title="Facturación" value={formatMoney(metricasStand.facturacion)} />
              <KpiCard title="Ticket promedio" value={formatMoney(metricasStand.ticketPromedio)} />
              <KpiCard title="Personas" value={String(metricasStand.totalPersonas)} />
              <KpiCard title="Prom. personas" value={metricasStand.promedioPersonas.toFixed(2)} />
              <KpiCard title="Horas vendidas" value={metricasStand.horasVendidas.toFixed(1)} />
              <KpiCard title="Minutos vendidos" value={String(metricasStand.totalMinutos)} />
              <KpiCard title="Ingreso/minuto" value={formatMoney(metricasStand.ingresoPorMinuto)} />
              <KpiCard title="Ingreso/persona" value={formatMoney(metricasStand.ingresoPorPersona)} />
              <KpiCard title="Ingreso promedio/sim" value={formatMoney(metricasStand.ingresoPromedioPorSimulador)} />
              <KpiCard title="Mejor día" value={metricasStand.mejorDia} />
              <KpiCard
                title="Prom. subida sin demora"
                value={`${metricasStand.promedioSubidaSinDemora.toFixed(1)} min`}
                subtext={`${metricasStand.cantidadTurnosSinDemoraMedidos} turnos medidos`}
              />
              <KpiCard
                title="Prom. subida con demora"
                value={`${metricasStand.promedioSubidaConDemora.toFixed(1)} min`}
                subtext={`${metricasStand.cantidadTurnosConDemoraMedidos} turnos medidos`}
              />
              <KpiCard
                title="Turnos con demora"
                value={String(metricasStand.cantidadTurnosConDemora)}
                subtext="Con hora estimada cargada"
              />
            </div>

            <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Ranking de mayores demoras</h3>
                  <p className="mt-1 text-sm text-white/50">
                    Turnos con hora estimada cargada, ordenados por minutos entre toma del turno y subida real.
                  </p>
                </div>

                <div className="w-full md:w-48">
                  <label className="mb-2 block text-sm text-white/70">Cantidad a mostrar</label>
                  <input
                    type="number"
                    min={1}
                    value={limiteRankingDemora}
                    onChange={(e) =>
                      setLimiteRankingDemora(Math.max(1, Number(e.target.value) || 1))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                  />
                </div>
              </div>

              {metricasStand.rankingMayoresDemoras.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/50">
                  No hay turnos con demora en el período seleccionado.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-[0.18em] text-white/40">
                      <tr>
                        <th className="px-3 py-3">#</th>
                        <th className="px-3 py-3">Cliente</th>
                        <th className="px-3 py-3">Fecha</th>
                        <th className="px-3 py-3">Tomado</th>
                        <th className="px-3 py-3">Estimada</th>
                        <th className="px-3 py-3">Subida real</th>
                        <th className="px-3 py-3">Demora</th>
                        <th className="px-3 py-3">Simulador/es</th>
                        <th className="px-3 py-3">Pago</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metricasStand.rankingMayoresDemoras.map((turno, index) => (
                        <tr key={`${turno.id || turno.hash_unico || index}-${index}`} className="border-t border-white/10">
                          <td className="px-3 py-3 font-black text-red-500">#{index + 1}</td>
                          <td className="px-3 py-3">
                            <p className="font-semibold text-white">{turno.nombre || "Sin nombre"}</p>
                            <p className="text-xs text-white/45">{turno.telefono || "Sin teléfono"}</p>
                          </td>
                          <td className="px-3 py-3 text-white/75">{turno.fecha || "-"}</td>
                          <td className="px-3 py-3 text-white/75">{turno.hora_tomado_calculada || "-"}</td>
                          <td className="px-3 py-3 text-white/75">{turno.hora_estimada_calculada || "-"}</td>
                          <td className="px-3 py-3 text-white/75">{turno.hora_subida_calculada || "-"}</td>
                          <td className="px-3 py-3 font-black text-red-400">{turno.demora_minutos} min</td>
                          <td className="px-3 py-3 text-white/75">{obtenerSimuladoresTexto(turno)}</td>
                          <td className="px-3 py-3 text-white/75">{normalizarMetodoPago(turno.metodo_pago) || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-5 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm text-white/70">Agrupar ingresos por</label>
                  <select
                    value={agrupacionIngresos}
                    onChange={(e) => setAgrupacionIngresos(e.target.value as Agrupacion)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                  >
                    <option value="dia">Día</option>
                    <option value="semana">Semana</option>
                    <option value="mes">Mes</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-white/70">Período exacto</label>
                  <select
                    value={filtroIngresos}
                    onChange={(e) => setFiltroIngresos(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                  >
                    <option value="ultimos">Últimos 12 períodos</option>
                    <option value="todos">Todos</option>
                    {opcionesIngresos.map((op) => (
                      <option key={op.key} value={op.key}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <LineChart
                title="Ingresos por período"
                data={metricasStand.ingresosPorPeriodo}
                valueFormatter={formatMoney}
              />
            </div>

            <div className="mb-8 grid gap-6 xl:grid-cols-3">
              <PieChart title="Turnos por simulador" data={metricasStand.porSimulador} />
              <PieChart title="Turnos por método de pago" data={metricasStand.porMetodoPago} />
              <BarChart title="Ingresos por método de pago" data={metricasStand.ingresosPorMetodo} valueFormatter={formatMoney} />
              <BarChart title="Turnos por duración" data={metricasStand.porDuracion} />
              <BarChart title="Stand: turnos por duración" data={metricasStand.porDuracionComparativo} />
              <BarChart title="Turnos por cantidad de personas" data={metricasStand.porPersonas} />
              <BarChart title="Turnos por hora" data={metricasStand.porHora} />
              <BarChart title="Turnos por día de semana" data={metricasStand.porDia} />
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
      </div>
    </main>
  );
}
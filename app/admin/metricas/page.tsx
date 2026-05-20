"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Vista = "reservas" | "stand";
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
};

type TurnoStand = {
  id?: number;
  created_at?: string;
  fecha: string;
  hora_subida?: string;
  hora_bajada?: string;
  hora_tomado?: string;
  metodo_pago?: string;
  total?: number | string;
  monto?: number | string;
  cantidad_simuladores?: number;
  cantidad_turnos?: number;
  duracion?: number | string;
  escuderia?: string;
  simulador?: string;
  personas?: number | string;
  archivo_nombre?: string;
  archivo_key?: string;
  hash_unico?: string;
  origen?: string;
};

type ChartItem = {
  label: string;
  value: number;
};

function normalizeText(value: any) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
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
  if (  v.includes("trans") ||  v.includes("tranf") ||  v.includes("transfer") ||
  v.includes("transferencia")
)
  return "TRANSFERENCIA";

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

  if (h < 10 || h > 22) return null;

  return `${String(h).padStart(2, "0")} hs`;
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
  const corto = date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  });

  return `${capitalizar(dia)} ${corto}`;
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

function crearArchivoKey(fileName: string) {
  return normalizeText(fileName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function crearHashTurno(t: TurnoStand, archivoKey = "") {
  return [
    archivoKey || t.archivo_key || "",
    t.fecha || "",
    excelTimeToString(t.hora_tomado || ""),
    excelTimeToString(t.hora_subida || ""),
    excelTimeToString(t.hora_bajada || ""),
    normalizarMetodoPago(t.metodo_pago),
    numberValue(t.total ?? t.monto),
    numberValue(t.cantidad_simuladores || t.personas || 1),
    numberValue(t.cantidad_turnos || 1),
    numberValue(t.duracion || 0),
    normalizeText(t.escuderia || t.simulador || ""),
  ].join("|");
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

  if (agrupacion === "dia") {
    return {
      key: `${year}-${month}-${day}`,
      label: capitalizar(
        date.toLocaleDateString("es-AR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
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
      })} - ${end.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
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
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
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

export default function AdminMetricasPage() {
  const [vista, setVista] = useState<Vista>("reservas");

  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [turnosStand, setTurnosStand] = useState<TurnoStand[]>([]);
  const [turnosHistoricos, setTurnosHistoricos] = useState<TurnoStand[]>([]);

  const [loading, setLoading] = useState(true);
  const [importando, setImportando] = useState(false);

  const [quickPeriod, setQuickPeriod] = useState<QuickPeriod>("mes");
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"todas" | "activa" | "cancelada">("todas");

  const [agrupacionIngresos, setAgrupacionIngresos] = useState<Agrupacion>("semana");
  const [filtroIngresos, setFiltroIngresos] = useState("ultimos");

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

      const [resReservas, resStand, resHistoricos] = await Promise.all([
        fetch("/api/reservas", { cache: "no-store" }),
        fetch("/api/turnos-stand", { cache: "no-store" }),
        fetch("/api/turnos-historicos", { cache: "no-store" }),
      ]);

      const reservasJson = await resReservas.json();
      const standJson = await resStand.json();
      const historicosJson = await resHistoricos.json();

      setReservas(
        (Array.isArray(reservasJson) ? reservasJson : reservasJson.reservas || []).map(
          (r: Reserva) => ({
            ...r,
            simuladores: normalizeArray(r.simuladores),
          })
        )
      );

      setTurnosStand(Array.isArray(standJson) ? standJson : standJson.turnos || []);

      setTurnosHistoricos(
        (historicosJson.turnos || []).map((t: any) => ({
          ...t,
          simulador: t.escuderia || t.simulador || "",
          total: Number(t.total || 0),
        }))
      );
    } catch (error) {
      console.error(error);
      alert("Error cargando métricas");
    } finally {
      setLoading(false);
    }
  }

  async function leerExcel(file: File) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), {
      type: "array",
      cellDates: true,
    });

    const year = new Date().getFullYear();
    const month = monthFromFileName(file.name);
    const archivoKey = crearArchivoKey(file.name);

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
        const metodoPago = normalizarMetodoPago(
          getRowValue(row, ["Metodo de Pago", "Método de Pago", "Pago"])
        );

        if (!monto || monto <= 0) return;
        if (!metodoPago) return;

        const escuderia = String(
          getRowValue(row, ["Escuderia", "Escudería", "Simulador"]) || ""
        );

        const cantidadSimuladores =
          numberValue(getRowValue(row, ["Cant. de Sim.", "Cantidad de Sim", "Cant Sim"])) || 1;

        const cantidadTurnos =
          numberValue(getRowValue(row, ["Cant. Turnos", "Cantidad Turnos", "Turnos"])) ||
          cantidadSimuladores ||
          1;

        const duracion =
          numberValue(getRowValue(row, ["Tiempo (Min)", "Tiempo", "Duracion", "Duración"])) || 15;

        const turnoParseado: TurnoStand = {
          archivo_nombre: file.name,
          archivo_key: archivoKey,
          fecha,
          hora_tomado: excelTimeToString(
            getRowValue(row, ["Hora que se tomo el turno", "Hora tomado"])
          ),
          hora_subida: excelTimeToString(getRowValue(row, ["Hora de subida", "Hora subida"])),
          hora_bajada: excelTimeToString(getRowValue(row, ["Hora de bajada", "Hora bajada"])),
          metodo_pago: metodoPago,
          total: monto,
          cantidad_simuladores: cantidadSimuladores,
          cantidad_turnos: cantidadTurnos,
          duracion,
          escuderia,
          simulador: escuderia,
          origen: "excel",
        };

        const hash = crearHashTurno(turnoParseado, archivoKey);
        if (claves.has(hash)) return;

        claves.add(hash);
        turnoParseado.hash_unico = hash;
        turnosImportados.push(turnoParseado);
      });
    });

    return turnosImportados;
  }

  async function importarExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    try {
      setImportando(true);

      const resultados = await Promise.all(files.map((file) => leerExcel(file)));
      const turnos = resultados.flat();

      if (turnos.length === 0) {
        alert("No se encontraron turnos válidos en los Excel.");
        return;
      }

      const chunks: TurnoStand[][] = [];
      for (let i = 0; i < turnos.length; i += 500) {
        chunks.push(turnos.slice(i, i + 500));
      }

      for (const chunk of chunks) {
        const res = await fetch("/api/turnos-historicos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ turnos: chunk }),
        });

        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "Error guardando turnos históricos");
        }
      }

      await cargarDatos();

      const facturacion = turnos.reduce((acc, t) => acc + numberValue(t.total), 0);
      const turnosVendidos = turnos.reduce(
        (acc, t) => acc + numberValue(t.cantidad_turnos),
        0
      );

      alert(
        `Excel importado y guardado en Supabase.\nArchivos: ${files.length}\nVentas leídas: ${turnos.length}\nTurnos vendidos leídos: ${turnosVendidos}\nFacturación leída: ${formatMoney(facturacion)}`
      );
    } catch (error: any) {
      console.error(error);
      alert(error.message || "Error importando Excel");
    } finally {
  setImportando(false);

  if (e.target) {
    e.target.value = "";
  }

  window.location.reload();
}
  }

  async function borrarImportacion(archivoKey: string) {
    const confirmar = confirm("¿Seguro que querés borrar esta importación?");
    if (!confirmar) return;

    try {
      const res = await fetch(`/api/turnos-historicos?archivo_key=${archivoKey}`, {
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
      const texto = `${t.fecha} ${t.hora_bajada} ${t.hora_subida} ${t.simulador} ${t.escuderia} ${t.metodo_pago}`.toLowerCase();
      return texto.includes(busqueda.toLowerCase());
    });
  }, [turnosStand, turnosHistoricos, busqueda, fechaDesde, fechaHasta]);

  const importaciones = useMemo(() => {
    const map = new Map<
      string,
      { archivo_key: string; archivo_nombre: string; ventas: number; facturacion: number }
    >();

    turnosHistoricos.forEach((t) => {
      const key = t.archivo_key || "sin-key";
      if (!map.has(key)) {
        map.set(key, {
          archivo_key: key,
          archivo_nombre: t.archivo_nombre || key,
          ventas: 0,
          facturacion: 0,
        });
      }

      const item = map.get(key)!;
      item.ventas += 1;
      item.facturacion += numberValue(t.total);
    });

    return Array.from(map.values()).sort((a, b) =>
      a.archivo_nombre.localeCompare(b.archivo_nombre)
    );
  }, [turnosHistoricos]);

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
  return numberValue(t.cantidad_simuladores) || numberValue(t.personas) || 1;
});

    const promedioPersonas = ventasRegistradas ? totalPersonas / ventasRegistradas : 0;

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
    const ingresosPorMetodo: Record<string, number> = {};
    const ingresosPorDia: Record<string, number> = {};

    standFiltrado.forEach((t) => {
      const monto = numberValue(t.total ?? t.monto);
      const metodo = normalizarMetodoPago(t.metodo_pago);
      const duracion = numberValue(t.duracion);
      const sims = numberValue(t.cantidad_simuladores) || numberValue(t.personas) || 1;
      const cantTurnos = numberValue(t.cantidad_turnos) || sims || 1;
      const hora = obtenerHoraAgrupada(t.hora_subida || t.hora_bajada || t.hora_tomado);
      const diaSemana = nombreDia(t.fecha);
      const escuderiaRaw = t.escuderia || t.simulador || "";

      if (metodo) {
        addToRecord(porMetodoPago, metodo, cantTurnos);
        addToRecord(ingresosPorMetodo, metodo, monto);
      }

      addToRecord(ingresosPorDia, t.fecha, monto);
      addToRecord(porHora, hora, cantTurnos);
      addToRecord(porDiaSemana, diaSemana, cantTurnos);

      if (duracion > 0) addToRecord(porDuracion, `${duracion} min`, 1);
      if (sims > 0) addToRecord(porPersonas, `${sims} persona/s`, 1);

      obtenerEscuderias(escuderiaRaw).forEach((escuderia) => {
        addToRecord(porSimulador, escuderia, 1);
      });
    });

    const horaPico = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
    const mejorDiaFecha =
      Object.entries(ingresosPorDia).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const simuladorMasUsado =
      Object.entries(porSimulador).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

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
      ingresosPorPeriodo: agruparIngresos(
        standFiltrado,
        agrupacionIngresos,
        filtroIngresos
      ),
      ingresosPorMetodo: toChart(ingresosPorMetodo),
    };
  }, [standFiltrado, agrupacionIngresos, filtroIngresos]);

  const rangoTexto =
    !fechaDesde && !fechaHasta ? "Todo el histórico" : `${fechaDesde || "Inicio"} → ${fechaHasta || "Hoy"}`;

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

  <label className="flex h-[50px] cursor-pointer items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 px-4 text-sm font-semibold text-white transition hover:bg-red-500/20">
    {importando ? "Importando..." : "Subir Excel"}
    <input
      key={turnosHistoricos.length}
      type="file"
      multiple
      accept=".xlsx,.xls,.csv"
      onChange={importarExcel}
      disabled={importando}
      className="hidden"
    />
  </label>
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
                      key={imp.archivo_key}
                      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="font-semibold text-white">{imp.archivo_nombre}</p>
                        <p className="text-sm text-white/50">
                          Ventas: {imp.ventas} · Facturación: {formatMoney(imp.facturacion)}
                        </p>
                      </div>

                      <button
                        onClick={() => borrarImportacion(imp.archivo_key)}
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
              <KpiCard title="Hora pico" value={metricasStand.horaPico} />
              <KpiCard title="Mejor día" value={metricasStand.mejorDia} />
              <KpiCard title="Sim más usado" value={metricasStand.simuladorMasUsado} />
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
              <BarChart title="Turnos por cantidad de personas" data={metricasStand.porPersonas} />
              <BarChart title="Turnos por hora" data={metricasStand.porHora} />
              <BarChart title="Turnos por día de semana" data={metricasStand.porDia} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
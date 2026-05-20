"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Vista = "stand" | "reservas";

type TurnoStand = {
  id?: number;
  fecha?: string;
  simulador?: string;
  duracion?: number | string;
  personas?: number | string;
  metodo_pago?: string;
  posnet?: string;
  total?: number | string;
  monto?: number | string;
  estado?: string;
};

type Reserva = {
  id?: number;
  fecha?: string;
  hora?: string;
  simuladores?: string[] | any;
  cantidad_turnos?: number;
  total?: number | string;
  estado?: string;
};

function normalizarTexto(valor: any) {
  return String(valor ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function numero(valor: any) {
  if (valor === null || valor === undefined || valor === "") return 0;
  if (typeof valor === "number") return valor;

  return Number(
    String(valor)
      .replace("$", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .trim()
  ) || 0;
}

function contarPorCampo(data: any[], campo: string) {
  return data.reduce((acc: Record<string, number>, item) => {
    const valor = item[campo] || "Sin dato";
    acc[valor] = (acc[valor] || 0) + 1;
    return acc;
  }, {});
}

function Card({ titulo, valor }: { titulo: string; valor: string | number }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-lg">
      <p className="text-sm text-zinc-400">{titulo}</p>
      <p className="mt-2 text-3xl font-black text-white">{valor}</p>
    </div>
  );
}

function TablaSimple({
  titulo,
  data,
}: {
  titulo: string;
  data: Record<string, number>;
}) {
  const entries = Object.entries(data);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <h3 className="mb-4 text-lg font-bold text-white">{titulo}</h3>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin datos.</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3 text-sm"
            >
              <span className="text-zinc-300">{key}</span>
              <span className="font-bold text-white">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MetricasGestionPage() {
  const [vista, setVista] = useState<Vista>("stand");
  const [turnosStand, setTurnosStand] = useState<TurnoStand[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [excelStand, setExcelStand] = useState<TurnoStand[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    try {
      setCargando(true);

      const [resStand, resReservas] = await Promise.all([
        fetch("/api/turnos-stand"),
        fetch("/api/reservas"),
      ]);

      const standJson = await resStand.json();
      const reservasJson = await resReservas.json();

      setTurnosStand(Array.isArray(standJson) ? standJson : standJson.turnos || []);
      setReservas(Array.isArray(reservasJson) ? reservasJson : reservasJson.reservas || []);
    } catch (error) {
      console.error("Error cargando métricas:", error);
    } finally {
      setCargando(false);
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

      const turnosParseados = rows.map((row) => {
        const nuevo: any = {};

        Object.keys(row).forEach((key) => {
          const k = normalizarTexto(key);

          if (k.includes("fecha")) nuevo.fecha = row[key];
          if (k.includes("simu")) nuevo.simulador = row[key];
          if (k.includes("duracion")) nuevo.duracion = row[key];
          if (k.includes("persona")) nuevo.personas = row[key];
          if (k.includes("metodo") || k.includes("pago")) nuevo.metodo_pago = row[key];
          if (k.includes("posnet")) nuevo.posnet = row[key];
          if (k.includes("total") || k.includes("monto") || k.includes("facturado"))
            nuevo.total = row[key];
        });

        return nuevo;
      });

      setExcelStand(turnosParseados);
    };

    reader.readAsArrayBuffer(file);
  }

  const datosStand = useMemo(() => {
    return [...turnosStand, ...excelStand];
  }, [turnosStand, excelStand]);

  const metricasStand = useMemo(() => {
    const totalTurnos = datosStand.length;
    const facturacion = datosStand.reduce(
      (acc, item) => acc + numero(item.total ?? item.monto),
      0
    );

    return {
      totalTurnos,
      facturacion,
      porMetodoPago: contarPorCampo(datosStand, "metodo_pago"),
      porPosnet: contarPorCampo(datosStand, "posnet"),
      porSimulador: contarPorCampo(datosStand, "simulador"),
      porDuracion: contarPorCampo(datosStand, "duracion"),
      porPersonas: contarPorCampo(datosStand, "personas"),
    };
  }, [datosStand]);

  const metricasReservas = useMemo(() => {
    const activas = reservas.filter((r) => r.estado !== "cancelada");
    const canceladas = reservas.filter((r) => r.estado === "cancelada");

    const facturacion = activas.reduce((acc, r) => acc + numero(r.total), 0);

    const simuladores: Record<string, number> = {};

    activas.forEach((r) => {
      const sims = Array.isArray(r.simuladores)
        ? r.simuladores
        : typeof r.simuladores === "string"
        ? [r.simuladores]
        : [];

      sims.forEach((sim) => {
        simuladores[sim] = (simuladores[sim] || 0) + 1;
      });
    });

    return {
      totalReservas: reservas.length,
      activas: activas.length,
      canceladas: canceladas.length,
      facturacion,
      porSimulador: simuladores,
    };
  }, [reservas]);

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-red-500">
              SIM Argentina
            </p>
            <h1 className="mt-2 text-4xl font-black">Métricas de gestión</h1>
            <p className="mt-2 text-zinc-400">
              Elegí si querés analizar turnos del stand o reservas online.
            </p>
          </div>

          <div className="flex rounded-2xl border border-zinc-800 bg-zinc-950 p-1">
            <button
              onClick={() => setVista("stand")}
              className={`rounded-xl px-6 py-3 text-sm font-bold transition ${
                vista === "stand"
                  ? "bg-red-600 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Stand
            </button>

            <button
              onClick={() => setVista("reservas")}
              className={`rounded-xl px-6 py-3 text-sm font-bold transition ${
                vista === "reservas"
                  ? "bg-red-600 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Reservas
            </button>
          </div>
        </div>

        {cargando && (
          <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-400">
            Cargando métricas...
          </div>
        )}

        {vista === "stand" && (
          <>
            <section className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
              <h2 className="text-xl font-bold">Importar Excel del stand</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Subí un archivo Excel y se sumará a las métricas actuales.
              </p>

              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={importarExcel}
                className="mt-5 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300"
              />

              {excelStand.length > 0 && (
                <p className="mt-3 text-sm text-green-500">
                  Se importaron {excelStand.length} turnos desde Excel.
                </p>
              )}
            </section>

            <section className="grid gap-5 md:grid-cols-3">
              <Card titulo="Turnos totales" valor={metricasStand.totalTurnos} />
              <Card
                titulo="Facturación total"
                valor={`$${metricasStand.facturacion.toLocaleString("es-AR")}`}
              />
              <Card titulo="Datos importados de Excel" valor={excelStand.length} />
            </section>

            <section className="mt-8 grid gap-5 md:grid-cols-2">
              <TablaSimple titulo="Turnos por método de pago" data={metricasStand.porMetodoPago} />
              <TablaSimple titulo="Turnos por posnet" data={metricasStand.porPosnet} />
              <TablaSimple titulo="Turnos por simulador" data={metricasStand.porSimulador} />
              <TablaSimple titulo="Turnos por duración" data={metricasStand.porDuracion} />
              <TablaSimple titulo="Turnos por cantidad de personas" data={metricasStand.porPersonas} />
            </section>
          </>
        )}

        {vista === "reservas" && (
          <>
            <section className="grid gap-5 md:grid-cols-4">
              <Card titulo="Reservas totales" valor={metricasReservas.totalReservas} />
              <Card titulo="Reservas activas" valor={metricasReservas.activas} />
              <Card titulo="Reservas canceladas" valor={metricasReservas.canceladas} />
              <Card
                titulo="Facturación reservas"
                valor={`$${metricasReservas.facturacion.toLocaleString("es-AR")}`}
              />
            </section>

            <section className="mt-8 grid gap-5 md:grid-cols-2">
              <TablaSimple titulo="Reservas por simulador" data={metricasReservas.porSimulador} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
"use client";

import { useEffect, useMemo, useState } from "react";

type Reserva = {
  id: number;
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[] | string;
  cantidad_turnos?: number;
  total?: number;
  estado?: string;
  created_at?: string;
};

type Filtro = "dia" | "semana" | "mes" | "personalizado";

function normalizarSimuladores(simuladores: Reserva["simuladores"]) {
  if (Array.isArray(simuladores)) return simuladores;

  try {
    const parsed = JSON.parse(simuladores);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fechaLocalISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function horaBonita(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  const fecha = new Date();
  fecha.setHours(h, m, 0, 0);

  return fecha.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function sumar20Minutos(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  const fecha = new Date();
  fecha.setHours(h, m + 20, 0, 0);

  return fecha.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function inicioSemana(date: Date) {
  const copia = new Date(date);
  const dia = copia.getDay();
  const diferencia = dia === 0 ? -6 : 1 - dia;

  copia.setDate(copia.getDate() + diferencia);
  copia.setHours(0, 0, 0, 0);

  return copia;
}

function finSemana(date: Date) {
  const inicio = inicioSemana(date);
  const fin = new Date(inicio);

  fin.setDate(inicio.getDate() + 6);
  fin.setHours(23, 59, 59, 999);

  return fin;
}

function formatearTotal(total?: number) {
  if (!total) return "Sin total";

  return `$${Number(total).toLocaleString("es-AR")}`;
}

export default function CalendarioAdminPage() {
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);

  const [filtro, setFiltro] = useState<Filtro>("semana");
  const [fechaElegida, setFechaElegida] = useState(fechaLocalISO());
  const [fechaDesde, setFechaDesde] = useState(fechaLocalISO());
  const [fechaHasta, setFechaHasta] = useState(fechaLocalISO());

  const [busqueda, setBusqueda] = useState("");

  const [reservaSeleccionada, setReservaSeleccionada] =
    useState<Reserva | null>(null);

  useEffect(() => {
    async function cargarReservas() {
      try {
        const res = await fetch("/api/reservas", {
          cache: "no-store",
        });

        const data = await res.json();

        if (!res.ok) {
          console.error("Error al cargar reservas:", data);
          return;
        }

        setReservas(data.reservas || data || []);
      } catch (error) {
        console.error("Error al cargar reservas:", error);
      } finally {
        setLoading(false);
      }
    }

    cargarReservas();
  }, []);

  const reservasFiltradas = useMemo(() => {
    return reservas
      .filter((reserva) => reserva.estado !== "cancelada")
      .filter((reserva) => {
        const texto = busqueda.toLowerCase().trim();

        if (!texto) return true;

        return (
          reserva.nombre?.toLowerCase().includes(texto) ||
          reserva.telefono?.toLowerCase().includes(texto)
        );
      })
      .filter((reserva) => {
        const fechaReserva = new Date(`${reserva.fecha}T00:00:00`);

        if (filtro === "dia") {
          return reserva.fecha === fechaElegida;
        }

        if (filtro === "semana") {
          const fechaBase = new Date(`${fechaElegida}T00:00:00`);

          return (
            fechaReserva >= inicioSemana(fechaBase) &&
            fechaReserva <= finSemana(fechaBase)
          );
        }

        if (filtro === "mes") {
          const fechaBase = new Date(`${fechaElegida}T00:00:00`);

          return (
            fechaReserva.getFullYear() === fechaBase.getFullYear() &&
            fechaReserva.getMonth() === fechaBase.getMonth()
          );
        }

        if (filtro === "personalizado") {
          const desde = new Date(`${fechaDesde}T00:00:00`);
          const hasta = new Date(`${fechaHasta}T23:59:59`);

          return fechaReserva >= desde && fechaReserva <= hasta;
        }

        return true;
      })
      .sort((a, b) => {
        const fechaHoraA = new Date(`${a.fecha}T${a.hora}`);
        const fechaHoraB = new Date(`${b.fecha}T${b.hora}`);

        return fechaHoraA.getTime() - fechaHoraB.getTime();
      });
  }, [reservas, filtro, fechaElegida, fechaDesde, fechaHasta, busqueda]);

  const reservasPorFecha = useMemo(() => {
    return reservasFiltradas.reduce<Record<string, Reserva[]>>(
      (acc, reserva) => {
        if (!acc[reserva.fecha]) acc[reserva.fecha] = [];
        acc[reserva.fecha].push(reserva);
        return acc;
      },
      {}
    );
  }, [reservasFiltradas]);

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <p>Cargando calendario...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <section className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="mb-2 text-sm uppercase tracking-[0.3em] text-red-500">
            Admin SIM
          </p>

          <h1 className="text-3xl font-black uppercase md:text-5xl">
            Calendario de reservas
          </h1>

          <p className="mt-3 max-w-2xl text-white/60">
            Visualizá reservas activas por día, semana, mes, período
            personalizado, nombre o teléfono.
          </p>
        </div>

        <div className="mb-8 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                Filtrar por
              </p>

              <div className="flex flex-wrap gap-2">
                {[
                  { key: "dia", label: "Día" },
                  { key: "semana", label: "Semana" },
                  { key: "mes", label: "Mes" },
                  { key: "personalizado", label: "Personalizado" },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setFiltro(item.key as Filtro)}
                    className={`rounded-full px-5 py-2 text-sm font-black uppercase transition ${
                      filtro === item.key
                        ? "bg-red-600 text-white"
                        : "border border-white/15 text-white/70 hover:border-red-500 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Buscar reserva
                </label>

                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre o teléfono..."
                  className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none placeholder:text-white/30 focus:border-red-500 md:w-[360px]"
                />
              </div>
            </div>

            {filtro !== "personalizado" ? (
              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Fecha
                </label>

                <input
                  type="date"
                  value={fechaElegida}
                  onChange={(e) => setFechaElegida(e.target.value)}
                  className="rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row">
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                    Desde
                  </label>

                  <input
                    type="date"
                    value={fechaDesde}
                    onChange={(e) => setFechaDesde(e.target.value)}
                    className="rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                    Hasta
                  </label>

                  <input
                    type="date"
                    value={fechaHasta}
                    onChange={(e) => setFechaHasta(e.target.value)}
                    className="rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {reservasFiltradas.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
            <p className="text-white/70">
              No hay reservas activas para este filtro.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(reservasPorFecha).map(([fecha, reservasDelDia]) => (
              <div
                key={fecha}
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl"
              >
                <h2 className="mb-5 text-xl font-black uppercase text-red-500">
                  {fecha}
                </h2>

                <div className="grid gap-4">
                  {reservasDelDia.map((reserva) => {
                    const simuladores =
                      normalizarSimuladores(reserva.simuladores);

                    return (
                      <button
                        key={reserva.id}
                        onClick={() => setReservaSeleccionada(reserva)}
                        className="w-full rounded-2xl border border-white/10 bg-black p-5 text-left transition hover:border-red-500 hover:bg-red-950/20"
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-lg font-black uppercase">
                              {horaBonita(reserva.hora)} -{" "}
                              {sumar20Minutos(reserva.hora)}
                            </p>

                            <p className="mt-1 text-white/70">
                              {reserva.nombre}
                            </p>

                            <p className="mt-1 text-sm text-white/40">
                              {reserva.telefono || "Sin teléfono"}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <span className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white">
                              {simuladores.length}{" "}
                              {simuladores.length === 1
                                ? "simulador"
                                : "simuladores"}
                            </span>

                            <span className="rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white/80">
                              Ver detalles
                            </span>
                          </div>
                        </div>

                        {simuladores.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {simuladores.map((simulador) => (
                              <span
                                key={simulador}
                                className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase text-white/80"
                              >
                                {simulador}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {reservaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6 text-white shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-red-500">
                  Detalle de reserva
                </p>

                <h3 className="mt-2 text-2xl font-black uppercase">
                  {reservaSeleccionada.nombre}
                </h3>
              </div>

              <button
                onClick={() => setReservaSeleccionada(null)}
                className="rounded-full border border-white/15 px-3 py-1 text-sm font-bold hover:bg-white hover:text-black"
              >
                X
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="rounded-2xl bg-white/[0.04] p-4">
                <p className="text-white/50">Fecha</p>
                <p className="text-lg font-bold">{reservaSeleccionada.fecha}</p>
              </div>

              <div className="rounded-2xl bg-white/[0.04] p-4">
                <p className="text-white/50">Horario</p>
                <p className="text-lg font-bold">
                  {horaBonita(reservaSeleccionada.hora)} -{" "}
                  {sumar20Minutos(reservaSeleccionada.hora)}
                </p>
              </div>

              <div className="rounded-2xl bg-white/[0.04] p-4">
                <p className="text-white/50">Teléfono</p>
                <p className="text-lg font-bold">
                  {reservaSeleccionada.telefono || "Sin teléfono"}
                </p>
              </div>

              <div className="rounded-2xl bg-white/[0.04] p-4">
                <p className="text-white/50">Simuladores usados</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {normalizarSimuladores(reservaSeleccionada.simuladores)
                    .length > 0 ? (
                    normalizarSimuladores(
                      reservaSeleccionada.simuladores
                    ).map((simulador) => (
                      <span
                        key={simulador}
                        className="rounded-full bg-red-600 px-3 py-1 text-xs font-black uppercase"
                      >
                        {simulador}
                      </span>
                    ))
                  ) : (
                    <p className="text-white/60">Sin simuladores cargados</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="text-white/50">Cantidad</p>
                  <p className="text-lg font-bold">
                    {
                      normalizarSimuladores(reservaSeleccionada.simuladores)
                        .length
                    }
                  </p>
                </div>

                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="text-white/50">Total</p>
                  <p className="text-lg font-bold">
                    {formatearTotal(reservaSeleccionada.total)}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setReservaSeleccionada(null)}
              className="mt-6 w-full rounded-2xl bg-red-600 px-5 py-3 font-black uppercase text-white transition hover:bg-red-700"
            >
              Cerrar detalles
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
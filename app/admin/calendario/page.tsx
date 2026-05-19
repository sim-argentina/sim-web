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

function normalizarSimuladores(simuladores: Reserva["simuladores"]) {
  if (Array.isArray(simuladores)) return simuladores;

  try {
    const parsed = JSON.parse(simuladores);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sumar20Minutos(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  const fecha = new Date();
  fecha.setHours(h, m + 20, 0, 0);

  return fecha.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CalendarioAdminPage() {
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
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

  const reservasOrdenadas = useMemo(() => {
    return [...reservas]
      .filter((reserva) => reserva.estado !== "cancelada")
      .sort((a, b) => {
        const fechaA = `${a.fecha} ${a.hora}`;
        const fechaB = `${b.fecha} ${b.hora}`;
        return fechaA.localeCompare(fechaB);
      });
  }, [reservas]);

  const reservasPorFecha = useMemo(() => {
    return reservasOrdenadas.reduce<Record<string, Reserva[]>>(
      (acc, reserva) => {
        if (!acc[reserva.fecha]) acc[reserva.fecha] = [];
        acc[reserva.fecha].push(reserva);
        return acc;
      },
      {}
    );
  }, [reservasOrdenadas]);

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
            Visualizá las reservas activas, la cantidad de simuladores ocupados
            y los detalles de cada turno.
          </p>
        </div>

        {reservasOrdenadas.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
            <p className="text-white/70">No hay reservas activas cargadas.</p>
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
                              {reserva.hora} - {sumar20Minutos(reserva.hora)}
                            </p>

                            <p className="mt-1 text-white/70">
                              {reserva.nombre}
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
                  {reservaSeleccionada.hora} -{" "}
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
                    {reservaSeleccionada.total
                      ? `$${reservaSeleccionada.total.toLocaleString("es-AR")}`
                      : "Sin total"}
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
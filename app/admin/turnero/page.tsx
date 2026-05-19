"use client";

import { useEffect, useMemo, useState } from "react";

type TurnoStand = {
  id: number;
  created_at?: string;
  nombre?: string;
  telefono?: string;
  fecha: string;
  hora: string;
  simuladores: string[];
  cantidad_simuladores: number;
  cantidad_turnos: number;
  duracion_minutos: number;
  total: number;
  metodo_pago: string;
  estado: string;
  observaciones?: string;
};

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"];

const HORARIOS = [
  "10:00", "10:20", "10:40",
  "11:00", "11:20", "11:40",
  "12:00", "12:20", "12:40",
  "13:00", "13:20", "13:40",
  "14:00", "14:20", "14:40",
  "15:00", "15:20", "15:40",
  "16:00", "16:20", "16:40",
  "17:00", "17:20", "17:40",
  "18:00", "18:20", "18:40",
  "19:00", "19:20", "19:40",
  "20:00", "20:20", "20:40",
  "21:00", "21:20", "21:40",
];

function fechaLocalISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function TurneroAdminPage() {
  const [turnos, setTurnos] = useState<TurnoStand[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const [fecha, setFecha] = useState(fechaLocalISO());
  const [hora, setHora] = useState("10:00");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [simuladores, setSimuladores] = useState<string[]>([]);
  const [cantidadTurnos, setCantidadTurnos] = useState(1);
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [total, setTotal] = useState("");
  const [observaciones, setObservaciones] = useState("");

  async function cargarTurnos() {
    try {
      const res = await fetch("/api/turnos-stand", {
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(data);
        return;
      }

      setTurnos(data.turnos || []);
    } catch (error) {
      console.error("Error cargando turnos:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarTurnos();
  }, []);

  const turnosDelDia = useMemo(() => {
    return turnos
      .filter((turno) => turno.fecha === fecha)
      .filter((turno) => turno.estado !== "cancelado")
      .sort((a, b) => a.hora.localeCompare(b.hora));
  }, [turnos, fecha]);

  const simuladoresOcupados = useMemo(() => {
    return turnosDelDia
      .filter((turno) => turno.hora === hora)
      .flatMap((turno) => turno.simuladores || []);
  }, [turnosDelDia, hora]);

  function toggleSimulador(simulador: string) {
    if (simuladoresOcupados.includes(simulador)) return;

    setSimuladores((actuales) =>
      actuales.includes(simulador)
        ? actuales.filter((s) => s !== simulador)
        : [...actuales, simulador]
    );
  }

  async function crearTurno(e: React.FormEvent) {
    e.preventDefault();

    if (!fecha || !hora) {
      alert("Falta fecha u horario.");
      return;
    }

    if (simuladores.length === 0) {
      alert("Seleccioná al menos un simulador.");
      return;
    }

    setGuardando(true);

    try {
      const res = await fetch("/api/turnos-stand", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre,
          telefono,
          fecha,
          hora,
          simuladores,
          cantidad_turnos: cantidadTurnos,
          metodo_pago: metodoPago,
          total: Number(total) || 0,
          observaciones,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Error creando turno.");
        return;
      }

      setNombre("");
      setTelefono("");
      setSimuladores([]);
      setCantidadTurnos(1);
      setMetodoPago("efectivo");
      setTotal("");
      setObservaciones("");

      await cargarTurnos();
    } catch (error) {
      console.error(error);
      alert("Error creando turno.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <section className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="mb-2 text-sm uppercase tracking-[0.3em] text-red-500">
            Admin SIM
          </p>

          <h1 className="text-3xl font-black uppercase md:text-5xl">
            Turnero del stand
          </h1>

          <p className="mt-3 max-w-2xl text-white/60">
            Cargá turnos de clientes que llegan al stand sin reserva online.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <form
            onSubmit={crearTurno}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
          >
            <h2 className="mb-5 text-xl font-black uppercase text-red-500">
              Nuevo turno
            </h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Fecha
                </label>

                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => {
                    setFecha(e.target.value);
                    setSimuladores([]);
                  }}
                  className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Horario
                </label>

                <select
                  value={hora}
                  onChange={(e) => {
                    setHora(e.target.value);
                    setSimuladores([]);
                  }}
                  className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                >
                  {HORARIOS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Cliente
                </label>

                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombre del cliente"
                  className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Teléfono
                </label>

                <input
                  type="text"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="351..."
                  className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Simuladores
                </label>

                <div className="grid grid-cols-2 gap-2">
                  {SIMULADORES.map((simulador) => {
                    const ocupado = simuladoresOcupados.includes(simulador);
                    const seleccionado = simuladores.includes(simulador);

                    return (
                      <button
                        key={simulador}
                        type="button"
                        disabled={ocupado}
                        onClick={() => toggleSimulador(simulador)}
                        className={`rounded-2xl border px-4 py-3 text-sm font-black uppercase transition ${
                          ocupado
                            ? "cursor-not-allowed border-white/5 bg-white/5 text-white/20"
                            : seleccionado
                            ? "border-red-500 bg-red-600 text-white"
                            : "border-white/15 bg-black text-white/70 hover:border-red-500 hover:text-white"
                        }`}
                      >
                        {simulador}
                        {ocupado ? " ocupado" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                    Cantidad turnos
                  </label>

                  <input
                    type="number"
                    min={1}
                    value={cantidadTurnos}
                    onChange={(e) => setCantidadTurnos(Number(e.target.value))}
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                    Total
                  </label>

                  <input
                    type="number"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none placeholder:text-white/30 focus:border-red-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Método de pago
                </label>

                <select
                  value={metodoPago}
                  onChange={(e) => setMetodoPago(e.target.value)}
                  className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="mercado_pago">Mercado Pago</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                  Observaciones
                </label>

                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Notas internas..."
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </div>

              <button
                type="submit"
                disabled={guardando}
                className="w-full rounded-2xl bg-red-600 px-5 py-4 font-black uppercase text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
              >
                {guardando ? "Guardando..." : "Guardar turno"}
              </button>
            </div>
          </form>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-black uppercase text-red-500">
                  Turnos del día
                </h2>

                <p className="text-sm text-white/50">{fecha}</p>
              </div>

              <div className="rounded-full border border-white/10 px-4 py-2 text-sm font-bold text-white/70">
                {turnosDelDia.length} turnos cargados
              </div>
            </div>

            {loading ? (
              <p className="text-white/60">Cargando turnos...</p>
            ) : turnosDelDia.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black p-6">
                <p className="text-white/60">
                  No hay turnos cargados para esta fecha.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[90px_1.2fr_1fr_1fr_100px] bg-red-600 text-xs font-black uppercase text-white">
                  <div className="p-3">Hora</div>
                  <div className="p-3">Cliente</div>
                  <div className="p-3">Simuladores</div>
                  <div className="p-3">Pago</div>
                  <div className="p-3 text-right">Total</div>
                </div>

                {turnosDelDia.map((turno) => (
                  <div
                    key={turno.id}
                    className="grid grid-cols-[90px_1.2fr_1fr_1fr_100px] border-t border-white/10 bg-black text-sm text-white/80"
                  >
                    <div className="p-3 font-black">{turno.hora}</div>

                    <div className="p-3">
                      <p className="font-bold">
                        {turno.nombre || "Sin nombre"}
                      </p>
                      <p className="text-xs text-white/40">
                        {turno.telefono || "Sin teléfono"}
                      </p>
                    </div>

                    <div className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {(turno.simuladores || []).map((sim) => (
                          <span
                            key={sim}
                            className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold uppercase"
                          >
                            {sim}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-3 capitalize">
                      {turno.metodo_pago?.replace("_", " ") || "Sin dato"}
                    </div>

                    <div className="p-3 text-right font-black">
                      ${Number(turno.total || 0).toLocaleString("es-AR")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
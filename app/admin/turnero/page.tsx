"use client";

import { useEffect, useMemo, useState } from "react";

type TurnoStand = {
  id: number;
  nombre?: string;
  telefono?: string;
  fecha: string;
  hora: string;
  hora_estimada_subida?: string;
  hora_subida?: string;
  simuladores: string[];
  cantidad_simuladores: number;
  cantidad_personas: number;
  cantidad_minutos: number;
  cantidad_turnos: number;
  total: number;
  metodo_pago: string;
  estado: string;
  observaciones?: string;
};

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"];

function fechaLocalISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function horaActual() {
  const date = new Date();
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export default function TurneroAdminPage() {
  const [turnos, setTurnos] = useState<TurnoStand[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const [fecha, setFecha] = useState(fechaLocalISO());
  const [hora, setHora] = useState(horaActual());
  const [horaEstimadaSubida, setHoraEstimadaSubida] = useState("");
  const [horaSubida, setHoraSubida] = useState("");

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [simuladores, setSimuladores] = useState<string[]>([]);

  const [cantidadPersonas, setCantidadPersonas] = useState(1);
  const [cantidadMinutos, setCantidadMinutos] = useState(15);
  const [cantidadTurnos, setCantidadTurnos] = useState(1);

  const [metodoPago, setMetodoPago] = useState("qr");
  const [total, setTotal] = useState("");
  const [observaciones, setObservaciones] = useState("");

  async function cargarTurnos() {
    try {
      const res = await fetch("/api/turnos-stand", { cache: "no-store" });
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

  function toggleSimulador(simulador: string) {
    setSimuladores((actuales) =>
      actuales.includes(simulador)
        ? actuales.filter((s) => s !== simulador)
        : [...actuales, simulador]
    );
  }

  async function crearTurno(e: React.FormEvent) {
    e.preventDefault();

    if (!fecha || !hora) {
      alert("Falta fecha u hora de toma.");
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
          hora_estimada_subida: horaEstimadaSubida,
          hora_subida: horaSubida,
          simuladores,
          cantidad_personas: cantidadPersonas,
          cantidad_minutos: cantidadMinutos,
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

      setHora(horaActual());
      setHoraEstimadaSubida("");
      setHoraSubida("");
      setNombre("");
      setTelefono("");
      setSimuladores([]);
      setCantidadPersonas(1);
      setCantidadMinutos(15);
      setCantidadTurnos(1);
      setMetodoPago("qr");
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
            Cargá turnos tomados en el stand, con horario real de toma,
            estimación de subida y horario efectivo de subida.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[460px_1fr]">
          <form
            onSubmit={crearTurno}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
          >
            <h2 className="mb-5 text-xl font-black uppercase text-red-500">
              Nuevo turno
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Fecha
                  </label>

                  <input
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Hora toma
                  </label>

                  <input
                    type="time"
                    value={hora}
                    onChange={(e) => setHora(e.target.value)}
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Hora estimada subida
                  </label>

                  <input
                    type="time"
                    value={horaEstimadaSubida}
                    onChange={(e) => setHoraEstimadaSubida(e.target.value)}
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Hora subida real
                  </label>

                  <input
                    type="time"
                    value={horaSubida}
                    onChange={(e) => setHoraSubida(e.target.value)}
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
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
                <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
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
                <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                  Simuladores
                </label>

                <div className="grid grid-cols-2 gap-2">
                  {SIMULADORES.map((simulador) => {
                    const seleccionado = simuladores.includes(simulador);

                    return (
                      <button
                        key={simulador}
                        type="button"
                        onClick={() => toggleSimulador(simulador)}
                        className={`rounded-2xl border px-4 py-3 text-sm font-black uppercase transition ${
                          seleccionado
                            ? "border-red-500 bg-red-600 text-white"
                            : "border-white/15 bg-black text-white/70 hover:border-red-500 hover:text-white"
                        }`}
                      >
                        {simulador}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Personas
                  </label>

                  <input
                    type="number"
                    min={1}
                    value={cantidadPersonas}
                    onChange={(e) =>
                      setCantidadPersonas(Number(e.target.value))
                    }
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Minutos
                  </label>

                  <input
                    type="number"
                    min={1}
                    value={cantidadMinutos}
                    onChange={(e) =>
                      setCantidadMinutos(Number(e.target.value))
                    }
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Turnos
                  </label>

                  <input
                    type="number"
                    min={1}
                    value={cantidadTurnos}
                    onChange={(e) =>
                      setCantidadTurnos(Number(e.target.value))
                    }
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Método pago
                  </label>

                  <select
                    value={metodoPago}
                    onChange={(e) => setMetodoPago(e.target.value)}
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  >
                    <option value="qr">QR</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="debito">Débito</option>
                    <option value="credito">Crédito</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
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
                <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
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
              <div className="overflow-auto rounded-2xl border border-white/10">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[90px_90px_90px_1.2fr_1fr_90px_90px_90px_110px_100px] bg-red-600 text-xs font-black uppercase text-white">
                    <div className="p-3">Toma</div>
                    <div className="p-3">Est.</div>
                    <div className="p-3">Subida</div>
                    <div className="p-3">Cliente</div>
                    <div className="p-3">Simus</div>
                    <div className="p-3">Pers.</div>
                    <div className="p-3">Min.</div>
                    <div className="p-3">Turnos</div>
                    <div className="p-3">Pago</div>
                    <div className="p-3 text-right">Total</div>
                  </div>

                  {turnosDelDia.map((turno) => (
                    <div
                      key={turno.id}
                      className="grid grid-cols-[90px_90px_90px_1.2fr_1fr_90px_90px_90px_110px_100px] border-t border-white/10 bg-black text-sm text-white/80"
                    >
                      <div className="p-3 font-black">{turno.hora}</div>
                      <div className="p-3">
                        {turno.hora_estimada_subida || "-"}
                      </div>
                      <div className="p-3">{turno.hora_subida || "-"}</div>

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

                      <div className="p-3">{turno.cantidad_personas}</div>
                      <div className="p-3">{turno.cantidad_minutos}</div>
                      <div className="p-3">{turno.cantidad_turnos}</div>

                      <div className="p-3 capitalize">
                        {turno.metodo_pago || "-"}
                      </div>

                      <div className="p-3 text-right font-black">
                        ${Number(turno.total || 0).toLocaleString("es-AR")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
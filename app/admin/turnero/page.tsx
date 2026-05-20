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
  hora_bajada?: string;
  simuladores?: string[];
  cantidad_personas?: number;
  cantidad_minutos?: number;
  cantidad_turnos?: number;
  total?: number;
  metodo_pago?: string;
  estado?: string;
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

function sumarMinutosAHora(hora: string, minutos: number) {
  if (!hora) return "";

  const [h, m] = hora.split(":").map(Number);
  const date = new Date();

  date.setHours(h, m + minutos, 0, 0);

  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");

  return `${hh}:${mm}`;
}

function normalizarSimuladores(simuladores?: string[] | string) {
  if (Array.isArray(simuladores)) return simuladores;

  if (typeof simuladores === "string") {
    try {
      const parsed = JSON.parse(simuladores);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function formatearPago(pago?: string) {
  if (!pago) return "-";
  if (pago === "qr") return "QR";
  if (pago === "debito") return "Débito";
  if (pago === "credito") return "Crédito";
  return pago.charAt(0).toUpperCase() + pago.slice(1);
}

export default function TurneroAdminPage() {
  const [turnos, setTurnos] = useState<TurnoStand[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState(false);

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

  const [turnoEditando, setTurnoEditando] = useState<TurnoStand | null>(null);

  const horaBajada = useMemo(() => {
    return sumarMinutosAHora(horaSubida, cantidadMinutos);
  }, [horaSubida, cantidadMinutos]);

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

  function limpiarFormulario() {
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
  }

  async function crearTurno(e: React.FormEvent) {
    e.preventDefault();

    if (!fecha || !hora) {
      alert("Falta fecha u hora de toma.");
      return;
    }

    setGuardando(true);

    try {
      const res = await fetch("/api/turnos-stand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          telefono,
          fecha,
          hora,
          hora_estimada_subida: horaEstimadaSubida,
          hora_subida: horaSubida,
          hora_bajada: horaBajada,
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

      limpiarFormulario();
      await cargarTurnos();
    } catch (error) {
      console.error(error);
      alert("Error creando turno.");
    } finally {
      setGuardando(false);
    }
  }

  function abrirEdicion(turno: TurnoStand) {
    setTurnoEditando(turno);
    setNombre(turno.nombre || "");
    setTelefono(turno.telefono || "");
    setFecha(turno.fecha);
    setHora(turno.hora || horaActual());
    setHoraEstimadaSubida(turno.hora_estimada_subida || "");
    setHoraSubida(turno.hora_subida || "");
    setSimuladores(normalizarSimuladores(turno.simuladores));
    setCantidadPersonas(turno.cantidad_personas || 1);
    setCantidadMinutos(turno.cantidad_minutos || 15);
    setCantidadTurnos(turno.cantidad_turnos || 1);
    setMetodoPago(turno.metodo_pago || "qr");
    setTotal(String(turno.total || ""));
    setObservaciones(turno.observaciones || "");
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();

    if (!turnoEditando) return;

    setEditando(true);

    try {
      const res = await fetch(`/api/turnos-stand/${turnoEditando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          telefono,
          fecha,
          hora,
          hora_estimada_subida: horaEstimadaSubida,
          hora_subida: horaSubida,
          hora_bajada: horaBajada,
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
        alert(data.error || "Error actualizando turno.");
        return;
      }

      setTurnoEditando(null);
      limpiarFormulario();
      await cargarTurnos();
    } catch (error) {
      console.error(error);
      alert("Error actualizando turno.");
    } finally {
      setEditando(false);
    }
  }

  function cerrarEdicion() {
    setTurnoEditando(null);
    limpiarFormulario();
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
            Cargá, consultá y editá turnos del stand por cualquier día.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[460px_1fr]">
          <form
            onSubmit={turnoEditando ? guardarEdicion : crearTurno}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
          >
            <h2 className="mb-5 text-xl font-black uppercase text-red-500">
              {turnoEditando ? "Editar turno" : "Nuevo turno"}
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

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Estimada
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
                    Subida
                  </label>
                  <input
                    type="time"
                    value={horaSubida}
                    onChange={(e) => setHoraSubida(e.target.value)}
                    className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Bajada
                  </label>
                  <input
                    type="time"
                    value={horaBajada}
                    readOnly
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white/60 outline-none"
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
                    onChange={(e) => setCantidadPersonas(Number(e.target.value))}
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
                    onChange={(e) => setCantidadMinutos(Number(e.target.value))}
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
                    onChange={(e) => setCantidadTurnos(Number(e.target.value))}
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

              <div className="flex gap-3">
                {turnoEditando && (
                  <button
                    type="button"
                    onClick={cerrarEdicion}
                    className="w-full rounded-2xl border border-white/15 px-5 py-4 font-black uppercase text-white/70 transition hover:border-white hover:text-white"
                  >
                    Cancelar
                  </button>
                )}

                <button
                  type="submit"
                  disabled={guardando || editando}
                  className="w-full rounded-2xl bg-red-600 px-5 py-4 font-black uppercase text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                >
                  {turnoEditando
                    ? editando
                      ? "Actualizando..."
                      : "Actualizar turno"
                    : guardando
                    ? "Guardando..."
                    : "Guardar turno"}
                </button>
              </div>
            </div>
          </form>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-black uppercase text-red-500">
                  Turnos del día
                </h2>
                <p className="text-sm text-white/50">{fecha}</p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                    Ver día
                  </label>
                  <input
                    type="date"
                    value={fecha}
                    onChange={(e) => {
                      setFecha(e.target.value);
                      setTurnoEditando(null);
                    }}
                    className="rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-red-500"
                  />
                </div>

                <div className="rounded-full border border-white/10 px-4 py-3 text-sm font-bold text-white/70">
                  {turnosDelDia.length} turnos
                </div>
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
              <div className="space-y-3">
                {turnosDelDia.map((turno) => {
                  const simus = normalizarSimuladores(turno.simuladores);

                  return (
                    <div
                      key={turno.id}
                      className="rounded-2xl border border-white/10 bg-black p-5 transition hover:border-red-500/60"
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="grid flex-1 gap-3 md:grid-cols-3 xl:grid-cols-7">
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                              Toma
                            </p>
                            <p className="mt-1 text-lg font-black">
                              {turno.hora || "-"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                              Estimada
                            </p>
                            <p className="mt-1 text-lg font-bold text-white/80">
                              {turno.hora_estimada_subida || "-"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                              Subida
                            </p>
                            <p className="mt-1 text-lg font-bold text-white/80">
                              {turno.hora_subida || "-"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                              Bajada
                            </p>
                            <p className="mt-1 text-lg font-bold text-white/80">
                              {turno.hora_bajada ||
                                sumarMinutosAHora(
                                  turno.hora_subida || "",
                                  turno.cantidad_minutos || 15
                                ) ||
                                "-"}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                              Cliente
                            </p>
                            <p className="mt-1 font-black">
                              {turno.nombre || "Sin nombre"}
                            </p>
                            <p className="text-sm text-white/45">
                              {turno.telefono || "Sin teléfono"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                              Total
                            </p>
                            <p className="mt-1 text-lg font-black text-red-500">
                              $
                              {Number(turno.total || 0).toLocaleString(
                                "es-AR"
                              )}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => abrirEdicion(turno)}
                          className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase text-white/80 transition hover:border-red-500 hover:bg-red-600 hover:text-white"
                        >
                          Editar
                        </button>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-4">
                        <div className="rounded-2xl bg-white/[0.04] p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                            Personas
                          </p>
                          <p className="mt-1 font-black">
                            {turno.cantidad_personas || 1}
                          </p>
                        </div>

                        <div className="rounded-2xl bg-white/[0.04] p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                            Minutos
                          </p>
                          <p className="mt-1 font-black">
                            {turno.cantidad_minutos || 15}
                          </p>
                        </div>

                        <div className="rounded-2xl bg-white/[0.04] p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                            Turnos
                          </p>
                          <p className="mt-1 font-black">
                            {turno.cantidad_turnos || 1}
                          </p>
                        </div>

                        <div className="rounded-2xl bg-white/[0.04] p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                            Pago
                          </p>
                          <p className="mt-1 font-black">
                            {formatearPago(turno.metodo_pago)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-white/40">
                          Simuladores
                        </p>

                        {simus.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {simus.map((sim) => (
                              <span
                                key={sim}
                                className="rounded-full bg-red-600 px-3 py-1 text-xs font-black uppercase"
                              >
                                {sim}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-white/45">
                            Todavía no asignado
                          </p>
                        )}
                      </div>

                      {turno.observaciones && (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                            Observaciones
                          </p>
                          <p className="mt-1 text-sm text-white/70">
                            {turno.observaciones}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
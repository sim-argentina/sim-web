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
  simuladores?: string[] | string;
  cantidad_personas?: number;
  cantidad_minutos?: number;
  cantidad_turnos?: number;
  total?: number;
  metodo_pago?: string;
  posnet_pago?: string;
  estado?: string;
  observaciones?: string;
};

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"];
const POSNETS = ["Posnet 1", "Posnet 2", "Posnet 3"];

function fechaLocalISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function horaActual() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function sumarMinutosAHora(hora: string, minutos: number) {
  if (!hora) return "";

  const [h, m] = hora.split(":").map(Number);
  const date = new Date();

  date.setHours(h, m + minutos, 0, 0);

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
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
  if (pago === "efectivo") return "Efectivo";
  if (pago === "transferencia") return "Transferencia";
  return pago;
}

function formatoDinero(valor: number) {
  return `$${valor.toLocaleString("es-AR")}`;
}

function minutosEntre(horaInicio?: string, horaFin?: string) {
  if (!horaInicio || !horaFin) return null;

  const [h1, m1] = horaInicio.split(":").map(Number);
  const [h2, m2] = horaFin.split(":").map(Number);

  if (Number.isNaN(h1) || Number.isNaN(m1) || Number.isNaN(h2) || Number.isNaN(m2)) {
    return null;
  }

  const inicio = h1 * 60 + m1;
  const fin = h2 * 60 + m2;

  return fin >= inicio ? fin - inicio : fin + 1440 - inicio;
}

function promedio(valores: number[]) {
  if (!valores.length) return 0;
  return Math.round(valores.reduce((acc, n) => acc + n, 0) / valores.length);
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
  const [posnet, setPosnet] = useState("");
  const [total, setTotal] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [turnoEditando, setTurnoEditando] = useState<TurnoStand | null>(null);
  const [turnosListos, setTurnosListos] = useState<number[]>([]);
  const [limiteRankingDemora, setLimiteRankingDemora] = useState(5);

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
      .sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
  }, [turnos, fecha]);

  const resumenDia = useMemo(() => {
    const porMetodo: Record<string, { cantidad: number; total: number }> = {};
    const porSimulador: Record<string, number> = {};
    const porMinutos: Record<string, number> = {};
    const porPersonas: Record<string, number> = {};
    const porPosnet: Record<string, { cantidad: number; total: number }> = {};
    const porPosnetYMetodo: Record<string, number> = {};

    let totalFacturado = 0;
    let cantidadTurnos = 0;

    turnosDelDia.forEach((turno) => {
      const totalTurno = Number(turno.total || 0);
      const metodo = formatearPago(turno.metodo_pago);
      const minutos = `${turno.cantidad_minutos || 15} min`;
      const personas = `${turno.cantidad_personas || 1} persona${
        (turno.cantidad_personas || 1) > 1 ? "s" : ""
      }`;
      const simus = normalizarSimuladores(turno.simuladores);
      const posnetTurno = turno.posnet_pago;

      cantidadTurnos += 1;
      totalFacturado += totalTurno;

      porMetodo[metodo] = porMetodo[metodo] || { cantidad: 0, total: 0 };
      porMetodo[metodo].cantidad += 1;
      porMetodo[metodo].total += totalTurno;

      porMinutos[minutos] = (porMinutos[minutos] || 0) + 1;
      porPersonas[personas] = (porPersonas[personas] || 0) + 1;

      simus.forEach((sim) => {
        porSimulador[sim] = (porSimulador[sim] || 0) + 1;
      });

      if (
        posnetTurno &&
        (turno.metodo_pago === "debito" ||
          turno.metodo_pago === "credito" ||
          turno.metodo_pago === "qr")
      ) {
        porPosnet[posnetTurno] = porPosnet[posnetTurno] || {
          cantidad: 0,
          total: 0,
        };

        porPosnet[posnetTurno].cantidad += 1;
        porPosnet[posnetTurno].total += totalTurno;

        const clave = `${posnetTurno} - ${metodo}`;
        porPosnetYMetodo[clave] = (porPosnetYMetodo[clave] || 0) + totalTurno;
      }
    });

    const tiemposSinDemora: number[] = [];
    const tiemposConDemora: number[] = [];
    const turnosConDemoraRanking: Array<TurnoStand & { demora_minutos: number }> =
      [];

    turnosDelDia.forEach((turno) => {
      const diferencia = minutosEntre(turno.hora, turno.hora_subida);
      const tieneDemora = Boolean(turno.hora_estimada_subida);

      if (diferencia === null) return;

      if (tieneDemora) {
        tiemposConDemora.push(diferencia);
        turnosConDemoraRanking.push({
          ...turno,
          demora_minutos: diferencia,
        });
      } else {
        tiemposSinDemora.push(diferencia);
      }
    });

    const rankingDemoras = turnosConDemoraRanking
      .sort((a, b) => b.demora_minutos - a.demora_minutos)
      .slice(0, limiteRankingDemora);

    return {
      cantidadTurnos,
      totalFacturado,
      porMetodo,
      porSimulador,
      porMinutos,
      porPersonas,
      porPosnet,
      porPosnetYMetodo,
      promedioSubidaSinDemora: promedio(tiemposSinDemora),
      promedioSubidaConDemora: promedio(tiemposConDemora),
      cantidadTurnosConDemora: tiemposConDemora.length,
      rankingDemoras,
    };
  }, [turnosDelDia, limiteRankingDemora]);

  function toggleSimulador(simulador: string) {
    setSimuladores((actuales) =>
      actuales.includes(simulador)
        ? actuales.filter((s) => s !== simulador)
        : [...actuales, simulador]
    );
  }

  function toggleListo(id: number) {
    setTurnosListos((actuales) =>
      actuales.includes(id)
        ? actuales.filter((turnoId) => turnoId !== id)
        : [...actuales, id]
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
    setPosnet("");
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
          posnet_pago: posnet,
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
    setPosnet(turno.posnet_pago || "");
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
          posnet_pago: posnet,
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
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">
            Admin SIM
          </p>

          <h1 className="text-3xl font-black uppercase md:text-5xl">
            Turnero del stand
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Cargá turnos, revisá el día y controlá el cierre con resumen.
          </p>
        </div>

        <form
          onSubmit={turnoEditando ? guardarEdicion : crearTurno}
          className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black uppercase text-red-500">
              {turnoEditando ? "Editar turno" : "Nuevo turno"}
            </h2>

            {turnoEditando && (
              <button
                type="button"
                onClick={cerrarEdicion}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 hover:border-white hover:text-white"
              >
                Cancelar edición
              </button>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Campo label="Fecha">
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Hora toma">
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Hora estimada">
              <input
                type="time"
                value={horaEstimadaSubida}
                onChange={(e) => setHoraEstimadaSubida(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Hora subida">
              <input
                type="time"
                value={horaSubida}
                onChange={(e) => setHoraSubida(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Hora bajada">
              <input
                type="time"
                value={horaBajada}
                readOnly
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/60 outline-none"
              />
            </Campo>

            <Campo label="Cliente">
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <Campo label="Teléfono">
              <input
                type="text"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="351..."
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <Campo label="Total">
              <input
                type="number"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Campo label="Personas">
              <input
                type="number"
                min={1}
                value={cantidadPersonas}
                onChange={(e) => setCantidadPersonas(Number(e.target.value))}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Minutos">
              <input
                type="number"
                min={1}
                value={cantidadMinutos}
                onChange={(e) => setCantidadMinutos(Number(e.target.value))}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Turnos">
              <input
                type="number"
                min={1}
                value={cantidadTurnos}
                onChange={(e) => setCantidadTurnos(Number(e.target.value))}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Método pago">
              <select
                value={metodoPago}
                onChange={(e) => {
                  setMetodoPago(e.target.value);

                  if (
                    e.target.value !== "debito" &&
                    e.target.value !== "credito" &&
                    e.target.value !== "qr"
                  ) {
                    setPosnet("");
                  }
                }}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="qr">QR</option>
                <option value="efectivo">Efectivo</option>
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </Campo>

            <Campo label="Posnet">
              <select
                value={posnet}
                onChange={(e) => setPosnet(e.target.value)}
                disabled={
                  metodoPago !== "debito" &&
                  metodoPago !== "credito" &&
                  metodoPago !== "qr"
                }
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500 disabled:opacity-30"
              >
                <option value="">Sin posnet</option>
                {POSNETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Campo>

            <div className="xl:col-span-2">
              <Campo label="Observaciones">
                <input
                  type="text"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Notas internas"
                  className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
                />
              </Campo>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={guardando || editando}
                className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
              >
                {turnoEditando
                  ? editando
                    ? "Actualizando..."
                    : "Actualizar"
                  : guardando
                  ? "Guardando..."
                  : "Guardar"}
              </button>
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
              Simuladores
            </p>

            <div className="flex flex-wrap gap-2">
              {SIMULADORES.map((simulador) => {
                const seleccionado = simuladores.includes(simulador);

                return (
                  <button
                    key={simulador}
                    type="button"
                    onClick={() => toggleSimulador(simulador)}
                    className={`rounded-full border px-4 py-2 text-xs font-black uppercase transition ${
                      seleccionado
                        ? "border-red-500 bg-red-600 text-white"
                        : "border-white/15 bg-black text-white/60 hover:border-red-500 hover:text-white"
                    }`}
                  >
                    {simulador}
                  </button>
                );
              })}
            </div>
          </div>
        </form>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-black uppercase text-red-500">
                Turnos guardados
              </h2>
              <p className="text-sm text-white/50">{fecha}</p>
            </div>

            <div className="flex items-end gap-3">
              <Campo label="Ver día">
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => {
                    setFecha(e.target.value);
                    setTurnoEditando(null);
                  }}
                  className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                />
              </Campo>

              <div className="rounded-full border border-white/10 px-4 py-2 text-sm font-bold text-white/70">
                {turnosDelDia.length} turnos
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-white/60">Cargando turnos...</p>
          ) : turnosDelDia.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">
                No hay turnos cargados para esta fecha.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1220px] space-y-2">
                <div className="grid grid-cols-[60px_70px_80px_80px_80px_1.4fr_1fr_90px_90px_90px_130px_120px_80px] gap-2 px-3 text-xs font-black uppercase tracking-[0.15em] text-white/35">
                  <span>Listo</span>
                  <span>Toma</span>
                  <span>Est.</span>
                  <span>Sube</span>
                  <span>Baja</span>
                  <span>Cliente</span>
                  <span>Simus</span>
                  <span>Pers.</span>
                  <span>Min.</span>
                  <span>Pago</span>
                  <span>Posnet</span>
                  <span>Total</span>
                  <span></span>
                </div>

                {turnosDelDia.map((turno) => {
                  const simus = normalizarSimuladores(turno.simuladores);
                  const posnetTurno = turno.posnet_pago || "-";
                  const listo = turnosListos.includes(turno.id);

                  return (
                    <div
                      key={turno.id}
                      className={`grid grid-cols-[60px_70px_80px_80px_80px_1.4fr_1fr_90px_90px_90px_130px_120px_80px] items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                        listo
                          ? "border-green-500/50 bg-green-950/25"
                          : "border-white/10 bg-black hover:border-red-500/60"
                      }`}
                    >
                      <label className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={listo}
                          onChange={() => toggleListo(turno.id)}
                          className="h-5 w-5 accent-red-600"
                        />
                      </label>

                      <span className="font-black">{turno.hora || "-"}</span>
                      <span className="text-white/70">
                        {turno.hora_estimada_subida || "-"}
                      </span>
                      <span className="text-white/70">
                        {turno.hora_subida || "-"}
                      </span>
                      <span className="text-white/70">
                        {turno.hora_bajada ||
                          sumarMinutosAHora(
                            turno.hora_subida || "",
                            turno.cantidad_minutos || 15
                          ) ||
                          "-"}
                      </span>

                      <div className="min-w-0">
                        <p
                          className={`truncate font-black ${
                            listo ? "text-white/60 line-through" : ""
                          }`}
                        >
                          {turno.nombre || "Sin nombre"}
                        </p>
                        <p className="truncate text-xs text-white/40">
                          {turno.telefono || "Sin teléfono"}
                        </p>
                      </div>

                      <span className="truncate text-white/70">
                        {simus.length ? simus.join(", ") : "-"}
                      </span>

                      <span>{turno.cantidad_personas || 1}</span>
                      <span>{turno.cantidad_minutos || 15}</span>
                      <span>{formatearPago(turno.metodo_pago)}</span>
                      <span>{posnetTurno}</span>

                      <span className="font-black text-red-500">
                        {formatoDinero(Number(turno.total || 0))}
                      </span>

                      <button
                        onClick={() => abrirEdicion(turno)}
                        className="rounded-lg border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:bg-red-600 hover:text-white"
                      >
                        Editar
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-3xl border border-red-500/30 bg-red-950/20 p-5">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black uppercase text-red-500">
                Resumen del día
              </h2>
              <p className="text-sm text-white/50">{fecha}</p>
            </div>

            <div className="text-left md:text-right">
              <p className="text-sm uppercase tracking-[0.2em] text-white/40">
                Facturación total
              </p>
              <p className="text-3xl font-black">
                {formatoDinero(resumenDia.totalFacturado)}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                Turnos
              </p>
              <p className="mt-2 text-2xl font-black">
                {resumenDia.cantidadTurnos}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                Prom. subida sin demora
              </p>
              <p className="mt-2 text-2xl font-black">
                {resumenDia.promedioSubidaSinDemora} min
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                Prom. subida con demora
              </p>
              <p className="mt-2 text-2xl font-black">
                {resumenDia.promedioSubidaConDemora} min
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                Turnos con demora
              </p>
              <p className="mt-2 text-2xl font-black">
                {resumenDia.cantidadTurnosConDemora}
              </p>
            </div>

            <ResumenBox titulo="Por método" data={resumenDia.porMetodo} />
            <ResumenBox titulo="Por simulador" data={resumenDia.porSimulador} />
            <ResumenBox titulo="Por duración" data={resumenDia.porMinutos} />
            <ResumenBox titulo="Por personas" data={resumenDia.porPersonas} />
            <ResumenBox titulo="Por posnet" data={resumenDia.porPosnet} />
          </div>

          <div className="mt-3 rounded-2xl border border-white/10 bg-black p-4">
            <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">
              Posnet por método de pago
            </p>

            {Object.keys(resumenDia.porPosnetYMetodo).length === 0 ? (
              <p className="text-sm text-white/45">
                No hay cobros con posnet cargados para este día.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-3">
                {Object.entries(resumenDia.porPosnetYMetodo).map(
                  ([clave, valor]) => (
                    <div
                      key={clave}
                      className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2 text-sm"
                    >
                      <span className="font-bold text-white/70">{clave}</span>
                      <span className="font-black text-red-500">
                        {formatoDinero(valor)}
                      </span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          <div className="mt-3 rounded-2xl border border-white/10 bg-black p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/40">
                Ranking de mayores demoras
              </p>

              <select
                value={limiteRankingDemora}
                onChange={(e) => setLimiteRankingDemora(Number(e.target.value))}
                className="rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500"
              >
                <option value={2}>Top 2</option>
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
                <option value={25}>Top 25</option>
                <option value={50}>Top 50</option>
              </select>
            </div>

            {resumenDia.rankingDemoras.length === 0 ? (
              <p className="text-sm text-white/45">
                No hay turnos con demora para este día.
              </p>
            ) : (
              <div className="space-y-2 overflow-x-auto">
                <div className="min-w-[920px] space-y-2">
                  {resumenDia.rankingDemoras.map((turno, index) => {
                    const simus = normalizarSimuladores(turno.simuladores);

                    return (
                      <div
                        key={turno.id}
                        className="grid grid-cols-[45px_1.4fr_90px_90px_90px_100px_1fr] items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-sm"
                      >
                        <span className="font-black text-red-500">
                          #{index + 1}
                        </span>

                        <div className="min-w-0">
                          <p className="truncate font-black">
                            {turno.nombre || "Sin nombre"}
                          </p>
                          <p className="truncate text-xs text-white/40">
                            {turno.telefono || "Sin teléfono"}
                          </p>
                        </div>

                        <span>{turno.hora || "-"}</span>
                        <span>{turno.hora_estimada_subida || "-"}</span>
                        <span>{turno.hora_subida || "-"}</span>
                        <span className="font-black text-red-500">
                          {turno.demora_minutos} min
                        </span>
                        <span className="truncate text-white/60">
                          {simus.length ? simus.join(", ") : "-"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
        {label}
      </label>
      {children}
    </div>
  );
}

function ResumenBox({
  titulo,
  data,
}: {
  titulo: string;
  data: Record<string, any>;
}) {
  const entries = Object.entries(data);

  return (
    <div className="rounded-2xl border border-white/10 bg-black p-4">
      <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">
        {titulo}
      </p>

      {entries.length === 0 ? (
        <p className="text-sm text-white/45">Sin datos</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => {
            const esObjeto =
              typeof value === "object" && value !== null && "total" in value;

            return (
              <div
                key={key}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <span className="font-bold text-white/70">{key}</span>

                <span className="text-right font-black">
                  {esObjeto ? (
                    <>
                      {value.cantidad} /{" "}
                      <span className="text-red-500">
                        {formatoDinero(value.total)}
                      </span>
                    </>
                  ) : (
                    value
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
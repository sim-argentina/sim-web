"use client";

import { useEffect, useMemo, useState } from "react";
import { getOccupiedSlots } from "@/lib/reservasSlots";

type Reembolso = {
  reserva_id: number;
  monto_reembolsado: number;
  fecha_reembolso: string;
  motivo: string | null;
  origen_registro?: string;
  actor?: string;
  created_at?: string;
};

type Reserva = {
  id: number;
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[] | string;
  cantidad_turnos?: number;
  duracion_minutos?: number;
  total?: number;
  estado?: string;
  created_at?: string;
  reembolso?: Reembolso | null;
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

// Rango horario VISUAL de una reserva (solo presentación, no muta nada).
// Deriva el fin a partir de los slots que la reserva YA ocupa según su
// duración existente, reutilizando la misma lógica de ocupación del sistema
// (getOccupiedSlots): 15 min → 1 slot de 20'; 30 min → 2 slots consecutivos.
// El fin visible = hora final del último slot ocupado (último slot + 20').
function rangoVisual(reserva: Pick<Reserva, "fecha" | "hora" | "duracion_minutos">) {
  const duracion = Number(reserva.duracion_minutos) || 15;
  const slots = getOccupiedSlots(reserva.fecha, reserva.hora, duracion);
  const ultimoSlot = slots[slots.length - 1] ?? reserva.hora;
  return `${horaBonita(reserva.hora)} - ${sumar20Minutos(ultimoSlot)}`;
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
  const [role, setRole] = useState<string | null>(null);

  const [filtro, setFiltro] = useState<Filtro>("semana");
  const [fechaElegida, setFechaElegida] = useState(fechaLocalISO());
  const [fechaDesde, setFechaDesde] = useState(fechaLocalISO());
  const [fechaHasta, setFechaHasta] = useState(fechaLocalISO());

  const [busqueda, setBusqueda] = useState("");

  const [reservaSeleccionada, setReservaSeleccionada] =
    useState<Reserva | null>(null);

  // Modal de reembolso (solo admin).
  const [reembolsoDe, setReembolsoDe] = useState<Reserva | null>(null);
  const [fechaReembolso, setFechaReembolso] = useState(fechaLocalISO());
  const [motivoReembolso, setMotivoReembolso] = useState("");
  const [confirmoReembolso, setConfirmoReembolso] = useState(false);
  const [guardandoReembolso, setGuardandoReembolso] = useState(false);
  const [errorReembolso, setErrorReembolso] = useState<string | null>(null);

  const esAdmin = role === "admin";

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setRole(d.role))
      .catch(() => {});
  }, []);

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

  function abrirReembolso(reserva: Reserva) {
    setReembolsoDe(reserva);
    setFechaReembolso(fechaLocalISO());
    setMotivoReembolso("");
    setConfirmoReembolso(false);
    setErrorReembolso(null);
  }

  async function registrarReembolso() {
    if (!reembolsoDe || !confirmoReembolso) return;
    setGuardandoReembolso(true);
    setErrorReembolso(null);
    try {
      const res = await fetch(`/api/admin/reservas/${reembolsoDe.id}/reembolso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha_reembolso: fechaReembolso,
          motivo: motivoReembolso.trim() || undefined,
          confirmacion: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorReembolso(data?.error || "No se pudo registrar el reembolso.");
        return;
      }
      // Actualización inmediata sin recargar: estado terminal + detalle.
      const ref = data as Reembolso;
      setReservas((prev) =>
        prev.map((r) =>
          r.id === reembolsoDe.id ? { ...r, estado: "reembolsada", reembolso: ref } : r
        )
      );
      setReservaSeleccionada((sel) =>
        sel && sel.id === reembolsoDe.id ? { ...sel, estado: "reembolsada", reembolso: ref } : sel
      );
      setReembolsoDe(null);
    } catch {
      setErrorReembolso("Error de red al registrar el reembolso.");
    } finally {
      setGuardandoReembolso(false);
    }
  }

  const reservasFiltradas = useMemo(() => {
    return reservas
      // Reservas con pago aprobado ("activa") y también las "reembolsada" (para
      // que el admin las vea marcadas). Se excluyen pendientes, errores y canceladas.
      .filter((reserva) => reserva.estado === "activa" || reserva.estado === "reembolsada")
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
                              {rangoVisual(reserva)}
                            </p>

                            <p className="mt-1 text-white/70">
                              {reserva.nombre}
                            </p>

                            <p className="mt-1 text-sm text-white/40">
                              {reserva.telefono || "Sin teléfono"}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-3">
                            {reserva.estado === "reembolsada" && (
                              <span className="rounded-full bg-amber-500/20 px-4 py-2 text-sm font-black uppercase text-amber-400 ring-1 ring-amber-500/40">
                                Reembolsada
                              </span>
                            )}
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
                  {rangoVisual(reservaSeleccionada)}
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

              {reservaSeleccionada.estado === "reembolsada" && (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
                  <p className="text-sm font-black uppercase text-amber-400">Reembolsada</p>
                  {reservaSeleccionada.reembolso ? (
                    <div className="mt-2 space-y-1 text-sm text-amber-100/90">
                      <p>Importe reembolsado: <span className="font-bold">{formatearTotal(Number(reservaSeleccionada.reembolso.monto_reembolsado))}</span></p>
                      <p>Fecha del reembolso: <span className="font-bold">{reservaSeleccionada.reembolso.fecha_reembolso}</span></p>
                      {reservaSeleccionada.reembolso.motivo && (
                        <p>Motivo: <span className="font-bold">{reservaSeleccionada.reembolso.motivo}</span></p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-amber-100/80">El cupo fue liberado. El importe se devolvió por fuera de SIM.</p>
                  )}
                </div>
              )}
            </div>

            {esAdmin &&
              reservaSeleccionada.estado === "activa" &&
              Number(reservaSeleccionada.total) > 0 && (
                <button
                  onClick={() => abrirReembolso(reservaSeleccionada)}
                  className="mt-6 w-full rounded-2xl border border-amber-500/50 bg-amber-500/10 px-5 py-3 font-black uppercase text-amber-400 transition hover:bg-amber-500/20"
                >
                  Registrar reembolso
                </button>
              )}

            <button
              onClick={() => setReservaSeleccionada(null)}
              className="mt-3 w-full rounded-2xl bg-red-600 px-5 py-3 font-black uppercase text-white transition hover:bg-red-700"
            >
              Cerrar detalles
            </button>
          </div>
        </div>
      )}

      {esAdmin && reembolsoDe && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-amber-500/30 bg-zinc-950 p-6 text-white shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-amber-400">Registrar reembolso</p>
                <h3 className="mt-2 text-2xl font-black uppercase">{reembolsoDe.nombre}</h3>
              </div>
              <button
                onClick={() => setReembolsoDe(null)}
                disabled={guardandoReembolso}
                className="rounded-full border border-white/15 px-3 py-1 text-sm font-bold hover:bg-white hover:text-black disabled:opacity-40"
              >
                X
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/[0.04] p-3">
                  <p className="text-white/50">Fecha reservada</p>
                  <p className="font-bold">{reembolsoDe.fecha}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-3">
                  <p className="text-white/50">Horario</p>
                  <p className="font-bold">{rangoVisual(reembolsoDe)}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-3">
                  <p className="text-white/50">Cliente</p>
                  <p className="font-bold">{reembolsoDe.telefono || "Sin teléfono"}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-3">
                  <p className="text-white/50">Importe pagado</p>
                  <p className="font-bold">{formatearTotal(reembolsoDe.total)}</p>
                </div>
              </div>

              <div className="rounded-2xl bg-white/[0.04] p-3">
                <p className="text-white/50">Medio / origen</p>
                <p className="font-bold">Mercado Pago · reembolso manual externo</p>
              </div>

              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-100">
                <p className="font-bold">Esta acción no devuelve dinero desde SIM. Solo registra un reembolso completo ya realizado.</p>
              </div>

              {(() => {
                const fechaRes = new Date(`${reembolsoDe.fecha}T00:00:00`);
                const hoy = new Date(fechaLocalISO() + "T00:00:00");
                return fechaRes >= hoy ? (
                  <p className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2 text-xs font-bold text-white/70">
                    Esta reserva es futura: al registrar el reembolso se cancela y se libera el cupo de inmediato en la web.
                  </p>
                ) : null;
              })()}

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                  Fecha real del reembolso
                </label>
                <input
                  type="date"
                  value={fechaReembolso}
                  max={fechaLocalISO()}
                  onChange={(e) => setFechaReembolso(e.target.value)}
                  className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                  Motivo (opcional)
                </label>
                <input
                  type="text"
                  value={motivoReembolso}
                  maxLength={500}
                  onChange={(e) => setMotivoReembolso(e.target.value)}
                  placeholder="Ej: cliente canceló, error de reserva..."
                  className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3 font-bold text-white outline-none placeholder:text-white/30 focus:border-amber-500"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/15 bg-black p-4">
                <input
                  type="checkbox"
                  checked={confirmoReembolso}
                  onChange={(e) => setConfirmoReembolso(e.target.checked)}
                  className="mt-1 h-5 w-5 accent-amber-500"
                />
                <span className="text-sm font-bold text-white/90">
                  Confirmo que el importe total ya fue devuelto por fuera de SIM.
                </span>
              </label>

              {errorReembolso && (
                <p className="rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm font-bold text-red-300">
                  {errorReembolso}
                </p>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setReembolsoDe(null)}
                disabled={guardandoReembolso}
                className="flex-1 rounded-2xl border border-white/15 px-5 py-3 font-black uppercase text-white/70 transition hover:text-white disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={registrarReembolso}
                disabled={!confirmoReembolso || guardandoReembolso}
                className="flex-1 rounded-2xl bg-amber-500 px-5 py-3 font-black uppercase text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
              >
                {guardandoReembolso ? "Registrando..." : "Registrar reembolso"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
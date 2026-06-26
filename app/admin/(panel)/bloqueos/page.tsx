"use client";

import { useEffect, useState } from "react";

type Bloqueo = {
  id: number;
  fecha: string;
  todo_el_dia: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  simulador: string | null;
  motivo: string | null;
  activo: boolean;
  created_at: string;
};

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"];

export default function AdminBloqueosPage() {
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);

  const [fecha, setFecha] = useState("");
  const [todoElDia, setTodoElDia] = useState(true);
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFin, setHoraFin] = useState("");
  const [simulador, setSimulador] = useState(""); // "" = todos
  const [motivo, setMotivo] = useState("");

  async function cargarBloqueos() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/bloqueos", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error cargando bloqueos");
        return;
      }
      setBloqueos(data.bloqueos || []);
    } catch {
      alert("Error cargando bloqueos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarBloqueos();
  }, []);

  async function crearBloqueo(e: React.FormEvent) {
    e.preventDefault();
    if (!fecha) {
      alert("Elegí una fecha.");
      return;
    }
    if (!todoElDia && (!horaInicio || !horaFin)) {
      alert("Indicá hora de inicio y fin, o marcá todo el día.");
      return;
    }

    setCreando(true);
    try {
      const res = await fetch("/api/admin/bloqueos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          todo_el_dia: todoElDia,
          hora_inicio: todoElDia ? null : horaInicio,
          hora_fin: todoElDia ? null : horaFin,
          simulador: simulador || null,
          motivo: motivo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error creando bloqueo");
        return;
      }
      if (Number(data.reservas_afectadas) > 0) {
        alert(
          `Bloqueo creado.\n\n⚠ Atención: hay ${data.reservas_afectadas} reserva(s) activa(s) que caen dentro de este bloqueo. No se eliminaron — gestionalas manualmente si corresponde.`
        );
      }
      setFecha("");
      setTodoElDia(true);
      setHoraInicio("");
      setHoraFin("");
      setSimulador("");
      setMotivo("");
      await cargarBloqueos();
    } catch {
      alert("Error creando bloqueo");
    } finally {
      setCreando(false);
    }
  }

  async function cambiarEstado(b: Bloqueo) {
    const res = await fetch(`/api/admin/bloqueos/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !b.activo }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error actualizando bloqueo");
      return;
    }
    await cargarBloqueos();
  }

  async function eliminarBloqueo(b: Bloqueo) {
    if (
      !confirm(
        `¿Eliminar el bloqueo del ${b.fecha}?\n\nNo se borran reservas existentes, solo la regla de bloqueo.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/bloqueos/${b.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Error eliminando bloqueo");
      return;
    }
    setBloqueos((prev) => prev.filter((x) => x.id !== b.id));
  }

  function rango(b: Bloqueo) {
    if (b.todo_el_dia) return "Todo el día";
    return `${b.hora_inicio ?? "?"} – ${b.hora_fin ?? "?"}`;
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-5xl">
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">
            Admin SIM
          </p>
          <h1 className="text-3xl font-black uppercase md:text-5xl">
            Bloqueos de reservas
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Cerrá la reserva online por fecha, rango horario y/o simulador
            (mantenimiento, eventos privados, feriados). No afecta reservas ya
            confirmadas.
          </p>
        </div>

        <form
          onSubmit={crearBloqueo}
          className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4"
        >
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">
            Crear bloqueo
          </h2>

          <div className="grid gap-3 md:grid-cols-3">
            <Campo label="Fecha">
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              />
            </Campo>

            <Campo label="Simulador">
              <select
                value={simulador}
                onChange={(e) => setSimulador(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
              >
                <option value="">Todos</option>
                {SIMULADORES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Motivo (opcional)">
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Mantenimiento, evento privado..."
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500"
              />
            </Campo>

            <div className="md:col-span-3">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/15 bg-black px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={todoElDia}
                  onChange={(e) => setTodoElDia(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
                <span className="text-sm font-bold">Bloquear todo el día</span>
              </label>
            </div>

            {!todoElDia && (
              <>
                <Campo label="Hora inicio">
                  <input
                    type="time"
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                  />
                </Campo>
                <Campo label="Hora fin">
                  <input
                    type="time"
                    value={horaFin}
                    onChange={(e) => setHoraFin(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500"
                  />
                </Campo>
              </>
            )}

            <div className="flex items-end">
              <button
                type="submit"
                disabled={creando}
                className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
              >
                {creando ? "Creando..." : "Crear bloqueo"}
              </button>
            </div>
          </div>
        </form>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">
            Bloqueos creados
          </h2>

          {loading ? (
            <p className="text-white/60">Cargando bloqueos...</p>
          ) : bloqueos.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">Todavía no hay bloqueos creados.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bloqueos.map((b) => (
                <div
                  key={b.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                    b.activo
                      ? "border-white/10 bg-black"
                      : "border-white/5 bg-white/[0.02] opacity-50"
                  }`}
                >
                  <div className="min-w-[180px]">
                    <p className="font-black text-red-500">{b.fecha}</p>
                    <p className="text-xs text-white/50">
                      {rango(b)} · {b.simulador || "Todos los simuladores"}
                    </p>
                    {b.motivo && (
                      <p className="mt-0.5 text-xs text-white/40">{b.motivo}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => cambiarEstado(b)}
                      className={`rounded-xl px-3 py-2 text-xs font-black uppercase transition ${
                        b.activo
                          ? "bg-green-600 text-white hover:bg-green-700"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      {b.activo ? "Activo" : "Inactivo"}
                    </button>
                    <button
                      type="button"
                      onClick={() => eliminarBloqueo(b)}
                      className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-400 transition hover:bg-red-600 hover:text-white"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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

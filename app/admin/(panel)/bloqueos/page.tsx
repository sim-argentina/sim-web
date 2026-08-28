"use client";

import { useEffect, useState } from "react";
import { estadoBloqueoEfectivo, type EstadoBloqueo } from "@/lib/bloqueosEstado";

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

type PrecioEspecial = {
  id: string;
  fecha: string;
  precio_15: number | null;
  precio_30: number | null;
};

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"];

const fmtMoney = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("es-AR")}`);
// "Hoy" en Argentina (YYYY-MM-DD).
const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

const ESTADO_CHIP: Record<EstadoBloqueo, string> = {
  activo: "bg-green-600 text-white",
  programado: "bg-blue-600 text-white",
  inactivo: "bg-zinc-800 text-zinc-400",
};
const ESTADO_LABEL: Record<EstadoBloqueo, string> = { activo: "Activo", programado: "Programado", inactivo: "Inactivo" };

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

  // Precios especiales (independientes de los bloqueos).
  const [precios, setPrecios] = useState<PrecioEspecial[]>([]);
  const [pFecha, setPFecha] = useState("");
  const [p15, setP15] = useState("");
  const [p30, setP30] = useState("");
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);

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
    cargarPrecios();
  }, []);

  async function cargarPrecios() {
    try {
      const res = await fetch("/api/admin/bloqueos/precios", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setPrecios(data.precios || []);
    } catch { /* noop */ }
  }

  async function guardarPrecio(e: React.FormEvent) {
    e.preventDefault();
    if (!pFecha) { alert("Elegí una fecha."); return; }
    if (!p15 && !p30) { alert("Cargá al menos un precio (15 o 30 min)."); return; }
    setGuardandoPrecio(true);
    try {
      const res = await fetch("/api/admin/bloqueos/precios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha: pFecha, precio_15: p15 === "" ? null : Number(p15), precio_30: p30 === "" ? null : Number(p30) }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Error guardando el precio especial"); return; }
      setPFecha(""); setP15(""); setP30("");
      await cargarPrecios();
    } catch {
      alert("Error guardando el precio especial");
    } finally {
      setGuardandoPrecio(false);
    }
  }

  function editarPrecio(p: PrecioEspecial) {
    setPFecha(p.fecha);
    setP15(p.precio_15 != null ? String(p.precio_15) : "");
    setP30(p.precio_30 != null ? String(p.precio_30) : "");
  }

  async function eliminarPrecio(p: PrecioEspecial) {
    if (!confirm(`¿Eliminar el precio especial del ${p.fecha}?\n\nLas nuevas reservas usarán el precio normal. No cambia reservas ya pagadas.`)) return;
    const res = await fetch(`/api/admin/bloqueos/precios/${p.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Error eliminando el precio"); return; }
    setPrecios((prev) => prev.filter((x) => x.id !== p.id));
  }

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
              {bloqueos.map((b) => {
                const est = estadoBloqueoEfectivo(b);
                return (
                <div
                  key={b.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                    est === "inactivo"
                      ? "border-white/5 bg-white/[0.02] opacity-50"
                      : "border-white/10 bg-black"
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
                    <span className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${ESTADO_CHIP[est]}`} title="Estado efectivo según fecha/hora">
                      {ESTADO_LABEL[est]}
                    </span>
                    <button
                      type="button"
                      onClick={() => cambiarEstado(b)}
                      title={b.activo ? "Desactivar manualmente" : "Reactivar"}
                      className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:bg-white/10"
                    >
                      {b.activo ? "Desactivar" : "Activar"}
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
                );
              })}
            </div>
          )}
        </div>

        {/* ── PRECIOS ESPECIALES (independientes de los bloqueos) ── */}
        <form onSubmit={guardarPrecio} className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-1 text-xl font-black uppercase text-red-500">Precios especiales</h2>
          <p className="mb-4 text-xs text-white/50">
            Precio excepcional de reserva online para una fecha concreta. Vacío = usar el precio normal para esa duración. No bloquea horarios ni cambia la disponibilidad.
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            <Campo label="Fecha">
              <input type="date" value={pFecha} onChange={(e) => setPFecha(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
            </Campo>
            <Campo label="Precio 15 min">
              <input type="number" min={0} value={p15} onChange={(e) => setP15(e.target.value)} placeholder="Normal"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500" />
            </Campo>
            <Campo label="Precio 30 min">
              <input type="number" min={0} value={p30} onChange={(e) => setP30(e.target.value)} placeholder="Normal"
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-red-500" />
            </Campo>
            <div className="flex items-end">
              <button type="submit" disabled={guardandoPrecio}
                className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
                {guardandoPrecio ? "Guardando..." : "Guardar precio"}
              </button>
            </div>
          </div>
        </form>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">Precios especiales creados</h2>
          {precios.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <p className="text-white/60">Todavía no hay precios especiales.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {precios.map((p) => {
                const activo = p.fecha >= hoyAR();
                return (
                  <div key={p.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${activo ? "border-white/10 bg-black" : "border-white/5 bg-white/[0.02] opacity-50"}`}>
                    <div className="min-w-[220px]">
                      <p className="font-black text-red-500">{p.fecha}</p>
                      <p className="text-xs text-white/60">15 min: <b className="text-white">{fmtMoney(p.precio_15)}</b> · 30 min: <b className="text-white">{fmtMoney(p.precio_30)}</b></p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${activo ? "bg-green-600 text-white" : "bg-zinc-800 text-zinc-400"}`}>
                        {activo ? "Activo" : "Inactivo"}
                      </span>
                      <button type="button" onClick={() => editarPrecio(p)}
                        className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 transition hover:bg-white/10">Editar</button>
                      <button type="button" onClick={() => eliminarPrecio(p)}
                        className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-400 transition hover:bg-red-600 hover:text-white">Eliminar</button>
                    </div>
                  </div>
                );
              })}
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

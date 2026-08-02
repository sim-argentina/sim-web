"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Pendiente = {
  id: number;
  descripcion: string;
  fecha_limite: string | null;
  completado: boolean;
  completado_at: string | null;
  created_at: string;
  updated_at: string;
};

// Hoy en zona horaria de Argentina, como 'YYYY-MM-DD' (para comparar con fecha_limite).
function hoyAR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fechaBonita(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function fechaHora(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(dt);
}

type EstadoFecha = "vencido" | "hoy" | "futuro" | "sinfecha";
function estadoFecha(p: Pendiente, hoy: string): EstadoFecha {
  if (!p.fecha_limite) return "sinfecha";
  const f = p.fecha_limite.slice(0, 10);
  if (f < hoy) return "vencido";
  if (f === hoy) return "hoy";
  return "futuro";
}

function BadgeFecha({ p, hoy }: { p: Pendiente; hoy: string }) {
  const est = estadoFecha(p, hoy);
  if (est === "vencido") return <span className="inline-flex rounded-full border border-red-500/40 bg-red-500/15 px-2.5 py-0.5 text-xs font-black text-red-400">Vencido</span>;
  if (est === "hoy") return <span className="inline-flex rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-xs font-black text-amber-400">Hoy</span>;
  if (est === "futuro") return <span className="inline-flex rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-0.5 text-xs font-black text-white/70">{fechaBonita(p.fecha_limite)}</span>;
  return <span className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-xs font-black text-zinc-500">Sin fecha</span>;
}

const ORDEN_GRUPO: Record<EstadoFecha, number> = { vencido: 0, hoy: 1, futuro: 2, sinfecha: 3 };

export default function AdminPendientesPage() {
  const [items, setItems] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [modal, setModal] = useState<null | { id: number | null; descripcion: string; fecha_limite: string }>(null);
  const [guardando, setGuardando] = useState(false);
  const [aEliminar, setAEliminar] = useState<Pendiente | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  const hoy = hoyAR();

  const mostrarAviso = useCallback((msg: string) => {
    setAviso(msg);
    setTimeout(() => setAviso(null), 3000);
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pendientes", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error cargando pendientes"); return; }
      setItems(Array.isArray(data.pendientes) ? data.pendientes : []);
    } catch {
      setError("Error cargando pendientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const pendientes = useMemo(() => {
    return items
      .filter((p) => !p.completado)
      .sort((a, b) => {
        const ga = ORDEN_GRUPO[estadoFecha(a, hoy)];
        const gb = ORDEN_GRUPO[estadoFecha(b, hoy)];
        if (ga !== gb) return ga - gb;
        if (a.fecha_limite && b.fecha_limite && a.fecha_limite !== b.fecha_limite) {
          return a.fecha_limite < b.fecha_limite ? -1 : 1; // fecha ascendente
        }
        return b.created_at.localeCompare(a.created_at); // más recientes primero
      });
  }, [items, hoy]);

  const completados = useMemo(() => {
    return items
      .filter((p) => p.completado)
      .sort((a, b) => (b.completado_at || "").localeCompare(a.completado_at || ""));
  }, [items]);

  function abrirNuevo() { setModal({ id: null, descripcion: "", fecha_limite: "" }); }
  function abrirEdicion(p: Pendiente) { setModal({ id: p.id, descripcion: p.descripcion, fecha_limite: p.fecha_limite ? p.fecha_limite.slice(0, 10) : "" }); }

  async function guardar() {
    if (!modal) return;
    const descripcion = modal.descripcion.trim();
    if (!descripcion) { mostrarAviso("Escribí qué hay que hacer."); return; }
    setGuardando(true);
    try {
      const body = { descripcion, fecha_limite: modal.fecha_limite || null };
      const url = modal.id ? `/api/pendientes/${modal.id}` : "/api/pendientes";
      const res = await fetch(url, {
        method: modal.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { mostrarAviso(data.error || "No se pudo guardar"); return; }
      setModal(null);
      await cargar();
      mostrarAviso(modal.id ? "Pendiente actualizado" : "Pendiente agregado");
    } catch {
      mostrarAviso("No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function toggleCompletado(p: Pendiente) {
    setToggling(p.id);
    // Optimista.
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, completado: !p.completado, completado_at: !p.completado ? new Date().toISOString() : null } : x)));
    try {
      const res = await fetch(`/api/pendientes/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completado: !p.completado }),
      });
      if (!res.ok) { await cargar(); const d = await res.json().catch(() => null); mostrarAviso(d?.error || "No se pudo actualizar"); return; }
      const data = await res.json();
      setItems((prev) => prev.map((x) => (x.id === p.id ? (data.pendiente as Pendiente) : x)));
      mostrarAviso(!p.completado ? "Marcado como completado" : "Devuelto a pendientes");
    } catch {
      await cargar();
      mostrarAviso("No se pudo actualizar");
    } finally {
      setToggling(null);
    }
  }

  async function eliminar() {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/pendientes/${aEliminar.id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => null); mostrarAviso(d?.error || "No se pudo eliminar"); return; }
      setItems((prev) => prev.filter((x) => x.id !== aEliminar.id));
      setAEliminar(null);
      mostrarAviso("Pendiente eliminado");
    } catch {
      mostrarAviso("No se pudo eliminar");
    } finally {
      setEliminando(false);
    }
  }

  return (
    <div className="min-h-screen bg-black p-4 md:p-8">
      {/* Encabezado */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-black uppercase tracking-[0.3em] text-red-500">Panel Admin</p>
          <h1 className="text-3xl font-black text-white">Pendientes</h1>
          <p className="mt-1 text-sm text-zinc-500">Organizá las tareas y cosas por hacer de SIM.</p>
        </div>
        <button onClick={abrirNuevo} className="shrink-0 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-red-500">
          + Nuevo pendiente
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500">Cargando pendientes...</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-6 text-center">
          <p className="text-sm font-bold text-red-400">{error}</p>
          <button onClick={cargar} className="mt-3 rounded-xl border border-white/15 px-4 py-2 text-xs font-bold text-white/80 hover:text-white">Reintentar</button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Pendientes */}
          <section>
            <h2 className="mb-3 text-lg font-black uppercase text-white">Pendientes <span className="text-white/40">({pendientes.length})</span></h2>
            {pendientes.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] py-14 text-center">
                <p className="font-bold text-white/80">No hay pendientes.</p>
                <p className="mt-1 text-sm text-zinc-500">Está todo al día.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendientes.map((p) => (
                  <div key={p.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={toggling === p.id}
                        onChange={() => toggleCompletado(p)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-red-600"
                        aria-label="Marcar como completado"
                      />
                      <div className="min-w-0">
                        <p className="break-words font-bold text-white">{p.descripcion}</p>
                        <div className="mt-1.5"><BadgeFecha p={p} hoy={hoy} /></div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 sm:pl-3">
                      <button onClick={() => abrirEdicion(p)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white">Editar</button>
                      <button onClick={() => setAEliminar(p)} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10">Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Completados */}
          {completados.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-black uppercase text-white">Completados <span className="text-white/40">({completados.length})</span></h2>
              <div className="space-y-2">
                {completados.map((p) => (
                  <div key={p.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 opacity-70 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked
                        disabled={toggling === p.id}
                        onChange={() => toggleCompletado(p)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-red-600"
                        aria-label="Volver a pendiente"
                      />
                      <div className="min-w-0">
                        <p className="break-words font-bold text-white/60 line-through">{p.descripcion}</p>
                        <p className="mt-1 text-xs text-zinc-500">Completado: {fechaHora(p.completado_at)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 sm:pl-3">
                      <button onClick={() => abrirEdicion(p)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white">Editar</button>
                      <button onClick={() => setAEliminar(p)} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10">Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Modal nuevo/editar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => !guardando && setModal(null)}>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-black text-white">{modal.id ? "Editar pendiente" : "Nuevo pendiente"}</h2>
              <button onClick={() => !guardando && setModal(null)} className="text-2xl leading-none text-zinc-500 hover:text-white">×</button>
            </div>
            <label className="mb-1 block text-xs font-black uppercase tracking-wider text-zinc-500">¿Qué hay que hacer?</label>
            <textarea
              value={modal.descripcion}
              onChange={(e) => setModal((m) => (m ? { ...m, descripcion: e.target.value } : m))}
              rows={3}
              autoFocus
              placeholder="Ej: Comprar insumos de limpieza"
              className="w-full resize-none rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-red-500"
            />
            <label className="mb-1 mt-4 block text-xs font-black uppercase tracking-wider text-zinc-500">Fecha límite (opcional)</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={modal.fecha_limite}
                onChange={(e) => setModal((m) => (m ? { ...m, fecha_limite: e.target.value } : m))}
                className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none focus:border-red-500"
              />
              {modal.fecha_limite && (
                <button onClick={() => setModal((m) => (m ? { ...m, fecha_limite: "" } : m))} className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-zinc-400 hover:text-white">Quitar</button>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setModal(null)} disabled={guardando} className="rounded-xl border border-white/10 px-5 py-2 text-sm font-bold text-zinc-300 hover:text-white disabled:opacity-50">Cancelar</button>
              <button onClick={guardar} disabled={guardando || !modal.descripcion.trim()} className="rounded-xl bg-red-600 px-6 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50">
                {guardando ? "Guardando..." : modal.id ? "Guardar cambios" : "Agregar pendiente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar eliminación */}
      {aEliminar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => !eliminando && setAEliminar(null)}>
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-white">¿Eliminar este pendiente?</h3>
            <p className="mt-2 text-sm text-zinc-400">Esta acción no se puede deshacer.</p>
            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-bold text-white break-words">{aEliminar.descripcion}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setAEliminar(null)} disabled={eliminando} className="rounded-xl border border-white/10 px-5 py-2 text-sm font-bold text-zinc-300 hover:text-white disabled:opacity-50">Cancelar</button>
              <button onClick={eliminar} disabled={eliminando} className="rounded-xl bg-red-600 px-6 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50">{eliminando ? "Eliminando..." : "Eliminar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {aviso && (
        <div className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-white/15 bg-zinc-900 px-5 py-3 text-sm font-bold text-white shadow-2xl">
          {aviso}
        </div>
      )}
    </div>
  );
}

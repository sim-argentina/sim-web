"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_TITULO,
  MAX_DESCRIPCION,
  estadoFecha,
  agruparAbiertos,
  ordenarCompletados,
  type EstadoFecha,
} from "@/lib/pendientes";

type Pendiente = {
  id: number;
  titulo: string;
  descripcion: string | null;
  fecha_limite: string | null;
  completado: boolean;
  completado_at: string | null;
  created_at: string;
  updated_at: string;
};

type Filtro = "todos" | "proximos" | "sinfecha" | "completados";

// Hoy en zona horaria de Argentina, como 'YYYY-MM-DD' (para comparar con fecha_limite).
function hoyAR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// dd/mm/aaaa a partir de 'YYYY-MM-DD' (sin new Date(), sin corrimiento de día).
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

function BadgeFecha({ estado, fecha }: { estado: EstadoFecha; fecha: string | null }) {
  const base = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-black";
  if (estado === "vencido") return <span className={`${base} border border-red-500/40 bg-red-500/15 text-red-400`}>Vencido · {fechaBonita(fecha)}</span>;
  if (estado === "hoy") return <span className={`${base} bg-red-600 text-white`}>Hoy</span>;
  if (estado === "pronto") return <span className={`${base} border border-amber-500/40 bg-amber-500/15 text-amber-400`}>{fechaBonita(fecha)}</span>;
  if (estado === "futuro") return <span className={`${base} border border-white/15 bg-white/[0.05] text-white/70`}>{fechaBonita(fecha)}</span>;
  return <span className={`${base} border border-white/10 bg-white/[0.03] text-zinc-500`}>Sin fecha</span>;
}

// Menú de tres puntos (sin dependencias nuevas): botón + panel + cierre por click afuera.
function MenuAcciones({ onEditar, onEliminar }: { onEditar: () => void; onEliminar: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Acciones"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none text-white/50 transition hover:bg-white/10 hover:text-white"
      >
        ⋮
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-36 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-2xl">
            <button
              onClick={() => { setOpen(false); onEditar(); }}
              className="block w-full px-4 py-2.5 text-left text-sm font-bold text-zinc-200 hover:bg-white/10"
            >
              Editar
            </button>
            <button
              onClick={() => { setOpen(false); onEliminar(); }}
              className="block w-full px-4 py-2.5 text-left text-sm font-bold text-red-400 hover:bg-red-500/10"
            >
              Eliminar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Fila({
  p, hoy, onToggle, onEditar, onEliminar, onAbrir, disabled,
}: {
  p: Pendiente; hoy: string; onToggle: () => void; onEditar: () => void; onEliminar: () => void; onAbrir: () => void; disabled: boolean;
}) {
  const est = estadoFecha(p.fecha_limite, hoy);
  const completado = p.completado;
  return (
    <div
      onClick={onAbrir}
      className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 px-3 py-3 transition hover:border-white/20 hover:bg-white/[0.06] sm:px-4 ${completado ? "bg-white/[0.02] opacity-70" : "bg-white/[0.03]"}`}
    >
      {/* stopPropagation: completar/restaurar no debe abrir la lectura. */}
      <label className="flex shrink-0 cursor-pointer items-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={completado}
          disabled={disabled}
          onChange={onToggle}
          className="h-5 w-5 accent-red-600"
          aria-label={completado ? "Volver a pendiente" : "Marcar como completado"}
        />
      </label>

      <div className="min-w-0 flex-1">
        <p className={`truncate font-bold ${completado ? "text-white/60 line-through" : "text-white"}`}>{p.titulo}</p>
        {p.descripcion ? (
          <p className={`truncate text-xs ${completado ? "text-zinc-600 line-through" : "text-zinc-400"}`}>{p.descripcion}</p>
        ) : completado ? (
          <p className="truncate text-xs text-zinc-600">Completado: {fechaHora(p.completado_at)}</p>
        ) : null}
      </div>

      {completado ? (
        p.descripcion ? <span className="hidden shrink-0 text-[11px] text-zinc-600 sm:inline">Completado: {fechaHora(p.completado_at)}</span> : null
      ) : (
        <BadgeFecha estado={est} fecha={p.fecha_limite} />
      )}

      <MenuAcciones onEditar={onEditar} onEliminar={onEliminar} />
    </div>
  );
}

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "proximos", label: "Próximos" },
  { key: "sinfecha", label: "Sin fecha" },
  { key: "completados", label: "Completados" },
];

export default function PendientesClient() {
  const [items, setItems] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const [modal, setModal] = useState<null | { id: number | null; titulo: string; descripcion: string; fecha_limite: string }>(null);
  const [guardando, setGuardando] = useState(false);
  const [aEliminar, setAEliminar] = useState<Pendiente | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [verLectura, setVerLectura] = useState<Pendiente | null>(null);

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

  // Cerrar la vista de lectura con Escape (no afecta a los otros modales).
  useEffect(() => {
    if (!verLectura) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVerLectura(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [verLectura]);

  const { vencidos, proximos, sinfecha } = useMemo(() => agruparAbiertos(items, hoy), [items, hoy]);
  const completados = useMemo(() => ordenarCompletados(items), [items]);

  const cont = {
    todos: vencidos.length + proximos.length + sinfecha.length,
    proximos: vencidos.length + proximos.length,
    sinfecha: sinfecha.length,
    completados: completados.length,
  };

  function abrirNuevo() { setModal({ id: null, titulo: "", descripcion: "", fecha_limite: "" }); }
  function abrirEdicion(p: Pendiente) {
    setModal({ id: p.id, titulo: p.titulo, descripcion: p.descripcion ?? "", fecha_limite: p.fecha_limite ? p.fecha_limite.slice(0, 10) : "" });
  }

  async function guardar() {
    if (!modal) return;
    const titulo = modal.titulo.trim();
    if (!titulo) { mostrarAviso("El título es obligatorio."); return; }
    setGuardando(true);
    try {
      const body = { titulo, descripcion: modal.descripcion, fecha_limite: modal.fecha_limite || null };
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
    const nuevo = !p.completado;
    // Optimista.
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, completado: nuevo, completado_at: nuevo ? new Date().toISOString() : null } : x)));
    try {
      const res = await fetch(`/api/pendientes/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completado: nuevo }),
      });
      if (!res.ok) {
        // Revierte al estado anterior y avisa.
        setItems((prev) => prev.map((x) => (x.id === p.id ? p : x)));
        const d = await res.json().catch(() => null);
        mostrarAviso(d?.error || "No se pudo actualizar");
        return;
      }
      const data = await res.json();
      setItems((prev) => prev.map((x) => (x.id === p.id ? (data.pendiente as Pendiente) : x)));
      mostrarAviso(nuevo ? "Marcado como completado" : "Devuelto a pendientes");
    } catch {
      setItems((prev) => prev.map((x) => (x.id === p.id ? p : x)));
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

  const filaProps = (p: Pendiente) => ({
    p, hoy,
    onToggle: () => toggleCompletado(p),
    onEditar: () => abrirEdicion(p),
    onEliminar: () => setAEliminar(p),
    onAbrir: () => setVerLectura(p),
    disabled: toggling === p.id,
  });

  const Vacio = ({ txt, sub }: { txt: string; sub?: string }) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] py-12 text-center">
      <p className="font-bold text-white/80">{txt}</p>
      {sub && <p className="mt-1 text-sm text-zinc-500">{sub}</p>}
    </div>
  );

  const Grupo = ({ titulo, lista }: { titulo: string; lista: Pendiente[] }) =>
    lista.length === 0 ? null : (
      <section>
        <h2 className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-white/40">{titulo}</h2>
        <div className="space-y-2">{lista.map((p) => <Fila key={p.id} {...filaProps(p)} />)}</div>
      </section>
    );

  return (
    <div className="min-h-screen bg-black p-4 md:p-8">
      {/* Encabezado */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-black uppercase tracking-[0.3em] text-red-500">Panel Admin</p>
          <h1 className="flex items-center gap-3 text-3xl font-black text-white">
            Pendientes
            <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-sm font-black text-white">{cont.todos}</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Organizá las tareas y próximos pasos de SIM.</p>
        </div>
        <button onClick={abrirNuevo} className="shrink-0 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-red-500">
          + Nuevo pendiente
        </button>
      </div>

      {/* Filtros */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => {
          const activo = filtro === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-bold transition ${
                activo ? "border-red-500 bg-red-600 text-white" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/30 hover:text-white"
              }`}
            >
              {f.label}
              <span className={`text-xs ${activo ? "text-white/80" : "text-white/40"}`}>{cont[f.key]}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500">Cargando pendientes...</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-6 text-center">
          <p className="text-sm font-bold text-red-400">{error}</p>
          <button onClick={cargar} className="mt-3 rounded-xl border border-white/15 px-4 py-2 text-xs font-bold text-white/80 hover:text-white">Reintentar</button>
        </div>
      ) : (
        <div className="space-y-6">
          {filtro === "todos" && (
            cont.todos === 0 ? <Vacio txt="No hay pendientes." sub="Está todo al día." /> : (
              <>
                <Grupo titulo="Vencidos" lista={vencidos} />
                <Grupo titulo="Próximos" lista={proximos} />
                <Grupo titulo="Sin fecha" lista={sinfecha} />
              </>
            )
          )}

          {filtro === "proximos" && (
            cont.proximos === 0 ? <Vacio txt="No hay pendientes con fecha." /> : (
              <>
                <Grupo titulo="Vencidos" lista={vencidos} />
                <Grupo titulo="Próximos" lista={proximos} />
              </>
            )
          )}

          {filtro === "sinfecha" && (
            sinfecha.length === 0 ? <Vacio txt="No hay pendientes sin fecha." /> : (
              <div className="space-y-2">{sinfecha.map((p) => <Fila key={p.id} {...filaProps(p)} />)}</div>
            )
          )}

          {filtro === "completados" && (
            completados.length === 0 ? <Vacio txt="No hay pendientes completados." /> : (
              <div className="space-y-2">{completados.map((p) => <Fila key={p.id} {...filaProps(p)} />)}</div>
            )
          )}
        </div>
      )}

      {/* Modal de LECTURA (click en la fila) */}
      {verLectura && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/80 p-4" onClick={() => setVerLectura(null)}>
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="break-words text-xl font-black text-white">{verLectura.titulo}</h2>
              <button onClick={() => setVerLectura(null)} aria-label="Cerrar" className="shrink-0 text-2xl leading-none text-zinc-500 hover:text-white">×</button>
            </div>

            {verLectura.descripcion && (
              <div className="mb-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-200">
                {verLectura.descripcion}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-500">Fecha límite</p>
                <BadgeFecha estado={estadoFecha(verLectura.fecha_limite, hoy)} fecha={verLectura.fecha_limite} />
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-500">Estado</p>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${verLectura.completado ? "border border-green-500/30 bg-green-500/15 text-green-400" : "border border-white/15 bg-white/[0.04] text-white/70"}`}>
                  {verLectura.completado ? "Completado" : "Pendiente"}
                </span>
              </div>
            </div>

            {verLectura.completado && verLectura.completado_at && (
              <p className="mt-3 text-xs text-zinc-500">Completado el {fechaHora(verLectura.completado_at).replace(", ", " a las ")}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setVerLectura(null)} className="rounded-xl border border-white/10 px-5 py-2 text-sm font-bold text-zinc-300 hover:text-white">Cerrar</button>
              <button onClick={() => { const q = verLectura; setVerLectura(null); abrirEdicion(q); }} className="rounded-xl bg-red-600 px-6 py-2 text-sm font-black text-white hover:bg-red-500">Editar</button>
            </div>
          </div>
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

            <label className="mb-1 block text-xs font-black uppercase tracking-wider text-zinc-500">Título</label>
            <input
              type="text"
              value={modal.titulo}
              onChange={(e) => setModal((m) => (m ? { ...m, titulo: e.target.value } : m))}
              maxLength={MAX_TITULO}
              autoFocus
              placeholder="Ej: Comprar insumos de limpieza"
              className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-red-500"
            />

            <label className="mb-1 mt-4 block text-xs font-black uppercase tracking-wider text-zinc-500">Descripción (opcional)</label>
            <textarea
              value={modal.descripcion}
              onChange={(e) => setModal((m) => (m ? { ...m, descripcion: e.target.value } : m))}
              rows={3}
              maxLength={MAX_DESCRIPCION}
              placeholder="Detalles, contexto, links…"
              className="w-full resize-none rounded-xl border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-red-500"
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
              <button onClick={guardar} disabled={guardando || !modal.titulo.trim()} className="rounded-xl bg-red-600 px-6 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50">
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
            <p className="mt-3 truncate rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-bold text-white">{aEliminar.titulo}</p>
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

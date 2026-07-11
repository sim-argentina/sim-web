"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ESTADO_EVENTO_LABEL, ESTADOS_EVENTO } from "@/lib/colectivo";

type Evento = {
  id: string;
  nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  localidad: string | null;
  provincia: string | null;
  ubicacion: string | null;
  organizador: string | null;
  telefono_contacto: string | null;
  observaciones: string | null;
  estado: string;
  finalizado_at: string | null;
  created_at: string;
  turnos: number;
  facturacion_simuladores: number;
  ventas_productos: number;
  recaudacion_total: number;
};

const blankEvento = {
  nombre: "", fecha_inicio: "", fecha_fin: "", hora_inicio: "", hora_fin: "",
  localidad: "", provincia: "", ubicacion: "", organizador: "", telefono_contacto: "", observaciones: "",
};

function dinero(v: number) {
  return `$${(Number(v) || 0).toLocaleString("es-AR")}`;
}
function badgeClase(estado: string) {
  if (estado === "activo") return "bg-green-900 text-green-300";
  if (estado === "proximo") return "bg-blue-900 text-blue-300";
  if (estado === "cancelado") return "bg-red-900 text-red-300";
  return "bg-zinc-800 text-zinc-400"; // finalizado
}

const inp = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none focus:border-red-500 placeholder:text-white/30";

export default function ColectivoPage() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankEvento);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [filtros, setFiltros] = useState({ q: "", estado: "", fecha: "" });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/colectivo/eventos", { cache: "no-store" });
      const d = await r.json();
      if (r.ok) setEventos(d.eventos || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then((d) => setRole(d.role)).catch(() => {});
    cargar();
  }, [cargar]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const abrirNuevo = () => { setForm(blankEvento); setEditId(null); setMsg(""); setShowForm(true); };
  const abrirEdicion = (e: Evento) => {
    setEditId(e.id);
    setForm({
      nombre: e.nombre, fecha_inicio: e.fecha_inicio, fecha_fin: e.fecha_fin,
      hora_inicio: e.hora_inicio || "", hora_fin: e.hora_fin || "", localidad: e.localidad || "",
      provincia: e.provincia || "", ubicacion: e.ubicacion || "", organizador: e.organizador || "",
      telefono_contacto: e.telefono_contacto || "", observaciones: e.observaciones || "",
    });
    setMsg(""); setShowForm(true);
  };

  const guardar = async () => {
    if (!form.nombre.trim() || !form.fecha_inicio || !form.fecha_fin) {
      setMsg("Nombre, fecha de inicio y fecha de fin son obligatorias."); return;
    }
    setSaving(true); setMsg("");
    try {
      const url = editId ? `/api/admin/colectivo/eventos/${editId}` : "/api/admin/colectivo/eventos";
      const r = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || "Error"); return; }
      setShowForm(false); setForm(blankEvento); setEditId(null); cargar();
    } finally { setSaving(false); }
  };

  const accion = async (id: string, accion: string, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const r = await fetch(`/api/admin/colectivo/eventos/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); return; }
    cargar();
  };
  const eliminar = async (id: string) => {
    if (!confirm("¿Eliminar este evento? Solo se puede si no tiene turnos ni ventas.")) return;
    const r = await fetch(`/api/admin/colectivo/eventos/${id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); return; }
    cargar();
  };

  const filtrados = useMemo(() => {
    const q = filtros.q.trim().toLowerCase();
    return eventos.filter((e) => {
      if (filtros.estado && e.estado !== filtros.estado) return false;
      if (filtros.fecha && !(e.fecha_inicio <= filtros.fecha && e.fecha_fin >= filtros.fecha)) return false;
      if (q && !`${e.nombre} ${e.localidad || ""} ${e.provincia || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [eventos, filtros]);

  // Activos y próximos: del más cercano. Historial (finalizado/cancelado): más reciente primero.
  const activos = useMemo(
    () => filtrados.filter((e) => e.estado === "activo" || e.estado === "proximo")
      .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio)),
    [filtrados]
  );
  const historial = useMemo(
    () => filtrados.filter((e) => e.estado === "finalizado" || e.estado === "cancelado")
      .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)),
    [filtrados]
  );

  const esAdmin = role === "admin";

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Admin SIM</p>
            <h1 className="text-3xl font-black uppercase md:text-5xl">Colectivo</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">Eventos itinerantes con turnero de simuladores y venta de productos.</p>
          </div>
          {!showForm && (
            <button onClick={abrirNuevo} className="rounded-xl bg-red-600 px-5 py-3 text-sm font-black uppercase transition hover:bg-red-700">
              + Nuevo evento
            </button>
          )}
        </div>

        {showForm && (
          <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="mb-4 text-xl font-black uppercase text-red-500">{editId ? "Editar evento" : "Nuevo evento"}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Campo label="Nombre *"><input className={inp} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} /></Campo>
              <Campo label="Fecha inicio *"><input type="date" className={inp} value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} /></Campo>
              <Campo label="Fecha fin *"><input type="date" className={inp} value={form.fecha_fin} onChange={(e) => set("fecha_fin", e.target.value)} /></Campo>
              <Campo label="Hora inicio"><input type="time" className={inp} value={form.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} /></Campo>
              <Campo label="Hora fin"><input type="time" className={inp} value={form.hora_fin} onChange={(e) => set("hora_fin", e.target.value)} /></Campo>
              <Campo label="Localidad"><input className={inp} value={form.localidad} onChange={(e) => set("localidad", e.target.value)} /></Campo>
              <Campo label="Provincia"><input className={inp} value={form.provincia} onChange={(e) => set("provincia", e.target.value)} /></Campo>
              <Campo label="Dirección / ubicación"><input className={inp} value={form.ubicacion} onChange={(e) => set("ubicacion", e.target.value)} /></Campo>
              <Campo label="Organizador / contratante"><input className={inp} value={form.organizador} onChange={(e) => set("organizador", e.target.value)} /></Campo>
              <Campo label="Teléfono de contacto"><input className={inp} value={form.telefono_contacto} onChange={(e) => set("telefono_contacto", e.target.value)} /></Campo>
              <div className="md:col-span-2 xl:col-span-2"><Campo label="Observaciones"><input className={inp} value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)} /></Campo></div>
            </div>
            {msg && <p className="mt-3 text-sm font-bold text-red-400">{msg}</p>}
            <div className="mt-4 flex gap-3">
              <button onClick={guardar} disabled={saving} className="rounded-xl bg-red-600 px-6 py-2 font-black uppercase text-white hover:bg-red-700 disabled:opacity-50">{saving ? "Guardando..." : editId ? "Guardar cambios" : "Crear evento"}</button>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="rounded-xl border border-white/15 px-6 py-2 font-black uppercase text-white/70 hover:border-white hover:text-white">Cancelar</button>
            </div>
          </div>
        )}

        <div className="mb-5 flex flex-wrap gap-2">
          <input className={`${inp} flex-1 min-w-[160px]`} placeholder="Buscar por nombre o localidad..." value={filtros.q} onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value }))} />
          <select className={`${inp} min-w-[150px]`} value={filtros.estado} onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value }))}>
            <option value="">Todos los estados</option>
            {ESTADOS_EVENTO.map((s) => <option key={s} value={s}>{ESTADO_EVENTO_LABEL[s]}</option>)}
          </select>
          <input type="date" className={`${inp} min-w-[150px]`} value={filtros.fecha} onChange={(e) => setFiltros((f) => ({ ...f, fecha: e.target.value }))} />
        </div>

        {loading ? (
          <p className="text-white/60">Cargando eventos...</p>
        ) : (
          <>
            <Seccion titulo="Activos y próximos" eventos={activos} esAdmin={esAdmin} onEditar={abrirEdicion} onAccion={accion} onEliminar={eliminar} vacio="No hay eventos activos ni próximos." />
            <Seccion titulo="Historial de eventos" eventos={historial} esAdmin={esAdmin} onEditar={abrirEdicion} onAccion={accion} onEliminar={eliminar} vacio="Todavía no hay eventos finalizados." />
          </>
        )}
      </section>
    </main>
  );
}

function Seccion({ titulo, eventos, esAdmin, onEditar, onAccion, onEliminar, vacio }: {
  titulo: string; eventos: Evento[]; esAdmin: boolean;
  onEditar: (e: Evento) => void; onAccion: (id: string, a: string, c?: string) => void; onEliminar: (id: string) => void; vacio: string;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-lg font-black uppercase text-red-500">{titulo}</h2>
      {eventos.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black p-5 text-sm text-white/50">{vacio}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {eventos.map((e) => (
            <div key={e.id} className="flex flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="text-lg font-black leading-tight">{e.nombre}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black uppercase ${badgeClase(e.estado)}`}>{ESTADO_EVENTO_LABEL[e.estado] || e.estado}</span>
              </div>
              <p className="text-sm text-white/60">{e.fecha_inicio}{e.fecha_fin !== e.fecha_inicio ? ` → ${e.fecha_fin}` : ""}</p>
              <p className="text-sm text-white/45">{[e.localidad, e.provincia].filter(Boolean).join(", ") || "Sin localidad"}</p>

              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <Dato label="Turnos" valor={String(e.turnos)} />
                <Dato label="Fact. simuladores" valor={dinero(e.facturacion_simuladores)} />
                <Dato label="Ventas productos" valor={dinero(e.ventas_productos)} />
                <Dato label="Recaudación total" valor={dinero(e.recaudacion_total)} destacado />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/admin/colectivo/eventos/${e.id}`} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase text-white hover:bg-red-700">
                  {e.estado === "finalizado" || e.estado === "cancelado" ? "Ver resumen" : "Abrir"}
                </Link>
                {e.estado !== "finalizado" && e.estado !== "cancelado" && (
                  <button onClick={() => onEditar(e)} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 hover:border-white hover:text-white">Editar</button>
                )}
                {(e.estado === "activo" || e.estado === "proximo") && (
                  <button onClick={() => onAccion(e.id, "finalizar", "¿Finalizar el evento? Seguirá consultable.")} className="rounded-xl border border-amber-500/50 px-3 py-2 text-xs font-black uppercase text-amber-300 hover:bg-amber-600 hover:text-white">Finalizar</button>
                )}
                {esAdmin && e.estado === "finalizado" && (
                  <button onClick={() => onAccion(e.id, "reabrir", "¿Reabrir el evento?")} className="rounded-xl border border-blue-500/50 px-3 py-2 text-xs font-black uppercase text-blue-300 hover:bg-blue-600 hover:text-white">Reabrir</button>
                )}
                {esAdmin && e.estado !== "cancelado" && e.estado !== "finalizado" && (
                  <button onClick={() => onAccion(e.id, "cancelar", "¿Cancelar el evento?")} className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-300 hover:bg-red-700 hover:text-white">Cancelar</button>
                )}
                {esAdmin && e.turnos === 0 && e.facturacion_simuladores === 0 && e.ventas_productos === 0 && (
                  <button onClick={() => onEliminar(e.id)} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black uppercase text-white/40 hover:border-red-500 hover:text-red-300">Eliminar</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Dato({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/35">{label}</p>
      <p className={`text-sm font-black ${destacado ? "text-red-400" : "text-white"}`}>{valor}</p>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{label}</label>
      {children}
    </div>
  );
}

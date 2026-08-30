"use client";

import { useCallback, useEffect, useState } from "react";
import VistaPreviaConflictos, { type Preview } from "./VistaPreviaConflictos";

type Empleado = { id: string; nombre_formal: string };
type Plantilla = { id: string; tipo: "semanal" | "mensual"; nombre: string; activo: boolean; updated_at: string };

function lunesDe(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export default function PlantillasModal({ empleados, onAplicada, onCerrar }: { empleados: Empleado[]; onAplicada: () => void; onCerrar: () => void }) {
  const [activas, setActivas] = useState<Plantilla[]>([]);
  const [archivadas, setArchivadas] = useState<Plantilla[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [verArch, setVerArch] = useState(false);

  // Crear.
  const [tipo, setTipo] = useState<"semanal" | "mensual">("semanal");
  const [nombre, setNombre] = useState("");
  const [origenLunes, setOrigenLunes] = useState("");
  const [origenMes, setOrigenMes] = useState("");

  // Aplicar.
  const [aplicarPl, setAplicarPl] = useState<Plantilla | null>(null);
  const [destLunes, setDestLunes] = useState("");
  const [destMes, setDestMes] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/cronograma/plantillas", { cache: "no-store" });
      const j = await res.json();
      if (res.ok) { setActivas(j.activas || []); setArchivadas(j.archivadas || []); }
    } catch { /* noop */ }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function crear() {
    setMsg(null);
    if (!nombre.trim()) { setMsg("Poné un nombre."); return; }
    const body: Record<string, unknown> = { tipo, nombre: nombre.trim() };
    if (tipo === "semanal") { if (!origenLunes) { setMsg("Elegí la semana de origen."); return; } body.lunes = origenLunes; }
    else { if (!origenMes) { setMsg("Elegí el mes de origen."); return; } const [a, m] = origenMes.split("-").map(Number); body.anio = a; body.mes = m; }
    const res = await fetch("/api/admin/cronograma/plantillas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error || "No se pudo crear la plantilla."); return; }
    setNombre(""); setOrigenLunes(""); setOrigenMes("");
    await cargar();
  }

  async function mutar(id: string, accion: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/admin/cronograma/plantillas/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, ...extra }) });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error || "No se pudo actualizar la plantilla."); return; }
    await cargar();
  }

  async function previsualizarAplicacion() {
    if (!aplicarPl) return;
    setMsg(null); setPreview(null); setCargando(true);
    try {
      const body: Record<string, unknown> = { accion: "preview" };
      if (aplicarPl.tipo === "semanal") { if (!destLunes) { setMsg("Elegí la semana destino."); return; } body.lunes = destLunes; }
      else { if (!destMes) { setMsg("Elegí el mes destino."); return; } const [a, m] = destMes.split("-").map(Number); body.anio = a; body.mes = m; }
      const res = await fetch(`/api/admin/cronograma/plantillas/${aplicarPl.id}/aplicar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "No se pudo previsualizar."); return; }
      setPreview(j.preview as Preview);
    } finally { setCargando(false); }
  }

  async function aplicar(decisiones: Record<string, "actual" | "propuesta">, reemplazos: Record<string, string>) {
    if (!aplicarPl) return;
    setAplicando(true); setMsg(null);
    try {
      const body: Record<string, unknown> = { accion: "aplicar", decisiones, reemplazos };
      if (aplicarPl.tipo === "semanal") body.lunes = destLunes;
      else { const [a, m] = destMes.split("-").map(Number); body.anio = a; body.mes = m; }
      const res = await fetch(`/api/admin/cronograma/plantillas/${aplicarPl.id}/aplicar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "No se pudo aplicar."); return; }
      onAplicada();
      onCerrar();
    } finally { setAplicando(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/75 p-4" onClick={onCerrar}>
      <div className="mt-6 w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase text-red-500">Plantillas</h3>
          <button onClick={onCerrar} className="text-2xl leading-none text-white/50 hover:text-white" aria-label="Cerrar">×</button>
        </div>

        {msg && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">{msg}</p>}

        {/* Vista de aplicación */}
        {aplicarPl ? (
          <div className="space-y-3">
            <button onClick={() => { setAplicarPl(null); setPreview(null); }} className="text-xs font-black uppercase text-white/50 hover:text-white">← Volver</button>
            <p className="text-sm"><b className="text-white">{aplicarPl.nombre}</b> <span className="text-white/40">({aplicarPl.tipo})</span></p>
            <div className="flex items-end gap-2">
              {aplicarPl.tipo === "semanal" ? (
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Semana destino</label>
                  <input type="date" onChange={(e) => setDestLunes(e.target.value ? lunesDe(e.target.value) : "")} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
                  {destLunes && <p className="mt-1 text-[11px] text-white/40">Lunes: {destLunes}</p>}
                </div>
              ) : (
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Mes destino</label>
                  <input type="month" value={destMes} onChange={(e) => setDestMes(e.target.value)} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
                </div>
              )}
              <button onClick={previsualizarAplicacion} disabled={cargando} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
                {cargando ? "…" : "Previsualizar"}
              </button>
            </div>
            {preview && <VistaPreviaConflictos preview={preview} empleados={empleados} aplicando={aplicando} onAplicar={aplicar} />}
          </div>
        ) : (
          <>
            {/* Crear */}
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-2 text-xs font-black uppercase text-white/50">Crear desde el cronograma</p>
              <div className="grid gap-2 md:grid-cols-[auto_1fr_1fr_auto]">
                <select value={tipo} onChange={(e) => setTipo(e.target.value as "semanal" | "mensual")} className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs font-bold outline-none focus:border-red-500">
                  <option value="semanal">Semanal</option>
                  <option value="mensual">Mensual</option>
                </select>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" maxLength={80} className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs font-bold outline-none placeholder:text-white/30 focus:border-red-500" />
                {tipo === "semanal" ? (
                  <input type="date" onChange={(e) => setOrigenLunes(e.target.value ? lunesDe(e.target.value) : "")} title="Semana de origen" className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs font-bold outline-none focus:border-red-500" />
                ) : (
                  <input type="month" value={origenMes} onChange={(e) => setOrigenMes(e.target.value)} className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs font-bold outline-none focus:border-red-500" />
                )}
                <button onClick={crear} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black uppercase hover:bg-red-700">Guardar</button>
              </div>
              {tipo === "semanal" && origenLunes && <p className="mt-1 text-[11px] text-white/40">Lunes origen: {origenLunes}</p>}
            </div>

            {/* Activas */}
            <p className="mb-2 text-xs font-black uppercase text-white/50">Activas ({activas.length})</p>
            <div className="space-y-1">
              {activas.length === 0 && <p className="text-xs text-white/40">Sin plantillas activas.</p>}
              {activas.map((p) => (
                <FilaPlantilla key={p.id} p={p} onAplicar={() => { setAplicarPl(p); setPreview(null); }} onRenombrar={() => { const n = prompt("Nuevo nombre", p.nombre); if (n) mutar(p.id, "renombrar", { nombre: n }); }} onArchivar={() => mutar(p.id, "archivar")} />
              ))}
            </div>

            {/* Archivadas */}
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs font-black uppercase text-white/50">Archivadas ({archivadas.length})</p>
              <button onClick={() => setVerArch((v) => !v)} className="text-xs font-black uppercase text-white/50 hover:text-white">{verArch ? "Ocultar" : "Ver"}</button>
            </div>
            {verArch && (
              <div className="mt-1 space-y-1">
                {archivadas.length === 0 && <p className="text-xs text-white/40">Sin archivadas.</p>}
                {archivadas.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1.5 text-xs opacity-70">
                    <span><b className="text-white/80">{p.nombre}</b> <span className="text-white/40">({p.tipo})</span></span>
                    <button onClick={() => mutar(p.id, "reactivar")} className="rounded border border-green-500/40 px-2 py-1 text-[10px] font-black uppercase text-green-400 hover:bg-green-600 hover:text-white">Reactivar</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilaPlantilla({ p, onAplicar, onRenombrar, onArchivar }: { p: Plantilla; onAplicar: () => void; onRenombrar: () => void; onArchivar: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black px-2 py-1.5 text-xs">
      <span><b className="text-white">{p.nombre}</b> <span className="text-white/40">({p.tipo})</span></span>
      <div className="flex items-center gap-1">
        <button onClick={onAplicar} className="rounded border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/80 hover:bg-white/10">Aplicar</button>
        <button onClick={onRenombrar} className="rounded border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/60 hover:bg-white/10">Renombrar</button>
        <button onClick={onArchivar} className="rounded border border-red-500/40 px-2 py-1 text-[10px] font-black uppercase text-red-400 hover:bg-red-600 hover:text-white">Archivar</button>
      </div>
    </div>
  );
}

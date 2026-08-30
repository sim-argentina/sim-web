"use client";

import { useState } from "react";
import VistaPreviaConflictos, { type Preview } from "./VistaPreviaConflictos";

type Empleado = { id: string; nombre_formal: string };

// Lunes de la semana que contiene la fecha (YYYY-MM-DD).
function lunesDe(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - wd);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export default function CopiarModal({ empleados, onAplicada, onCerrar }: { empleados: Empleado[]; onAplicada: () => void; onCerrar: () => void }) {
  const [tab, setTab] = useState<"semana" | "mes">("semana");
  const [lunesOrigen, setLunesOrigen] = useState("");
  const [lunesDestino, setLunesDestino] = useState("");
  const [mesOrigen, setMesOrigen] = useState(""); // YYYY-MM
  const [mesDestino, setMesDestino] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function previsualizar() {
    setMsg(null);
    setPreview(null);
    setCargando(true);
    try {
      let res: Response;
      if (tab === "semana") {
        if (!lunesOrigen || !lunesDestino) { setMsg("Elegí semana de origen y destino."); return; }
        res = await fetch("/api/admin/cronograma/copia/semana", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "preview", lunesOrigen, lunesDestino }) });
      } else {
        if (!mesOrigen || !mesDestino) { setMsg("Elegí mes de origen y destino."); return; }
        const [aO, mO] = mesOrigen.split("-").map(Number);
        const [aD, mD] = mesDestino.split("-").map(Number);
        res = await fetch("/api/admin/cronograma/copia/mes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "preview", anioOrigen: aO, mesOrigen: mO, anioDestino: aD, mesDestino: mD }) });
      }
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "No se pudo generar la vista previa."); return; }
      setPreview(j.preview as Preview);
    } catch {
      setMsg("No se pudo generar la vista previa.");
    } finally {
      setCargando(false);
    }
  }

  async function aplicar(decisiones: Record<string, "actual" | "propuesta">) {
    setAplicando(true);
    setMsg(null);
    try {
      let res: Response;
      if (tab === "semana") {
        res = await fetch("/api/admin/cronograma/copia/semana", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "aplicar", lunesOrigen, lunesDestino, decisiones }) });
      } else {
        const [aO, mO] = mesOrigen.split("-").map(Number);
        const [aD, mD] = mesDestino.split("-").map(Number);
        res = await fetch("/api/admin/cronograma/copia/mes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "aplicar", anioOrigen: aO, mesOrigen: mO, anioDestino: aD, mesDestino: mD, decisiones }) });
      }
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "No se pudo aplicar."); return; }
      onAplicada();
      onCerrar();
    } catch {
      setMsg("No se pudo aplicar.");
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/75 p-4" onClick={onCerrar}>
      <div className="mt-6 w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase text-red-500">Copiar</h3>
          <button onClick={onCerrar} className="text-2xl leading-none text-white/50 hover:text-white" aria-label="Cerrar">×</button>
        </div>

        <div className="mb-4 flex gap-2">
          {(["semana", "mes"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setPreview(null); }} className={`rounded-xl px-4 py-2 text-xs font-black uppercase ${tab === t ? "bg-red-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}>
              Copiar {t}
            </button>
          ))}
        </div>

        {tab === "semana" ? (
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <Campo label="Semana de origen (cualquier día)">
              <input type="date" onChange={(e) => setLunesOrigen(e.target.value ? lunesDe(e.target.value) : "")} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
              {lunesOrigen && <p className="mt-1 text-[11px] text-white/40">Lunes: {lunesOrigen}</p>}
            </Campo>
            <Campo label="Semana de destino (cualquier día)">
              <input type="date" onChange={(e) => setLunesDestino(e.target.value ? lunesDe(e.target.value) : "")} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
              {lunesDestino && <p className="mt-1 text-[11px] text-white/40">Lunes: {lunesDestino}</p>}
            </Campo>
          </div>
        ) : (
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <Campo label="Mes de origen">
              <input type="month" value={mesOrigen} onChange={(e) => setMesOrigen(e.target.value)} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
            </Campo>
            <Campo label="Mes de destino">
              <input type="month" value={mesDestino} onChange={(e) => setMesDestino(e.target.value)} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
            </Campo>
          </div>
        )}

        <button onClick={previsualizar} disabled={cargando} className="mb-3 rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
          {cargando ? "Generando…" : "Previsualizar"}
        </button>

        {msg && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">{msg}</p>}

        {preview && <VistaPreviaConflictos preview={preview} empleados={empleados} aplicando={aplicando} onAplicar={(dec) => aplicar(dec)} />}
      </div>
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

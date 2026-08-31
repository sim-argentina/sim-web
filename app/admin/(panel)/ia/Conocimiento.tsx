"use client";

import { useCallback, useEffect, useState } from "react";

// IA SIM · Bloque 4B — Vista Conocimiento (admin-only). Estética SIM.

type Cat = { id: string; nombre: string; estado: string; documentos_activos: number };
type Doc = { id: string; titulo: string; categoria: string | null; descripcion: string | null; estado: string; vigencia_desde: string | null; vigencia_hasta: string | null; version_activa_id: string | null };
type Version = { id: string; numero: number; estado: string; nombre_original: string | null; metodo_extraccion: string | null; estado_procesamiento: string | null; paginas: number | null; hojas: number | null; diapositivas: number | null; advertencias: string[] | null; created_at: string };

const CARD = "rounded-2xl border border-white/10 bg-white/[0.04] p-5";

export default function Conocimiento() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [estado, setEstado] = useState<"activo" | "archivado">("activo");
  const [filtroCat, setFiltroCat] = useState("");
  const [q, setQ] = useState("");
  const [detalle, setDetalle] = useState<{ documento: Doc; versiones: Version[] } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const cargarCats = useCallback(async () => {
    const r = await fetch("/api/admin/ia/conocimiento/categorias", { cache: "no-store" });
    if (r.ok) setCats((await r.json()).categorias ?? []);
  }, []);
  const cargarDocs = useCallback(async () => {
    const p = new URLSearchParams({ estado });
    if (filtroCat) p.set("categoria_id", filtroCat);
    if (q.trim()) p.set("q", q.trim());
    const r = await fetch(`/api/admin/ia/conocimiento/documentos?${p}`, { cache: "no-store" });
    if (r.ok) setDocs((await r.json()).documentos ?? []);
  }, [estado, filtroCat, q]);

  useEffect(() => { cargarCats(); }, [cargarCats]);
  useEffect(() => { cargarDocs(); }, [cargarDocs]);

  async function subirDoc(file: File, titulo: string, categoriaId: string) {
    setSubiendo(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("archivo", file); fd.set("titulo", titulo); if (categoriaId) fd.set("categoria_id", categoriaId);
      const r = await fetch("/api/admin/ia/conocimiento/documentos", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || "No se pudo subir."); return; }
      // Revisar la extracción y activar.
      const cont = (j.resultado?.contenido ?? "") as string;
      const adv = (j.resultado?.advertencias ?? []) as string[];
      const revisado = window.prompt(`Vista previa del contenido extraído (${j.resultado?.estado}).${adv.length ? "\nAdvertencias: " + adv.join(" · ") : ""}\n\nEditá/confirmá el contenido y aceptá para ACTIVAR el documento:`, cont);
      if (revisado === null) { setMsg("Documento cargado en borrador (no activado)."); await cargarDocs(); return; }
      if (revisado !== cont) await fetch(`/api/admin/ia/conocimiento/versiones/${j.version_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contenido: revisado }) });
      await fetch(`/api/admin/ia/conocimiento/documentos/${j.documento_id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "activar", version_id: j.version_id }) });
      setMsg(j.duplicado_de ? "Documento activado (ojo: hay otro con el mismo archivo)." : "Documento activado.");
      await cargarDocs();
    } finally { setSubiendo(false); }
  }

  async function abrirDetalle(id: string) {
    const r = await fetch(`/api/admin/ia/conocimiento/documentos/${id}`, { cache: "no-store" });
    if (r.ok) setDetalle(await r.json());
  }
  async function accionDoc(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/ia/conocimiento/documentos/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await cargarDocs(); if (detalle?.documento.id === id) abrirDetalle(id);
  }
  async function crearCategoria() {
    const nombre = window.prompt("Nombre de la categoría:"); if (!nombre) return;
    await fetch("/api/admin/ia/conocimiento/categorias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }) });
    cargarCats();
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black uppercase text-white">Conocimiento de SIM</h2>
        <label className={`cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase ${subiendo ? "opacity-50" : "hover:bg-red-700"}`}>
          {subiendo ? "Subiendo…" : "+ Subir documento"}
          <input type="file" className="hidden" disabled={subiendo} onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const titulo = window.prompt("Título del documento:", f.name) || f.name;
            const cat = window.prompt("ID de categoría (opcional; dejá vacío para ninguna):\n" + cats.filter((c) => c.estado === "activa").map((c) => `${c.nombre} = ${c.id}`).join("\n")) || "";
            await subirDoc(f, titulo, cat); e.target.value = "";
          }} />
        </label>
      </div>
      {msg && <div className={`${CARD} border-amber-500/30 text-sm text-amber-200`}>{msg}</div>}

      {/* Categorías */}
      <div className={CARD}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase text-white/60">Categorías</h3>
          <button onClick={crearCategoria} className="text-xs text-red-400 hover:text-red-300">+ Nueva</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <span key={c.id} className={`rounded-full border px-3 py-1 text-xs ${c.estado === "archivada" ? "border-white/10 text-white/40" : "border-white/20 text-white/80"}`}>
              {c.nombre} ({c.documentos_activos})
              <button onClick={() => fetch(`/api/admin/ia/conocimiento/categorias/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: c.estado === "activa" ? "archivada" : "activa" }) }).then(cargarCats)} className="ml-2 text-white/40 hover:text-white">{c.estado === "activa" ? "archivar" : "reactivar"}</button>
            </span>
          ))}
        </div>
      </div>

      {/* Filtros + búsqueda */}
      <div className={`${CARD} flex flex-wrap items-end gap-3`}>
        <div><label className="mb-1 block text-xs text-white/50">Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value as "activo" | "archivado")} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
            <option value="activo">Activos</option><option value="archivado">Archivados</option>
          </select></div>
        <div><label className="mb-1 block text-xs text-white/50">Categoría</label>
          <select value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
            <option value="">Todas</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select></div>
        <div className="flex-1"><label className="mb-1 block text-xs text-white/50">Buscar por título</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white" placeholder="Título…" /></div>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {docs.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <div>
              <p className="font-bold text-white">{d.titulo}</p>
              <p className="text-xs text-white/40">{d.categoria ?? "Sin categoría"}{d.vigencia_desde || d.vigencia_hasta ? ` · vigencia ${d.vigencia_desde ?? "…"}→${d.vigencia_hasta ?? "…"}` : ""}{!d.version_activa_id ? " · (sin versión activa)" : ""}</p>
            </div>
            <div className="flex gap-2 text-xs">
              <button onClick={() => abrirDetalle(d.id)} className="rounded-lg border border-white/15 px-3 py-1 text-white/70 hover:text-white">Ver / versiones</button>
              <button onClick={() => accionDoc(d.id, { accion: d.estado === "activo" ? "archivar" : "reactivar" })} className="rounded-lg border border-white/15 px-3 py-1 text-white/60 hover:text-white">{d.estado === "activo" ? "Archivar" : "Reactivar"}</button>
            </div>
          </div>
        ))}
        {docs.length === 0 && <p className="text-sm text-white/40">No hay documentos {estado === "activo" ? "activos" : "archivados"}.</p>}
      </div>

      {/* Detalle / versiones */}
      {detalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" onClick={() => setDetalle(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black uppercase text-white">{detalle.documento.titulo}</h3>
            <label className="mt-4 block cursor-pointer text-sm text-red-400 hover:text-red-300">
              ⬆ Subir nueva versión (reemplaza la activa al confirmar)
              <input type="file" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const fd = new FormData(); fd.set("archivo", f);
                const r = await fetch(`/api/admin/ia/conocimiento/documentos/${detalle.documento.id}`, { method: "POST", body: fd });
                const j = await r.json();
                if (!r.ok) { alert(j.error); return; }
                const cont = (j.resultado?.contenido ?? "") as string;
                const rev = window.prompt(`Vista previa de la nueva versión (${j.resultado?.estado}). Confirmá para ACTIVAR (Cancelar deja la anterior activa):`, cont);
                if (rev === null) { abrirDetalle(detalle.documento.id); return; }
                if (rev !== cont) await fetch(`/api/admin/ia/conocimiento/versiones/${j.version_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contenido: rev }) });
                await fetch(`/api/admin/ia/conocimiento/documentos/${detalle.documento.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "activar", version_id: j.version_id }) });
                abrirDetalle(detalle.documento.id); e.target.value = "";
              }} />
            </label>
            <div className="mt-4 space-y-2">
              {detalle.versiones.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
                  <span className="text-white/80">v{v.numero} · {v.estado} · {v.metodo_extraccion ?? "-"}{v.paginas ? ` · ${v.paginas} pág` : ""}{v.hojas ? ` · ${v.hojas} hojas` : ""}{v.diapositivas ? ` · ${v.diapositivas} diapos` : ""}{v.advertencias && v.advertencias.length ? " ⚠" : ""}</span>
                  {v.estado !== "activa" && <button onClick={() => accionDoc(detalle.documento.id, { accion: "restaurar", version_base_id: v.id })} className="text-red-400 hover:text-red-300">Restaurar</button>}
                </div>
              ))}
            </div>
            <button onClick={() => setDetalle(null)} className="mt-5 w-full rounded-2xl bg-red-600 px-4 py-2 text-sm font-black uppercase hover:bg-red-700">Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Producto = {
  id: string;
  nombre: string;
  precio_predeterminado: number;
  activo: boolean;
  orden: number;
  ventas: number;
};

function dinero(v: number) {
  return `$${(Number(v) || 0).toLocaleString("es-AR")}`;
}

const inp = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none focus:border-red-500 placeholder:text-white/30";

export default function CatalogoProductos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [nuevo, setNuevo] = useState({ nombre: "", precio: "" });
  const [creando, setCreando] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ nombre: "", precio: "" });
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/colectivo/productos", { cache: "no-store" });
      const d = await r.json();
      if (r.ok) setProductos(d.productos || []);
      else setMsg({ tipo: "error", texto: d.error || "No se pudo cargar el catálogo" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const crear = async () => {
    if (!nuevo.nombre.trim()) { setMsg({ tipo: "error", texto: "El nombre es obligatorio." }); return; }
    if (nuevo.precio === "" || Number(nuevo.precio) < 0) { setMsg({ tipo: "error", texto: "Cargá un precio válido." }); return; }
    setCreando(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/colectivo/productos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nuevo.nombre, precio_predeterminado: Number(nuevo.precio) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "error", texto: d.error || "Error" }); return; }
      setNuevo({ nombre: "", precio: "" });
      setMsg({ tipo: "ok", texto: `«${d.producto?.nombre ?? nuevo.nombre.trim()}» creado. Habilitalo en los eventos donde se venda.` });
      cargar();
    } finally { setCreando(false); }
  };

  const patch = async (id: string, cambios: Record<string, unknown>, okTexto: string) => {
    setOcupado(id); setMsg(null);
    try {
      const r = await fetch("/api/admin/colectivo/productos", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...cambios }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "error", texto: d.error || "Error" }); return false; }
      setMsg({ tipo: "ok", texto: okTexto });
      cargar();
      return true;
    } finally { setOcupado(null); }
  };

  const abrirEdicion = (p: Producto) => { setEditId(p.id); setEdit({ nombre: p.nombre, precio: String(p.precio_predeterminado) }); setMsg(null); };
  const guardarEdicion = async (p: Producto) => {
    if (!edit.nombre.trim()) { setMsg({ tipo: "error", texto: "El nombre es obligatorio." }); return; }
    if (edit.precio === "" || Number(edit.precio) < 0) { setMsg({ tipo: "error", texto: "Cargá un precio válido." }); return; }
    const ok = await patch(p.id, { nombre: edit.nombre, precio_predeterminado: Number(edit.precio) },
      "Producto actualizado. Las ventas ya registradas conservan su precio.");
    if (ok) setEditId(null);
  };

  const eliminar = async (p: Producto) => {
    const texto = p.ventas > 0
      ? `«${p.nombre}» tiene ${p.ventas} ${p.ventas === 1 ? "venta registrada" : "ventas registradas"}: no se elimina, se desactiva y conserva todo su historial. ¿Continuar?`
      : `¿Eliminar «${p.nombre}» definitivamente? Nunca se vendió.`;
    if (!confirm(texto)) return;
    setOcupado(p.id); setMsg(null);
    try {
      const r = await fetch(`/api/admin/colectivo/productos?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "error", texto: d.error || "Error" }); return; }
      setMsg({
        tipo: "ok",
        texto: d.resultado === "desactivado"
          ? `«${p.nombre}» tiene ventas: quedó desactivado y conserva su historial.`
          : `«${p.nombre}» eliminado.`,
      });
      cargar();
    } finally { setOcupado(null); }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-5xl">
        <Link href="/admin/colectivo" className="mb-2 inline-block text-xs font-black uppercase tracking-[0.2em] text-white/50 hover:text-white">← Volver a eventos</Link>
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Colectivo</p>
          <h1 className="text-3xl font-black uppercase md:text-5xl">Productos</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Catálogo de productos del Colectivo. Qué se vende en cada evento se elige dentro del evento, en «Productos del evento».
            Cambiar un precio o desactivar un producto no modifica las ventas ya registradas.
          </p>
        </div>

        <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">Nuevo producto</h2>
          <div className="grid gap-3 md:grid-cols-[1fr_200px_auto]">
            <Campo label="Nombre"><input className={inp} value={nuevo.nombre} maxLength={60} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} placeholder="Ej.: Remera" /></Campo>
            <Campo label="Precio predeterminado"><input type="number" min={0} className={inp} value={nuevo.precio} onChange={(e) => setNuevo((n) => ({ ...n, precio: e.target.value }))} placeholder="0" /></Campo>
            <div className="flex items-end">
              <button onClick={crear} disabled={creando} className="w-full rounded-xl bg-red-600 px-6 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:opacity-50">{creando ? "Creando..." : "Crear producto"}</button>
            </div>
          </div>
        </div>

        {msg && (
          <p className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-bold ${msg.tipo === "ok" ? "border-green-500/30 bg-green-950/20 text-green-300" : "border-red-500/30 bg-red-950/20 text-red-300"}`}>{msg.texto}</p>
        )}

        {loading ? (
          <p className="text-white/60">Cargando productos...</p>
        ) : productos.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black p-5 text-sm text-white/50">Todavía no hay productos.</div>
        ) : (
          <div className="space-y-2">
            {productos.map((p) => {
              const enEdicion = editId === p.id;
              const bloqueado = ocupado !== null;
              return (
                <div key={p.id} className={`rounded-2xl border p-4 ${p.activo ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-black opacity-70"}`}>
                  {enEdicion ? (
                    <div className="grid gap-3 md:grid-cols-[1fr_200px_auto]">
                      <Campo label="Nombre"><input className={inp} value={edit.nombre} maxLength={60} onChange={(e) => setEdit((x) => ({ ...x, nombre: e.target.value }))} /></Campo>
                      <Campo label="Precio predeterminado"><input type="number" min={0} className={inp} value={edit.precio} onChange={(e) => setEdit((x) => ({ ...x, precio: e.target.value }))} /></Campo>
                      <div className="flex items-end gap-2">
                        <button onClick={() => guardarEdicion(p)} disabled={bloqueado} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase hover:bg-red-700 disabled:opacity-50">Guardar</button>
                        <button onClick={() => setEditId(null)} disabled={bloqueado} className="rounded-xl border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 hover:border-white hover:text-white disabled:opacity-50">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-black">{p.nombre}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black uppercase ${p.activo ? "bg-green-900 text-green-300" : "bg-zinc-800 text-zinc-400"}`}>{p.activo ? "Activo" : "Inactivo"}</span>
                        </div>
                        <p className="text-sm text-white/60">
                          <span className="font-black text-red-400">{dinero(p.precio_predeterminado)}</span>
                          <span className="text-white/40"> · {p.ventas === 0 ? "sin ventas" : `${p.ventas} ${p.ventas === 1 ? "venta" : "ventas"}`}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => abrirEdicion(p)} disabled={bloqueado} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 hover:border-white hover:text-white disabled:opacity-50">Editar</button>
                        {p.activo ? (
                          <button onClick={() => patch(p.id, { activo: false }, `«${p.nombre}» desactivado: deja de ofrecerse en las ventas nuevas.`)} disabled={bloqueado} className="rounded-xl border border-amber-500/50 px-3 py-2 text-xs font-black uppercase text-amber-300 hover:bg-amber-600 hover:text-white disabled:opacity-50">Desactivar</button>
                        ) : (
                          <button onClick={() => patch(p.id, { activo: true }, `«${p.nombre}» activado. Se vende en los eventos donde esté habilitado.`)} disabled={bloqueado} className="rounded-xl border border-green-500/50 px-3 py-2 text-xs font-black uppercase text-green-300 hover:bg-green-700 hover:text-white disabled:opacity-50">Activar</button>
                        )}
                        {(p.ventas === 0 || p.activo) && (
                          <button onClick={() => eliminar(p)} disabled={bloqueado} className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-300 hover:bg-red-700 hover:text-white disabled:opacity-50">Eliminar</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
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

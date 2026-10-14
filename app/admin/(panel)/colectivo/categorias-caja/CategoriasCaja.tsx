"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TIPOS_CAJA, PILL_TIPO_CAJA, type TipoCaja } from "@/lib/colectivo";

type Categoria = {
  id: string;
  nombre: string;
  tipo: TipoCaja;
  activo: boolean;
  movimientos: number;
};

const inp = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none focus:border-red-500 placeholder:text-white/30";

export default function CategoriasCaja() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [nueva, setNueva] = useState<{ nombre: string; tipo: TipoCaja }>({ nombre: "", tipo: "costo" });
  const [creando, setCreando] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ nombre: string; tipo: TipoCaja }>({ nombre: "", tipo: "costo" });
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/colectivo/caja-categorias", { cache: "no-store" });
      const d = await r.json();
      if (r.ok) setCategorias(d.categorias || []);
      else setMsg({ tipo: "error", texto: d.error || "No se pudieron cargar las categorías" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const crear = async () => {
    if (!nueva.nombre.trim()) { setMsg({ tipo: "error", texto: "El nombre es obligatorio." }); return; }
    setCreando(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/colectivo/caja-categorias", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nueva),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "error", texto: d.error || "Error" }); return; }
      setNueva({ nombre: "", tipo: nueva.tipo });
      setMsg({ tipo: "ok", texto: `«${d.categoria?.nombre ?? nueva.nombre.trim()}» creada como ${d.categoria?.tipo === "gasto" ? "gasto" : "costo"}.` });
      cargar();
    } finally { setCreando(false); }
  };

  const patch = async (id: string, cambios: Record<string, unknown>, okTexto: string) => {
    setOcupado(id); setMsg(null);
    try {
      const r = await fetch("/api/admin/colectivo/caja-categorias", {
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

  const abrirEdicion = (c: Categoria) => { setEditId(c.id); setEdit({ nombre: c.nombre, tipo: c.tipo }); setMsg(null); };
  const guardarEdicion = async (c: Categoria) => {
    if (!edit.nombre.trim()) { setMsg({ tipo: "error", texto: "El nombre es obligatorio." }); return; }
    const cambioTipo = edit.tipo !== c.tipo;
    const ok = await patch(c.id, { nombre: edit.nombre, tipo: edit.tipo },
      cambioTipo && c.movimientos > 0
        ? "Categoría actualizada. Los movimientos ya cargados conservan su tipo; los nuevos toman el nuevo."
        : "Categoría actualizada.");
    if (ok) setEditId(null);
  };

  const eliminar = async (c: Categoria) => {
    const texto = c.movimientos > 0
      ? `«${c.nombre}» tiene ${c.movimientos} ${c.movimientos === 1 ? "movimiento" : "movimientos"}: no se elimina, se desactiva y conserva el histórico. ¿Continuar?`
      : `¿Eliminar «${c.nombre}» definitivamente? Nunca se usó.`;
    if (!confirm(texto)) return;
    setOcupado(c.id); setMsg(null);
    try {
      const r = await fetch(`/api/admin/colectivo/caja-categorias?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "error", texto: d.error || "Error" }); return; }
      setMsg({
        tipo: "ok",
        texto: d.resultado === "desactivada"
          ? `«${c.nombre}» tiene movimientos: quedó desactivada y conserva el histórico.`
          : `«${c.nombre}» eliminada.`,
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
          <h1 className="text-3xl font-black uppercase md:text-5xl">Categorías de caja</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Cada categoría es un costo (directo del evento) o un gasto. Al registrar un movimiento en la caja se hereda el tipo de su categoría.
            Cambiar el nombre o el tipo, o desactivar una categoría, no modifica los movimientos ya cargados. Uso interno del Colectivo: no impacta en Finanzas SIM.
          </p>
        </div>

        <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-4 text-xl font-black uppercase text-red-500">Nueva categoría</h2>
          <div className="grid gap-3 md:grid-cols-[1fr_200px_auto]">
            <Campo label="Nombre"><input className={inp} value={nueva.nombre} maxLength={60} onChange={(e) => setNueva((n) => ({ ...n, nombre: e.target.value }))} placeholder="Ej.: Alojamiento" /></Campo>
            <Campo label="Tipo">
              <select className={inp} value={nueva.tipo} onChange={(e) => setNueva((n) => ({ ...n, tipo: e.target.value as TipoCaja }))}>
                {TIPOS_CAJA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Campo>
            <div className="flex items-end">
              <button onClick={crear} disabled={creando} className="w-full rounded-xl bg-red-600 px-6 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:opacity-50">{creando ? "Creando..." : "Crear categoría"}</button>
            </div>
          </div>
        </div>

        {msg && (
          <p className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-bold ${msg.tipo === "ok" ? "border-green-500/30 bg-green-950/20 text-green-300" : "border-red-500/30 bg-red-950/20 text-red-300"}`}>{msg.texto}</p>
        )}

        {loading ? (
          <p className="text-white/60">Cargando categorías...</p>
        ) : categorias.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black p-5 text-sm text-white/50">Todavía no hay categorías.</div>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-[10px] font-black uppercase tracking-[0.12em] text-white/35">
                <tr><th className="pb-2">Categoría</th><th className="pb-2">Tipo</th><th className="pb-2">Estado</th><th className="pb-2">Movimientos</th><th className="pb-2 text-right">Acciones</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {categorias.map((c) => {
                  const bloqueado = ocupado !== null;
                  if (editId === c.id) {
                    return (
                      <tr key={c.id}>
                        <td className="py-2 pr-2"><input className={inp} value={edit.nombre} maxLength={60} onChange={(e) => setEdit((x) => ({ ...x, nombre: e.target.value }))} /></td>
                        <td className="py-2 pr-2">
                          <select className={inp} value={edit.tipo} onChange={(e) => setEdit((x) => ({ ...x, tipo: e.target.value as TipoCaja }))}>
                            {TIPOS_CAJA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </td>
                        <td className="py-2 text-white/50" colSpan={2}>{c.movimientos > 0 && edit.tipo !== c.tipo ? "Los movimientos ya cargados conservan su tipo." : ""}</td>
                        <td className="py-2">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => guardarEdicion(c)} disabled={bloqueado} className="rounded-xl bg-red-600 px-3 py-2 text-xs font-black uppercase hover:bg-red-700 disabled:opacity-50">Guardar</button>
                            <button onClick={() => setEditId(null)} disabled={bloqueado} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 hover:border-white hover:text-white disabled:opacity-50">Cancelar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={c.id} className={c.activo ? "" : "opacity-60"}>
                      <td className="py-3 font-black">{c.nombre}</td>
                      <td className="py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${PILL_TIPO_CAJA[c.tipo]}`}>{c.tipo}</span></td>
                      <td className="py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${c.activo ? "bg-green-900 text-green-300" : "bg-zinc-800 text-zinc-400"}`}>{c.activo ? "Activa" : "Inactiva"}</span></td>
                      <td className="py-3 text-white/50">{c.movimientos}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button onClick={() => abrirEdicion(c)} disabled={bloqueado} className="rounded-xl border border-white/15 px-3 py-1.5 text-xs font-black uppercase text-white/70 hover:border-white hover:text-white disabled:opacity-50">Editar</button>
                          {c.activo ? (
                            <button onClick={() => patch(c.id, { activo: false }, `«${c.nombre}» desactivada: deja de ofrecerse en movimientos nuevos.`)} disabled={bloqueado} className="rounded-xl border border-amber-500/50 px-3 py-1.5 text-xs font-black uppercase text-amber-300 hover:bg-amber-600 hover:text-white disabled:opacity-50">Desactivar</button>
                          ) : (
                            <button onClick={() => patch(c.id, { activo: true }, `«${c.nombre}» activada.`)} disabled={bloqueado} className="rounded-xl border border-green-500/50 px-3 py-1.5 text-xs font-black uppercase text-green-300 hover:bg-green-700 hover:text-white disabled:opacity-50">Activar</button>
                          )}
                          {(c.movimientos === 0 || c.activo) && (
                            <button onClick={() => eliminar(c)} disabled={bloqueado} className="rounded-xl border border-red-500/40 px-3 py-1.5 text-xs font-black uppercase text-red-300 hover:bg-red-700 hover:text-white disabled:opacity-50">Eliminar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil, Eye, EyeOff, ImagePlus, X, GripVertical } from "lucide-react";
import Image from "next/image";

type Producto = {
  id: string;
  nombre: string;
  descripcion: string;
  imagenes: string[];
  caracteristicas: string[];
  activo: boolean;
  orden: number;
  created_at: string;
};

const VACÍO = {
  nombre: "",
  descripcion: "",
  imagenes: [] as string[],
  caracteristicas: [] as string[],
  activo: true,
  orden: 0,
};

export default function AdminTiendaPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"crear" | "editar" | null>(null);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [form, setForm] = useState(VACÍO);
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [caracter, setCaracter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function cargar() {
    setLoading(true);
    try {
      const res = await fetch("/api/tienda", { cache: "no-store" });
      const data = await res.json();
      setProductos(data.productos || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  function abrirCrear() {
    setForm(VACÍO);
    setEditando(null);
    setCaracter("");
    setModal("crear");
  }

  function abrirEditar(p: Producto) {
    setForm({
      nombre: p.nombre,
      descripcion: p.descripcion,
      imagenes: [...p.imagenes],
      caracteristicas: [...p.caracteristicas],
      activo: p.activo,
      orden: p.orden,
    });
    setEditando(p);
    setCaracter("");
    setModal("editar");
  }

  async function subirImagen(file: File) {
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/tienda/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Error subiendo imagen"); return; }
      setForm((prev) => ({ ...prev, imagenes: [...prev.imagenes, data.url] }));
    } finally {
      setSubiendo(false);
    }
  }

  function quitarImagen(url: string) {
    setForm((prev) => ({ ...prev, imagenes: prev.imagenes.filter((i) => i !== url) }));
  }

  function agregarCaracteristica() {
    const v = caracter.trim();
    if (!v) return;
    setForm((prev) => ({ ...prev, caracteristicas: [...prev.caracteristicas, v] }));
    setCaracter("");
  }

  function quitarCaracteristica(i: number) {
    setForm((prev) => ({
      ...prev,
      caracteristicas: prev.caracteristicas.filter((_, idx) => idx !== i),
    }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre || !form.descripcion) { alert("Nombre y descripción obligatorios."); return; }
    setGuardando(true);
    try {
      const url = modal === "crear" ? "/api/tienda" : `/api/tienda/${editando!.id}`;
      const method = modal === "crear" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Error guardando"); return; }
      setModal(null);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(p: Producto) {
    await fetch(`/api/tienda/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !p.activo }),
    });
    await cargar();
  }

  async function eliminar(p: Producto) {
    if (!confirm(`¿Eliminar "${p.nombre}"?`)) return;
    await fetch(`/api/tienda/${p.id}`, { method: "DELETE" });
    await cargar();
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-8">
      <div className="mx-auto max-w-5xl">

        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Admin SIM</p>
            <h1 className="text-4xl font-black uppercase md:text-5xl">Tienda</h1>
            <p className="mt-2 text-sm text-zinc-500">Administrá los simuladores en venta.</p>
          </div>
          <button
            onClick={abrirCrear}
            className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" /> Nuevo
          </button>
        </div>

        {loading ? (
          <p className="py-20 text-center text-zinc-700">Cargando...</p>
        ) : productos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-16 text-center">
            <p className="text-zinc-700">No hay productos. Creá el primero.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {productos.map((p) => (
              <article
                key={p.id}
                className={`flex flex-col gap-4 rounded-2xl border p-5 transition md:flex-row md:items-center ${
                  p.activo ? "border-zinc-800 bg-zinc-900/30" : "border-zinc-900 bg-zinc-950/50 opacity-50"
                }`}
              >
                {/* thumbnail */}
                {p.imagenes[0] ? (
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-zinc-900">
                    <Image src={p.imagenes[0]} alt={p.nombre} fill className="object-cover" />
                  </div>
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-700">
                    <ImagePlus className="h-6 w-6" />
                  </div>
                )}

                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="font-black uppercase">{p.nombre}</h3>
                    <span className="text-[10px] text-zinc-700">{p.imagenes.length} foto{p.imagenes.length !== 1 ? "s" : ""}</span>
                  </div>
                  <p className="line-clamp-2 text-xs text-zinc-600">{p.descripcion}</p>
                  {p.caracteristicas.length > 0 && (
                    <p className="mt-1 text-[10px] text-zinc-700">{p.caracteristicas.join(" · ")}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => toggleActivo(p)} className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition">
                    {p.activo ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button onClick={() => abrirEditar(p)} className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => eliminar(p)} className="rounded-lg p-2 text-zinc-600 hover:bg-red-600/20 hover:text-red-400 transition">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur p-4 pt-10 flex items-start justify-center">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 p-8 mb-10">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-black uppercase">
                {modal === "crear" ? "Nuevo producto" : "Editar producto"}
              </h2>
              <button onClick={() => setModal(null)} className="text-zinc-500 hover:text-white text-xl">✕</button>
            </div>

            <form onSubmit={guardar} className="space-y-6">
              {/* nombre */}
              <div>
                <label className="campo-label">Nombre del simulador *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej: Simulador Formula Pro SIM"
                  className="campo-input"
                  required
                />
              </div>

              {/* descripcion */}
              <div>
                <label className="campo-label">Descripción *</label>
                <textarea
                  value={form.descripcion}
                  onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))}
                  rows={4}
                  placeholder="Describí el simulador, sus componentes, qué incluye..."
                  className="campo-input resize-none"
                  required
                />
              </div>

              {/* características */}
              <div>
                <label className="campo-label">Características técnicas</label>
                <div className="flex gap-2 mb-3">
                  <input
                    value={caracter}
                    onChange={(e) => setCaracter(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarCaracteristica(); } }}
                    placeholder="Ej: Volante Fanatec DD Pro"
                    className="campo-input flex-1"
                  />
                  <button
                    type="button"
                    onClick={agregarCaracteristica}
                    className="rounded-xl border border-zinc-700 px-4 text-sm font-black text-zinc-400 hover:border-white hover:text-white transition"
                  >
                    +
                  </button>
                </div>
                {form.caracteristicas.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {form.caracteristicas.map((c, i) => (
                      <span key={i} className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                        {c}
                        <button type="button" onClick={() => quitarCaracteristica(i)} className="hover:text-red-400">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* imágenes */}
              <div>
                <label className="campo-label">Imágenes del simulador</label>

                {/* drop zone */}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={subiendo}
                  className="w-full rounded-2xl border-2 border-dashed border-zinc-800 py-8 text-center transition hover:border-zinc-600 disabled:opacity-50"
                >
                  <ImagePlus className="mx-auto mb-2 h-7 w-7 text-zinc-700" />
                  <p className="text-sm font-black uppercase tracking-widest text-zinc-700">
                    {subiendo ? "Subiendo..." : "Hacer clic para subir foto"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-800">JPG, PNG, WEBP — máx 10 MB</p>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) subirImagen(f);
                    e.target.value = "";
                  }}
                />

                {/* galería */}
                {form.imagenes.length > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {form.imagenes.map((url) => (
                      <div key={url} className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-900">
                        <Image src={url} alt="" fill className="object-cover" />
                        <button
                          type="button"
                          onClick={() => quitarImagen(url)}
                          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition group-hover:opacity-100"
                        >
                          <Trash2 className="h-5 w-5 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* orden + activo */}
              <div className="flex gap-6 items-center">
                <div className="flex-1">
                  <label className="campo-label">Orden (menor = primero)</label>
                  <input
                    type="number"
                    value={form.orden}
                    onChange={(e) => setForm((p) => ({ ...p, orden: Number(e.target.value) }))}
                    className="campo-input"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold mt-5">
                  <input
                    type="checkbox"
                    checked={form.activo}
                    onChange={(e) => setForm((p) => ({ ...p, activo: e.target.checked }))}
                    className="h-4 w-4 accent-red-500"
                  />
                  Activo
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-black uppercase tracking-widest text-zinc-400 hover:border-zinc-500 transition">
                  Cancelar
                </button>
                <button type="submit" disabled={guardando} className="rounded-xl bg-red-600 px-8 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-red-500 disabled:opacity-50 transition">
                  {guardando ? "Guardando..." : modal === "crear" ? "Crear" : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx global>{`
        .campo-label {
          display: block;
          margin-bottom: 6px;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: rgb(113 113 122);
        }
        .campo-input {
          width: 100%;
          background: rgb(9 9 11);
          border: 1px solid rgb(63 63 70);
          border-radius: 0.75rem;
          padding: 0.625rem 0.875rem;
          color: white;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s;
        }
        .campo-input:focus { border-color: rgb(220 38 38); }
      `}</style>
    </main>
  );
}

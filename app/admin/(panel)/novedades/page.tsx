"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Eye, EyeOff, Star, StarOff } from "lucide-react";

type Novedad = {
  id: string;
  titulo: string;
  subtitulo: string | null;
  descripcion: string;
  categoria: string;
  tag: string | null;
  link: string | null;
  boton: string | null;
  activo: boolean;
  destacado: boolean;
  orden: number;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  created_at: string;
};

const CATEGORIAS = ["torneo", "promo", "evento", "gift", "vip", "general"];

const categoriaBadge: Record<string, string> = {
  torneo: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  promo: "bg-red-600/20 text-red-400 border-red-600/30",
  evento: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  gift: "bg-white/10 text-white border-white/20",
  vip: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  general: "bg-zinc-700/50 text-zinc-300 border-zinc-600/30",
};

const VACÍO: Omit<Novedad, "id" | "created_at"> = {
  titulo: "",
  subtitulo: "",
  descripcion: "",
  categoria: "general",
  tag: "",
  link: "",
  boton: "",
  activo: true,
  destacado: false,
  orden: 0,
  fecha_inicio: "",
  fecha_fin: "",
};

export default function AdminNovedadesPage() {
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [modal, setModal] = useState<"crear" | "editar" | null>(null);
  const [editando, setEditando] = useState<Novedad | null>(null);
  const [form, setForm] = useState(VACÍO);

  async function cargar() {
    setLoading(true);
    try {
      const res = await fetch("/api/novedades", { cache: "no-store" });
      const data = await res.json();
      setNovedades(data.novedades || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  function abrirCrear() {
    setForm(VACÍO);
    setEditando(null);
    setModal("crear");
  }

  function abrirEditar(n: Novedad) {
    setForm({
      titulo: n.titulo,
      subtitulo: n.subtitulo || "",
      descripcion: n.descripcion,
      categoria: n.categoria,
      tag: n.tag || "",
      link: n.link || "",
      boton: n.boton || "",
      activo: n.activo,
      destacado: n.destacado,
      orden: n.orden,
      fecha_inicio: n.fecha_inicio || "",
      fecha_fin: n.fecha_fin || "",
    });
    setEditando(n);
    setModal("editar");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo || !form.descripcion) {
      alert("Título y descripción son obligatorios.");
      return;
    }
    setGuardando(true);
    try {
      const body = {
        ...form,
        subtitulo: form.subtitulo || null,
        tag: form.tag || null,
        link: form.link || null,
        boton: form.boton || null,
        fecha_inicio: form.fecha_inicio || null,
        fecha_fin: form.fecha_fin || null,
      };

      const res = modal === "crear"
        ? await fetch("/api/novedades", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/novedades/${editando!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const data = await res.json();
      if (!res.ok) { alert(data.error || "Error guardando"); return; }

      setModal(null);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(n: Novedad) {
    await fetch(`/api/novedades/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !n.activo }),
    });
    await cargar();
  }

  async function toggleDestacado(n: Novedad) {
    await fetch(`/api/novedades/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destacado: !n.destacado }),
    });
    await cargar();
  }

  async function eliminar(n: Novedad) {
    if (!confirm(`¿Eliminar "${n.titulo}"? Esta acción no se puede deshacer.`)) return;
    await fetch(`/api/novedades/${n.id}`, { method: "DELETE" });
    await cargar();
  }

  const f = (k: keyof typeof form, v: string | boolean | number) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Admin SIM</p>
            <h1 className="text-4xl font-black uppercase md:text-5xl">Novedades</h1>
            <p className="mt-2 text-sm text-zinc-500">
              Gestioná las novedades que se muestran en la página pública.
            </p>
          </div>
          <button
            onClick={abrirCrear}
            className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            Nueva
          </button>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          {[
            { label: "Total", val: novedades.length },
            { label: "Activas", val: novedades.filter((n) => n.activo).length },
            { label: "Destacadas", val: novedades.filter((n) => n.destacado).length },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <p className="text-3xl font-black text-red-500">{s.val}</p>
              <p className="mt-1 text-xs uppercase tracking-widest text-zinc-600">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Lista */}
        {loading ? (
          <p className="py-20 text-center text-zinc-600">Cargando...</p>
        ) : novedades.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-16 text-center">
            <p className="text-zinc-600">No hay novedades. Creá la primera.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {novedades.map((n) => (
              <article
                key={n.id}
                className={`group flex flex-col gap-4 rounded-2xl border p-5 transition md:flex-row md:items-center md:justify-between ${
                  n.activo ? "border-zinc-800 bg-zinc-900/30" : "border-zinc-900 bg-zinc-950/50 opacity-50"
                }`}
              >
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.destacado && (
                      <span className="rounded-full bg-yellow-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-black">
                        Destacada
                      </span>
                    )}
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${categoriaBadge[n.categoria] || categoriaBadge.general}`}>
                      {n.categoria}
                    </span>
                    {n.tag && (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                        {n.tag}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-zinc-700">orden: {n.orden}</span>
                  </div>
                  <h3 className="font-black uppercase">{n.titulo}</h3>
                  {n.subtitulo && <p className="text-xs text-zinc-500">{n.subtitulo}</p>}
                  <p className="line-clamp-2 text-xs text-zinc-600">{n.descripcion}</p>
                  {(n.fecha_inicio || n.fecha_fin) && (
                    <p className="text-[10px] text-zinc-700">
                      {n.fecha_inicio && `Desde: ${n.fecha_inicio}`}
                      {n.fecha_inicio && n.fecha_fin && " · "}
                      {n.fecha_fin && `Hasta: ${n.fecha_fin}`}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleDestacado(n)}
                    title={n.destacado ? "Quitar destacado" : "Marcar destacado"}
                    className="rounded-lg p-2 text-zinc-600 transition hover:bg-yellow-500/10 hover:text-yellow-400"
                  >
                    {n.destacado ? <Star className="h-4 w-4" /> : <StarOff className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => toggleActivo(n)}
                    title={n.activo ? "Desactivar" : "Activar"}
                    className="rounded-lg p-2 text-zinc-600 transition hover:bg-zinc-800 hover:text-white"
                  >
                    {n.activo ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => abrirEditar(n)}
                    className="rounded-lg p-2 text-zinc-600 transition hover:bg-zinc-800 hover:text-white"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => eliminar(n)}
                    className="rounded-lg p-2 text-zinc-600 transition hover:bg-red-600/20 hover:text-red-400"
                  >
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 pt-10 backdrop-blur">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 p-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-black uppercase">
                {modal === "crear" ? "Nueva novedad" : "Editar novedad"}
              </h2>
              <button onClick={() => setModal(null)} className="text-zinc-500 hover:text-white">✕</button>
            </div>

            <form onSubmit={guardar} className="space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <Campo label="Título *">
                  <input
                    value={form.titulo}
                    onChange={(e) => f("titulo", e.target.value)}
                    placeholder="Ej: Gran Torneo SIM 2026"
                    className="input-admin"
                    required
                  />
                </Campo>
                <Campo label="Subtítulo">
                  <input
                    value={form.subtitulo || ""}
                    onChange={(e) => f("subtitulo", e.target.value)}
                    placeholder="Ej: Clasificación · Finales · Podio"
                    className="input-admin"
                  />
                </Campo>
              </div>

              <Campo label="Descripción *">
                <textarea
                  value={form.descripcion}
                  onChange={(e) => f("descripcion", e.target.value)}
                  rows={3}
                  placeholder="Descripción visible en la página..."
                  className="input-admin resize-none"
                  required
                />
              </Campo>

              <div className="grid gap-5 md:grid-cols-3">
                <Campo label="Categoría *">
                  <select
                    value={form.categoria}
                    onChange={(e) => f("categoria", e.target.value)}
                    className="input-admin"
                  >
                    {CATEGORIAS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Tag / Etiqueta">
                  <input
                    value={form.tag || ""}
                    onChange={(e) => f("tag", e.target.value)}
                    placeholder="Ej: PRÓXIMAMENTE"
                    className="input-admin"
                  />
                </Campo>
                <Campo label="Orden (menor = primero)">
                  <input
                    type="number"
                    value={form.orden}
                    onChange={(e) => f("orden", Number(e.target.value))}
                    className="input-admin"
                  />
                </Campo>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <Campo label="Link del botón">
                  <input
                    value={form.link || ""}
                    onChange={(e) => f("link", e.target.value)}
                    placeholder="Ej: /reservas o https://..."
                    className="input-admin"
                  />
                </Campo>
                <Campo label="Texto del botón">
                  <input
                    value={form.boton || ""}
                    onChange={(e) => f("boton", e.target.value)}
                    placeholder="Ej: Reservar turno"
                    className="input-admin"
                  />
                </Campo>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <Campo label="Fecha inicio">
                  <input
                    type="date"
                    value={form.fecha_inicio || ""}
                    onChange={(e) => f("fecha_inicio", e.target.value)}
                    className="input-admin"
                  />
                </Campo>
                <Campo label="Fecha fin">
                  <input
                    type="date"
                    value={form.fecha_fin || ""}
                    onChange={(e) => f("fecha_fin", e.target.value)}
                    className="input-admin"
                  />
                </Campo>
              </div>

              <div className="flex gap-6">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={form.destacado}
                    onChange={(e) => f("destacado", e.target.checked)}
                    className="h-4 w-4 accent-yellow-500"
                  />
                  <span className="text-yellow-400">Destacada</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={form.activo}
                    onChange={(e) => f("activo", e.target.checked)}
                    className="h-4 w-4 accent-red-500"
                  />
                  <span>Activa</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-black uppercase tracking-widest text-zinc-400 transition hover:border-zinc-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="rounded-xl bg-red-600 px-8 py-3 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  {guardando ? "Guardando..." : modal === "crear" ? "Crear" : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx global>{`
        .input-admin {
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
        .input-admin:focus {
          border-color: rgb(220 38 38);
        }
        .input-admin option {
          background: rgb(9 9 11);
        }
      `}</style>
    </main>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-black uppercase tracking-widest text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  );
}

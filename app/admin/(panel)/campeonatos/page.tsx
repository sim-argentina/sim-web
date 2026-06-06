"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Campeonato = {
  id: string;
  nombre: string;
  descripcion: string | null;
  estado: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  precio_inscripcion: number;
  cupos_maximos: number;
  inscripcion_habilitada: boolean;
  categorias: string[];
  imagen_url: string | null;
  created_at: string;
};

type Registro = {
  id: string;
  fecha: string;
  hora: string | null;
  nombre: string;
  apellido: string | null;
  nombre_completo: string;
  telefono: string | null;
  categoria: string;
  campeonato_id: string | null;
  circuito: string | null;
  tiempo: string | null;
  simulador: string | null;
  puntos: number;
  semana: number;
  escuderia_favorita: string | null;
  observaciones: string | null;
  estado: string;
  created_at: string;
  campeonatos?: { nombre: string } | null;
};

type Inscripcion = {
  id: string;
  nombre: string;
  apellido: string;
  nombre_completo: string;
  telefono: string;
  dni: string;
  instagram: string | null;
  escuderia_favorita: string;
  categoria: string;
  campeonato_id: string;
  monto: number;
  estado_pago: string;
  payment_id: string | null;
  created_at: string;
  campeonatos?: { nombre: string } | null;
};

type Sorteo = {
  id: string;
  titulo: string;
  descripcion: string | null;
  premio: string;
  estado: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  condiciones: string | null;
  imagen_url: string | null;
  created_at: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const CIRCUITOS = [
  "Interlagos", "Monza", "Spa", "Silverstone", "Suzuka",
  "Imola", "Austria", "Monaco", "Abu Dhabi", "Bahrain",
  "Australia", "Hungría", "Países Bajos", "Canadá", "COTA",
  "México", "Singapur", "Qatar", "Miami", "Arabia Saudita",
];

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"];

const CATEGORIAS = ["oro", "plata", "bronce"];

const ESCUDERIAS = [
  "Red Bull", "Mercedes", "Ferrari", "McLaren", "Aston Martin",
  "Alpine", "Williams", "Racing Bulls", "Kick Sauber", "Haas",
];

const ESTADOS_REGISTRO = ["valido", "pendiente", "anulado"];
const ESTADOS_CAMP = ["proximo", "activo", "finalizado"];

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function horaActual() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ v }: { v: string }) {
  const map: Record<string, string> = {
    valido: "bg-green-900 text-green-300",
    pagado: "bg-green-900 text-green-300",
    activo: "bg-green-900 text-green-300",
    pendiente: "bg-yellow-900 text-yellow-300",
    pendiente_pago: "bg-yellow-900 text-yellow-300",
    proximo: "bg-blue-900 text-blue-300",
    anulado: "bg-zinc-800 text-zinc-400",
    finalizado: "bg-zinc-800 text-zinc-400",
    rechazado: "bg-red-900 text-red-300",
    cancelado: "bg-zinc-800 text-zinc-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${map[v] ?? "bg-zinc-800 text-zinc-400"}`}>
      {v.replace("_", " ")}
    </span>
  );
}

// ─── Input helpers ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-bold uppercase text-zinc-400">{label}</label>
      {children}
    </div>
  );
}

const inp = "rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500";
const sel = inp;

// ─── Tab: Resultados ─────────────────────────────────────────────────────────

function TabResultados({ campeonatos, registros, onRefresh }: {
  campeonatos: Campeonato[];
  registros: Registro[];
  onRefresh: () => void;
}) {
  const blank = {
    fecha: hoy(), hora: horaActual(), semana: "1",
    nombre: "", apellido: "", telefono: "",
    campeonato_id: "", categoria: "oro", circuito: "",
    simulador: "", tiempo: "", puntos: "0",
    escuderia_favorita: "", estado: "valido", observaciones: "",
  };

  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [filters, setFilters] = useState({ nombre: "", campeonato_id: "", categoria: "", estado: "" });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (r: Registro) => {
    setEditId(r.id);
    setForm({
      fecha: r.fecha, hora: r.hora || "", semana: String(r.semana),
      nombre: r.nombre, apellido: r.apellido || "", telefono: r.telefono || "",
      campeonato_id: r.campeonato_id || "", categoria: r.categoria, circuito: r.circuito || "",
      simulador: r.simulador || "", tiempo: r.tiempo || "", puntos: String(r.puntos),
      escuderia_favorita: r.escuderia_favorita || "", estado: r.estado, observaciones: r.observaciones || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => { setEditId(null); setForm(blank); setMsg(""); };

  const submit = async () => {
    if (!form.nombre.trim() || !form.fecha || !form.categoria) {
      setMsg("Nombre, fecha y categoría son obligatorios"); return;
    }
    setSaving(true); setMsg("");
    try {
      const url = editId
        ? `/api/admin/campeonatos/registros/${editId}`
        : "/api/admin/campeonatos/registros";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, puntos: Number(form.puntos), semana: Number(form.semana) }),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Error"); return; }
      setMsg(editId ? "Resultado actualizado" : "Resultado guardado");
      setEditId(null); setForm(blank); onRefresh();
    } finally { setSaving(false); }
  };

  const anular = async (id: string) => {
    if (!confirm("¿Anular este resultado?")) return;
    await fetch(`/api/admin/campeonatos/registros/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "anulado" }),
    });
    onRefresh();
  };

  const filtered = registros.filter((r) => {
    if (filters.nombre && !r.nombre_completo?.toLowerCase().includes(filters.nombre.toLowerCase())) return false;
    if (filters.campeonato_id && r.campeonato_id !== filters.campeonato_id) return false;
    if (filters.categoria && r.categoria !== filters.categoria) return false;
    if (filters.estado && r.estado !== filters.estado) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      {/* Formulario */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-6 text-lg font-black text-white">
          {editId ? "✏️ Editar resultado" : "➕ Registrar resultado"}
        </h2>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Field label="Fecha"><input type="date" className={inp} value={form.fecha} onChange={(e) => set("fecha", e.target.value)} /></Field>
          <Field label="Hora"><input type="time" className={inp} value={form.hora} onChange={(e) => set("hora", e.target.value)} /></Field>
          <Field label="Semana"><input type="number" className={inp} value={form.semana} min="1" onChange={(e) => set("semana", e.target.value)} /></Field>
          <Field label="Nombre *"><input className={inp} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} /></Field>
          <Field label="Apellido"><input className={inp} value={form.apellido} onChange={(e) => set("apellido", e.target.value)} /></Field>
          <Field label="Teléfono"><input className={inp} value={form.telefono} onChange={(e) => set("telefono", e.target.value)} /></Field>
          <Field label="Campeonato">
            <select className={sel} value={form.campeonato_id} onChange={(e) => set("campeonato_id", e.target.value)}>
              <option value="">— sin campeonato —</option>
              {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Categoría *">
            <select className={sel} value={form.categoria} onChange={(e) => set("categoria", e.target.value)}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Circuito">
            <select className={sel} value={form.circuito} onChange={(e) => set("circuito", e.target.value)}>
              <option value="">— seleccionar —</option>
              {CIRCUITOS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Simulador">
            <select className={sel} value={form.simulador} onChange={(e) => set("simulador", e.target.value)}>
              <option value="">— seleccionar —</option>
              {SIMULADORES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Tiempo (ej: 1:23.456)"><input className={inp} placeholder="1:23.456" value={form.tiempo} onChange={(e) => set("tiempo", e.target.value)} /></Field>
          <Field label="Puntos"><input type="number" className={inp} value={form.puntos} min="0" onChange={(e) => set("puntos", e.target.value)} /></Field>
          <Field label="Escudería">
            <select className={sel} value={form.escuderia_favorita} onChange={(e) => set("escuderia_favorita", e.target.value)}>
              <option value="">— seleccionar —</option>
              {ESCUDERIAS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select className={sel} value={form.estado} onChange={(e) => set("estado", e.target.value)}>
              {ESTADOS_REGISTRO.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Observaciones" ><input className={inp} value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)} /></Field>
        </div>

        {msg && <p className="mt-4 text-sm font-bold text-red-400">{msg}</p>}

        <div className="mt-6 flex gap-3">
          <button onClick={submit} disabled={saving} className="rounded-xl bg-red-600 px-6 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50">
            {saving ? "Guardando..." : editId ? "Actualizar" : "Guardar resultado"}
          </button>
          {editId && <button onClick={cancelEdit} className="rounded-xl bg-zinc-700 px-6 py-2 font-bold text-white hover:bg-zinc-600">Cancelar</button>}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <input className={`${inp} flex-1 min-w-[140px]`} placeholder="Buscar nombre..." value={filters.nombre} onChange={(e) => setFilters((f) => ({ ...f, nombre: e.target.value }))} />
        <select className={`${sel} min-w-[160px]`} value={filters.campeonato_id} onChange={(e) => setFilters((f) => ({ ...f, campeonato_id: e.target.value }))}>
          <option value="">Todos los campeonatos</option>
          {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className={`${sel} min-w-[130px]`} value={filters.categoria} onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value }))}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={`${sel} min-w-[120px]`} value={filters.estado} onChange={(e) => setFilters((f) => ({ ...f, estado: e.target.value }))}>
          <option value="">Todos los estados</option>
          {ESTADOS_REGISTRO.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              {["Fecha", "Piloto", "Categoría", "Campeonato", "Circuito", "Tiempo", "Pts", "Estado", "Acciones"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-bold uppercase text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">Sin resultados</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="bg-zinc-950 hover:bg-zinc-900 transition-colors">
                <td className="px-4 py-3 text-zinc-300">{r.fecha}</td>
                <td className="px-4 py-3 font-medium text-white">{r.nombre_completo}</td>
                <td className="px-4 py-3"><Badge v={r.categoria} /></td>
                <td className="px-4 py-3 text-zinc-400">{r.campeonatos?.nombre || "—"}</td>
                <td className="px-4 py-3 text-zinc-400">{r.circuito || "—"}</td>
                <td className="px-4 py-3 font-mono text-red-400">{r.tiempo || "—"}</td>
                <td className="px-4 py-3 font-bold text-white">{r.puntos}</td>
                <td className="px-4 py-3"><Badge v={r.estado} /></td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(r)} className="rounded-lg bg-zinc-800 px-3 py-1 text-xs font-bold text-white hover:bg-zinc-700">Editar</button>
                    {r.estado !== "anulado" && (
                      <button onClick={() => anular(r.id)} className="rounded-lg bg-red-900/50 px-3 py-1 text-xs font-bold text-red-300 hover:bg-red-900">Anular</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Campeonatos ─────────────────────────────────────────────────────────

function TabCampeonatos({ campeonatos, onRefresh }: { campeonatos: Campeonato[]; onRefresh: () => void }) {
  const blank = {
    nombre: "", descripcion: "", estado: "proximo",
    fecha_inicio: "", fecha_fin: "", precio_inscripcion: "0",
    cupos_maximos: "0", inscripcion_habilitada: true,
    categorias: ["oro", "plata", "bronce"], imagen_url: "",
  };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showForm, setShowForm] = useState(false);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (c: Campeonato) => {
    setEditId(c.id);
    setForm({
      nombre: c.nombre, descripcion: c.descripcion || "", estado: c.estado,
      fecha_inicio: c.fecha_inicio || "", fecha_fin: c.fecha_fin || "",
      precio_inscripcion: String(c.precio_inscripcion), cupos_maximos: String(c.cupos_maximos),
      inscripcion_habilitada: c.inscripcion_habilitada,
      categorias: c.categorias || ["oro", "plata", "bronce"], imagen_url: c.imagen_url || "",
    });
    setShowForm(true);
  };

  const cancel = () => { setEditId(null); setForm(blank); setShowForm(false); setMsg(""); };

  const submit = async () => {
    if (!form.nombre.trim()) { setMsg("El nombre es obligatorio"); return; }
    setSaving(true); setMsg("");
    try {
      const url = editId ? `/api/admin/campeonatos/${editId}` : "/api/admin/campeonatos";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, precio_inscripcion: Number(form.precio_inscripcion), cupos_maximos: Number(form.cupos_maximos) }),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Error"); return; }
      cancel(); onRefresh();
    } finally { setSaving(false); }
  };

  const toggleCategoria = (cat: string) => {
    const cats = form.categorias.includes(cat) ? form.categorias.filter((c) => c !== cat) : [...form.categorias, cat];
    set("categorias", cats);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-black text-white">Gestión de Campeonatos</h2>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-500">
            + Nuevo campeonato
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
          <h3 className="font-black text-white">{editId ? "Editar campeonato" : "Nuevo campeonato"}</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Nombre *"><input className={inp} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} /></Field>
            <Field label="Estado">
              <select className={sel} value={form.estado} onChange={(e) => set("estado", e.target.value)}>
                {ESTADOS_CAMP.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Fecha inicio"><input type="date" className={inp} value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} /></Field>
            <Field label="Fecha fin"><input type="date" className={inp} value={form.fecha_fin} onChange={(e) => set("fecha_fin", e.target.value)} /></Field>
            <Field label="Precio inscripción ($)"><input type="number" className={inp} value={form.precio_inscripcion} onChange={(e) => set("precio_inscripcion", e.target.value)} /></Field>
            <Field label="Cupos máximos"><input type="number" className={inp} value={form.cupos_maximos} onChange={(e) => set("cupos_maximos", e.target.value)} /></Field>
            <Field label="Descripción"><input className={inp} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} /></Field>
            <Field label="Imagen URL (opcional)"><input className={inp} value={form.imagen_url} onChange={(e) => set("imagen_url", e.target.value)} /></Field>
          </div>
          <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={form.inscripcion_habilitada} onChange={(e) => set("inscripcion_habilitada", e.target.checked)} className="accent-red-500" />
              Inscripción habilitada
            </label>
          </div>
          <div className="flex gap-3">
            {CATEGORIAS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" checked={form.categorias.includes(c)} onChange={() => toggleCategoria(c)} className="accent-red-500" />
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </label>
            ))}
          </div>
          {msg && <p className="text-sm font-bold text-red-400">{msg}</p>}
          <div className="flex gap-3">
            <button onClick={submit} disabled={saving} className="rounded-xl bg-red-600 px-6 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50">
              {saving ? "Guardando..." : editId ? "Actualizar" : "Crear campeonato"}
            </button>
            <button onClick={cancel} className="rounded-xl bg-zinc-700 px-6 py-2 font-bold text-white hover:bg-zinc-600">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {campeonatos.length === 0 && <p className="text-zinc-500 text-sm">No hay campeonatos cargados aún.</p>}
        {campeonatos.map((c) => (
          <div key={c.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-black text-white">{c.nombre}</span>
                <Badge v={c.estado} />
                {c.inscripcion_habilitada && <span className="text-xs text-green-400 font-bold">Inscripción abierta</span>}
              </div>
              <p className="text-sm text-zinc-400 mt-1">
                {c.fecha_inicio && c.fecha_fin ? `${c.fecha_inicio} → ${c.fecha_fin}` : "Sin fechas"} · Precio: ${c.precio_inscripcion.toLocaleString()} · Cupos: {c.cupos_maximos}
              </p>
            </div>
            <button onClick={() => startEdit(c)} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-700 shrink-0">Editar</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Sorteos ─────────────────────────────────────────────────────────────

function TabSorteos({ sorteos, onRefresh }: { sorteos: Sorteo[]; onRefresh: () => void }) {
  const blank = { titulo: "", descripcion: "", premio: "", estado: "proximo", fecha_inicio: "", fecha_fin: "", condiciones: "", imagen_url: "" };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showForm, setShowForm] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const startEdit = (s: Sorteo) => {
    setEditId(s.id);
    setForm({ titulo: s.titulo, descripcion: s.descripcion || "", premio: s.premio, estado: s.estado, fecha_inicio: s.fecha_inicio || "", fecha_fin: s.fecha_fin || "", condiciones: s.condiciones || "", imagen_url: s.imagen_url || "" });
    setShowForm(true);
  };

  const cancel = () => { setEditId(null); setForm(blank); setShowForm(false); setMsg(""); };

  const submit = async () => {
    if (!form.titulo.trim() || !form.premio.trim()) { setMsg("Título y premio son obligatorios"); return; }
    setSaving(true); setMsg("");
    try {
      const url = editId ? `/api/admin/sorteos/${editId}` : "/api/admin/sorteos";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Error"); return; }
      cancel(); onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-black text-white">Gestión de Sorteos</h2>
        {!showForm && <button onClick={() => setShowForm(true)} className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-500">+ Nuevo sorteo</button>}
      </div>

      {showForm && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
          <h3 className="font-black text-white">{editId ? "Editar sorteo" : "Nuevo sorteo"}</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Título *"><input className={inp} value={form.titulo} onChange={(e) => set("titulo", e.target.value)} /></Field>
            <Field label="Premio *"><input className={inp} value={form.premio} onChange={(e) => set("premio", e.target.value)} /></Field>
            <Field label="Estado">
              <select className={sel} value={form.estado} onChange={(e) => set("estado", e.target.value)}>
                {ESTADOS_CAMP.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Imagen URL"><input className={inp} value={form.imagen_url} onChange={(e) => set("imagen_url", e.target.value)} /></Field>
            <Field label="Fecha inicio"><input type="date" className={inp} value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} /></Field>
            <Field label="Fecha fin"><input type="date" className={inp} value={form.fecha_fin} onChange={(e) => set("fecha_fin", e.target.value)} /></Field>
            <Field label="Descripción"><textarea className={`${inp} resize-none`} rows={2} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} /></Field>
            <Field label="Condiciones"><textarea className={`${inp} resize-none`} rows={2} value={form.condiciones} onChange={(e) => set("condiciones", e.target.value)} /></Field>
          </div>
          {msg && <p className="text-sm font-bold text-red-400">{msg}</p>}
          <div className="flex gap-3">
            <button onClick={submit} disabled={saving} className="rounded-xl bg-red-600 px-6 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50">
              {saving ? "Guardando..." : editId ? "Actualizar" : "Crear sorteo"}
            </button>
            <button onClick={cancel} className="rounded-xl bg-zinc-700 px-6 py-2 font-bold text-white hover:bg-zinc-600">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {sorteos.length === 0 && <p className="text-zinc-500 text-sm">No hay sorteos cargados aún.</p>}
        {sorteos.map((s) => (
          <div key={s.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-black text-white">{s.titulo}</span>
                <Badge v={s.estado} />
              </div>
              <p className="text-sm text-zinc-400 mt-1">Premio: {s.premio}</p>
            </div>
            <button onClick={() => startEdit(s)} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-700 shrink-0">Editar</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Inscripciones ───────────────────────────────────────────────────────

function TabInscripciones({ inscripciones, campeonatos }: { inscripciones: Inscripcion[]; campeonatos: Campeonato[] }) {
  const [filters, setFilters] = useState({ campeonato_id: "", categoria: "", estado_pago: "", q: "" });

  const filtered = inscripciones.filter((i) => {
    if (filters.campeonato_id && i.campeonato_id !== filters.campeonato_id) return false;
    if (filters.categoria && i.categoria !== filters.categoria) return false;
    if (filters.estado_pago && i.estado_pago !== filters.estado_pago) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!i.nombre_completo?.toLowerCase().includes(q) && !i.dni?.includes(q) && !i.telefono?.includes(q)) return false;
    }
    return true;
  });

  const pagadas = filtered.filter((i) => i.estado_pago === "pagado");
  const totalRecaudado = pagadas.reduce((s, i) => s + (i.monto || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <input className={`${inp} flex-1 min-w-[140px]`} placeholder="Nombre, DNI o teléfono..." value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        <select className={`${sel} min-w-[160px]`} value={filters.campeonato_id} onChange={(e) => setFilters((f) => ({ ...f, campeonato_id: e.target.value }))}>
          <option value="">Todos los campeonatos</option>
          {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className={`${sel} min-w-[130px]`} value={filters.categoria} onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value }))}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={`${sel} min-w-[140px]`} value={filters.estado_pago} onChange={(e) => setFilters((f) => ({ ...f, estado_pago: e.target.value }))}>
          <option value="">Todos los estados</option>
          <option value="pagado">Pagado</option>
          <option value="pendiente_pago">Pendiente</option>
          <option value="rechazado">Rechazado</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </div>

      <div className="flex gap-4 text-sm">
        <span className="text-zinc-400">Total: <strong className="text-white">{filtered.length}</strong></span>
        <span className="text-zinc-400">Pagadas: <strong className="text-green-400">{pagadas.length}</strong></span>
        <span className="text-zinc-400">Recaudado: <strong className="text-white">${totalRecaudado.toLocaleString()}</strong></span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              {["Nombre", "DNI", "Tel", "Instagram", "Escudería", "Cat", "Campeonato", "Monto", "Estado", "Fecha"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-bold uppercase text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-zinc-500">Sin inscripciones</td></tr>
            )}
            {filtered.map((i) => (
              <tr key={i.id} className="bg-zinc-950 hover:bg-zinc-900 transition-colors">
                <td className="px-4 py-3 font-medium text-white">{i.nombre_completo}</td>
                <td className="px-4 py-3 text-zinc-400">{i.dni}</td>
                <td className="px-4 py-3 text-zinc-400">{i.telefono}</td>
                <td className="px-4 py-3 text-zinc-400">{i.instagram || "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{i.escuderia_favorita}</td>
                <td className="px-4 py-3"><Badge v={i.categoria} /></td>
                <td className="px-4 py-3 text-zinc-400">{i.campeonatos?.nombre || "—"}</td>
                <td className="px-4 py-3 font-bold text-white">${i.monto?.toLocaleString()}</td>
                <td className="px-4 py-3"><Badge v={i.estado_pago} /></td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{i.created_at?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "resultados" | "campeonatos" | "sorteos" | "inscripciones";

const TABS: { id: Tab; label: string }[] = [
  { id: "resultados", label: "Resultados" },
  { id: "campeonatos", label: "Campeonatos" },
  { id: "sorteos", label: "Sorteos" },
  { id: "inscripciones", label: "Inscripciones" },
];

export default function AdminCampeonatosPage() {
  const [tab, setTab] = useState<Tab>("resultados");
  const [campeonatos, setCampeonatos] = useState<Campeonato[]>([]);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([]);
  const [sorteos, setSorteos] = useState<Sorteo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [camRes, regRes, insRes, sorRes] = await Promise.all([
        fetch("/api/admin/campeonatos").then((r) => r.json()),
        fetch("/api/admin/campeonatos/registros").then((r) => r.json()),
        fetch("/api/admin/campeonatos/inscripciones").then((r) => r.json()),
        fetch("/api/admin/sorteos").then((r) => r.json()),
      ]);
      setCampeonatos(Array.isArray(camRes) ? camRes : []);
      setRegistros(Array.isArray(regRes) ? regRes : []);
      setInscripciones(Array.isArray(insRes) ? insRes : []);
      setSorteos(Array.isArray(sorRes) ? sorRes : []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <div className="min-h-screen bg-zinc-950 p-4 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500 mb-1">Panel Admin</p>
        <h1 className="text-3xl font-black text-white">Campeonatos</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {campeonatos.length} campeonatos · {registros.length} resultados · {inscripciones.length} inscripciones
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-8 flex gap-1 rounded-2xl bg-zinc-900 p-1 w-fit overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-xl px-5 py-2 text-sm font-bold transition-all whitespace-nowrap ${
              tab === t.id ? "bg-red-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500">Cargando...</div>
      ) : (
        <>
          {tab === "resultados" && <TabResultados campeonatos={campeonatos} registros={registros} onRefresh={fetchAll} />}
          {tab === "campeonatos" && <TabCampeonatos campeonatos={campeonatos} onRefresh={fetchAll} />}
          {tab === "sorteos" && <TabSorteos sorteos={sorteos} onRefresh={fetchAll} />}
          {tab === "inscripciones" && <TabInscripciones inscripciones={inscripciones} campeonatos={campeonatos} />}
        </>
      )}
    </div>
  );
}

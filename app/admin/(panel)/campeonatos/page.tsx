"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PagoDetalle = {
  metodo_pago: string;
  monto: string | number;
  posnet_pago?: string;
};

type PilotoSugerido = {
  nombre: string;
  apellido: string | null;
  nombre_completo: string;
  telefono: string | null;
  categoria: string | null;
  escuderia_favorita: string | null;
};

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
};

type Registro = {
  id: string;
  fecha: string;
  hora: string | null;
  hora_estimada_subida: string | null;
  hora_subida: string | null;
  hora_bajada: string | null;
  nombre: string;
  apellido: string | null;
  nombre_completo: string;
  telefono: string | null;
  categoria: string;
  campeonato_id: string | null;
  circuito: string | null;
  tiempo: string | null;
  escuderia_favorita: string | null;
  observaciones: string | null;
  estado: string;
  cantidad_minutos: number;
  cantidad_turnos: number;
  turno_listo: boolean;
  pagos_detalle: PagoDetalle[] | null;
  total: number;
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
  metodo_pago: string | null;
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
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CIRCUITOS = [
  "Interlagos", "Monza", "Spa", "Silverstone", "Suzuka",
  "Imola", "Austria", "Monaco", "Abu Dhabi", "Bahrain",
  "Australia", "Hungría", "Países Bajos", "Canadá", "COTA",
  "México", "Singapur", "Qatar", "Miami", "Arabia Saudita",
];

const CATEGORIAS = ["oro", "plata", "bronce"];

const ESCUDERIAS = [
  "Red Bull", "Mercedes", "Ferrari", "McLaren", "Aston Martin",
  "Alpine", "Williams", "Racing Bulls", "Kick Sauber", "Haas",
];

const METODOS_PAGO = [
  { value: "qr", label: "QR" },
  { value: "efectivo", label: "Efectivo" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "transferencia", label: "Transferencia" },
];

const POSNETS = ["MP", "PayWay"];
const ESTADOS_CAMP = ["proximo", "activo", "finalizado"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function horaActual() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function sumarMinutosAHora(hora: string, minutos: number): string {
  if (!hora) return "";
  const [h, m] = hora.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m + minutos, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function metodoUsaPosnet(m: string) {
  return m === "debito" || m === "credito" || m === "qr";
}
function formatoDinero(v: number) {
  return `$${v.toLocaleString("es-AR")}`;
}
function normalizarPagos(r: Registro): PagoDetalle[] {
  if (Array.isArray(r.pagos_detalle) && r.pagos_detalle.length > 0) return r.pagos_detalle;
  return [{ metodo_pago: "qr", monto: r.total || 0, posnet_pago: "" }];
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ v }: { v: string }) {
  const map: Record<string, string> = {
    valido: "bg-green-900 text-green-300", pagado: "bg-green-900 text-green-300",
    activo: "bg-green-900 text-green-300", pendiente: "bg-yellow-900 text-yellow-300",
    pendiente_pago: "bg-yellow-900 text-yellow-300", proximo: "bg-blue-900 text-blue-300",
    anulado: "bg-zinc-800 text-zinc-400", finalizado: "bg-zinc-800 text-zinc-400",
    rechazado: "bg-red-900 text-red-300", cancelado: "bg-zinc-800 text-zinc-400",
    oro: "bg-yellow-900 text-yellow-300", plata: "bg-zinc-700 text-zinc-200",
    bronce: "bg-orange-900 text-orange-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${map[v] ?? "bg-zinc-800 text-zinc-400"}`}>
      {v.replace(/_/g, " ")}
    </span>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400">{label}</label>
      {children}
    </div>
  );
}

const inp = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none focus:border-red-500 placeholder:text-white/30";
const sel = inp;

// ─── Tab: Resultados ─────────────────────────────────────────────────────────

function TabResultados({ campeonatos, registros, onRefresh }: {
  campeonatos: Campeonato[];
  registros: Registro[];
  onRefresh: () => void;
}) {
  const blankForm = {
    fecha: hoy(), hora: horaActual(),
    horaEstimada: "", horaSubida: "",
    nombre: "", apellido: "", telefono: "",
    campeonato_id: "", categoria: "oro",
    circuito: "", tiempo: "",
    escuderia_favorita: "", observaciones: "",
    cantMinutos: 15, cantTurnos: 1, turnoListo: false,
  };

  const [form, setForm] = useState(blankForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [pagosDetalle, setPagosDetalle] = useState<PagoDetalle[]>([
    { metodo_pago: "qr", monto: "", posnet_pago: "" },
  ]);

  // Autocomplete pilotos
  const [pilotos, setPilotos] = useState<PilotoSugerido[]>([]);
  const [mostrarSug, setMostrarSug] = useState(false);

  // Filtros tabla
  const [filters, setFilters] = useState({ nombre: "", campeonato_id: "", categoria: "" });

  // Hora bajada automática
  const horaBajada = useMemo(
    () => sumarMinutosAHora(form.horaSubida, form.cantMinutos),
    [form.horaSubida, form.cantMinutos]
  );

  const totalPagos = useMemo(
    () => pagosDetalle.reduce((acc, p) => acc + (Number(p.monto) || 0), 0),
    [pagosDetalle]
  );

  const set = (k: string, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  // ── Autocomplete ────────────────────────────────────────────────────────────

  async function buscarPilotos(valor: string) {
    if (valor.trim().length < 2) { setPilotos([]); setMostrarSug(false); return; }
    try {
      const res = await fetch(`/api/campeonatos/pilotos?q=${encodeURIComponent(valor.trim())}`);
      const data = await res.json();
      setPilotos(data.pilotos || []);
      setMostrarSug((data.pilotos || []).length > 0);
    } catch { /* silent */ }
  }

  function seleccionarPiloto(p: PilotoSugerido) {
    setForm((f) => ({
      ...f,
      nombre: p.nombre || "",
      apellido: p.apellido || "",
      telefono: p.telefono || "",
      categoria: p.categoria || f.categoria,
      escuderia_favorita: p.escuderia_favorita || f.escuderia_favorita,
    }));
    setPilotos([]); setMostrarSug(false);
  }

  // ── Pagos ───────────────────────────────────────────────────────────────────

  function actualizarPago(idx: number, campo: keyof PagoDetalle, val: string) {
    setPagosDetalle((prev) =>
      prev.map((p, i) => {
        if (i !== idx) return p;
        const upd = { ...p, [campo]: val };
        if (campo === "metodo_pago" && !metodoUsaPosnet(val)) upd.posnet_pago = "";
        return upd;
      })
    );
  }

  function agregarPago() {
    setPagosDetalle((p) => [...p, { metodo_pago: "efectivo", monto: "", posnet_pago: "" }]);
  }

  function eliminarPago(idx: number) {
    setPagosDetalle((p) => (p.length === 1 ? p : p.filter((_, i) => i !== idx)));
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  function resetForm() {
    setForm(blankForm);
    setPagosDetalle([{ metodo_pago: "qr", monto: "", posnet_pago: "" }]);
    setEditId(null); setMsg("");
    setPilotos([]); setMostrarSug(false);
  }

  function startEdit(r: Registro) {
    setEditId(r.id);
    setForm({
      fecha: r.fecha, hora: r.hora || "", horaEstimada: r.hora_estimada_subida || "",
      horaSubida: r.hora_subida || "", nombre: r.nombre, apellido: r.apellido || "",
      telefono: r.telefono || "", campeonato_id: r.campeonato_id || "",
      categoria: r.categoria, circuito: r.circuito || "", tiempo: r.tiempo || "",
      escuderia_favorita: r.escuderia_favorita || "", observaciones: r.observaciones || "",
      cantMinutos: r.cantidad_minutos || 15, cantTurnos: r.cantidad_turnos || 1,
      turnoListo: r.turno_listo || false,
    });
    setPagosDetalle(normalizarPagos(r));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const submit = async () => {
    if (!form.nombre.trim() || !form.apellido.trim() || !form.telefono.trim() || !form.fecha || !form.categoria) {
      setMsg("Nombre, apellido, teléfono, fecha y categoría son obligatorios."); return;
    }
    setSaving(true); setMsg("");
    try {
      const pagosLimpios = pagosDetalle
        .map((p) => ({ metodo_pago: p.metodo_pago, monto: Number(p.monto) || 0, posnet_pago: metodoUsaPosnet(p.metodo_pago) ? (p.posnet_pago || null) : null }))
        .filter((p) => p.monto > 0);
      const total = pagosLimpios.reduce((s, p) => s + p.monto, 0);

      const payload = {
        fecha: form.fecha, hora: form.hora || null,
        hora_estimada_subida: form.horaEstimada || null,
        hora_subida: form.horaSubida || null,
        hora_bajada: horaBajada || null,
        nombre: form.nombre.trim(), apellido: form.apellido.trim(),
        telefono: form.telefono.trim(),
        campeonato_id: form.campeonato_id || null,
        categoria: form.categoria,
        circuito: form.circuito || null,
        tiempo: form.tiempo || null,
        escuderia_favorita: form.escuderia_favorita || null,
        observaciones: form.observaciones || null,
        cantidad_minutos: form.cantMinutos,
        cantidad_turnos: form.cantTurnos,
        turno_listo: form.turnoListo,
        pagos_detalle: pagosLimpios,
        total,
      };

      const url = editId ? `/api/admin/campeonatos/registros/${editId}` : "/api/admin/campeonatos/registros";
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Error"); return; }
      resetForm(); onRefresh();
    } finally { setSaving(false); }
  };

  const anular = async (id: string) => {
    if (!confirm("¿Anular este registro?")) return;
    await fetch(`/api/admin/campeonatos/registros/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "anulado" }),
    });
    onRefresh();
  };

  // Turno listo inline (optimista)
  const toggleListo = async (r: Registro) => {
    const nuevo = !r.turno_listo;
    // Actualiza UI inmediatamente
    onRefresh(); // se refrescará igual; hacemos el PATCH
    await fetch(`/api/admin/campeonatos/registros/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turno_listo: nuevo }),
    });
    onRefresh();
  };

  const filtered = registros.filter((r) => {
    if (filters.nombre && !r.nombre_completo?.toLowerCase().includes(filters.nombre.toLowerCase())) return false;
    if (filters.campeonato_id && r.campeonato_id !== filters.campeonato_id) return false;
    if (filters.categoria && r.categoria !== filters.categoria) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      {/* ── Formulario ─────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-black uppercase text-red-500">
            {editId ? "Editar turno" : "Nuevo turno"}
          </h2>
          {editId && (
            <button onClick={resetForm} className="rounded-full border border-white/15 px-4 py-1.5 text-xs font-black uppercase text-white/60 hover:border-white hover:text-white">
              Cancelar edición
            </button>
          )}
        </div>

        {/* Fila 1: tiempos */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Fecha">
            <input type="date" className={inp} value={form.fecha} onChange={(e) => set("fecha", e.target.value)} />
          </Field>
          <Field label="Hora toma">
            <input type="time" className={inp} value={form.hora} onChange={(e) => set("hora", e.target.value)} />
          </Field>
          <Field label="Hora estimada">
            <input type="time" className={inp} value={form.horaEstimada} onChange={(e) => set("horaEstimada", e.target.value)} />
          </Field>
          <Field label="Hora subida">
            <input type="time" className={inp} value={form.horaSubida} onChange={(e) => set("horaSubida", e.target.value)} />
          </Field>
          <Field label="Hora bajada (auto)">
            <input type="time" readOnly value={horaBajada}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/50 outline-none" />
          </Field>
        </div>

        {/* Fila 2: piloto con autocomplete */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Nombre *">
            <input className={inp} value={form.nombre} placeholder="Nombre"
              onChange={(e) => { set("nombre", e.target.value); buscarPilotos(e.target.value); }}
              onFocus={() => { if (pilotos.length > 0) setMostrarSug(true); }} />
          </Field>
          <Field label="Apellido *">
            <input className={inp} value={form.apellido} placeholder="Apellido"
              onChange={(e) => { set("apellido", e.target.value); buscarPilotos(e.target.value); }}
              onFocus={() => { if (pilotos.length > 0) setMostrarSug(true); }} />
          </Field>
          <Field label="Teléfono *">
            <input className={inp} value={form.telefono} placeholder="351..."
              onChange={(e) => { set("telefono", e.target.value); buscarPilotos(e.target.value); }}
              onFocus={() => { if (pilotos.length > 0) setMostrarSug(true); }} />
          </Field>
        </div>

        {/* Dropdown sugerencias */}
        {mostrarSug && pilotos.length > 0 && (
          <div className="mt-2 rounded-2xl border border-red-500/30 bg-black p-3 shadow-2xl">
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-white/35">Pilotos encontrados</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {pilotos.map((p, i) => (
                <button key={i} type="button" onClick={() => seleccionarPiloto(p)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-red-500 hover:bg-red-600/20">
                  <p className="truncate text-sm font-black text-white">{p.nombre_completo}</p>
                  <p className="truncate text-xs text-white/45">{p.telefono} · {p.categoria} · {p.escuderia_favorita}</p>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setPilotos([]); setMostrarSug(false); }}
              className="mt-2 text-xs font-bold text-white/35 hover:text-white">
              Cerrar
            </button>
          </div>
        )}

        {/* Fila 3: campeonato/categoria/circuito/tiempo */}
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
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
          <Field label="Tiempo (ej: 1:23.456)">
            <input className={inp} placeholder="1:23.456" value={form.tiempo} onChange={(e) => set("tiempo", e.target.value)} />
          </Field>
        </div>

        {/* Fila 4: escudería / observaciones */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Escudería">
            <select className={sel} value={form.escuderia_favorita} onChange={(e) => set("escuderia_favorita", e.target.value)}>
              <option value="">— seleccionar —</option>
              {ESCUDERIAS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </Field>
          <Field label="Observaciones">
            <input className={inp} value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)} />
          </Field>
        </div>

        {/* Fila 5: minutos / turnos / listo */}
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Minutos">
            <input type="number" min={1} className={inp} value={form.cantMinutos}
              onChange={(e) => set("cantMinutos", Number(e.target.value))} />
          </Field>
          <Field label="Cant. turnos">
            <input type="number" min={1} className={inp} value={form.cantTurnos}
              onChange={(e) => set("cantTurnos", Number(e.target.value))} />
          </Field>
          <div className="flex items-end pb-1">
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" checked={form.turnoListo}
                onChange={(e) => set("turnoListo", e.target.checked)}
                className="h-5 w-5 accent-red-600" />
              <span className="text-sm font-black text-white/70">Turno terminado</span>
            </label>
          </div>
          <div className="flex items-end">
            <button onClick={submit} disabled={saving}
              className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase text-white transition hover:bg-red-700 disabled:opacity-40">
              {saving ? "Guardando..." : editId ? "Actualizar" : "Guardar turno"}
            </button>
          </div>
        </div>

        {/* Pagos */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Métodos de pago</p>
            <button type="button" onClick={agregarPago}
              className="rounded-full border border-red-500/60 px-3 py-1 text-[10px] font-black uppercase text-red-400 hover:bg-red-600 hover:text-white">
              + Agregar pago
            </button>
          </div>
          <div className="space-y-2">
            {pagosDetalle.map((pago, idx) => {
              const usaPosnet = metodoUsaPosnet(pago.metodo_pago);
              return (
                <div key={idx} className="grid gap-2 md:grid-cols-[1.2fr_1fr_1fr_80px]">
                  <select className={sel} value={pago.metodo_pago}
                    onChange={(e) => actualizarPago(idx, "metodo_pago", e.target.value)}>
                    {METODOS_PAGO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <input type="number" min={0} placeholder="Monto" className={inp}
                    value={pago.monto} onChange={(e) => actualizarPago(idx, "monto", e.target.value)} />
                  <select className={sel} value={pago.posnet_pago || ""} disabled={!usaPosnet}
                    onChange={(e) => actualizarPago(idx, "posnet_pago", e.target.value)}>
                    <option value="">Sin posnet</option>
                    {POSNETS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button type="button" onClick={() => eliminarPago(idx)} disabled={pagosDetalle.length === 1}
                    className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black text-white/60 hover:border-red-500 hover:text-white disabled:opacity-30">
                    Quitar
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-right text-sm font-black">
            Total: <span className="ml-2 text-red-500">{formatoDinero(totalPagos)}</span>
          </div>
        </div>

        {msg && <p className="mt-3 text-sm font-bold text-red-400">{msg}</p>}
      </div>

      {/* ── Filtros tabla ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <input className={`${inp} flex-1 min-w-[140px]`} placeholder="Buscar nombre..."
          value={filters.nombre} onChange={(e) => setFilters((f) => ({ ...f, nombre: e.target.value }))} />
        <select className={`${sel} min-w-[160px]`} value={filters.campeonato_id}
          onChange={(e) => setFilters((f) => ({ ...f, campeonato_id: e.target.value }))}>
          <option value="">Todos los campeonatos</option>
          {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className={`${sel} min-w-[130px]`} value={filters.categoria}
          onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value }))}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* ── Tabla ─────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[50px_80px_70px_70px_1.5fr_80px_1fr_120px_100px] gap-2 border-b border-white/10 bg-zinc-900/80 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white/35">
            <span>Listo</span><span>Fecha</span><span>Sube</span><span>Baja</span>
            <span>Piloto</span><span>Cat</span><span>Campeonato / Circuito</span>
            <span>Tiempo / Pago</span><span>Acciones</span>
          </div>
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center text-zinc-500">Sin resultados</div>
          )}
          {filtered.map((r) => {
            const pagos = normalizarPagos(r).filter((p) => Number(p.monto) > 0);
            const pagoStr = pagos.map((p) => `${p.metodo_pago.toUpperCase()} ${formatoDinero(Number(p.monto))}`).join(" + ") || "—";
            return (
              <div key={r.id}
                className={`grid grid-cols-[50px_80px_70px_70px_1.5fr_80px_1fr_120px_100px] items-center gap-2 border-b border-white/5 px-4 py-3 text-sm transition ${r.turno_listo ? "bg-green-950/20" : "bg-black hover:bg-white/[0.02]"}`}>
                <label className="flex justify-center">
                  <input type="checkbox" checked={!!r.turno_listo}
                    onChange={() => toggleListo(r)}
                    className="h-5 w-5 accent-red-600 cursor-pointer" />
                </label>
                <span className="text-zinc-400 text-xs">{r.fecha}</span>
                <span className="text-zinc-400 text-xs">{r.hora_subida || "—"}</span>
                <span className="text-zinc-400 text-xs">{r.hora_bajada || "—"}</span>
                <div>
                  <p className={`font-black text-white ${r.turno_listo ? "line-through opacity-50" : ""}`}>{r.nombre_completo}</p>
                  <p className="text-xs text-white/40">{r.telefono}</p>
                </div>
                <span><Badge v={r.categoria} /></span>
                <div>
                  <p className="text-xs text-zinc-400">{r.campeonatos?.nombre || "—"}</p>
                  <p className="text-xs text-zinc-500">{r.circuito || "—"}</p>
                </div>
                <div>
                  <p className="font-mono text-red-400 font-bold text-xs">{r.tiempo || "—"}</p>
                  <p className="text-xs text-white/40">{pagoStr}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(r)}
                    className="rounded-lg border border-white/15 px-2 py-1 text-xs font-black text-white/60 hover:border-red-500 hover:text-white">
                    Editar
                  </button>
                  {r.estado !== "anulado" && (
                    <button onClick={() => anular(r.id)}
                      className="rounded-lg bg-red-900/30 px-2 py-1 text-xs font-black text-red-400 hover:bg-red-900">
                      Anular
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
  const [subiendo, setSubiendo] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);

  const subirImagen = async (file: File) => {
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/campeonatos/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Error subiendo imagen"); return; }
      set("imagen_url", data.url);
    } finally { setSubiendo(false); }
  };

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
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, precio_inscripcion: Number(form.precio_inscripcion), cupos_maximos: Number(form.cupos_maximos) }),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Error"); return; }
      cancel(); onRefresh();
    } finally { setSaving(false); }
  };
  const toggleCat = (cat: string) =>
    set("categorias", form.categorias.includes(cat) ? form.categorias.filter((c) => c !== cat) : [...form.categorias, cat]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-black text-white">Gestión de Campeonatos</h2>
        {!showForm && <button onClick={() => setShowForm(true)} className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-500">+ Nuevo</button>}
      </div>
      {showForm && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <h3 className="font-black text-white">{editId ? "Editar" : "Nuevo"} campeonato</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Nombre *"><input className={inp} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} /></Field>
            <Field label="Estado"><select className={sel} value={form.estado} onChange={(e) => set("estado", e.target.value)}>{ESTADOS_CAMP.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Fecha inicio"><input type="date" className={inp} value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} /></Field>
            <Field label="Fecha fin"><input type="date" className={inp} value={form.fecha_fin} onChange={(e) => set("fecha_fin", e.target.value)} /></Field>
            <Field label="Precio ($)"><input type="number" className={inp} value={form.precio_inscripcion} onChange={(e) => set("precio_inscripcion", e.target.value)} /></Field>
            <Field label="Descripción"><input className={inp} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} /></Field>
            <Field label="Imagen">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => imgRef.current?.click()}
                  disabled={subiendo}
                  className="w-full rounded-xl border border-dashed border-white/20 py-3 text-sm font-bold text-zinc-400 hover:border-zinc-500 hover:text-white transition disabled:opacity-50"
                >
                  {subiendo ? "Subiendo..." : form.imagen_url ? "Cambiar foto" : "Subir foto"}
                </button>
                {form.imagen_url && (
                  <img src={form.imagen_url} alt="preview" className="h-24 w-full object-cover rounded-xl" />
                )}
                <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirImagen(f); e.target.value = ""; }} />
              </div>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={form.inscripcion_habilitada} onChange={(e) => set("inscripcion_habilitada", e.target.checked)} className="accent-red-500" />
            Inscripción habilitada
          </label>
          <div className="flex gap-4">
            {CATEGORIAS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={form.categorias.includes(c)} onChange={() => toggleCat(c)} className="accent-red-500" />
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </label>
            ))}
          </div>
          {msg && <p className="text-sm font-bold text-red-400">{msg}</p>}
          <div className="flex gap-3">
            <button onClick={submit} disabled={saving} className="rounded-xl bg-red-600 px-6 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50">{saving ? "Guardando..." : editId ? "Actualizar" : "Crear"}</button>
            <button onClick={cancel} className="rounded-xl bg-zinc-800 px-6 py-2 font-bold text-white hover:bg-zinc-700">Cancelar</button>
          </div>
        </div>
      )}
      <div className="space-y-3">
        {campeonatos.length === 0 && <p className="text-zinc-500 text-sm">No hay campeonatos cargados.</p>}
        {campeonatos.map((c) => (
          <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-black text-white">{c.nombre}</span>
                <Badge v={c.estado} />
                {c.inscripcion_habilitada && <span className="text-xs text-green-400 font-bold">Inscripción abierta</span>}
              </div>
              <p className="text-sm text-zinc-500 mt-1">{c.fecha_inicio && `${c.fecha_inicio} → ${c.fecha_fin}`} · ${c.precio_inscripcion.toLocaleString()} · {c.cupos_maximos} cupos</p>
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
      const res = await fetch(url, { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Error"); return; }
      cancel(); onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-black text-white">Gestión de Sorteos</h2>
        {!showForm && <button onClick={() => setShowForm(true)} className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-500">+ Nuevo</button>}
      </div>
      {showForm && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <h3 className="font-black text-white">{editId ? "Editar" : "Nuevo"} sorteo</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Título *"><input className={inp} value={form.titulo} onChange={(e) => set("titulo", e.target.value)} /></Field>
            <Field label="Premio *"><input className={inp} value={form.premio} onChange={(e) => set("premio", e.target.value)} /></Field>
            <Field label="Estado"><select className={sel} value={form.estado} onChange={(e) => set("estado", e.target.value)}>{ESTADOS_CAMP.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Imagen URL"><input className={inp} value={form.imagen_url} onChange={(e) => set("imagen_url", e.target.value)} /></Field>
            <Field label="Fecha inicio"><input type="date" className={inp} value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} /></Field>
            <Field label="Fecha fin"><input type="date" className={inp} value={form.fecha_fin} onChange={(e) => set("fecha_fin", e.target.value)} /></Field>
            <Field label="Descripción"><textarea className={`${inp} resize-none`} rows={2} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} /></Field>
            <Field label="Condiciones"><textarea className={`${inp} resize-none`} rows={2} value={form.condiciones} onChange={(e) => set("condiciones", e.target.value)} /></Field>
          </div>
          {msg && <p className="text-sm font-bold text-red-400">{msg}</p>}
          <div className="flex gap-3">
            <button onClick={submit} disabled={saving} className="rounded-xl bg-red-600 px-6 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50">{saving ? "Guardando..." : editId ? "Actualizar" : "Crear"}</button>
            <button onClick={cancel} className="rounded-xl bg-zinc-800 px-6 py-2 font-bold text-white hover:bg-zinc-700">Cancelar</button>
          </div>
        </div>
      )}
      <div className="space-y-3">
        {sorteos.length === 0 && <p className="text-zinc-500 text-sm">No hay sorteos cargados.</p>}
        {sorteos.map((s) => (
          <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3"><span className="font-black text-white">{s.titulo}</span><Badge v={s.estado} /></div>
              <p className="text-sm text-zinc-500 mt-1">Premio: {s.premio}</p>
            </div>
            <button onClick={() => startEdit(s)} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-700 shrink-0">Editar</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Inscripciones ───────────────────────────────────────────────────────

const blankInscripcion = {
  nombre: "", apellido: "", telefono: "", dni: "", instagram: "",
  escuderia_favorita: "", categoria: "oro", campeonato_id: "", monto: "", metodo_pago: "efectivo",
};

function TabInscripciones({ inscripciones, campeonatos, role, onRefresh }: {
  inscripciones: Inscripcion[];
  campeonatos: Campeonato[];
  role: string | null;
  onRefresh: () => void;
}) {
  const [filters, setFilters] = useState({ campeonato_id: "", categoria: "", estado_pago: "", q: "" });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankInscripcion);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

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
  const totalRecaudado = filtered.filter((i) => i.estado_pago === "pagado").reduce((s, i) => s + (i.monto || 0), 0);

  const submitNueva = async () => {
    if (!form.nombre.trim() || !form.apellido.trim() || !form.telefono.trim() || !form.dni.trim() || !form.escuderia_favorita || !form.campeonato_id || !form.monto || !form.metodo_pago) {
      setMsg("Completá todos los campos obligatorios"); return;
    }
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/admin/campeonatos/inscripciones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, monto: Number(form.monto) }),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Error"); return; }
      setForm(blankInscripcion); setShowForm(false); onRefresh();
    } finally { setSaving(false); }
  };

  const cancelarInscripcion = async (id: string) => {
    if (!confirm("¿Cancelar esta inscripción?")) return;
    setCancellingId(id);
    try {
      const res = await fetch(`/api/admin/campeonatos/inscripciones/${id}`, { method: "PATCH" });
      if (!res.ok) { const d = await res.json(); alert(d.error || "Error al cancelar"); return; }
      onRefresh();
    } finally { setCancellingId(null); }
  };

  const colCount = role === "admin" ? 11 : 10;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-black text-white">Inscripciones</h2>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-500">
            + Nueva
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <h3 className="font-black text-white">Nueva inscripción (pago en stand)</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Nombre *"><input className={inp} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} /></Field>
            <Field label="Apellido *"><input className={inp} value={form.apellido} onChange={(e) => set("apellido", e.target.value)} /></Field>
            <Field label="Teléfono *"><input className={inp} value={form.telefono} onChange={(e) => set("telefono", e.target.value)} /></Field>
            <Field label="DNI *"><input className={inp} value={form.dni} onChange={(e) => set("dni", e.target.value)} /></Field>
            <Field label="Instagram"><input className={inp} value={form.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@usuario" /></Field>
            <Field label="Escudería *">
              <select className={sel} value={form.escuderia_favorita} onChange={(e) => set("escuderia_favorita", e.target.value)}>
                <option value="">Seleccionar...</option>
                {ESCUDERIAS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
            <Field label="Categoría *">
              <select className={sel} value={form.categoria} onChange={(e) => set("categoria", e.target.value)}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Campeonato *">
              <select className={sel} value={form.campeonato_id} onChange={(e) => set("campeonato_id", e.target.value)}>
                <option value="">Seleccionar...</option>
                {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Field>
            <Field label="Monto *"><input type="number" className={inp} value={form.monto} onChange={(e) => set("monto", e.target.value)} /></Field>
            <Field label="Método de pago *">
              <select className={sel} value={form.metodo_pago} onChange={(e) => set("metodo_pago", e.target.value)}>
                {METODOS_PAGO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          {msg && <p className="text-sm font-bold text-red-400">{msg}</p>}
          <div className="flex gap-3">
            <button onClick={submitNueva} disabled={saving} className="rounded-xl bg-red-600 px-6 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50">{saving ? "Guardando..." : "Crear inscripción"}</button>
            <button onClick={() => { setShowForm(false); setForm(blankInscripcion); setMsg(""); }} className="rounded-xl bg-zinc-800 px-6 py-2 font-bold text-white hover:bg-zinc-700">Cancelar</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <input className={`${inp} flex-1 min-w-[140px]`} placeholder="Nombre, DNI o teléfono..." value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        <select className={`${sel} min-w-[160px]`} value={filters.campeonato_id} onChange={(e) => setFilters((f) => ({ ...f, campeonato_id: e.target.value }))}><option value="">Todos los campeonatos</option>{campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <select className={`${sel} min-w-[130px]`} value={filters.categoria} onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value }))}><option value="">Todas las cat.</option>{CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className={`${sel} min-w-[140px]`} value={filters.estado_pago} onChange={(e) => setFilters((f) => ({ ...f, estado_pago: e.target.value }))}><option value="">Todos los estados</option><option value="pagado">Pagado</option><option value="pendiente_pago">Pendiente</option><option value="rechazado">Rechazado</option><option value="cancelado">Cancelado</option></select>
      </div>
      <div className="flex gap-4 text-sm">
        <span className="text-zinc-400">Total: <strong className="text-white">{filtered.length}</strong></span>
        <span className="text-zinc-400">Pagadas: <strong className="text-green-400">{filtered.filter((i) => i.estado_pago === "pagado").length}</strong></span>
        <span className="text-zinc-400">Recaudado: <strong className="text-white">{formatoDinero(totalRecaudado)}</strong></span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/80 text-zinc-400">
            <tr>
              {["Nombre", "DNI", "Tel", "Instagram", "Escudería", "Cat", "Campeonato", "Monto", "Estado", "Fecha"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-bold uppercase text-xs">{h}</th>
              ))}
              {role === "admin" && <th className="px-4 py-3 text-left font-bold uppercase text-xs">Acción</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.length === 0 && <tr><td colSpan={colCount} className="px-4 py-8 text-center text-zinc-500">Sin inscripciones</td></tr>}
            {filtered.map((i) => (
              <tr key={i.id} className="bg-black hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3 font-bold text-white">{i.nombre_completo}</td>
                <td className="px-4 py-3 text-zinc-400">{i.dni}</td>
                <td className="px-4 py-3 text-zinc-400">{i.telefono}</td>
                <td className="px-4 py-3 text-zinc-400">{i.instagram || "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{i.escuderia_favorita}</td>
                <td className="px-4 py-3"><Badge v={i.categoria} /></td>
                <td className="px-4 py-3 text-zinc-400">{i.campeonatos?.nombre || "—"}</td>
                <td className="px-4 py-3 font-bold text-white">
                  {formatoDinero(i.monto)}
                  {i.metodo_pago && <span className="ml-1 text-xs text-zinc-500">({i.metodo_pago})</span>}
                </td>
                <td className="px-4 py-3"><Badge v={i.estado_pago} /></td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{i.created_at?.slice(0, 10)}</td>
                {role === "admin" && (
                  <td className="px-4 py-3">
                    {i.estado_pago !== "cancelado" && (
                      <button
                        onClick={() => cancelarInscripcion(i.id)}
                        disabled={cancellingId === i.id}
                        className="rounded-lg bg-zinc-800 px-3 py-1 text-xs font-bold text-red-400 hover:bg-zinc-700 disabled:opacity-50"
                      >
                        {cancellingId === i.id ? "..." : "Cancelar"}
                      </button>
                    )}
                  </td>
                )}
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
const ALL_TABS: { id: Tab; label: string; adminOnly: boolean }[] = [
  { id: "resultados", label: "Resultados", adminOnly: false },
  { id: "campeonatos", label: "Campeonatos", adminOnly: true },
  { id: "sorteos", label: "Sorteos", adminOnly: true },
  { id: "inscripciones", label: "Inscripciones", adminOnly: false },
];

export default function AdminCampeonatosPage() {
  const [tab, setTab] = useState<Tab>("resultados");
  const [campeonatos, setCampeonatos] = useState<Campeonato[]>([]);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([]);
  const [sorteos, setSorteos] = useState<Sorteo[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then((d) => setRole(d.role)).catch(() => {});
  }, []);

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
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const visibleTabs = ALL_TABS.filter((t) => !t.adminOnly || role === "admin");

  return (
    <div className="min-h-screen bg-black p-4 md:p-8">
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500 mb-1">Panel Admin</p>
        <h1 className="text-3xl font-black text-white">Campeonatos</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {campeonatos.length} campeonatos · {registros.length} resultados · {inscripciones.length} inscripciones
        </p>
      </div>
      <div className="mb-8 flex gap-1 rounded-2xl bg-white/[0.04] p-1 w-fit overflow-x-auto">
        {visibleTabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-xl px-5 py-2 text-sm font-black uppercase transition-all whitespace-nowrap ${tab === t.id ? "bg-red-600 text-white" : "text-zinc-400 hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500">Cargando...</div>
      ) : (
        <>
          {tab === "resultados" && <TabResultados campeonatos={campeonatos} registros={registros} onRefresh={fetchAll} />}
          {tab === "campeonatos" && role === "admin" && <TabCampeonatos campeonatos={campeonatos} onRefresh={fetchAll} />}
          {tab === "sorteos" && role === "admin" && <TabSorteos sorteos={sorteos} onRefresh={fetchAll} />}
          {tab === "inscripciones" && <TabInscripciones inscripciones={inscripciones} campeonatos={campeonatos} role={role} onRefresh={fetchAll} />}
        </>
      )}
    </div>
  );
}

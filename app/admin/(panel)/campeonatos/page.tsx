"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { formatPenalizacion, pilotoKey, msToTiempo, tiempoToMs, ESCUDERIAS_2026 } from "@/lib/campeonatos";
import { getTurnoTimerState, useNow, TURNO_BADGE_CLASS } from "@/lib/turnoTimer";

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
  inscripcion_id?: string | null;
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
  campeonato_fecha_id: string | null;
  inscripcion_id: string | null;
  tiempo_crudo_ms: number | null;
  penalizacion_ms: number | null;
  tiempo_oficial_ms: number | null;
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
  categoria: string | null;
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

const CATEGORIAS = ["oro", "plata", "bronce"];

const ESCUDERIAS = ESCUDERIAS_2026;

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
type RangoModo = "hoy" | "semana" | "mes" | "custom";
function fmtFecha(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Calcula { desde, hasta } según el modo rápido elegido.
function rangoDeFechas(modo: RangoModo, customDesde: string, customHasta: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (modo === "semana") {
    const dow = now.getDay() || 7; // 1=lunes ... 7=domingo
    const lunes = new Date(now);
    lunes.setDate(now.getDate() - (dow - 1));
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    return { desde: fmtFecha(lunes), hasta: fmtFecha(domingo) };
  }
  if (modo === "mes") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { desde: fmtFecha(first), hasta: fmtFecha(last) };
  }
  if (modo === "custom") {
    return { desde: customDesde, hasta: customHasta };
  }
  const t = fmtFecha(now);
  return { desde: t, hasta: t };
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
    pendiente_pago: "bg-yellow-900 text-yellow-300",
    pendiente_pago_online: "bg-blue-900 text-blue-300",
    pendiente_pago_stand: "bg-orange-900 text-orange-300",
    proximo: "bg-blue-900 text-blue-300",
    anulado: "bg-zinc-800 text-zinc-400", finalizado: "bg-zinc-800 text-zinc-400",
    rechazado: "bg-red-900 text-red-300", cancelado: "bg-zinc-800 text-zinc-400",
    oro: "bg-yellow-900 text-yellow-300", plata: "bg-zinc-700 text-zinc-200",
    bronce: "bg-orange-900 text-orange-300",
  };
  const labels: Record<string, string> = {
    pendiente_pago_online: "Pend. Online",
    pendiente_pago_stand: "Pend. Stand",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${map[v] ?? "bg-zinc-800 text-zinc-400"}`}>
      {labels[v] ?? v.replace(/_/g, " ")}
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

function TabResultados({ campeonatos, registros, rangoModo, setRangoModo, rangoDesde, setRangoDesde, rangoHasta, setRangoHasta, onRefresh }: {
  campeonatos: Campeonato[];
  registros: Registro[];
  rangoModo: RangoModo;
  setRangoModo: (m: RangoModo) => void;
  rangoDesde: string;
  setRangoDesde: (f: string) => void;
  rangoHasta: string;
  setRangoHasta: (f: string) => void;
  onRefresh: () => void;
}) {
  const blankForm = {
    fecha: hoy(), hora: horaActual(),
    horaEstimada: "", horaSubida: "",
    nombre: "", apellido: "", telefono: "",
    campeonato_id: "", categoria: "oro",
    campeonato_fecha_id: "", inscripcion_id: "",
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

  // Fechas/penalizaciones del campeonato seleccionado (Fase 2).
  const [fechas, setFechas] = useState<Fecha[]>([]);
  const [penalizaciones, setPenalizaciones] = useState<PenalizacionRow[]>([]);
  // Al cargar un registro para editar NO queremos pisar su fecha con la vigente.
  const autoPreselectRef = useRef(true);

  // Hora bajada automática
  const horaBajada = useMemo(
    () => sumarMinutosAHora(form.horaSubida, form.cantMinutos),
    [form.horaSubida, form.cantMinutos]
  );

  // Reloj para los temporizadores en vivo (un solo intervalo, se limpia al desmontar).
  const now = useNow();

  const totalPagos = useMemo(
    () => pagosDetalle.reduce((acc, p) => acc + (Number(p.monto) || 0), 0),
    [pagosDetalle]
  );

  const set = (k: string, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Al cambiar el campeonato: cargar sus fechas/penalizaciones y preseleccionar la
  // fecha vigente abierta (hoy entre fecha_inicio y fecha_fin). Al editar, no pisa.
  useEffect(() => {
    const cid = form.campeonato_id;
    if (!cid) { setFechas([]); setPenalizaciones([]); return; }
    let cancel = false;
    (async () => {
      try {
        const [f, p] = await Promise.all([
          fetch(`/api/admin/campeonatos/fechas?campeonato_id=${cid}`).then((r) => r.json()),
          fetch(`/api/admin/campeonatos/penalizaciones?campeonato_id=${cid}`).then((r) => r.json()),
        ]);
        if (cancel) return;
        const fs: Fecha[] = Array.isArray(f) ? f : [];
        setFechas(fs);
        setPenalizaciones(Array.isArray(p) ? p : []);
        if (autoPreselectRef.current) {
          const t = hoy();
          const vigente =
            fs.find((x) => x.estado === "abierta" && (!x.fecha_inicio || x.fecha_inicio <= t) && (!x.fecha_fin || x.fecha_fin >= t)) ||
            fs.find((x) => x.estado === "abierta") ||
            null;
          setForm((cur) => ({ ...cur, campeonato_fecha_id: vigente?.id || "", circuito: vigente?.circuito || cur.circuito }));
        }
        autoPreselectRef.current = true;
      } catch { /* silent */ }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.campeonato_id]);

  const fechaSel = fechas.find((f) => f.id === form.campeonato_fecha_id) || null;
  const fechaCerrada = fechaSel?.estado === "cerrada";
  const penalAplicable = useMemo(() => {
    if (!form.campeonato_fecha_id) return 0;
    const pk = pilotoKey(form.inscripcion_id || null, `${form.nombre} ${form.apellido}`.trim());
    const m = penalizaciones.find((p) => p.fecha_destino_id === form.campeonato_fecha_id && p.piloto_key === pk);
    return m?.penalizacion_ms ?? 0;
  }, [form.campeonato_fecha_id, form.inscripcion_id, form.nombre, form.apellido, penalizaciones]);

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
      // Identidad estable si el piloto viene de una inscripción.
      inscripcion_id: p.inscripcion_id || "",
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
    autoPreselectRef.current = false; // editar: no pisar la fecha del registro
    setEditId(r.id);
    setForm({
      fecha: r.fecha, hora: r.hora || "", horaEstimada: r.hora_estimada_subida || "",
      horaSubida: r.hora_subida || "", nombre: r.nombre, apellido: r.apellido || "",
      telefono: r.telefono || "", campeonato_id: r.campeonato_id || "",
      campeonato_fecha_id: r.campeonato_fecha_id || "", inscripcion_id: r.inscripcion_id || "",
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
    if (fechaCerrada) {
      setMsg("Esta fecha está cerrada. No se pueden cargar nuevos tiempos."); return;
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
        campeonato_fecha_id: form.campeonato_fecha_id || null,
        inscripcion_id: form.inscripcion_id || null,
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

  // Navegación tipo planilla con flechas, SOLO dentro de este formulario.
  // Texto: ←/→ mueven el cursor y saltan de campo en el borde; ↑/↓ saltan de campo.
  // Selects: ←/→ saltan de campo; ↑/↓ cambian la opción (nativo). Date/time/checkbox: nativo.
  function handleArrowNav(e: React.KeyboardEvent<HTMLDivElement>) {
    const k = e.key;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "ArrowUp" && k !== "ArrowDown") return;
    const el = e.target as HTMLElement;
    const tag = el.tagName;
    const isText = tag === "INPUT" && ["text", "number", "tel", "search", ""].includes((el as HTMLInputElement).type);
    const isSelect = tag === "SELECT";
    if (!isText && !isSelect) return;
    let dir = 0;
    if (isText) {
      const input = el as HTMLInputElement;
      const atStart = (input.selectionStart ?? 0) === 0 && (input.selectionEnd ?? 0) === 0;
      const atEnd = (input.selectionStart ?? 0) === input.value.length && (input.selectionEnd ?? 0) === input.value.length;
      if (k === "ArrowDown") dir = 1;
      else if (k === "ArrowUp") dir = -1;
      else if (k === "ArrowRight" && atEnd) dir = 1;
      else if (k === "ArrowLeft" && atStart) dir = -1;
    } else {
      if (k === "ArrowRight") dir = 1;
      else if (k === "ArrowLeft") dir = -1;
    }
    if (dir === 0) return;
    const nodes = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([readonly]), select")
    ).filter((n) => !(n as HTMLInputElement).disabled && n.offsetParent !== null);
    const idx = nodes.indexOf(el);
    if (idx === -1) return;
    const next = nodes[idx + dir];
    if (next) {
      e.preventDefault();
      next.focus();
      if (next.tagName === "INPUT") (next as HTMLInputElement).select?.();
    }
  }

  const filtered = registros.filter((r) => {
    if (filters.nombre && !r.nombre_completo?.toLowerCase().includes(filters.nombre.toLowerCase())) return false;
    if (filters.campeonato_id && r.campeonato_id !== filters.campeonato_id) return false;
    if (filters.categoria && r.categoria !== filters.categoria) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      {/* ── Formulario ─────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5" onKeyDown={handleArrowNav}>
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
              onChange={(e) => { setForm((f) => ({ ...f, nombre: e.target.value, inscripcion_id: "" })); buscarPilotos(e.target.value); }}
              onFocus={() => { if (pilotos.length > 0) setMostrarSug(true); }} />
          </Field>
          <Field label="Apellido *">
            <input className={inp} value={form.apellido} placeholder="Apellido"
              onChange={(e) => { setForm((f) => ({ ...f, apellido: e.target.value, inscripcion_id: "" })); buscarPilotos(e.target.value); }}
              onFocus={() => { if (pilotos.length > 0) setMostrarSug(true); }} />
          </Field>
          <Field label="Teléfono *">
            <input className={inp} value={form.telefono} placeholder="351..."
              onChange={(e) => { setForm((f) => ({ ...f, telefono: e.target.value, inscripcion_id: "" })); buscarPilotos(e.target.value); }}
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

        {/* Fila 3: campeonato/categoria/tiempo (el circuito viene de la fecha) */}
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
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
          <Field label="Tiempo (ej: 1:23.456)">
            <input className={inp} placeholder="1:23.456" value={form.tiempo} onChange={(e) => set("tiempo", e.target.value)} />
          </Field>
        </div>

        {/* Fila fecha/circuito del campeonato (Fase 2) */}
        {form.campeonato_id && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/40 p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Fecha / circuito del campeonato">
                <select className={sel} value={form.campeonato_fecha_id} onChange={(e) => {
                  const ff = fechas.find((x) => x.id === e.target.value);
                  setForm((cur) => ({ ...cur, campeonato_fecha_id: e.target.value, circuito: ff?.circuito || cur.circuito }));
                }}>
                  <option value="">— sin fecha (manual) —</option>
                  {fechas.map((ff) => (
                    <option key={ff.id} value={ff.id}>
                      F{ff.numero_fecha}{ff.nombre ? ` · ${ff.nombre}` : ""}{ff.circuito ? ` · ${ff.circuito}` : ""}{ff.estado === "cerrada" ? " · CERRADA" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex flex-col justify-center gap-1 text-xs">
                {fechas.length === 0 && <p className="text-amber-300">Este campeonato no tiene fechas. Cargalas en el tab &quot;Fechas&quot; o seguí en modo manual.</p>}
                {fechas.length > 0 && !form.campeonato_fecha_id && <p className="text-amber-300">No hay fecha vigente abierta: elegí una manualmente.</p>}
                {fechaCerrada && <p className="font-bold text-red-400">Esta fecha está cerrada. No se pueden cargar nuevos tiempos.</p>}
                {penalAplicable > 0 && !fechaCerrada && <p className="font-bold text-amber-300">Penalización aplicable: {formatPenalizacion(penalAplicable)}s</p>}
                {form.tiempo && tiempoToMs(form.tiempo) != null && penalAplicable > 0 && !fechaCerrada && (
                  <p className="text-white/60">Oficial: {form.tiempo} {formatPenalizacion(penalAplicable)} = {msToTiempo((tiempoToMs(form.tiempo) || 0) + penalAplicable)}</p>
                )}
              </div>
            </div>
          </div>
        )}

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

      {/* ── Filtros rápidos de fecha ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          ["hoy", "Hoy"],
          ["semana", "Esta semana"],
          ["mes", "Este mes"],
          ["custom", "Personalizado"],
        ] as [RangoModo, string][]).map(([modo, label]) => (
          <button
            key={modo}
            type="button"
            onClick={() => setRangoModo(modo)}
            className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition ${
              rangoModo === modo
                ? "bg-red-600 text-white"
                : "border border-white/15 text-white/60 hover:border-red-500 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
        {rangoModo === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" className={`${sel} min-w-[150px]`} value={rangoDesde}
              onChange={(e) => setRangoDesde(e.target.value)} />
            <span className="text-white/40">→</span>
            <input type="date" className={`${sel} min-w-[150px]`} value={rangoHasta}
              onChange={(e) => setRangoHasta(e.target.value)} />
          </div>
        )}
      </div>

      {/* ── Filtros tabla ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
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
            const timer = getTurnoTimerState(
              {
                fecha: r.fecha,
                horaSubida: r.hora_subida,
                minutos: r.cantidad_minutos,
                listo: r.turno_listo,
                cancelado: r.estado === "anulado",
              },
              now,
            );
            return (
              <div key={r.id}
                className={`grid grid-cols-[50px_80px_70px_70px_1.5fr_80px_1fr_120px_100px] items-center gap-2 border-b border-white/5 px-4 py-3 text-sm transition ${timer.status === "listo" ? "bg-green-950/20" : timer.status === "rojo" ? "bg-red-950/25" : timer.status === "amarillo" ? "bg-amber-950/15" : "bg-black hover:bg-white/[0.02]"}`}>
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
                  <span className={`mt-1 inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${TURNO_BADGE_CLASS[timer.status]}`}>{timer.label}</span>
                </div>
                <span><Badge v={r.categoria} /></span>
                <div>
                  <p className="text-xs text-zinc-400">{r.campeonatos?.nombre || "—"}</p>
                  <p className="text-xs text-zinc-500">{r.circuito || "—"}</p>
                </div>
                <div>
                  <p className="font-mono text-red-400 font-bold text-xs">{r.tiempo || "—"}</p>
                  {r.penalizacion_ms ? (
                    <p className="font-mono text-[10px] text-amber-300">{formatPenalizacion(r.penalizacion_ms)} = {msToTiempo(r.tiempo_oficial_ms)}</p>
                  ) : null}
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
            <Field label="Cupos">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Number(form.cupos_maximos) <= 0}
                    onChange={(e) => set("cupos_maximos", e.target.checked ? "0" : "10")}
                    className="accent-red-500"
                  />
                  Sin límite de cupos (ilimitado)
                </label>
                {Number(form.cupos_maximos) > 0 && (
                  <input
                    type="number"
                    min={1}
                    className={inp}
                    value={form.cupos_maximos}
                    onChange={(e) => set("cupos_maximos", e.target.value)}
                    placeholder="Cantidad de cupos"
                  />
                )}
              </div>
            </Field>
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
              <p className="text-sm text-zinc-500 mt-1">{c.fecha_inicio && `${c.fecha_inicio} → ${c.fecha_fin}`} · ${c.precio_inscripcion.toLocaleString()} · {Number(c.cupos_maximos) > 0 ? `${c.cupos_maximos} cupos` : "Cupos ilimitados"}</p>
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
  const [subiendo, setSubiendo] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);

  const subirImagen = async (file: File) => {
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/sorteos/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Error subiendo imagen"); return; }
      set("imagen_url", data.url);
    } finally { setSubiendo(false); }
  };

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
            <Field label="Imagen">
              <div className="space-y-2">
                <button type="button" onClick={() => imgRef.current?.click()} disabled={subiendo}
                  className="w-full rounded-xl border border-dashed border-white/20 py-3 text-sm font-bold text-zinc-400 hover:border-zinc-500 hover:text-white transition disabled:opacity-50">
                  {subiendo ? "Subiendo..." : form.imagen_url ? "Cambiar foto" : "Subir foto"}
                </button>
                {form.imagen_url && <img src={form.imagen_url} alt="preview" className="h-24 w-full object-cover rounded-xl" />}
                <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirImagen(f); e.target.value = ""; }} />
              </div>
            </Field>
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

// Unifica los estados internos en 3 estados visuales: Pagado / Pendiente / Cancelado.
function estadoVisualInscripcion(estado: string): "pagado" | "pendiente" | "cancelado" {
  if (estado === "pagado") return "pagado";
  if (estado === "cancelado" || estado === "rechazado") return "cancelado";
  return "pendiente";
}

function BadgeInscripcion({ estado }: { estado: string }) {
  const v = estadoVisualInscripcion(estado);
  const map = {
    pagado: "bg-green-900 text-green-300",
    pendiente: "bg-yellow-900 text-yellow-300",
    cancelado: "bg-zinc-800 text-zinc-400",
  } as const;
  const label = { pagado: "Pagado", pendiente: "Pendiente", cancelado: "Cancelado" } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${map[v]}`}>
      {label[v]}
    </span>
  );
}

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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Eliminar (soft-delete, solo admin): oculta la inscripción del panel sin borrar.
  const eliminarInscripcion = async (id: string) => {
    if (!confirm("Esta inscripción dejará de aparecer en el panel. ¿Confirmás?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/campeonatos/inscripciones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "eliminar" }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Error al eliminar"); return; }
      onRefresh();
    } finally { setDeletingId(null); }
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const filtered = inscripciones.filter((i) => {
    if (filters.campeonato_id && i.campeonato_id !== filters.campeonato_id) return false;
    if (filters.categoria && i.categoria !== filters.categoria) return false;
    if (filters.estado_pago && estadoVisualInscripcion(i.estado_pago) !== filters.estado_pago) return false;
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
      const res = await fetch(`/api/admin/campeonatos/inscripciones/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "cancelar" }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || "Error al cancelar"); return; }
      onRefresh();
    } finally { setCancellingId(null); }
  };

  // ── Edit state ───────────────────────────────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Omit<Partial<Inscripcion>, "monto"> & { monto?: string }>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState("");

  const startEdit = (i: Inscripcion) => {
    setEditId(i.id);
    setEditForm({
      nombre: i.nombre, apellido: i.apellido, telefono: i.telefono,
      dni: i.dni, instagram: i.instagram || "", escuderia_favorita: i.escuderia_favorita,
      categoria: i.categoria || "", estado_pago: i.estado_pago,
      monto: String(i.monto), metodo_pago: i.metodo_pago || "",
    });
    setEditMsg("");
  };

  const cancelEdit = () => { setEditId(null); setEditForm({}); setEditMsg(""); };

  const submitEdit = async () => {
    if (!editId) return;
    setEditSaving(true); setEditMsg("");
    try {
      const res = await fetch(`/api/admin/campeonatos/inscripciones/${editId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          monto: editForm.monto ? Number(editForm.monto) : undefined,
          instagram: editForm.instagram || null,
          categoria: editForm.categoria || null,
          metodo_pago: editForm.metodo_pago || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); setEditMsg(d.error || "Error al guardar"); return; }
      cancelEdit(); onRefresh();
    } finally { setEditSaving(false); }
  };

  const colCount = 12; // siempre 12 con acciones

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-black text-white">Inscripciones</h2>
        {!showForm && !editId && (
          <button onClick={() => setShowForm(true)} className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-500">
            + Nueva
          </button>
        )}
      </div>

      {/* ── Formulario nueva inscripción ── */}
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
            <Field label="Categoría">
              <select className={sel} value={form.categoria} onChange={(e) => set("categoria", e.target.value)}>
                <option value="">Sin asignar</option>
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

      {/* ── Formulario editar inscripción ── */}
      {editId && (
        <div className="rounded-2xl border border-blue-500/30 bg-blue-900/10 p-6 space-y-4">
          <h3 className="font-black text-white">Editar inscripción</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Nombre"><input className={inp} value={editForm.nombre || ""} onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))} /></Field>
            <Field label="Apellido"><input className={inp} value={editForm.apellido || ""} onChange={(e) => setEditForm((f) => ({ ...f, apellido: e.target.value }))} /></Field>
            <Field label="Teléfono"><input className={inp} value={editForm.telefono || ""} onChange={(e) => setEditForm((f) => ({ ...f, telefono: e.target.value }))} /></Field>
            <Field label="DNI"><input className={inp} value={editForm.dni || ""} onChange={(e) => setEditForm((f) => ({ ...f, dni: e.target.value }))} /></Field>
            <Field label="Instagram"><input className={inp} value={editForm.instagram || ""} onChange={(e) => setEditForm((f) => ({ ...f, instagram: e.target.value }))} placeholder="@usuario" /></Field>
            <Field label="Escudería">
              <select className={sel} value={editForm.escuderia_favorita || ""} onChange={(e) => setEditForm((f) => ({ ...f, escuderia_favorita: e.target.value }))}>
                <option value="">Seleccionar...</option>
                {ESCUDERIAS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
            <Field label="Categoría">
              <select className={sel} value={editForm.categoria || ""} onChange={(e) => setEditForm((f) => ({ ...f, categoria: e.target.value }))}>
                <option value="">Sin asignar</option>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Estado">
              <select
                className={sel}
                value={editForm.estado_pago ? estadoVisualInscripcion(editForm.estado_pago) : ""}
                onChange={(e) => {
                  const grupo = e.target.value;
                  const real =
                    grupo === "pagado"
                      ? "pagado"
                      : grupo === "cancelado"
                      ? "cancelado"
                      : "pendiente_pago_stand";
                  setEditForm((f) => ({ ...f, estado_pago: real }));
                }}
              >
                <option value="pagado">Pagado</option>
                <option value="pendiente">Pendiente</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </Field>
            <Field label="Monto"><input type="number" className={inp} value={editForm.monto || ""} onChange={(e) => setEditForm((f) => ({ ...f, monto: e.target.value }))} /></Field>
            <Field label="Método de pago">
              <select className={sel} value={editForm.metodo_pago || ""} onChange={(e) => setEditForm((f) => ({ ...f, metodo_pago: e.target.value }))}>
                <option value="">Sin especificar</option>
                <option value="mercadopago">Mercado Pago</option>
                <option value="stand">Stand</option>
                {METODOS_PAGO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          {editMsg && <p className="text-sm font-bold text-red-400">{editMsg}</p>}
          <div className="flex gap-3">
            <button onClick={submitEdit} disabled={editSaving} className="rounded-xl bg-blue-600 px-6 py-2 font-bold text-white hover:bg-blue-500 disabled:opacity-50">{editSaving ? "Guardando..." : "Guardar cambios"}</button>
            <button onClick={cancelEdit} className="rounded-xl bg-zinc-800 px-6 py-2 font-bold text-white hover:bg-zinc-700">Cancelar</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <input className={`${inp} flex-1 min-w-[140px]`} placeholder="Nombre, DNI o teléfono..." value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        <select className={`${sel} min-w-[160px]`} value={filters.campeonato_id} onChange={(e) => setFilters((f) => ({ ...f, campeonato_id: e.target.value }))}><option value="">Todos los campeonatos</option>{campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <select className={`${sel} min-w-[130px]`} value={filters.categoria} onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value }))}><option value="">Todas las cat.</option>{CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className={`${sel} min-w-[160px]`} value={filters.estado_pago} onChange={(e) => setFilters((f) => ({ ...f, estado_pago: e.target.value }))}>
          <option value="">Todos los estados</option>
          <option value="pagado">Pagado</option>
          <option value="pendiente">Pendiente</option>
          <option value="cancelado">Cancelado</option>
        </select>
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
              {["Nombre", "DNI", "Tel", "Instagram", "Escudería", "Cat", "Campeonato", "Monto", "Estado", "Fecha", "Editar"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-bold uppercase text-xs">{h}</th>
              ))}
              {role === "admin" && <th className="px-4 py-3 text-left font-bold uppercase text-xs">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.length === 0 && <tr><td colSpan={colCount} className="px-4 py-8 text-center text-zinc-500">Sin inscripciones</td></tr>}
            {filtered.map((i) => (
              <tr key={i.id} className={`transition-colors ${editId === i.id ? "bg-blue-900/10" : "bg-black hover:bg-white/[0.02]"}`}>
                <td className="px-4 py-3 font-bold text-white">{i.nombre_completo}</td>
                <td className="px-4 py-3 text-zinc-400">{i.dni}</td>
                <td className="px-4 py-3 text-zinc-400">{i.telefono}</td>
                <td className="px-4 py-3 text-zinc-400">{i.instagram || "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{i.escuderia_favorita}</td>
                <td className="px-4 py-3">{i.categoria ? <Badge v={i.categoria} /> : <span className="text-zinc-600 text-xs italic">sin asignar</span>}</td>
                <td className="px-4 py-3 text-zinc-400">{i.campeonatos?.nombre || "—"}</td>
                <td className="px-4 py-3 font-bold text-white">
                  {formatoDinero(i.monto)}
                  {i.metodo_pago && <span className="ml-1 text-xs text-zinc-500">({i.metodo_pago})</span>}
                </td>
                <td className="px-4 py-3"><BadgeInscripcion estado={i.estado_pago} /></td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{i.created_at?.slice(0, 10)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => editId === i.id ? cancelEdit() : startEdit(i)}
                    className="rounded-lg bg-zinc-800 px-3 py-1 text-xs font-bold text-blue-400 hover:bg-zinc-700"
                  >
                    {editId === i.id ? "Cerrar" : "Editar"}
                  </button>
                </td>
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
                    <button
                      onClick={() => eliminarInscripcion(i.id)}
                      disabled={deletingId === i.id}
                      className="ml-1 rounded-lg bg-red-900/40 px-3 py-1 text-xs font-bold text-red-300 hover:bg-red-900 disabled:opacity-50"
                    >
                      {deletingId === i.id ? "..." : "Eliminar"}
                    </button>
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

// ─── Tab Fechas / Calendario ────────────────────────────────────────────────

type Fecha = {
  id: string;
  campeonato_id: string;
  numero_fecha: number;
  nombre: string | null;
  circuito: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado: string;
  cerrado_at: string | null;
  cerrado_por: string | null;
  observaciones: string | null;
};

type PenalizacionRow = {
  id: string;
  categoria: string;
  fecha_origen_id: string;
  fecha_destino_id: string;
  piloto_key: string;
  inscripcion_id: string | null;
  piloto_nombre: string | null;
  posicion: number;
  penalizacion_ms: number;
};

const blankFecha = { numero_fecha: "", nombre: "", circuito: "", fecha_inicio: "", fecha_fin: "", observaciones: "" };

function TabFechas({ campeonatos, role }: { campeonatos: Campeonato[]; role: string | null }) {
  const esAdmin = role === "admin";
  const [campId, setCampId] = useState("");
  const [fechas, setFechas] = useState<Fecha[]>([]);
  const [penal, setPenal] = useState<PenalizacionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState(blankFecha);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(blankFecha);
  const [closingId, setClosingId] = useState<string | null>(null);

  useEffect(() => {
    if (!campId && campeonatos.length > 0) setCampId(campeonatos[0].id);
  }, [campeonatos, campId]);

  const cargar = useCallback(async (cid: string) => {
    if (!cid) { setFechas([]); setPenal([]); return; }
    setLoading(true);
    try {
      const [f, p] = await Promise.all([
        fetch(`/api/admin/campeonatos/fechas?campeonato_id=${cid}`).then((r) => r.json()),
        fetch(`/api/admin/campeonatos/penalizaciones?campeonato_id=${cid}`).then((r) => r.json()),
      ]);
      setFechas(Array.isArray(f) ? f : []);
      setPenal(Array.isArray(p) ? p : []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(campId); }, [campId, cargar]);

  const nombreFecha = (id: string | null) => {
    const f = fechas.find((x) => x.id === id);
    return f ? `F${f.numero_fecha}${f.nombre ? " · " + f.nombre : ""}` : "—";
  };

  async function crear() {
    setMsg("");
    const n = Number(form.numero_fecha);
    if (!Number.isInteger(n) || n < 1) { setMsg("El número de fecha es obligatorio"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/campeonatos/fechas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campeonato_id: campId, numero_fecha: n, nombre: form.nombre || null, circuito: form.circuito || null, fecha_inicio: form.fecha_inicio || null, fecha_fin: form.fecha_fin || null, observaciones: form.observaciones || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(d.error || "Error al crear"); return; }
      setForm(blankFecha);
      await cargar(campId);
    } catch { setMsg("Error de red"); } finally { setSaving(false); }
  }

  function startEdit(f: Fecha) {
    setEditId(f.id);
    setEditForm({ numero_fecha: String(f.numero_fecha), nombre: f.nombre || "", circuito: f.circuito || "", fecha_inicio: f.fecha_inicio || "", fecha_fin: f.fecha_fin || "", observaciones: f.observaciones || "" });
  }

  async function guardarEdit() {
    if (!editId) return;
    setMsg("");
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/campeonatos/fechas/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero_fecha: Number(editForm.numero_fecha), nombre: editForm.nombre || null, circuito: editForm.circuito || null, fecha_inicio: editForm.fecha_inicio || null, fecha_fin: editForm.fecha_fin || null, observaciones: editForm.observaciones || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(d.error || "Error al guardar"); return; }
      setEditId(null);
      await cargar(campId);
    } catch { setMsg("Error de red"); } finally { setSaving(false); }
  }

  async function cerrar(f: Fecha) {
    if (!window.confirm("Esta acción cerrará la fecha y generará penalizaciones para la siguiente carrera. No se podrán cargar nuevos tiempos normales en esta fecha.\n\n¿Confirmás cerrar la fecha?")) return;
    setClosingId(f.id);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/campeonatos/fechas/${f.id}/cerrar`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "Error al cerrar"); return; }
      setMsg(d.aviso ? `Fecha cerrada. ${d.aviso}` : `Fecha cerrada. Penalizaciones generadas: ${d.penalizaciones_generadas ?? 0}.`);
      await cargar(campId);
    } catch { setMsg("Error de red"); } finally { setClosingId(null); }
  }

  async function reabrir(f: Fecha) {
    if (!window.confirm("Reabrir esta fecha permitirá cargar nuevos tiempos nuevamente. Las penalizaciones generadas hacia la siguiente fecha se mantienen, salvo que el sistema indique lo contrario.\n\n¿Confirmás reabrir la fecha?")) return;
    setClosingId(f.id);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/campeonatos/fechas/${f.id}/reabrir`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "Error al reabrir"); return; }
      setMsg(d.mensaje || "Fecha reabierta.");
      await cargar(campId);
    } catch { setMsg("Error de red"); } finally { setClosingId(null); }
  }

  async function precargar() {
    if (!campId) return;
    if (!window.confirm("Se crearán las fechas 1 a 10 que falten para este campeonato (no duplica las existentes). ¿Confirmás?")) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/campeonatos/fechas/precargar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campeonato_id: campId, total: 10 }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "Error al precargar"); return; }
      setMsg(d.mensaje || "Calendario precargado.");
      await cargar(campId);
    } catch { setMsg("Error de red"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Field label="Campeonato">
          <select className={`${sel} min-w-[200px]`} value={campId} onChange={(e) => { setCampId(e.target.value); setEditId(null); setMsg(""); }}>
            <option value="">Seleccionar...</option>
            {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Field>
      </div>

      {msg && <p className="text-sm font-bold text-amber-300">{msg}</p>}

      {campId && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <h3 className="font-black text-white">Nueva fecha / semana</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="N° de fecha *"><input type="number" className={inp} value={form.numero_fecha} onChange={(e) => setForm((f) => ({ ...f, numero_fecha: e.target.value }))} /></Field>
            <Field label="Nombre visible"><input className={inp} value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Fecha 1" /></Field>
            <Field label="Circuito"><input className={inp} value={form.circuito} onChange={(e) => setForm((f) => ({ ...f, circuito: e.target.value }))} placeholder="Spa" /></Field>
            <Field label="Desde"><input type="date" className={inp} value={form.fecha_inicio} onChange={(e) => setForm((f) => ({ ...f, fecha_inicio: e.target.value }))} /></Field>
            <Field label="Hasta"><input type="date" className={inp} value={form.fecha_fin} onChange={(e) => setForm((f) => ({ ...f, fecha_fin: e.target.value }))} /></Field>
            <Field label="Observaciones"><input className={inp} value={form.observaciones} onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))} /></Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={crear} disabled={saving} className="rounded-xl bg-red-600 px-6 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50">{saving ? "Guardando..." : "Crear fecha"}</button>
            {esAdmin && <button onClick={precargar} disabled={saving} className="rounded-xl bg-zinc-700 px-6 py-2 font-bold text-white hover:bg-zinc-600 disabled:opacity-50">Precargar 10 fechas</button>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-zinc-500">Cargando...</div>
      ) : (
        <div className="space-y-3">
          {fechas.length === 0 && campId && <p className="text-zinc-500 text-sm">Este campeonato todavía no tiene fechas.</p>}
          {fechas.map((f) => (
            <div key={f.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              {editId === f.id ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Field label="N° de fecha"><input type="number" className={inp} value={editForm.numero_fecha} onChange={(e) => setEditForm((x) => ({ ...x, numero_fecha: e.target.value }))} /></Field>
                    <Field label="Nombre"><input className={inp} value={editForm.nombre} onChange={(e) => setEditForm((x) => ({ ...x, nombre: e.target.value }))} /></Field>
                    <Field label="Circuito"><input className={inp} value={editForm.circuito} onChange={(e) => setEditForm((x) => ({ ...x, circuito: e.target.value }))} /></Field>
                    <Field label="Desde"><input type="date" className={inp} value={editForm.fecha_inicio} onChange={(e) => setEditForm((x) => ({ ...x, fecha_inicio: e.target.value }))} /></Field>
                    <Field label="Hasta"><input type="date" className={inp} value={editForm.fecha_fin} onChange={(e) => setEditForm((x) => ({ ...x, fecha_fin: e.target.value }))} /></Field>
                    <Field label="Observaciones"><input className={inp} value={editForm.observaciones} onChange={(e) => setEditForm((x) => ({ ...x, observaciones: e.target.value }))} /></Field>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={guardarEdit} disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-500 disabled:opacity-50">{saving ? "..." : "Guardar"}</button>
                    <button onClick={() => setEditId(null)} className="rounded-xl bg-zinc-800 px-5 py-2 font-bold text-white hover:bg-zinc-700">Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-white">Fecha {f.numero_fecha}{f.nombre ? ` · ${f.nombre}` : ""}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-black uppercase ${f.estado === "cerrada" ? "bg-red-500/20 text-red-300" : "bg-green-500/20 text-green-300"}`}>{f.estado}</span>
                    </div>
                    <p className="text-sm text-zinc-400 mt-1">
                      {f.circuito ? `Circuito: ${f.circuito}` : "Sin circuito"}
                      {(f.fecha_inicio || f.fecha_fin) ? ` · ${f.fecha_inicio || "?"} → ${f.fecha_fin || "?"}` : ""}
                      {f.estado === "cerrada" && f.cerrado_at ? ` · cerrada ${f.cerrado_at.slice(0, 10)}${f.cerrado_por ? ` por ${f.cerrado_por}` : ""}` : ""}
                    </p>
                    {f.observaciones && <p className="text-xs text-zinc-500 mt-1">{f.observaciones}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {f.estado === "abierta" && <button onClick={() => startEdit(f)} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-700">Editar</button>}
                    {esAdmin && f.estado === "abierta" && (
                      <button onClick={() => cerrar(f)} disabled={closingId === f.id} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50">{closingId === f.id ? "Cerrando..." : "Cerrar fecha"}</button>
                    )}
                    {esAdmin && f.estado === "cerrada" && (
                      <button onClick={() => reabrir(f)} disabled={closingId === f.id} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50">{closingId === f.id ? "..." : "Reabrir fecha"}</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {penal.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="font-black text-white mb-3">Penalizaciones generadas</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-zinc-400">
                <tr>{["Categoría", "Puesto", "Piloto", "Penalización", "Origen", "Destino"].map((h) => <th key={h} className="px-3 py-2 text-left font-bold uppercase text-xs">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {penal.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2"><Badge v={p.categoria} /></td>
                    <td className="px-3 py-2 font-bold text-white">{p.posicion}°</td>
                    <td className="px-3 py-2 text-zinc-300">{p.piloto_nombre || "—"}</td>
                    <td className="px-3 py-2 font-bold text-amber-300">{formatPenalizacion(p.penalizacion_ms)}</td>
                    <td className="px-3 py-2 text-zinc-400">{nombreFecha(p.fecha_origen_id)}</td>
                    <td className="px-3 py-2 text-zinc-400">{nombreFecha(p.fecha_destino_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "resultados" | "fechas" | "campeonatos" | "sorteos" | "inscripciones";
const ALL_TABS: { id: Tab; label: string; adminOnly: boolean }[] = [
  { id: "resultados", label: "Resultados", adminOnly: false },
  { id: "fechas", label: "Fechas", adminOnly: true },
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
  // Resultados: por defecto solo el día de hoy (no cargar todo el histórico)
  const [rangoModo, setRangoModo] = useState<RangoModo>("hoy");
  const [rangoDesde, setRangoDesde] = useState(hoy());
  const [rangoHasta, setRangoHasta] = useState(hoy());
  const { desde: regDesde, hasta: regHasta } = rangoDeFechas(rangoModo, rangoDesde, rangoHasta);

  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then((d) => setRole(d.role)).catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [camRes, regRes, insRes, sorRes] = await Promise.all([
        fetch("/api/admin/campeonatos").then((r) => r.json()),
        fetch(`/api/admin/campeonatos/registros?desde=${regDesde}&hasta=${regHasta}`).then((r) => r.json()),
        fetch("/api/admin/campeonatos/inscripciones").then((r) => r.json()),
        fetch("/api/admin/sorteos").then((r) => r.json()),
      ]);
      setCampeonatos(Array.isArray(camRes) ? camRes : []);
      setRegistros(Array.isArray(regRes) ? regRes : []);
      setInscripciones(Array.isArray(insRes) ? insRes : []);
      setSorteos(Array.isArray(sorRes) ? sorRes : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [regDesde, regHasta]);

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
          {tab === "resultados" && <TabResultados campeonatos={campeonatos} registros={registros} rangoModo={rangoModo} setRangoModo={setRangoModo} rangoDesde={rangoDesde} setRangoDesde={setRangoDesde} rangoHasta={rangoHasta} setRangoHasta={setRangoHasta} onRefresh={fetchAll} />}
          {tab === "fechas" && role === "admin" && <TabFechas campeonatos={campeonatos} role={role} />}
          {tab === "campeonatos" && role === "admin" && <TabCampeonatos campeonatos={campeonatos} onRefresh={fetchAll} />}
          {tab === "sorteos" && role === "admin" && <TabSorteos sorteos={sorteos} onRefresh={fetchAll} />}
          {tab === "inscripciones" && <TabInscripciones inscripciones={inscripciones} campeonatos={campeonatos} role={role} onRefresh={fetchAll} />}
        </>
      )}
    </div>
  );
}

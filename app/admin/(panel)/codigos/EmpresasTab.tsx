"use client";

import { useCallback, useEffect, useState } from "react";
import { generarInformePDF, generarInformeExcel, exportarCodigosExcel, type InformeData } from "./empresasInforme";

type Campania = {
  id: string; empresa: string; nombre_campania: string; modalidad: string;
  cantidad_contratada: number; duracion_minutos: number; usos_por_codigo: number;
  precio_neto: number; iva_porcentaje: number; precio_total?: number; neto?: number; iva?: number; total?: number;
  fecha_pago: string | null; estado_pago: string; fecha_inicio: string | null; fecha_vencimiento: string | null;
  estado: string; estado_efectivo?: string; observaciones: string | null; codigos_generados: boolean;
  contacto_nombre?: string | null; contacto_telefono?: string | null; contacto_email?: string | null; cuit?: string | null;
  generados?: number; utilizados?: number;
};
type Codigo = { id: string; codigo: string; estado: string; estado_efectivo?: string; usos_actuales: number; usos_maximos: number; created_at: string };
type Uso = { id: string; codigo_id: string; beneficiario_nombre: string | null; beneficiario_apellido: string | null; beneficiario_telefono: string | null; beneficiario_email: string | null; reserva_id: number | null; estado: string; created_at: string };
type Detalle = { campania: Campania; metricas: Record<string, number | string>; codigos: Codigo[]; usos: Uso[] };

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-AR")}`;
const inp = "w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-red-500";
const ESTADOS_CAMP = ["borrador", "pendiente_pago", "programada", "activa", "finalizada", "cancelada"];

const BLANK = {
  empresa: "", nombre_campania: "", contacto_nombre: "", contacto_telefono: "", contacto_email: "", cuit: "",
  modalidad: "unica", cantidad_contratada: "25", duracion_minutos: "15", usos_por_codigo: "1",
  precio_neto: "0", iva_porcentaje: "21", fecha_pago: "", estado_pago: "pendiente",
  fecha_inicio: "", estado: "borrador", observaciones: "",
};

function badge(estado: string) {
  const m: Record<string, string> = {
    activa: "bg-green-500/20 text-green-400", programada: "bg-blue-500/20 text-blue-400",
    pendiente_pago: "bg-amber-500/20 text-amber-300", vencida: "bg-zinc-600/40 text-zinc-300",
    finalizada: "bg-zinc-700/50 text-zinc-400", cancelada: "bg-red-500/20 text-red-400", borrador: "bg-zinc-700/50 text-zinc-400",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${m[estado] ?? "bg-zinc-700"}`}>{estado.replace("_", " ")}</span>;
}

// Modal de alta/edición a NIVEL MÓDULO (identidad estable → los inputs no pierden
// el foco al tipear, a diferencia de un componente anidado en el render).
function CampaniaFormModal({ form, set, editId, msg, busy, onGuardar, onClose }: {
  form: typeof BLANK; set: (k: string, v: string) => void; editId: string | null;
  msg: string; busy: boolean; onGuardar: () => void; onClose: () => void;
}) {
  const dias = form.modalidad === "mensual" ? 30 : 60;
  let vencimiento = "—";
  if (form.fecha_inicio) { const d = new Date(form.fecha_inicio + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + dias); vencimiento = d.toISOString().slice(0, 10); }
  const total = (Number(form.precio_neto) || 0) * (1 + (Number(form.iva_porcentaje) || 0) / 100);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-white">{editId ? "Editar" : "Nueva"} campaña</h3>
          <button onClick={onClose} className="text-2xl leading-none text-zinc-500 hover:text-white">×</button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-300">Empresa *<input className={inp} value={form.empresa} onChange={(e) => set("empresa", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Campaña *<input className={inp} value={form.nombre_campania} onChange={(e) => set("nombre_campania", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Contacto<input className={inp} value={form.contacto_nombre} onChange={(e) => set("contacto_nombre", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Teléfono<input className={inp} value={form.contacto_telefono} onChange={(e) => set("contacto_telefono", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Email<input className={inp} value={form.contacto_email} onChange={(e) => set("contacto_email", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">CUIT<input className={inp} value={form.cuit} onChange={(e) => set("cuit", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Modalidad
            <select className={inp} value={form.modalidad} onChange={(e) => set("modalidad", e.target.value)}>
              <option value="unica">Compra única (60 días)</option><option value="mensual">Pack mensual (30 días)</option>
            </select>
          </label>
          <label className="text-sm text-zinc-300">Cantidad contratada<input type="number" className={inp} value={form.cantidad_contratada} onChange={(e) => set("cantidad_contratada", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Duración por experiencia (min)<input type="number" className={inp} value={form.duracion_minutos} onChange={(e) => set("duracion_minutos", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Usos por código<input type="number" className={inp} value={form.usos_por_codigo} onChange={(e) => set("usos_por_codigo", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Precio neto<input type="number" className={inp} value={form.precio_neto} onChange={(e) => set("precio_neto", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">IVA %<input type="number" className={inp} value={form.iva_porcentaje} onChange={(e) => set("iva_porcentaje", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Fecha de pago<input type="date" className={inp} value={form.fecha_pago} onChange={(e) => set("fecha_pago", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Estado de pago
            <select className={inp} value={form.estado_pago} onChange={(e) => set("estado_pago", e.target.value)}><option value="pendiente">Pendiente</option><option value="pagado">Pagado</option></select>
          </label>
          <label className="text-sm text-zinc-300">Fecha de inicio<input type="date" className={inp} value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Estado
            <select className={inp} value={form.estado} onChange={(e) => set("estado", e.target.value)}>{ESTADOS_CAMP.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </label>
        </div>
        <label className="mt-3 block text-sm text-zinc-300">Observaciones<textarea className={inp} rows={2} value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)} /></label>
        <p className="mt-2 text-xs text-zinc-500">Vencimiento estimado: <b className="text-white">{vencimiento}</b> · Total con IVA: <b className="text-white">{money(total)}</b></p>
        {msg && <p className="mt-2 text-sm text-red-400">{msg}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onGuardar} disabled={busy} className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50">{busy ? "Guardando…" : editId ? "Actualizar" : "Crear"}</button>
          <button onClick={onClose} className="rounded-xl bg-zinc-800 px-5 py-2 font-bold text-white hover:bg-zinc-700">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export default function EmpresasTab() {
  const [campanias, setCampanias] = useState<Campania[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [sel, setSel] = useState<Detalle | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true); setMsg("");
    try {
      const url = `/api/admin/empresas/campanias?${new URLSearchParams({ ...(q ? { q } : {}), ...(filtroEstado ? { estado: filtroEstado } : {}) })}`;
      const res = await fetch(url, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Error"); setCampanias([]); }
      else setCampanias(d.campanias || []);
    } catch { setMsg("Error de conexión"); }
    finally { setLoading(false); }
  }, [q, filtroEstado]);
  useEffect(() => { cargar(); }, [cargar]);

  const abrirDetalle = async (id: string) => {
    setMsg("");
    const res = await fetch(`/api/admin/empresas/campanias/${id}`, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Error"); return; }
    setSel(d);
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const abrirNueva = () => { setEditId(null); setForm(BLANK); setShowForm(true); };
  const abrirEditar = (c: Campania) => {
    setEditId(c.id);
    setForm({
      empresa: c.empresa, nombre_campania: c.nombre_campania, contacto_nombre: c.contacto_nombre || "",
      contacto_telefono: c.contacto_telefono || "", contacto_email: c.contacto_email || "", cuit: c.cuit || "",
      modalidad: c.modalidad, cantidad_contratada: String(c.cantidad_contratada), duracion_minutos: String(c.duracion_minutos),
      usos_por_codigo: String(c.usos_por_codigo), precio_neto: String(c.precio_neto), iva_porcentaje: String(c.iva_porcentaje),
      fecha_pago: c.fecha_pago || "", estado_pago: c.estado_pago, fecha_inicio: c.fecha_inicio || "",
      estado: c.estado, observaciones: c.observaciones || "",
    });
    setShowForm(true);
  };

  const guardar = async () => {
    setBusy(true); setMsg("");
    try {
      const url = editId ? `/api/admin/empresas/campanias/${editId}` : "/api/admin/empresas/campanias";
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          cantidad_contratada: Number(form.cantidad_contratada), duracion_minutos: Number(form.duracion_minutos),
          usos_por_codigo: Number(form.usos_por_codigo), precio_neto: Number(form.precio_neto), iva_porcentaje: Number(form.iva_porcentaje),
          fecha_pago: form.fecha_pago || null, fecha_inicio: form.fecha_inicio || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Error"); return; }
      setShowForm(false); await cargar();
    } finally { setBusy(false); }
  };

  const accionDetalle = async (path: string, method = "POST") => {
    if (!sel) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/admin/empresas/campanias/${sel.campania.id}${path}`, { method });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Error"); return; }
      await abrirDetalle(sel.campania.id); await cargar();
    } finally { setBusy(false); }
  };

  const informe = async (tipo: "parcial" | "definitivo", formato: "pdf" | "excel") => {
    if (!sel) return;
    if (tipo === "definitivo" && (sel.metricas.estado === "activa" || sel.metricas.estado === "programada")) {
      if (!confirm("La campaña todavía no está finalizada. ¿Generar el informe DEFINITIVO igual?")) return;
    }
    const res = await fetch(`/api/admin/empresas/campanias/${sel.campania.id}/informe?tipo=${tipo}`, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Error"); return; }
    if (formato === "pdf") generarInformePDF(d as InformeData); else generarInformeExcel(d as InformeData);
  };

  // ── DETALLE ──
  if (sel) {
    const c = sel.campania; const m = sel.metricas;
    return (
      <div className="space-y-4">
        <button onClick={() => setSel(null)} className="text-sm text-zinc-400 hover:text-white">← Volver a campañas</button>
        {msg && <p className="rounded-xl border border-red-500/30 bg-red-900/20 px-4 py-2 text-sm text-red-300">{msg}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-black text-white">{c.empresa} — {c.nombre_campania}</h3>
            <p className="text-xs text-zinc-500">{c.modalidad === "mensual" ? "Pack mensual" : "Compra única"} · {c.fecha_inicio || "—"} → {c.fecha_vencimiento || "—"} · {badge(String(m.estado))}</p>
          </div>
          <button onClick={() => abrirEditar(c)} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-700">Editar</button>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["Generados", m.generados], ["Usados", m.utilizados], ["Disponibles", m.disponibles],
            ["Vencidos", m.vencidos], ["% uso", `${m.pctUtilizacion}%`], ["Restantes", m.turnos_restantes],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
              <p className="text-lg font-black text-white">{String(val)}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-400">
          Contratación: <b className="text-white">{money(c.neto ?? c.precio_neto)}</b> neto · IVA {money(c.iva ?? 0)} · Total <b className="text-white">{money(c.total ?? c.precio_total ?? 0)}</b> · Pago: {c.estado_pago}
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap gap-2">
          {!c.codigos_generados && (
            <button onClick={() => { if (confirm(`¿Generar ${c.cantidad_contratada} códigos?`)) accionDetalle("/codigos"); }} disabled={busy}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50">Generar {c.cantidad_contratada} códigos</button>
          )}
          {c.codigos_generados && (
            <button onClick={() => exportarCodigosExcel(c, sel.codigos)} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-700">Descargar códigos Excel</button>
          )}
          <span className="mx-1 h-8 w-px bg-white/10" />
          <button onClick={() => informe("parcial", "pdf")} className="rounded-xl border border-white/15 px-3 py-2 text-sm font-bold text-zinc-300 hover:text-white">Informe parcial PDF</button>
          <button onClick={() => informe("parcial", "excel")} className="rounded-xl border border-white/15 px-3 py-2 text-sm font-bold text-zinc-300 hover:text-white">Parcial Excel</button>
          <button onClick={() => informe("definitivo", "pdf")} className="rounded-xl border border-red-500/40 px-3 py-2 text-sm font-bold text-red-300 hover:bg-red-500/10">Definitivo PDF</button>
          <button onClick={() => informe("definitivo", "excel")} className="rounded-xl border border-red-500/40 px-3 py-2 text-sm font-bold text-red-300 hover:bg-red-500/10">Definitivo Excel</button>
        </div>

        {/* Códigos */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="mb-2 font-black text-white">Códigos ({sel.codigos.length})</h4>
          {sel.codigos.length === 0 ? <p className="text-sm text-zinc-500">Todavía no se generaron códigos.</p> : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-zinc-500"><tr>{["Código", "Estado", "Usos", ""].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr></thead>
                <tbody>
                  {sel.codigos.map((cod) => (
                    <tr key={cod.id} className="border-t border-white/5">
                      <td className="px-2 py-1 font-mono text-white">{cod.codigo}</td>
                      <td className="px-2 py-1">{badge(cod.estado_efectivo || cod.estado)}</td>
                      <td className="px-2 py-1 text-zinc-400">{cod.usos_actuales}/{cod.usos_maximos}</td>
                      <td className="px-2 py-1"><button onClick={() => navigator.clipboard?.writeText(cod.codigo)} className="text-xs text-red-400 hover:text-red-300">Copiar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Uso / beneficiarios */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="mb-2 font-black text-white">Uso / beneficiarios ({sel.usos.length})</h4>
          {sel.usos.length === 0 ? <p className="text-sm text-zinc-500">Sin canjes todavía.</p> : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-zinc-500"><tr>{["Nombre", "Apellido", "Teléfono", "Fecha", "Estado"].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr></thead>
                <tbody>
                  {sel.usos.map((u) => (
                    <tr key={u.id} className="border-t border-white/5">
                      <td className="px-2 py-1 text-white">{u.beneficiario_nombre || "—"}</td>
                      <td className="px-2 py-1 text-white">{u.beneficiario_apellido || "—"}</td>
                      <td className="px-2 py-1 text-zinc-400">{u.beneficiario_telefono || "—"}</td>
                      <td className="px-2 py-1 text-zinc-400">{String(u.created_at).slice(0, 10)}</td>
                      <td className="px-2 py-1">{badge(u.estado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {showForm && <CampaniaFormModal form={form} set={set} editId={editId} msg={msg} busy={busy} onGuardar={guardar} onClose={() => setShowForm(false)} />}
      </div>
    );
  }


  // ── LISTA ──
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <input className={`${inp} w-56`} placeholder="Buscar empresa/campaña…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={inp} value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            {["activa", "programada", "pendiente_pago", "vencida", "finalizada", "cancelada", "borrador"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={abrirNueva} className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-500">+ Nueva campaña</button>
      </div>
      {msg && <p className="rounded-xl border border-red-500/30 bg-red-900/20 px-4 py-2 text-sm text-red-300">{msg}</p>}
      {loading ? <p className="text-zinc-500">Cargando…</p> : campanias.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-zinc-400">No hay campañas empresariales todavía.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>{["Empresa", "Campaña", "Estado", "Modalidad", "Inicio", "Vence", "Contr.", "Usado", "% uso", "Pago", ""].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {campanias.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-bold text-white">{c.empresa}</td>
                  <td className="px-3 py-2 text-zinc-300">{c.nombre_campania}</td>
                  <td className="px-3 py-2">{badge(c.estado_efectivo || c.estado)}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.modalidad === "mensual" ? "Mensual" : "Única"}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.fecha_inicio || "—"}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.fecha_vencimiento || "—"}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.cantidad_contratada}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.utilizados ?? 0}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.generados ? Math.round(((c.utilizados ?? 0) / c.generados) * 100) : 0}%</td>
                  <td className="px-3 py-2">{c.estado_pago === "pagado" ? <span className="text-green-400">Pagado</span> : <span className="text-amber-300">Pendiente</span>}</td>
                  <td className="px-3 py-2"><button onClick={() => abrirDetalle(c.id)} className="rounded-lg bg-zinc-800 px-3 py-1 text-xs font-bold text-white hover:bg-zinc-700">Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showForm && <CampaniaFormModal form={form} set={set} editId={editId} msg={msg} busy={busy} onGuardar={guardar} onClose={() => setShowForm(false)} />}
    </div>
  );
}

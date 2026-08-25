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
type ReservaLite = { id?: number; fecha?: string; hora?: string; duracion_minutos?: number; simuladores?: string[]; estado?: string; no_show?: boolean };
type Uso = { id: string; codigo_id: string; beneficiario_nombre: string | null; beneficiario_apellido: string | null; beneficiario_telefono: string | null; beneficiario_email: string | null; reserva_id: number | null; estado: string; created_at: string; reserva?: ReservaLite | null };
type Detalle = { campania: Campania; metricas: Record<string, number | string>; codigos: Codigo[]; usos: Uso[]; simuladores?: Array<{ nombre: string; usos: number }> };

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-AR")}`;
const inp = "w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-red-500";

// El estado y el pago NO se editan acá: se derivan / se marcan con acciones explícitas.
const BLANK = {
  empresa: "", nombre_campania: "", contacto_nombre: "", contacto_telefono: "", contacto_email: "", cuit: "",
  modalidad: "unica", cantidad_contratada: "25", duracion_minutos: "15", usos_por_codigo: "1",
  precio_neto: "0", iva_porcentaje: "21", fecha_inicio: "", observaciones: "",
};

function badge(estado: string) {
  const m: Record<string, string> = {
    activa: "bg-green-500/20 text-green-400", programada: "bg-blue-500/20 text-blue-400",
    pendiente_pago: "bg-amber-500/20 text-amber-300", vencida: "bg-zinc-600/40 text-zinc-300",
    finalizada: "bg-zinc-700/50 text-zinc-400", cancelada: "bg-red-500/20 text-red-400", borrador: "bg-zinc-700/50 text-zinc-400",
    no_show: "bg-orange-500/20 text-orange-300", consumido: "bg-green-500/20 text-green-400", utilizado: "bg-green-500/20 text-green-400", disponible: "bg-blue-500/20 text-blue-400",
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
  const neto = Number(form.precio_neto) || 0;
  const ivaMonto = neto * ((Number(form.iva_porcentaje) || 0) / 100);
  const total = neto + ivaMonto;
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
          <label className="text-sm text-zinc-300">Precio neto de la campaña<input type="number" className={inp} value={form.precio_neto} onChange={(e) => set("precio_neto", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">IVA %<input type="number" className={inp} value={form.iva_porcentaje} onChange={(e) => set("iva_porcentaje", e.target.value)} /></label>
          <label className="text-sm text-zinc-300">Fecha de inicio<input type="date" className={inp} value={form.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} /></label>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-bold text-zinc-400">Opciones avanzadas</summary>
          <label className="mt-2 block text-sm text-zinc-300">Usos por código (default 1)<input type="number" className={inp} value={form.usos_por_codigo} onChange={(e) => set("usos_por_codigo", e.target.value)} /></label>
        </details>
        <label className="mt-3 block text-sm text-zinc-300">Observaciones<textarea className={inp} rows={2} value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)} /></label>
        <div className="mt-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400">
          Neto: <b className="text-white">{money(neto)}</b> · IVA ({form.iva_porcentaje || 0}%): <b className="text-white">{money(ivaMonto)}</b> · Total: <b className="text-white">{money(total)}</b>
          <span className="ml-2 text-zinc-500">· Vencimiento estimado: <b className="text-white">{vencimiento}</b></span>
        </div>
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
  const [pago, setPago] = useState<{ fecha_pago: string; medio_pago: string } | null>(null);

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
      fecha_inicio: c.fecha_inicio || "", observaciones: c.observaciones || "",
    });
    setShowForm(true);
  };

  // Acción admin sobre la campaña abierta (marcar pagada, finalizar, cancelar, código, reserva).
  const postAccion = async (body: Record<string, unknown>): Promise<boolean> => {
    if (!sel) return false;
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/admin/empresas/campanias/${sel.campania.id}/acciones`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Error"); return false; }
      await abrirDetalle(sel.campania.id); await cargar();
      return true;
    } finally { setBusy(false); }
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
          fecha_inicio: form.fecha_inicio || null,
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
          {c.estado_pago !== "pagado" && (
            <button onClick={() => setPago({ fecha_pago: new Date().toISOString().slice(0, 10), medio_pago: "transferencia" })} disabled={busy}
              className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-500 disabled:opacity-50">Marcar como pagada</button>
          )}
          {!c.codigos_generados && c.estado_pago === "pagado" && (
            <button onClick={() => { if (confirm(`¿Generar ${c.cantidad_contratada} códigos?`)) accionDetalle("/codigos"); }} disabled={busy}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50">Generar {c.cantidad_contratada} códigos</button>
          )}
          {m.estado !== "finalizada" && m.estado !== "cancelada" && (
            <button onClick={() => { if (confirm("¿Finalizar la campaña?")) postAccion({ accion: "finalizar" }); }} disabled={busy}
              className="rounded-xl border border-white/15 px-3 py-2 text-sm font-bold text-zinc-300 hover:text-white">Finalizar</button>
          )}
          {m.estado !== "cancelada" && (
            <button onClick={() => { if (confirm("¿Cancelar la campaña? Los códigos dejarán de funcionar.")) postAccion({ accion: "cancelar" }); }} disabled={busy}
              className="rounded-xl border border-red-500/40 px-3 py-2 text-sm font-bold text-red-300 hover:bg-red-500/10">Cancelar campaña</button>
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
                      <td className="px-2 py-1">
                        <div className="flex gap-2">
                          <button onClick={() => navigator.clipboard?.writeText(cod.codigo)} className="text-xs text-red-400 hover:text-red-300">Copiar</button>
                          {cod.usos_actuales === 0 && cod.estado === "disponible" && (
                            <button onClick={() => postAccion({ accion: "codigo_estado", codigo_id: cod.id, estado: "bloqueado" })} className="text-xs text-amber-400 hover:text-amber-300">Bloquear</button>
                          )}
                          {cod.estado === "bloqueado" && (
                            <button onClick={() => postAccion({ accion: "codigo_estado", codigo_id: cod.id, estado: "disponible" })} className="text-xs text-green-400 hover:text-green-300">Desbloquear</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Simuladores (de reservas reales) */}
        {sel.simuladores && sel.simuladores.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h4 className="mb-2 font-black text-white">Simuladores utilizados</h4>
            <div className="flex flex-wrap gap-2 text-sm">
              {sel.simuladores.map((s) => (
                <span key={s.nombre} className="rounded-lg bg-black/30 px-3 py-1 text-zinc-300">{s.nombre}: <b className="text-white">{s.usos}</b></span>
              ))}
            </div>
          </div>
        )}

        {/* Uso / Reservas */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="mb-2 font-black text-white">Uso / Reservas ({sel.usos.length})</h4>
          {sel.usos.length === 0 ? <p className="text-sm text-zinc-500">Sin canjes todavía.</p> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-zinc-500"><tr>{["Beneficiario", "Reserva", "Simuladores", "Estado", ""].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr></thead>
                <tbody>
                  {sel.usos.map((u) => {
                    const r = u.reserva;
                    const rActiva = r && r.estado === "activa";
                    return (
                      <tr key={u.id} className="border-t border-white/5">
                        <td className="px-2 py-1 text-white">{u.beneficiario_nombre || "—"} {u.beneficiario_apellido || ""}</td>
                        <td className="px-2 py-1 text-zinc-400">{r ? `${r.fecha} ${r.hora} · ${r.duracion_minutos}m` : "—"}</td>
                        <td className="px-2 py-1 text-zinc-400">{r && Array.isArray(r.simuladores) ? r.simuladores.join(", ") : "—"}</td>
                        <td className="px-2 py-1">
                          {r ? badge(r.no_show ? "no_show" : r.estado || "activa") : badge(u.estado)}
                        </td>
                        <td className="px-2 py-1">
                          {rActiva && u.reserva_id != null && (
                            <div className="flex gap-2">
                              <button onClick={() => { if (confirm("¿Cancelar la reserva? Se libera el turno; podés liberar el código.")) postAccion({ accion: "reserva_cancelar", reserva_id: u.reserva_id, liberar_codigo: confirm("¿Liberar también el código para que se pueda volver a usar?") }); }} className="text-xs text-red-400 hover:text-red-300">Cancelar</button>
                              <button onClick={() => {
                                const f = prompt("Nueva fecha (YYYY-MM-DD):", r?.fecha); if (!f) return;
                                const h = prompt("Nueva hora (HH:MM):", r?.hora); if (!h) return;
                                const s = prompt("Simulador(es), separados por coma:", (r?.simuladores || []).join(", ")); if (!s) return;
                                postAccion({ accion: "reserva_reprogramar", reserva_id: u.reserva_id, fecha: f, hora: h, simuladores: s.split(",").map((x) => x.trim()).filter(Boolean) });
                              }} className="text-xs text-blue-400 hover:text-blue-300">Reprogramar</button>
                              <button onClick={() => postAccion({ accion: "reserva_no_show", reserva_id: u.reserva_id, no_show: !r?.no_show })} className="text-xs text-amber-400 hover:text-amber-300">{r?.no_show ? "Quitar no-show" : "No-show"}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {showForm && <CampaniaFormModal form={form} set={set} editId={editId} msg={msg} busy={busy} onGuardar={guardar} onClose={() => setShowForm(false)} />}

        {/* Modal Marcar pagada: registra fecha + medio + confirma (impacta Finanzas). */}
        {pago && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-6">
              <h3 className="mb-1 text-lg font-black text-white">Marcar como pagada</h3>
              <p className="mb-4 text-xs text-zinc-500">Importe: <b className="text-white">{money(c.total ?? c.precio_total ?? 0)}</b> (neto {money(c.neto ?? c.precio_neto)} + IVA {money(c.iva ?? 0)})</p>
              <label className="block text-sm text-zinc-300">Fecha de pago<input type="date" className={inp} value={pago.fecha_pago} onChange={(e) => setPago({ ...pago, fecha_pago: e.target.value })} /></label>
              <label className="mt-3 block text-sm text-zinc-300">Medio de pago
                <select className={inp} value={pago.medio_pago} onChange={(e) => setPago({ ...pago, medio_pago: e.target.value })}>
                  <option value="transferencia">Transferencia</option><option value="mercadopago">Mercado Pago</option><option value="efectivo">Efectivo</option>
                </select>
              </label>
              {msg && <p className="mt-2 text-sm text-red-400">{msg}</p>}
              <div className="mt-4 flex gap-2">
                <button disabled={busy} onClick={async () => { if (await postAccion({ accion: "marcar_pagada", fecha_pago: pago.fecha_pago, medio_pago: pago.medio_pago })) setPago(null); }}
                  className="rounded-xl bg-green-600 px-5 py-2 font-bold text-white hover:bg-green-500 disabled:opacity-50">Confirmar pago</button>
                <button onClick={() => setPago(null)} className="rounded-xl bg-zinc-800 px-5 py-2 font-bold text-white hover:bg-zinc-700">Cancelar</button>
              </div>
            </div>
          </div>
        )}
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

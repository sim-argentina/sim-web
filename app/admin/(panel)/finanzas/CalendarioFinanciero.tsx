"use client";

// Calendario financiero + Salud financiera (proyección, deudas, recurrencias).
// Capa de futuro del módulo Finanzas: nada de esto toca la caja real hasta
// marcarse como pagado/cobrado y convertirse en movimiento.

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Tipos ────────────────────────────────────────────────────────────────────

type Categoria = { id: string; nombre: string; tipo: string; activa: boolean };

export type EventoFin = {
  id: string;
  fecha: string;
  mes_contable: string;
  tipo: string;
  estado: string;
  descripcion: string;
  categoria_id: string | null;
  monto: number;
  cuenta_estimada: "efectivo" | "mercado_pago";
  probabilidad: number;
  proveedor_cliente: string | null;
  observaciones: string | null;
  es_recurrente: boolean;
  recurrencia_id: string | null;
  deuda_id: string | null;
  cuota_numero: number | null;
  movimiento_id: string | null;
  fecha_real: string | null;
  vencido?: boolean;
};

type Recurrencia = {
  id: string;
  frecuencia: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  cantidad_repeticiones: number | null;
  tipo: string;
  monto: number;
  descripcion: string;
  categoria_id: string | null;
  cuenta_estimada: string;
  probabilidad: number;
  proveedor_cliente: string | null;
  activa: boolean;
  categoria?: { nombre: string } | null;
};

type Deuda = {
  id: string;
  descripcion: string;
  proveedor: string | null;
  monto_total: number;
  cuotas_total: number;
  estado: string;
  pendiente: number;
  pagado: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  cuotas_vencidas: number;
  proxima_cuota: { fecha: string; monto: number } | null;
};

type SaludApi = {
  mes: string;
  hoy: string;
  metricas: Record<string, number | string | null>;
  ventanas: Array<{ dias: number; cobros: number; cobros_ponderados: number; pagos: number; neto: number; neto_ponderado: number; cantidad_eventos: number }>;
  contexto: Record<string, number | boolean | string | null>;
  listas: {
    proximos_pagos: Array<{ id: string; fecha: string; descripcion: string; monto: number; tipo: string }>;
    proximos_cobros: Array<{ id: string; fecha: string; descripcion: string; monto: number; probabilidad: number }>;
    vencidos: Array<{ id: string; fecha: string; descripcion: string; monto: number; tipo: string }>;
  };
};

// ── Utilidades ───────────────────────────────────────────────────────────────

function dinero(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const s = `$${abs.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
  return v < 0 ? `-${s}` : s;
}
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v as number)) return "—";
  return `${((v as number) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
}
function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function labelMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const n = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${n[m - 1]} ${y}`;
}
function diasEnMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function diaSemanaPrimero(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m - 1, 1).getDay(); // 0=domingo
}

const TIPOS_COBRO = ["cobro_futuro", "ingreso_recurrente"];
const TIPO_EVENTO_LABEL: Record<string, string> = {
  cobro_futuro: "Cobro futuro",
  pago_futuro: "Pago futuro",
  deuda: "Deuda",
  cuota_deuda: "Cuota de deuda",
  gasto_fijo: "Gasto fijo",
  ingreso_recurrente: "Ingreso recurrente",
  vencimiento: "Vencimiento",
  compromiso_estimado: "Compromiso estimado",
};
const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  cobrado: "Cobrado",
  pagado: "Pagado",
  vencido: "Vencido",
  cancelado: "Cancelado",
  estimado: "Estimado",
};

const inputCls = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500";
const selCls = "rounded-xl border border-white/15 bg-black px-3 py-2 text-xs font-bold outline-none focus:border-red-500";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{label}</label>{children}</div>);
}
function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-0 md:items-center md:p-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0a0a0a] p-5 md:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase text-red-500">{titulo}</h3>
          <button onClick={onCerrar} className="text-2xl text-white/40 hover:text-white">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function colorEvento(e: EventoFin): string {
  if (e.estado === "cancelado") return "text-white/30";
  if (e.estado === "pagado" || e.estado === "cobrado") return "text-white/40";
  if (e.vencido) return "text-red-500";
  if (e.estado === "estimado") return "text-sky-400";
  return TIPOS_COBRO.includes(e.tipo) ? "text-green-400" : "text-red-400";
}

// ═════════ Formularios ═════════

type EventoForm = {
  id: string | null;
  tipo: string;
  fecha: string;
  descripcion: string;
  monto: string;
  categoria_id: string;
  cuenta_estimada: string;
  estado: string;
  proveedor_cliente: string;
  probabilidad: string;
  observaciones: string;
};
function eventoFormVacio(preset: Partial<EventoForm> = {}): EventoForm {
  return {
    id: null, tipo: "pago_futuro", fecha: hoyLocal(), descripcion: "", monto: "", categoria_id: "",
    cuenta_estimada: "mercado_pago", estado: "pendiente", proveedor_cliente: "", probabilidad: "100", observaciones: "",
    ...preset,
  };
}

type DeudaForm = { descripcion: string; proveedor: string; monto_total: string; cuotas: string; monto_cuota: string; fecha_primera_cuota: string; cuenta_estimada: string; categoria_id: string; observaciones: string };
type RecForm = { id: string | null; tipo: string; frecuencia: string; fecha_inicio: string; fecha_fin: string; cantidad_repeticiones: string; monto: string; descripcion: string; categoria_id: string; cuenta_estimada: string; probabilidad: string; proveedor_cliente: string };

// ═════════ CALENDARIO FINANCIERO (tab) ═════════

export function CalendarioFinanciero({
  mes,
  categorias,
  mostrarAviso,
  refrescarFinanzas,
}: {
  mes: string;
  categorias: Categoria[];
  mostrarAviso: (m: string) => void;
  refrescarFinanzas: () => void;
}) {
  const [eventos, setEventos] = useState<EventoFin[]>([]);
  const [salud, setSalud] = useState<SaludApi | null>(null);
  const [deudas, setDeudas] = useState<Deuda[]>([]);
  const [recurrencias, setRecurrencias] = useState<Recurrencia[]>([]);
  const [diaSel, setDiaSel] = useState<string | null>(null);
  const [vistaLista, setVistaLista] = useState(false);
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState("");

  const [evForm, setEvForm] = useState<EventoForm | null>(null);
  const [deudaForm, setDeudaForm] = useState<DeudaForm | null>(null);
  const [recForm, setRecForm] = useState<RecForm | null>(null);
  const [guardando, setGuardando] = useState(false);

  const hoy = hoyLocal();

  const cargarEventos = useCallback(async () => {
    const r = await fetch(`/api/admin/finanzas/eventos?mes=${mes}`, { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setEventos((d.eventos || []).map((e: EventoFin) => ({ ...e, monto: Number(e.monto) })));
  }, [mes]);
  const cargarSalud = useCallback(async () => {
    const r = await fetch(`/api/admin/finanzas/salud-financiera?mes=${mes}`, { cache: "no-store" });
    const d = await r.json();
    setSalud(r.ok && d.metricas ? d : null);
  }, [mes]);
  const cargarDeudas = useCallback(async () => {
    const r = await fetch("/api/admin/finanzas/deudas", { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setDeudas(d.deudas || []);
  }, []);
  const cargarRecurrencias = useCallback(async () => {
    const r = await fetch("/api/admin/finanzas/recurrencias", { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setRecurrencias(d.recurrencias || []);
  }, []);

  const cargarTodo = useCallback(() => {
    cargarEventos();
    cargarSalud();
    cargarDeudas();
    cargarRecurrencias();
  }, [cargarEventos, cargarSalud, cargarDeudas, cargarRecurrencias]);

  useEffect(() => {
    cargarTodo();
    setDiaSel(null);
  }, [cargarTodo]);

  // Detección mobile → vista lista por defecto
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) setVistaLista(true);
  }, []);

  const filtrados = useMemo(
    () =>
      eventos.filter((e) => {
        if (fTipo && e.tipo !== fTipo) return false;
        if (fEstado) {
          if (fEstado === "vencido") return Boolean(e.vencido);
          if (e.estado !== fEstado) return false;
        }
        return true;
      }),
    [eventos, fTipo, fEstado]
  );

  const porDia = useMemo(() => {
    const acc: Record<string, EventoFin[]> = {};
    for (const e of filtrados) (acc[e.fecha] = acc[e.fecha] || []).push(e);
    return acc;
  }, [filtrados]);

  // Resumen del mes (solo pendientes/estimados)
  const resumenMes = useMemo(() => {
    let cobros = 0, pagos = 0, vencidos = 0;
    for (const e of eventos) {
      if (e.estado !== "pendiente" && e.estado !== "estimado") continue;
      if (TIPOS_COBRO.includes(e.tipo)) cobros += e.monto;
      else pagos += e.monto;
      if (e.vencido) vencidos++;
    }
    return { cobros, pagos, neto: cobros - pagos, vencidos };
  }, [eventos]);

  // ── Acciones ──
  async function guardarEvento() {
    if (!evForm) return;
    setGuardando(true);
    try {
      const payload = {
        tipo: evForm.tipo,
        fecha: evForm.fecha,
        descripcion: evForm.descripcion,
        monto: Number(evForm.monto),
        categoria_id: evForm.categoria_id || null,
        cuenta_estimada: evForm.cuenta_estimada,
        estado: evForm.estado,
        proveedor_cliente: evForm.proveedor_cliente || null,
        probabilidad: TIPOS_COBRO.includes(evForm.tipo) || evForm.tipo === "compromiso_estimado" ? Number(evForm.probabilidad) : 100,
        observaciones: evForm.observaciones || null,
      };
      const url = evForm.id ? `/api/admin/finanzas/eventos/${evForm.id}` : "/api/admin/finanzas/eventos";
      const r = await fetch(url, { method: evForm.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error guardando"); return; }
      setEvForm(null);
      mostrarAviso(evForm.id ? "Evento actualizado" : "Evento creado");
      cargarTodo();
    } finally { setGuardando(false); }
  }

  async function marcarEvento(e: EventoFin, accion: "pagado" | "cobrado", confirmar = false) {
    const crear = confirm(`¿Marcar como ${accion} y crear el movimiento real en Finanzas?\nAceptar = crea movimiento · Cancelar = solo marca el evento`);
    setGuardando(true);
    try {
      const r = await fetch(`/api/admin/finanzas/eventos/${e.id}/marcar-${accion}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crear_movimiento: crear, confirmar_duplicado: confirmar }),
      });
      const d = await r.json();
      if (r.status === 409 && d.requiere_confirmacion) {
        if (confirm(d.error)) { setGuardando(false); await marcarEvento(e, accion, true); }
        return;
      }
      if (!r.ok) { alert(d.error || "Error"); return; }
      setEvForm(null);
      mostrarAviso(crear ? `Evento ${accion} + movimiento real creado` : `Evento marcado como ${accion}`);
      cargarTodo();
      if (crear) refrescarFinanzas();
    } finally { setGuardando(false); }
  }

  async function cancelarEvento(id: string) {
    if (!confirm("¿Cancelar este evento? Deja de impactar la proyección.")) return;
    const r = await fetch(`/api/admin/finanzas/eventos/${id}/cancelar`, { method: "POST" });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Error"); return; }
    setEvForm(null); mostrarAviso("Evento cancelado"); cargarTodo();
  }
  async function eliminarEvento(id: string) {
    if (!confirm("¿Eliminar este evento definitivamente?")) return;
    const r = await fetch(`/api/admin/finanzas/eventos/${id}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Error"); return; }
    setEvForm(null); mostrarAviso("Evento eliminado"); cargarTodo();
  }

  async function guardarDeuda() {
    if (!deudaForm) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/admin/finanzas/deudas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descripcion: deudaForm.descripcion,
          proveedor: deudaForm.proveedor || null,
          monto_total: Number(deudaForm.monto_total),
          cuotas: Number(deudaForm.cuotas) || 1,
          monto_cuota: deudaForm.monto_cuota ? Number(deudaForm.monto_cuota) : null,
          fecha_primera_cuota: deudaForm.fecha_primera_cuota,
          cuenta_estimada: deudaForm.cuenta_estimada,
          categoria_id: deudaForm.categoria_id || null,
          observaciones: deudaForm.observaciones || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error creando deuda"); return; }
      setDeudaForm(null); mostrarAviso(`Deuda creada (${d.cuotas_creadas} cuota/s)`); cargarTodo();
    } finally { setGuardando(false); }
  }
  async function eliminarDeuda(d: Deuda) {
    if (!confirm(`¿Eliminar/cancelar la deuda "${d.descripcion}" y sus cuotas pendientes?`)) return;
    const r = await fetch(`/api/admin/finanzas/deudas/${d.id}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) { alert(j.error || "Error"); return; }
    mostrarAviso(j.eliminada ? "Deuda eliminada" : "Deuda cancelada"); cargarTodo();
  }

  async function guardarRecurrencia() {
    if (!recForm) return;
    setGuardando(true);
    try {
      const payload = {
        tipo: recForm.tipo,
        frecuencia: recForm.frecuencia,
        fecha_inicio: recForm.fecha_inicio,
        fecha_fin: recForm.fecha_fin || null,
        cantidad_repeticiones: recForm.cantidad_repeticiones ? Number(recForm.cantidad_repeticiones) : null,
        monto: Number(recForm.monto),
        descripcion: recForm.descripcion,
        categoria_id: recForm.categoria_id || null,
        cuenta_estimada: recForm.cuenta_estimada,
        probabilidad: Number(recForm.probabilidad) || 100,
        proveedor_cliente: recForm.proveedor_cliente || null,
      };
      const url = recForm.id ? `/api/admin/finanzas/recurrencias/${recForm.id}` : "/api/admin/finanzas/recurrencias";
      const r = await fetch(url, { method: recForm.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error"); return; }
      setRecForm(null);
      mostrarAviso(recForm.id ? `Serie actualizada (${d.ocurrencias_regeneradas} regeneradas)` : `Serie creada (${d.ocurrencias_creadas} ocurrencias)`);
      cargarTodo();
    } finally { setGuardando(false); }
  }
  async function cancelarSerie(id: string) {
    if (!confirm("¿Cancelar toda la serie? Las ocurrencias pendientes se cancelan; lo pagado queda como historial.")) return;
    const r = await fetch(`/api/admin/finanzas/recurrencias/${id}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Error"); return; }
    mostrarAviso("Serie cancelada"); cargarTodo();
  }

  function abrirEvento(e: EventoFin) {
    setEvForm({
      id: e.id, tipo: e.tipo, fecha: e.fecha, descripcion: e.descripcion, monto: String(e.monto),
      categoria_id: e.categoria_id || "", cuenta_estimada: e.cuenta_estimada, estado: e.estado,
      proveedor_cliente: e.proveedor_cliente || "", probabilidad: String(e.probabilidad), observaciones: e.observaciones || "",
    });
  }

  // ── Render calendario ──
  const totalDias = diasEnMes(mes);
  const offset = diaSemanaPrimero(mes);
  const celdas: Array<string | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: totalDias }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`),
  ];

  const eventoEditando = evForm?.id ? eventos.find((x) => x.id === evForm.id) : null;

  return (
    <div className="space-y-6">
      {/* Accesos rápidos + filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setEvForm(eventoFormVacio({ tipo: "cobro_futuro", fecha: diaSel || hoy }))} className="rounded-full border border-green-500/50 px-4 py-2 text-xs font-black uppercase text-green-400 transition hover:bg-green-500/10">+ Cobro futuro</button>
        <button onClick={() => setEvForm(eventoFormVacio({ tipo: "pago_futuro", fecha: diaSel || hoy }))} className="rounded-full border border-red-500/50 px-4 py-2 text-xs font-black uppercase text-red-400 transition hover:bg-red-500/10">+ Pago futuro</button>
        <button onClick={() => setDeudaForm({ descripcion: "", proveedor: "", monto_total: "", cuotas: "1", monto_cuota: "", fecha_primera_cuota: diaSel || hoy, cuenta_estimada: "mercado_pago", categoria_id: "", observaciones: "" })} className="rounded-full border border-amber-500/50 px-4 py-2 text-xs font-black uppercase text-amber-400 transition hover:bg-amber-500/10">+ Deuda</button>
        <button onClick={() => setRecForm({ id: null, tipo: "gasto_fijo", frecuencia: "mensual", fecha_inicio: diaSel || hoy, fecha_fin: "", cantidad_repeticiones: "12", monto: "", descripcion: "", categoria_id: "", cuenta_estimada: "mercado_pago", probabilidad: "100", proveedor_cliente: "" })} className="rounded-full border border-white/20 px-4 py-2 text-xs font-black uppercase text-white/70 transition hover:border-red-500 hover:text-white">+ Recurrente</button>
        <div className="ml-auto flex flex-wrap gap-2">
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={selCls}>
            <option value="">Tipo: todos</option>
            {Object.entries(TIPO_EVENTO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className={selCls}>
            <option value="">Estado: todos</option>
            {Object.entries(ESTADO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={() => setVistaLista(!vistaLista)} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/60 hover:text-white">{vistaLista ? "Ver calendario" : "Ver lista"}</button>
        </div>
      </div>

      {/* Resumen del mes */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-black p-4"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">Cobros esperados</p><p className="mt-1 text-xl font-black text-green-400">{dinero(resumenMes.cobros)}</p></div>
        <div className="rounded-2xl border border-white/10 bg-black p-4"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">Pagos comprometidos</p><p className="mt-1 text-xl font-black text-red-400">{dinero(resumenMes.pagos)}</p></div>
        <div className="rounded-2xl border border-white/10 bg-black p-4"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">Neto proyectado</p><p className={`mt-1 text-xl font-black ${resumenMes.neto >= 0 ? "text-green-400" : "text-red-500"}`}>{dinero(resumenMes.neto)}</p></div>
        <div className="rounded-2xl border border-white/10 bg-black p-4"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">Vencidos</p><p className={`mt-1 text-xl font-black ${resumenMes.vencidos > 0 ? "text-red-500" : "text-white/60"}`}>{resumenMes.vencidos}</p></div>
      </div>

      {/* Calendario / lista */}
      {vistaLista ? (
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <h3 className="mb-3 text-sm font-black uppercase text-white/60">{labelMes(mes)} · lista</h3>
          {filtrados.length === 0 ? <p className="text-sm text-white/40">Sin eventos este mes.</p> : (
            <div className="space-y-1.5">
              {filtrados.map((e) => (
                <button key={e.id} onClick={() => abrirEvento(e)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-left transition hover:bg-white/[0.08]">
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-bold ${colorEvento(e)}`}>{e.fecha.slice(8)}/{e.fecha.slice(5, 7)} · {e.descripcion || TIPO_EVENTO_LABEL[e.tipo]}</p>
                    <p className="text-[10px] uppercase text-white/35">{TIPO_EVENTO_LABEL[e.tipo]} · {e.vencido ? "VENCIDO" : ESTADO_LABEL[e.estado]}{e.probabilidad < 100 ? ` · ${e.probabilidad}%` : ""}{e.movimiento_id ? " · con movimiento" : ""}</p>
                  </div>
                  <span className={`shrink-0 font-black ${colorEvento(e)}`}>{TIPOS_COBRO.includes(e.tipo) ? "+" : "−"}{dinero(e.monto)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <h3 className="mb-3 text-sm font-black uppercase text-white/60">{labelMes(mes)}</h3>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase text-white/30">
            {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => <div key={d} className="pb-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {celdas.map((fecha, i) => {
              if (!fecha) return <div key={`x${i}`} />;
              const evs = porDia[fecha] || [];
              const pend = evs.filter((e) => e.estado === "pendiente" || e.estado === "estimado");
              const cobros = pend.filter((e) => TIPOS_COBRO.includes(e.tipo)).reduce((a, e) => a + e.monto, 0);
              const pagos = pend.filter((e) => !TIPOS_COBRO.includes(e.tipo)).reduce((a, e) => a + e.monto, 0);
              const tieneVencido = evs.some((e) => e.vencido);
              const esHoy = fecha === hoy;
              const sel = fecha === diaSel;
              return (
                <button
                  key={fecha}
                  onClick={() => setDiaSel(sel ? null : fecha)}
                  className={`min-h-[64px] rounded-lg border p-1 text-left align-top transition md:min-h-[76px] ${
                    sel ? "border-red-500 bg-red-950/30" : tieneVencido ? "border-red-500/60 bg-red-950/20" : esHoy ? "border-white/40 bg-white/[0.06]" : "border-white/10 bg-white/[0.02] hover:border-white/30"
                  }`}
                >
                  <p className={`text-[11px] font-black ${esHoy ? "text-red-400" : "text-white/60"}`}>{Number(fecha.slice(8))}</p>
                  {cobros > 0 && <p className="truncate text-[10px] font-bold text-green-400">+{dinero(cobros)}</p>}
                  {pagos > 0 && <p className="truncate text-[10px] font-bold text-red-400">−{dinero(pagos)}</p>}
                  {evs.length > 0 && <p className="text-[9px] text-white/30">{evs.length} ev.{tieneVencido ? " · vencido" : ""}</p>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Panel del día seleccionado */}
      {diaSel && (
        <div className="rounded-2xl border border-red-500/25 bg-red-950/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black uppercase text-red-500">{diaSel.slice(8)}/{diaSel.slice(5, 7)}/{diaSel.slice(0, 4)}</h3>
            <button onClick={() => setEvForm(eventoFormVacio({ fecha: diaSel }))} className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-black uppercase transition hover:bg-red-700">+ Agregar evento</button>
          </div>
          {(porDia[diaSel] || []).length === 0 ? <p className="text-sm text-white/40">Sin eventos este día. Agregá un cobro, pago o deuda.</p> : (
            <>
              <div className="space-y-1.5">
                {(porDia[diaSel] || []).map((e) => (
                  <button key={e.id} onClick={() => abrirEvento(e)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-black px-3 py-2.5 text-left transition hover:bg-white/[0.06]">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-bold ${colorEvento(e)}`}>{e.descripcion || TIPO_EVENTO_LABEL[e.tipo]}</p>
                      <p className="text-[10px] uppercase text-white/35">{TIPO_EVENTO_LABEL[e.tipo]} · {e.vencido ? "VENCIDO" : ESTADO_LABEL[e.estado]}{e.probabilidad < 100 ? ` · ${e.probabilidad}%` : ""}</p>
                    </div>
                    <span className={`shrink-0 font-black ${colorEvento(e)}`}>{TIPOS_COBRO.includes(e.tipo) ? "+" : "−"}{dinero(e.monto)}</span>
                  </button>
                ))}
              </div>
              {(() => {
                const evs = (porDia[diaSel] || []).filter((e) => e.estado === "pendiente" || e.estado === "estimado");
                const c = evs.filter((e) => TIPOS_COBRO.includes(e.tipo)).reduce((a, e) => a + e.monto, 0);
                const p = evs.filter((e) => !TIPOS_COBRO.includes(e.tipo)).reduce((a, e) => a + e.monto, 0);
                return (
                  <div className="mt-3 flex flex-wrap gap-4 border-t border-white/10 pt-2 text-xs font-black">
                    <span className="text-green-400">Cobros: {dinero(c)}</span>
                    <span className="text-red-400">Pagos: {dinero(p)}</span>
                    <span className={c - p >= 0 ? "text-green-400" : "text-red-500"}>Neto: {dinero(c - p)}</span>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Próximos compromisos (ventanas) */}
      {salud && (
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <h3 className="mb-3 text-sm font-black uppercase text-white/60">Próximos compromisos</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {salud.ventanas.map((v) => (
              <div key={v.dias} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">Próximos {v.dias} días</p>
                <p className={`mt-1 text-lg font-black ${v.neto_ponderado >= 0 ? "text-green-400" : "text-red-500"}`}>{dinero(v.neto_ponderado)}</p>
                <p className="text-[10px] text-white/40">Cobros {dinero(v.cobros_ponderados)} · Pagos {dinero(v.pagos)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <ListaMini titulo="Próximos pagos" items={salud.listas.proximos_pagos.map((p) => ({ id: p.id, txt: `${p.fecha.slice(8)}/${p.fecha.slice(5, 7)} · ${p.descripcion || TIPO_EVENTO_LABEL[p.tipo]}`, monto: -p.monto }))} vacio="Sin pagos próximos." />
            <ListaMini titulo="Próximos cobros" items={salud.listas.proximos_cobros.map((c) => ({ id: c.id, txt: `${c.fecha.slice(8)}/${c.fecha.slice(5, 7)} · ${c.descripcion}${c.probabilidad < 100 ? ` (${c.probabilidad}%)` : ""}`, monto: c.monto }))} vacio="Sin cobros futuros cargados." />
            <ListaMini titulo="Vencidos" items={salud.listas.vencidos.map((v) => ({ id: v.id, txt: `${v.fecha.slice(8)}/${v.fecha.slice(5, 7)} · ${v.descripcion || TIPO_EVENTO_LABEL[v.tipo]}`, monto: -v.monto }))} vacio="Nada vencido. 👌" rojo />
          </div>
        </div>
      )}

      {/* Deudas */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase text-white/60">Deudas</h3>
          <button onClick={() => setDeudaForm({ descripcion: "", proveedor: "", monto_total: "", cuotas: "1", monto_cuota: "", fecha_primera_cuota: hoy, cuenta_estimada: "mercado_pago", categoria_id: "", observaciones: "" })} className="rounded-full border border-amber-500/50 px-3 py-1 text-[10px] font-black uppercase text-amber-400 hover:bg-amber-500/10">+ Deuda</button>
        </div>
        {deudas.length === 0 ? <p className="text-sm text-white/40">Sin deudas cargadas.</p> : (
          <div className="grid gap-2 md:grid-cols-2">
            {deudas.map((d) => (
              <div key={d.id} className={`rounded-xl border p-3 ${d.estado === "activa" ? "border-white/10 bg-white/[0.03]" : "border-white/5 opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{d.descripcion}{d.proveedor && <span className="ml-1 text-xs font-bold text-white/40">· {d.proveedor}</span>}</p>
                    <p className="text-[10px] uppercase text-white/35">{d.estado} · {d.cuotas_pagadas}/{d.cuotas_total} cuotas pagadas{d.cuotas_vencidas > 0 ? ` · ${d.cuotas_vencidas} vencidas` : ""}</p>
                  </div>
                  <button onClick={() => eliminarDeuda(d)} className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/50 hover:border-red-500 hover:text-white">×</button>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <span className="text-white/50">Total: <b className="text-white/80">{dinero(d.monto_total)}</b></span>
                  <span className="text-white/50">Pendiente: <b className="text-red-400">{dinero(d.pendiente)}</b></span>
                  <span className="text-white/50">Pagado: <b className="text-green-400">{dinero(d.pagado)}</b></span>
                  {d.proxima_cuota && <span className="text-white/50">Próxima: <b className="text-white/80">{d.proxima_cuota.fecha.slice(8)}/{d.proxima_cuota.fecha.slice(5, 7)} {dinero(d.proxima_cuota.monto)}</b></span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recurrencias */}
      <div className="rounded-2xl border border-white/10 bg-black p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase text-white/60">Series recurrentes</h3>
          <button onClick={() => setRecForm({ id: null, tipo: "gasto_fijo", frecuencia: "mensual", fecha_inicio: hoy, fecha_fin: "", cantidad_repeticiones: "12", monto: "", descripcion: "", categoria_id: "", cuenta_estimada: "mercado_pago", probabilidad: "100", proveedor_cliente: "" })} className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-black uppercase text-white/60 hover:border-red-500 hover:text-white">+ Recurrente</button>
        </div>
        {recurrencias.length === 0 ? <p className="text-sm text-white/40">Sin series recurrentes (alquiler, contador, ARCA, sponsors...).</p> : (
          <div className="space-y-1.5">
            {recurrencias.map((rc) => (
              <div key={rc.id} className={`flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2 ${rc.activa ? "" : "opacity-50"}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{rc.descripcion || TIPO_EVENTO_LABEL[rc.tipo]} <span className={TIPOS_COBRO.includes(rc.tipo) ? "text-green-400" : "text-red-400"}>{dinero(rc.monto)}</span></p>
                  <p className="text-[10px] uppercase text-white/35">{rc.frecuencia} · desde {rc.fecha_inicio.slice(8)}/{rc.fecha_inicio.slice(5, 7)}/{rc.fecha_inicio.slice(0, 4)}{rc.fecha_fin ? ` hasta ${rc.fecha_fin}` : rc.cantidad_repeticiones ? ` · ${rc.cantidad_repeticiones}x` : ""} · {rc.categoria?.nombre || "sin categoría"}{rc.activa ? "" : " · cancelada"}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => setRecForm({ id: rc.id, tipo: rc.tipo, frecuencia: rc.frecuencia, fecha_inicio: rc.fecha_inicio, fecha_fin: rc.fecha_fin || "", cantidad_repeticiones: rc.cantidad_repeticiones ? String(rc.cantidad_repeticiones) : "", monto: String(rc.monto), descripcion: rc.descripcion, categoria_id: rc.categoria_id || "", cuenta_estimada: rc.cuenta_estimada, probabilidad: String(rc.probabilidad), proveedor_cliente: rc.proveedor_cliente || "" })} className="rounded-lg border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/50 hover:text-white">✎ Serie</button>
                  {rc.activa && <button onClick={() => cancelarSerie(rc.id)} className="rounded-lg border border-white/15 px-2 py-1 text-[10px] font-black uppercase text-white/50 hover:border-red-500 hover:text-white">×</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-white/30">Editar la serie regenera las ocurrencias futuras pendientes. Las pagadas o editadas a mano no se pisan. Para una sola ocurrencia, editala desde el calendario.</p>
      </div>

      <p className="text-xs text-white/30">Nada de este calendario toca la caja real: los montos impactan Finanzas solo cuando marcás un evento como pagado/cobrado y confirmás crear el movimiento.</p>

      {/* ── Modal evento ── */}
      {evForm && (
        <Modal titulo={evForm.id ? "Evento financiero" : "Nuevo evento"} onCerrar={() => setEvForm(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Tipo">
              <select value={evForm.tipo} onChange={(e) => setEvForm({ ...evForm, tipo: e.target.value })} disabled={Boolean(evForm.id && (eventoEditando?.deuda_id || eventoEditando?.recurrencia_id))} className={`${inputCls} disabled:opacity-50`}>
                {["cobro_futuro", "pago_futuro", "gasto_fijo", "ingreso_recurrente", "vencimiento", "compromiso_estimado", ...(evForm.id ? ["deuda", "cuota_deuda"] : [])].map((t) => (
                  <option key={t} value={t}>{TIPO_EVENTO_LABEL[t]}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Fecha"><input type="date" value={evForm.fecha} onChange={(e) => setEvForm({ ...evForm, fecha: e.target.value })} className={inputCls} /></Campo>
            <Campo label="Monto"><input type="number" min={0} value={evForm.monto} onChange={(e) => setEvForm({ ...evForm, monto: e.target.value })} placeholder="0" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <Campo label="Cuenta estimada">
              <select value={evForm.cuenta_estimada} onChange={(e) => setEvForm({ ...evForm, cuenta_estimada: e.target.value })} className={inputCls}>
                <option value="efectivo">Efectivo</option>
                <option value="mercado_pago">Mercado Pago</option>
              </select>
            </Campo>
            <Campo label="Categoría">
              <select value={evForm.categoria_id} onChange={(e) => setEvForm({ ...evForm, categoria_id: e.target.value })} className={inputCls}>
                <option value="">Sin categoría</option>
                {categorias.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Estado">
              <select value={evForm.estado} onChange={(e) => setEvForm({ ...evForm, estado: e.target.value })} className={inputCls}>
                <option value="pendiente">Pendiente</option>
                <option value="estimado">Estimado</option>
              </select>
            </Campo>
            {(TIPOS_COBRO.includes(evForm.tipo) || evForm.tipo === "compromiso_estimado") && (
              <Campo label="Probabilidad de cobro (%)">
                <select value={evForm.probabilidad} onChange={(e) => setEvForm({ ...evForm, probabilidad: e.target.value })} className={inputCls}>
                  <option value="100">Confirmado · 100%</option>
                  <option value="80">Probable · 80%</option>
                  <option value="50">Posible · 50%</option>
                  <option value="25">Incierto · 25%</option>
                </select>
              </Campo>
            )}
            <Campo label="Proveedor / cliente"><input type="text" value={evForm.proveedor_cliente} onChange={(e) => setEvForm({ ...evForm, proveedor_cliente: e.target.value })} placeholder="Opcional" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <div className="md:col-span-2"><Campo label="Descripción"><input type="text" value={evForm.descripcion} onChange={(e) => setEvForm({ ...evForm, descripcion: e.target.value })} placeholder="Ej: pago proveedor volantes" className={`${inputCls} placeholder:text-white/30`} /></Campo></div>
            <div className="md:col-span-2"><Campo label="Observaciones"><input type="text" value={evForm.observaciones} onChange={(e) => setEvForm({ ...evForm, observaciones: e.target.value })} placeholder="Notas" className={`${inputCls} placeholder:text-white/30`} /></Campo></div>
          </div>

          {eventoEditando?.movimiento_id && (
            <p className="mt-3 rounded-xl border border-green-500/25 bg-green-950/10 px-3 py-2 text-xs text-green-400">
              Ya generó movimiento real {eventoEditando.fecha_real ? `el ${eventoEditando.fecha_real}` : ""} (ver en Movimientos).
            </p>
          )}

          <div className="mt-5 flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {evForm.id && eventoEditando && (eventoEditando.estado === "pendiente" || eventoEditando.estado === "estimado") && (
                <>
                  {TIPOS_COBRO.includes(eventoEditando.tipo) ? (
                    <button onClick={() => marcarEvento(eventoEditando, "cobrado")} disabled={guardando} className="rounded-xl border border-green-500/50 px-4 py-2.5 text-xs font-black uppercase text-green-400 hover:bg-green-500/10 disabled:opacity-40">Marcar cobrado</button>
                  ) : (
                    <button onClick={() => marcarEvento(eventoEditando, "pagado")} disabled={guardando} className="rounded-xl border border-green-500/50 px-4 py-2.5 text-xs font-black uppercase text-green-400 hover:bg-green-500/10 disabled:opacity-40">Marcar pagado</button>
                  )}
                  <button onClick={() => cancelarEvento(evForm.id!)} disabled={guardando} className="rounded-xl border border-amber-500/50 px-4 py-2.5 text-xs font-black uppercase text-amber-400 hover:bg-amber-500/10 disabled:opacity-40">Cancelar evento</button>
                </>
              )}
              {evForm.id && <button onClick={() => eliminarEvento(evForm.id!)} disabled={guardando} className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-black uppercase text-white/50 hover:border-red-500 hover:text-white disabled:opacity-40">Eliminar</button>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEvForm(null)} className="rounded-xl border border-white/15 px-5 py-2.5 text-xs font-black uppercase text-white/60 hover:text-white">Cerrar</button>
              {(!evForm.id || (eventoEditando && eventoEditando.estado !== "pagado" && eventoEditando.estado !== "cobrado" && eventoEditando.estado !== "cancelado")) && (
                <button onClick={guardarEvento} disabled={guardando || !evForm.monto || Number(evForm.monto) <= 0} className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">{guardando ? "..." : evForm.id ? "Guardar cambios" : "Crear evento"}</button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal deuda ── */}
      {deudaForm && (
        <Modal titulo="Nueva deuda" onCerrar={() => setDeudaForm(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><Campo label="Descripción"><input type="text" value={deudaForm.descripcion} onChange={(e) => setDeudaForm({ ...deudaForm, descripcion: e.target.value })} placeholder="Ej: volantes Moza en cuotas" className={`${inputCls} placeholder:text-white/30`} /></Campo></div>
            <Campo label="Proveedor"><input type="text" value={deudaForm.proveedor} onChange={(e) => setDeudaForm({ ...deudaForm, proveedor: e.target.value })} placeholder="Opcional" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <Campo label="Monto total"><input type="number" min={0} value={deudaForm.monto_total} onChange={(e) => { const total = e.target.value; const n = Number(deudaForm.cuotas) || 1; setDeudaForm({ ...deudaForm, monto_total: total, monto_cuota: n > 1 && Number(total) > 0 ? String(Math.round(Number(total) / n)) : deudaForm.monto_cuota }); }} placeholder="0" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <Campo label="Cantidad de cuotas"><input type="number" min={1} max={120} value={deudaForm.cuotas} onChange={(e) => { const n = Number(e.target.value) || 1; setDeudaForm({ ...deudaForm, cuotas: e.target.value, monto_cuota: n > 1 && Number(deudaForm.monto_total) > 0 ? String(Math.round(Number(deudaForm.monto_total) / n)) : "" }); }} className={inputCls} /></Campo>
            {Number(deudaForm.cuotas) > 1 && (
              <Campo label="Monto por cuota"><input type="number" min={0} value={deudaForm.monto_cuota} onChange={(e) => setDeudaForm({ ...deudaForm, monto_cuota: e.target.value })} className={inputCls} /></Campo>
            )}
            <Campo label={Number(deudaForm.cuotas) > 1 ? "Fecha primera cuota" : "Vencimiento"}><input type="date" value={deudaForm.fecha_primera_cuota} onChange={(e) => setDeudaForm({ ...deudaForm, fecha_primera_cuota: e.target.value })} className={inputCls} /></Campo>
            <Campo label="Cuenta estimada">
              <select value={deudaForm.cuenta_estimada} onChange={(e) => setDeudaForm({ ...deudaForm, cuenta_estimada: e.target.value })} className={inputCls}>
                <option value="efectivo">Efectivo</option>
                <option value="mercado_pago">Mercado Pago</option>
              </select>
            </Campo>
            <Campo label="Categoría">
              <select value={deudaForm.categoria_id} onChange={(e) => setDeudaForm({ ...deudaForm, categoria_id: e.target.value })} className={inputCls}>
                <option value="">Sin categoría</option>
                {categorias.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <div className="md:col-span-2"><Campo label="Observaciones"><input type="text" value={deudaForm.observaciones} onChange={(e) => setDeudaForm({ ...deudaForm, observaciones: e.target.value })} placeholder="Notas" className={`${inputCls} placeholder:text-white/30`} /></Campo></div>
          </div>
          {Number(deudaForm.cuotas) > 1 && Number(deudaForm.monto_cuota) > 0 && (
            <p className="mt-3 text-xs text-white/40">Se van a generar {deudaForm.cuotas} cuotas mensuales de {dinero(Number(deudaForm.monto_cuota))} desde el {deudaForm.fecha_primera_cuota}.</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setDeudaForm(null)} className="rounded-xl border border-white/15 px-5 py-2.5 text-xs font-black uppercase text-white/60 hover:text-white">Cancelar</button>
            <button onClick={guardarDeuda} disabled={guardando || !deudaForm.descripcion.trim() || !deudaForm.monto_total || Number(deudaForm.monto_total) <= 0 || !deudaForm.fecha_primera_cuota} className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">{guardando ? "..." : "Crear deuda"}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal recurrencia ── */}
      {recForm && (
        <Modal titulo={recForm.id ? "Editar serie recurrente" : "Nueva serie recurrente"} onCerrar={() => setRecForm(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Tipo">
              <select value={recForm.tipo} onChange={(e) => setRecForm({ ...recForm, tipo: e.target.value })} className={inputCls}>
                {["gasto_fijo", "pago_futuro", "ingreso_recurrente", "cobro_futuro", "compromiso_estimado", "vencimiento"].map((t) => <option key={t} value={t}>{TIPO_EVENTO_LABEL[t]}</option>)}
              </select>
            </Campo>
            <Campo label="Frecuencia">
              <select value={recForm.frecuencia} onChange={(e) => setRecForm({ ...recForm, frecuencia: e.target.value })} className={inputCls}>
                <option value="semanal">Semanal</option>
                <option value="mensual">Mensual</option>
                <option value="anual">Anual</option>
              </select>
            </Campo>
            <Campo label="Fecha de inicio"><input type="date" value={recForm.fecha_inicio} onChange={(e) => setRecForm({ ...recForm, fecha_inicio: e.target.value })} className={inputCls} /></Campo>
            <Campo label="Monto"><input type="number" min={0} value={recForm.monto} onChange={(e) => setRecForm({ ...recForm, monto: e.target.value })} placeholder="0" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <Campo label="Repeticiones (opcional)"><input type="number" min={1} max={60} value={recForm.cantidad_repeticiones} onChange={(e) => setRecForm({ ...recForm, cantidad_repeticiones: e.target.value })} placeholder="Ej: 12" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <Campo label="Fecha fin (opcional)"><input type="date" value={recForm.fecha_fin} onChange={(e) => setRecForm({ ...recForm, fecha_fin: e.target.value })} className={inputCls} /></Campo>
            <Campo label="Categoría">
              <select value={recForm.categoria_id} onChange={(e) => setRecForm({ ...recForm, categoria_id: e.target.value })} className={inputCls}>
                <option value="">Sin categoría</option>
                {categorias.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Cuenta estimada">
              <select value={recForm.cuenta_estimada} onChange={(e) => setRecForm({ ...recForm, cuenta_estimada: e.target.value })} className={inputCls}>
                <option value="efectivo">Efectivo</option>
                <option value="mercado_pago">Mercado Pago</option>
              </select>
            </Campo>
            {TIPOS_COBRO.includes(recForm.tipo) && (
              <Campo label="Probabilidad (%)">
                <select value={recForm.probabilidad} onChange={(e) => setRecForm({ ...recForm, probabilidad: e.target.value })} className={inputCls}>
                  <option value="100">Confirmado · 100%</option>
                  <option value="80">Probable · 80%</option>
                  <option value="50">Posible · 50%</option>
                </select>
              </Campo>
            )}
            <Campo label="Proveedor / cliente"><input type="text" value={recForm.proveedor_cliente} onChange={(e) => setRecForm({ ...recForm, proveedor_cliente: e.target.value })} placeholder="Opcional" className={`${inputCls} placeholder:text-white/30`} /></Campo>
            <div className="md:col-span-2"><Campo label="Descripción"><input type="text" value={recForm.descripcion} onChange={(e) => setRecForm({ ...recForm, descripcion: e.target.value })} placeholder="Ej: alquiler local" className={`${inputCls} placeholder:text-white/30`} /></Campo></div>
          </div>
          {recForm.id && <p className="mt-3 text-xs text-amber-400/80">Al guardar se regeneran las ocurrencias futuras pendientes de la serie. Las pagadas o editadas a mano no se tocan.</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setRecForm(null)} className="rounded-xl border border-white/15 px-5 py-2.5 text-xs font-black uppercase text-white/60 hover:text-white">Cancelar</button>
            <button onClick={guardarRecurrencia} disabled={guardando || !recForm.monto || Number(recForm.monto) <= 0 || !recForm.fecha_inicio} className="rounded-xl bg-red-600 px-6 py-2.5 text-xs font-black uppercase transition hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">{guardando ? "..." : recForm.id ? "Guardar serie" : "Crear serie"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ListaMini({ titulo, items, vacio, rojo }: { titulo: string; items: Array<{ id: string; txt: string; monto: number }>; vacio: string; rojo?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${rojo && items.length > 0 ? "border-red-500/40 bg-red-950/15" : "border-white/10 bg-white/[0.03]"}`}>
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.15em] text-white/40">{titulo}</p>
      {items.length === 0 ? <p className="text-xs text-white/35">{vacio}</p> : (
        <div className="space-y-1">
          {items.slice(0, 6).map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-white/60">{i.txt}</span>
              <span className={`shrink-0 font-black ${i.monto >= 0 ? "text-green-400" : "text-red-400"}`}>{dinero(Math.abs(i.monto))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════ SALUD FINANCIERA (sección en Métricas) ═════════

const SALUD_DEFS: Record<string, { titulo: string; significado: string; formula: string; fmt: "money" | "pct" | "meses" | "dias" | "sem" }> = {
  caja_proyectada_fin_mes: { titulo: "Caja proyectada fin de mes", significado: "Con cuánta plata terminarías el mes si se cumplen los cobros y pagos cargados.", formula: "Caja actual + cobros esperados del mes (ponderados) − pagos comprometidos − vencidos", fmt: "money" },
  flujo_30: { titulo: "Flujo proyectado 30d", significado: "Plata neta esperada en los próximos 30 días según el calendario.", formula: "Cobros ponderados 30d − pagos 30d", fmt: "money" },
  flujo_60: { titulo: "Flujo proyectado 60d", significado: "Plata neta esperada en los próximos 60 días.", formula: "Cobros ponderados 60d − pagos 60d", fmt: "money" },
  flujo_90: { titulo: "Flujo proyectado 90d", significado: "Plata neta esperada en los próximos 90 días.", formula: "Cobros ponderados 90d − pagos 90d", fmt: "money" },
  deuda_pendiente: { titulo: "Deuda total pendiente", significado: "Todo lo que debés (deudas y cuotas sin pagar).", formula: "Suma de deudas y cuotas pendientes", fmt: "money" },
  pasivo_30: { titulo: "Pasivo 30 días", significado: "Obligaciones que vencen en los próximos 30 días (incluye vencidas).", formula: "Pagos + deudas con vencimiento ≤ 30 días", fmt: "money" },
  pasivo_60: { titulo: "Pasivo 60 días", significado: "Obligaciones que vencen en los próximos 60 días.", formula: "Pagos + deudas con vencimiento ≤ 60 días", fmt: "money" },
  pasivo_90: { titulo: "Pasivo 90 días", significado: "Obligaciones que vencen en los próximos 90 días.", formula: "Pagos + deudas con vencimiento ≤ 90 días", fmt: "money" },
  deuda_sobre_ingresos: { titulo: "Deuda / ingresos", significado: "Cuántos meses de facturación promedio representa la deuda.", formula: "Deuda pendiente / ingresos promedio mensual", fmt: "pct" },
  pagos_fijos_sobre_ingresos: { titulo: "Fijos / ingresos", significado: "Peso de los pagos fijos recurrentes sobre la facturación promedio.", formula: "Pagos fijos mensuales / ingresos promedio", fmt: "pct" },
  dscr: { titulo: "DSCR aprox.", significado: "Capacidad del resultado operativo para cubrir los pagos de deuda del período.", formula: "Resultado operativo / pagos de deuda 30d", fmt: "pct" },
  cobertura_30: { titulo: "Cobertura 30d", significado: "Cuántas veces la caja actual cubre los pagos de los próximos 30 días.", formula: "Caja / pagos comprometidos 30d", fmt: "pct" },
  runway_ajustado: { titulo: "Runway ajustado", significado: "Meses de caja contando egresos operativos + pagos de deuda próximos.", formula: "Caja / (egresos del mes + deuda 30d)", fmt: "meses" },
  break_even_proyectado: { titulo: "Break-even proyectado", significado: "Cuánto necesitás facturar contando también los compromisos fijos del calendario.", formula: "Costos + gastos + fijos recurrentes 30d", fmt: "money" },
  riesgo_caja: { titulo: "Riesgo de caja", significado: "Semáforo general según caja proyectada y obligaciones próximas.", formula: "Caja proyectada y cobertura de pagos 30d", fmt: "sem" },
  dias_hasta_deficit: { titulo: "Días hasta déficit", significado: "En cuántos días la caja proyectada podría quedar negativa.", formula: "Simulación día a día: caja + cobros ponderados − pagos", fmt: "dias" },
  cobros_ponderados_30: { titulo: "Cobros ponderados 30d", significado: "Cobros esperados ajustados por su probabilidad.", formula: "Σ cobro × probabilidad", fmt: "money" },
  gap_proximo_mes: { titulo: "Gap próximo mes", significado: "Colchón (o agujero) financiero estimado para el mes próximo.", formula: "Caja proyectada + cobros 30d − pagos 30d", fmt: "money" },
  concentracion_7: { titulo: "Vencimientos en 7d", significado: "Qué parte de tus obligaciones cae en los próximos 7 días.", formula: "Pasivo 7d / obligaciones totales", fmt: "pct" },
  concentracion_15: { titulo: "Vencimientos en 15d", significado: "Qué parte de tus obligaciones cae en los próximos 15 días.", formula: "Pasivo 15d / obligaciones totales", fmt: "pct" },
  concentracion_30: { titulo: "Vencimientos en 30d", significado: "Qué parte de tus obligaciones cae en los próximos 30 días.", formula: "Pasivo 30d / obligaciones totales", fmt: "pct" },
  presion_deuda_mensual: { titulo: "Presión de deuda del mes", significado: "Peso de las cuotas/deudas del mes sobre los ingresos.", formula: "Deudas del mes / ingresos del mes (o promedio)", fmt: "pct" },
};

function fmtSalud(v: number | string | null, fmt: string): string {
  if (v === null || v === undefined) return "—";
  if (fmt === "pct") return pct(Number(v));
  if (fmt === "meses") return `${v} meses`;
  if (fmt === "dias") return v === null ? "—" : `${v} días`;
  if (fmt === "sem") return v === "verde" ? "OK" : v === "ambar" ? "Atención" : "Riesgo";
  return dinero(Number(v));
}

function diagnosticoSalud(key: string, m: Record<string, number | string | null>, c: Record<string, number | boolean | string | null>): { diagnostico: string; recomendacion: string; datos: Array<[string, string]> } {
  const caja = Number(c.caja) || 0;
  const hayEventos = Boolean(c.hay_eventos);
  const hayDeudas = Boolean(c.hay_deudas);
  const hayCobros = Boolean(c.hay_cobros_futuros);
  const datos: Array<[string, string]> = [
    ["Caja actual", dinero(caja)],
    ["Ingresos promedio", dinero(Number(c.ingresos_promedio))],
    ["Deuda vencida", dinero(Number(c.deuda_vencida))],
  ];
  let diagnostico = "";
  let recomendacion = "";

  if (!hayEventos) {
    diagnostico = "No hay suficientes datos cargados para proyectar con precisión. La proyección solo contempla la caja actual.";
    recomendacion = "Cargá cobros y pagos futuros en el Calendario financiero para proyectar de verdad.";
    return { diagnostico, recomendacion, datos };
  }

  switch (key) {
    case "caja_proyectada_fin_mes": {
      const v = Number(m.caja_proyectada_fin_mes);
      datos.push(["Cobros del mes (pond.)", dinero(Number(c.cobros_mes_ponderados))], ["Pagos del mes", dinero(Number(c.pagos_mes))]);
      diagnostico = v < 0
        ? `Con los cobros y pagos cargados, SIM terminaría el mes con caja negativa (${dinero(v)}). El principal factor son pagos comprometidos por ${dinero(Number(c.pagos_mes))} contra cobros esperados por ${dinero(Number(c.cobros_mes_ponderados))}.`
        : `Terminarías el mes con ~${dinero(v)} si se cumplen los cobros y pagos del calendario.`;
      recomendacion = v < 0 ? "Priorizá cobros, diferí pagos no críticos o reducí egresos del mes." : "Mantené los vencimientos al día para que la proyección se cumpla.";
      break;
    }
    case "deuda_pendiente": case "deuda_sobre_ingresos": case "presion_deuda_mensual": case "pasivo_30": case "pasivo_60": case "pasivo_90": case "dscr": {
      datos.push(["Deuda pendiente", dinero(Number(m.deuda_pendiente))], ["Pagos deuda 30d", dinero(Number(c.pagos_deuda_30))]);
      if (!hayDeudas) { diagnostico = "No hay deudas cargadas. Esta métrica está en cero porque no existen pasivos registrados en el calendario financiero."; recomendacion = "Si tenés deudas reales, cargalas para ver tu pasivo de verdad."; }
      else if (key === "deuda_sobre_ingresos" && Number(m.deuda_sobre_ingresos) > 1) { diagnostico = `La deuda pendiente equivale a ${(Number(m.deuda_sobre_ingresos)).toFixed(1)} meses de facturación promedio. Presión financiera alta si la facturación no crece.`; recomendacion = "Evaluá refinanciar cuotas o priorizar el pago de las deudas más caras."; }
      else { diagnostico = `Pasivo bajo control con los datos cargados (${fmtSalud(m[key], SALUD_DEFS[key].fmt)}).`; recomendacion = "Revisá que todas las deudas reales estén cargadas para no subestimar."; }
      break;
    }
    case "cobertura_30": case "riesgo_caja": case "gap_proximo_mes": case "flujo_30": case "flujo_60": case "flujo_90": {
      datos.push(["Pagos 30d", dinero(Number(c.pagos_deuda_30) + 0)], ["Cobros pond. 30d", dinero(Number(m.cobros_ponderados_30))]);
      const cob = m.cobertura_30 === null ? null : Number(m.cobertura_30);
      if (cob !== null && cob < 1) { diagnostico = "Los pagos comprometidos de los próximos 30 días superan la caja disponible."; recomendacion = "Conviene priorizar cobros, diferir pagos o reducir egresos."; }
      else if (!hayCobros) { diagnostico = "No hay cobros futuros cargados. La proyección es conservadora: solo contempla caja actual y pagos futuros."; recomendacion = "Cargá los cobros esperados (aunque sean estimados con probabilidad)."; }
      else { diagnostico = `Con lo cargado, ${key === "riesgo_caja" ? `el riesgo es ${fmtSalud(m.riesgo_caja, "sem")}` : `el valor es ${fmtSalud(m[key], SALUD_DEFS[key].fmt)}`}.`; recomendacion = "Actualizá el calendario a medida que confirmes cobros y pagos."; }
      break;
    }
    case "dias_hasta_deficit": {
      const v = m.dias_hasta_deficit;
      diagnostico = v === null ? "No se proyecta déficit de caja en los próximos 90 días con los datos cargados." : `La caja proyectada quedaría negativa en ~${v} días si no cambian los cobros/pagos.`;
      recomendacion = v === null ? "Buen colchón; mantené los datos actualizados." : "Adelantá cobros o mové pagos para estirar la caja.";
      break;
    }
    default:
      diagnostico = `Valor actual: ${fmtSalud(m[key], SALUD_DEFS[key]?.fmt || "money")} con ${Number(c.eventos_pendientes)} eventos pendientes cargados.`;
      recomendacion = "Mantené el calendario al día para que la proyección sea confiable.";
  }
  return { diagnostico, recomendacion, datos };
}

export function SaludFinanciera({ mes }: { mes: string }) {
  const [salud, setSalud] = useState<SaludApi | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await fetch(`/api/admin/finanzas/salud-financiera?mes=${mes}`, { cache: "no-store" });
      const d = await r.json();
      if (vivo) setSalud(r.ok && d.metricas ? d : null);
    })();
    return () => { vivo = false; };
  }, [mes]);

  if (!salud) return null;
  const m = salud.metricas;
  const c = salud.contexto;

  const semaforoDe = (k: string): "verde" | "ambar" | "rojo" | null => {
    if (k === "riesgo_caja") return (m.riesgo_caja as "verde" | "ambar" | "rojo") || null;
    if (k === "caja_proyectada_fin_mes" || k.startsWith("flujo_") || k === "gap_proximo_mes") {
      const v = Number(m[k]);
      return Number.isFinite(v) ? (v >= 0 ? "verde" : "rojo") : null;
    }
    if (k === "cobertura_30") { const v = m[k] === null ? null : Number(m[k]); return v === null ? null : v >= 2 ? "verde" : v >= 1 ? "ambar" : "rojo"; }
    if (k === "dias_hasta_deficit") { const v = m[k]; return v === null ? "verde" : Number(v) > 45 ? "ambar" : "rojo"; }
    if (k === "deuda_sobre_ingresos") { const v = m[k] === null ? null : Number(m[k]); return v === null ? null : v <= 0.5 ? "verde" : v <= 1.5 ? "ambar" : "rojo"; }
    return null;
  };

  const grupos: Array<{ titulo: string; keys: string[] }> = [
    { titulo: "Proyección de caja", keys: ["caja_proyectada_fin_mes", "flujo_30", "flujo_60", "flujo_90", "gap_proximo_mes", "cobros_ponderados_30", "dias_hasta_deficit", "riesgo_caja"] },
    { titulo: "Pasivos y deudas", keys: ["deuda_pendiente", "pasivo_30", "pasivo_60", "pasivo_90", "deuda_sobre_ingresos", "presion_deuda_mensual", "dscr", "concentracion_30"] },
    { titulo: "Cobertura", keys: ["cobertura_30", "runway_ajustado", "pagos_fijos_sobre_ingresos", "break_even_proyectado", "concentracion_7", "concentracion_15"] },
  ];

  const def = detalle ? SALUD_DEFS[detalle] : null;
  const diag = detalle ? diagnosticoSalud(detalle, m, c) : null;

  return (
    <div className="space-y-5">
      <h3 className="text-lg font-black uppercase text-red-500">Salud financiera y pasivos</h3>
      {grupos.map((g) => (
        <div key={g.titulo}>
          <h4 className="mb-3 text-sm font-black uppercase text-white/60">{g.titulo}</h4>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {g.keys.map((k) => {
              const sem = semaforoDe(k);
              return (
                <button key={k} onClick={() => setDetalle(k)} className="rounded-2xl border border-white/10 bg-black p-4 text-left transition hover:border-red-500/60">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">{SALUD_DEFS[k].titulo}</p>
                    {sem && <span className={`inline-block h-2.5 w-2.5 rounded-full ${sem === "verde" ? "bg-green-500" : sem === "ambar" ? "bg-amber-500" : "bg-red-600"}`} />}
                  </div>
                  <p className="mt-2 text-xl font-black">{fmtSalud(m[k], SALUD_DEFS[k].fmt)}</p>
                  <p className="mt-1 truncate text-[10px] text-white/25">{SALUD_DEFS[k].formula}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase text-red-500/70">Ver detalle →</p>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-white/30">Basado en el Calendario financiero: cargá cobros, pagos y deudas para que la proyección sea real.</p>

      {detalle && def && diag && (
        <Modal titulo={def.titulo} onCerrar={() => setDetalle(null)}>
          <p className="text-3xl font-black text-red-500">{fmtSalud(m[detalle], def.fmt)}</p>
          <p className="mt-3 text-sm text-white/70">{def.significado}</p>
          <div className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs"><span className="font-black uppercase text-white/40">Fórmula:</span> <span className="text-white/70">{def.formula}</span></div>
          <div className="mt-3 grid gap-1.5 md:grid-cols-3">
            {diag.datos.map(([k, v]) => (<div key={k} className="rounded-lg bg-white/[0.04] px-3 py-2"><p className="text-[10px] font-black uppercase text-white/40">{k}</p><p className="text-sm font-black">{v}</p></div>))}
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-black p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-amber-400">Diagnóstico</p>
            <p className="mt-1 text-sm text-white/80">{diag.diagnostico}</p>
          </div>
          <div className="mt-3 rounded-xl border border-green-500/20 bg-green-950/10 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-green-400">Recomendación</p>
            <p className="mt-1 text-sm text-white/80">{diag.recomendacion}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

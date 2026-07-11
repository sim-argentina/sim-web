"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getTurnoTimerState, useNow, TURNO_BADGE_CLASS } from "@/lib/turnoTimer";
import {
  SIMULADORES_COLECTIVO, METODOS_PAGO_COLECTIVO, POSNETS_COLECTIVO,
  DURACIONES_SUGERIDAS, DURACION_DEFAULT, ESTADO_EVENTO_LABEL,
} from "@/lib/colectivo";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type PagoDetalle = { metodo_pago: string; monto: number | string; posnet_pago?: string | null };
type Evento = {
  id: string; nombre: string; fecha_inicio: string; fecha_fin: string;
  hora_inicio: string | null; hora_fin: string | null; localidad: string | null;
  provincia: string | null; ubicacion: string | null; organizador: string | null;
  telefono_contacto: string | null; observaciones: string | null; estado: string;
};
type Turno = {
  id: number; evento_id: string; nombre?: string | null; telefono?: string | null;
  fecha: string; hora?: string | null; hora_estimada_subida?: string | null;
  hora_subida?: string | null; hora_bajada?: string | null; simuladores?: string[] | string;
  cantidad_personas?: number; cantidad_minutos?: number; cantidad_turnos?: number;
  total?: number; metodo_pago?: string; turno_listo?: boolean; posnet_pago?: string | null;
  pagos_detalle?: PagoDetalle[] | string; estado?: string; observaciones?: string | null;
};
type Producto = { id: string; nombre: string; precio_predeterminado: number; activo: boolean };
type Venta = {
  id: string; evento_id: string; producto_id: string | null; producto_nombre: string;
  fecha: string; fecha_hora: string; cantidad: number; precio_unitario: number; total: number;
  cliente?: string | null; telefono?: string | null; observaciones?: string | null;
  metodo_pago?: string | null; posnet_pago?: string | null; pagos_detalle?: PagoDetalle[] | string;
  estado: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function horaActual() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fechaLocalISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function sumarMinutosAHora(hora: string, minutos: number) {
  if (!hora) return "";
  const [h, m] = hora.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m + minutos, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function normalizarSimuladores(s?: string[] | string): string[] {
  if (Array.isArray(s)) return s;
  if (typeof s === "string") { try { const p = JSON.parse(s); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
function metodoUsaPosnet(m: string) { return m === "debito" || m === "credito" || m === "qr"; }
function normalizarPagos(pd?: PagoDetalle[] | string, metodo?: string, total?: number, posnet?: string | null): PagoDetalle[] {
  let arr: PagoDetalle[] = [];
  if (Array.isArray(pd)) arr = pd;
  else if (typeof pd === "string") { try { const p = JSON.parse(pd); if (Array.isArray(p)) arr = p; } catch { /* noop */ } }
  arr = arr.filter((p) => Number(p.monto) > 0);
  if (arr.length > 0) return arr.map((p) => ({ metodo_pago: p.metodo_pago || "qr", monto: p.monto ?? "", posnet_pago: p.posnet_pago || "" }));
  return [{ metodo_pago: metodo || "qr", monto: total || "", posnet_pago: posnet || "" }];
}
function limpiarPagos(pagos: PagoDetalle[]) {
  return pagos
    .map((p) => ({ metodo_pago: p.metodo_pago || "qr", monto: Number(p.monto) || 0, posnet_pago: metodoUsaPosnet(p.metodo_pago) ? (p.posnet_pago || null) : null }))
    .filter((p) => p.monto > 0);
}
function dinero(v: number) { return `$${(Number(v) || 0).toLocaleString("es-AR")}`; }
function formatearPago(p?: string) {
  const map: Record<string, string> = { mixto: "Mixto", qr: "QR", debito: "Débito", credito: "Crédito", efectivo: "Efectivo", transferencia: "Transferencia", gratis: "Gratis" };
  return p ? (map[p] || p) : "-";
}
function pagosDelTurno(t: Turno): PagoDetalle[] {
  let arr: PagoDetalle[] = [];
  if (Array.isArray(t.pagos_detalle)) arr = t.pagos_detalle;
  else if (typeof t.pagos_detalle === "string") { try { const p = JSON.parse(t.pagos_detalle); if (Array.isArray(p)) arr = p; } catch { /* noop */ } }
  return arr.filter((p) => Number(p.monto) > 0);
}
function diasEntre(inicio: string, fin: string): string[] {
  const out: string[] = [];
  const d = new Date(`${inicio}T00:00:00`);
  const end = new Date(`${fin}T00:00:00`);
  let guard = 0;
  while (d <= end && guard < 400) { out.push(fechaLocalISO(d)); d.setDate(d.getDate() + 1); guard++; }
  return out;
}
const inp = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500 placeholder:text-white/30";

export default function EventoColectivoPage() {
  const params = useParams<{ eventoId: string }>();
  const eventoId = params.eventoId;

  const [evento, setEvento] = useState<Evento | null>(null);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dia, setDia] = useState<string>("");
  const now = useNow();

  const cargar = useCallback(async () => {
    const [evR, tuR, veR, prR] = await Promise.all([
      fetch(`/api/admin/colectivo/eventos/${eventoId}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/colectivo/eventos/${eventoId}/turnos`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/colectivo/eventos/${eventoId}/ventas`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/colectivo/productos`, { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (evR.evento) {
      setEvento(evR.evento);
      // Día por defecto: hoy si cae dentro del evento; si no, la fecha inicial.
      const ev = evR.evento as Evento;
      const hoy = fechaLocalISO();
      const def = hoy >= ev.fecha_inicio && hoy <= ev.fecha_fin ? hoy : ev.fecha_inicio;
      setDia((cur) => cur || def);
    }
    setTurnos(Array.isArray(tuR.turnos) ? tuR.turnos : []);
    setVentas(Array.isArray(veR.ventas) ? veR.ventas : []);
    setProductos(Array.isArray(prR.productos) ? prR.productos : []);
    setLoading(false);
  }, [eventoId]);

  // Carga asíncrona inicial: los setState ocurren tras el await, no de forma
  // síncrona (falso positivo de react-hooks/set-state-in-effect).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then((d) => setRole(d.role)).catch(() => {});
  }, []);

  const dias = useMemo(() => (evento ? diasEntre(evento.fecha_inicio, evento.fecha_fin) : []), [evento]);
  const cerrado = evento?.estado === "finalizado" || evento?.estado === "cancelado";
  const esAdmin = role === "admin";

  const turnosDelDia = useMemo(
    () => turnos.filter((t) => t.fecha === dia && t.estado !== "cancelado").sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0)),
    [turnos, dia]
  );
  const ventasDelDia = useMemo(
    () => ventas.filter((v) => v.fecha === dia).sort((a, b) => (b.fecha_hora || "").localeCompare(a.fecha_hora || "")),
    [ventas, dia]
  );

  const finalizarEvento = async () => {
    if (!confirm("¿Finalizar el evento? Seguirá consultable.")) return;
    const r = await fetch(`/api/admin/colectivo/eventos/${eventoId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "finalizar" }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); return; }
    cargar();
  };
  const reabrirEvento = async () => {
    const r = await fetch(`/api/admin/colectivo/eventos/${eventoId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "reabrir" }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); return; }
    cargar();
  };

  if (loading) return <main className="min-h-screen bg-black px-4 py-8 text-white"><p className="text-white/60">Cargando evento...</p></main>;
  if (!evento) return <main className="min-h-screen bg-black px-4 py-8 text-white"><p className="text-white/60">Evento no encontrado. <Link href="/admin/colectivo" className="text-red-400 underline">Volver</Link></p></main>;

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl">
        {/* Cabecera del evento */}
        <div className="mb-6 rounded-3xl border border-red-500/30 bg-red-950/15 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href="/admin/colectivo" className="mb-2 inline-block text-xs font-black uppercase tracking-[0.2em] text-white/50 hover:text-white">← Volver a eventos</Link>
              <h1 className="text-2xl font-black uppercase md:text-4xl">{evento.nombre}</h1>
              <p className="mt-1 text-sm text-white/60">
                {evento.fecha_inicio}{evento.fecha_fin !== evento.fecha_inicio ? ` → ${evento.fecha_fin}` : ""}
                {(evento.hora_inicio || evento.hora_fin) ? ` · ${evento.hora_inicio || "?"}-${evento.hora_fin || "?"}` : ""}
              </p>
              <p className="text-sm text-white/45">{[evento.localidad, evento.provincia, evento.ubicacion].filter(Boolean).join(" · ") || "Sin ubicación"}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${evento.estado === "activo" ? "bg-green-900 text-green-300" : evento.estado === "proximo" ? "bg-blue-900 text-blue-300" : evento.estado === "cancelado" ? "bg-red-900 text-red-300" : "bg-zinc-800 text-zinc-400"}`}>{ESTADO_EVENTO_LABEL[evento.estado] || evento.estado}</span>
              {!cerrado && (
                <button onClick={finalizarEvento} className="rounded-xl border border-amber-500/50 px-4 py-2 text-xs font-black uppercase text-amber-300 hover:bg-amber-600 hover:text-white">Finalizar evento</button>
              )}
              {evento.estado === "finalizado" && esAdmin && (
                <button onClick={reabrirEvento} className="rounded-xl border border-blue-500/50 px-4 py-2 text-xs font-black uppercase text-blue-300 hover:bg-blue-600 hover:text-white">Reabrir evento</button>
              )}
            </div>
          </div>

          {/* Selector de día del evento */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Día del evento</span>
            {dias.map((d) => (
              <button key={d} onClick={() => setDia(d)} className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${d === dia ? "border-red-500 bg-red-600 text-white" : "border-white/15 bg-black text-white/60 hover:border-red-500 hover:text-white"}`}>
                {d.slice(8, 10)}/{d.slice(5, 7)}
              </button>
            ))}
          </div>
        </div>

        {cerrado && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-black p-4 text-sm font-bold text-white/60">
            El evento está {ESTADO_EVENTO_LABEL[evento.estado]?.toLowerCase()}. Es de solo consulta.{evento.estado === "finalizado" && esAdmin ? " Reabrilo para volver a operar." : ""}
          </div>
        )}

        {/* Turnero del día */}
        {!cerrado && <TurneroForm eventoId={eventoId} dia={dia} onSaved={cargar} />}

        <TurnosGuardados turnos={turnosDelDia} dia={dia} now={now} cerrado={cerrado} eventoId={eventoId} onSaved={cargar} />

        <ResumenDia turnos={turnosDelDia} dia={dia} />

        {/* Venta de productos */}
        <VentaProductos eventoId={eventoId} dia={dia} productos={productos} ventas={ventasDelDia} cerrado={cerrado} esAdmin={esAdmin} onSaved={cargar} onProductosChange={cargar} />

        {/* Resumen general del evento */}
        <ResumenGeneral turnos={turnos} ventas={ventas} />
      </section>
    </main>
  );
}

// ═════════ Formulario de turno ═════════
function TurneroForm({ eventoId, dia, onSaved, editando, onCancelEdit }: {
  eventoId: string; dia: string; onSaved: () => void; editando?: Turno | null; onCancelEdit?: () => void;
}) {
  const [hora, setHora] = useState(horaActual());
  const [horaEstimada, setHoraEstimada] = useState("");
  const [horaSubida, setHoraSubida] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [simuladores, setSimuladores] = useState<string[]>([]);
  const [personas, setPersonas] = useState(1);
  const [minutos, setMinutos] = useState(DURACION_DEFAULT);
  const [cantTurnos, setCantTurnos] = useState(1);
  const [pagos, setPagos] = useState<PagoDetalle[]>([{ metodo_pago: "efectivo", monto: "", posnet_pago: "" }]);
  const [observaciones, setObservaciones] = useState("");
  const [gratis, setGratis] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!editando) return;
    setHora(editando.hora || horaActual());
    setHoraEstimada(editando.hora_estimada_subida || "");
    setHoraSubida(editando.hora_subida || "");
    setNombre(editando.nombre || "");
    setTelefono(editando.telefono || "");
    setSimuladores(normalizarSimuladores(editando.simuladores));
    setPersonas(editando.cantidad_personas || 1);
    setMinutos(editando.cantidad_minutos || DURACION_DEFAULT);
    setCantTurnos(editando.cantidad_turnos || 1);
    setPagos(normalizarPagos(editando.pagos_detalle, editando.metodo_pago, editando.total, editando.posnet_pago));
    setObservaciones(editando.observaciones || "");
    setGratis(editando.metodo_pago === "gratis");
  }, [editando]);

  const horaBajada = useMemo(() => sumarMinutosAHora(horaSubida, minutos), [horaSubida, minutos]);
  const totalPagos = useMemo(() => pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0), [pagos]);

  const reset = () => {
    setHora(horaActual()); setHoraEstimada(""); setHoraSubida(""); setNombre(""); setTelefono("");
    setSimuladores([]); setPersonas(1); setMinutos(DURACION_DEFAULT); setCantTurnos(1);
    setPagos([{ metodo_pago: "efectivo", monto: "", posnet_pago: "" }]); setObservaciones(""); setGratis(false);
  };
  const toggleSim = (s: string) => setSimuladores((a) => a.includes(s) ? a.filter((x) => x !== s) : [...a, s]);
  const actPago = (i: number, campo: keyof PagoDetalle, v: string) => setPagos((a) => a.map((p, idx) => {
    if (idx !== i) return p;
    const u = { ...p, [campo]: v };
    if (campo === "metodo_pago" && !metodoUsaPosnet(v)) u.posnet_pago = "";
    return u;
  }));

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gratis && totalPagos <= 0) { alert("Cargá al menos un pago mayor a 0 (o marcá turno gratis)."); return; }
    setGuardando(true);
    try {
      const pagosLimpios = limpiarPagos(pagos);
      const payload = {
        nombre, telefono, fecha: dia, hora,
        hora_estimada_subida: horaEstimada, hora_subida: horaSubida, hora_bajada: horaBajada,
        simuladores, cantidad_personas: personas, cantidad_minutos: minutos, cantidad_turnos: cantTurnos,
        observaciones, turno_listo: editando?.turno_listo || false,
        ...(gratis ? { metodo_pago: "gratis", pagos_detalle: [] } : { pagos_detalle: pagosLimpios }),
      };
      const url = editando ? `/api/admin/colectivo/turnos/${editando.id}` : `/api/admin/colectivo/eventos/${eventoId}/turnos`;
      const r = await fetch(url, { method: editando ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error"); return; }
      reset(); onSaved(); onCancelEdit?.();
    } finally { setGuardando(false); }
  };

  return (
    <form onSubmit={guardar} className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-black uppercase text-red-500">{editando ? "Editar turno" : "Nuevo turno"}</h2>
        {editando && <button type="button" onClick={onCancelEdit} className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase text-white/70 hover:border-white hover:text-white">Cancelar edición</button>}
      </div>

      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Campo label="Hora toma"><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inp} /></Campo>
        <Campo label="Hora estimada"><input type="time" value={horaEstimada} onChange={(e) => setHoraEstimada(e.target.value)} className={inp} /></Campo>
        <Campo label="Hora subida"><input type="time" value={horaSubida} onChange={(e) => setHoraSubida(e.target.value)} className={inp} /></Campo>
        <Campo label="Hora bajada"><input type="time" value={horaBajada} readOnly className={`${inp} opacity-60`} /></Campo>
        <Campo label="Cliente (opcional)"><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Sin identificar" className={inp} /></Campo>
        <Campo label="Teléfono (opcional)"><input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="351..." className={inp} /></Campo>
        <Campo label="Personas"><input type="number" min={1} value={personas} onChange={(e) => setPersonas(Math.max(1, Number(e.target.value) || 1))} className={inp} /></Campo>
        <Campo label="Total"><input readOnly value={dinero(gratis ? 0 : totalPagos)} className={`${inp} opacity-60`} /></Campo>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        <div className="xl:col-span-2">
          <Campo label="Minutos">
            <input type="number" min={1} value={minutos} onChange={(e) => setMinutos(Math.max(1, Number(e.target.value) || 1))} className={inp} />
          </Campo>
          <div className="mt-1 flex gap-1">
            {DURACIONES_SUGERIDAS.map((d) => (
              <button key={d} type="button" onClick={() => setMinutos(d)} className={`rounded-lg border px-2 py-1 text-[11px] font-black ${minutos === d ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/50 hover:border-red-500"}`}>{d}′</button>
            ))}
          </div>
        </div>
        <Campo label="Turnos"><input type="number" min={1} value={cantTurnos} onChange={(e) => setCantTurnos(Math.max(1, Number(e.target.value) || 1))} className={inp} /></Campo>
        <div className="xl:col-span-4"><Campo label="Observaciones"><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Notas internas" className={inp} /></Campo></div>
        <div className="flex items-end"><button type="submit" disabled={guardando} className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:opacity-50">{guardando ? "..." : editando ? "Actualizar" : "Guardar"}</button></div>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-black/60 p-3">
        <input type="checkbox" checked={gratis} onChange={(e) => setGratis(e.target.checked)} className="h-4 w-4 accent-red-500" />
        <span className="text-sm font-black uppercase tracking-[0.12em] text-white/80">Turno gratis</span>
        <span className="text-xs font-bold text-white/40">Sin cobro · total $0</span>
      </label>

      {!gratis && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/60 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Métodos de pago</p>
            <button type="button" onClick={() => setPagos((a) => [...a, { metodo_pago: "efectivo", monto: "", posnet_pago: "" }])} className="rounded-full border border-red-500/60 px-3 py-1 text-[10px] font-black uppercase text-red-400 hover:bg-red-600 hover:text-white">+ Agregar pago</button>
          </div>
          <div className="space-y-2">
            {pagos.map((p, i) => {
              const usaPosnet = metodoUsaPosnet(p.metodo_pago);
              return (
                <div key={i} className="grid gap-2 md:grid-cols-[1.1fr_1fr_1fr_90px]">
                  <select value={p.metodo_pago} onChange={(e) => actPago(i, "metodo_pago", e.target.value)} className={inp}>
                    {METODOS_PAGO_COLECTIVO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <input type="number" min={0} value={p.monto} onChange={(e) => actPago(i, "monto", e.target.value)} placeholder="Monto" className={inp} />
                  <select value={p.posnet_pago || ""} onChange={(e) => actPago(i, "posnet_pago", e.target.value)} disabled={!usaPosnet} className={`${inp} disabled:opacity-30`}>
                    <option value="">Sin posnet</option>
                    {POSNETS_COLECTIVO.map((pn) => <option key={pn} value={pn}>{pn}</option>)}
                  </select>
                  <button type="button" onClick={() => setPagos((a) => a.length === 1 ? a : a.filter((_, idx) => idx !== i))} disabled={pagos.length === 1} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/60 hover:border-red-500 hover:text-white disabled:opacity-30">Quitar</button>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-end text-sm font-black">Total pagos: <span className="ml-2 text-red-500">{dinero(totalPagos)}</span></div>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Simuladores</p>
        <div className="flex flex-wrap gap-2">
          {SIMULADORES_COLECTIVO.map((s) => {
            const sel = simuladores.includes(s);
            return <button key={s} type="button" onClick={() => toggleSim(s)} className={`rounded-full border px-4 py-2 text-xs font-black uppercase transition ${sel ? "border-red-500 bg-red-600 text-white" : "border-white/15 bg-black text-white/60 hover:border-red-500 hover:text-white"}`}>{s}</button>;
          })}
        </div>
      </div>
    </form>
  );
}

// ═════════ Turnos guardados ═════════
function TurnosGuardados({ turnos, dia, now, cerrado, eventoId, onSaved }: {
  turnos: Turno[]; dia: string; now: number; cerrado: boolean; eventoId: string; onSaved: () => void;
}) {
  const [editando, setEditando] = useState<Turno | null>(null);

  const toggleListo = async (t: Turno, valor: boolean) => {
    await fetch(`/api/admin/colectivo/turnos/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...t, turno_listo: valor }),
    });
    onSaved();
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      {editando && !cerrado && (
        <div className="mb-4">
          <TurneroForm eventoId={eventoId} dia={dia} editando={editando} onSaved={onSaved} onCancelEdit={() => setEditando(null)} />
        </div>
      )}
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black uppercase text-red-500">Turnos guardados</h2>
          <p className="text-sm text-white/50">{dia}</p>
        </div>
        <div className="rounded-full border border-white/10 px-4 py-2 text-sm font-bold text-white/70">{turnos.length} turnos</div>
      </div>

      {turnos.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black p-5 text-white/60">No hay turnos cargados para este día.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1180px] space-y-2">
            <div className="grid grid-cols-[60px_70px_80px_80px_1.4fr_1.2fr_70px_70px_70px_1.4fr_120px_110px_70px] gap-2 px-3 text-xs font-black uppercase tracking-[0.15em] text-white/35">
              <span>Listo</span><span>Toma</span><span>Sube</span><span>Baja</span><span>Cliente</span><span>Simus</span><span>Pers.</span><span>Min.</span><span>Turnos</span><span>Pago</span><span>Posnet</span><span>Total</span><span></span>
            </div>
            {turnos.map((t) => {
              const simus = normalizarSimuladores(t.simuladores);
              const pagos = pagosDelTurno(t);
              const posnets = pagos.length ? (pagos.map((p) => p.posnet_pago).filter(Boolean).join(" + ") || "-") : (t.posnet_pago || "-");
              const listo = Boolean(t.turno_listo);
              const timer = getTurnoTimerState({ fecha: t.fecha, horaSubida: t.hora_subida, minutos: t.cantidad_minutos, listo: t.turno_listo, cancelado: t.estado === "cancelado" }, now);
              const pagoStr = pagos.length ? pagos.map((p) => `${formatearPago(p.metodo_pago)} ${dinero(Number(p.monto) || 0)}`).join(" + ") : formatearPago(t.metodo_pago);
              return (
                <div key={t.id} className={`grid grid-cols-[60px_70px_80px_80px_1.4fr_1.2fr_70px_70px_70px_1.4fr_120px_110px_70px] items-center gap-2 rounded-xl border px-3 py-2 text-sm ${timer.status === "listo" ? "border-green-500/50 bg-green-950/25" : timer.status === "rojo" ? "border-red-500/60 bg-red-950/30" : timer.status === "amarillo" ? "border-amber-500/50 bg-amber-950/20" : "border-white/10 bg-black"}`}>
                  <label className="flex items-center justify-center">
                    <input type="checkbox" checked={listo} disabled={cerrado} onChange={(e) => toggleListo(t, e.target.checked)} className="h-5 w-5 accent-red-600 disabled:opacity-40" />
                  </label>
                  <span className="font-black">{t.hora || "-"}</span>
                  <span className="text-white/70">{t.hora_subida || "-"}</span>
                  <span className="text-white/70">{t.hora_bajada || sumarMinutosAHora(t.hora_subida || "", t.cantidad_minutos || DURACION_DEFAULT) || "-"}</span>
                  <div className="min-w-0">
                    <p className={`truncate font-black ${listo ? "text-white/60 line-through" : ""}`}>{t.nombre || "Sin identificar"}</p>
                    <p className="truncate text-xs text-white/40">{t.telefono || "—"}</p>
                    <span className={`mt-1 inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${TURNO_BADGE_CLASS[timer.status]}`}>{timer.label}</span>
                  </div>
                  <span className="truncate text-white/70">{simus.length ? simus.join(", ") : "-"}</span>
                  <span>{t.cantidad_personas || 1}</span>
                  <span>{t.cantidad_minutos || DURACION_DEFAULT}</span>
                  <span>{t.cantidad_turnos || 1}</span>
                  <span className="truncate">{pagoStr}</span>
                  <span>{posnets}</span>
                  <span className="font-black text-red-500">{dinero(Number(t.total || 0))}</span>
                  {!cerrado ? (
                    <button onClick={() => { setEditando(t); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 hover:border-red-500 hover:bg-red-600 hover:text-white">Editar</button>
                  ) : <span className="text-white/30 text-xs">—</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════ Resumen del día ═════════
function agruparResumen(turnos: Turno[]) {
  const porMetodo: Record<string, { cantidad: number; total: number }> = {};
  const porSimulador: Record<string, number> = {};
  const porMinutos: Record<string, number> = {};
  const porPersonas: Record<string, number> = {};
  const porPosnet: Record<string, { cantidad: number; total: number }> = {};
  const porPosnetYMetodo: Record<string, number> = {};
  let totalFacturado = 0, cantidadTurnos = 0;

  turnos.forEach((t) => {
    const totalTurno = Number(t.total || 0);
    const min = `${t.cantidad_minutos || DURACION_DEFAULT} min`;
    const per = `${t.cantidad_personas || 1} persona${(t.cantidad_personas || 1) > 1 ? "s" : ""}`;
    const simus = normalizarSimuladores(t.simuladores);
    const pagos = pagosDelTurno(t);
    cantidadTurnos += Number(t.cantidad_turnos) || 1;
    totalFacturado += totalTurno;
    if (pagos.length > 0) {
      pagos.forEach((p) => {
        const metodo = formatearPago(p.metodo_pago);
        const monto = Number(p.monto) || 0;
        porMetodo[metodo] = porMetodo[metodo] || { cantidad: 0, total: 0 };
        porMetodo[metodo].cantidad += 1; porMetodo[metodo].total += monto;
        if (p.posnet_pago && metodoUsaPosnet(p.metodo_pago)) {
          porPosnet[p.posnet_pago] = porPosnet[p.posnet_pago] || { cantidad: 0, total: 0 };
          porPosnet[p.posnet_pago].cantidad += 1; porPosnet[p.posnet_pago].total += monto;
          const k = `${p.posnet_pago} - ${metodo}`; porPosnetYMetodo[k] = (porPosnetYMetodo[k] || 0) + monto;
        }
      });
    } else {
      const metodo = formatearPago(t.metodo_pago);
      porMetodo[metodo] = porMetodo[metodo] || { cantidad: 0, total: 0 };
      porMetodo[metodo].cantidad += 1; porMetodo[metodo].total += totalTurno;
    }
    porMinutos[min] = (porMinutos[min] || 0) + 1;
    porPersonas[per] = (porPersonas[per] || 0) + 1;
    simus.forEach((s) => { porSimulador[s] = (porSimulador[s] || 0) + 1; });
  });
  return { porMetodo, porSimulador, porMinutos, porPersonas, porPosnet, porPosnetYMetodo, totalFacturado, cantidadTurnos };
}

function ResumenDia({ turnos, dia }: { turnos: Turno[]; dia: string }) {
  const r = useMemo(() => agruparResumen(turnos), [turnos]);
  return (
    <div className="mt-6 rounded-3xl border border-red-500/30 bg-red-950/20 p-5">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div><h2 className="text-2xl font-black uppercase text-red-500">Resumen del día</h2><p className="text-sm text-white/50">{dia}</p></div>
        <div className="text-left md:text-right"><p className="text-sm uppercase tracking-[0.2em] text-white/40">Facturación total</p><p className="text-3xl font-black">{dinero(r.totalFacturado)}</p></div>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-white/10 bg-black p-4"><p className="text-xs uppercase tracking-[0.18em] text-white/40">Turnos</p><p className="mt-2 text-2xl font-black">{r.cantidadTurnos}</p></div>
        <ResumenBox titulo="Por método" data={r.porMetodo} />
        <ResumenBox titulo="Por simulador" data={r.porSimulador} />
        <ResumenBox titulo="Por duración" data={r.porMinutos} />
        <ResumenBox titulo="Por personas" data={r.porPersonas} />
        <ResumenBox titulo="Por posnet" data={r.porPosnet} />
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-black p-4">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">Posnet por método de pago</p>
        {Object.keys(r.porPosnetYMetodo).length === 0 ? <p className="text-sm text-white/45">Sin cobros con posnet este día.</p> : (
          <div className="grid gap-2 md:grid-cols-3">
            {Object.entries(r.porPosnetYMetodo).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2 text-sm"><span className="font-bold text-white/70">{k}</span><span className="font-black text-red-500">{dinero(v)}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════ Venta de productos ═════════
function VentaProductos({ eventoId, dia, productos, ventas, cerrado, esAdmin, onSaved, onProductosChange }: {
  eventoId: string; dia: string; productos: Producto[]; ventas: Venta[]; cerrado: boolean; esAdmin: boolean; onSaved: () => void; onProductosChange: () => void;
}) {
  const [productoNombre, setProductoNombre] = useState("");
  const [productoId, setProductoId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [precio, setPrecio] = useState(0);
  const [cliente, setCliente] = useState("");
  const [telefono, setTelefono] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [pagos, setPagos] = useState<PagoDetalle[]>([{ metodo_pago: "efectivo", monto: "", posnet_pago: "" }]);
  const [bonificada, setBonificada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const total = useMemo(() => Math.round(cantidad * precio), [cantidad, precio]);

  const elegirProducto = (nombre: string) => {
    const p = productos.find((x) => x.nombre === nombre);
    setProductoNombre(nombre);
    setProductoId(p?.id || null);
    if (p && !editId) { setPrecio(p.precio_predeterminado); setPagos([{ metodo_pago: "efectivo", monto: String(p.precio_predeterminado * cantidad), posnet_pago: "" }]); }
  };
  const reset = () => {
    setProductoNombre(""); setProductoId(null); setCantidad(1); setPrecio(0); setCliente(""); setTelefono("");
    setObservaciones(""); setPagos([{ metodo_pago: "efectivo", monto: "", posnet_pago: "" }]); setBonificada(false); setEditId(null);
  };
  const actPago = (i: number, campo: keyof PagoDetalle, v: string) => setPagos((a) => a.map((p, idx) => {
    if (idx !== i) return p;
    const u = { ...p, [campo]: v };
    if (campo === "metodo_pago" && !metodoUsaPosnet(v)) u.posnet_pago = "";
    return u;
  }));

  const abrirEdicion = (v: Venta) => {
    setEditId(v.id); setProductoNombre(v.producto_nombre); setProductoId(v.producto_id);
    setCantidad(v.cantidad); setPrecio(v.precio_unitario); setCliente(v.cliente || ""); setTelefono(v.telefono || "");
    setObservaciones(v.observaciones || "");
    setPagos(normalizarPagos(v.pagos_detalle, v.metodo_pago || undefined, v.total, v.posnet_pago));
    setBonificada(v.estado === "bonificada");
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  const guardar = async () => {
    if (!productoNombre) { alert("Elegí un producto."); return; }
    setGuardando(true);
    try {
      const payload = {
        producto_id: productoId, producto_nombre: productoNombre, fecha: dia,
        cantidad, precio_unitario: precio, cliente, telefono, observaciones,
        ...(bonificada ? { estado: "bonificada" } : { pagos_detalle: limpiarPagos(pagos) }),
      };
      const url = editId ? `/api/admin/colectivo/ventas/${editId}` : `/api/admin/colectivo/eventos/${eventoId}/ventas`;
      const r = await fetch(url, { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Error"); return; }
      reset(); onSaved();
    } finally { setGuardando(false); }
  };
  const anular = async (v: Venta) => {
    if (!confirm("¿Anular esta venta?")) return;
    const r = await fetch(`/api/admin/colectivo/ventas/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "anular" }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); return; }
    onSaved();
  };

  const totalPagos = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);

  return (
    <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black uppercase text-red-500">Venta de productos</h2>
        <button onClick={() => setShowConfig((s) => !s)} className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-black uppercase text-white/60 hover:border-white hover:text-white">Precios predeterminados</button>
      </div>

      {showConfig && <ConfigProductos productos={productos} onChange={onProductosChange} />}

      {!cerrado && (
        <div className="mb-5 rounded-2xl border border-white/10 bg-black/60 p-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Campo label="Producto">
              <select value={productoNombre} onChange={(e) => elegirProducto(e.target.value)} className={inp}>
                <option value="">Elegir...</option>
                {productos.filter((p) => p.activo).map((p) => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Cantidad"><input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))} className={inp} /></Campo>
            <Campo label="Precio unitario"><input type="number" min={0} value={precio} onChange={(e) => setPrecio(Math.max(0, Number(e.target.value) || 0))} className={inp} /></Campo>
            <Campo label="Subtotal"><input readOnly value={dinero(total)} className={`${inp} opacity-60`} /></Campo>
            <Campo label="Comprador (opcional)"><input value={cliente} onChange={(e) => setCliente(e.target.value)} className={inp} /></Campo>
            <Campo label="Teléfono (opcional)"><input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inp} /></Campo>
          </div>

          <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-black/60 p-3">
            <input type="checkbox" checked={bonificada} onChange={(e) => setBonificada(e.target.checked)} className="h-4 w-4 accent-red-500" />
            <span className="text-sm font-black uppercase tracking-[0.12em] text-white/80">Venta bonificada / gratuita</span>
            <span className="text-xs font-bold text-white/40">No genera ingreso</span>
          </label>

          {!bonificada && (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Pagos (deben sumar {dinero(total)})</p>
                <button type="button" onClick={() => setPagos((a) => [...a, { metodo_pago: "efectivo", monto: "", posnet_pago: "" }])} className="rounded-full border border-red-500/60 px-3 py-1 text-[10px] font-black uppercase text-red-400 hover:bg-red-600 hover:text-white">+ Pago</button>
              </div>
              <div className="space-y-2">
                {pagos.map((p, i) => {
                  const usaPosnet = metodoUsaPosnet(p.metodo_pago);
                  return (
                    <div key={i} className="grid gap-2 md:grid-cols-[1.1fr_1fr_1fr_90px]">
                      <select value={p.metodo_pago} onChange={(e) => actPago(i, "metodo_pago", e.target.value)} className={inp}>
                        {METODOS_PAGO_COLECTIVO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <input type="number" min={0} value={p.monto} onChange={(e) => actPago(i, "monto", e.target.value)} placeholder="Monto" className={inp} />
                      <select value={p.posnet_pago || ""} onChange={(e) => actPago(i, "posnet_pago", e.target.value)} disabled={!usaPosnet} className={`${inp} disabled:opacity-30`}>
                        <option value="">Sin posnet</option>
                        {POSNETS_COLECTIVO.map((pn) => <option key={pn} value={pn}>{pn}</option>)}
                      </select>
                      <button type="button" onClick={() => setPagos((a) => a.length === 1 ? a : a.filter((_, idx) => idx !== i))} disabled={pagos.length === 1} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/60 hover:border-red-500 disabled:opacity-30">Quitar</button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-end text-sm font-black">Pagos: <span className={`ml-2 ${totalPagos === total ? "text-green-400" : "text-amber-400"}`}>{dinero(totalPagos)}</span></div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <Campo label="Observaciones"><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className={inp} /></Campo>
            <div className="flex items-end gap-2">
              <button onClick={guardar} disabled={guardando} className="rounded-xl bg-red-600 px-5 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:opacity-50">{guardando ? "..." : editId ? "Actualizar" : "Registrar venta"}</button>
              {editId && <button onClick={reset} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-black uppercase text-white/70 hover:border-white">Cancelar</button>}
            </div>
          </div>
        </div>
      )}

      {ventas.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black p-4 text-sm text-white/50">No hay ventas este día.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-[10px] font-black uppercase tracking-[0.12em] text-white/35"><tr><th className="pb-2">Producto</th><th className="pb-2">Cant.</th><th className="pb-2">P. unit.</th><th className="pb-2">Total</th><th className="pb-2">Pago</th><th className="pb-2">Comprador</th><th className="pb-2">Estado</th><th className="pb-2"></th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {ventas.map((v) => {
                const pagos = normalizarPagos(v.pagos_detalle, v.metodo_pago || undefined, v.total, v.posnet_pago).filter((p) => Number(p.monto) > 0);
                const pagoStr = v.estado === "bonificada" ? "Bonificada" : (pagos.map((p) => `${formatearPago(p.metodo_pago)} ${dinero(Number(p.monto) || 0)}`).join(" + ") || "-");
                return (
                  <tr key={v.id} className={v.estado === "anulada" ? "opacity-40" : ""}>
                    <td className="py-2 font-bold">{v.producto_nombre}</td>
                    <td className="py-2">{v.cantidad}</td>
                    <td className="py-2">{dinero(v.precio_unitario)}</td>
                    <td className="py-2 font-black text-red-400">{dinero(v.total)}</td>
                    <td className="py-2 text-white/70">{pagoStr}</td>
                    <td className="py-2 text-white/60">{v.cliente || "—"}</td>
                    <td className="py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${v.estado === "activa" ? "bg-green-900 text-green-300" : v.estado === "bonificada" ? "bg-blue-900 text-blue-300" : "bg-zinc-800 text-zinc-400"}`}>{v.estado}</span></td>
                    <td className="py-2">
                      {!cerrado && v.estado !== "anulada" && (
                        <div className="flex gap-1">
                          <button onClick={() => abrirEdicion(v)} className="rounded-lg border border-white/15 px-2 py-1 text-xs font-black uppercase text-white/70 hover:border-red-500">Editar</button>
                          {esAdmin && <button onClick={() => anular(v)} className="rounded-lg border border-red-500/40 px-2 py-1 text-xs font-black uppercase text-red-300 hover:bg-red-700 hover:text-white">Anular</button>}
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
  );
}

function ConfigProductos({ productos, onChange }: { productos: Producto[]; onChange: () => void }) {
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const guardar = async (p: Producto) => {
    const val = precios[p.id] ?? String(p.precio_predeterminado);
    const r = await fetch("/api/admin/colectivo/productos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, precio_predeterminado: Number(val) }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); return; }
    onChange();
  };
  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-black p-4">
      <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Precios predeterminados (editables)</p>
      <div className="grid gap-2 md:grid-cols-2">
        {productos.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="w-24 font-bold">{p.nombre}</span>
            <input type="number" min={0} defaultValue={p.precio_predeterminado} onChange={(e) => setPrecios((x) => ({ ...x, [p.id]: e.target.value }))} className={`${inp} flex-1`} />
            <button onClick={() => guardar(p)} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black uppercase hover:bg-red-700">Guardar</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═════════ Resumen general del evento ═════════
function ResumenGeneral({ turnos, ventas }: { turnos: Turno[]; ventas: Venta[] }) {
  const r = useMemo(() => {
    const turnosValidos = turnos.filter((t) => t.estado !== "cancelado");
    // A. Simuladores
    const aGrup = agruparResumen(turnosValidos);
    let personas = 0, minutosVendidos = 0, turnosGratis = 0;
    turnosValidos.forEach((t) => {
      personas += Number(t.cantidad_personas) || 1;
      minutosVendidos += (Number(t.cantidad_minutos) || 0) * (Number(t.cantidad_turnos) || 1);
      if (t.metodo_pago === "gratis") turnosGratis += Number(t.cantidad_turnos) || 1;
    });
    const facturacionSim = aGrup.totalFacturado;
    const promedioPorTurno = aGrup.cantidadTurnos > 0 ? Math.round(facturacionSim / aGrup.cantidadTurnos) : 0;

    // B. Productos (activas cuentan facturación; bonificadas cuentan unidades)
    const ventasContables = ventas.filter((v) => v.estado === "activa" || v.estado === "bonificada");
    let gorras = 0, buzos = 0, unidades = 0, factGorras = 0, factBuzos = 0, factProductos = 0;
    const prodPorMetodo: Record<string, { cantidad: number; total: number }> = {};
    const prodPorPosnet: Record<string, { cantidad: number; total: number }> = {};
    ventasContables.forEach((v) => {
      const esGorra = /gorra/i.test(v.producto_nombre); const esBuzo = /buzo/i.test(v.producto_nombre);
      unidades += v.cantidad;
      if (esGorra) gorras += v.cantidad; if (esBuzo) buzos += v.cantidad;
      if (v.estado === "activa") {
        factProductos += v.total;
        if (esGorra) factGorras += v.total; if (esBuzo) factBuzos += v.total;
        normalizarPagos(v.pagos_detalle, v.metodo_pago || undefined, v.total, v.posnet_pago).filter((p) => Number(p.monto) > 0).forEach((p) => {
          const metodo = formatearPago(p.metodo_pago); const monto = Number(p.monto) || 0;
          prodPorMetodo[metodo] = prodPorMetodo[metodo] || { cantidad: 0, total: 0 };
          prodPorMetodo[metodo].cantidad += 1; prodPorMetodo[metodo].total += monto;
          if (p.posnet_pago && metodoUsaPosnet(p.metodo_pago)) {
            prodPorPosnet[p.posnet_pago] = prodPorPosnet[p.posnet_pago] || { cantidad: 0, total: 0 };
            prodPorPosnet[p.posnet_pago].cantidad += 1; prodPorPosnet[p.posnet_pago].total += monto;
          }
        });
      }
    });

    // C. Total combinado por método (turnos + ventas activas)
    const LBL: Record<string, string> = { efectivo: "Efectivo", qr: "Mercado Pago / QR", debito: "Débito", credito: "Crédito", transferencia: "Transferencia" };
    const porMetodoTotal: Record<string, number> = {};
    const posnetTotal: Record<string, number> = {};
    const addPagos = (arr: PagoDetalle[]) => arr.filter((p) => Number(p.monto) > 0).forEach((p) => {
      const lbl = LBL[p.metodo_pago] || formatearPago(p.metodo_pago); const monto = Number(p.monto) || 0;
      porMetodoTotal[lbl] = (porMetodoTotal[lbl] || 0) + monto;
      if (p.posnet_pago && metodoUsaPosnet(p.metodo_pago)) posnetTotal[p.posnet_pago] = (posnetTotal[p.posnet_pago] || 0) + monto;
    });
    turnosValidos.forEach((t) => addPagos(pagosDelTurno(t)));
    ventas.filter((v) => v.estado === "activa").forEach((v) => addPagos(normalizarPagos(v.pagos_detalle, v.metodo_pago || undefined, v.total, v.posnet_pago)));

    return {
      a: { ...aGrup, personas, minutosVendidos, turnosGratis, facturacionSim, promedioPorTurno },
      b: { gorras, buzos, unidades, factGorras, factBuzos, factProductos, prodPorMetodo, prodPorPosnet },
      c: { facturacionSim, factProductos, totalCombinado: facturacionSim + factProductos, porMetodoTotal, posnetTotal },
    };
  }, [turnos, ventas]);

  return (
    <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="mb-4 text-2xl font-black uppercase text-red-500">Resumen general del evento</h2>

      <h3 className="mb-2 text-sm font-black uppercase tracking-[0.15em] text-white/50">A · Actividad de simuladores</h3>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Turnos" valor={String(r.a.cantidadTurnos)} />
        <Kpi label="Personas" valor={String(r.a.personas)} />
        <Kpi label="Minutos vendidos" valor={String(r.a.minutosVendidos)} />
        <Kpi label="Turnos gratis" valor={String(r.a.turnosGratis)} />
        <Kpi label="Facturación turnos" valor={dinero(r.a.facturacionSim)} destacado />
        <Kpi label="Prom. por turno" valor={dinero(r.a.promedioPorTurno)} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <ResumenBox titulo="Por duración" data={r.a.porMinutos} />
        <ResumenBox titulo="Por simulador" data={r.a.porSimulador} />
        <ResumenBox titulo="Por personas" data={r.a.porPersonas} />
        <ResumenBox titulo="Recaudación por método" data={r.a.porMetodo} />
        <ResumenBox titulo="Por posnet" data={r.a.porPosnet} />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-black uppercase tracking-[0.15em] text-white/50">B · Venta de productos</h3>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Gorras vendidas" valor={String(r.b.gorras)} />
        <Kpi label="Buzos vendidos" valor={String(r.b.buzos)} />
        <Kpi label="Unidades totales" valor={String(r.b.unidades)} />
        <Kpi label="Fact. gorras" valor={dinero(r.b.factGorras)} />
        <Kpi label="Fact. buzos" valor={dinero(r.b.factBuzos)} />
        <Kpi label="Fact. productos" valor={dinero(r.b.factProductos)} destacado />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <ResumenBox titulo="Recaudación por método" data={r.b.prodPorMetodo} />
        <ResumenBox titulo="Por posnet" data={r.b.prodPorPosnet} />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-black uppercase tracking-[0.15em] text-white/50">C · Total del evento</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <Kpi label="Facturación simuladores" valor={dinero(r.c.facturacionSim)} />
        <Kpi label="Facturación productos" valor={dinero(r.c.factProductos)} />
        <Kpi label="Facturación total combinada" valor={dinero(r.c.totalCombinado)} destacado />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">Total por método (simuladores + productos)</p>
          {Object.keys(r.c.porMetodoTotal).length === 0 ? <p className="text-sm text-white/45">Sin cobros.</p> : (
            <div className="space-y-2">{Object.entries(r.c.porMetodoTotal).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm"><span className="font-bold text-white/70">{k}</span><span className="font-black text-red-500">{dinero(v)}</span></div>
            ))}</div>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">Desglose por posnet</p>
          {Object.keys(r.c.posnetTotal).length === 0 ? <p className="text-sm text-white/45">Sin posnet.</p> : (
            <div className="space-y-2">{Object.entries(r.c.posnetTotal).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm"><span className="font-bold text-white/70">{k}</span><span className="font-black text-red-500">{dinero(v)}</span></div>
            ))}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── UI compartida ─────────────────────────────────────────────────────────────
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{label}</label>{children}</div>;
}
function Kpi({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return <div className="rounded-2xl border border-white/10 bg-black p-4"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">{label}</p><p className={`mt-1 text-xl font-black ${destacado ? "text-red-400" : "text-white"}`}>{valor}</p></div>;
}
function ResumenBox({ titulo, data }: { titulo: string; data: Record<string, number | { cantidad: number; total: number }> }) {
  const entries = Object.entries(data);
  return (
    <div className="rounded-2xl border border-white/10 bg-black p-4">
      <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">{titulo}</p>
      {entries.length === 0 ? <p className="text-sm text-white/45">Sin datos</p> : (
        <div className="space-y-2">
          {entries.map(([k, v]) => {
            const obj = typeof v === "object" && v !== null && "total" in v;
            return (
              <div key={k} className="flex items-start justify-between gap-3 text-sm">
                <span className="font-bold text-white/70">{k}</span>
                <span className="text-right font-black">{obj ? <>{(v as { cantidad: number }).cantidad} / <span className="text-red-500">{dinero((v as { total: number }).total)}</span></> : (v as number)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

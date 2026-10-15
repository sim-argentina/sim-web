"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getTurnoTimerState, useNow, TURNO_BADGE_CLASS } from "@/lib/turnoTimer";
import {
  SIMULADORES_COLECTIVO, METODOS_PAGO_COLECTIVO, POSNETS_COLECTIVO,
  DURACIONES_SUGERIDAS, DURACION_DEFAULT, ESTADO_EVENTO_LABEL,
  PERSONAS_COLECTIVO, turnosColectivo, esVendibleEnEvento, resumirVentasPorProducto,
  CANTIDADES_VENTA_COLECTIVO, MEDIOS_PAGO_GASTO_COLECTIVO, PILL_TIPO_CAJA,
  type TipoCaja, type ResumenCajaEvento, type InformeEvento, type LineaInforme,
} from "@/lib/colectivo";
import { hoyEnSim } from "@/lib/agenda";

const PESTANAS_EVENTO = [
  { value: "turnero", label: "Turnero" },
  { value: "productos", label: "Productos" },
  { value: "caja", label: "Caja" },
  { value: "informe", label: "Informe" },
] as const;
type Pestana = (typeof PESTANAS_EVENTO)[number]["value"];

// ─── Tipos ────────────────────────────────────────────────────────────────────
type PagoDetalle = { metodo_pago: string; monto: number | string; posnet_pago?: string | null };
type Evento = {
  id: string; nombre: string; fecha_inicio: string; fecha_fin: string;
  hora_inicio: string | null; hora_fin: string | null; localidad: string | null;
  provincia: string | null; ubicacion: string | null; organizador: string | null;
  telefono_contacto: string | null; observaciones: string | null; estado: string;
};
type Turno = {
  id: number; evento_id: string;
  fecha: string; hora?: string | null;
  hora_subida?: string | null; hora_bajada?: string | null; simuladores?: string[] | string;
  cantidad_personas?: number; cantidad_minutos?: number; cantidad_turnos?: number;
  total?: number; metodo_pago?: string; turno_listo?: boolean; posnet_pago?: string | null;
  pagos_detalle?: PagoDetalle[] | string; estado?: string; observaciones?: string | null;
};
// Producto del catálogo con su disponibilidad en este evento. El admin recibe todo
// el catálogo; el staff, solo los vendibles.
type Producto = { id: string; nombre: string; precio_predeterminado: number; activo: boolean; habilitado: boolean };
type Venta = {
  id: string; evento_id: string; producto_id: string | null; producto_nombre: string;
  fecha: string; fecha_hora: string; cantidad: number; precio_unitario: number; total: number;
  observaciones?: string | null;
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
  const [pestana, setPestana] = useState<Pestana>("turnero");
  const now = useNow();

  const cargar = useCallback(async () => {
    const [evR, tuR, veR, prR] = await Promise.all([
      fetch(`/api/admin/colectivo/eventos/${eventoId}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/colectivo/eventos/${eventoId}/turnos`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/colectivo/eventos/${eventoId}/ventas`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/colectivo/eventos/${eventoId}/productos`, { cache: "no-store" }).then((r) => r.json()),
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

          {/* Selector de día del evento (la caja y el informe son de todo el evento: no lo usan) */}
          <div className={`mt-4 flex flex-wrap items-center gap-2 ${pestana === "caja" || pestana === "informe" ? "hidden" : ""}`}>
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

        {/* Pestañas del evento */}
        <div className="mb-6 flex flex-wrap gap-2">
          {PESTANAS_EVENTO.map((p) => (
            <button key={p.value} onClick={() => setPestana(p.value)} className={`rounded-full border px-5 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${pestana === p.value ? "border-red-500 bg-red-600 text-white" : "border-white/15 bg-black text-white/60 hover:border-red-500 hover:text-white"}`}>
              {p.label}
            </button>
          ))}
        </div>

        {pestana === "turnero" && (
          <>
            {/* Turnero del día */}
            {!cerrado && <TurneroForm eventoId={eventoId} dia={dia} onSaved={cargar} />}

            <TurnosGuardados turnos={turnosDelDia} dia={dia} now={now} cerrado={cerrado} eventoId={eventoId} esAdmin={esAdmin} onSaved={cargar} />

            <ResumenDia turnos={turnosDelDia} dia={dia} />
          </>
        )}

        {pestana === "productos" && (
          /* Venta de productos */
          <VentaProductos eventoId={eventoId} dia={dia} productos={productos} ventas={ventasDelDia} cerrado={cerrado} esAdmin={esAdmin} onSaved={cargar} onProductosChange={cargar} />
        )}

        {/* Resumen general del evento (turnos + productos), en las dos pestañas operativas */}
        {(pestana === "turnero" || pestana === "productos") && <ResumenGeneral turnos={turnos} ventas={ventas} />}

        {pestana === "caja" && <CajaEvento eventoId={eventoId} cerrado={cerrado} esAdmin={esAdmin} />}

        {pestana === "informe" && <InformeDelEvento eventoId={eventoId} />}
      </section>
    </main>
  );
}

// ═════════ Formulario de turno ═════════
// Turnos = personas (4 personas × 30' = 4 turnos). El servidor lo vuelve a
// imponer: lo que muestra este campo es solo informativo.
function TurneroForm({ eventoId, dia, onSaved, editando, onCancelEdit }: {
  eventoId: string; dia: string; onSaved: () => void; editando?: Turno | null; onCancelEdit?: () => void;
}) {
  const [hora, setHora] = useState(horaActual());
  const [horaSubida, setHoraSubida] = useState("");
  const [horaBajada, setHoraBajada] = useState("");
  const [simuladores, setSimuladores] = useState<string[]>([]);
  const [personas, setPersonas] = useState(1);
  const [minutos, setMinutos] = useState(DURACION_DEFAULT);
  const [pagos, setPagos] = useState<PagoDetalle[]>([{ metodo_pago: "efectivo", monto: "", posnet_pago: "" }]);
  const [observaciones, setObservaciones] = useState("");
  const [gratis, setGratis] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!editando) return;
    setHora(editando.hora || horaActual());
    setHoraSubida(editando.hora_subida || "");
    setHoraBajada(editando.hora_bajada || "");
    setSimuladores(normalizarSimuladores(editando.simuladores));
    setPersonas(editando.cantidad_personas || 1);
    setMinutos(editando.cantidad_minutos || DURACION_DEFAULT);
    setPagos(normalizarPagos(editando.pagos_detalle, editando.metodo_pago, editando.total, editando.posnet_pago));
    setObservaciones(editando.observaciones || "");
    setGratis(editando.metodo_pago === "gratis");
  }, [editando]);

  const turnos = turnosColectivo(personas);
  const totalPagos = useMemo(() => pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0), [pagos]);
  // Un turno histórico puede tener más de 6 personas: se muestra su valor para
  // poder editar el resto sin cambiarlo.
  const opcionesPersonas: number[] = (PERSONAS_COLECTIVO as readonly number[]).includes(personas)
    ? [...PERSONAS_COLECTIVO]
    : [...PERSONAS_COLECTIVO, personas];

  const reset = () => {
    setHora(horaActual()); setHoraSubida(""); setHoraBajada("");
    setSimuladores([]); setPersonas(1); setMinutos(DURACION_DEFAULT);
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
        fecha: dia, hora, hora_subida: horaSubida, hora_bajada: horaBajada,
        simuladores, cantidad_personas: personas, cantidad_minutos: minutos,
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Campo label="Hora toma"><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inp} /></Campo>
        <Campo label="Hora subida · opcional"><input type="time" value={horaSubida} onChange={(e) => setHoraSubida(e.target.value)} className={inp} /></Campo>
        <Campo label="Hora bajada · opcional"><input type="time" value={horaBajada} onChange={(e) => setHoraBajada(e.target.value)} className={inp} /></Campo>
        <Campo label="Personas">
          <select value={personas} onChange={(e) => setPersonas(Number(e.target.value))} className={inp}>
            {opcionesPersonas.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Campo>
        <div>
          <Campo label="Minutos">
            <input type="number" min={1} value={minutos} onChange={(e) => setMinutos(Math.max(1, Number(e.target.value) || 1))} className={inp} />
          </Campo>
          <div className="mt-1 flex gap-1">
            {DURACIONES_SUGERIDAS.map((d) => (
              <button key={d} type="button" onClick={() => setMinutos(d)} className={`rounded-lg border px-2 py-1 text-[11px] font-black ${minutos === d ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/50 hover:border-red-500"}`}>{d}′</button>
            ))}
          </div>
        </div>
        <Campo label="Turnos"><input readOnly tabIndex={-1} value={turnos} title="Turnos = personas" className={`${inp} opacity-60`} /></Campo>
        <Campo label="Total"><input readOnly tabIndex={-1} value={dinero(gratis ? 0 : totalPagos)} className={`${inp} opacity-60`} /></Campo>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px]">
        <Campo label="Observaciones"><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Notas internas" className={inp} /></Campo>
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
const COLS_TURNOS = "grid-cols-[56px_96px_64px_64px_minmax(140px,1.2fr)_60px_56px_76px_minmax(150px,1.4fr)_100px_100px_88px]";

function TurnosGuardados({ turnos, dia, now, cerrado, eventoId, esAdmin, onSaved }: {
  turnos: Turno[]; dia: string; now: number; cerrado: boolean; eventoId: string; esAdmin: boolean; onSaved: () => void;
}) {
  const [editando, setEditando] = useState<Turno | null>(null);
  const [aEliminar, setAEliminar] = useState<Turno | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const totalTurnos = useMemo(() => turnos.reduce((a, t) => a + (Number(t.cantidad_turnos) || 1), 0), [turnos]);

  // Solo marca / desmarca "listo": no reescribe el resto del turno.
  const toggleListo = async (t: Turno, valor: boolean) => {
    const r = await fetch(`/api/admin/colectivo/turnos/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "listo", turno_listo: valor }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); }
    onSaved();
  };

  // Elimina físicamente el turno de colectivo (definitivo). Solo admin. NO toca
  // ventas de productos: el resumen del evento recalcula al releer los turnos.
  const eliminar = async () => {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/admin/colectivo/turnos/${aEliminar.id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => null); alert(d?.error || "No se pudo eliminar el turno"); return; }
      setAEliminar(null);
      onSaved();
    } finally { setEliminando(false); }
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
        <div className="rounded-full border border-white/10 px-4 py-2 text-sm font-bold text-white/70">{totalTurnos} turnos</div>
      </div>

      {turnos.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black p-5 text-white/60">No hay turnos cargados para este día.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1080px] space-y-2">
            <div className={`grid ${COLS_TURNOS} gap-2 px-3 text-xs font-black uppercase tracking-[0.15em] text-white/35`}>
              <span>Listo</span><span>Toma</span><span>Sube</span><span>Baja</span><span>Simus</span><span>Pers.</span><span>Min.</span><span>Turnos</span><span>Pago</span><span>Posnet</span><span>Total</span><span></span>
            </div>
            {turnos.map((t) => {
              const simus = normalizarSimuladores(t.simuladores);
              const pagos = pagosDelTurno(t);
              const posnets = pagos.length ? (pagos.map((p) => p.posnet_pago).filter(Boolean).join(" + ") || "-") : (t.posnet_pago || "-");
              const listo = Boolean(t.turno_listo);
              const timer = getTurnoTimerState({ fecha: t.fecha, horaSubida: t.hora_subida, minutos: t.cantidad_minutos, listo: t.turno_listo, cancelado: t.estado === "cancelado" }, now);
              const pagoStr = pagos.length ? pagos.map((p) => `${formatearPago(p.metodo_pago)} ${dinero(Number(p.monto) || 0)}`).join(" + ") : formatearPago(t.metodo_pago);
              return (
                <div key={t.id} className={`grid ${COLS_TURNOS} items-center gap-2 rounded-xl border px-3 py-2 text-sm ${timer.status === "listo" ? "border-green-500/50 bg-green-950/25" : timer.status === "rojo" ? "border-red-500/60 bg-red-950/30" : timer.status === "amarillo" ? "border-amber-500/50 bg-amber-950/20" : "border-white/10 bg-black"}`}>
                  <label className="flex items-center justify-center">
                    <input type="checkbox" checked={listo} disabled={cerrado} onChange={(e) => toggleListo(t, e.target.checked)} className="h-5 w-5 accent-red-600 disabled:opacity-40" />
                  </label>
                  <div className="min-w-0">
                    <p className={`font-black ${listo ? "text-white/60 line-through" : ""}`}>{t.hora || "-"}</p>
                    <span className={`mt-1 inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${TURNO_BADGE_CLASS[timer.status]}`}>{timer.label}</span>
                  </div>
                  <span className="text-white/70">{t.hora_subida || "-"}</span>
                  <span className="text-white/70">{t.hora_bajada || "-"}</span>
                  <span className="truncate text-white/70">{simus.length ? simus.join(", ") : "-"}</span>
                  <span>{t.cantidad_personas || 1}</span>
                  <span>{t.cantidad_minutos || DURACION_DEFAULT}</span>
                  <span>{t.cantidad_turnos || 1}</span>
                  <span className="truncate">{pagoStr}</span>
                  <span>{posnets}</span>
                  <span className="font-black text-red-500">{dinero(Number(t.total || 0))}</span>
                  <div className="flex flex-col gap-1">
                    {/* Editar sigue bloqueado en eventos cerrados. */}
                    {!cerrado && (
                      <button onClick={() => { setEditando(t); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 hover:border-red-500 hover:bg-red-600 hover:text-white">Editar</button>
                    )}
                    {/* Eliminar (admin) es independiente del estado del evento: se
                        puede borrar el turno aunque el evento esté finalizado/cancelado,
                        sin reabrirlo ni modificarlo. */}
                    {esAdmin && (
                      <button onClick={() => setAEliminar(t)} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-[11px] font-black uppercase text-red-400 hover:bg-red-600 hover:text-white">Eliminar</button>
                    )}
                    {cerrado && !esAdmin && <span className="text-white/30 text-xs">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Eliminar turno de colectivo (definitivo): solo admin. No toca ventas. */}
      {aEliminar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setAEliminar(null)}>
          <div className="w-full max-w-md rounded-3xl border border-red-500/30 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-white">Eliminar turno</h3>
            <p className="mt-2 text-sm text-white/60">
              Este turno se eliminará definitivamente y no podrá recuperarse. Dejará de contar en el resumen del evento. Las ventas de productos no se tocan.
            </p>
            <div className="mt-3 space-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-white/45">Fecha / Hora</span><span className="font-bold text-white">{aEliminar.fecha} · {aEliminar.hora || "-"}</span></div>
              <div className="flex justify-between gap-4"><span className="text-white/45">Personas / Turnos</span><span className="font-bold text-white">{aEliminar.cantidad_personas || 1} / {aEliminar.cantidad_turnos || 1}</span></div>
              <div className="flex justify-between gap-4"><span className="text-white/45">Minutos</span><span className="font-bold text-white">{aEliminar.cantidad_minutos || DURACION_DEFAULT}</span></div>
              <div className="flex justify-between gap-4"><span className="text-white/45">Simuladores</span><span className="font-bold text-white text-right">{normalizarSimuladores(aEliminar.simuladores).join(", ") || "-"}</span></div>
              <div className="flex justify-between gap-4"><span className="text-white/45">Importe</span><span className="font-black text-red-500">{dinero(Number(aEliminar.total || 0))}</span></div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setAEliminar(null)} disabled={eliminando} className="rounded-xl border border-white/10 px-5 py-2 text-sm font-bold text-zinc-300 hover:text-white disabled:opacity-50">Cancelar</button>
              <button onClick={eliminar} disabled={eliminando} className="rounded-xl bg-red-600 px-6 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50">{eliminando ? "Eliminando..." : "Eliminar definitivamente"}</button>
            </div>
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
// Solo se venden los productos activos en el catálogo y habilitados en este
// evento. Una venta ya registrada conserva su producto aunque después se
// deshabilite: al editarla se sigue mostrando como "(no disponible)".
function VentaProductos({ eventoId, dia, productos, ventas, cerrado, esAdmin, onSaved, onProductosChange }: {
  eventoId: string; dia: string; productos: Producto[]; ventas: Venta[]; cerrado: boolean; esAdmin: boolean; onSaved: () => void; onProductosChange: () => void;
}) {
  const [productoNombre, setProductoNombre] = useState("");
  const [productoId, setProductoId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [precio, setPrecio] = useState(0);
  const [observaciones, setObservaciones] = useState("");
  const [pagos, setPagos] = useState<PagoDetalle[]>([{ metodo_pago: "efectivo", monto: "", posnet_pago: "" }]);
  const [bonificada, setBonificada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const total = useMemo(() => Math.round(cantidad * precio), [cantidad, precio]);
  const vendibles = useMemo(() => productos.filter(esVendibleEnEvento), [productos]);
  const opciones = useMemo(() => {
    const ops = vendibles.map((p) => ({ value: p.id, label: p.nombre }));
    if (editId && !vendibles.some((p) => p.id === productoId)) {
      ops.unshift({ value: productoId ?? "", label: `${productoNombre} (no disponible)` });
    }
    return ops;
  }, [vendibles, editId, productoId, productoNombre]);
  // 1..20; una venta histórica con más unidades muestra su valor para poder
  // editar el resto sin cambiarlo.
  const opcionesCantidad: number[] = CANTIDADES_VENTA_COLECTIVO.includes(cantidad)
    ? [...CANTIDADES_VENTA_COLECTIVO]
    : [...CANTIDADES_VENTA_COLECTIVO, cantidad];

  // El subtotal (y lo que deben sumar los pagos) sale de cantidad × precio. Un
  // único pago que cubría el subtotal anterior acompaña al nuevo; pagos
  // divididos o cargados a mano no se tocan.
  const cambiarCantidad = (n: number) => {
    const subtotalAnterior = Math.round(cantidad * precio);
    setCantidad(n);
    setPagos((a) => (a.length === 1 && subtotalAnterior > 0 && Number(a[0].monto) === subtotalAnterior
      ? [{ ...a[0], monto: String(Math.round(n * precio)) }]
      : a));
  };

  const elegirProducto = (id: string) => {
    const p = vendibles.find((x) => x.id === id);
    if (!p) return;
    setProductoNombre(p.nombre);
    setProductoId(p.id);
    if (!editId) { setPrecio(p.precio_predeterminado); setPagos([{ metodo_pago: "efectivo", monto: String(p.precio_predeterminado * cantidad), posnet_pago: "" }]); }
  };
  const reset = () => {
    setProductoNombre(""); setProductoId(null); setCantidad(1); setPrecio(0);
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
    setCantidad(v.cantidad); setPrecio(v.precio_unitario);
    setObservaciones(v.observaciones || "");
    setPagos(normalizarPagos(v.pagos_detalle, v.metodo_pago || undefined, v.total, v.posnet_pago));
    setBonificada(v.estado === "bonificada");
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  const guardar = async () => {
    if (!productoId && !editId) { alert("Elegí un producto."); return; }
    setGuardando(true);
    try {
      const payload = {
        producto_id: productoId, fecha: dia,
        cantidad, precio_unitario: precio, observaciones,
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
        {esAdmin && !cerrado && (
          <button onClick={() => setShowConfig((s) => !s)} className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-black uppercase text-white/60 hover:border-white hover:text-white">Productos del evento</button>
        )}
      </div>

      {esAdmin && !cerrado && showConfig && <ProductosDelEvento eventoId={eventoId} productos={productos} onChange={onProductosChange} />}

      {!cerrado && (
        <div className="mb-5 rounded-2xl border border-white/10 bg-black/60 p-4">
          {vendibles.length === 0 && !editId && (
            <p className="mb-3 text-sm font-bold text-amber-300">
              No hay productos habilitados para este evento.{esAdmin ? " Habilitalos en «Productos del evento»." : ""}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-4">
            <Campo label="Producto">
              <select value={productoId ?? ""} onChange={(e) => elegirProducto(e.target.value)} className={inp}>
                {!editId && <option value="">Elegir...</option>}
                {opciones.map((o) => <option key={o.value || "historico"} value={o.value}>{o.label}</option>)}
              </select>
            </Campo>
            <Campo label="Cantidad">
              <select value={cantidad} onChange={(e) => cambiarCantidad(Number(e.target.value))} className={inp}>
                {opcionesCantidad.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Campo>
            <Campo label="Precio unitario"><input type="number" min={0} value={precio} onChange={(e) => setPrecio(Math.max(0, Number(e.target.value) || 0))} className={inp} /></Campo>
            <Campo label="Subtotal"><input readOnly value={dinero(total)} className={`${inp} opacity-60`} /></Campo>
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
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[10px] font-black uppercase tracking-[0.12em] text-white/35"><tr><th className="pb-2">Producto</th><th className="pb-2">Cant.</th><th className="pb-2">P. unit.</th><th className="pb-2">Total</th><th className="pb-2">Pago</th><th className="pb-2">Estado</th><th className="pb-2"></th></tr></thead>
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

// Qué productos del catálogo se venden en este evento (solo admin). Se puede
// cambiar con el evento en curso: habilitar lo suma a la venta al instante y
// deshabilitar lo saca de las ventas nuevas, sin tocar las ya registradas.
function ProductosDelEvento({ eventoId, productos, onChange }: { eventoId: string; productos: Producto[]; onChange: () => void }) {
  const [guardando, setGuardando] = useState<string | null>(null);
  const cambiar = async (p: Producto, habilitado: boolean) => {
    setGuardando(p.id);
    try {
      const r = await fetch(`/api/admin/colectivo/eventos/${eventoId}/productos`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ producto_id: p.id, habilitado }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); return; }
      onChange();
    } finally { setGuardando(null); }
  };
  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-black p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Productos disponibles en este evento</p>
        <Link href="/admin/colectivo/productos" className="text-[11px] font-black uppercase text-red-400 hover:text-red-300">Administrar catálogo →</Link>
      </div>
      {productos.length === 0 ? (
        <p className="text-sm text-white/45">El catálogo está vacío. Creá productos desde «Administrar catálogo».</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {productos.map((p) => {
            // Un producto inactivo no se puede habilitar; si quedó habilitado, se puede quitar.
            const bloqueado = guardando !== null || (!p.activo && !p.habilitado);
            return (
              <label key={p.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${p.habilitado && p.activo ? "border-red-500/50 bg-red-950/20" : "border-white/10 bg-white/[0.02]"} ${bloqueado ? "opacity-60" : "cursor-pointer"}`}>
                <input type="checkbox" checked={p.habilitado} disabled={bloqueado} onChange={(e) => cambiar(p, e.target.checked)} className="h-4 w-4 accent-red-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{p.nombre}</span>
                  <span className="block text-xs text-white/45">{dinero(p.precio_predeterminado)}{!p.activo ? " · inactivo en catálogo" : ""}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
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

    // B. Productos (activas cuentan facturación; bonificadas cuentan unidades).
    // Por producto según lo que dice cada venta: sin nombres fijos.
    const porProducto = resumirVentasPorProducto(ventas);
    const unidades = porProducto.reduce((a, p) => a + p.unidades, 0);
    const factProductos = porProducto.reduce((a, p) => a + p.total, 0);
    const prodPorMetodo: Record<string, { cantidad: number; total: number }> = {};
    const prodPorPosnet: Record<string, { cantidad: number; total: number }> = {};
    ventas.forEach((v) => {
      if (v.estado === "activa") {
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
      b: { porProducto, unidades, factProductos, prodPorMetodo, prodPorPosnet },
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
      <div className="grid gap-3 md:grid-cols-2">
        <Kpi label="Unidades totales" valor={String(r.b.unidades)} />
        <Kpi label="Fact. productos" valor={dinero(r.b.factProductos)} destacado />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">Por producto</p>
          {r.b.porProducto.length === 0 ? <p className="text-sm text-white/45">Sin ventas</p> : (
            <div className="space-y-2">
              {r.b.porProducto.map((p) => (
                <div key={p.nombre} className="flex items-start justify-between gap-3 text-sm">
                  <span className="font-bold text-white/70">{p.nombre}</span>
                  <span className="text-right font-black">{p.unidades} {p.unidades === 1 ? "unidad" : "unidades"} / <span className="text-red-500">{dinero(p.total)}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
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

// ═════════ Caja del evento ═════════
// La caja del Colectivo es interna al evento y no forma parte de Finanzas SIM:
// registra los costos y gastos del evento y muestra ingresos − costos − gastos =
// neto. El resumen lo calcula el servidor (calcularCajaEvento) y se vuelve a
// pedir después de cada alta, edición o eliminación. El tipo de cada movimiento
// (costo/gasto) no se elige: sale de la categoría y queda guardado al registrarlo.
type Movimiento = {
  id: string; fecha: string; categoria_id: string; categoria_nombre: string; tipo: TipoCaja;
  concepto: string; monto: number | string; medio_pago: string; observaciones: string | null; created_at: string;
};
type CategoriaCaja = { id: string; nombre: string; tipo: TipoCaja; activo: boolean };
const etiquetaMedio = (v: string) => MEDIOS_PAGO_GASTO_COLECTIVO.find((m) => m.value === v)?.label ?? v;
function dineroCaja(v: number | string) {
  const n = Number(v) || 0;
  const abs = Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}$${abs}`;
}
function horaDeCarga(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });
}
const movimientoVacio = () => ({ fecha: hoyEnSim(), categoria_id: "", concepto: "", monto: "", medio_pago: "efectivo", observaciones: "" });
// Selects de filtro: mismo estilo que los campos, con ancho propio (no a todo el ancho).
const inpFiltro = "rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500";
function PillTipo({ tipo }: { tipo: TipoCaja }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] ${PILL_TIPO_CAJA[tipo]}`}>{tipo}</span>;
}

function CajaEvento({ eventoId, cerrado, esAdmin }: { eventoId: string; cerrado: boolean; esAdmin: boolean }) {
  const [resumen, setResumen] = useState<ResumenCajaEvento | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [categorias, setCategorias] = useState<CategoriaCaja[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState(movimientoVacio);
  // Al editar: la categoría, el tipo y el nombre con que se registró el movimiento.
  const [editando, setEditando] = useState<Movimiento | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<"" | TipoCaja>("");
  const [filtroCategoria, setFiltroCategoria] = useState("");

  const cargar = useCallback(async () => {
    const r = await fetch(`/api/admin/colectivo/eventos/${eventoId}/caja`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error || "No se pudo cargar la caja"); return; }
    setError("");
    setResumen(d.resumen);
    setMovimientos(Array.isArray(d.movimientos) ? d.movimientos : []);
    setCategorias(Array.isArray(d.categorias) ? d.categorias : []);
  }, [eventoId]);
  useEffect(() => { cargar(); }, [cargar]);

  const activas = useMemo(() => categorias.filter((c) => c.activo), [categorias]);
  // Opciones del formulario: las activas; al editar, también la categoría del
  // movimiento aunque hoy esté inactiva o se haya renombrado.
  const opcionesCategoria = useMemo(() => {
    const ops = activas.map((c) => ({ value: c.id, label: c.nombre }));
    if (editando && !activas.some((c) => c.id === editando.categoria_id)) {
      ops.unshift({ value: editando.categoria_id, label: `${editando.categoria_nombre} (inactiva)` });
    }
    return ops;
  }, [activas, editando]);
  // Tipo que va a tener el movimiento: el guardado si no se cambia la categoría,
  // el de la categoría elegida si se cambia.
  const tipoElegido: TipoCaja | null = editando && form.categoria_id === editando.categoria_id
    ? editando.tipo
    : (categorias.find((c) => c.id === form.categoria_id)?.tipo ?? null);

  const filtrados = useMemo(
    () => movimientos.filter((m) => (!filtroTipo || m.tipo === filtroTipo) && (!filtroCategoria || m.categoria_id === filtroCategoria)),
    [movimientos, filtroTipo, filtroCategoria],
  );
  // Filtro por categoría: las que tienen movimientos en este evento.
  const categoriasConMovimientos = useMemo(() => {
    const vistas = new Map<string, string>();
    for (const m of movimientos) {
      if (!vistas.has(m.categoria_id)) vistas.set(m.categoria_id, categorias.find((c) => c.id === m.categoria_id)?.nombre ?? m.categoria_nombre);
    }
    return [...vistas.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [movimientos, categorias]);

  const set = (k: keyof ReturnType<typeof movimientoVacio>, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const reset = () => { setForm(movimientoVacio()); setEditando(null); };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const url = editando ? `/api/admin/colectivo/gastos/${editando.id}` : `/api/admin/colectivo/eventos/${eventoId}/caja`;
      const r = await fetch(url, {
        method: editando ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, monto: form.monto === "" ? null : Number(form.monto) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || "Error"); return; }
      reset();
      await cargar();
    } finally { setGuardando(false); }
  };
  const abrirEdicion = (m: Movimiento) => {
    setEditando(m);
    setForm({ fecha: m.fecha, categoria_id: m.categoria_id, concepto: m.concepto, monto: String(Number(m.monto)), medio_pago: m.medio_pago, observaciones: m.observaciones || "" });
    document.getElementById("caja-registrar-movimiento")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const eliminar = async (m: Movimiento) => {
    if (!confirm(`¿Eliminar el movimiento «${m.concepto}» de ${dineroCaja(m.monto)}?`)) return;
    const r = await fetch(`/api/admin/colectivo/gastos/${m.id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Error"); return; }
    if (editando?.id === m.id) reset();
    await cargar();
  };

  const neto = resumen?.neto ?? 0;
  const cantidad = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-black uppercase text-red-500">Caja del evento</h2>
        <div className="flex flex-wrap items-center gap-3">
          {esAdmin && <Link href="/admin/colectivo/categorias-caja" className="text-[11px] font-black uppercase text-red-400 hover:text-red-300">Categorías de caja →</Link>}
          <p className="rounded-xl border border-white/10 bg-black px-3 py-1 text-[11px] font-bold text-white/55">Uso interno del Colectivo. No impacta en Finanzas SIM.</p>
        </div>
      </div>

      {error && <p className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm font-bold text-red-300">{error}</p>}

      {/* Indicadores principales */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Ingresos</p>
          <p className="mt-1 text-2xl font-black text-white">{resumen ? dineroCaja(resumen.ingresos) : "…"}</p>
          {resumen && <p className="mt-1 text-xs text-white/45">Turnos {dineroCaja(resumen.ingresosTurnos)} · Productos {dineroCaja(resumen.ingresosProductos)}</p>}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Costos</p>
          <p className="mt-1 text-2xl font-black text-white">{resumen ? dineroCaja(resumen.costos) : "…"}</p>
          {resumen && <p className="mt-1 text-xs text-white/45">{cantidad(resumen.cantidadCostos, "costo", "costos")}</p>}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Gastos</p>
          <p className="mt-1 text-2xl font-black text-white">{resumen ? dineroCaja(resumen.gastos) : "…"}</p>
          {resumen && <p className="mt-1 text-xs text-white/45">{cantidad(resumen.cantidadGastos, "gasto", "gastos")}</p>}
        </div>
        <div className={`rounded-2xl border p-4 ${neto < 0 ? "border-red-500/40 bg-red-950/20" : "border-green-500/30 bg-green-950/15"}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Neto</p>
          <p className={`mt-1 text-2xl font-black ${neto < 0 ? "text-red-400" : "text-green-300"}`}>{resumen ? dineroCaja(neto) : "…"}</p>
          <p className="mt-1 text-xs text-white/45">Ingresos − costos − gastos</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Registrar costo / gasto */}
        {cerrado ? (
          <div className="rounded-2xl border border-white/10 bg-black p-4 text-sm font-bold text-white/55">El evento está cerrado: la caja es de solo consulta.</div>
        ) : (
          <form id="caja-registrar-movimiento" onSubmit={guardar} className="rounded-2xl border border-white/10 bg-black/60 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-[0.15em] text-white/70">{editando ? "Editar movimiento" : "Registrar costo / gasto"}</h3>
              {editando && <button type="button" onClick={reset} className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-black uppercase text-white/60 hover:border-white hover:text-white">Cancelar edición</button>}
            </div>
            {activas.length === 0 && !editando && (
              <p className="mb-3 text-sm font-bold text-amber-300">No hay categorías activas.{esAdmin ? " Creálas en «Categorías de caja»." : " Pedile al admin que las habilite."}</p>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Campo label="Fecha"><input type="date" required value={form.fecha} onChange={(e) => set("fecha", e.target.value)} className={inp} /></Campo>
              <div>
                <Campo label="Categoría">
                  <select required value={form.categoria_id} onChange={(e) => set("categoria_id", e.target.value)} className={inp}>
                    {!editando && <option value="">Elegir...</option>}
                    {opcionesCategoria.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Campo>
                <p className="mt-1 h-5 text-[11px] font-bold text-white/45">{tipoElegido ? <>Se registra como <PillTipo tipo={tipoElegido} /></> : null}</p>
              </div>
              <Campo label="Medio de pago">
                <select required value={form.medio_pago} onChange={(e) => set("medio_pago", e.target.value)} className={inp}>
                  {MEDIOS_PAGO_GASTO_COLECTIVO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Campo>
              <div className="md:col-span-2 xl:col-span-2">
                <Campo label="Concepto / detalle"><input required maxLength={120} value={form.concepto} onChange={(e) => set("concepto", e.target.value)} placeholder="Ej.: nafta ida al evento" className={inp} /></Campo>
              </div>
              <Campo label="Monto"><input type="number" required min={0.01} step="0.01" inputMode="decimal" value={form.monto} onChange={(e) => set("monto", e.target.value)} placeholder="0" className={inp} /></Campo>
              <div className="md:col-span-2 xl:col-span-2">
                <Campo label="Observaciones (opcional)"><input maxLength={500} value={form.observaciones} onChange={(e) => set("observaciones", e.target.value)} className={inp} /></Campo>
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={guardando} className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:opacity-50">{guardando ? "..." : editando ? "Actualizar" : "Agregar"}</button>
              </div>
            </div>
          </form>
        )}

        {/* Resumen */}
        <div className="rounded-2xl border border-red-500/30 bg-red-950/15 p-4">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">Resumen</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><span className="font-bold text-white/60">Total ingresos</span><span className="font-black">{resumen ? dineroCaja(resumen.ingresos) : "…"}</span></div>
            <div className="flex justify-between gap-3"><span className="font-bold text-white/60">Total costos</span><span className="font-black">{resumen ? dineroCaja(resumen.costos) : "…"}</span></div>
            <div className="flex justify-between gap-3"><span className="font-bold text-white/60">Total gastos</span><span className="font-black">{resumen ? dineroCaja(resumen.gastos) : "…"}</span></div>
            <div className="flex justify-between gap-3 border-t border-white/10 pt-2"><span className="font-bold text-white/60">Resultado final</span><span className={`font-black ${neto < 0 ? "text-red-400" : "text-green-300"}`}>{resumen ? dineroCaja(neto) : "…"}</span></div>
            <div className="flex justify-between gap-3"><span className="font-bold text-white/60">Movimientos registrados</span><span className="font-black">{resumen?.cantidadMovimientos ?? "…"}</span></div>
            {resumen && resumen.cantidadMovimientos > 0 && (
              <p className="text-right text-[11px] text-white/40">{cantidad(resumen.cantidadCostos, "costo", "costos")} · {cantidad(resumen.cantidadGastos, "gasto", "gastos")}</p>
            )}
          </div>
        </div>
      </div>

      {/* Movimientos de caja */}
      <div className="mt-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-black uppercase tracking-[0.15em] text-white/50">Movimientos de caja</h3>
          {movimientos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as "" | TipoCaja)} className={`${inpFiltro} w-[140px]`} aria-label="Filtrar por tipo">
                <option value="">Todos</option>
                <option value="costo">Costos</option>
                <option value="gasto">Gastos</option>
              </select>
              <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className={`${inpFiltro} w-[220px]`} aria-label="Filtrar por categoría">
                <option value="">Todas las categorías</option>
                {categoriasConMovimientos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </select>
            </div>
          )}
        </div>
        {movimientos.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black p-4 text-sm text-white/50">Todavía no hay movimientos cargados.</div>
        ) : filtrados.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black p-4 text-sm text-white/50">No hay movimientos con ese filtro.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-[10px] font-black uppercase tracking-[0.12em] text-white/35"><tr><th className="pb-2">Fecha / hora</th><th className="pb-2">Tipo</th><th className="pb-2">Categoría</th><th className="pb-2">Concepto</th><th className="pb-2">Medio de pago</th><th className="pb-2 text-right">Monto</th><th className="pb-2"></th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {filtrados.map((m) => (
                  <tr key={m.id} className={editando?.id === m.id ? "bg-red-950/20" : ""}>
                    <td className="py-2 font-bold">{m.fecha.slice(8, 10)}/{m.fecha.slice(5, 7)}<span className="text-white/40"> · {horaDeCarga(m.created_at)}</span></td>
                    <td className="py-2"><PillTipo tipo={m.tipo} /></td>
                    <td className="py-2 text-white/70">{m.categoria_nombre}</td>
                    <td className="py-2"><p className="font-bold">{m.concepto}</p>{m.observaciones && <p className="text-xs text-white/40">{m.observaciones}</p>}</td>
                    <td className="py-2 text-white/70">{etiquetaMedio(m.medio_pago)}</td>
                    <td className="py-2 text-right font-black text-red-400">{dineroCaja(m.monto)}</td>
                    <td className="py-2 pl-3">
                      {!cerrado && (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => abrirEdicion(m)} className="rounded-lg border border-white/15 px-2 py-1 text-xs font-black uppercase text-white/70 hover:border-red-500">Editar</button>
                          <button onClick={() => eliminar(m)} className="rounded-lg border border-red-500/40 px-2 py-1 text-xs font-black uppercase text-red-300 hover:bg-red-700 hover:text-white">Eliminar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════ Informe del evento ═════════
// Informe interno del Colectivo: resumen ejecutivo del evento, solo lectura. Lo
// arma el servidor en el momento (armarInformeEvento) con las mismas reglas que
// la caja, desde los registros históricos del evento: sirve igual para eventos
// activos, finalizados o viejos. No forma parte de Finanzas SIM.
type RespuestaInforme = {
  evento: { nombre: string; fecha_inicio: string; fecha_fin: string; localidad: string | null; provincia: string | null; ubicacion: string | null; estado: string };
  informe: InformeEvento;
  movimientos: Movimiento[];
};
const fechaLarga = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const porcentaje = (n: number) => `${n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

function LineaMonto({ etiqueta, valor, detalle, fuerte }: { etiqueta: string; valor: number; detalle?: string; fuerte?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-sm ${fuerte ? "border-t border-white/10 pt-2" : ""}`}>
      <span className={`min-w-0 ${fuerte ? "font-black text-white" : "font-bold text-white/70"}`}>{etiqueta}{detalle && <span className="ml-1 text-xs font-bold text-white/35">{detalle}</span>}</span>
      <span className={`shrink-0 font-black ${fuerte ? "text-white" : "text-white/90"}`}>{dineroCaja(valor)}</span>
    </div>
  );
}
function BloqueInforme({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black p-4">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-white/40">{titulo}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function ListaLineas({ lineas, vacio, total, etiquetaTotal }: { lineas: LineaInforme[]; vacio: string; total?: number; etiquetaTotal?: string }) {
  if (lineas.length === 0) return <p className="text-sm text-white/40">{vacio}</p>;
  return (
    <>
      {lineas.map((l) => <LineaMonto key={l.clave} etiqueta={l.etiqueta} valor={l.total} detalle={`· ${l.cantidad}`} />)}
      {total !== undefined && etiquetaTotal && <LineaMonto etiqueta={etiquetaTotal} valor={total} fuerte />}
    </>
  );
}

function InformeDelEvento({ eventoId }: { eventoId: string }) {
  const [datos, setDatos] = useState<RespuestaInforme | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const r = await fetch(`/api/admin/colectivo/eventos/${eventoId}/informe`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error || "No se pudo armar el informe"); return; }
    setError("");
    setDatos(d as RespuestaInforme);
  }, [eventoId]);
  // Carga asíncrona inicial: los setState ocurren tras el await, no de forma
  // síncrona (falso positivo de react-hooks/set-state-in-effect).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); }, [cargar]);

  if (error) return <div className="rounded-2xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm font-bold text-red-300">{error}</div>;
  if (!datos) return <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/60">Armando el informe...</div>;

  const { evento, informe, movimientos } = datos;
  const r = informe.resumen;
  const positivo = r.neto >= 0;
  const ubicacion = [evento.localidad, evento.provincia, evento.ubicacion].filter(Boolean).join(" · ");
  const t = informe.turnos;
  const p = informe.productos;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-black uppercase text-red-500">Informe del evento</h2>
        <p className="rounded-xl border border-white/10 bg-black px-3 py-1 text-[11px] font-bold text-white/55">Informe interno del Colectivo. No forma parte de Finanzas SIM.</p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-black text-white">{evento.nombre}</span>
        <span className="text-white/55">{fechaLarga(evento.fecha_inicio)}{evento.fecha_fin !== evento.fecha_inicio ? ` → ${fechaLarga(evento.fecha_fin)}` : ""}</span>
        {ubicacion && <span className="text-white/45">{ubicacion}</span>}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${evento.estado === "activo" ? "bg-green-900 text-green-300" : evento.estado === "proximo" ? "bg-blue-900 text-blue-300" : evento.estado === "cancelado" ? "bg-red-900 text-red-300" : "bg-zinc-800 text-zinc-400"}`}>{ESTADO_EVENTO_LABEL[evento.estado] || evento.estado}</span>
      </div>

      {/* Resumen principal (en celular, una card por fila) */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Ingresos</p>
          <p className="mt-1 text-xl font-black text-white md:text-2xl">{dineroCaja(r.ingresos)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Costos</p>
          <p className="mt-1 text-xl font-black text-white md:text-2xl">{dineroCaja(r.costos)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Gastos</p>
          <p className="mt-1 text-xl font-black text-white md:text-2xl">{dineroCaja(r.gastos)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${positivo ? "border-green-500/30 bg-green-950/15" : "border-red-500/40 bg-red-950/20"}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Resultado neto</p>
          <p className={`mt-1 text-xl font-black md:text-2xl ${positivo ? "text-green-300" : "text-red-400"}`}>{dineroCaja(r.neto)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${informe.margen === null ? "border-white/10 bg-black" : positivo ? "border-green-500/30 bg-green-950/15" : "border-red-500/40 bg-red-950/20"}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Margen del evento</p>
          <p className={`mt-1 text-xl font-black md:text-2xl ${informe.margen === null ? "text-white/50" : positivo ? "text-green-300" : "text-red-400"}`}>{informe.margen === null ? "—" : porcentaje(informe.margen)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Ingresos */}
        <div className="space-y-3">
          <h3 className="text-sm font-black uppercase tracking-[0.15em] text-white/60">Ingresos</h3>
          <BloqueInforme titulo="Por origen">
            <LineaMonto etiqueta="Turnos" valor={r.ingresosTurnos} />
            <LineaMonto etiqueta="Productos" valor={r.ingresosProductos} />
            <LineaMonto etiqueta="Total ingresos" valor={r.ingresos} fuerte />
          </BloqueInforme>
          <BloqueInforme titulo="Por método de pago">
            <ListaLineas lineas={informe.ingresosPorMetodo} vacio="Sin cobros." total={r.ingresos} etiquetaTotal="Total cobrado" />
          </BloqueInforme>
          <BloqueInforme titulo="Turnos">
            <LineaMonto etiqueta="Facturación" valor={t.facturacion} />
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div className="rounded-xl bg-white/[0.04] px-2 py-2"><p className="text-lg font-black">{t.cantidad}</p><p className="text-[10px] font-bold uppercase text-white/40">Turnos{t.gratis > 0 ? ` · ${t.gratis} gratis` : ""}</p></div>
              <div className="rounded-xl bg-white/[0.04] px-2 py-2"><p className="text-lg font-black">{t.personas}</p><p className="text-[10px] font-bold uppercase text-white/40">Personas</p></div>
              <div className="rounded-xl bg-white/[0.04] px-2 py-2"><p className="text-lg font-black">{t.minutos.toLocaleString("es-AR")}</p><p className="text-[10px] font-bold uppercase text-white/40">Minutos</p></div>
            </div>
            {t.porDuracion.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {t.porDuracion.map((d) => <span key={d.minutos} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-bold text-white/55">{d.minutos}′ · {d.turnos} {d.turnos === 1 ? "turno" : "turnos"}</span>)}
              </div>
            )}
          </BloqueInforme>
          <BloqueInforme titulo="Productos">
            {p.items.length === 0 ? <p className="text-sm text-white/40">Sin ventas de productos.</p> : (
              <>
                {p.items.map((it) => (
                  <div key={it.nombre} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 font-bold text-white/70">{it.nombre}
                      <span className="ml-1 text-xs font-bold text-white/35">· {it.unidades} {it.unidades === 1 ? "unidad" : "unidades"}{it.bonificadas > 0 ? ` + ${it.bonificadas} bonificada${it.bonificadas === 1 ? "" : "s"}` : ""}</span>
                    </span>
                    <span className="shrink-0 font-black text-white/90">{dineroCaja(it.total)}</span>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 border-t border-white/10 pt-2 text-sm">
                  <span className="font-black text-white">Total productos<span className="ml-1 text-xs font-bold text-white/35">· {p.unidades} {p.unidades === 1 ? "unidad" : "unidades"}</span></span>
                  <span className="font-black text-white">{dineroCaja(p.facturacion)}</span>
                </div>
                {p.bonificadas > 0 && <p className="text-[11px] text-white/40">Las bonificadas se entregaron sin cobro: no suman ingresos.</p>}
              </>
            )}
          </BloqueInforme>
        </div>

        {/* Egresos */}
        <div className="space-y-3">
          <h3 className="text-sm font-black uppercase tracking-[0.15em] text-white/60">Egresos</h3>
          <BloqueInforme titulo="Totales">
            <LineaMonto etiqueta="Costos" valor={r.costos} detalle={`· ${r.cantidadCostos}`} />
            <LineaMonto etiqueta="Gastos" valor={r.gastos} detalle={`· ${r.cantidadGastos}`} />
            <LineaMonto etiqueta="Total egresos" valor={informe.egresos} fuerte />
          </BloqueInforme>
          <BloqueInforme titulo="Costos por categoría">
            <ListaLineas lineas={informe.costosPorCategoria} vacio="Sin costos cargados." total={r.costos} etiquetaTotal="Total costos" />
          </BloqueInforme>
          <BloqueInforme titulo="Gastos por categoría">
            <ListaLineas lineas={informe.gastosPorCategoria} vacio="Sin gastos cargados." total={r.gastos} etiquetaTotal="Total gastos" />
          </BloqueInforme>
          <BloqueInforme titulo="Egresos por medio de pago">
            <ListaLineas lineas={informe.egresosPorMedio} vacio="Sin egresos." total={informe.egresos} etiquetaTotal="Total egresos" />
          </BloqueInforme>
        </div>
      </div>

      {/* Detalle de costos y gastos (solo lectura; se editan en la pestaña Caja) */}
      <div className="mt-5">
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.15em] text-white/60">Detalle de costos y gastos</h3>
        {movimientos.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black p-4 text-sm text-white/50">Sin costos ni gastos cargados.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black px-4 py-2">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-[10px] font-black uppercase tracking-[0.12em] text-white/35"><tr><th className="py-2">Fecha</th><th className="py-2">Tipo</th><th className="py-2">Categoría</th><th className="py-2">Concepto</th><th className="py-2">Medio de pago</th><th className="py-2 text-right">Monto</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {movimientos.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 font-bold">{fechaLarga(m.fecha)}</td>
                    <td className="py-2"><PillTipo tipo={m.tipo} /></td>
                    <td className="py-2 text-white/70">{m.categoria_nombre}</td>
                    <td className="py-2 font-bold">{m.concepto}</td>
                    <td className="py-2 text-white/70">{etiquetaMedio(m.medio_pago)}</td>
                    <td className="py-2 text-right font-black text-red-400">{dineroCaja(m.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

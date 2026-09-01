"use client";

import { useState } from "react";

// IA SIM · Bloque 4B.5 — Saldo de créditos prepagados de Anthropic.
// Muestra el saldo CALCULADO (cargas − costos oficiales) separado del consumo
// interno estimado. Acciones: registrar carga, actualizar saldo (sync oficial),
// conciliar con Anthropic Console, ver detalle. No sobrecarga el chat.

type Mov = { id: string; tipo: string; importe_usd: string; fecha: string; descripcion: string; referencia: string | null; estado: string; motivo_anulacion: string | null; created_at: string };
type Snap = { id: string; sincronizado_at: string; desde: string; hasta: string; costo_total_usd: string; moneda: string; buckets: number; paginas: number; estado: string; advertencias: string[] | null };
type Conc = { id: string; saldo_calculado_usd: string; saldo_observado_usd: string; diferencia_usd: string; motivo: string | null; created_at: string };
type PorMes = { mes: string; oficial_usd: string | null; estimado_usd: string; diferencia_usd: string | null };
type Alerta = { nivel: "info" | "warn" | "critico"; codigo: string; texto: string };
export type Resumen = {
  saldo: { saldo_display: string; cargas_total_usd: string; costo_oficial_display: string; hay_snapshot: boolean; ultima_sync: string | null };
  consumo_mes: { periodo: string; tokens_total: number; costo_estimado_usd: number; porcentaje_tope: number };
  sincronizacion: { estado: string; configurada: boolean; variable_requerida: string | null };
  alertas: Alerta[];
  detalle: { movimientos: Mov[]; snapshots: Snap[]; conciliaciones: Conc[]; por_mes: PorMes[] };
};

function usd(n: string | number): string { const v = Number(n) || 0; return v < 1 && v > 0 ? v.toFixed(4) : v.toFixed(2); }
function fecha(s: string | null): string { return s ? new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"; }
function fechaHora(s: string | null): string { return s ? new Date(s).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
const TIPO_LABEL: Record<string, string> = { carga: "Carga", ajuste_positivo: "Ajuste +", ajuste_negativo: "Ajuste −", credito_vencido: "Crédito vencido", conciliacion: "Conciliación" };

// Presentacional: el dato y la recarga los provee el padre (IAChat), cuyos
// efectos ya cumplen las reglas de hooks. Aquí solo hay handlers de eventos.
export default function SaldoCreditos({ data: r, recargar }: { data: Resumen | null; recargar: () => void }) {
  const [detalle, setDetalle] = useState(false);
  const [modal, setModal] = useState<null | "carga" | "conciliar">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const actualizar = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/ia/creditos/sincronizar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ forzar: true }) });
      const j = await res.json();
      if (j.estado === "no_configurada") setMsg(`Sincronización oficial no configurada: falta ${j.variable}.`);
      else if (j.ok) setMsg(j.omitida ? "Sincronización reciente (sin cambios)." : `Sincronizado: costo oficial US$${usd(j.costo_total_usd)} (${j.buckets} días, ${j.paginas} pág).`);
      else setMsg(j.mensaje || "No se pudo sincronizar.");
    } catch { setMsg("Error de red al sincronizar."); }
    setBusy(false); recargar();
  };

  if (!r) return null;
  const critico = r.alertas.find((a) => a.nivel === "critico");

  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs">
      {/* Saldo calculado */}
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Saldo API estimado</span>
        {r.saldo.hay_snapshot ? null : <span className="text-[10px] text-amber-400">sin costos oficiales</span>}
      </div>
      <div className={`text-lg font-black ${critico ? "text-red-400" : "text-white"}`}>US${r.saldo.saldo_display}</div>
      <div className="mt-0.5 text-[11px] text-white/40">Cargas US${usd(r.saldo.cargas_total_usd)} − oficial US${r.saldo.costo_oficial_display}</div>

      {/* Consumo interno estimado del mes */}
      <div className="mt-2 border-t border-white/10 pt-2 text-white/50">
        Consumo {r.consumo_mes.periodo}: {r.consumo_mes.tokens_total.toLocaleString("es-AR")} tokens · ~US${usd(r.consumo_mes.costo_estimado_usd)} · {r.consumo_mes.porcentaje_tope}% del tope
      </div>
      <div className="text-[10px] text-white/30">Última sync oficial: {fechaHora(r.saldo.ultima_sync)}</div>

      {/* Alertas */}
      {r.alertas.map((a) => (
        <div key={a.codigo} className={`mt-1.5 rounded-lg px-2 py-1 text-[11px] ${a.nivel === "critico" ? "bg-red-950/60 text-red-300" : "bg-amber-950/40 text-amber-300"}`}>⚠ {a.texto}</div>
      ))}

      {/* Acciones */}
      <div className="mt-2 flex flex-wrap gap-1">
        <button onClick={() => { setModal("carga"); setMsg(null); }} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-bold hover:bg-white/20">Registrar carga</button>
        <button onClick={actualizar} disabled={busy} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-bold hover:bg-white/20 disabled:opacity-50">{busy ? "Actualizando…" : "Actualizar saldo"}</button>
        <button onClick={() => { setModal("conciliar"); setMsg(null); }} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-bold hover:bg-white/20">Conciliar</button>
        <button onClick={() => setDetalle((v) => !v)} className="rounded-lg px-2 py-1 text-[11px] font-bold text-white/50 hover:text-white">{detalle ? "Ocultar" : "Ver detalle"}</button>
      </div>
      {msg && <div className="mt-1.5 text-[11px] text-white/70">{msg}</div>}

      {detalle && <Detalle r={r} recargar={recargar} />}
      {modal === "carga" && <ModalCarga onClose={() => setModal(null)} onDone={(m) => { setMsg(m); setModal(null); recargar(); }} />}
      {modal === "conciliar" && <ModalConciliar onClose={() => setModal(null)} onDone={(m) => { setMsg(m); setModal(null); recargar(); }} />}
    </div>
  );
}

function Detalle({ r, recargar }: { r: Resumen; recargar: () => void }) {
  const [anulando, setAnulando] = useState<string | null>(null);
  const anular = async (id: string) => {
    const motivo = window.prompt("Motivo de la anulación (se conserva el historial):");
    if (!motivo || !motivo.trim()) return;
    setAnulando(id);
    try { await fetch("/api/admin/ia/creditos/movimiento/anular", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, motivo }) }); } finally { setAnulando(null); recargar(); }
  };
  return (
    <div className="mt-2 space-y-3 border-t border-white/10 pt-2 text-[11px]">
      <div>
        <p className="mb-1 font-black uppercase tracking-wider text-white/40">Movimientos</p>
        {r.detalle.movimientos.length === 0 && <p className="text-white/30">Sin movimientos.</p>}
        {r.detalle.movimientos.map((m) => (
          <div key={m.id} className={`flex items-center justify-between gap-2 py-0.5 ${m.estado === "anulado" ? "text-white/25 line-through" : "text-white/70"}`}>
            <span className="truncate">{fecha(m.fecha)} · {TIPO_LABEL[m.tipo] ?? m.tipo} · {m.descripcion}</span>
            <span className="shrink-0 tabular-nums">US${usd(m.importe_usd)}</span>
            {m.estado === "confirmado" && <button onClick={() => anular(m.id)} disabled={anulando === m.id} title="Anular" className="shrink-0 text-white/30 hover:text-red-400">✕</button>}
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1 font-black uppercase tracking-wider text-white/40">Costos por mes (oficial vs estimado)</p>
        {r.detalle.por_mes.length === 0 && <p className="text-white/30">Sin datos.</p>}
        {r.detalle.por_mes.map((p) => (
          <div key={p.mes} className="flex items-center justify-between gap-2 py-0.5 text-white/60">
            <span>{p.mes}</span>
            <span className="tabular-nums">oficial {p.oficial_usd ? `US$${usd(p.oficial_usd)}` : "—"} · estim. US${usd(p.estimado_usd)}{p.diferencia_usd ? ` · dif ${Number(p.diferencia_usd) >= 0 ? "+" : ""}US$${usd(p.diferencia_usd)}` : ""}</span>
          </div>
        ))}
      </div>
      {r.detalle.conciliaciones.length > 0 && (
        <div>
          <p className="mb-1 font-black uppercase tracking-wider text-white/40">Conciliaciones</p>
          {r.detalle.conciliaciones.map((c) => (
            <div key={c.id} className="py-0.5 text-white/60">{fecha(c.created_at)}: calc US${usd(c.saldo_calculado_usd)} vs obs US${usd(c.saldo_observado_usd)} · dif {Number(c.diferencia_usd) >= 0 ? "+" : ""}US${usd(c.diferencia_usd)}</div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-white/30">El saldo es CALCULADO (cargas − costos oficiales de Anthropic). Anthropic no expone directamente el balance restante; conciliá si difiere de la Console.</p>
    </div>
  );
}

function ModalCarga({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
  const [tipo, setTipo] = useState("carga");
  const [importe, setImporte] = useState("");
  const [f, setF] = useState(hoy);
  const [desc, setDesc] = useState("");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    setBusy(true); setErr(null);
    // Idempotencia por defecto: tipo+importe+fecha+descripción (evita doble registro).
    const idem = `${tipo}|${importe}|${f}|${desc}`.slice(0, 200);
    try {
      const res = await fetch("/api/admin/ia/creditos/movimiento", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo, importe_usd: importe, fecha: f, descripcion: desc, referencia: ref || null, idempotency_key: idem }) });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || "No se pudo registrar."); setBusy(false); return; }
      onDone(j.duplicado ? "Ese movimiento ya estaba registrado (no se duplicó)." : "Movimiento registrado.");
    } catch { setErr("Error de red."); setBusy(false); }
  };
  return (
    <Overlay onClose={onClose} titulo="Registrar movimiento">
      <label className="block text-[11px] text-white/50">Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white">
          <option value="carga">Carga de crédito</option>
          <option value="ajuste_positivo">Ajuste positivo</option>
          <option value="ajuste_negativo">Ajuste negativo</option>
          <option value="credito_vencido">Crédito vencido</option>
        </select>
      </label>
      <label className="block text-[11px] text-white/50">Importe USD
        <input value={importe} onChange={(e) => setImporte(e.target.value)} inputMode="decimal" placeholder="5.00" className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white" />
      </label>
      <label className="block text-[11px] text-white/50">Fecha real
        <input value={f} onChange={(e) => setF(e.target.value)} type="date" className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white" />
      </label>
      <label className="block text-[11px] text-white/50">Descripción
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Carga inicial Anthropic" className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white" />
      </label>
      <label className="block text-[11px] text-white/50">Referencia (opcional)
        <input value={ref} onChange={(e) => setRef(e.target.value)} className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white" />
      </label>
      {err && <p className="text-[11px] text-red-400">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white">Cancelar</button>
        <button onClick={guardar} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black uppercase hover:bg-red-700 disabled:opacity-50">{busy ? "Guardando…" : "Registrar"}</button>
      </div>
    </Overlay>
  );
}

function ModalConciliar({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [obs, setObs] = useState("");
  const [motivo, setMotivo] = useState("");
  const [preview, setPreview] = useState<{ saldo_calculado_usd: string; saldo_observado_usd: string; diferencia_usd: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const post = async (confirmar: boolean) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/ia/creditos/conciliar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ saldo_observado_usd: obs, confirmar, motivo: motivo || null }) });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || "No se pudo conciliar."); setBusy(false); return; }
      if (confirmar) { onDone("Conciliación registrada (se creó el ajuste, historial conservado)."); return; }
      setPreview({ saldo_calculado_usd: j.saldo_calculado_usd, saldo_observado_usd: j.saldo_observado_usd, diferencia_usd: j.diferencia_usd });
    } catch { setErr("Error de red."); }
    setBusy(false);
  };
  return (
    <Overlay onClose={onClose} titulo="Conciliar con Anthropic Console">
      <label className="block text-[11px] text-white/50">Saldo observado en Console (USD)
        <input value={obs} onChange={(e) => { setObs(e.target.value); setPreview(null); }} inputMode="decimal" placeholder="4.92" className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white" />
      </label>
      <label className="block text-[11px] text-white/50">Motivo (opcional)
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Redondeos / crédito vencido / uso externo" className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white" />
      </label>
      {preview && (
        <div className="rounded-lg bg-white/5 px-2 py-1.5 text-[11px] text-white/70">
          Saldo calculado: US${usd(preview.saldo_calculado_usd)}<br />Saldo observado: US${usd(preview.saldo_observado_usd)}<br />
          Diferencia: {Number(preview.diferencia_usd) >= 0 ? "+" : ""}US${usd(preview.diferencia_usd)}
        </div>
      )}
      {err && <p className="text-[11px] text-red-400">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white">Cancelar</button>
        {!preview ? (
          <button onClick={() => post(false)} disabled={busy} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-black uppercase hover:bg-white/20 disabled:opacity-50">{busy ? "…" : "Comparar"}</button>
        ) : (
          <button onClick={() => post(true)} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black uppercase hover:bg-red-700 disabled:opacity-50">{busy ? "…" : "Confirmar ajuste"}</button>
        )}
      </div>
    </Overlay>
  );
}

function Overlay({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-2 rounded-2xl border border-white/10 bg-neutral-950 p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-black uppercase">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { formatearFechaCalendario, formatearTimestampLargaCordoba, formatearTimestampCordoba } from "@/lib/ia/creditos/fecha";

// IA SIM · Bloque 4B.5.1 — Créditos de IA. Saldo ESTIMADO dinámico (último saldo real
// − consumo interno posterior). UI amigable: monto grande, etiqueta honesta, barra,
// acciones espaciadas y detalle ordenado. Fechas sin corrimiento de zona horaria.

type Mov = { id: string; tipo: string; importe_usd: string; fecha: string; descripcion: string; estado: string; motivo_anulacion: string | null; created_at: string };
type Conc = { id: string; saldo_observado_usd: string; saldo_calculado_usd: string; diferencia_usd: string; costo_interno_baseline: string | null; estado: string; baseline_reconstruido: boolean; created_at: string };
type PorMes = { mes: string; estimado_usd: string; oficial_usd: string | null };
type Alerta = { nivel: "info" | "warn" | "critico"; codigo: string; texto: string };
export type Resumen = {
  saldo: { modo: string; etiqueta_modo: string; saldo_display: string; saldo_usd: string; referencia_usd: string; porcentaje: number | null; color: "ok" | "warn" | "critico"; creditos_registrados_usd: string; ultimo_saldo_real: { usd: string; fecha: string } | null; gastado_desde_usd: string | null };
  consumo_mes: { periodo: string; tokens_total: number; costo_estimado_usd: string; porcentaje_tope: number; busquedas_web?: number; costo_web_usd?: string; intentos_uso_desconocido?: number };
  sincronizacion: { estado: string; configurada: boolean; variable_requerida: string | null; ultimo_intento: string | null; ultimo_exito: string | null; ultimo_error: string | null };
  alertas: Alerta[];
  detalle: {
    como_se_calculo: { modo: string; ultimo_saldo_real_usd: string | null; baseline_usd: string | null; costo_interno_actual_usd: string; consumo_posterior_usd: string; movimientos_posteriores_usd: string; creditos_registrados_usd: string; costo_oficial_usd: string | null; saldo_usd: string; fuente: string };
    movimientos: Mov[]; consumo_por_mes: PorMes[]; conciliaciones: Conc[];
  };
};

const usd = (s: string | number) => `US$${Number(s || 0) < 1 && Number(s || 0) > -1 && Number(s || 0) !== 0 ? Number(s).toFixed(4) : Number(s || 0).toFixed(2)}`;
const mesLargo = (m: string) => { const [y, mm] = m.split("-"); const N = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]; return `${N[Number(mm) - 1] ?? mm} ${y}`; };
const TIPO_LABEL: Record<string, string> = { carga: "Carga de crédito", ajuste_positivo: "Ajuste positivo", ajuste_negativo: "Ajuste negativo", credito_vencido: "Crédito vencido", conciliacion: "Ajuste de saldo real" };
const BARRA = { ok: "bg-emerald-500", warn: "bg-amber-500", critico: "bg-red-600" };

export default function SaldoCreditos({ data: r, recargar }: { data: Resumen | null; recargar: () => void }) {
  const [detalle, setDetalle] = useState(false);
  const [modal, setModal] = useState<null | "carga" | "conciliar">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!r) return null;
  const s = r.saldo;
  const critico = s.color === "critico";
  const pct = s.porcentaje;

  const actualizar = async () => { setBusy(true); setMsg(null); await Promise.resolve(recargar()); setTimeout(() => setBusy(false), 400); setMsg("Estimación actualizada."); };

  return (
    <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm">
      <p className="text-[10px] font-black uppercase tracking-wider text-red-500">Créditos de IA</p>

      {/* Monto grande + etiqueta honesta */}
      <div className={`mt-1 text-2xl font-black leading-none ${critico ? "text-red-400" : "text-white"}`}>{usd(s.saldo_usd)}</div>
      <p className="mt-0.5 text-[11px] text-white/50">{s.etiqueta_modo}</p>

      {/* Barra del saldo (con valor numérico, no solo color) */}
      {pct != null && (
        <div className="mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Saldo disponible: ${pct}% de ${usd(s.referencia_usd)}`}>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full ${BARRA[s.color]} motion-reduce:transition-none transition-[width] duration-500`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-0.5 text-[10px] text-white/40">{pct}% de {usd(s.referencia_usd)} de referencia</p>
        </div>
      )}

      {/* Contexto */}
      {s.ultimo_saldo_real && (
        <p className="mt-2 text-[11px] text-white/50">Último saldo real: <span className="text-white/70">{usd(s.ultimo_saldo_real.usd)}</span> · {formatearTimestampLargaCordoba(s.ultimo_saldo_real.fecha)}</p>
      )}
      {s.gastado_desde_usd && <p className="text-[11px] text-white/50">Gastado desde entonces: ~{usd(s.gastado_desde_usd)}</p>}

      {/* Resumen del mes */}
      <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-white/50">
        <span className="text-white/40">Este mes ({mesLargo(r.consumo_mes.periodo)})</span><br />
        {r.consumo_mes.tokens_total.toLocaleString("es-AR")} tokens · ~{usd(r.consumo_mes.costo_estimado_usd)} · {r.consumo_mes.porcentaje_tope}% del tope
      </div>

      {/* Alertas (icono + texto, no solo color) */}
      {r.alertas.map((a) => (
        <div key={a.codigo} role="alert" className={`mt-1.5 rounded-lg px-2 py-1 text-[11px] ${a.nivel === "critico" ? "bg-red-950/60 text-red-200" : "bg-amber-950/40 text-amber-200"}`}>⚠ {a.texto}</div>
      ))}

      {/* Acciones (grilla, ancho completo, sin amontonar) */}
      <div className="mt-3 grid grid-cols-1 gap-1.5">
        <button onClick={actualizar} disabled={busy} aria-label="Actualizar estimación del saldo" className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black uppercase hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50">{busy ? "Actualizando…" : "Actualizar estimación"}</button>
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => { setModal("carga"); setMsg(null); }} aria-label="Registrar un crédito o ajuste" className="rounded-lg bg-white/10 px-2 py-2 text-xs font-bold hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Registrar crédito</button>
          <button onClick={() => { setModal("conciliar"); setMsg(null); }} aria-label="Ajustar el saldo real observado en Anthropic Console" className="rounded-lg bg-white/10 px-2 py-2 text-xs font-bold hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Ajustar saldo real</button>
        </div>
        <button onClick={() => setDetalle((v) => !v)} aria-expanded={detalle} className="text-left text-[11px] font-bold text-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">{detalle ? "Ocultar detalle ▲" : "Ver detalle ▼"}</button>
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-white/70" role="status">{msg}</p>}

      {detalle && <Detalle r={r} recargar={recargar} />}
      {modal === "carga" && <ModalCarga onClose={() => setModal(null)} onDone={(m) => { setMsg(m); setModal(null); recargar(); }} />}
      {modal === "conciliar" && <ModalConciliar onClose={() => setModal(null)} onDone={(m) => { setMsg(m); setModal(null); recargar(); }} />}
    </div>
  );
}

function Detalle({ r, recargar }: { r: Resumen; recargar: () => void }) {
  const [anulando, setAnulando] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const c = r.detalle.como_se_calculo;

  const anular = async (id: string) => {
    const motivo = window.prompt("Motivo de la anulación (se conserva el historial):");
    if (!motivo || !motivo.trim()) return;
    setAnulando(id);
    try { await fetch("/api/admin/ia/creditos/movimiento/anular", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, motivo }) }); } finally { setAnulando(null); recargar(); }
  };
  const reintentarSync = async () => {
    setSyncBusy(true); setSyncMsg(null);
    try {
      const res = await fetch("/api/admin/ia/creditos/sincronizar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ forzar: true }) });
      const j = await res.json();
      setSyncMsg(j.estado === "no_configurada" ? "La organización no expone Admin API (sin sincronización oficial)." : j.ok ? "Sincronización oficial exitosa." : (j.mensaje || "No se pudo sincronizar."));
    } catch { setSyncMsg("Error de red."); }
    setSyncBusy(false); recargar();
  };

  return (
    <div className="mt-3 space-y-4 border-t border-white/10 pt-3 text-[11px]">
      {/* 1) Cómo se calculó */}
      <section>
        <h4 className="mb-1 font-black uppercase tracking-wider text-white/40">Cómo se calculó</h4>
        <dl className="space-y-0.5 text-white/60">
          {c.ultimo_saldo_real_usd && <Row k="Último saldo real" v={usd(c.ultimo_saldo_real_usd)} />}
          {c.baseline_usd && <Row k="Consumo al momento de conciliar" v={usd(c.baseline_usd)} />}
          <Row k="Consumo interno posterior" v={`− ${usd(c.consumo_posterior_usd)}`} />
          {Number(c.movimientos_posteriores_usd) !== 0 && <Row k="Movimientos posteriores" v={usd(c.movimientos_posteriores_usd)} />}
          {c.costo_oficial_usd && <Row k="Costo oficial acumulado" v={`− ${usd(c.costo_oficial_usd)}`} />}
          <Row k="Saldo estimado" v={usd(c.saldo_usd)} bold />
        </dl>
        <p className="mt-1 text-[10px] text-white/30">Fuente: {c.fuente}.</p>
      </section>

      {/* 2) Movimientos */}
      <section>
        <h4 className="mb-1 font-black uppercase tracking-wider text-white/40">Movimientos</h4>
        {r.detalle.movimientos.length === 0 && <p className="text-white/30">Sin movimientos.</p>}
        {r.detalle.movimientos.map((m) => {
          const val = Number(m.importe_usd);
          const color = m.tipo === "conciliacion" ? "text-white/60" : val >= 0 ? "text-emerald-400" : "text-red-400";
          return (
            <div key={m.id} className={`flex items-center justify-between gap-2 py-0.5 ${m.estado === "anulado" ? "text-white/25 line-through" : "text-white/70"}`}>
              <span className="min-w-0 truncate">{formatearFechaCalendario(m.fecha)} · {TIPO_LABEL[m.tipo] ?? m.tipo}{m.descripcion ? ` · ${m.descripcion}` : ""}</span>
              <span className={`shrink-0 tabular-nums ${m.estado === "anulado" ? "" : color}`}>{val >= 0 && m.tipo !== "conciliacion" ? "+" : ""}{usd(m.importe_usd)}</span>
              {m.estado === "confirmado" && (
                <button onClick={() => anular(m.id)} disabled={anulando === m.id} aria-label="Anular movimiento" title="Anular movimiento" className="shrink-0 rounded px-1 text-white/30 hover:text-red-400 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white">Anular</button>
              )}
            </div>
          );
        })}
      </section>

      {/* 3.b) Búsquedas web del mes (discreto; el detalle de costo, no la tarjeta principal) */}
      <section>
        <h4 className="mb-1 font-black uppercase tracking-wider text-white/40">Este mes ({mesLargo(r.consumo_mes.periodo)})</h4>
        <div className="flex items-center justify-between py-0.5 text-white/60"><span>Tokens</span><span className="tabular-nums">{r.consumo_mes.tokens_total.toLocaleString("es-AR")}</span></div>
        <div className="flex items-center justify-between py-0.5 text-white/60"><span>Búsquedas web</span><span className="tabular-nums">{r.consumo_mes.busquedas_web ?? 0}{(r.consumo_mes.busquedas_web ?? 0) > 0 ? ` · ~${usd(r.consumo_mes.costo_web_usd ?? "0")}` : ""}</span></div>
        <div className="flex items-center justify-between py-0.5 text-white/60"><span>Costo total estimado</span><span className="tabular-nums">~{usd(r.consumo_mes.costo_estimado_usd)}</span></div>
        {(r.consumo_mes.intentos_uso_desconocido ?? 0) > 0 && (
          <div className="mt-1 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300/90">{r.consumo_mes.intentos_uso_desconocido} intento(s) con consumo desconocido (búsqueda cortada por tiempo): posible costo pendiente de conciliación.</div>
        )}
      </section>

      {/* 3) Consumo por mes (solo estimado; sin columnas oficiales vacías) */}
      <section>
        <h4 className="mb-1 font-black uppercase tracking-wider text-white/40">Consumo por mes</h4>
        {r.detalle.consumo_por_mes.length === 0 && <p className="text-white/30">Sin consumo.</p>}
        {r.detalle.consumo_por_mes.map((p) => (
          <div key={p.mes} className="flex items-center justify-between py-0.5 text-white/60">
            <span>{mesLargo(p.mes)}</span>
            <span className="tabular-nums">{p.oficial_usd ? `Oficial ${usd(p.oficial_usd)} · ` : ""}Estimado {usd(p.estimado_usd)}</span>
          </div>
        ))}
      </section>

      {/* 4) Conciliaciones */}
      {r.detalle.conciliaciones.length > 0 && (
        <section>
          <h4 className="mb-1 font-black uppercase tracking-wider text-white/40">Ajustes de saldo real</h4>
          {r.detalle.conciliaciones.map((cc) => (
            <div key={cc.id} className="py-0.5 text-white/60">
              {formatearTimestampCordoba(cc.created_at)}: observado {usd(cc.saldo_observado_usd)} · calculado antes {usd(cc.saldo_calculado_usd)} · diferencia {Number(cc.diferencia_usd) >= 0 ? "+" : ""}{usd(cc.diferencia_usd)}
              {cc.costo_interno_baseline != null && <> · consumo base {usd(cc.costo_interno_baseline)}</>}
              {cc.baseline_reconstruido && <span className="text-white/30"> (baseline reconstruido)</span>}
            </div>
          ))}
        </section>
      )}

      {/* 5) Sincronización oficial (discreta) */}
      <section>
        <h4 className="mb-1 font-black uppercase tracking-wider text-white/40">Sincronización oficial</h4>
        <p className="text-white/50">
          {r.sincronizacion.estado === "ok" ? "Activa (Cost Report de Anthropic)." : r.sincronizacion.estado === "error" ? "Con error en el último intento." : "No disponible: la organización de Anthropic no expone la Admin API. El saldo se estima manualmente."}
        </p>
        {r.sincronizacion.ultimo_intento && <p className="text-[10px] text-white/30">Último intento: {formatearTimestampCordoba(r.sincronizacion.ultimo_intento)}{r.sincronizacion.ultimo_error ? ` · ${r.sincronizacion.ultimo_error}` : ""}</p>}
        <button onClick={reintentarSync} disabled={syncBusy} className="mt-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50">{syncBusy ? "Reintentando…" : "Reintentar sincronización oficial"}</button>
        {syncMsg && <p className="mt-1 text-[10px] text-white/50">{syncMsg}</p>}
      </section>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between gap-2 ${bold ? "border-t border-white/10 pt-0.5 font-bold text-white/80" : ""}`}><dt>{k}</dt><dd className="tabular-nums">{v}</dd></div>;
}

function ModalCarga({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
  const [tipo, setTipo] = useState("carga");
  const [importe, setImporte] = useState("");
  const [f, setF] = useState(hoy);
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    setBusy(true); setErr(null);
    const idem = `${tipo}|${importe}|${f}|${desc}`.slice(0, 200);
    try {
      const res = await fetch("/api/admin/ia/creditos/movimiento", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo, importe_usd: importe, fecha: f, descripcion: desc, idempotency_key: idem }) });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || "No se pudo registrar."); setBusy(false); return; }
      onDone(j.duplicado ? "Ese movimiento ya estaba registrado (no se duplicó)." : "Crédito registrado.");
    } catch { setErr("Error de red."); setBusy(false); }
  };
  return (
    <Overlay onClose={onClose} titulo="Registrar crédito o ajuste">
      <label className="block text-[11px] text-white/50">Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inpCls}>
          <option value="carga">Carga de crédito</option>
          <option value="ajuste_positivo">Ajuste positivo</option>
          <option value="ajuste_negativo">Ajuste negativo</option>
          <option value="credito_vencido">Crédito vencido</option>
        </select>
      </label>
      <label className="block text-[11px] text-white/50">Importe USD<input value={importe} onChange={(e) => setImporte(e.target.value)} inputMode="decimal" placeholder="5.00" className={inpCls} /></label>
      <label className="block text-[11px] text-white/50">Fecha real<input value={f} onChange={(e) => setF(e.target.value)} type="date" className={inpCls} /></label>
      <label className="block text-[11px] text-white/50">Descripción<input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Carga inicial Anthropic" className={inpCls} /></label>
      {err && <p className="text-[11px] text-red-400" role="alert">{err}</p>}
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
      if (!res.ok) { setErr(j.error || "No se pudo ajustar."); setBusy(false); return; }
      if (confirmar) { onDone("Saldo real ajustado (nuevo punto de partida para la estimación)."); return; }
      setPreview({ saldo_calculado_usd: j.saldo_calculado_usd, saldo_observado_usd: j.saldo_observado_usd, diferencia_usd: j.diferencia_usd });
    } catch { setErr("Error de red."); }
    setBusy(false);
  };
  return (
    <Overlay onClose={onClose} titulo="Ajustar saldo real">
      <p className="text-[11px] text-white/50">Ingresá el saldo que muestra Anthropic Console. Pasa a ser el nuevo punto de partida; desde ahí se descuenta el consumo estimado.</p>
      <label className="block text-[11px] text-white/50">Saldo observado en Console (USD)<input value={obs} onChange={(e) => { setObs(e.target.value); setPreview(null); }} inputMode="decimal" placeholder="4.92" className={inpCls} /></label>
      <label className="block text-[11px] text-white/50">Motivo (opcional)<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Redondeos / uso externo / vencimiento" className={inpCls} /></label>
      {preview && (
        <div className="rounded-lg bg-white/5 px-2 py-1.5 text-[11px] text-white/70">
          Saldo estimado actual: {usd(preview.saldo_calculado_usd)}<br />Saldo observado: {usd(preview.saldo_observado_usd)}<br />
          Diferencia: {Number(preview.diferencia_usd) >= 0 ? "+" : ""}{usd(preview.diferencia_usd)}
        </div>
      )}
      {err && <p className="text-[11px] text-red-400" role="alert">{err}</p>}
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

const inpCls = "mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

function Overlay({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="w-full max-w-sm space-y-2 rounded-2xl border border-white/10 bg-neutral-950 p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-black uppercase">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

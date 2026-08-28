"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nearestIndex } from "@/lib/chartNearest";

// ── Tipos del DTO que devuelve /api/admin/metricas/web ────────────────────────
type Metric = { value: number; pct: number | null };
type Item = { label: string; value: number; extra?: number };
type Stage = { key: string; label: string; count: number; convPrev: number | null; dropPrev: number | null };
type BlockStatus = "ok" | "empty" | "pending" | "error";
type Estados = {
  resumen: BlockStatus; evolucion: BlockStatus; canales: BlockStatus; paginas: BlockStatus;
  fuentes: BlockStatus; dispositivos: BlockStatus; ciudades: BlockStatus;
  funnels: BlockStatus; promociones: BlockStatus; errores: BlockStatus;
};
type Negocio = {
  atribuible: true;
  reservasWeb: number; ingresosReservas: number; ticketReservas: number | null;
  giftCards: number; ingresosGiftCards: number; ticketGiftCards: number | null;
  ingresosTotal: number;
};
type WebOk = {
  configured: true;
  range: { start: string; end: string };
  previous: { start: string; end: string };
  resumen: { usuarios: Metric; usuariosNuevos: Metric; sesiones: Metric; vistas: Metric; engagementSeg: Metric; conversion: Metric };
  conversionDisponible: boolean;
  serie: Array<{ fecha: string; usuarios: number; sesiones: number; vistas: number }>;
  canales: Item[]; fuentes: Item[]; paginas: Item[]; dispositivos: Item[]; ciudades: Item[];
  funnelReservas: Stage[]; funnelGiftCards: Stage[];
  promociones: { total: number; porFunnel: Item[]; descuentoTotal: number | null; descuentoPromedio: number | null } | null;
  errores: { checkout: Item[]; pago: { failed: number; pending: number; porFunnel: Item[] } } | null;
  estados: Estados;
  negocio: Negocio;
};
type WebOff = { configured: false; range: { start: string; end: string }; negocio: Negocio };
type WebData = WebOk | WebOff;
type Realtime = { configured: boolean; usuariosActivos?: number; paginas?: Item[]; error?: boolean };

const RANGOS: Array<{ key: string; label: string }> = [
  { key: "today", label: "Hoy" },
  { key: "7d", label: "Últimos 7 días" },
  { key: "30d", label: "Últimos 30 días" },
  { key: "this_month", label: "Este mes" },
  { key: "prev_month", label: "Mes anterior" },
  { key: "custom", label: "Personalizado" },
];

// La exclusión defensiva de tráfico /admin en el tracking se implementó en agosto de
// 2026. Los datos de GA4 ANTERIORES pueden contener tráfico administrativo histórico:
// NO se presentan como "100% público". No se alteran datos históricos; solo se avisa.
const EXCLUSION_ADMIN_DESDE = "2026-08-01";

const nf = new Intl.NumberFormat("es-AR");
const money = (n: number) => `$${nf.format(Math.round(n || 0))}`;
const num = (n: number) => nf.format(Math.round(n || 0));
const segLegible = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

// ── Bloques UI reutilizando la estética de Métricas ───────────────────────────
const CARD = "rounded-2xl border border-white/10 bg-white/[0.04] p-5";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${y}`;
}

const ETIQUETA_BLOQUE: Record<keyof Estados, string> = {
  resumen: "Resumen", evolucion: "Evolución", canales: "Canales", paginas: "Páginas",
  fuentes: "Fuente / Medio", dispositivos: "Dispositivos", ciudades: "Ciudades",
  funnels: "Funnels", promociones: "Promociones", errores: "Errores",
};

// Mensaje según estado: pending (custom aún propagándose) vs error real. ok/empty → null
// (el bloque se renderiza normal; "empty" lo resuelve cada componente con "Sin datos").
function mensajeEstado(status: BlockStatus): string | null {
  if (status === "pending") return "Todavía no hay datos. Las dimensiones nuevas de Analytics pueden tardar 24-48 h.";
  if (status === "error") return "No se pudo cargar este bloque.";
  return null;
}

// Envuelve un bloque: si está pending/error muestra el estado; si no, su contenido.
function Bloque({ title, status, children }: { title: string; status: BlockStatus; children: React.ReactNode }) {
  const msg = mensajeEstado(status);
  if (!msg) return <>{children}</>;
  return (
    <div className={CARD}>
      <h3 className="mb-3 text-lg font-semibold text-white">{title}</h3>
      <p className={`text-sm ${status === "error" ? "text-red-300/80" : "text-white/45"}`}>{msg}</p>
    </div>
  );
}

function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-white/40">— sin comparación</span>;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-semibold ${up ? "text-green-400" : "text-red-400"}`}>
      {up ? "↑" : "↓"} {Math.abs(pct).toLocaleString("es-AR")}% vs período anterior
    </span>
  );
}

function StatCard({ title, value, delta, hint }: { title: string; value: string; delta?: Metric; hint?: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs uppercase tracking-[0.2em] text-white/45">{title}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
      <div className="mt-2">{delta ? <Delta pct={delta.pct} /> : hint ? <span className="text-xs text-white/45">{hint}</span> : null}</div>
    </div>
  );
}

function BarList({ title, data, format, empty }: { title: string; data: Item[]; format?: (n: number) => string; empty?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={CARD}>
      <h3 className="mb-5 text-lg font-semibold text-white">{title}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-white/45">{empty ?? "Sin datos para este período."}</p>
      ) : (
        <div className="space-y-3">
          {data.map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex justify-between gap-4 text-sm">
                <span className="truncate text-white/75">{item.label || "(desconocido)"}</span>
                <span className="shrink-0 font-medium text-white">{format ? format(item.value) : num(item.value)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-red-500" style={{ width: `${(item.value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Línea temporal INTERACTIVA (usuarios + vistas) en SVG, sin dependencias extra:
// hover/tap → guía vertical + puntos resaltados + tooltip con valores reales del día;
// leyenda para activar/desactivar cada serie; touch (pan-y) sin romper el scroll.
function MiniLine({ serie, estado }: { serie: WebOk["serie"]; estado: BlockStatus }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showU, setShowU] = useState(true);
  const [showV, setShowV] = useState(true);
  const W = 720, H = 200, P = 8;
  const n = serie.length;
  const maxU = Math.max(...serie.map((s) => s.usuarios), 1);
  const maxV = Math.max(...serie.map((s) => s.vistas), 1);
  const xOf = (i: number) => P + (n <= 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (n - 1));
  const yOf = (v: number, max: number) => H - P - (v / max) * (H - 2 * P);
  const path = (key: "usuarios" | "vistas", max: number) =>
    serie.map((s, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(s[key], max)}`).join(" ");
  const step = Math.max(1, Math.ceil(n / 6));
  const ticks = serie.map((s, i) => ({ i, s })).filter(({ i }) => i % step === 0 || i === n - 1);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(n, (e.clientX - rect.left) / rect.width));
  };
  const pt = hover != null && hover >= 0 ? serie[hover] : null;
  const guidePct = hover != null && hover >= 0 ? (xOf(hover) / W) * 100 : 0;
  const msg = mensajeEstado(estado);

  return (
    <div className={CARD}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Evolución del tráfico</h3>
        <div className="flex gap-2 text-xs">
          <button type="button" aria-pressed={showU} onClick={() => setShowU((v) => !v)} className={`rounded-lg px-2 py-1 font-semibold ${showU ? "text-red-400" : "text-white/30 line-through"}`}>● Usuarios</button>
          <button type="button" aria-pressed={showV} onClick={() => setShowV((v) => !v)} className={`rounded-lg px-2 py-1 font-semibold ${showV ? "text-blue-400" : "text-white/30 line-through"}`}>● Vistas</button>
        </div>
      </div>
      {msg ? (
        <p className={`text-sm ${estado === "error" ? "text-red-300/80" : "text-white/45"}`}>{msg}</p>
      ) : n === 0 ? (
        <p className="text-sm text-white/45">Sin datos para este período.</p>
      ) : (
        <div
          className="relative select-none"
          style={{ touchAction: "pan-y" }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Evolución del tráfico entre ${fechaCorta(serie[0].fecha)} y ${fechaCorta(serie[n - 1].fecha)}: ${num(serie.reduce((a, s) => a + s.usuarios, 0))} usuarios y ${num(serie.reduce((a, s) => a + s.vistas, 0))} vistas en total.`}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" preserveAspectRatio="none">
            {pt && <line x1={xOf(hover as number)} y1={P} x2={xOf(hover as number)} y2={H - P} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {showU && <path d={path("usuarios", maxU)} fill="none" stroke="#ef4444" strokeWidth={2} />}
            {showV && <path d={path("vistas", maxV)} fill="none" stroke="#3b82f6" strokeWidth={2} />}
            {pt && showU && <circle cx={xOf(hover as number)} cy={yOf(pt.usuarios, maxU)} r={3.5} fill="#ef4444" />}
            {pt && showV && <circle cx={xOf(hover as number)} cy={yOf(pt.vistas, maxV)} r={3.5} fill="#3b82f6" />}
          </svg>
          <div className="mt-1 flex justify-between text-[10px] text-white/35">
            {ticks.map(({ i, s }) => <span key={i}>{fechaCorta(s.fecha).replace(/ \d{4}$/, "")}</span>)}
          </div>
          {pt && (
            <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-white/15 bg-black/90 px-3 py-2 text-xs shadow-lg" style={{ left: `${Math.max(12, Math.min(88, guidePct))}%` }}>
              <p className="font-bold text-white">{fechaCorta(pt.fecha)}</p>
              {showU && <p className="text-red-400">Usuarios: {num(pt.usuarios)}</p>}
              {showV && <p className="text-blue-400">Vistas: {num(pt.vistas)}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FunnelView({ title, stages }: { title: string; stages: Stage[] }) {
  const base = stages[0]?.count || 0;
  const max = Math.max(...stages.map((s) => s.count), 1);
  const totalConv = base > 0 ? Math.round((stages[stages.length - 1].count / base) * 1000) / 10 : null;
  return (
    <div className={CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {totalConv != null && <span className="text-xs text-white/55">Conversión total: <b className="text-white">{totalConv}%</b></span>}
      </div>
      {base === 0 ? (
        <p className="text-sm text-white/45">Sin datos para este período. (Las dimensiones nuevas pueden tardar 24-48 h.)</p>
      ) : (
        <div className="space-y-3">
          {stages.map((s, i) => (
            <div key={s.key}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="text-white/80">{i + 1}. {s.label}</span>
                <span className="flex items-center gap-3">
                  <b className="text-white">{num(s.count)}</b>
                  {s.convPrev != null && <span className="text-xs text-white/45">{s.convPrev}%</span>}
                  {s.dropPrev != null && s.dropPrev > 0 && <span className="text-xs text-red-400/80">−{num(s.dropPrev)}</span>}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-red-500" style={{ width: `${(s.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-white/35">El &quot;abandono&quot; es la diferencia entre etapas, no un seguimiento individual.</p>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-2 text-sm font-black uppercase tracking-[0.2em] text-white/40">{children}</h2>;
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function WebTab() {
  const [rango, setRango] = useState("7d");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [data, setData] = useState<WebData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rt, setRt] = useState<Realtime | null>(null);
  const acc = useRef(0);

  const cargar = useCallback(async () => {
    setLoading(true); setError(false);
    const id = ++acc.current;
    try {
      const qs = new URLSearchParams({ range: rango });
      if (rango === "custom" && desde && hasta) { qs.set("start", desde); qs.set("end", hasta); }
      const res = await fetch(`/api/admin/metricas/web?${qs.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (id !== acc.current) return; // respuesta obsoleta
      if (!res.ok) { setError(true); setData(null); }
      else setData(j as WebData);
    } catch {
      if (id === acc.current) { setError(true); setData(null); }
    } finally {
      if (id === acc.current) setLoading(false);
    }
  }, [rango, desde, hasta]);

  useEffect(() => {
    if (rango === "custom" && (!desde || !hasta)) return; // esperar ambas fechas
    cargar();
  }, [cargar, rango, desde, hasta]);

  // Realtime: sólo si GA4 está configurado; intervalo suave, pausa en background.
  const configured = data?.configured === true;
  useEffect(() => {
    if (!configured) { setRt(null); return; }
    let cancel = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch("/api/admin/metricas/web/realtime", { cache: "no-store" });
        const j: Realtime = await res.json();
        if (!cancel) setRt(j);
      } catch { /* no bloquea la pestaña */ }
      if (!cancel) t = setTimeout(tick, document.hidden ? 120000 : 45000);
    };
    tick();
    const onVis = () => { if (!document.hidden && !cancel) { if (t) clearTimeout(t); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancel = true; if (t) clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [configured]);

  const ok = data && data.configured ? (data as WebOk) : null;
  const neg = data?.negocio ?? null;
  const rangoTexto = useMemo(() => data ? `${data.range.start} al ${data.range.end}` : "", [data]);

  const inp = "w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500";

  return (
    <div className="space-y-6">
      {/* Encabezado + filtro */}
      <div className={CARD}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Analítica Web</p>
            <p className="mt-1 text-sm text-white/55">Comportamiento de la web pública (GA4) + resultados reales (Supabase).</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">Período</label>
              <select value={rango} onChange={(e) => setRango(e.target.value)} className={inp}>
                {RANGOS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
            {rango === "custom" && (
              <>
                <div><label className="mb-1 block text-xs text-white/50">Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inp} /></div>
                <div><label className="mb-1 block text-xs text-white/50">Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inp} /></div>
              </>
            )}
            <button onClick={cargar} className="h-[50px] rounded-xl border border-red-500/40 bg-red-500/10 px-5 text-sm font-semibold text-white hover:bg-red-500/20">Actualizar</button>
          </div>
        </div>
        {rangoTexto && <p className="mt-3 text-xs text-white/45">Rango activo: <b className="text-white/70">{rangoTexto}</b></p>}
      </div>

      {data && data.range.start < EXCLUSION_ADMIN_DESDE && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-white/45">
          Nota: la exclusión de tráfico <b className="text-white/70">/admin</b> se aplicó en agosto de 2026. Períodos anteriores pueden incluir tráfico administrativo histórico y no representan tráfico 100% público.
        </div>
      )}

      {error && <div className="rounded-2xl border border-red-500/30 bg-red-900/20 px-4 py-3 text-sm text-red-300">No se pudo cargar la analítica web. Reintentá con &quot;Actualizar&quot;.</div>}
      {loading && !data && <div className={`${CARD} text-center text-white/60`}>Cargando analítica…</div>}

      {data && !data.configured && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-900/15 px-4 py-3 text-sm text-amber-200">
          <b>Analytics no configurado.</b> Falta el acceso a la GA4 Data API (Property ID + service account). Los datos de comportamiento aparecerán una vez configurado. Abajo se muestran igualmente los <b>resultados reales</b> del período.
        </div>
      )}
      {ok && (() => {
        const fallidos = (Object.keys(ok.estados) as Array<keyof Estados>).filter((k) => ok.estados[k] === "error");
        return fallidos.length > 0 ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            No se pudieron cargar estos bloques: {fallidos.map((k) => ETIQUETA_BLOQUE[k]).join(", ")}.
          </div>
        ) : null;
      })()}

      {/* 1) RESUMEN */}
      {ok && (
        <>
          <SectionTitle>Resumen</SectionTitle>
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatCard title="Usuarios" value={num(ok.resumen.usuarios.value)} delta={ok.resumen.usuarios} />
            <StatCard title="Usuarios nuevos" value={num(ok.resumen.usuariosNuevos.value)} delta={ok.resumen.usuariosNuevos} />
            <StatCard title="Sesiones" value={num(ok.resumen.sesiones.value)} delta={ok.resumen.sesiones} />
            <StatCard title="Vistas de página" value={num(ok.resumen.vistas.value)} delta={ok.resumen.vistas} />
            <StatCard title="Engagement medio/sesión" value={segLegible(ok.resumen.engagementSeg.value)} delta={ok.resumen.engagementSeg} />
            {ok.conversionDisponible
              ? <StatCard title="Conversión (Analytics)" value={`${ok.resumen.conversion.value}%`} delta={ok.resumen.conversion} />
              : <StatCard title="Conversión (Analytics)" value="—" hint="Requiere el funnel (dimensiones nuevas, 24-48 h)" />}
          </div>

          {/* 2) EVOLUCIÓN */}
          <SectionTitle>Evolución</SectionTitle>
          <MiniLine serie={ok.serie} estado={ok.estados.evolucion} />

          {/* 3) ADQUISICIÓN */}
          <SectionTitle>Adquisición</SectionTitle>
          <div className="grid gap-6 xl:grid-cols-2">
            <Bloque title="Canales" status={ok.estados.canales}><BarList title="Canales" data={ok.canales} /></Bloque>
            <Bloque title="Fuente / Medio" status={ok.estados.fuentes}><BarList title="Fuente / Medio" data={ok.fuentes} /></Bloque>
          </div>

          {/* 4) CONTENIDO / AUDIENCIA */}
          <SectionTitle>Contenido y audiencia</SectionTitle>
          <div className="grid gap-6 xl:grid-cols-2">
            <Bloque title="Páginas más vistas" status={ok.estados.paginas}><BarList title="Páginas más vistas" data={ok.paginas} /></Bloque>
            <div className="grid gap-6">
              <Bloque title="Dispositivos" status={ok.estados.dispositivos}><BarList title="Dispositivos" data={ok.dispositivos} /></Bloque>
              <Bloque title="Ciudades" status={ok.estados.ciudades}><BarList title="Ciudades" data={ok.ciudades} /></Bloque>
            </div>
          </div>

          {/* 5) REALTIME */}
          <SectionTitle>En la web ahora</SectionTitle>
          <div className={CARD}>
            {rt == null ? (
              <p className="text-sm text-white/45">Cargando realtime…</p>
            ) : rt.error ? (
              <p className="text-sm text-white/45">Realtime no disponible en este momento.</p>
            ) : (
              <div className="grid gap-6 md:grid-cols-[200px_1fr]">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/45">Usuarios activos</p>
                  <p className="mt-2 text-4xl font-bold text-green-400">{num(rt.usuariosActivos ?? 0)}</p>
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.2em] text-white/45">Páginas activas</p>
                  {(rt.paginas ?? []).length === 0 ? <p className="text-sm text-white/45">Sin páginas activas.</p> : (
                    <ul className="space-y-1 text-sm">
                      {(rt.paginas ?? []).map((p) => (
                        <li key={p.label} className="flex justify-between gap-4"><span className="truncate text-white/75">{p.label}</span><b className="text-white">{num(p.value)}</b></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 6-7) FUNNELS */}
          <SectionTitle>Funnels</SectionTitle>
          <Bloque title="Funnels" status={ok.estados.funnels}>
            <div className="grid gap-6 xl:grid-cols-2">
              <FunnelView title="Funnel Reservas" stages={ok.funnelReservas} />
              <FunnelView title="Funnel Gift Cards" stages={ok.funnelGiftCards} />
            </div>
          </Bloque>

          {/* 8) PROMOCIONES / ERRORES */}
          <SectionTitle>Promociones y errores</SectionTitle>
          <div className="grid gap-6 xl:grid-cols-3">
            <Bloque title="Promociones" status={ok.estados.promociones}>
              <div className={CARD}>
                <h3 className="mb-4 text-lg font-semibold text-white">Promociones</h3>
                {!ok.promociones || ok.promociones.total === 0 ? (
                  <p className="text-sm text-white/45">Sin aplicaciones en el período.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-white/60">Aplicaciones</span><b className="text-white">{num(ok.promociones.total)}</b></div>
                    {ok.promociones.descuentoTotal != null && <div className="flex justify-between"><span className="text-white/60">Descuento total</span><b className="text-white">{money(ok.promociones.descuentoTotal)}</b></div>}
                    {ok.promociones.descuentoPromedio != null && <div className="flex justify-between"><span className="text-white/60">Descuento promedio</span><b className="text-white">{money(ok.promociones.descuentoPromedio)}</b></div>}
                    <div className="pt-2">{ok.promociones.porFunnel.map((f) => <div key={f.label} className="flex justify-between text-white/70"><span>{f.label}</span><span>{num(f.value)}</span></div>)}</div>
                  </div>
                )}
              </div>
            </Bloque>
            <Bloque title="Errores de checkout" status={ok.estados.errores}>
              <div className={CARD}>
                <h3 className="mb-4 text-lg font-semibold text-white">Errores de checkout</h3>
                {!ok.errores || ok.errores.checkout.length === 0 ? <p className="text-sm text-white/45">Sin errores técnicos en el período.</p> : (
                  <ul className="space-y-1 text-sm">{ok.errores.checkout.map((e) => <li key={e.label} className="flex justify-between gap-3"><span className="text-white/70">{e.label}</span><b className="text-red-300">{num(e.value)}</b></li>)}</ul>
                )}
              </div>
            </Bloque>
            <Bloque title="Resultados de pago" status={ok.estados.errores}>
              <div className={CARD}>
                <h3 className="mb-4 text-lg font-semibold text-white">Resultados de pago</h3>
                {!ok.errores ? <p className="text-sm text-white/45">Sin datos.</p> : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-white/60">Rechazados / fallidos</span><b className="text-red-300">{num(ok.errores.pago.failed)}</b></div>
                    <div className="flex justify-between"><span className="text-white/60">Pendientes</span><b className="text-amber-300">{num(ok.errores.pago.pending)}</b></div>
                    <p className="pt-1 text-[11px] text-white/35">&quot;Pendiente&quot; no es un error.</p>
                  </div>
                )}
              </div>
            </Bloque>
          </div>
        </>
      )}

      {/* 9) RESULTADOS REALES (Supabase) — bloque claramente diferenciado */}
      {neg && (
        <>
          <SectionTitle>Resultados reales generados por la web</SectionTitle>
          <div className="rounded-2xl border border-green-500/25 bg-green-500/[0.04] p-5">
            <p className="mb-4 text-xs text-white/50">Datos reales de Supabase (no GA4). Atribuibles a la web: reservas con origen web confirmadas y Gift Cards pagadas del período.</p>
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <StatCard title="Reservas web" value={num(neg.reservasWeb)} hint="Confirmadas" />
              <StatCard title="Ingresos reservas" value={money(neg.ingresosReservas)} hint="Real" />
              <StatCard title="Ticket reservas" value={neg.ticketReservas != null ? money(neg.ticketReservas) : "—"} hint="Promedio" />
              <StatCard title="Gift Cards" value={num(neg.giftCards)} hint="Emitidas" />
              <StatCard title="Ingresos Gift Cards" value={money(neg.ingresosGiftCards)} hint="Real" />
              <StatCard title="Ingresos web totales" value={money(neg.ingresosTotal)} hint="Reservas + Gift Cards" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// IA SIM · Bloque 3B — Pestaña Equipo (ADMIN-only). Consume /api/admin/metricas/equipo
// (la API es la autoridad real). No muestra nombres ni teléfonos de clientes.

type Metricas = { turnos: number; personas: number; operaciones: number; minutos: number; bruto: number; comision: number; neto: number };
type Integrante = { empleado_id: string; nombre: string; archivado: boolean; horas_minutos: number; total: Metricas; stand: Metricas; reservas: Metricas };
type SinAtribuir = { motivo: string; metricas: Metricas };
type Exclusion = { tipo: string; cantidad: number; periodo: string; detalle: string };
type Anomalia = { tipo: string; gravedad: "info" | "warn"; mensaje: string; cantidad?: number };
type Recon = { ok: boolean; filas: Array<{ metrica: string; origen: number; atribuido: number; sinAtribuir: number; diff: number; ok: boolean }> };
type Reporte = {
  periodo: { desde: string; hasta: string };
  zonaHoraria: string;
  corte: string;
  cronograma: { cobertura: Array<{ mes: string; estado: string; dias: number; dias_cerrados: number }>; todosConfirmados: boolean };
  fuentesUsadas: string;
  integrantes: Integrante[];
  totalesOrigen: Metricas;
  totalesAtribuidos: Metricas;
  sinAtribuir: SinAtribuir[];
  actividadFuturaPendiente: { cantidad: number; metricas: Metricas };
  exclusiones: Exclusion[];
  anomalias: Anomalia[];
  reconciliacion: Recon;
  frescura: { turnos_stand: string | null; reservas: string | null; generado_at: string };
  registros: { stand: number; reservas: number; historicos_en_rango: number };
};

const CARD = "rounded-2xl border border-white/10 bg-white/[0.04] p-5";
const nf = new Intl.NumberFormat("es-AR");
const money = (n: number) => `$${nf.format(Math.round(n || 0))}`;
const dec = (n: number) => (Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toLocaleString("es-AR"));
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
function horas(min: number) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} m`;
}
const MOTIVO_LABEL: Record<string, string> = {
  cronograma_no_confirmado: "Cronograma no confirmado",
  dia_cerrado: "Día cerrado",
  fuera_horario: "Fuera del horario operativo",
  fecha_hora_invalida: "Fecha/hora inválida",
  datos_fuente_incompletos: "Datos de fuente incompletos",
};

export default function EquipoTab() {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [fuente, setFuente] = useState<"todas" | "stand" | "reservas">("todas");
  const [data, setData] = useState<Reporte | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/metricas/equipo?anio=${anio}&mes=${mes}&fuente=${fuente}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) { setError(json?.error || "No se pudo cargar."); setData(null); return; }
      setData(json as Reporte);
    } catch {
      setError("Error de red.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [anio, mes, fuente]);

  useEffect(() => { cargar(); }, [cargar]);

  function cambiarMes(delta: number) {
    let m = mes + delta, a = anio;
    if (m < 1) { m = 12; a--; } else if (m > 12) { m = 1; a++; }
    setMes(m); setAnio(a);
  }

  const cort:{fecha:string;hora:string} | null = useMemo(() => {
    if (!data) return null;
    const [f, h] = data.corte.split("T");
    return { fecha: f, hora: (h || "").slice(0, 5) };
  }, [data]);

  // Mes incompleto = el corte cae dentro del mes consultado (hoy < fin de mes).
  const mesIncompleto = useMemo(() => {
    if (!data || !cort) return false;
    return cort.fecha >= data.periodo.desde && cort.fecha <= data.periodo.hasta;
  }, [data, cort]);

  return (
    <div className="space-y-5">
      {/* Controles */}
      <div className={CARD}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-2 block text-sm text-white/70">Mes</label>
            <div className="flex items-center gap-2">
              <button onClick={() => cambiarMes(-1)} className="rounded-xl border border-white/10 px-3 py-2 text-white/70 hover:text-white">‹</button>
              <span className="min-w-[150px] text-center font-bold text-white">{MESES[mes - 1]} {anio}</span>
              <button onClick={() => cambiarMes(1)} className="rounded-xl border border-white/10 px-3 py-2 text-white/70 hover:text-white">›</button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-white/70">Fuente</label>
            <div className="flex rounded-xl border border-white/10 bg-black/40 p-1">
              {(["todas", "stand", "reservas"] as const).map((f) => (
                <button key={f} onClick={() => setFuente(f)} className={`rounded-lg px-4 py-2 text-sm font-bold capitalize ${fuente === f ? "bg-red-600 text-white" : "text-white/50 hover:text-white"}`}>{f}</button>
              ))}
            </div>
          </div>
          <button onClick={cargar} className="rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-500/20">Actualizar</button>
        </div>
      </div>

      {loading && <div className={CARD}><p className="text-white/60">Calculando métricas del equipo…</p></div>}
      {error && <div className={`${CARD} border-red-500/40`}><p className="font-bold text-red-300">{error}</p></div>}

      {data && !loading && (
        <>
          {/* Estado del cronograma + corte */}
          <div className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">Cronograma del período</p>
                <p className="mt-1 font-bold text-white">
                  {data.cronograma.cobertura.map((c) => `${c.mes}: ${c.estado}`).join(" · ")}
                </p>
              </div>
              {!data.cronograma.todosConfirmados && (
                <span className="rounded-full bg-amber-500/15 px-4 py-1.5 text-xs font-black uppercase text-amber-400 ring-1 ring-amber-500/40">Sin confirmar → actividad sin atribuir</span>
              )}
            </div>
            {mesIncompleto && cort && (
              <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-bold text-white/80">
                Resultados reales hasta {cort.fecha} {cort.hora} ({data.zonaHoraria.replace("America/Argentina/", "")}). La actividad posterior figura como pendiente/futura.
              </p>
            )}
            <p className="mt-2 text-xs text-white/40">Registros: {data.registros.stand} de Stand · {data.registros.reservas} de Reservas · imputados al mes del servicio (no altera Finanzas).</p>
          </div>

          {/* Tabla por integrante */}
          <div className={CARD}>
            <h3 className="mb-4 text-lg font-semibold text-white">Por integrante</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="text-left text-white/50">
                    <th className="py-2 pr-3">Integrante</th>
                    <th className="px-3">Horas</th>
                    <th className="px-3">Turnos</th>
                    <th className="px-3">Personas</th>
                    <th className="px-3">Oper.</th>
                    <th className="px-3">Minutos</th>
                    <th className="px-3 text-right">Bruto</th>
                    <th className="px-3 text-right">Comisión</th>
                    <th className="px-3 text-right">Neto</th>
                    <th className="px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.integrantes.map((i) => (
                    <FilaIntegrante key={i.empleado_id} i={i} abierto={expandido === i.empleado_id} onToggle={() => setExpandido(expandido === i.empleado_id ? null : i.empleado_id)} />
                  ))}
                  {/* Totales atribuidos */}
                  <tr className="border-t border-white/15 font-black text-white">
                    <td className="py-2 pr-3">Total atribuido</td>
                    <td className="px-3">—</td>
                    <td className="px-3">{dec(data.totalesAtribuidos.turnos)}</td>
                    <td className="px-3">{dec(data.totalesAtribuidos.personas)}</td>
                    <td className="px-3">{dec(data.totalesAtribuidos.operaciones)}</td>
                    <td className="px-3">{dec(data.totalesAtribuidos.minutos)}</td>
                    <td className="px-3 text-right">{money(data.totalesAtribuidos.bruto)}</td>
                    <td className="px-3 text-right">{money(data.totalesAtribuidos.comision)}</td>
                    <td className="px-3 text-right">{money(data.totalesAtribuidos.neto)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            {(fuente === "todas" || fuente === "reservas") && (
              <p className="mt-3 text-xs text-white/40">Comisión de Reservas web: Finanzas no la modela → se informa 0 (limitación declarada; no se inventa una tasa).</p>
            )}
          </div>

          {/* Sin atribuir */}
          {data.sinAtribuir.length > 0 && (
            <div className={CARD}>
              <h3 className="mb-3 text-lg font-semibold text-white">Actividad sin atribuir</h3>
              <div className="space-y-2">
                {data.sinAtribuir.map((s) => (
                  <div key={s.motivo} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-4 py-2">
                    <span className="font-bold text-amber-300">{MOTIVO_LABEL[s.motivo] ?? s.motivo}</span>
                    <span className="text-white/70">{dec(s.metricas.operaciones)} oper · {dec(s.metricas.turnos)} turnos · {money(s.metricas.bruto)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actividad futura pendiente */}
          {data.actividadFuturaPendiente.cantidad > 0 && (
            <div className={CARD}>
              <h3 className="mb-2 text-lg font-semibold text-white">Actividad futura / pendiente</h3>
              <p className="text-white/70">{data.actividadFuturaPendiente.cantidad} operación/es cuyo servicio aún no ocurrió (no suman a los resultados efectivos): {dec(data.actividadFuturaPendiente.metricas.turnos)} turnos · {money(data.actividadFuturaPendiente.metricas.bruto)} bruto.</p>
            </div>
          )}

          {/* Exclusiones */}
          {data.exclusiones.length > 0 && (
            <div className={CARD}>
              <h3 className="mb-3 text-lg font-semibold text-white">Exclusiones y calidad de datos</h3>
              <ul className="space-y-2 text-sm">
                {data.exclusiones.map((e, k) => (
                  <li key={k} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-4 py-2">
                    <span className="text-white/80">{e.detalle}</span>
                    <span className="font-bold text-white/60">{e.cantidad}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Anomalías */}
          {data.anomalias.length > 0 && (
            <div className={`${CARD} border-amber-500/30`}>
              <h3 className="mb-3 text-lg font-semibold text-amber-300">Advertencias</h3>
              <ul className="space-y-1 text-sm">
                {data.anomalias.map((a, k) => (
                  <li key={k} className="text-white/75">• {a.mensaje}{a.cantidad != null ? ` (${a.cantidad})` : ""}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Reconciliación */}
          <div className={CARD}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Reconciliación</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${data.reconciliacion.ok ? "bg-green-500/15 text-green-400 ring-1 ring-green-500/40" : "bg-red-500/15 text-red-400 ring-1 ring-red-500/40"}`}>{data.reconciliacion.ok ? "Cuadra" : "Diferencia"}</span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-left text-white/50"><th className="py-1 pr-3">Métrica</th><th className="px-3 text-right">Origen</th><th className="px-3 text-right">Atribuido</th><th className="px-3 text-right">Sin atribuir</th><th className="px-3 text-right">Δ</th></tr></thead>
                <tbody>
                  {data.reconciliacion.filas.map((f) => (
                    <tr key={f.metrica} className="border-t border-white/5">
                      <td className="py-1 pr-3 capitalize text-white/70">{f.metrica}</td>
                      <td className="px-3 text-right text-white/80">{f.metrica === "bruto" || f.metrica === "comision" || f.metrica === "neto" ? money(f.origen) : dec(f.origen)}</td>
                      <td className="px-3 text-right text-white/80">{f.metrica === "bruto" || f.metrica === "comision" || f.metrica === "neto" ? money(f.atribuido) : dec(f.atribuido)}</td>
                      <td className="px-3 text-right text-white/80">{f.metrica === "bruto" || f.metrica === "comision" || f.metrica === "neto" ? money(f.sinAtribuir) : dec(f.sinAtribuir)}</td>
                      <td className={`px-3 text-right ${f.ok ? "text-white/40" : "text-red-400"}`}>{Math.abs(f.diff) < 0.005 ? "0" : dec(f.diff)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilaIntegrante({ i, abierto, onToggle }: { i: Integrante; abierto: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-white/5">
        <td className="py-2 pr-3 font-bold text-white">
          {i.nombre}
          {i.archivado && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black uppercase text-white/60">Archivado</span>}
        </td>
        <td className="px-3 text-white/80">{horas(i.horas_minutos)}</td>
        <td className="px-3 text-white/80">{dec(i.total.turnos)}</td>
        <td className="px-3 text-white/80">{dec(i.total.personas)}</td>
        <td className="px-3 text-white/80">{dec(i.total.operaciones)}</td>
        <td className="px-3 text-white/80">{dec(i.total.minutos)}</td>
        <td className="px-3 text-right text-white/90">{money(i.total.bruto)}</td>
        <td className="px-3 text-right text-white/70">{money(i.total.comision)}</td>
        <td className="px-3 text-right font-bold text-white">{money(i.total.neto)}</td>
        <td className="px-2 text-right"><button onClick={onToggle} className="text-white/40 hover:text-white">{abierto ? "▾" : "▸"}</button></td>
      </tr>
      {abierto && (
        <tr className="bg-white/[0.02]">
          <td colSpan={10} className="px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <DesgloseFuente titulo="Stand" m={i.stand} />
              <DesgloseFuente titulo="Reservas web" m={i.reservas} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DesgloseFuente({ titulo, m }: { titulo: string; m: Metricas }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
      <p className="mb-2 font-black uppercase tracking-wide text-white/50">{titulo}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-white/70">
        <span>Turnos: <b className="text-white/90">{dec(m.turnos)}</b></span>
        <span>Personas: <b className="text-white/90">{dec(m.personas)}</b></span>
        <span>Operaciones: <b className="text-white/90">{dec(m.operaciones)}</b></span>
        <span>Minutos: <b className="text-white/90">{dec(m.minutos)}</b></span>
        <span>Bruto: <b className="text-white/90">{money(m.bruto)}</b></span>
        <span>Comisión: <b className="text-white/90">{money(m.comision)}</b></span>
        <span className="col-span-2">Neto: <b className="text-white/90">{money(m.neto)}</b></span>
      </div>
    </div>
  );
}

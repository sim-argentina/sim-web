"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { msToTiempo } from "@/lib/campeonatos";

// ── Tipos del DTO que devuelve /api/admin/campeonatos/[id]/bracket ────────────
type Participante = {
  id: string | null; inscripcion_id: string; nombre: string; presente: boolean; incluido: boolean;
  estado: string; mejor_ms: number | null; seed: number | null; posicion_provisional?: number | null; persistido?: boolean;
};
type CarreraPart = {
  id: string; inscripcion_id: string; nombre: string; seed: number | null;
  origen_posicion: number | null; posicion_final: number | null; estado: string;
  clasifica: boolean | null; observacion: string | null;
};
type Carrera = { id: string; numero: number; estado: string; es_bye: boolean; vueltas: number; participantes: CarreraPart[] };
type Ronda = { id: string; numero: number; nombre: string | null; tipo: string; estado: string; carreras: Carrera[] };
type PremioItem = { puesto: number; monto: number; trofeo?: boolean };
type EstadoBracket = {
  campeonato: { id: string; nombre: string; usa_ronda_preliminar: boolean | null };
  cfg: {
    clasificacion: { habilitada: boolean; vueltas: number; criterio: string };
    eliminatoria: { pilotosPorCarrera: number; avanzanPorCarrera: number; vueltas: number; finalPilotos: number };
  };
  configValida: { ok: boolean; error?: string };
  premios: { total?: number; detalle?: PremioItem[] } | null;
  bracket: { id: string | null; estado: string; seeding_modo: string; clasificacion_habilitada: boolean;
    podio: Array<{ puesto: number; inscripcion_id: string; nombre: string }> | null };
  participantes: Participante[];
  rondas: Ronda[];
};

type CampLite = { id: string; nombre: string; modalidad?: string | null };

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-AR")}`;

// ── Fila de clasificación (quali) ─────────────────────────────────────────────
// Un único campo: MEJOR TIEMPO. No se cargan vueltas individuales.
function QualiRow({ p, provisional, onGuardar }: {
  p: Participante;
  provisional: boolean; // true: clasificación abierta → se muestra POS. provisional, no seed
  onGuardar: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  // Estado local desde props; el padre remonta la fila (key con mejor_ms) al cambiar.
  const [tiempo, setTiempo] = useState(() => (p.mejor_ms != null ? msToTiempo(p.mejor_ms) : ""));
  const [saving, setSaving] = useState(false);

  const guardar = async () => {
    setSaving(true);
    await onGuardar(p.inscripcion_id, { mejor_tiempo: tiempo });
    setSaving(false);
  };

  const inp = "w-28 rounded-lg bg-black/40 border border-white/10 px-2 py-1 text-sm text-white font-mono focus:border-red-500 outline-none";
  return (
    <tr className="border-t border-white/5">
      <td className="px-2 py-2 text-center font-black text-red-400">{(provisional ? p.posicion_provisional : p.seed) ?? "—"}</td>
      <td className="px-2 py-2 font-bold text-white">{p.nombre}</td>
      <td className="px-2 py-2">
        <label className="flex items-center gap-1 text-xs text-zinc-300">
          <input type="checkbox" checked={p.presente}
            onChange={(e) => onGuardar(p.inscripcion_id, { presente: e.target.checked })} className="accent-red-500" />
          Presente
        </label>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <input className={inp} placeholder="1:30.850" value={tiempo}
            onChange={(e) => setTiempo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") guardar(); }} />
          <button onClick={guardar} disabled={saving}
            className="rounded-lg bg-zinc-700 px-2 py-1 text-xs font-bold text-white hover:bg-zinc-600 disabled:opacity-50">
            {saving ? "…" : "Guardar"}
          </button>
        </div>
      </td>
      <td className="px-2 py-2">
        {p.mejor_ms == null && p.presente && (
          <label className="flex items-center gap-1 text-xs text-amber-300">
            <input type="checkbox" checked={p.incluido}
              onChange={(e) => onGuardar(p.inscripcion_id, { incluido: e.target.checked })} className="accent-red-500" />
            Incluir sin tiempo
          </label>
        )}
      </td>
    </tr>
  );
}

// ── Card de carrera ───────────────────────────────────────────────────────────
function CarreraCard({ carrera, cfg, esAdmin, onCarrera }: {
  carrera: Carrera; cfg: EstadoBracket["cfg"]; esAdmin: boolean;
  onCarrera: (body: Record<string, unknown>) => Promise<void>;
}) {
  const n = carrera.participantes.length;
  // Estado local desde props; el padre remonta la card (key con estado) al cambiar.
  const [res, setRes] = useState<Record<string, { pos: string; estado: string; obs: string }>>(() => {
    const init: Record<string, { pos: string; estado: string; obs: string }> = {};
    carrera.participantes.forEach((p) => {
      init[p.id] = { pos: p.posicion_final != null ? String(p.posicion_final) : "", estado: p.estado || "activo", obs: p.observacion || "" };
    });
    return init;
  });
  const [busy, setBusy] = useState(false);

  const badge = (estado: string) => {
    const m: Record<string, string> = {
      pendiente: "bg-zinc-700/50 text-zinc-300", en_curso: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
      finalizada: "bg-green-500/20 text-green-400 border border-green-500/30",
    };
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${m[estado] ?? "bg-zinc-700"}`}>{estado}</span>;
  };

  const guardar = async () => {
    setBusy(true);
    await onCarrera({ carrera_id: carrera.id, accion: "guardar_resultado",
      resultado: carrera.participantes.map((p) => ({ participante_id: p.id, posicion_final: res[p.id]?.pos || null, estado: res[p.id]?.estado, observacion: res[p.id]?.obs })) });
    setBusy(false);
  };

  const finalizado = carrera.estado === "finalizada";
  const enCurso = carrera.estado === "en_curso";
  const sel = "rounded bg-black/40 border border-white/10 px-1.5 py-1 text-xs text-white outline-none focus:border-red-500";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 min-w-[240px]">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-wider text-white">{carrera.es_bye ? "BYE" : `Carrera ${carrera.numero}`}</p>
        {badge(carrera.estado)}
      </div>
      <div className="space-y-1.5">
        {carrera.participantes.map((p) => (
          <div key={p.id} className="rounded-lg bg-black/30 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-black text-red-400">S{p.seed ?? "—"}</span>{" "}
                <span className="text-sm font-bold text-white">{p.nombre}</span>
                {p.origen_posicion != null && <span className="ml-1 text-[10px] text-zinc-500">(P{p.origen_posicion})</span>}
              </div>
              {finalizado && (
                p.clasifica
                  ? <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-black text-green-400">CLASIFICADO</span>
                  : <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-black text-red-400">ELIMINADO</span>
              )}
            </div>
            {enCurso && !carrera.es_bye && (
              <div className="mt-1 flex items-center gap-1">
                <select className={sel} value={res[p.id]?.pos ?? ""} onChange={(e) => setRes((r) => ({ ...r, [p.id]: { ...r[p.id], pos: e.target.value } }))}>
                  <option value="">Pos</option>
                  {Array.from({ length: n }, (_, i) => <option key={i} value={i + 1}>{i + 1}º</option>)}
                </select>
                <select className={sel} value={res[p.id]?.estado ?? "activo"} onChange={(e) => setRes((r) => ({ ...r, [p.id]: { ...r[p.id], estado: e.target.value } }))}>
                  <option value="activo">OK</option>
                  <option value="dnf">DNF</option>
                  <option value="dsq">DSQ</option>
                </select>
              </div>
            )}
            {finalizado && p.posicion_final != null && <span className="text-[11px] text-zinc-400">{p.posicion_final}º{p.estado !== "activo" ? ` · ${p.estado.toUpperCase()}` : ""}</span>}
          </div>
        ))}
      </div>
      {!carrera.es_bye && (
        <div className="mt-2 flex flex-wrap gap-1">
          {carrera.estado === "pendiente" && (
            <button onClick={() => onCarrera({ carrera_id: carrera.id, accion: "iniciar" })}
              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-500">Iniciar</button>
          )}
          {enCurso && (
            <>
              <button onClick={guardar} disabled={busy} className="rounded-lg bg-zinc-700 px-3 py-1 text-xs font-bold text-white hover:bg-zinc-600 disabled:opacity-50">Guardar</button>
              <button onClick={() => onCarrera({ carrera_id: carrera.id, accion: "finalizar" })}
                className="rounded-lg bg-green-600 px-3 py-1 text-xs font-bold text-white hover:bg-green-500">Finalizar</button>
            </>
          )}
          {finalizado && esAdmin && (
            <button onClick={() => { if (confirm("¿Reabrir esta carrera? Si hay una ronda posterior sin iniciar, se regenerará.")) onCarrera({ carrera_id: carrera.id, accion: "reabrir" }); }}
              className="rounded-lg border border-white/15 px-3 py-1 text-xs font-bold text-zinc-300 hover:text-white">Reabrir</button>
          )}
        </div>
      )}
      <p className="mt-1 text-[10px] text-zinc-600">{carrera.vueltas} vueltas · avanzan {cfg.eliminatoria.avanzanPorCarrera}</p>
    </div>
  );
}

// ── Tab principal ─────────────────────────────────────────────────────────────
export default function TabBracket({ campeonatos, role }: { campeonatos: CampLite[]; role: string | null }) {
  const eliminacion = useMemo(() => campeonatos.filter((c) => c.modalidad === "eliminacion"), [campeonatos]);
  const [campSel, setCampSel] = useState("");
  const [data, setData] = useState<EstadoBracket | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const esAdmin = role === "admin";

  useEffect(() => { if (!campSel && eliminacion[0]) setCampSel(eliminacion[0].id); }, [eliminacion, campSel]);

  const cargar = useCallback(async () => {
    if (!campSel) { setData(null); return; }
    setLoading(true); setMsg("");
    try {
      const res = await fetch(`/api/admin/campeonatos/${campSel}/bracket`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Error cargando bracket"); setData(null); }
      else setData(d);
    } catch { setMsg("Error de conexión"); }
    finally { setLoading(false); }
  }, [campSel]);
  useEffect(() => { cargar(); }, [cargar]);

  const post = async (url: string, body: Record<string, unknown>) => {
    setMsg("");
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(d.error || "Error"); return false; }
    await cargar();
    return true;
  };
  const accion = (body: Record<string, unknown>) => post(`/api/admin/campeonatos/${campSel}/bracket/acciones`, body);
  const onCarrera = async (body: Record<string, unknown>) => { await post(`/api/admin/campeonatos/${campSel}/bracket/carrera`, body); };
  const guardarQuali = async (inscripcion_id: string, patch: Record<string, unknown>) => {
    await post(`/api/admin/campeonatos/${campSel}/bracket/clasificacion`, { inscripcion_id, ...patch });
  };

  const sel = "rounded-xl bg-black/40 border border-white/10 px-4 py-2 text-sm text-white outline-none focus:border-red-500";

  if (eliminacion.length === 0) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-zinc-400">No hay campeonatos de modalidad <b className="text-white">eliminación</b>. Creá uno o cambiá la modalidad de un campeonato en la pestaña Campeonatos.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className={sel} value={campSel} onChange={(e) => setCampSel(e.target.value)}>
          {eliminacion.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <button onClick={cargar} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-zinc-300 hover:text-white">Actualizar</button>
        {data && <span className="text-xs text-zinc-500">Estado: <b className="text-white">{data.bracket.estado}</b> · {data.cfg.eliminatoria.pilotosPorCarrera}/carrera · avanzan {data.cfg.eliminatoria.avanzanPorCarrera} · final {data.cfg.eliminatoria.finalPilotos}</span>}
      </div>

      {msg && <p className="rounded-xl border border-red-500/30 bg-red-900/20 px-4 py-2 text-sm text-red-300">{msg}</p>}
      {loading && <p className="text-zinc-500">Cargando…</p>}

      {data && !data.configValida.ok && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
          La configuración de este campeonato no permite generar un bracket válido: {data.configValida.error}
        </p>
      )}

      {/* ── CLASIFICACIÓN ── */}
      {data && data.bracket.estado === "clasificacion" && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-black text-white">Clasificación {data.cfg.clasificacion.habilitada ? `(${data.cfg.clasificacion.vueltas} vueltas)` : "(seeding manual)"}</h3>
            <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
              <span>Inscriptos: <b className="text-white">{data.participantes.length}</b></span>
              <span>Presentes: <b className="text-white">{data.participantes.filter((p) => p.presente).length}</b></span>
              <span>Con tiempo: <b className="text-white">{data.participantes.filter((p) => p.mejor_ms != null).length}</b></span>
            </div>
          </div>
          {data.bracket.clasificacion_habilitada && (
            <p className="mb-3 text-[11px] text-zinc-500">La columna <b className="text-zinc-300">Pos.</b> es el orden provisional por mejor tiempo. Los <b className="text-zinc-300">seeds</b> se definen y congelan al cerrar la clasificación.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>{[data.bracket.clasificacion_habilitada ? "Pos." : "Seed", "Piloto", "Presencia", "Mejor tiempo", "Sin tiempo"].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.participantes.map((p) => (
                  <QualiRow key={`${p.inscripcion_id}-${p.mejor_ms}`} p={p} provisional={data.bracket.clasificacion_habilitada} onGuardar={guardarQuali} />
                ))}
              </tbody>
            </table>
          </div>
          {esAdmin && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => { if (confirm("¿Cerrar la clasificación? Se congelan los seeds.")) accion({ accion: "cerrar_clasificacion" }); }}
                className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-500">Cerrar clasificación</button>
            </div>
          )}
        </div>
      )}

      {/* ── BRACKET (cerrada / en curso / finalizado) ── */}
      {data && data.bracket.estado !== "clasificacion" && (
        <>
          <div className="flex flex-wrap gap-2">
            {data.rondas.length === 0 && esAdmin && data.configValida.ok && (
              <button onClick={() => accion({ accion: "generar_bracket" })}
                className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-500">Generar bracket</button>
            )}
            {esAdmin && data.bracket.estado !== "finalizado" && (
              <button onClick={() => { if (confirm("¿Reabrir la clasificación? Solo se permite si ninguna carrera comenzó.")) accion({ accion: "reabrir_clasificacion" }); }}
                className="rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-zinc-300 hover:text-white">Reabrir clasificación</button>
            )}
          </div>

          {/* Seeding DEFINITIVO (clasificación ya cerrada, bracket aún no generado) */}
          {data.rondas.length === 0 && data.participantes.some((p) => p.seed != null) && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="mb-3 font-black text-white">Seeding definitivo</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>{["Seed", "Piloto", "Mejor tiempo"].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.participantes.filter((p) => p.seed != null).map((p) => (
                      <tr key={p.inscripcion_id} className="border-t border-white/5">
                        <td className="px-2 py-2 text-center font-black text-red-400">{p.seed}</td>
                        <td className="px-2 py-2 font-bold text-white">{p.nombre}</td>
                        <td className="px-2 py-2 font-mono text-zinc-300">{p.mejor_ms != null ? msToTiempo(p.mejor_ms) : "Sin tiempo"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Rondas como columnas (desktop) / stack (mobile) */}
          <div className="flex gap-4 overflow-x-auto pb-2">
            {data.rondas.map((r) => {
              const todasFin = r.carreras.length > 0 && r.carreras.every((c) => c.estado === "finalizada");
              const yaHaySiguiente = data.rondas.some((x) => x.numero === r.numero + 1);
              return (
                <div key={r.id} className="min-w-[260px] shrink-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-black text-white">{r.nombre || `Ronda ${r.numero}`}</h4>
                    <span className="text-[10px] uppercase text-zinc-500">{r.tipo}{r.estado === "finalizada" ? " · ✓" : ""}</span>
                  </div>
                  {r.carreras.map((c) => (
                    <CarreraCard key={`${c.id}-${c.estado}`} carrera={c} cfg={data.cfg} esAdmin={esAdmin} onCarrera={onCarrera} />
                  ))}
                  {esAdmin && r.tipo !== "final" && todasFin && !yaHaySiguiente && (
                    <button onClick={() => accion({ accion: "generar_siguiente_ronda", ronda_id: r.id })}
                      className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500">Generar siguiente ronda →</button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Podio + premios */}
          {data.bracket.podio && data.bracket.podio.length > 0 && (
            <div className="rounded-2xl border border-red-500/30 bg-red-600/5 p-5">
              <h3 className="mb-3 font-black text-white">🏆 Podio</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {data.bracket.podio.map((pod) => {
                  const premio = data.premios?.detalle?.find((d) => d.puesto === pod.puesto);
                  const medalla = pod.puesto === 1 ? "🥇" : pod.puesto === 2 ? "🥈" : "🥉";
                  return (
                    <div key={pod.puesto} className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-lg font-black text-white">{medalla} {pod.nombre}</p>
                      {premio && <p className="text-sm text-red-300">{money(premio.monto)}{premio.trofeo ? " + Trofeo" : ""}</p>}
                    </div>
                  );
                })}
              </div>
              {esAdmin && data.bracket.estado !== "finalizado" && (
                <button onClick={() => accion({ accion: "finalizar_torneo" })}
                  className="mt-4 rounded-xl bg-zinc-700 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-600">Finalizar torneo</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

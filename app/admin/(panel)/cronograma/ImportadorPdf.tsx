"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Empleado = { id: string; nombre_formal: string };
type JornadaProp = { alias_texto: string; empleado_id: string | null; hora_inicio: string; hora_fin: string };
type DiaProp = { fecha: string; cerrado: boolean; apertura: string; cierre: string; jornadas: JornadaProp[] };
type ClaseConflicto = "sin_cambios" | "solo_pdf" | "solo_borrador" | "diferente";
type Conflicto = { fecha: string; clase: ClaseConflicto; decision: "pdf" | "actual" | null; actual: DiaProp | null; pdf: DiaProp | null };
type AliasResuelto = { empleado_id: string | null; nombre: string | null; activo: boolean };
type Propuesta = { mes_estado_actual: string; aliases: Record<string, AliasResuelto>; dias: DiaProp[]; conflictos: Conflicto[] };
type Incidencia = { tipo: string; severidad: "bloqueante" | "advertencia"; detalle: string; fecha?: string; texto?: string };
type Importacion = {
  id: string; anio: number; mes: number; archivo_nombre: string; estado: string;
  bloquea_confirmacion: boolean; paginas: number | null; propuesta: Propuesta | null; incidencias: Incidencia[] | null;
};

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const pad = (n: number) => String(n).padStart(2, "0");

export default function ImportadorPdf({
  empleados,
  onAplicada,
  onCerrar,
}: {
  empleados: Empleado[];
  onAplicada: () => void;
  onCerrar: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [imp, setImp] = useState<Importacion | null>(null);
  const [dias, setDias] = useState<DiaProp[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "error" | "ok"; texto: string } | null>(null);

  // Sincroniza la copia editable con la propuesta del servidor.
  useEffect(() => {
    if (imp?.propuesta) setDias(imp.propuesta.dias.map((d) => ({ ...d, jornadas: d.jornadas.map((j) => ({ ...j })) })));
  }, [imp]);

  const incidencias = imp?.incidencias ?? [];
  const bloqueantes = incidencias.filter((i) => i.severidad === "bloqueante");
  const advertencias = incidencias.filter((i) => i.severidad === "advertencia");
  const prop = imp?.propuesta ?? null;
  const rechazada = imp?.estado === "rechazada";
  const mesConfirmado = prop?.mes_estado_actual === "confirmado";

  const totalJornadas = useMemo(() => dias.reduce((n, d) => n + (d.cerrado ? 0 : d.jornadas.length), 0), [dias]);
  const diasDelMes = useMemo(() => {
    if (!imp) return [];
    const total = new Date(Date.UTC(imp.anio, imp.mes, 0)).getUTCDate();
    return Array.from({ length: total }, (_, i) => `${imp.anio}-${pad(imp.mes)}-${pad(i + 1)}`);
  }, [imp]);

  async function analizar() {
    if (!file) { setMsg({ tipo: "error", texto: "Seleccioná un PDF." }); return; }
    setAnalizando(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/cronograma/importar/analizar", { method: "POST", body: fd });
      let j: { importacion?: Importacion; error?: string } = {};
      try { j = await res.json(); } catch { /* respuesta no-JSON */ }
      if (!res.ok || !j.importacion) {
        setMsg({ tipo: "error", texto: j.error || `No se pudo analizar el PDF (código ${res.status}).` });
        return;
      }
      setImp(j.importacion);
      setMsg(null);
    } catch {
      setMsg({ tipo: "error", texto: "No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo." });
    } finally {
      setAnalizando(false);
    }
  }

  // Persiste la propuesta editada (PUT) y refresca desde el servidor (revalida).
  const persistir = useCallback(async (nuevosDias: DiaProp[], extra?: { aliases?: Record<string, string | null>; decisiones?: Record<string, "pdf" | "actual" | null> }) => {
    if (!imp) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/cronograma/importar/${imp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dias: nuevosDias, ...extra }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tipo: "error", texto: j.error || "No se pudieron guardar los cambios." }); return; }
      setImp(j.importacion as Importacion);
    } catch {
      setMsg({ tipo: "error", texto: "No se pudieron guardar los cambios (conexión)." });
    } finally {
      setGuardando(false);
    }
  }, [imp]);

  // ── Edición de la propuesta (persiste tras cada cambio) ─────────────────────
  function setDia(fecha: string, patch: Partial<DiaProp>) {
    setDias((prev) => prev.map((d) => (d.fecha === fecha ? { ...d, ...patch } : d)));
  }
  function guardarLocal(next: DiaProp[]) { setDias(next); persistir(next); }

  function toggleCerrado(fecha: string) {
    const d = dias.find((x) => x.fecha === fecha);
    if (!d) return;
    const cerrando = !d.cerrado;
    if (cerrando && d.jornadas.length > 0) {
      if (!confirm(`Cerrar el ${fecha} quitará sus ${d.jornadas.length} jornada(s) de la propuesta. ¿Continuar?`)) return;
    }
    guardarLocal(dias.map((x) => (x.fecha === fecha ? { ...x, cerrado: cerrando, jornadas: cerrando ? [] : x.jornadas } : x)));
  }
  function setJornada(fecha: string, idx: number, patch: Partial<JornadaProp>) {
    setDia(fecha, { jornadas: dias.find((d) => d.fecha === fecha)!.jornadas.map((j, i) => (i === idx ? { ...j, ...patch } : j)) });
  }
  function addJornada(fecha: string) {
    guardarLocal(dias.map((x) => (x.fecha === fecha ? { ...x, jornadas: [...x.jornadas, { alias_texto: "", empleado_id: empleados[0]?.id ?? null, hora_inicio: x.apertura, hora_fin: x.cierre }] } : x)));
  }
  function removeJornada(fecha: string, idx: number) {
    guardarLocal(dias.map((x) => (x.fecha === fecha ? { ...x, jornadas: x.jornadas.filter((_, i) => i !== idx) } : x)));
  }
  function moverJornada(fecha: string, idx: number, destino: string) {
    if (destino === fecha) return;
    if (!diasDelMes.includes(destino)) { setMsg({ tipo: "error", texto: "La fecha destino debe pertenecer al mes." }); return; }
    const origen = dias.find((x) => x.fecha === fecha)!;
    const j = origen.jornadas[idx];
    let next = dias.map((x) => (x.fecha === fecha ? { ...x, jornadas: x.jornadas.filter((_, i) => i !== idx) } : x));
    const destDia = next.find((x) => x.fecha === destino);
    if (destDia) {
      if (destDia.cerrado) { setMsg({ tipo: "error", texto: "No se puede mover a un día cerrado." }); return; }
      next = next.map((x) => (x.fecha === destino ? { ...x, jornadas: [...x.jornadas, j] } : x));
    } else {
      next = [...next, { fecha: destino, cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [j] }].sort((a, b) => a.fecha.localeCompare(b.fecha));
    }
    guardarLocal(next);
  }
  const [nuevoDia, setNuevoDia] = useState("");
  function agregarDia() {
    if (!nuevoDia || dias.some((d) => d.fecha === nuevoDia)) { setNuevoDia(""); return; }
    guardarLocal([...dias, { fecha: nuevoDia, cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [] }].sort((a, b) => a.fecha.localeCompare(b.fecha)));
    setNuevoDia("");
  }
  function decidirConflicto(fecha: string, decision: "pdf" | "actual") {
    persistir(dias, { decisiones: { [fecha]: decision } });
  }

  async function aplicar() {
    if (!imp) return;
    if (!confirm("Se guardará la propuesta corregida como BORRADOR del mes (no se confirma). ¿Continuar?")) return;
    setGuardando(true);
    setMsg(null);
    try {
      // Asegura que se apliquen EXACTAMENTE los datos corregidos.
      const put = await fetch(`/api/admin/cronograma/importar/${imp.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dias }) });
      const pj = await put.json().catch(() => ({}));
      if (!put.ok) { setMsg({ tipo: "error", texto: pj.error || "No se pudieron guardar los cambios." }); return; }
      setImp(pj.importacion as Importacion);
      const res = await fetch(`/api/admin/cronograma/importar/${imp.id}/aplicar`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tipo: "error", texto: j.error || "No se pudo aplicar la importación." }); return; }
      onAplicada();
      onCerrar();
    } catch {
      setMsg({ tipo: "error", texto: "No se pudo aplicar la importación (conexión)." });
    } finally {
      setGuardando(false);
    }
  }

  async function descartar() {
    if (!imp) { onCerrar(); return; }
    if (!confirm("¿Descartar esta importación? Deja de bloquear la confirmación. Su auditoría se conserva.")) return;
    await fetch(`/api/admin/cronograma/importar/${imp.id}/descartar`, { method: "POST" }).catch(() => {});
    onCerrar();
  }

  const puedeAplicar = !!imp && !rechazada && !mesConfirmado && bloqueantes.length === 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/75 p-4" onClick={onCerrar}>
      <div className="mt-6 w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase text-red-500">Importar PDF / Canva</h3>
          <button onClick={onCerrar} className="text-2xl leading-none text-white/50 hover:text-white" aria-label="Cerrar">×</button>
        </div>

        {/* Mensajes (visibles SIEMPRE, en cualquier estado) */}
        {msg && (
          <p className={`mb-3 rounded-xl border px-3 py-2 text-sm ${msg.tipo === "error" ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-green-500/40 bg-green-500/10 text-green-200"}`}>
            {msg.texto}
          </p>
        )}

        {!imp && (
          <div className="space-y-3">
            <p className="text-sm text-white/60">
              Subí el PDF del cronograma exportado de Canva (una página, título con mes y año). El servidor lo analiza y podés revisar y corregir antes de guardar.
            </p>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={analizando}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMsg(null); }}
              className="block w-full text-sm text-white/70 file:mr-3 file:rounded-xl file:border-0 file:bg-red-600 file:px-4 file:py-2 file:text-xs file:font-black file:uppercase file:text-white hover:file:bg-red-700 disabled:opacity-50"
            />
            {analizando && <p className="text-sm font-bold text-amber-300">Analizando PDF…</p>}
            <button
              onClick={analizar}
              disabled={!file || analizando}
              title={!file ? "Seleccioná un PDF" : ""}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30"
            >
              {analizando ? "Analizando PDF…" : !file ? "Seleccioná un PDF" : "Analizar"}
            </button>
          </div>
        )}

        {imp && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-black p-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span><b className="text-white/50">Archivo:</b> {imp.archivo_nombre}</span>
                {!rechazada && <span><b className="text-white/50">Detectado:</b> {MESES[imp.mes - 1]} {imp.anio}</span>}
                {!rechazada && <span><b className="text-white/50">Jornadas:</b> {totalJornadas}</span>}
                {!rechazada && <span><b className="text-white/50">Días:</b> {dias.length}</span>}
                {guardando && <span className="text-amber-300">Guardando…</span>}
              </div>
            </div>

            {rechazada && (
              <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                {incidencias[0]?.detalle || "El PDF no pudo interpretarse."}
              </div>
            )}

            {mesConfirmado && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                El mes ya está <b>confirmado</b>. No se admite una importación masiva que lo sobrescriba; reabrí el mes o corregí por día desde el calendario.
              </div>
            )}

            {bloqueantes.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-black uppercase text-red-400">Errores bloqueantes ({bloqueantes.length})</p>
                {bloqueantes.map((i, k) => (<p key={k} className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">{i.detalle}</p>))}
              </div>
            )}

            {/* Conflictos con borrador existente */}
            {prop && prop.conflictos.filter((c) => c.clase === "diferente").length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-black uppercase text-white/50">Conflictos con el borrador actual</p>
                {prop.conflictos.filter((c) => c.clase === "diferente").map((c) => (
                  <div key={c.fecha} className="rounded-xl border border-white/10 bg-black p-2 text-xs">
                    <p className="mb-1 font-black text-white/80">{c.fecha}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <ResumenDia titulo="Borrador actual" dia={c.actual} activo={c.decision === "actual"} onClick={() => decidirConflicto(c.fecha, "actual")} />
                      <ResumenDia titulo="Versión del PDF" dia={c.pdf} activo={c.decision === "pdf"} onClick={() => decidirConflicto(c.fecha, "pdf")} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Vista previa EDITABLE */}
            {!rechazada && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black uppercase text-white/50">Vista previa editable (no oficial hasta guardar y confirmar)</p>
                  <div className="flex items-center gap-1">
                    <select value={nuevoDia} onChange={(e) => setNuevoDia(e.target.value)} className="rounded-lg border border-white/15 bg-black px-2 py-1 text-xs outline-none focus:border-red-500">
                      <option value="">Agregar día…</option>
                      {diasDelMes.filter((f) => !dias.some((d) => d.fecha === f)).map((f) => (<option key={f} value={f}>{f.slice(8)}</option>))}
                    </select>
                    <button onClick={agregarDia} disabled={!nuevoDia} className="rounded-lg border border-white/15 px-2 py-1 text-xs font-black hover:bg-white/10 disabled:opacity-40">+</button>
                  </div>
                </div>

                <div className="max-h-[340px] space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black p-2">
                  {dias.length === 0 && <p className="text-xs text-white/40">Sin días propuestos.</p>}
                  {dias.map((d) => (
                    <div key={d.fecha} className="rounded-lg border border-white/10 p-2">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-black text-white/80">{d.fecha}</span>
                        <label className="flex items-center gap-1 text-[11px] text-white/60">
                          <input type="checkbox" checked={d.cerrado} onChange={() => toggleCerrado(d.fecha)} className="h-3 w-3 accent-red-600" /> Cerrado
                        </label>
                        {!d.cerrado && (
                          <span className="flex items-center gap-1 text-[11px] text-white/40">
                            <input type="time" value={d.apertura} onChange={(e) => setDia(d.fecha, { apertura: e.target.value })} onBlur={() => persistir(dias)} className="rounded border border-white/15 bg-black px-1 py-0.5 text-[11px]" />
                            –
                            <input type="time" value={d.cierre} onChange={(e) => setDia(d.fecha, { cierre: e.target.value })} onBlur={() => persistir(dias)} className="rounded border border-white/15 bg-black px-1 py-0.5 text-[11px]" />
                          </span>
                        )}
                        {!d.cerrado && <button onClick={() => addJornada(d.fecha)} className="ml-auto rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-black uppercase hover:bg-white/10">+ jornada</button>}
                      </div>
                      {!d.cerrado && d.jornadas.map((j, i) => (
                        <div key={i} className="mb-1 flex flex-wrap items-center gap-1">
                          <select
                            value={j.empleado_id ?? ""}
                            onChange={(e) => { setJornada(d.fecha, i, { empleado_id: e.target.value || null }); }}
                            onBlur={() => persistir(dias)}
                            className={`rounded border bg-black px-1.5 py-0.5 text-[11px] font-bold outline-none ${j.empleado_id ? "border-white/15" : "border-amber-500/60"}`}
                          >
                            <option value="">{j.alias_texto ? `${j.alias_texto} → elegir…` : "Elegir integrante…"}</option>
                            {empleados.map((e) => (<option key={e.id} value={e.id}>{e.nombre_formal}</option>))}
                          </select>
                          <input type="time" value={j.hora_inicio} onChange={(e) => setJornada(d.fecha, i, { hora_inicio: e.target.value })} onBlur={() => persistir(dias)} className="rounded border border-white/15 bg-black px-1 py-0.5 text-[11px]" />
                          <input type="time" value={j.hora_fin} onChange={(e) => setJornada(d.fecha, i, { hora_fin: e.target.value })} onBlur={() => persistir(dias)} className="rounded border border-white/15 bg-black px-1 py-0.5 text-[11px]" />
                          <select value={d.fecha} onChange={(e) => moverJornada(d.fecha, i, e.target.value)} title="Mover a otro día" className="rounded border border-white/15 bg-black px-1 py-0.5 text-[11px]">
                            {diasDelMes.map((f) => (<option key={f} value={f}>{f === d.fecha ? "↔ día" : `→ ${f.slice(8)}`}</option>))}
                          </select>
                          <button onClick={() => removeJornada(d.fecha, i)} className="rounded border border-red-500/40 px-1.5 py-0.5 text-[11px] font-black text-red-400 hover:bg-red-600 hover:text-white" aria-label="Quitar">✕</button>
                        </div>
                      ))}
                      {!d.cerrado && d.jornadas.length === 0 && <p className="text-[11px] text-white/30">Abierto, sin jornadas (lo cubrirá Ramiro al confirmar).</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {advertencias.length > 0 && (
              <details className="text-xs text-amber-200/80">
                <summary className="cursor-pointer font-black uppercase text-amber-300">Advertencias ({advertencias.length})</summary>
                {advertencias.map((i, k) => (<p key={k} className="mt-1">{i.detalle}</p>))}
              </details>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button onClick={descartar} className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-400 hover:bg-red-600 hover:text-white">
                Descartar importación
              </button>
              <button
                onClick={aplicar}
                disabled={!puedeAplicar || guardando}
                title={!puedeAplicar ? "Resolvé las incidencias bloqueantes o conflictos antes de guardar" : ""}
                className="rounded-xl bg-green-600 px-4 py-2 text-xs font-black uppercase hover:bg-green-700 disabled:bg-white/10 disabled:text-white/30"
              >
                {guardando ? "Guardando…" : "Guardar como borrador"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResumenDia({ titulo, dia, activo, onClick }: { titulo: string; dia: DiaProp | null; activo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-lg border p-2 text-left transition ${activo ? "border-green-500 bg-green-600/15" : "border-white/15 hover:border-white/30"}`}>
      <p className="mb-1 text-[10px] font-black uppercase text-white/50">{titulo} {activo && "✓"}</p>
      {!dia ? (<p className="text-white/30">—</p>) : dia.cerrado ? (<p className="text-zinc-300">Cerrado</p>) : dia.jornadas.length === 0 ? (<p className="text-white/40">Abierto, sin jornadas</p>) : (
        dia.jornadas.map((j, k) => (<p key={k} className="text-white/70">{j.alias_texto || "—"} {j.hora_inicio}–{j.hora_fin}</p>))
      )}
    </button>
  );
}

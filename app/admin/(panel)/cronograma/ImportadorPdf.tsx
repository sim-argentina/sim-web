"use client";

import { useCallback, useMemo, useState } from "react";

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
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const incidencias = imp?.incidencias ?? [];
  const bloqueantes = incidencias.filter((i) => i.severidad === "bloqueante");
  const advertencias = incidencias.filter((i) => i.severidad === "advertencia");
  const prop = imp?.propuesta ?? null;

  const totalJornadas = useMemo(
    () => (prop?.dias ?? []).reduce((n, d) => n + (d.cerrado ? 0 : d.jornadas.length), 0),
    [prop],
  );

  async function analizar() {
    if (!file) { setMsg("Elegí un archivo PDF."); return; }
    setAnalizando(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/cronograma/importar/analizar", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "No se pudo analizar el PDF."); return; }
      setImp(j.importacion as Importacion);
    } catch {
      setMsg("No se pudo analizar el PDF.");
    } finally {
      setAnalizando(false);
    }
  }

  const guardar = useCallback(async (entrada: { aliases?: Record<string, string | null>; dias?: DiaProp[]; decisiones?: Record<string, "pdf" | "actual" | null> }) => {
    if (!imp) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/cronograma/importar/${imp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entrada),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "No se pudieron guardar los cambios."); return; }
      setImp(j.importacion as Importacion);
    } catch {
      setMsg("No se pudieron guardar los cambios.");
    } finally {
      setGuardando(false);
    }
  }, [imp]);

  async function aplicar() {
    if (!imp) return;
    if (!confirm("Se va a guardar la propuesta como BORRADOR del mes (no se confirma). ¿Continuar?")) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/cronograma/importar/${imp.id}/aplicar`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "No se pudo aplicar la importación."); return; }
      onAplicada();
      onCerrar();
    } catch {
      setMsg("No se pudo aplicar la importación.");
    } finally {
      setGuardando(false);
    }
  }

  async function descartar() {
    if (!imp) { onCerrar(); return; }
    if (!confirm("¿Descartar esta importación? Deja de bloquear la confirmación. Su auditoría se conserva.")) return;
    await fetch(`/api/admin/cronograma/importar/${imp.id}/descartar`, { method: "POST" });
    onCerrar();
  }

  function resolverAlias(alias: string, empId: string) {
    guardar({ aliases: { [alias]: empId || null } });
  }
  function decidirConflicto(fecha: string, decision: "pdf" | "actual") {
    guardar({ decisiones: { [fecha]: decision } });
  }

  const mesConfirmado = prop?.mes_estado_actual === "confirmado";
  const rechazada = imp?.estado === "rechazada";
  const puedeAplicar = !!imp && !rechazada && !mesConfirmado && bloqueantes.length === 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/75 p-4" onClick={onCerrar}>
      <div className="mt-6 w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase text-red-500">Importar PDF / Canva</h3>
          <button onClick={onCerrar} className="text-2xl leading-none text-white/50 hover:text-white" aria-label="Cerrar">×</button>
        </div>

        {!imp && (
          <div className="space-y-3">
            <p className="text-sm text-white/60">
              Subí el PDF del cronograma exportado de Canva (una página, título con mes y año). El servidor lo analiza y podés revisar antes de guardar.
            </p>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-white/70 file:mr-3 file:rounded-xl file:border-0 file:bg-red-600 file:px-4 file:py-2 file:text-xs file:font-black file:uppercase file:text-white hover:file:bg-red-700"
            />
            <button onClick={analizar} disabled={!file || analizando} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
              {analizando ? "Analizando…" : "Analizar"}
            </button>
          </div>
        )}

        {imp && (
          <div className="space-y-4">
            {/* Resumen */}
            <div className="rounded-2xl border border-white/10 bg-black p-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span><b className="text-white/50">Archivo:</b> {imp.archivo_nombre}</span>
                {!rechazada && <span><b className="text-white/50">Detectado:</b> {MESES[imp.mes - 1]} {imp.anio}</span>}
                {!rechazada && <span><b className="text-white/50">Jornadas:</b> {totalJornadas}</span>}
                {!rechazada && <span><b className="text-white/50">Días:</b> {prop?.dias.length ?? 0}</span>}
              </div>
              {!rechazada && prop && (
                <p className="mt-1 text-xs text-white/50">Alias reconocidos: {Object.keys(prop.aliases).join(", ") || "—"}</p>
              )}
            </div>

            {rechazada && (
              <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                {incidencias[0]?.detalle || "El PDF no pudo interpretarse."}
              </div>
            )}

            {mesConfirmado && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                El mes ya está <b>confirmado</b>. No se admite una importación masiva que lo sobrescriba; las correcciones se hacen por día desde el calendario.
              </div>
            )}

            {/* Incidencias bloqueantes */}
            {bloqueantes.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-black uppercase text-red-400">Errores bloqueantes ({bloqueantes.length})</p>
                {bloqueantes.map((i, k) => (
                  <p key={k} className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">{i.detalle}</p>
                ))}
              </div>
            )}

            {/* Resolución de alias desconocidos / inactivos */}
            {prop && Object.entries(prop.aliases).filter(([, r]) => !r.empleado_id || !r.activo).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-black uppercase text-white/50">Resolver alias</p>
                {Object.entries(prop.aliases).filter(([, r]) => !r.empleado_id || !r.activo).map(([alias, r]) => (
                  <div key={alias} className="flex items-center gap-2 text-sm">
                    <span className="min-w-[90px] font-bold text-amber-300">{alias}</span>
                    <span className="text-white/40">→</span>
                    <select
                      defaultValue={r.empleado_id ?? ""}
                      onChange={(e) => resolverAlias(alias, e.target.value)}
                      className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs font-bold outline-none focus:border-red-500"
                    >
                      <option value="">Elegir integrante…</option>
                      {empleados.map((e) => (<option key={e.id} value={e.id}>{e.nombre_formal}</option>))}
                    </select>
                  </div>
                ))}
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

            {/* Vista previa de días propuestos */}
            {prop && !rechazada && (
              <div className="space-y-1">
                <p className="text-xs font-black uppercase text-white/50">Vista previa (no oficial hasta guardar y confirmar)</p>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black p-2">
                  {prop.dias.map((d) => (
                    <div key={d.fecha} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-[92px] font-bold text-white/70">{d.fecha}</span>
                      {d.cerrado ? (
                        <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-black uppercase text-zinc-300">Cerrado</span>
                      ) : d.jornadas.length === 0 ? (
                        <span className="text-white/30">sin jornadas</span>
                      ) : (
                        d.jornadas.map((j, k) => (
                          <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] ${j.empleado_id ? "bg-red-600/20 text-red-200" : "bg-amber-500/20 text-amber-200"}`}>
                            {(prop.aliases[j.alias_texto]?.nombre ?? j.alias_texto)} {j.hora_inicio}–{j.hora_fin}
                          </span>
                        ))
                      )}
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

            {msg && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">{msg}</p>}

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
      {!dia ? (
        <p className="text-white/30">—</p>
      ) : dia.cerrado ? (
        <p className="text-zinc-300">Cerrado</p>
      ) : dia.jornadas.length === 0 ? (
        <p className="text-white/40">Abierto, sin jornadas</p>
      ) : (
        dia.jornadas.map((j, k) => (<p key={k} className="text-white/70">{j.alias_texto} {j.hora_inicio}–{j.hora_fin}</p>))
      )}
    </button>
  );
}

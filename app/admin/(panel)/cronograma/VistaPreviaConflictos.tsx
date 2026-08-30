"use client";

import { useMemo, useState } from "react";

type JorPrev = { empleado_id: string; nombre: string; hora_inicio: string; hora_fin: string; activo: boolean };
type DiaPrev = { cerrado: boolean; apertura: string; cierre: string; jornadas: JorPrev[] };
export type Fila = { destino: string; origen: string | null; clase: string; actual: DiaPrev | null; propuesta: DiaPrev | null; decision: "actual" | "propuesta" | null };
export type Incidencia = { tipo: string; severidad: "bloqueante" | "advertencia"; detalle: string; fecha?: string };
export type Preview = {
  clase_op: string;
  origen_no_oficial: boolean;
  meses_destino: Array<{ anio: number; mes: number; estado: string }>;
  bloqueado: { anio: number; mes: number } | null;
  incidencias: Incidencia[];
  filas: Fila[];
  solo_origen: string[];
};
type Empleado = { id: string; nombre_formal: string };

const CLASE_LABEL: Record<string, string> = {
  sin_cambios: "Sin cambios",
  solo_propuesta: "Solo propuesta",
  solo_destino: "Solo destino",
  diferente: "Diferente",
  sin_equivalente: "Sin equivalente",
  sin_datos_origen: "Sin datos en origen",
};
const CLASE_CHIP: Record<string, string> = {
  sin_cambios: "bg-zinc-700 text-zinc-300",
  solo_propuesta: "bg-blue-600/30 text-blue-200",
  solo_destino: "bg-zinc-700 text-zinc-300",
  diferente: "bg-amber-500/25 text-amber-200",
  sin_equivalente: "bg-zinc-800 text-zinc-400",
  sin_datos_origen: "bg-zinc-800 text-zinc-400",
};

function resumenDia(d: DiaPrev | null): string {
  if (!d) return "—";
  if (d.cerrado) return "Cerrado";
  if (d.jornadas.length === 0) return `Abierto ${d.apertura}–${d.cierre}, sin jornadas`;
  return d.jornadas.map((j) => `${j.nombre} ${j.hora_inicio}–${j.hora_fin}`).join(" · ");
}

export default function VistaPreviaConflictos({
  preview,
  empleados,
  aplicando,
  onAplicar,
}: {
  preview: Preview;
  empleados: Empleado[];
  aplicando: boolean;
  onAplicar: (decisiones: Record<string, "actual" | "propuesta">, reemplazos: Record<string, string>) => void;
}) {
  const [decisiones, setDecisiones] = useState<Record<string, "actual" | "propuesta">>({});
  const [reemplazos, setReemplazos] = useState<Record<string, string>>({});

  // Integrantes archivados presentes en la propuesta (requieren reemplazo activo).
  const archivados = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of preview.filas) if (f.propuesta && !f.propuesta.cerrado) for (const j of f.propuesta.jornadas) if (!j.activo) m.set(j.empleado_id, j.nombre);
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre }));
  }, [preview]);

  const diferentes = preview.filas.filter((f) => f.clase === "diferente");
  const cambios = preview.filas.filter((f) => f.clase === "solo_propuesta" || f.clase === "diferente");

  const bloqueantes = preview.incidencias.filter((i) => i.severidad === "bloqueante" && i.tipo !== "integrante_archivado");
  const puedeAplicar =
    !preview.bloqueado &&
    bloqueantes.length === 0 &&
    archivados.every((a) => reemplazos[a.id]) &&
    diferentes.every((f) => decisiones[f.destino]);

  return (
    <div className="space-y-3">
      {/* Meses destino */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-white/50">Destino:</span>
        {preview.meses_destino.map((m) => (
          <span key={`${m.anio}-${m.mes}`} className={`rounded px-2 py-0.5 font-bold ${m.estado === "confirmado" ? "bg-green-600/30 text-green-200" : m.estado === "borrador" ? "bg-amber-500/20 text-amber-200" : "bg-zinc-700 text-zinc-300"}`}>
            {m.mes}/{m.anio} · {m.estado === "inexistente" ? "sin cronograma" : m.estado}
          </span>
        ))}
      </div>

      {preview.origen_no_oficial && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">Origen no oficial (borrador).</p>
      )}
      {preview.bloqueado && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
          El mes {preview.bloqueado.mes}/{preview.bloqueado.anio} está confirmado. Reabrilo como borrador antes de aplicar.
        </p>
      )}
      {bloqueantes.map((i, k) => (
        <p key={k} className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">{i.detalle}</p>
      ))}
      {preview.solo_origen.length > 0 && (
        <p className="text-xs text-white/40">{preview.solo_origen.length} aparición(es) del origen sin equivalente en destino: se ignoran.</p>
      )}

      {/* Reemplazo de archivados */}
      {archivados.length > 0 && (
        <div className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2">
          <p className="text-xs font-black uppercase text-amber-300">Reemplazar integrantes archivados</p>
          {archivados.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-[100px] text-amber-200">{a.nombre}</span>
              <span className="text-white/40">→</span>
              <select value={reemplazos[a.id] ?? ""} onChange={(e) => setReemplazos((p) => ({ ...p, [a.id]: e.target.value }))} className="rounded border border-white/15 bg-black px-2 py-1 text-xs font-bold outline-none focus:border-red-500">
                <option value="">Elegir activo…</option>
                {empleados.map((e) => (<option key={e.id} value={e.id}>{e.nombre_formal}</option>))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Conflictos "diferente" */}
      {diferentes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black uppercase text-white/50">Conflictos ({diferentes.length})</p>
          {diferentes.map((f) => (
            <div key={f.destino} className="rounded-xl border border-white/10 bg-black p-2 text-xs">
              <p className="mb-1 font-black text-white/80">{f.destino}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setDecisiones((p) => ({ ...p, [f.destino]: "actual" }))} className={`rounded-lg border p-2 text-left ${decisiones[f.destino] === "actual" ? "border-green-500 bg-green-600/15" : "border-white/15 hover:border-white/30"}`}>
                  <p className="mb-0.5 text-[10px] font-black uppercase text-white/50">Mantener actual {decisiones[f.destino] === "actual" && "✓"}</p>
                  <p className="text-white/70">{resumenDia(f.actual)}</p>
                </button>
                <button type="button" onClick={() => setDecisiones((p) => ({ ...p, [f.destino]: "propuesta" }))} className={`rounded-lg border p-2 text-left ${decisiones[f.destino] === "propuesta" ? "border-green-500 bg-green-600/15" : "border-white/15 hover:border-white/30"}`}>
                  <p className="mb-0.5 text-[10px] font-black uppercase text-white/50">Usar propuesta {decisiones[f.destino] === "propuesta" && "✓"}</p>
                  <p className="text-white/70">{resumenDia(f.propuesta)}</p>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabla de días */}
      <details className="text-xs">
        <summary className="cursor-pointer font-black uppercase text-white/50">Ver todos los días ({preview.filas.length})</summary>
        <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 bg-black p-2">
          {preview.filas.map((f) => (
            <div key={f.destino} className="flex flex-wrap items-center gap-2">
              <span className="min-w-[90px] font-bold text-white/70">{f.destino}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${CLASE_CHIP[f.clase] ?? "bg-zinc-700"}`}>{CLASE_LABEL[f.clase] ?? f.clase}</span>
              <span className="truncate text-white/40">{f.clase === "solo_destino" || f.clase === "sin_equivalente" ? resumenDia(f.actual) : resumenDia(f.propuesta)}</span>
            </div>
          ))}
        </div>
      </details>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-white/40">{cambios.length} día(s) cambiarían.</span>
        <button
          onClick={() => onAplicar(decisiones, reemplazos)}
          disabled={!puedeAplicar || aplicando}
          title={!puedeAplicar ? "Resolvé conflictos, reemplazos e incidencias" : ""}
          className="rounded-xl bg-green-600 px-4 py-2 text-xs font-black uppercase hover:bg-green-700 disabled:bg-white/10 disabled:text-white/30"
        >
          {aplicando ? "Aplicando…" : "Aplicar como borrador"}
        </button>
      </div>
    </div>
  );
}

"use client";

// Gráficos del análisis de Interacciones (Bloque 5): SVG y barras propias con
// el mismo lenguaje visual que Métricas (rounded-2xl, white/10, rojo). Todos
// muestran números reales con su denominador y tienen una lectura en texto.

import { useId, useState, type ReactNode } from "react";
import type { Tasa } from "@/lib/interaccionesMetricas";

const NUM = new Intl.NumberFormat("es-AR");
const PCT = new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PP = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const VAR = new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });

export const fmtN = (n: number) => NUM.format(n);
export const fmtPct = (t: Tasa) => (t.valor === null ? "Sin datos" : PCT.format(t.valor));
export const fmtBase = (t: Tasa) => `${fmtN(t.num)} de ${fmtN(t.den)}`;
export const fmtPp = (pp: number | null) => (pp === null ? "Sin datos" : `${PP.format(pp)} pp`);
export const fmtVar = (v: number | null) => (v === null ? "Sin base" : VAR.format(v));

export const COLORES = { miraron: "#a1a1aa", preguntaron: "#fca5a5", subieron: "#ef4444" } as const;

export function Seccion({ titulo, descripcion, children, accion }: { titulo: string; descripcion?: ReactNode; children: ReactNode; accion?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={id} className="text-lg font-semibold text-white">{titulo}</h2>
          {descripcion ? <p className="mt-1 text-xs text-white/55">{descripcion}</p> : null}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

export function Tarjeta({ titulo, valor, detalle, delta, tono }: { titulo: string; valor: string; detalle?: ReactNode; delta?: ReactNode; tono?: "rojo" }) {
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${tono === "rojo" ? "border-red-500/40 bg-red-950/20" : "border-white/10 bg-white/[0.04]"}`}>
      <p className="text-xs uppercase tracking-[0.15em] text-white/50">{titulo}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-white">{valor}</p>
      {detalle ? <p className="mt-1 text-xs text-white/55">{detalle}</p> : null}
      {delta ? <p className="mt-2 text-xs text-white/70">{delta}</p> : null}
    </div>
  );
}

/** Barras horizontales: largo relativo al máximo; texto con n y % sobre su base. */
export function Barras({ filas, vacio = "Sin datos para este período." }: {
  filas: Array<{ etiqueta: string; n: number; detalle?: string; color?: string }>;
  vacio?: string;
}) {
  const max = Math.max(...filas.map((f) => f.n), 0);
  if (filas.length === 0 || max === 0) return <p className="text-sm text-white/55">{vacio}</p>;
  return (
    <ul className="space-y-3">
      {filas.map((f) => (
        <li key={f.etiqueta}>
          <div className="mb-1 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-sm">
            <span className="text-white/80">{f.etiqueta}</span>
            <span className="tabular-nums text-white">{fmtN(f.n)}{f.detalle ? <span className="ml-1 text-white/55"> · {f.detalle}</span> : null}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${(f.n / max) * 100}%`, backgroundColor: f.color ?? "#ef4444" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tasa como barra 0–100 % con su base; sin denominador → "Sin datos" (sin barra).
 * noAplica: la base de la vista no permite esa tasa (p. ej. filtrar por un dato que
 * "Solo miró" no releva): se dice "No aplica" en vez de mostrar un 100 % engañoso.
 */
export function BarraTasa({ etiqueta, tasa, color, noAplica }: { etiqueta: string; tasa: Tasa; color: string; noAplica?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className="text-white/70">{etiqueta}</span>
        {noAplica
          ? <span className="text-white/50">No aplica con este filtro</span>
          : <span className="tabular-nums text-white">{fmtPct(tasa)}{tasa.valor !== null ? <span className="ml-1 text-white/50">({fmtBase(tasa)})</span> : null}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
        {tasa.valor !== null && !noAplica ? <div className="h-full rounded-full" style={{ width: `${tasa.valor * 100}%`, backgroundColor: color }} /> : null}
      </div>
    </div>
  );
}

/** Dona de la distribución EXCLUSIVA (suma 100 %). */
export function Dona({ partes, centro, subtitulo }: { partes: Array<{ etiqueta: string; n: number; color: string }>; centro: string; subtitulo: string }) {
  const total = partes.reduce((a, p) => a + p.n, 0);
  if (total === 0) return <p className="text-sm text-white/55">Sin interacciones en este período.</p>;
  const r = 70;
  const C = 2 * Math.PI * r;
  // Desplazamiento de cada arco, calculado antes de dibujar.
  const desde = partes.map((_, i) => partes.slice(0, i).reduce((a, p) => a + (p.n / total) * C, 0));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg viewBox="0 0 200 200" className="h-44 w-44 shrink-0" role="img" aria-label={`Distribución: ${partes.map((p) => `${p.etiqueta} ${p.n}`).join(", ")}`}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="28" />
        {partes.map((p, i) => {
          const largo = (p.n / total) * C;
          return (
            <circle key={p.etiqueta} cx="100" cy="100" r={r} fill="none" stroke={p.color} strokeWidth="28"
              strokeDasharray={`${largo} ${C - largo}`} strokeDashoffset={-desde[i]} transform="rotate(-90 100 100)" />
          );
        })}
        <text x="100" y="98" textAnchor="middle" className="fill-white" fontSize="26" fontWeight="700">{centro}</text>
        <text x="100" y="120" textAnchor="middle" className="fill-white/60" fontSize="11">{subtitulo}</text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {partes.map((p) => (
          <li key={p.etiqueta} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-white/80"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />{p.etiqueta}</span>
            <span className="tabular-nums text-white">{fmtN(p.n)} <span className="text-white/55">({PCT.format(p.n / total)})</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Línea diaria con varias series + tabla equivalente (accesible y verificable). */
export function LineaDiaria({ puntos, series }: {
  puntos: Array<{ fecha: string } & Record<string, number | string>>;
  series: Array<{ clave: string; etiqueta: string; color: string }>;
}) {
  const [tabla, setTabla] = useState(false);
  if (puntos.length === 0) return <p className="text-sm text-white/55">Sin días con registro en este período.</p>;
  const W = 760;
  const H = 240;
  const pl = 40;
  const pr = 12;
  const pt = 12;
  const pb = 34;
  const max = Math.max(1, ...puntos.flatMap((p) => series.map((s) => Number(p[s.clave]))));
  const x = (i: number) => (puntos.length === 1 ? pl + (W - pl - pr) / 2 : pl + (i * (W - pl - pr)) / (puntos.length - 1));
  const y = (v: number) => pt + (H - pt - pb) - (v / max) * (H - pt - pb);
  const cada = Math.max(1, Math.ceil(puntos.length / 10));
  const fecha = (f: string) => f.slice(8, 10) + "/" + f.slice(5, 7);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-3 text-xs">
          {series.map((s) => (
            <li key={s.clave} className="flex items-center gap-1.5 text-white/75"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />{s.etiqueta}</li>
          ))}
        </ul>
        <button type="button" onClick={() => setTabla((t) => !t)} aria-expanded={tabla}
          className="min-h-11 rounded-lg px-3 text-xs font-semibold text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
          {tabla ? "Ver gráfico" : "Ver tabla"}
        </button>
      </div>
      {tabla ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-950 text-left text-xs text-white/55">
              <tr><th className="py-1 pr-3 font-medium">Fecha</th>{series.map((s) => <th key={s.clave} className="py-1 pr-3 text-right font-medium">{s.etiqueta}</th>)}</tr>
            </thead>
            <tbody>
              {puntos.map((p) => (
                <tr key={p.fecha} className="border-t border-white/5">
                  <td className="py-1 pr-3 text-white/75">{fecha(p.fecha)}</td>
                  {series.map((s) => <td key={s.clave} className="py-1 pr-3 text-right tabular-nums text-white">{fmtN(Number(p[s.clave]))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-60 w-full" role="img" aria-label="Evolución diaria; la misma información está en la tabla.">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={pl} x2={W - pr} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,0.08)" />
              <text x={pl - 6} y={y(max * f) + 4} textAnchor="end" fontSize="11" className="fill-white/50">{fmtN(Math.round(max * f))}</text>
            </g>
          ))}
          {series.map((s) => (
            <g key={s.clave}>
              <polyline fill="none" stroke={s.color} strokeWidth="2.5" points={puntos.map((p, i) => `${x(i)},${y(Number(p[s.clave]))}`).join(" ")} />
              {puntos.length <= 31 ? puntos.map((p, i) => <circle key={p.fecha} cx={x(i)} cy={y(Number(p[s.clave]))} r="3" fill={s.color} />) : null}
            </g>
          ))}
          {puntos.map((p, i) => (i % cada === 0 || i === puntos.length - 1 ? (
            <text key={p.fecha} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" className="fill-white/55">{fecha(p.fecha)}</text>
          ) : null))}
        </svg>
      )}
    </div>
  );
}

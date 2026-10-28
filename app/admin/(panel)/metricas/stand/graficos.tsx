"use client";

// Gráficos del dashboard del Stand: SVG/HTML propios (sin librería), livianos y
// accesibles. Cada marca es un control: con mouse, toque o teclado muestra su
// tooltip (valor + contexto) y al activarla abre el menú de acciones (filtrar o
// ver las operaciones). Marcas finas, grilla en hairline, un solo eje.

import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cx, FOCO, propsTooltip, useTooltip } from "./piezas";

// Paleta (superficie oscura #0e0e0e). Rampa ordinal roja validada con el
// validador de dataviz (--ordinal --mode dark): una sola tonalidad, luminosidad
// monótona y el extremo oscuro a 2,5:1 de la superficie.
export const ROJO = "#d93030";
export const RAMPA_DURACION: Record<string, string> = { "10": "#a61b1b", "15": "#d93030", "20": "#f2645c", "30": "#fbb0aa", otra: "#7d7d78", sin_dato: "#4a4a47" };
const GRIS_COMPARACION = "#9a9a94";
const GRILLA = "#262624";
const TEXTO_EJE = "#8a8a85";

// ── Evolución (barras del período + línea del período de comparación) ───────

export type PuntoEvolucion = {
  clave: string;
  etiqueta: string;
  etiquetaLarga: string;
  valor: number;
  incompleto?: boolean;
};

export function GraficoEvolucion({
  puntos,
  comparacion,
  formatear,
  formatearEje,
  nombreMetrica,
  onElegir,
  tooltipExtra,
}: {
  puntos: PuntoEvolucion[];
  comparacion: Array<{ etiquetaLarga: string; valor: number }> | null;
  formatear: (n: number) => string;
  formatearEje: (n: number) => string;
  nombreMetrica: string;
  onElegir: (i: number, el: HTMLElement) => void;
  tooltipExtra?: (i: number) => ReactNode;
}) {
  const tip = useTooltip();
  const [foco, setFoco] = useState(0);
  const refs = useRef<Array<SVGRectElement | null>>([]);
  const W = 920;
  const H = 260;
  const padL = 56;
  const padR = 12;
  const padT = 14;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = Math.max(puntos.length, 1);

  const { max, ticks } = useMemo(() => {
    const valores = [...puntos.map((p) => p.valor), ...(comparacion ?? []).slice(0, puntos.length).map((c) => c.valor)];
    const bruto = Math.max(...valores, 0);
    const paso = pasoLindo(bruto / 4 || 1);
    const max = Math.max(paso * 4, paso);
    return { max, ticks: [0, 1, 2, 3, 4].map((i) => i * paso) };
  }, [puntos, comparacion]);

  const ancho = innerW / n;
  const barra = Math.max(2, Math.min(ancho - 2, 42));
  const x = (i: number) => padL + i * ancho + (ancho - barra) / 2;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const cadaEtiqueta = Math.max(1, Math.ceil(n / 10));

  const linea = comparacion
    ?.slice(0, puntos.length)
    .map((c, i) => `${i === 0 ? "M" : "L"}${(x(i) + barra / 2).toFixed(1)},${y(c.valor).toFixed(1)}`)
    .join(" ");

  const teclas = (e: ReactKeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -i : e.key === "End" ? n - 1 - i : 0;
    if (d) {
      e.preventDefault();
      const j = Math.min(Math.max(i + d, 0), n - 1);
      setFoco(j);
      refs.current[j]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onElegir(i, e.currentTarget as unknown as HTMLElement);
    }
  };

  const contenidoTip = (i: number) => {
    const p = puntos[i];
    const c = comparacion?.[i];
    return (
      <div>
        <p className="mb-1 font-semibold text-white">
          {p.etiquetaLarga}
          {p.incompleto ? <span className="ml-1 font-normal text-amber-300">(en curso)</span> : null}
        </p>
        <p className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ background: ROJO }} aria-hidden />
          <span className="font-semibold tabular-nums text-white">{formatear(p.valor)}</span>
          <span className="text-white/55">{nombreMetrica}</span>
        </p>
        {c ? (
          <p className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3" style={{ background: GRIS_COMPARACION }} aria-hidden />
            <span className="font-semibold tabular-nums text-white">{formatear(c.valor)}</span>
            <span className="text-white/55">{c.etiquetaLarga}</span>
          </p>
        ) : null}
        {tooltipExtra?.(i)}
        <p className="mt-1.5 border-t border-white/10 pt-1.5 text-white/55">Enter o clic: ver operaciones o ir a ese período</p>
      </div>
    );
  };

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full sm:h-64" role="group" aria-label={`${nombreMetrica} por período`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={GRILLA} strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={TEXTO_EJE}>
              {formatearEje(t)}
            </text>
          </g>
        ))}
        {puntos.map((p, i) => {
          const h = Math.max(0, padT + innerH - y(p.valor));
          return (
            <g key={p.clave}>
              <path d={barraRedondeada(x(i), y(p.valor), barra, h)} fill={ROJO} opacity={p.incompleto ? 0.55 : 1} />
              {i % cadaEtiqueta === 0 || i === n - 1 ? (
                <text x={x(i) + barra / 2} y={H - 12} textAnchor="middle" fontSize={11} fill={TEXTO_EJE}>
                  {p.etiqueta}
                </text>
              ) : null}
            </g>
          );
        })}
        {linea ? <path d={linea} fill="none" stroke={GRIS_COMPARACION} strokeWidth={2} strokeLinejoin="round" /> : null}
        {comparacion?.slice(0, puntos.length).map((c, i) => (
          <circle key={i} cx={x(i) + barra / 2} cy={y(c.valor)} r={n > 40 ? 0 : 3} fill={GRIS_COMPARACION} stroke="#0e0e0e" strokeWidth={2} />
        ))}
        {/* Zonas de interacción: toda la columna, más grande que la barra. */}
        {puntos.map((p, i) => (
          <rect
            key={`h-${p.clave}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            x={padL + i * ancho}
            y={padT}
            width={ancho}
            height={innerH}
            fill="transparent"
            tabIndex={i === foco ? 0 : -1}
            role="button"
            aria-label={`${p.etiquetaLarga}: ${formatear(p.valor)}${comparacion?.[i] ? `; comparación ${formatear(comparacion[i].valor)}` : ""}`}
            className="cursor-pointer outline-none hover:fill-white/[0.04] focus-visible:fill-white/[0.08]"
            onKeyDown={(e) => teclas(e, i)}
            onClick={(e) => {
              setFoco(i);
              onElegir(i, e.currentTarget as unknown as HTMLElement);
            }}
            {...propsTooltip(tip, () => contenidoTip(i))}
          />
        ))}
      </svg>
    </div>
  );
}

function barraRedondeada(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function pasoLindo(bruto: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(bruto)));
  const f = bruto / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

// ── Barras horizontales (duraciones, grupos, días, medios) ───────────────────

export type FilaBarra = {
  clave: string;
  etiqueta: string;
  valor: number;
  texto: string;
  secundario?: ReactNode;
  color?: string;
  /** Valor del período de comparación en la misma escala (marca vertical). */
  comparacion?: number | null;
  tooltip: () => ReactNode;
  deshabilitado?: boolean;
};

export function BarrasHorizontales({ filas, etiqueta, onElegir }: { filas: FilaBarra[]; etiqueta: string; onElegir?: (f: FilaBarra, el: HTMLElement) => void }) {
  const tip = useTooltip();
  const max = Math.max(...filas.map((f) => Math.max(f.valor, f.comparacion ?? 0)), 0) || 1;
  return (
    <ul className="space-y-1" aria-label={etiqueta}>
      {filas.map((f) => {
        const contenido = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-white/80">{f.etiqueta}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-white">{f.texto}</span>
            </span>
            <span className="relative mt-1.5 block h-2.5 rounded-full bg-white/[0.06]">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${(f.valor / max) * 100}%`, background: f.color ?? ROJO }}
              />
              {f.comparacion != null ? (
                <span
                  aria-hidden
                  className="absolute -bottom-1 -top-1 w-0.5 rounded-full"
                  style={{ left: `calc(${(f.comparacion / max) * 100}% - 1px)`, background: GRIS_COMPARACION }}
                />
              ) : null}
            </span>
            {f.secundario ? <span className="mt-1 block text-xs text-white/50">{f.secundario}</span> : null}
          </>
        );
        return (
          <li key={f.clave}>
            {onElegir && !f.deshabilitado ? (
              <button
                type="button"
                onClick={(e) => onElegir(f, e.currentTarget)}
                className={cx("block min-h-11 w-full rounded-xl px-2 py-2 text-left hover:bg-white/[0.04]", FOCO)}
                {...propsTooltip(tip, f.tooltip)}
              >
                {contenido}
              </button>
            ) : (
              <div className="px-2 py-2" {...propsTooltip(tip, f.tooltip)} tabIndex={0}>
                {contenido}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Participación (barra 100 % apilada, con etiquetas directas) ──────────────

export function BarraParticipacion({
  segmentos,
  etiqueta,
}: {
  segmentos: Array<{ clave: string; etiqueta: string; valor: number; color: string; detalle: string }>;
  etiqueta: string;
}) {
  const tip = useTooltip();
  const visibles = segmentos.filter((s) => s.valor > 0);
  if (!visibles.length) return null;
  return (
    <div>
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${etiqueta}: ${visibles.map((s) => `${s.etiqueta} ${Math.round(s.valor * 1000) / 10} %`).join(", ")}`}>
        {visibles.map((s) => (
          <span
            key={s.clave}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${s.valor * 100}%`, background: s.color, minWidth: 3 }}
            {...propsTooltip(tip, () => (
              <span>
                <span className="block font-semibold text-white">{s.etiqueta}</span>
                {s.detalle}
              </span>
            ))}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/65">
        {visibles.map((s) => (
          <li key={s.clave} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.etiqueta} <span className="font-semibold tabular-nums text-white">{(Math.round(s.valor * 1000) / 10).toLocaleString("es-AR")} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Mapa de calor día × hora ─────────────────────────────────────────────────

const SUPERFICIE = [20, 20, 20];
const CALIENTE = [242, 100, 92];

export function colorCalor(t: number) {
  if (t <= 0) return "transparent";
  const k = 0.18 + 0.82 * Math.pow(Math.min(t, 1), 0.75);
  const c = SUPERFICIE.map((s, i) => Math.round(s + (CALIENTE[i] - s) * k));
  return `rgb(${c.join(",")})`;
}

export function MapaCalor({
  dias,
  horas,
  valor,
  formatear,
  tooltip,
  onElegir,
  seleccion,
  etiqueta,
}: {
  dias: readonly string[];
  horas: number[];
  valor: (dia: number, hora: number) => number;
  formatear: (n: number) => string;
  tooltip: (dia: number, hora: number) => ReactNode;
  onElegir: (dia: number, hora: number, el: HTMLElement) => void;
  seleccion?: { dias: number[]; horas: number[] };
  etiqueta: string;
}) {
  const tip = useTooltip();
  const [foco, setFoco] = useState<[number, number]>([0, 0]);
  const tabla = useRef<HTMLTableElement>(null);
  const max = Math.max(...dias.flatMap((_, d) => horas.map((h) => valor(d, h))), 0);

  const teclas = (e: ReactKeyboardEvent, d: number, hi: number) => {
    let [nd, nh] = [d, hi];
    if (e.key === "ArrowRight") nh = Math.min(hi + 1, horas.length - 1);
    else if (e.key === "ArrowLeft") nh = Math.max(hi - 1, 0);
    else if (e.key === "ArrowDown") nd = Math.min(d + 1, dias.length - 1);
    else if (e.key === "ArrowUp") nd = Math.max(d - 1, 0);
    else return;
    e.preventDefault();
    setFoco([nd, nh]);
    tabla.current?.querySelector<HTMLButtonElement>(`[data-celda="${nd}-${nh}"]`)?.focus();
  };

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <table ref={tabla} className="w-full min-w-[640px] border-separate border-spacing-[2px] text-xs" aria-label={etiqueta}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] bg-[#0e0e0e] px-1 text-left font-normal text-white/40">
                <span className="sr-only">Día</span>
              </th>
              {horas.map((h) => (
                <th key={h} scope="col" className="px-0.5 pb-1 text-center font-normal tabular-nums text-white/45">
                  {String(h).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dias.map((dia, d) => (
              <tr key={dia}>
                <th scope="row" className="sticky left-0 z-[1] bg-[#0e0e0e] pr-2 text-left font-semibold capitalize text-white/70">
                  {dia}
                </th>
                {horas.map((h, hi) => {
                  const v = valor(d, h);
                  const t = max ? v / max : 0;
                  const elegida = seleccion && seleccion.dias.includes(d) && seleccion.horas.includes(h);
                  return (
                    <td key={h} className="p-0">
                      <button
                        type="button"
                        data-celda={`${d}-${hi}`}
                        tabIndex={foco[0] === d && foco[1] === hi ? 0 : -1}
                        aria-label={`${dia} ${String(h).padStart(2, "0")} h: ${formatear(v)}`}
                        onKeyDown={(e) => teclas(e, d, hi)}
                        onClick={(e) => {
                          setFoco([d, hi]);
                          onElegir(d, h, e.currentTarget);
                        }}
                        className={cx(
                          "flex h-9 w-full min-w-[30px] items-center justify-center rounded-md tabular-nums transition-[box-shadow] duration-100",
                          v === 0 ? "bg-white/[0.025] text-white/20" : t > 0.62 ? "font-semibold text-black" : "text-white/85",
                          elegida && "ring-2 ring-white",
                          "hover:ring-1 hover:ring-white/60",
                          FOCO,
                        )}
                        style={{ background: v === 0 ? undefined : colorCalor(t) }}
                        {...propsTooltip(tip, () => tooltip(d, h))}
                      >
                        {v === 0 ? "·" : formatear(v)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-white/50">
        <span>Menos</span>
        <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${colorCalor(0.01)}, ${colorCalor(0.5)}, ${colorCalor(1)})` }} aria-hidden />
        <span>Más ({formatear(max)})</span>
        <span className="ml-2">· = sin registros</span>
      </div>
    </div>
  );
}

// ── Histograma de espera ─────────────────────────────────────────────────────

export function Histograma({
  barras,
  etiqueta,
  onElegir,
}: {
  barras: Array<{ clave: string; etiqueta: string; valor: number; texto: string; tooltip: () => ReactNode }>;
  etiqueta: string;
  onElegir?: (i: number, el: HTMLElement) => void;
}) {
  const tip = useTooltip();
  const max = Math.max(...barras.map((b) => b.valor), 0) || 1;
  return (
    <div role="group" aria-label={etiqueta} className="flex h-40 items-end gap-1.5">
      {barras.map((b, i) => (
        <button
          key={b.clave}
          type="button"
          disabled={!onElegir || b.valor === 0}
          onClick={(e) => onElegir?.(i, e.currentTarget)}
          className={cx("group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-lg pb-0.5 hover:bg-white/[0.04] disabled:cursor-default", FOCO)}
          aria-label={`${b.etiqueta}: ${b.texto}`}
          {...propsTooltip(tip, b.tooltip)}
        >
          <span className="text-xs font-semibold tabular-nums text-white">{b.texto}</span>
          <span className="flex min-h-0 w-full flex-1 items-end justify-center">
            <span className="block w-full max-w-[56px] rounded-t-[4px]" style={{ height: `${Math.max((b.valor / max) * 100, b.valor ? 2 : 0)}%`, background: ROJO }} />
          </span>
          <span className="w-full truncate text-center text-[11px] text-white/50">{b.etiqueta}</span>
        </button>
      ))}
    </div>
  );
}

"use client";

// Piezas de interfaz del dashboard del Stand, con el lenguaje del panel (negro,
// rojo, bordes white/10, rounded-2xl) y objetivos táctiles ≥ 44 px. El color
// nunca es la única señal: las variaciones llevan flecha, signo y texto.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowDownRight, ArrowUpRight, Info, Minus, X } from "lucide-react";
import type { Variacion } from "@/lib/metricasStandDashboard";
import { decimal, porcentaje } from "./formato";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export const FOCO = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400";

// ── Tooltip flotante (uno para todo el dashboard) ────────────────────────────

type EstadoTooltip = { rect: DOMRect; contenido: ReactNode } | null;
const TooltipCtx = createContext<{ mostrar: (el: Element, c: ReactNode) => void; ocultar: () => void }>({
  mostrar: () => {},
  ocultar: () => {},
});

export function useTooltip() {
  return useContext(TooltipCtx);
}

/** Props para que un elemento muestre su tooltip con mouse, toque o teclado. */
export function propsTooltip(t: ReturnType<typeof useTooltip>, contenido: () => ReactNode) {
  return {
    onPointerEnter: (e: React.PointerEvent<Element>) => t.mostrar(e.currentTarget, contenido()),
    onPointerLeave: () => t.ocultar(),
    onFocus: (e: React.FocusEvent<Element>) => t.mostrar(e.currentTarget, contenido()),
    onBlur: () => t.ocultar(),
  };
}

function TooltipFlotante({ estado }: { estado: EstadoTooltip }) {
  const ref = useRef<HTMLDivElement>(null);
  // Se posiciona después de medirse, escribiendo en el DOM (sin re-render).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!estado || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = estado.rect;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.opacity = "1";
  }, [estado]);
  if (!estado) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[70] max-w-[300px] rounded-xl border border-white/15 bg-[#161616] px-3 py-2 text-xs leading-relaxed text-white/80 shadow-2xl shadow-black/60 transition-opacity duration-100"
      style={{ left: -9999, top: -9999, opacity: 0 }}
    >
      {estado.contenido}
    </div>
  );
}

// ── Menú de acciones: deja explícito si se FILTRA o se abre el DETALLE ───────

export type Accion = { etiqueta: string; descripcion?: string; icono?: ReactNode; onClick: () => void };
type EstadoMenu = { el: HTMLElement; titulo: string; acciones: Accion[] } | null;
const MenuCtx = createContext<(el: HTMLElement, titulo: string, acciones: Accion[]) => void>(() => {});

export function useMenuAcciones() {
  return useContext(MenuCtx);
}

function MenuAcciones({ estado, cerrar }: { estado: EstadoMenu; cerrar: (devolverFoco: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!estado || !el) return;
    const r = estado.el.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [estado]);

  useEffect(() => {
    if (!estado) return;
    const fuera = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !estado.el.contains(e.target as Node)) cerrar(false);
    };
    const scroll = () => cerrar(false);
    document.addEventListener("pointerdown", fuera);
    window.addEventListener("scroll", scroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", fuera);
      window.removeEventListener("scroll", scroll, { capture: true });
    };
  }, [estado, cerrar]);

  if (!estado) return null;
  const teclas = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      cerrar(false);
    }
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-labelledby={`${id}-t`}
      onKeyDown={teclas}
      className="fixed z-[80] w-[min(300px,calc(100vw-16px))] rounded-2xl border border-white/15 bg-[#141414] p-1.5 shadow-2xl shadow-black/70"
      style={{ left: -9999, top: -9999 }}
    >
      <p id={`${id}-t`} className="px-3 pb-1.5 pt-2 text-xs font-semibold text-white/50">
        {estado.titulo}
      </p>
      {estado.acciones.map((a) => (
        <button
          key={a.etiqueta}
          type="button"
          role="menuitem"
          onClick={() => {
            // El foco vuelve a la marca que abrió el menú: si la acción abre el
            // detalle, al cerrarlo el foco regresa ahí (no a un ítem que ya no existe).
            estado.el.focus();
            cerrar(false);
            a.onClick();
          }}
          className={cx("flex min-h-11 w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white hover:bg-white/[0.07] focus:bg-white/[0.07]", FOCO)}
        >
          <span className="mt-0.5 text-red-400" aria-hidden>
            {a.icono}
          </span>
          <span>
            <span className="block font-semibold">{a.etiqueta}</span>
            {a.descripcion ? <span className="block text-xs text-white/50">{a.descripcion}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ProveedorInteraccion({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<EstadoTooltip>(null);
  const [menu, setMenu] = useState<EstadoMenu>(null);
  const mostrar = useCallback((el: Element, contenido: ReactNode) => setTip({ rect: el.getBoundingClientRect(), contenido }), []);
  const ocultar = useCallback(() => setTip(null), []);
  const abrirMenu = useCallback((el: HTMLElement, titulo: string, acciones: Accion[]) => {
    setTip(null);
    setMenu({ el, titulo, acciones });
  }, []);
  const cerrarMenu = useCallback((devolverFoco: boolean) => {
    setMenu((m) => {
      if (devolverFoco) m?.el.focus();
      return null;
    });
  }, []);
  return (
    <TooltipCtx.Provider value={{ mostrar, ocultar }}>
      <MenuCtx.Provider value={abrirMenu}>
        {children}
        <TooltipFlotante estado={tip} />
        <MenuAcciones estado={menu} cerrar={cerrarMenu} />
      </MenuCtx.Provider>
    </TooltipCtx.Provider>
  );
}

// ── Contenido estándar de un tooltip: valor primero, después el contexto ─────

export function TipContenido({ titulo, filas, nota }: { titulo: string; filas: Array<[string, string]>; nota?: string }) {
  return (
    <div>
      <p className="mb-1 font-semibold text-white">{titulo}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        {filas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-white/55">{k}</dt>
            <dd className="text-right font-semibold tabular-nums text-white">{v}</dd>
          </div>
        ))}
      </dl>
      {nota ? <p className="mt-1.5 border-t border-white/10 pt-1.5 text-white/55">{nota}</p> : null}
    </div>
  );
}

// ── Ayuda (definición, fórmula y cobertura) ──────────────────────────────────

export function Ayuda({ titulo, children }: { titulo: string; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierta(false);
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierta]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={`Qué es: ${titulo}`}
        aria-expanded={abierta}
        aria-controls={id}
        onClick={() => setAbierta((a) => !a)}
        onKeyDown={(e) => e.key === "Escape" && setAbierta(false)}
        className={cx("-m-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-white/40 hover:text-white", FOCO)}
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {abierta ? (
        <span
          id={id}
          role="note"
          className="absolute right-0 top-8 z-[60] w-[min(320px,80vw)] rounded-xl border border-white/15 bg-[#161616] p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white/75 shadow-2xl shadow-black/60"
        >
          <span className="mb-1 block font-semibold text-white">{titulo}</span>
          {children}
        </span>
      ) : null}
    </span>
  );
}

// ── Tarjeta de sección ───────────────────────────────────────────────────────

export function Tarjeta({
  titulo,
  subtitulo,
  ayuda,
  acciones,
  children,
  className,
  id,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  ayuda?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section aria-labelledby={id ? `${id}-titulo` : undefined} className={cx("min-w-0 rounded-2xl border border-white/10 bg-[#0e0e0e] p-4 sm:p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={id ? `${id}-titulo` : undefined} className="flex items-center gap-1.5 text-base font-semibold text-white">
            {titulo}
            {ayuda ? <Ayuda titulo={titulo}>{ayuda}</Ayuda> : null}
          </h3>
          {subtitulo ? <p className="mt-0.5 text-sm text-white/50">{subtitulo}</p> : null}
        </div>
        {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ── Control segmentado accesible (radiogroup) ────────────────────────────────

export function Segmentado<T extends string>({
  etiqueta,
  opciones,
  valor,
  onChange,
  chico,
}: {
  etiqueta: string;
  opciones: Array<{ valor: T; texto: string }>;
  valor: T;
  onChange: (v: T) => void;
  chico?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const mover = (e: ReactKeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + opciones.length) % opciones.length;
    onChange(opciones[j].valor);
    refs.current[j]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={etiqueta} className="inline-flex max-w-full overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-0.5">
      {opciones.map((o, i) => {
        const activo = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={activo}
            tabIndex={activo ? 0 : -1}
            onClick={() => onChange(o.valor)}
            onKeyDown={(e) => mover(e, i)}
            className={cx(
              "shrink-0 whitespace-nowrap rounded-[10px] font-semibold transition-colors duration-150",
              chico ? "min-h-9 px-2.5 text-xs" : "min-h-10 px-3 text-sm",
              activo ? "bg-red-600 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
              FOCO,
            )}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

// ── Variación contra el período de comparación ───────────────────────────────

export function Delta({
  v,
  modo = "porcentaje",
  mejorSiSube = true,
  formatoAnterior,
  unidad = "",
  decimales = 1,
}: {
  v: Variacion | null | undefined;
  modo?: "porcentaje" | "absoluto";
  mejorSiSube?: boolean;
  formatoAnterior: (n: number) => string;
  unidad?: string;
  /** Decimales de la diferencia absoluta (personas por operación usa 2). */
  decimales?: number;
}) {
  if (!v || v.anterior == null || v.actual == null) return <span className="text-xs text-white/40">Sin comparación</span>;
  const d = v.diferencia ?? 0;
  if (modo === "porcentaje" && v.porcentaje == null) {
    return <span className="text-xs text-white/45">Antes: {formatoAnterior(v.anterior)} (sin base para %)</span>;
  }
  const sube = d > 0;
  const igual = Math.abs(modo === "porcentaje" ? v.porcentaje ?? 0 : d) < (modo === "porcentaje" ? 0.0005 : 0.5 * Math.pow(10, -decimales));
  const bueno = igual ? null : sube === mejorSiSube;
  const Icono = igual ? Minus : sube ? ArrowUpRight : ArrowDownRight;
  const texto = modo === "porcentaje" ? porcentaje(Math.abs(v.porcentaje ?? 0)) : `${decimal(Math.abs(d), decimales)}${unidad}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-xs">
      <span
        className={cx(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular-nums",
          bueno === null ? "bg-white/[0.06] text-white/70" : bueno ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300",
        )}
      >
        <Icono className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">{igual ? "Sin cambio" : sube ? "Subió" : "Bajó"}</span>
        {igual ? "0" : `${sube ? "+" : "−"}${texto}`}
      </span>
      <span className="text-white/45">vs {formatoAnterior(v.anterior)}</span>
    </span>
  );
}

// ── Indicador ────────────────────────────────────────────────────────────────

export function Kpi({
  titulo,
  valor,
  detalle,
  delta,
  ayuda,
  destacado,
  onDetalle,
}: {
  titulo: string;
  valor: string;
  detalle?: ReactNode;
  delta?: ReactNode;
  ayuda?: ReactNode;
  destacado?: boolean;
  onDetalle?: () => void;
}) {
  return (
    <div className={cx("flex min-w-0 flex-col rounded-2xl border p-4", destacado ? "border-red-500/30 bg-gradient-to-br from-red-950/50 to-[#0e0e0e]" : "border-white/10 bg-[#0e0e0e]")}>
      <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
        {titulo}
        {ayuda ? <Ayuda titulo={titulo}>{ayuda}</Ayuda> : null}
      </p>
      <p className={cx("mt-1.5 font-bold tracking-tight text-white", destacado ? "text-4xl sm:text-5xl" : "text-2xl sm:text-3xl")}>{valor}</p>
      {delta ? <div className="mt-2">{delta}</div> : null}
      {detalle ? <div className="mt-2 text-sm text-white/55">{detalle}</div> : null}
      {onDetalle ? (
        <button type="button" onClick={onDetalle} className={cx("mt-auto self-start pt-3 text-xs font-semibold text-red-300 hover:text-red-200 hover:underline", FOCO)}>
          Ver operaciones
        </button>
      ) : null}
    </div>
  );
}

// ── Estados ──────────────────────────────────────────────────────────────────

export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-2xl bg-white/[0.05] motion-reduce:animate-none", className)} />;
}

export function SinDatos({ titulo, children, accion }: { titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center">
      <p className="font-semibold text-white">{titulo}</p>
      {children ? <p className="mt-1 max-w-md text-sm text-white/55">{children}</p> : null}
      {accion ? <div className="mt-4">{accion}</div> : null}
    </div>
  );
}

export function Chip({ texto, onQuitar }: { texto: string; onQuitar: () => void }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 py-1 pl-3 pr-1 text-xs font-semibold text-white">
      {texto}
      <button
        type="button"
        onClick={onQuitar}
        aria-label={`Quitar filtro ${texto}`}
        className={cx("inline-flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white", FOCO)}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}

"use client";

// Piezas de interfaz del módulo Interacciones, con el lenguaje del panel
// (negro, rojo, bordes white/10, rounded-2xl/3xl) y objetivos táctiles ≥ 44 px.

import { useEffect, useId, useRef, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, LoaderCircle, Minus, Plus, TriangleAlert, X } from "lucide-react";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

// ── Botones ────────────────────────────────────────────────────────────────
type BotonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "secundario" | "peligro" | "fantasma";
  cargando?: boolean;
};

export function Boton({ variante = "secundario", cargando, className, children, disabled, ...rest }: BotonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variante === "primario" && "bg-red-600 text-white hover:bg-red-700",
        variante === "secundario" && "border border-white/15 text-white/85 hover:border-white/40 hover:text-white",
        variante === "peligro" && "border border-red-500/50 text-red-300 hover:bg-red-950/40",
        variante === "fantasma" && "text-white/70 hover:text-white",
        className,
      )}
    >
      {cargando ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

// ── Avisos ─────────────────────────────────────────────────────────────────
export function Aviso({ tipo = "info", titulo, children, acciones }: {
  tipo?: "info" | "error" | "exito" | "alerta";
  titulo?: string;
  children?: ReactNode;
  acciones?: ReactNode;
}) {
  const Icono = tipo === "error" ? CircleAlert : tipo === "exito" ? CircleCheck : tipo === "alerta" ? TriangleAlert : Info;
  return (
    <div
      role={tipo === "error" ? "alert" : "status"}
      className={cx(
        "rounded-2xl border p-4 text-sm",
        tipo === "error" && "border-red-500/50 bg-red-950/30 text-red-100",
        tipo === "exito" && "border-green-500/40 bg-green-950/25 text-green-100",
        tipo === "alerta" && "border-amber-500/40 bg-amber-950/20 text-amber-100",
        tipo === "info" && "border-white/10 bg-white/[0.04] text-white/80",
      )}
    >
      <div className="flex gap-3">
        <Icono className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          {titulo ? <p className="font-bold">{titulo}</p> : null}
          {children ? <div className={titulo ? "mt-1" : ""}>{children}</div> : null}
          {acciones ? <div className="mt-3 flex flex-wrap gap-2">{acciones}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-sm text-white/60">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      {texto}
    </p>
  );
}

// ── Panel modal (pantalla completa en celular, lateral en escritorio) ──────
export function Panel({ titulo, onCerrar, children, pie, ancho = "max-w-2xl", etiquetaCerrar = "Cerrar" }: {
  titulo: ReactNode;
  onCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
  ancho?: string;
  etiquetaCerrar?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    cerrar.current = onCerrar;
  }, [onCerrar]);
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cerrar.current();
      }
    };
    document.addEventListener("keydown", tecla);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = overflow;
      // Si el disparador ya no existe (p. ej. un aviso que se ocultó), el foco va al título.
      if (previo?.isConnected) previo.focus();
      else document.getElementById("titulo-pagina")?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/70" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={cx("flex h-[100dvh] w-full flex-col border-l border-white/10 bg-zinc-950 text-white outline-none", ancho)}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-6">
          <h2 id={id} className="text-lg font-black uppercase tracking-wide md:text-xl">{titulo}</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={etiquetaCerrar}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">{children}</div>
        {pie ? <div className="shrink-0 border-t border-white/10 bg-zinc-950 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-6">{pie}</div> : null}
      </div>
    </div>
  );
}

/** Confirmación chica encima de un panel. */
export function Dialogo({ titulo, children, acciones, onCerrar }: {
  titulo: string;
  children: ReactNode;
  acciones: ReactNode;
  onCerrar: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    cerrar.current = onCerrar;
  }, [onCerrar]);
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cerrar.current();
      }
    };
    document.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("keydown", tecla, true);
      // Si el disparador ya no existe (p. ej. un aviso que se ocultó), el foco va al título.
      if (previo?.isConnected) previo.focus();
      else document.getElementById("titulo-pagina")?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/75 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
        className="w-full max-w-md rounded-3xl border border-red-500/30 bg-zinc-950 p-5 text-white outline-none">
        <h3 id={id} className="text-lg font-black">{titulo}</h3>
        <div className="mt-3 text-sm text-white/80">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">{acciones}</div>
      </div>
    </div>
  );
}

// ── Controles del formulario ───────────────────────────────────────────────
export function Campo({ etiqueta, ayuda, children, id }: { etiqueta: string; ayuda?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="space-y-2">
      <p id={id} className="text-sm font-semibold text-white/80">{etiqueta}</p>
      {children}
      {ayuda ? <p className="text-xs text-white/50">{ayuda}</p> : null}
    </div>
  );
}

/** Opciones de un toque. Tocar la elegida la vacía (vacío ≠ "No sabe"). */
export function Chips<T extends string>({ etiqueta, opciones, valor, onCambio, deshabilitado, ayuda }: {
  etiqueta: string;
  opciones: ReadonlyArray<{ valor: T; texto: string; detalle?: string }>;
  valor: T | null;
  onCambio: (v: T | null) => void;
  deshabilitado?: boolean;
  ayuda?: ReactNode;
}) {
  const id = useId();
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} id={id}>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {opciones.map((o) => {
          const activo = valor === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              disabled={deshabilitado}
              aria-pressed={activo}
              onClick={() => onCambio(activo ? null : o.valor)}
              className={cx(
                "min-h-11 rounded-xl border px-3.5 py-2 text-sm font-semibold transition",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400",
                "disabled:cursor-not-allowed disabled:opacity-50",
                activo ? "border-red-500 bg-red-600 text-white" : "border-white/15 bg-black/40 text-white/80 hover:border-white/40",
              )}
            >
              {o.texto}
              {o.detalle ? <span className="ml-1 text-xs font-normal opacity-75">{o.detalle}</span> : null}
            </button>
          );
        })}
      </div>
    </Campo>
  );
}

/** Contador con −/+. Con permitirVacio arranca en "—" (sin dato). */
export function Contador({ etiqueta, valor, min, max, onCambio, permitirVacio, deshabilitado }: {
  etiqueta: string;
  valor: number | null;
  min: number;
  max: number;
  onCambio: (v: number | null) => void;
  permitirVacio?: boolean;
  deshabilitado?: boolean;
}) {
  const id = useId();
  const bajar = () => {
    if (valor === null) return;
    if (valor <= min) {
      if (permitirVacio) onCambio(null);
      return;
    }
    onCambio(valor - 1);
  };
  // Desde "sin dato", el primer + pone 1 (no 0): cargar "1 hombre" es un solo toque.
  // Con − se baja hasta 0 y, si se permite, de 0 a "sin dato".
  const subir = () => onCambio(valor === null ? Math.max(min, 1) : Math.min(max, valor + 1));
  const btn = "inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-white hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 disabled:opacity-40";
  return (
    <div className="space-y-2">
      <p id={id} className="text-sm font-semibold text-white/80">{etiqueta}</p>
      <div role="group" aria-labelledby={id} className="flex items-center gap-2">
        <button type="button" className={btn} onClick={bajar} disabled={deshabilitado || valor === null || (!permitirVacio && valor <= min)}
          aria-label={`Restar ${etiqueta.toLowerCase()}`}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <output aria-live="polite" className="min-w-12 text-center text-2xl font-black tabular-nums">{valor ?? "—"}</output>
        <button type="button" className={btn} onClick={subir} disabled={deshabilitado || (valor !== null && valor >= max)}
          aria-label={`Sumar ${etiqueta.toLowerCase()}`}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Sección plegable para los datos secundarios. */
export function Plegable({ titulo, abierto, onAlternar, children, resumen }: {
  titulo: string;
  abierto: boolean;
  onAlternar: () => void;
  children: ReactNode;
  resumen?: string;
}) {
  const id = useId();
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <button type="button" aria-expanded={abierto} aria-controls={id} onClick={onAlternar}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-bold text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
        <span>{titulo}{resumen ? <span className="ml-2 font-normal text-white/50">{resumen}</span> : null}</span>
        <span aria-hidden className="text-white/50">{abierto ? "−" : "+"}</span>
      </button>
      {abierto ? <div id={id} className="space-y-5 border-t border-white/10 px-4 py-4">{children}</div> : null}
    </div>
  );
}

export function Etiqueta({ children, tono = "neutro" }: { children: ReactNode; tono?: "neutro" | "rojo" | "verde" | "ambar" | "gris" }) {
  return (
    <span className={cx(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold",
      tono === "neutro" && "border-white/15 bg-white/5 text-white/80",
      tono === "rojo" && "border-red-500/40 bg-red-950/40 text-red-200",
      tono === "verde" && "border-green-500/40 bg-green-950/40 text-green-200",
      tono === "ambar" && "border-amber-500/40 bg-amber-950/40 text-amber-200",
      tono === "gris" && "border-white/10 bg-white/[0.03] text-white/50",
    )}>
      {children}
    </span>
  );
}

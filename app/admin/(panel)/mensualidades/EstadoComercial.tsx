"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Pause, Play, X } from "lucide-react";

// Estado comercial de Mensualidades (Bloque M8A).
//
// Muestra las DOS llaves por separado, porque son cosas distintas:
//
//   · Módulo público (MENSUALIDADES_ENABLED) — variable de entorno. Se muestra
//     como INFORMACIÓN. No se toca desde acá: cambiarla exige un redeploy y
//     este panel no administra Vercel.
//   · Ventas públicas — configuración en la base. Esta SÍ se cambia acá, y el
//     efecto es inmediato.
//
// Esconder el botón para staff es cortesía visual: el control real es
// requireAdmin() en la ruta, que devuelve 403.

type Estado = {
  moduloPublico: boolean;
  ventasPublicas: boolean;
  sePuedeComprar: boolean;
  actualizadoAt: string | null;
  puedeEditar: boolean;
};

function nuevaClave(): string {
  const c = globalThis.crypto;
  const base = c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `vts${base.replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 64);
}

function cuando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function Pastilla({ activo, si, no }: { activo: boolean; si: string; no: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
        activo
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
      }`}
    >
      {activo ? si : no}
    </span>
  );
}

export default function EstadoComercial({ rol }: { rol: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abrir, setAbrir] = useState<null | boolean>(null); // el estado que se quiere aplicar
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claveRef = useRef<string>(nuevaClave());

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/admin/mensualidades/ventas", { cache: "no-store" });
      if (!res.ok) { setEstado(null); return; }
      setEstado((await res.json()) as Estado);
    } catch {
      setEstado(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const cerrar = useCallback(() => {
    if (enviando) return;
    setAbrir(null);
    setError(null);
  }, [enviando]);

  useEffect(() => {
    if (abrir === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abrir, cerrar]);

  function pedir(nuevo: boolean) {
    claveRef.current = nuevaClave();  // una clave por intento lógico
    setMotivo("");
    setError(null);
    setAbrir(nuevo);
  }

  async function confirmar() {
    if (enviando || abrir === null) return;
    if (!motivo.trim()) { setError("Escribí el motivo del cambio."); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/mensualidades/ventas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          habilitadas: abrir,
          motivo: motivo.trim(),
          idempotency_key: claveRef.current,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) { setError(json.error ?? "No pudimos cambiar el estado."); return; }
      setAbrir(null);
      // Se relee del servidor: la pantalla no da por hecho lo que pidió.
      await cargar();
    } catch {
      setError("No pudimos conectar con el servidor. Podés reintentar sin duplicar.");
    } finally {
      setEnviando(false);
    }
  }

  if (cargando && !estado) {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando el estado comercial…
      </div>
    );
  }
  if (!estado) return null;

  const puedeEditar = estado.puedeEditar && rol === "admin";

  return (
    <>
      <section className="mb-5 rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">Módulo público</span>
              <Pastilla activo={estado.moduloPublico} si="Visible" no="Oculto" />
              <span className="text-[11px] text-zinc-600">
                {estado.moduloPublico
                  ? "las páginas públicas responden"
                  : "las páginas públicas devuelven 404"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">Ventas públicas</span>
              <Pastilla activo={estado.ventasPublicas} si="Habilitadas" no="Pausadas" />
              <span className="text-[11px] text-zinc-600">
                {estado.actualizadoAt ? `desde el ${cuando(estado.actualizadoAt)}` : ""}
              </span>
            </div>
          </div>

          {puedeEditar && (
            <button
              type="button"
              onClick={() => pedir(!estado.ventasPublicas)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-red-500/40 ${
                estado.ventasPublicas
                  ? "border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                  : "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
              }`}
            >
              {estado.ventasPublicas ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {estado.ventasPublicas ? "Pausar ventas" : "Habilitar ventas"}
            </button>
          )}
        </div>

        {/* La combinación que más confunde: ventas habilitadas con el módulo
            oculto no vende nada. Se dice explícitamente. */}
        {estado.ventasPublicas && !estado.moduloPublico && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Las ventas figuran habilitadas, pero el módulo público está oculto: nadie
            puede comprar. La llave general manda.
          </p>
        )}
      </section>

      {/* ── Confirmación ── */}
      {abrir !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-estado-ventas"
        >
          <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <h2 id="titulo-estado-ventas" className="truncate text-base font-black text-white">
                {abrir ? "Habilitar ventas públicas" : "Pausar ventas públicas"}
              </h2>
              <button
                type="button" onClick={cerrar} disabled={enviando} aria-label="Cerrar"
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <ul className="space-y-2 text-xs leading-relaxed text-zinc-300">
                {abrir ? (
                  <>
                    <li>· Se habilitan las compras y renovaciones públicas, siempre que el módulo general también esté visible.</li>
                    <li>· Se van a poder generar preferencias reales de Mercado Pago.</li>
                    <li>· Los precios serán los de los planes vigentes.</li>
                  </>
                ) : (
                  <>
                    <li>· Se impiden las compras y renovaciones públicas nuevas.</li>
                    <li>· Los titulares pueden seguir usando su saldo.</li>
                    <li>· Reservar, cancelar y reprogramar siguen funcionando.</li>
                    <li>· Los pagos ya iniciados podrán confirmarse igual.</li>
                    <li>· El alta administrativa sigue habilitada.</li>
                  </>
                )}
              </ul>

              <div>
                <label htmlFor="ec-motivo" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Motivo
                </label>
                <textarea
                  id="ec-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  rows={2} maxLength={500} placeholder="Queda en la auditoría"
                  className="w-full resize-none rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                />
              </div>

              {error && (
                <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">{error}</span>
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button" onClick={cerrar} disabled={enviando}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:border-white/30 focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button" onClick={confirmar} disabled={enviando}
                className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {enviando ? "Aplicando…" : abrir ? "Habilitar" : "Pausar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

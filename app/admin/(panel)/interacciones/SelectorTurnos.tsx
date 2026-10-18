"use client";

// Selector de turnos YA CARGADOS en el Turnero (solo turnos_stand). Ventana inicial:
// las 2 h previas a la hora de la interacción; se puede ampliar al día o a ±1 día
// y buscar por hora o personas. Los IDs viajan como cadenas, nunca como número.
// Nunca crea turnos ni reservas: solo elige existentes.

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";
import { LIMITES, type AlcanceVinculables, type TurnoVinculableDto } from "@/lib/interacciones";
import { api, formatoMonto, type TurnoElegido, type Vinculables } from "./cliente";
import { Aviso, Boton, Cargando, Etiqueta, cx } from "./ui";

const ALCANCES: Array<{ valor: AlcanceVinculables; texto: string }> = [
  { valor: "2h", texto: "2 h previas" },
  { valor: "dia", texto: "Todo el día" },
  { valor: "tolerancia", texto: "±1 día" },
];

export function aElegido(t: TurnoVinculableDto): TurnoElegido {
  return { id: t.id, fecha: t.fecha, hora: t.hora, personas: t.personas, minutos: t.minutos, total: t.total };
}

export default function SelectorTurnos({ ancla, seleccion, maximo, onCambio, deshabilitado, actualizar = 0 }: {
  /** interaccion = buscar alrededor de SU ocurrida_en; ocurrida_en = una hora (null = ahora). */
  ancla: { interaccion: string } | { ocurrida_en: string | null };
  seleccion: TurnoElegido[];
  /** Cuántos se pueden elegir todavía (máximo del módulo menos los ya vinculados). */
  maximo: number;
  onCambio: (s: TurnoElegido[]) => void;
  deshabilitado?: boolean;
  /** Cambiarlo vuelve a pedir la lista (p. ej. después de un turno ya vinculado). */
  actualizar?: number;
}) {
  const [alcance, setAlcance] = useState<AlcanceVinculables>("2h");
  const [hora, setHora] = useState("");
  const [personas, setPersonas] = useState<number | null>(null);
  const [datos, setDatos] = useState<Vinculables | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);
  const seq = useRef(0);

  const claveAncla = "interaccion" in ancla ? `i:${ancla.interaccion}` : `o:${ancla.ocurrida_en ?? "ahora"}`;
  const horaValida = hora === "" || /^\d{1,2}(:\d{0,2})?$/.test(hora);

  useEffect(() => {
    if (!horaValida) return;
    const mio = ++seq.current;
    const ctrl = new AbortController();
    const q = new URLSearchParams();
    if ("interaccion" in ancla) q.set("interaccion", ancla.interaccion);
    else if (ancla.ocurrida_en) q.set("ocurrida_en", ancla.ocurrida_en);
    if (alcance !== "2h") q.set("alcance", alcance);
    if (hora) q.set("hora", hora);
    if (personas) q.set("personas", String(personas));
    setCargando(true);
    const t = setTimeout(async () => {
      const r = await api.vinculables(q, ctrl.signal);
      if (mio !== seq.current) return; // llegó tarde: hay una búsqueda más nueva
      setCargando(false);
      if (r.ok) {
        setDatos(r.data);
        setError(null);
      } else if (r.codigo !== "cancelado") {
        setError(r.error);
      }
    }, hora ? 250 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveAncla, alcance, hora, personas, recarga, horaValida, actualizar]);

  const elegidos = new Set(seleccion.map((s) => s.id));
  const lleno = seleccion.length >= maximo;
  const alternar = (t: TurnoVinculableDto) => {
    if (elegidos.has(t.id)) onCambio(seleccion.filter((s) => s.id !== t.id));
    else if (!lleno) onCambio([...seleccion, aElegido(t)]);
  };
  const fechaAncla = datos?.ventana.ancla.fecha;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div role="group" aria-label="Ventana de búsqueda" className="flex rounded-xl border border-white/15 p-1">
          {ALCANCES.map((a) => (
            <button key={a.valor} type="button" aria-pressed={alcance === a.valor} disabled={deshabilitado}
              onClick={() => setAlcance(a.valor)}
              className={cx("min-h-11 rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400",
                alcance === a.valor ? "bg-red-600 text-white" : "text-white/70 hover:text-white")}>
              {a.texto}
            </button>
          ))}
        </div>
        <label className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-white/15 bg-black/40 px-3 focus-within:border-red-500 sm:w-auto sm:flex-1">
          <Search className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
          <span className="sr-only">Buscar por hora</span>
          <input value={hora} onChange={(e) => setHora(e.target.value.replace(/[^\d:]/g, "").slice(0, 5))}
            inputMode="numeric" placeholder="Hora (ej. 19:5)" disabled={deshabilitado}
            className="min-h-11 w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-white/40" />
        </label>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <span>Personas</span>
          <select value={personas ?? ""} onChange={(e) => setPersonas(e.target.value ? Number(e.target.value) : null)} disabled={deshabilitado}
            className="min-h-11 rounded-xl border border-white/15 bg-black/40 px-2 text-white outline-none focus:border-red-500">
            <option value="">Todas</option>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Boton variante="fantasma" onClick={() => setRecarga((n) => n + 1)} aria-label="Actualizar turnos" disabled={deshabilitado}>
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Boton>
      </div>

      <p className="text-xs text-white/55" aria-live="polite">
        {seleccion.length} de {maximo} elegidos{maximo < LIMITES.max_turnos_por_interaccion ? ` (ya tiene ${LIMITES.max_turnos_por_interaccion - maximo} vinculados)` : ""}.
        {datos ? ` Turnos ${alcance === "2h" ? `de ${datos.ventana.ancla.hora} hacia atrás (2 h)` : alcance === "dia" ? "de ese día" : "del día anterior al siguiente"}.` : ""}
      </p>

      {!horaValida ? <Aviso tipo="alerta">Escribí la hora como 19 o 19:5.</Aviso> : null}
      {error ? (
        <Aviso tipo="error" acciones={<Boton onClick={() => setRecarga((n) => n + 1)}>Reintentar</Boton>}>{error}</Aviso>
      ) : cargando && !datos ? (
        <Cargando texto="Buscando turnos del Turnero…" />
      ) : datos && datos.turnos.length === 0 ? (
        <Aviso>No hay turnos cargados en esta ventana. Probá ampliar a “Todo el día” o “±1 día”.</Aviso>
      ) : datos ? (
        <ul className={cx("space-y-2", cargando && "opacity-60")} aria-busy={cargando}>
          {datos.turnos.map((t) => {
            const elegido = elegidos.has(t.id);
            const ocupado = t.vinculacion !== "libre";
            const bloqueado = deshabilitado || ocupado || (!elegido && lleno);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => alternar(t)} disabled={bloqueado} aria-pressed={elegido}
                  className={cx(
                    "flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2 text-left text-sm transition",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400",
                    elegido ? "border-red-500 bg-red-950/40" : "border-white/10 bg-black/40 hover:border-white/30",
                    bloqueado && !elegido && "cursor-not-allowed opacity-50",
                  )}>
                  <span aria-hidden className={cx("h-5 w-5 shrink-0 rounded-md border", elegido ? "border-red-400 bg-red-500" : "border-white/30")} />
                  <span className="text-base font-black tabular-nums">{t.hora}</span>
                  {t.fecha !== fechaAncla ? <span className="text-white/60">{t.fecha.split("-").reverse().slice(0, 2).join("/")}</span> : null}
                  <span className="text-white/80">{t.personas ?? "?"} pers.</span>
                  <span className="text-white/80">{t.minutos ?? "?"} min</span>
                  <span className="font-semibold tabular-nums">{t.es_pago ? formatoMonto(t.total) : "Gratis"}</span>
                  {t.pago_contradictorio ? (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-200" title="El total y la forma de pago no coinciden en el Turnero">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> pago a revisar
                    </span>
                  ) : null}
                  {t.vinculacion === "otra" ? <Etiqueta tono="gris">Ya vinculado</Etiqueta> : null}
                  {t.vinculacion === "esta" ? <Etiqueta tono="verde">Vinculado acá</Etiqueta> : null}
                  <span className="sr-only">{elegido ? "elegido" : ocupado ? "no disponible" : "disponible"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

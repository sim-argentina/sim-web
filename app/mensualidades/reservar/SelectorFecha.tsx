"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

// Selector compacto de fecha para reservar con mensualidad (Bloque M8C).
//
// Antes las diez fechas públicas se dibujaban como diez botones, uno debajo del
// otro. Ocupaban media pantalla en el celular y empujaban los horarios —que es
// lo que la persona realmente viene a elegir— fuera de la vista.
//
// Ahora se ve UNA fecha: la que el servidor eligió. El resto vive en un
// calendario que se abre al tocar el control.
//
// ESTE COMPONENTE NO SABE NADA DEL CALENDARIO DEL NEGOCIO.
// No conoce lunes a viernes, ni la ventana de 15 días, ni los bloqueos, ni el
// vencimiento. Recibe `fechas` —lo que devolvió la API— y esa lista ES la
// verdad: un día es seleccionable si y solo si está ahí. Todo lo demás se
// dibuja apagado. Duplicar acá las reglas del servidor sería volver a crear el
// problema que arregló M8B.2.1, cuando el navegador decidía por su cuenta qué
// fecha pedir y se equivocaba dos días de cada siete.
//
// La aritmética de la grilla es SOLO de presentación (qué casillero ocupa cada
// día) y va entera en UTC, así el huso del visitante no puede correr un día.

const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

/** "2026-09-21" → {y, m, d}. Sin Date de por medio: no hay huso que aplicar. */
function partes(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Lunes = 0 … domingo = 6. En UTC: el huso del visitante no mueve la grilla. */
function columnaDe(isoFecha: string) {
  const { y, m, d } = partes(isoFecha);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function diasDelMes(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function nombreDelMes(y: number, m: number) {
  const txt = new Intl.DateTimeFormat("es-AR", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

export default function SelectorFecha({
  fechas,
  valor,
  etiquetaLarga,
  onElegir,
  deshabilitado,
}: {
  /** Las únicas fechas seleccionables. Vienen del servidor, tal cual. */
  fechas: string[];
  valor: string;
  /** Cómo se escribe una fecha completa. La define la pantalla, no este control. */
  etiquetaLarga: (isoFecha: string) => string;
  onElegir: (isoFecha: string) => void;
  deshabilitado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [foco, setFoco] = useState("");
  const botonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const idPanel = useId();
  const idRotulo = useId();

  const disponibles = useMemo(() => new Set(fechas), [fechas]);

  // Mes visible: el de la fecha con foco, o el de la elegida, o el de la primera
  // disponible. Nunca un mes inventado.
  const mesBase = foco || valor || fechas[0] || "";
  const { y: anio, m: mes } = mesBase ? partes(mesBase) : { y: 0, m: 0 };

  const cerrar = useCallback((devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) botonRef.current?.focus();
  }, []);

  // Escape cierra y devuelve el foco al botón: quien navega por teclado no
  // puede quedar atrapado dentro del calendario.
  useEffect(() => {
    if (!abierto) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); cerrar(true); }
    }
    function onFuera(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || botonRef.current?.contains(t)) return;
      cerrar(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onFuera);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onFuera);
    };
  }, [abierto, cerrar]);

  // Abrir es una ACCIÓN, no una consecuencia: el foco inicial se decide acá, al
  // apretar el botón, y no en un efecto que reaccione a `abierto`. Así no hay un
  // render intermedio con el calendario abierto y el foco en la nada.
  function alternar() {
    if (abierto) { cerrar(false); return; }
    setFoco(valor || fechas[0] || "");
    setAbierto(true);
  }

  // El foco del NAVEGADOR se mueve DESPUÉS del render, nunca dentro del
  // manejador de teclas. Si se hiciera en el manejador, un salto que cambia de
  // mes —End, o pasar del 30 de septiembre al 1 de octubre— buscaría un botón
  // que todavía no existe: el mes nuevo se dibuja recién en el render siguiente.
  // El querySelector devolvía null y el foco se quedaba donde estaba.
  useEffect(() => {
    if (!abierto || !foco) return;
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-fecha="${foco}"]`)?.focus();
  }, [abierto, foco]);

  function elegir(f: string) {
    if (!disponibles.has(f)) return;
    onElegir(f);
    cerrar(true);
  }

  // Las flechas saltan de una fecha DISPONIBLE a otra, no de casillero en
  // casillero. La ventana tiene agujeros —fines de semana, bloqueos—, así que
  // moverse por semanas dejaría el foco casi siempre sobre un día apagado.
  // Se calcula sobre el foco ANTERIOR, no sobre el de este render: dos teclas
  // seguidas antes de que React repinte tienen que avanzar dos, no una.
  function mover(delta: number, alExtremo?: "inicio" | "fin") {
    setFoco((prev) => {
      const i = fechas.indexOf(prev || valor);
      const destino = alExtremo === "inicio" ? 0
        : alExtremo === "fin" ? fechas.length - 1
        : Math.min(Math.max((i < 0 ? 0 : i) + delta, 0), fechas.length - 1);
      return fechas[destino] ?? prev;
    });
  }

  function onTeclaGrilla(e: React.KeyboardEvent) {
    const mapa: Record<string, () => void> = {
      ArrowRight: () => mover(1),
      ArrowDown: () => mover(1),
      ArrowLeft: () => mover(-1),
      ArrowUp: () => mover(-1),
      Home: () => mover(0, "inicio"),
      End: () => mover(0, "fin"),
    };
    const accion = mapa[e.key];
    if (accion) { e.preventDefault(); accion(); }
  }

  // Meses que tienen al menos una fecha disponible: no se navega hacia meses
  // vacíos, que serían un callejón sin salida.
  const mesesConFechas = useMemo(() => {
    const s = new Set<string>();
    for (const f of fechas) { const p = partes(f); s.add(`${p.y}-${p.m}`); }
    return [...s].sort();
  }, [fechas]);
  const posMes = mesesConFechas.indexOf(`${anio}-${mes}`);
  const mesPrevio = posMes > 0 ? mesesConFechas[posMes - 1] : null;
  const mesSiguiente = posMes >= 0 && posMes < mesesConFechas.length - 1 ? mesesConFechas[posMes + 1] : null;

  function irAlMes(clave: string) {
    const [y, m] = clave.split("-").map(Number);
    const primera = fechas.find((f) => { const p = partes(f); return p.y === y && p.m === m; });
    if (primera) setFoco(primera);
  }

  const celdas = useMemo(() => {
    if (!anio) return [];
    const total = diasDelMes(anio, mes);
    const offset = columnaDe(iso(anio, mes, 1));
    const out: (string | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= total; d++) out.push(iso(anio, mes, d));
    return out;
  }, [anio, mes]);

  return (
    <div className="relative">
      <p id={idRotulo} className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
        Fecha
      </p>

      {/* Control cerrado: una sola fecha, la completa. */}
      <button
        ref={botonRef}
        type="button"
        onClick={alternar}
        disabled={deshabilitado || fechas.length === 0}
        aria-expanded={abierto}
        aria-controls={idPanel}
        aria-haspopup="dialog"
        aria-labelledby={`${idRotulo} ${idPanel}-valor`}
        className="mt-3 flex w-full items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-zinc-900/70 px-4 py-4 text-left transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-red-500/10 p-2 text-red-400">
            <CalendarDays className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs uppercase tracking-[0.22em] text-zinc-500">
              Día elegido
            </span>
            {/* Sin `truncate`: el control cerrado tiene que mostrar la fecha
                COMPLETA. A 320 px no entra en una línea, así que envuelve en
                dos. Truncarla dejaba "Lunes, 21 de …", que es justo lo que este
                control existe para evitar. */}
            <span id={`${idPanel}-valor`} className="mt-1 block text-base font-bold leading-snug text-white md:text-lg">
              {valor ? etiquetaLarga(valor) : "Elegí una fecha"}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-zinc-400">
          <span className="hidden text-sm sm:inline">Cambiar</span>
          <ChevronDown className={`h-5 w-5 transition-transform ${abierto ? "rotate-180" : ""}`} />
        </span>
      </button>

      {abierto && (
        <div
          ref={panelRef}
          id={idPanel}
          role="dialog"
          aria-label="Elegí la fecha de tu turno"
          // max-w y right-0 lo mantienen dentro del viewport en 320 px, donde un
          // ancho fijo se saldría de la pantalla.
          className="absolute left-0 right-0 top-full z-30 mt-2 max-w-[min(360px,100%)] rounded-[22px] border border-white/15 bg-[#0b0b0d] p-4 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.95)]"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => mesPrevio && irAlMes(mesPrevio)}
              disabled={!mesPrevio}
              aria-label="Mes anterior"
              className="rounded-xl border border-white/10 p-2 text-zinc-400 transition hover:border-white/30 disabled:opacity-25"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p aria-live="polite" className="text-sm font-black">
              {anio ? nombreDelMes(anio, mes) : ""}
            </p>
            <button
              type="button"
              onClick={() => mesSiguiente && irAlMes(mesSiguiente)}
              disabled={!mesSiguiente}
              aria-label="Mes siguiente"
              className="rounded-xl border border-white/10 p-2 text-zinc-400 transition hover:border-white/30 disabled:opacity-25"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center">
            {DIAS_CORTOS.map((d) => (
              <span key={d} className="py-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                {d}
              </span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1" onKeyDown={onTeclaGrilla}>
            {celdas.map((f, i) => {
              if (!f) return <span key={`v${i}`} aria-hidden="true" />;
              const libre = disponibles.has(f);
              const elegida = f === valor;
              return (
                <button
                  key={f}
                  type="button"
                  data-fecha={f}
                  disabled={!libre}
                  tabIndex={f === (foco || valor) ? 0 : -1}
                  aria-current={elegida ? "date" : undefined}
                  aria-label={etiquetaLarga(f)}
                  onClick={() => elegir(f)}
                  className={`aspect-square rounded-xl text-sm font-bold transition ${
                    elegida
                      ? "bg-red-600 text-white"
                      : libre
                        ? "text-zinc-200 hover:bg-white/10"
                        // Apagada de verdad: ni se puede tocar ni recibe foco.
                        : "cursor-not-allowed text-zinc-700"
                  }`}
                >
                  {partes(f).d}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] leading-5 text-zinc-500">
            Solo se pueden elegir los días en los que hay turnos con mensualidad.
          </p>
        </div>
      )}
    </div>
  );
}

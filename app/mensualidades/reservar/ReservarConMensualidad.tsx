"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import SelectorFecha from "./SelectorFecha";

// Pantalla de reserva con saldo (Bloque M5A).
//
// NO define horarios, fechas, duraciones ni disponibilidad: todo eso llega de
// /api/mensualidades/disponibilidad, que a su vez usa la fuente única de M6. Si
// mañana cambia el calendario, esta pantalla no se toca.
//
// Tampoco manda datos del titular: el servidor los saca de la billetera.

type Horario = { hora: string; simuladores: string[] };

type Disponibilidad = {
  fecha: string;
  duracion: number;
  duraciones: number[];
  fechas: string[];
  simuladores_min: number;
  simuladores_max: number;
  horarios: Horario[];
};

type Confirmada = {
  referencia: string;
  fecha: string;
  hora: string;
  duracion: number;
  simuladores: string[];
  minutos_consumidos: number;
  saldo_restante: number;
};

function fechaLarga(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const txt = new Intl.DateTimeFormat("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  }).format(new Date(y, m - 1, d));
  // Solo la primera letra: `capitalize` de Tailwind convertiría "8 de septiembre"
  // en "8 De Septiembre".
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function minutosATexto(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

// Una clave por INTENTO LÓGICO: mientras la selección no cambie es la misma, así
// un doble clic devuelve la reserva ya creada en vez de crear otra.
function nuevaClave() {
  const v = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`;
  return v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40).padEnd(20, "0");
}

const CAJA = "rounded-[26px] border border-white/10 bg-[#0b0b0d] p-6 md:p-8";
const ROTULO = "text-xs font-black uppercase tracking-[0.14em] text-zinc-500";

export default function ReservarConMensualidad({
  saldoInicial,
  venceEl,
  condiciones,
}: {
  saldoInicial: number;
  venceEl: string;
  condiciones: string[];
}) {
  const [disp, setDisp] = useState<Disponibilidad | null>(null);
  // (M8B.2.1) La lista de fechas se guarda APARTE de la disponibilidad del día
  // elegido. Antes vivían juntas, así que un error en una fecha borraba el
  // selector entero y dejaba a la persona sin forma de elegir otra.
  const [fechas, setFechas] = useState<string[]>([]);
  const [fecha, setFecha] = useState("");
  const [duracion, setDuracion] = useState(15);
  const [hora, setHora] = useState("");
  const [sims, setSims] = useState<string[]>([]);
  const [acepto, setAcepto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faltan, setFaltan] = useState<number | null>(null);
  const [confirmada, setConfirmada] = useState<Confirmada | null>(null);
  const [saldo, setSaldo] = useState(saldoInicial);

  const cargar = useCallback(async (f: string, d: number) => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ duracion: String(d) });
      if (f) qs.set("fecha", f);
      const res = await fetch(`/api/mensualidades/disponibilidad?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        // Solo se pierde la disponibilidad de ESA fecha. La lista de fechas se
        // conserva para poder elegir otra: sin ella no habría cómo recuperarse.
        setDisp(null);
        setError("No pudimos cargar esa fecha. Probá con otro día.");
        return;
      }
      const data = (await res.json()) as Disponibilidad;
      setDisp(data);
      setFechas(data.fechas);
      // La fecha vigente es la que confirma el SERVIDOR, no la que pidió el
      // navegador: en la primera carga es la que él eligió.
      setFecha(data.fecha);
      // Si el horario elegido ya no está, se limpia la selección de abajo.
      setHora((prev) => (data.horarios.some((h) => h.hora === prev) ? prev : ""));
      setSims([]);
    } catch {
      setError("No pudimos cargar la disponibilidad. Probá de nuevo.");
    } finally {
      setCargando(false);
    }
  }, []);

  // (M8B.2.1) Primera carga SIN fecha: el servidor elige la primera operativa y
  // devuelve la ventana completa.
  //
  // Antes el navegador calculaba "mañana" y lo mandaba, dando por sentado que
  // mañana siempre era un día operativo. Dejó de ser cierto en M5C.1, cuando
  // Mensualidades pasó a lunes–viernes: abierta un viernes pedía sábado y
  // abierta un sábado pedía domingo, la API los rechazaba con 400 —bien— y la
  // pantalla se quedaba sin fechas y sin salida.
  //
  // El calendario lo decide el servidor, que es donde viven las reglas. El
  // cliente ya no calcula ninguna fecha, así que tampoco puede equivocarse por
  // la zona horaria ni por el reloj del visitante.
  useEffect(() => {
    void cargar("", 15);
  }, [cargar]);

  const libresDelHorario = useMemo(
    () => disp?.horarios.find((h) => h.hora === hora)?.simuladores ?? [],
    [disp, hora],
  );

  // Los límites llegan del servidor. El fallback solo cubre el instante previo a
  // la primera respuesta, cuando todavía no hay nada elegido.
  // (M8C) El fallback pasa de 2 a 1: si se quedaba en 2, durante ese instante la
  // pantalla pedía dos simuladores para algo que el servidor ya acepta con uno.
  const minSims = disp?.simuladores_min ?? 1;
  const maxSims = disp?.simuladores_max ?? 4;

  const minutos = duracion * sims.length;
  const alcanza = minutos > 0 && minutos <= saldo;
  const listo = Boolean(fecha && hora && sims.length >= minSims && acepto && alcanza);

  // La clave se recalcula cuando cambia la selección, no en cada click.
  const clave = useMemo(
    () => nuevaClave(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fecha, hora, duracion, sims.join("|")],
  );

  async function cambiarFecha(f: string) {
    setFecha(f);
    await cargar(f, duracion);
  }

  async function cambiarDuracion(d: number) {
    setDuracion(d);
    await cargar(fecha, d);
  }

  function alternarSim(s: string) {
    setSims((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : prev.length >= maxSims ? prev : [...prev, s],
    );
  }

  async function confirmar() {
    if (!listo || enviando) return;
    setEnviando(true);
    setError(null);
    setFaltan(null);
    try {
      const res = await fetch("/api/mensualidades/reservar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fecha, hora, duracion_minutos: duracion, simuladores: sims,
          acepto_condiciones: true, idempotency_key: clave,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setConfirmada(data as Confirmada);
        setSaldo(Number((data as Confirmada).saldo_restante) || 0);
        return;
      }
      if (res.status === 409) {
        // La disponibilidad cambió: se refresca y RECIÉN DESPUÉS se avisa.
        // Al revés no sirve: cargar() limpia el error al arrancar y el titular
        // se quedaría mirando una lista que cambió sola, sin explicación.
        await cargar(fecha, duracion);
        setError(String(data.error ?? "Ese turno ya no está disponible."));
        return;
      }
      if (typeof data.minutos_faltantes === "number") {
        setFaltan(data.minutos_faltantes);
        if (typeof data.saldo_minutos === "number") setSaldo(data.saldo_minutos);
      }
      setError(String(data.error ?? "No pudimos confirmar la reserva."));
    } catch {
      setError("No pudimos confirmar la reserva. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ── Confirmación ──────────────────────────────────────────────────────────
  if (confirmada) {
    return (
      <div className={CAJA}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-green-500/15 text-green-400">
            <Check className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-black md:text-3xl">Tu reserva está confirmada</h1>
        </div>

        <dl className="mt-7 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className={ROTULO}>Fecha</dt>
            <dd className="mt-1 text-lg font-black">{fechaLarga(confirmada.fecha)}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className={ROTULO}>Horario</dt>
            <dd className="mt-1 text-lg font-black">
              {confirmada.hora} · {confirmada.duracion} min
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className={ROTULO}>Simuladores</dt>
            <dd className="mt-1 text-lg font-black">{confirmada.simuladores.join(" · ")}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className={ROTULO}>Minutos utilizados</dt>
            <dd className="mt-1 text-lg font-black">{minutosATexto(confirmada.minutos_consumidos)}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className={ROTULO}>Saldo restante</dt>
            <dd className="mt-1 text-lg font-black">{minutosATexto(confirmada.saldo_restante)}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className={ROTULO}>Código de reserva</dt>
            <dd className="mt-1 font-mono text-lg font-black tracking-wider">{confirmada.referencia}</dd>
          </div>
        </dl>

        <Link
          href="/mensualidades/mi-plan"
          className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a mi mensualidad
        </Link>
      </div>
    );
  }

  // ── Selección ─────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      {/* (M8C) `min-w-0` es imprescindible: un ítem de grilla tiene
          `min-width: auto` y no puede achicarse por debajo de su contenido
          mínimo. El control de fecha, que muestra la fecha completa en una
          línea, fijaba ese mínimo en 300 px y a 320 px empujaba la tarjeta
          entera fuera de la pantalla. Como `overflow-x` está en `hidden`, no
          aparecía barra: simplemente se recortaba. Con min-w-0 la tarjeta se
          adapta y el `truncate` del control hace su trabajo. */}
      <div className={`${CAJA} min-w-0`}>
        <h1 className="text-2xl font-black md:text-3xl">Elegí tu turno</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Tenés {minutosATexto(saldo)} de saldo. Tu mensualidad vence el{" "}
          {fechaLarga(venceEl).toLocaleLowerCase("es-AR")}.
        </p>

        {/* FECHA
            (M8C) Una sola fecha a la vista. Las otras están en el calendario,
            que solo deja elegir las que mandó el servidor: `fechas` es la única
            fuente de lo que es seleccionable. */}
        <div className="mt-7">
          <SelectorFecha
            fechas={fechas}
            valor={fecha}
            etiquetaLarga={fechaLarga}
            onElegir={(f) => void cambiarFecha(f)}
            deshabilitado={enviando}
          />
        </div>

        {/* DURACIÓN */}
        <div className="mt-7">
          <p className={ROTULO}>Duración</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(disp?.duraciones ?? [15, 30, 45, 60]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => void cambiarDuracion(d)}
                className={`rounded-2xl border px-5 py-2.5 text-sm font-black transition ${
                  d === duracion
                    ? "border-red-500 bg-red-500/10 text-white"
                    : "border-white/10 text-zinc-400 hover:border-white/30"
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            Consume {duracion} minutos por cada simulador que elijas.
          </p>
        </div>

        {/* HORARIO */}
        <div className="mt-7">
          <p className={ROTULO}>Horario</p>
          {cargando ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando horarios…
            </p>
          ) : (disp?.horarios.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No quedan horarios para esa fecha y duración. Probá con otro día.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {disp?.horarios.map((h) => (
                <button
                  key={h.hora}
                  type="button"
                  onClick={() => { setHora(h.hora); setSims([]); }}
                  className={`rounded-2xl border px-2 py-2.5 text-center transition ${
                    h.hora === hora
                      ? "border-red-500 bg-red-500/10 text-white"
                      : "border-white/10 text-zinc-400 hover:border-white/30"
                  }`}
                >
                  <span className="block text-sm font-black">{h.hora}</span>
                  <span className="block text-[10px] text-zinc-500">
                    {h.simuladores.length} libre{h.simuladores.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* SIMULADORES */}
        {hora && (
          <div className="mt-7">
            <p className={ROTULO}>Simuladores</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {libresDelHorario.map((s) => {
                const elegida = sims.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => alternarSim(s)}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-black transition ${
                      elegida
                        ? "border-red-500 bg-red-500/10 text-white"
                        : "border-white/10 text-zinc-300 hover:border-white/30"
                    }`}
                  >
                    {s}
                    {elegida && <Check className="h-4 w-4 text-red-400" />}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-zinc-600">
              Elegí entre {minSims} y {maxSims} simuladores. Solo aparecen los libres durante todo el turno.
              {" "}Cada uno consume {duracion} minutos.
            </p>
          </div>
        )}
      </div>

      {/* RESUMEN */}
      <aside className={`${CAJA} h-fit lg:sticky lg:top-6`}>
        <h2 className="text-lg font-black">Resumen</h2>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Fecha</dt>
            <dd className="text-right font-bold">{fecha ? fechaLarga(fecha) : "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Horario</dt>
            <dd className="font-bold">{hora || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Duración</dt>
            <dd className="font-bold">{duracion} min</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Simuladores</dt>
            <dd className="text-right font-bold">{sims.length ? sims.join(", ") : "—"}</dd>
          </div>
        </dl>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className={ROTULO}>Consumo</p>
          <p className="mt-1 text-2xl font-black">
            {minutos > 0 ? minutosATexto(minutos) : "—"}
          </p>
          {/* (M8C) Con el mínimo en 1 el singular existe de verdad: "1
              simuladores" se leería mal, y el aviso de "elegí al menos 1
              simuladores" peor todavía. */}
          <p className="mt-1 text-xs text-zinc-500">
            {sims.length >= minSims
              ? `${duracion} min x ${sims.length} ${sims.length === 1 ? "simulador" : "simuladores"}`
              : minSims === 1
                ? "Elegí al menos un simulador"
                : `Elegí al menos ${minSims} simuladores`}
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            Saldo actual: <span className="font-bold text-zinc-300">{minutosATexto(saldo)}</span>
          </p>
        </div>

        {/* CONDICIONES · nunca premarcada */}
        <label className="mt-4 flex cursor-pointer gap-3 rounded-2xl border border-white/10 p-4 text-xs leading-relaxed text-zinc-400">
          <input
            type="checkbox"
            checked={acepto}
            onChange={(e) => setAcepto(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
          />
          <span>
            <span className="block font-black uppercase tracking-[0.14em] text-zinc-300">
              Condiciones
            </span>
            <span className="mt-2 block space-y-1">
              {condiciones.map((c) => (
                <span key={c} className="block">· {c}</span>
              ))}
            </span>
          </span>
        </label>

        {/* (M5B.1) El saldo se usa entero o no se usa. No hay consumo parcial ni
            pago de diferencia: si no alcanza, las dos salidas son renovar o
            pagar el turno completo en Reservas normales. Cada una es una
            operación independiente, así que NO se arrastra la selección. */}
        {minutos > 0 && !alcanza && (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
            <p className="flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Tu saldo no alcanza para esta reserva. Podés renovar tu mensualidad
                o hacer una reserva normal.
                <span className="mt-2 block text-amber-300/80">
                  Esta selección necesita {minutosATexto(minutos)} y tenés {minutosATexto(saldo)}
                  {faltan !== null ? <>: te faltan {minutosATexto(faltan)}</> : null}.
                  También podés elegir menos simuladores o una duración más corta.
                </span>
              </span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/mensualidades"
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500/20 px-4 py-2.5 font-black uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-500/30"
              >
                Renovar mensualidad
              </Link>
              <Link
                href="/reservas"
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 px-4 py-2.5 font-black uppercase tracking-[0.14em] text-amber-200 transition hover:border-amber-400/60"
              >
                Hacer una reserva normal
              </Link>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={!listo || enviando}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {enviando ? "Confirmando…" : "Confirmar reserva"}
        </button>

        <div className="mt-3 flex items-center justify-between gap-3">
          <Link href="/mensualidades/mi-plan" className="text-xs text-zinc-500 underline-offset-4 hover:underline">
            Volver a mi mensualidad
          </Link>
          <button
            type="button"
            onClick={() => void cargar(fecha, duracion)}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 underline-offset-4 hover:underline"
          >
            <RefreshCw className="h-3 w-3" />
            Actualizar
          </button>
        </div>
      </aside>
    </div>
  );
}

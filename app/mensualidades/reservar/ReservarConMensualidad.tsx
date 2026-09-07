"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, RefreshCw, AlertTriangle } from "lucide-react";

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

// (M5B) Cotización de la diferencia: la calcula y la firma el servidor con los
// precios vigentes de esa fecha. Acá solo se muestra.
type Cotizacion = {
  minutos_requeridos: number;
  minutos_saldo: number;
  minutos_faltantes: number;
  bloques_30: number;
  bloques_15: number;
  precio_15: number;
  precio_30: number;
  importe: number;
};

/** Minutos que dura la retención mientras el titular paga. Igual que el TTL de
 *  una reserva normal pendiente; solo se usa para el texto. */
const RETENCION_MIN = 15;

function pesos(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(n);
}

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
  const [fecha, setFecha] = useState("");
  const [duracion, setDuracion] = useState(15);
  const [hora, setHora] = useState("");
  const [sims, setSims] = useState<string[]>([]);
  const [acepto, setAcepto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faltan, setFaltan] = useState<number | null>(null);
  // (M5B) Cotización de la diferencia. Solo se llena cuando el saldo alcanza
  // para una parte: con saldo 0 no hay pago mixto.
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);
  const [pagando, setPagando] = useState(false);
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
        // Sin fecha todavía no se puede pedir: la primera carga usa la de mañana.
        setDisp(null);
        setError("No pudimos cargar la disponibilidad. Probá de nuevo.");
        return;
      }
      const data = (await res.json()) as Disponibilidad;
      setDisp(data);
      // Si el horario elegido ya no está, se limpia la selección de abajo.
      setHora((prev) => (data.horarios.some((h) => h.hora === prev) ? prev : ""));
      setSims([]);
    } catch {
      setError("No pudimos cargar la disponibilidad. Probá de nuevo.");
    } finally {
      setCargando(false);
    }
  }, []);

  // Primera carga: se pide mañana, que es la primera fecha pública. El servidor
  // devuelve la ventana completa y con eso se arma el selector.
  useEffect(() => {
    const manana = new Date(Date.now() + 86_400_000);
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Cordoba",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(manana);
    setFecha(iso);
    void cargar(iso, 15);
  }, [cargar]);

  const libresDelHorario = useMemo(
    () => disp?.horarios.find((h) => h.hora === hora)?.simuladores ?? [],
    [disp, hora],
  );

  const minutos = duracion * sims.length;
  const alcanza = minutos > 0 && minutos <= saldo;
  // (M5B) Con saldo parcial el botón SÍ se habilita: al confirmar, el servidor
  // devuelve la cotización de la diferencia en vez de crear la reserva. Con
  // saldo 0 no, porque ese caso no tiene pago mixto.
  const listo = Boolean(fecha && hora && sims.length > 0 && acepto && (alcanza || saldo > 0));

  // La clave se recalcula cuando cambia la selección, no en cada click.
  const clave = useMemo(
    () => nuevaClave(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fecha, hora, duracion, sims.join("|")],
  );

  // (M5B) Una cotización pertenece a UNA selección: si el titular cambia
  // cualquier cosa, el importe deja de ser válido y se descarta. Nunca se
  // muestra un precio que ya no corresponde a lo que está eligiendo.
  const seleccion = `${fecha}|${hora}|${duracion}|${sims.join(",")}`;
  useEffect(() => {
    setCotizacion(null);
    setFaltan(null);
  }, [seleccion]);

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
      prev.includes(s) ? prev.filter((x) => x !== s) : prev.length >= 4 ? prev : [...prev, s],
    );
  }

  async function confirmar() {
    if (!listo || enviando) return;
    setEnviando(true);
    setError(null);
    setFaltan(null);
    setCotizacion(null);
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
      // (M5B) Si el servidor cotizó la diferencia, se muestra el desglose en vez
      // de un error seco: el titular puede pagar solo lo que falta.
      if (data.cotizacion) {
        setCotizacion(data.cotizacion as Cotizacion);
        return;
      }
      setError(String(data.error ?? "No pudimos confirmar la reserva."));
    } catch {
      setError("No pudimos confirmar la reserva. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // (M5B) Crea la retención y manda a Mercado Pago. El turno y los minutos
  // quedan tomados desde este momento, así que no hay ventana para que otro se
  // lleve el horario mientras el titular paga.
  async function pagarDiferencia() {
    if (pagando) return;
    setPagando(true);
    setError(null);
    try {
      const res = await fetch("/api/mensualidades/reservar/complemento", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fecha, hora, duracion_minutos: duracion, simuladores: sims,
          acepto_condiciones: true, idempotency_key: clave,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.init_point === "string") {
        window.location.href = data.init_point;
        return;
      }
      if (res.status === 409) {
        await cargar(fecha, duracion);
        setCotizacion(null);
        setError(String(data.error ?? "Ese turno ya no está disponible."));
        return;
      }
      setError(String(data.error ?? "No pudimos abrir el pago. Probá de nuevo."));
    } catch {
      setError("No pudimos abrir el pago. Probá de nuevo.");
    } finally {
      setPagando(false);
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
            <dt className={ROTULO}>Escuderías</dt>
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
      <div className={CAJA}>
        <h1 className="text-2xl font-black md:text-3xl">Elegí tu turno</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Tenés {minutosATexto(saldo)} de saldo. Tu mensualidad vence el{" "}
          {fechaLarga(venceEl).toLocaleLowerCase("es-AR")}.
        </p>

        {/* FECHA */}
        <div className="mt-7">
          <p className={ROTULO}>Fecha</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(disp?.fechas ?? []).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => void cambiarFecha(f)}
                className={`rounded-2xl border px-4 py-2.5 text-left text-xs font-bold transition ${
                  f === fecha
                    ? "border-red-500 bg-red-500/10 text-white"
                    : "border-white/10 text-zinc-400 hover:border-white/30"
                }`}
              >
                {fechaLarga(f)}
              </button>
            ))}
          </div>
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
            Consume {duracion} minutos por cada escudería que elijas.
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

        {/* ESCUDERÍAS */}
        {hora && (
          <div className="mt-7">
            <p className={ROTULO}>Escuderías</p>
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
              Podés elegir entre 1 y 4 escuderías. Solo aparecen las libres durante todo el turno.
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
            <dt className="text-zinc-500">Escuderías</dt>
            <dd className="text-right font-bold">{sims.length ? sims.join(", ") : "—"}</dd>
          </div>
        </dl>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className={ROTULO}>Consumo</p>
          <p className="mt-1 text-2xl font-black">
            {minutos > 0 ? minutosATexto(minutos) : "—"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {sims.length > 0
              ? `${duracion} min x ${sims.length} escudería${sims.length === 1 ? "" : "s"}`
              : "Elegí al menos una escudería"}
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

        {minutos > 0 && !alcanza && (
          <p className="mt-4 flex gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Esta selección necesita {minutosATexto(minutos)} y tenés {minutosATexto(saldo)}.
              {faltan !== null && <> Te faltan {minutosATexto(faltan)}.</>}{" "}
              {saldo > 0
                ? "Confirmá para ver cuánto costaría pagar la diferencia."
                : "Renová tu mensualidad o hacé una reserva normal."}
            </span>
          </p>
        )}

        {/* (M5B) COTIZACIÓN DE LA DIFERENCIA · el desglose completo antes de pagar */}
        {cotizacion && (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-300">
              Pagá solo la diferencia
            </p>
            <dl className="mt-3 space-y-1.5 text-xs text-zinc-300">
              <div className="flex justify-between gap-4">
                <dt>Necesitás</dt>
                <dd className="tabular-nums">{minutosATexto(cotizacion.minutos_requeridos)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Cubrís con tu mensualidad</dt>
                <dd className="tabular-nums text-green-400">{minutosATexto(cotizacion.minutos_saldo)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Te faltan</dt>
                <dd className="tabular-nums text-amber-300">{minutosATexto(cotizacion.minutos_faltantes)}</dd>
              </div>
              <div className="my-2 border-t border-white/10" />
              {cotizacion.bloques_30 > 0 && (
                <div className="flex justify-between gap-4">
                  <dt>{cotizacion.bloques_30} × bloque de 30 min</dt>
                  <dd className="tabular-nums">{pesos(cotizacion.bloques_30 * cotizacion.precio_30)}</dd>
                </div>
              )}
              {cotizacion.bloques_15 > 0 && (
                <div className="flex justify-between gap-4">
                  <dt>{cotizacion.bloques_15} × bloque de 15 min</dt>
                  <dd className="tabular-nums">{pesos(cotizacion.bloques_15 * cotizacion.precio_15)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 pt-1 text-sm font-black text-white">
                <dt>Total a pagar</dt>
                <dd className="tabular-nums">{pesos(cotizacion.importe)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              El turno queda reservado {RETENCION_MIN} minutos mientras pagás. Si no completás
              el pago, se libera y los minutos vuelven a tu mensualidad.
            </p>
            <button
              type="button"
              onClick={() => void pagarDiferencia()}
              disabled={pagando}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pagando ? "Abriendo el pago…" : `Pagar ${pesos(cotizacion.importe)}`}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300">
            {error}
          </p>
        )}

        {/* Con la cotización a la vista el botón de arriba ya no aplica: el paso
            siguiente es pagar, no confirmar. */}
        {!cotizacion && (
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={!listo || enviando}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {enviando
              ? (alcanza ? "Confirmando…" : "Calculando…")
              : (alcanza ? "Confirmar reserva" : "Ver cuánto falta pagar")}
          </button>
        )}

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

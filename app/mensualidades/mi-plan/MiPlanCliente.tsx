"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check, LogOut, ShoppingCart, CalendarPlus, CalendarClock, XCircle } from "lucide-react";
import type { MiPlan, HistorialReservas, ReservaDeMiPlan } from "@/lib/mensualidadesMiPlan";

// Parte interactiva de "Mi mensualidad" (Bloque M4): copiar el código y cerrar
// sesión. Los datos ya vienen resueltos del servidor: acá no se consulta nada.

function fechaLarga(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(y, m - 1, d));
}

function fechaCorta(iso: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(iso));
}

const ESTILO_ESTADO: Record<MiPlan["estado"], { chip: string; titulo: string; texto: string }> = {
  vigente: {
    chip: "border-green-500/40 bg-green-500/10 text-green-400",
    titulo: "Tu mensualidad está activa",
    texto: "Podés usar tu saldo reservando turnos desde la web.",
  },
  agotada: {
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    titulo: "Te quedaste sin minutos",
    texto: "Tu mensualidad sigue vigente, pero ya usaste todo el saldo. Podés renovarla cuando quieras.",
  },
  vencida: {
    chip: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
    titulo: "Tu mensualidad venció",
    texto: "El saldo que no se usó antes del vencimiento no se recupera. Podés comprar una nueva.",
  },
  bloqueada: {
    chip: "border-red-500/40 bg-red-500/10 text-red-400",
    titulo: "Tu mensualidad requiere revisión",
    texto: "Escribinos y lo resolvemos. Mientras tanto no vas a poder reservar.",
  },
};

function minutosATexto(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

// (M5A) Una reserva de la mensualidad. Solo lo que el titular necesita
// reconocer: nada de ids internos, importes ni datos de contacto.
// (M5C) Clave de idempotencia por INTENTO LÓGICO: se genera una vez cuando el
// titular abre el panel, no en cada clic. Así un doble clic manda la misma clave
// y el servidor lo resuelve como reintento en vez de como dos operaciones.
function nuevaClave() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Horario = { hora: string; simuladores: string[] };

/**
 * (M5C) Acciones sobre UNA reserva futura. El servidor ya dijo en el DTO qué se
 * puede hacer y qué pasa con los minutos: acá no se recalcula la regla de 24 h,
 * solo se muestra. La RPC vuelve a comprobarlo todo al confirmar.
 */
function FilaReserva({ r, gestionable }: { r: ReservaDeMiPlan; gestionable?: boolean }) {
  const router = useRouter();
  const [panel, setPanel] = useState<null | "cancelar" | "reprogramar">(null);
  const [clave, setClave] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reprogramación: fechas y horarios REALES, traídos del servidor.
  const [fechas, setFechas] = useState<string[]>([]);
  const [fecha, setFecha] = useState("");
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [hora, setHora] = useState("");
  const [cargando, setCargando] = useState(false);

  function abrir(cual: "cancelar" | "reprogramar") {
    setError(null);
    setClave(nuevaClave());
    setPanel(cual);
  }

  const cargarDia = useCallback(async (f: string) => {
    setCargando(true);
    setHora("");
    try {
      const res = await fetch(
        `/api/mensualidades/disponibilidad?fecha=${encodeURIComponent(f)}&duracion=${r.duracion}`,
        { cache: "no-store" },
      );
      if (!res.ok) { setHorarios([]); return; }
      const data = await res.json();
      if (Array.isArray(data.fechas) && fechas.length === 0) setFechas(data.fechas);
      // Solo sirven los horarios donde están libres TODOS los simuladores de esta
      // reserva: al reprogramar no se pueden cambiar.
      const libres = (data.horarios as Horario[] | undefined) ?? [];
      setHorarios(libres.filter((h) => r.simuladores.every((s) => h.simuladores.includes(s))));
    } catch {
      setHorarios([]);
    } finally {
      setCargando(false);
    }
  }, [r.duracion, r.simuladores, fechas.length]);

  useEffect(() => {
    if (panel !== "reprogramar") return;
    // UNA sola consulta al abrir: la respuesta ya trae la ventana de fechas Y
    // los horarios del día pedido. Pedirlo dos veces (una para las fechas y otra
    // para el día) duplicaba el viaje y dejaba una carrera en la que la segunda
    // respuesta podía pisar a la primera.
    let vivo = true;
    setCargando(true);
    void (async () => {
      try {
        const pedir = (f: string) => fetch(
          `/api/mensualidades/disponibilidad?duracion=${r.duracion}` +
            (f ? `&fecha=${encodeURIComponent(f)}` : ""),
          { cache: "no-store" },
        );
        // Abre en el día de la reserva. Si ese día hoy no opera (una reserva
        // vieja que cayó un fin de semana), se pide sin fecha y el servidor
        // contesta el primer día operativo: igual se puede reprogramar.
        let res = await pedir(r.fecha);
        if (!res.ok) res = await pedir("");
        if (!vivo) return;
        if (!res.ok) { setHorarios([]); return; }
        const data = await res.json();
        if (!vivo) return;
        const disponibles: string[] = Array.isArray(data.fechas) ? data.fechas : [];
        setFechas(disponibles);
        setFecha(String(data.fecha ?? r.fecha));
        const libres = (data.horarios as Horario[] | undefined) ?? [];
        setHorarios(libres.filter((h) => r.simuladores.every((s) => h.simuladores.includes(s))));
      } catch {
        if (vivo) setHorarios([]);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    // Si el titular cierra el panel mientras viaja la respuesta, se descarta.
    return () => { vivo = false; };
    // Solo al abrir el panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  async function enviar(url: string, body: Record<string, unknown>) {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, referencia: r.referencia, idempotency_key: clave }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data?.error ?? "No pudimos completar la operación."));
        return;
      }
      setPanel(null);
      // El saldo y el listado se actualizan solos: no hace falta recargar a mano.
      router.refresh();
    } catch {
      setError("No pudimos conectarnos. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  const acciones = gestionable && (r.puede_cancelar || r.puede_reprogramar);

  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-black">
          {fechaLarga(r.fecha)} · {r.hora}
        </span>
        <span className="text-xs text-zinc-500">
          {r.duracion} min · {r.simuladores.length} {r.simuladores.length === 1 ? "simulador" : "simuladores"}
          {" · "}{minutosATexto(r.minutos_consumidos)}
        </span>
        <span className="w-full text-xs text-zinc-500">{r.simuladores.join(", ")}</span>
        <span className="w-full font-mono text-[11px] tracking-wider text-zinc-600">
          {r.referencia} · {r.estado}
          {r.cancelacion_resultado === "restituida" && " · minutos devueltos"}
          {r.cancelacion_resultado === "sin_restitucion" && " · sin devolución"}
        </span>
      </div>

      {acciones && panel === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.puede_reprogramar && (
            <button
              type="button"
              onClick={() => abrir("reprogramar")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition hover:border-white/40"
            >
              <CalendarClock className="h-3.5 w-3.5" /> Reprogramar
            </button>
          )}
          {r.puede_cancelar && (
            <button
              type="button"
              onClick={() => abrir("cancelar")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-red-300 transition hover:border-red-400/60"
            >
              <XCircle className="h-3.5 w-3.5" /> Cancelar
            </button>
          )}
          {!r.puede_reprogramar && r.puede_cancelar && (
            <span className="self-center text-[11px] text-zinc-600">
              Ya no se puede reprogramar: faltan menos de 24 horas.
            </span>
          )}
        </div>
      )}

      {/* ── Confirmación de cancelación, con el resultado CONCRETO ── */}
      {panel === "cancelar" && (
        <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-3">
          <p className="text-xs text-red-200">
            {r.restituye_minutos ? (
              <>Se cancelará el turno y <strong>se restituirán {minutosATexto(r.minutos_a_restituir)}</strong> a tu mensualidad.</>
            ) : (
              <>Se liberará la reserva, pero <strong>no se devolverán los {minutosATexto(r.minutos_consumidos)} utilizados</strong>, porque faltan menos de 24 horas.</>
            )}
          </p>
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={enviando}
              onClick={() => void enviar("/api/mensualidades/reservas/cancelar", {})}
              className="rounded-xl bg-red-600 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:opacity-40"
            >
              {enviando ? "Cancelando…" : "Sí, cancelar"}
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => setPanel(null)}
              className="rounded-xl border border-white/15 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition hover:border-white/40 disabled:opacity-40"
            >
              Volver
            </button>
          </div>
        </div>
      )}

      {/* ── Reprogramar: solo fechas y horarios realmente disponibles ── */}
      {panel === "reprogramar" && (
        <div className="mt-3 rounded-xl border border-white/15 bg-white/[0.02] p-3">
          <p className="text-xs text-zinc-400">
            Se mantienen la duración ({r.duracion} min) y los simuladores ({r.simuladores.join(", ")}).
            Solo cambiás el día y el horario; no se consume saldo adicional.
          </p>

          <label className="mt-3 block text-[11px] font-black uppercase tracking-[0.14em] text-zinc-400">
            Fecha
            <select
              value={fecha}
              onChange={(e) => { setFecha(e.target.value); void cargarDia(e.target.value); }}
              className="mt-1 block w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm font-normal normal-case tracking-normal text-white"
            >
              {fechas.map((f) => <option key={f} value={f}>{fechaLarga(f)}</option>)}
            </select>
          </label>

          <div className="mt-3">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-400">Horario</span>
            {cargando ? (
              <p className="mt-2 text-xs text-zinc-500">Buscando horarios…</p>
            ) : horarios.length === 0 ? (
              <p className="mt-2 text-xs text-amber-300">
                Ese día no hay horarios con tus {r.simuladores.length === 1 ? "simulador" : "simuladores"} libres. Probá otra fecha.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {horarios.map((h) => (
                  <button
                    key={h.hora}
                    type="button"
                    onClick={() => setHora(h.hora)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                      hora === h.hora
                        ? "border-red-500 bg-red-600/20 font-black text-white"
                        : "border-white/15 text-zinc-300 hover:border-white/40"
                    }`}
                  >
                    {h.hora}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={enviando || !fecha || !hora}
              onClick={() => void enviar("/api/mensualidades/reservas/reprogramar", { fecha, hora })}
              className="rounded-xl bg-red-600 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando ? "Reprogramando…" : "Confirmar cambio"}
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => setPanel(null)}
              className="rounded-xl border border-white/15 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition hover:border-white/40 disabled:opacity-40"
            >
              Volver
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function MiPlanCliente({
  plan,
  reservas,
  ventasActivas = true,
}: {
  plan: MiPlan;
  reservas?: HistorialReservas;
  /** (M8A) Con las ventas pausadas no se puede renovar, pero todo lo demás sí. */
  ventasActivas?: boolean;
}) {
  const router = useRouter();
  const [copiado, setCopiado] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const estilo = ESTILO_ESTADO[plan.estado];
  const vencida = plan.estado === "vencida";

  async function copiar() {
    try {
      await navigator.clipboard.writeText(plan.codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* si el navegador lo bloquea, el código está a la vista igual */
    }
  }

  async function cerrarSesion() {
    setSaliendo(true);
    try {
      await fetch("/api/mensualidades/sesion", { method: "DELETE" });
    } catch {
      /* la cookie igual se borra del lado del servidor en el próximo uso */
    }
    router.push("/mensualidades");
    router.refresh();
  }

  const caja = "rounded-[26px] border border-white/10 bg-[#0b0b0d] p-6 md:p-8";

  return (
    <>
      <div className={caja}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-400">Hola, {plan.nombre}</p>
            <h1 className="mt-1 text-3xl font-black uppercase leading-tight md:text-4xl">
              {estilo.titulo}
            </h1>
          </div>
          <span className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] ${estilo.chip}`}>
            {plan.estado}
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-zinc-400">{estilo.texto}</p>

        {/* ── Código ── */}
        <div className="mt-7 rounded-2xl border border-red-600/40 bg-red-950/20 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-400">Tu código</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="font-mono text-3xl font-black tracking-wider md:text-4xl">{plan.codigo}</p>
            <button
              type="button"
              onClick={copiar}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] transition hover:border-white/50"
            >
              {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>

        {/* ── Datos ── */}
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
              {vencida ? "Saldo vencido" : "Saldo disponible"}
            </dt>
            <dd className={`mt-1 text-2xl font-black ${vencida ? "text-zinc-500 line-through" : "text-red-400"}`}>
              {plan.saldo_texto}
            </dd>
            <dd className="mt-0.5 text-xs text-zinc-500">
              {plan.saldo_minutos} minutos{vencida ? " · ya no se pueden usar" : ""}
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
              {vencida ? "Venció el" : "Vence"}
            </dt>
            <dd className="mt-1 text-lg font-black">{fechaLarga(plan.vence_el)}</dd>
            {!vencida && (
              <dd className="mt-0.5 text-xs text-zinc-500">
                {plan.dias_restantes === 0 ? "Último día" : `Quedan ${plan.dias_restantes} días`}
              </dd>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Último plan</dt>
            <dd className="mt-1 text-lg font-black">{plan.ultimo_plan ?? "—"}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Última compra</dt>
            <dd className="mt-1 text-lg font-black">
              {plan.ultima_compra_at ? fechaCorta(plan.ultima_compra_at) : "—"}
            </dd>
          </div>
        </dl>

        {/* (M5A) Reservar con saldo. El CTA solo aparece si la mensualidad está
            vigente y con minutos; la ruta igual vuelve a comprobarlo. */}
        {plan.puede_reservar ? (
          <Link
            href="/mensualidades/reservar"
            className="mt-7 flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-4 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
          >
            <CalendarPlus className="h-4 w-4" />
            Reservar con mi mensualidad
          </Link>
        ) : plan.motivo === "sin_saldo" ? (
          /* (M5B.1) Vigente pero sin minutos. No se ofrece pagar una diferencia
             desde Mensualidades: se renueva (botón de abajo) o se paga el turno
             completo en Reservas normales. */
          <div className="mt-7 rounded-2xl border border-dashed border-white/15 px-5 py-4 text-sm text-zinc-400">
            <p className="font-semibold text-zinc-300">No te quedan minutos disponibles.</p>
            <p className="mt-1 text-zinc-500">
              Renová tu mensualidad para seguir reservando desde acá, o hacé una
              reserva normal y pagá ese turno completo.
            </p>
            <Link
              href="/reservas"
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-zinc-300 transition hover:border-white/40"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Hacer una reserva normal
            </Link>
          </div>
        ) : (
          <div className="mt-7 rounded-2xl border border-dashed border-white/15 px-5 py-4 text-sm text-zinc-500">
            Cuando tu mensualidad esté activa y con saldo vas a poder reservar desde acá.
          </div>
        )}

        {/* (M8A) Renovación pausada: el botón no desaparece —se explica—, así
            quien entra entiende qué pasa en vez de buscar una opción que no ve. */}
        {!ventasActivas && (
          <p
            role="status"
            className="mt-7 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4 text-sm leading-6 text-zinc-300"
          >
            <span className="font-black uppercase tracking-[0.14em] text-amber-300">
              Renovación pausada
            </span>
            <br />
            Las compras y renovaciones están temporalmente pausadas. Tu saldo, tus
            reservas y tu vigencia no cambian: podés seguir reservando, cancelando y
            reprogramando con normalidad.
          </p>
        )}

        <div className="mt-7 flex flex-wrap gap-3">
          {ventasActivas ? (
          <Link
            href="/mensualidades"
            className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
          >
            <ShoppingCart className="h-4 w-4" />
            {vencida ? "Comprar mensualidad" : "Renovar mensualidad"}
          </Link>
          ) : (
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white/30"
          >
            <ShoppingCart className="h-4 w-4" />
            {vencida ? "Comprar mensualidad" : "Renovar mensualidad"}
          </span>
          )}
          <button
            type="button"
            onClick={cerrarSesion}
            disabled={saliendo}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] transition hover:border-white/40 disabled:opacity-40"
          >
            <LogOut className="h-4 w-4" />
            {saliendo ? "Cerrando..." : "Cerrar sesión"}
          </button>
        </div>
      </div>

      {/* (M5C) Historial. Las próximas se pueden cancelar y reprogramar. */}
      {(reservas?.proximas.length || reservas?.anteriores.length) ? (
        <div className={`${caja} mt-5`}>
          {reservas.proximas.length > 0 && (
            <>
              <h2 className="text-lg font-black">Próximas reservas</h2>
              <ul className="mt-3 space-y-2">
                {reservas.proximas.map((r) => <FilaReserva key={r.referencia} r={r} gestionable />)}
              </ul>
            </>
          )}
          {reservas.anteriores.length > 0 && (
            <>
              <h2 className={`text-lg font-black ${reservas.proximas.length > 0 ? "mt-7" : ""}`}>
                Reservas anteriores
              </h2>
              <ul className="mt-3 space-y-2">
                {reservas.anteriores.map((r) => <FilaReserva key={r.referencia} r={r} />)}
              </ul>
              {reservas.hay_mas_anteriores && (
                <p className="mt-3 text-xs text-zinc-600">
                  Se muestran las más recientes.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}

      <p className="mt-5 text-center text-xs text-zinc-600">
        Tu sesión se cierra sola a los 30 minutos.
      </p>
    </>
  );
}

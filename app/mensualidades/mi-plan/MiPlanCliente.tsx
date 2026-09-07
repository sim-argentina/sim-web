"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check, LogOut, ShoppingCart, CalendarPlus } from "lucide-react";
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
function pesos(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(n);
}

function FilaReserva({ r }: { r: ReservaDeMiPlan }) {
  // (M5B) Una mixta esperando el pago NO puede parecer confirmada.
  const pendiente = r.estado === "pendiente_pago";
  const vencida = r.estado === "cancelada";
  return (
    <li
      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl border px-4 py-3 ${
        pendiente
          ? "border-amber-500/30 bg-amber-500/[0.06]"
          : vencida
            ? "border-white/5 bg-white/[0.01] opacity-60"
            : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <span className="text-sm font-black">
        {fechaLarga(r.fecha)} · {r.hora}
      </span>
      <span className="text-xs text-zinc-500">
        {r.duracion} min · {r.simuladores.join(", ")} · {minutosATexto(r.minutos_consumidos)}
      </span>
      {r.cobertura === "mixta" && (
        <span className={`w-full text-xs ${pendiente ? "text-amber-300" : "text-zinc-400"}`}>
          {pendiente
            ? `Falta pagar ${pesos(r.importe_complementario)} para confirmarla`
            : vencida
              ? `No se completó el pago de ${pesos(r.importe_complementario)}; los minutos volvieron a tu saldo`
              : `Diferencia abonada: ${pesos(r.importe_complementario)}`}
        </span>
      )}
      <span className="w-full font-mono text-[11px] tracking-wider text-zinc-600">
        {r.referencia} ·{" "}
        {pendiente ? "pendiente de pago" : vencida ? "no confirmada" : "confirmada"}
      </span>
    </li>
  );
}

export default function MiPlanCliente({
  plan,
  reservas,
}: {
  plan: MiPlan;
  reservas?: HistorialReservas;
}) {
  const router = useRouter();
  const [copiado, setCopiado] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const vencida = plan.estado === "vencida";
  // (M5B) Con una retención viva el saldo está en 0 porque los minutos están
  // COMPROMETIDOS, no gastados. Mostrar "te quedaste sin minutos" ahí sería
  // falso, y peor: invita a renovar, que es justo lo que el guard bloquea.
  const comprometida = plan.tiene_pago_pendiente;
  const estilo = comprometida && plan.estado === "agotada"
    ? {
        chip: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        titulo: "Tenés minutos reservados",
        texto: "Tu saldo está tomado por una reserva que espera el pago. Cuando se confirme o se libere, vas a poder seguir usando la mensualidad.",
      }
    : ESTILO_ESTADO[plan.estado];

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
        ) : (
          <div className="mt-7 rounded-2xl border border-dashed border-white/15 px-5 py-4 text-sm text-zinc-500">
            Cuando tu mensualidad esté activa y con saldo vas a poder reservar desde acá.
          </div>
        )}

        <div className="mt-7 flex flex-wrap gap-3">
          {/* (M5B) Con una retención viva no se puede renovar: el servidor lo
              rechaza para no romper el tope de traslado. Se muestra deshabilitado
              y explicado, en vez de mandar al titular a un error. */}
          {comprometida ? (
            <span
              title="Primero terminá o dejá vencer el pago pendiente"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-2xl border border-white/15 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-zinc-600"
            >
              <ShoppingCart className="h-4 w-4" />
              Renovar mensualidad
            </span>
          ) : (
            <Link
              href="/mensualidades"
              className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
            >
              <ShoppingCart className="h-4 w-4" />
              {vencida ? "Comprar mensualidad" : "Renovar mensualidad"}
            </Link>
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

      {/* (M5B) Minutos comprometidos por una reserva esperando el pago. Sin esto
          el titular vería su saldo en 0 sin ninguna explicación. */}
      {plan.tiene_pago_pendiente && (
        <div className="mt-5 rounded-[26px] border border-amber-500/30 bg-amber-500/[0.07] p-5 md:p-6">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-300">
            Tenés una reserva esperando el pago
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            {minutosATexto(plan.minutos_comprometidos)} de tu mensualidad están reservados
            para ese turno. Si no completás el pago a tiempo, el turno se libera y los
            minutos vuelven a tu saldo.
          </p>
        </div>
      )}

      {/* (M5A) Historial. Todavía sin botones de cancelar ni reprogramar. */}
      {(reservas?.proximas.length || reservas?.anteriores.length) ? (
        <div className={`${caja} mt-5`}>
          {reservas.proximas.length > 0 && (
            <>
              <h2 className="text-lg font-black">Próximas reservas</h2>
              <ul className="mt-3 space-y-2">
                {reservas.proximas.map((r) => <FilaReserva key={r.referencia} r={r} />)}
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
          {/* (M5B) Intentos que vencieron sin pagarse: fuera de las listas de
              arriba para que nadie los confunda con un turno confirmado. */}
          {reservas.vencidas.length > 0 && (
            <>
              <h2 className="mt-7 text-lg font-black text-zinc-400">Intentos no confirmados</h2>
              <p className="mt-1 text-xs text-zinc-600">
                No se completó el pago a tiempo. Los minutos ya volvieron a tu saldo.
              </p>
              <ul className="mt-3 space-y-2">
                {reservas.vencidas.map((r) => <FilaReserva key={r.referencia} r={r} />)}
              </ul>
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

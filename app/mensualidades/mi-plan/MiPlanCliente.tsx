"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check, LogOut, ShoppingCart } from "lucide-react";
import type { MiPlan } from "@/lib/mensualidadesMiPlan";

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

export default function MiPlanCliente({ plan }: { plan: MiPlan }) {
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

        {/* Lugar reservado para el botón de reservar, que llega en M5. */}
        <div className="mt-7 rounded-2xl border border-dashed border-white/15 px-5 py-4 text-sm text-zinc-500">
          {plan.puede_reservar
            ? "Muy pronto vas a poder reservar tus turnos desde acá."
            : "Cuando tu mensualidad esté activa y con saldo vas a poder reservar desde acá."}
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/mensualidades"
            className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
          >
            <ShoppingCart className="h-4 w-4" />
            {vencida ? "Comprar mensualidad" : "Renovar mensualidad"}
          </Link>
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

      <p className="mt-5 text-center text-xs text-zinc-600">
        Tu sesión se cierra sola a los 30 minutos.
      </p>
    </>
  );
}

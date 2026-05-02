import Link from "next/link";
import { XCircle, RefreshCcw, ArrowLeft } from "lucide-react";

export default function ErrorPage() {
  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white">
      <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="mb-6 rounded-full border border-red-500/30 bg-red-500/10 p-5 text-red-400">
          <XCircle className="h-14 w-14" />
        </div>

        <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Reserva SIM
        </p>

        <h1 className="text-4xl font-black md:text-6xl">
          Pago rechazado o cancelado
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-300">
          No pudimos confirmar el pago. Puede haber sido rechazado por el medio
          de pago, cancelado durante el checkout o interrumpido antes de finalizar.
        </p>

        <div className="mt-8 rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 text-left">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
              <RefreshCcw className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-black">Qué podés hacer</h2>
              <p className="mt-2 text-zinc-400">
                Volvé a intentar la reserva con otro medio de pago. Si el
                problema continúa, consultanos por Instagram o en el stand.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/reservas"
            className="rounded-2xl bg-red-600 px-6 py-4 font-black text-white transition hover:bg-red-500"
          >
            Intentar de nuevo
          </Link>

          <Link
            href="/"
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 font-black text-white transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al inicio
          </Link>
        </div>
      </section>
    </main>
  );
}
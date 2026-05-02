import Link from "next/link";
import { Clock3, AlertCircle, ArrowRight } from "lucide-react";

export default function PendientePage() {
  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white">
      <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="mb-6 rounded-full border border-yellow-500/30 bg-yellow-500/10 p-5 text-yellow-400">
          <Clock3 className="h-14 w-14" />
        </div>

        <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Reserva SIM
        </p>

        <h1 className="text-4xl font-black md:text-6xl">
          Pago pendiente
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-300">
          El pago todavía no fue confirmado. Esto puede pasar con algunos medios
          de pago o cuando Mercado Pago necesita unos minutos para procesarlo.
        </p>

        <div className="mt-8 rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 text-left">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-yellow-500/10 p-3 text-yellow-400">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-black">No cierres el seguimiento</h2>
              <p className="mt-2 text-zinc-400">
                Cuando el pago se confirme, la reserva debería quedar validada.
                Si tarda demasiado, contactanos para revisar el estado.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/reservas"
            className="rounded-2xl bg-red-600 px-6 py-4 font-black text-white transition hover:bg-red-500"
          >
            Volver a reservas
          </Link>

          <Link
            href="/"
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 font-black text-white transition hover:bg-white/10"
          >
            Ir al inicio
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
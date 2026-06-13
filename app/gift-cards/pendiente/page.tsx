import Link from "next/link";
import { Clock, ArrowRight } from "lucide-react";

export default function GiftCardPendientePage() {
  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white">
      <section className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <div className="mb-6 rounded-full border border-yellow-500/30 bg-yellow-500/10 p-5 text-yellow-400">
          <Clock className="h-12 w-12" />
        </div>

        <p className="mb-3 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Gift Card SIM
        </p>
        <h1 className="text-4xl font-black md:text-5xl">Pago pendiente</h1>

        <p className="mt-5 max-w-lg text-lg leading-8 text-zinc-300">
          Tu pago quedó pendiente de confirmación. Cuando Mercado Pago lo
          apruebe, vas a poder descargar tu Gift Card. Si pagaste por
          transferencia o efectivo, puede demorar unos minutos.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-4 font-black text-white transition hover:bg-red-500"
          >
            Volver al inicio
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

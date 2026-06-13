import Link from "next/link";
import { XCircle, ArrowRight } from "lucide-react";

export default function GiftCardErrorPage() {
  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white">
      <section className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <div className="mb-6 rounded-full border border-red-500/30 bg-red-500/10 p-5 text-red-400">
          <XCircle className="h-12 w-12" />
        </div>

        <p className="mb-3 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Gift Card SIM
        </p>
        <h1 className="text-4xl font-black md:text-5xl">No se pudo procesar el pago</h1>

        <p className="mt-5 max-w-lg text-lg leading-8 text-zinc-300">
          El pago fue rechazado o cancelado. No se generó ninguna Gift Card.
          Podés intentar de nuevo o escribirnos por WhatsApp.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/gift-cards"
            className="rounded-2xl bg-red-600 px-6 py-4 font-black text-white transition hover:bg-red-500"
          >
            Intentar de nuevo
          </Link>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 font-black text-white transition hover:bg-white/10"
          >
            Volver al inicio
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

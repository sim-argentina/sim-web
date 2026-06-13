import Link from "next/link";
import { Flag, Gift, ArrowRight } from "lucide-react";

export default function ReservasGiftCardsPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24 lg:px-8">
        <div className="text-center">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">
            SIM Argentina
          </p>
          <h1 className="text-4xl font-black leading-tight md:text-6xl">
            ¿Qué querés hacer?
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-zinc-400">
            Reservá tu turno en los simuladores de Fórmula 1 o regalá una
            experiencia con una Gift Card.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {/* Reservar simulador */}
          <Link
            href="/reservas"
            className="group relative flex flex-col overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-red-950/40 via-zinc-950 to-zinc-900 p-8 transition hover:border-red-500/50 md:p-10"
          >
            <div className="absolute right-0 top-0 h-40 w-40 translate-x-10 -translate-y-10 rounded-full bg-red-600/10 blur-3xl transition group-hover:bg-red-600/20" />
            <div className="mb-6 inline-flex w-fit rounded-2xl bg-red-500/15 p-4 text-red-400">
              <Flag className="h-8 w-8" />
            </div>
            <h2 className="text-3xl font-black md:text-4xl">Reservar simulador</h2>
            <p className="mt-3 flex-1 text-base leading-7 text-zinc-400">
              Elegí fecha, horario y escudería. Turnos de 15 o 30 minutos en
              nuestros simuladores profesionales.
            </p>
            <span className="mt-8 inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white">
              Reservar ahora
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </span>
          </Link>

          {/* Comprar Gift Card */}
          <Link
            href="/gift-cards"
            className="group relative flex flex-col overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-zinc-900 via-zinc-950 to-red-950/40 p-8 transition hover:border-red-500/50 md:p-10"
          >
            <div className="absolute left-0 bottom-0 h-40 w-40 -translate-x-10 translate-y-10 rounded-full bg-red-600/10 blur-3xl transition group-hover:bg-red-600/20" />
            <div className="mb-6 inline-flex w-fit rounded-2xl bg-red-500/15 p-4 text-red-400">
              <Gift className="h-8 w-8" />
            </div>
            <h2 className="text-3xl font-black md:text-4xl">Comprar Gift Card</h2>
            <p className="mt-3 flex-1 text-base leading-7 text-zinc-400">
              Regalá una experiencia de manejo. Pagás online y recibís una Gift
              Card descargable con código único.
            </p>
            <span className="mt-8 inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white">
              Comprar Gift Card
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </span>
          </Link>
        </div>
      </section>
    </main>
  );
}

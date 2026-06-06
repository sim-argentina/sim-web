import Link from "next/link";
import { CheckCircle2, Trophy, ArrowRight } from "lucide-react";

export default function CampeonatoExitoPage() {
  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white">
      <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="mb-6 rounded-full border border-green-500/30 bg-green-500/10 p-5 text-green-400">
          <CheckCircle2 className="h-14 w-14" />
        </div>

        <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Campeonatos SIM Argentina
        </p>

        <h1 className="text-4xl font-black md:text-6xl">Inscripción confirmada</h1>

        <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-300">
          Tu pago fue aprobado y quedaste inscripto en el campeonato. Pronto nos comunicaremos
          con más detalles sobre tu categoría y las fechas del campeonato.
        </p>

        <div className="mt-8 rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 text-left w-full">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
              <Trophy className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-black">¿Qué sigue?</h2>
              <p className="mt-2 text-zinc-400">
                Seguinos en nuestras redes sociales para enterarte de los horarios de cada fecha,
                el circuito asignado y los resultados en tiempo real.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/campeonatos"
            className="rounded-2xl bg-red-600 px-6 py-4 font-black text-white transition hover:bg-red-500"
          >
            Ver campeonatos
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

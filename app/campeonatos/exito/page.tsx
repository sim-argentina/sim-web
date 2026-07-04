import Link from "next/link";
import { CheckCircle2, Trophy, ArrowRight } from "lucide-react";
import PurchaseTracker from "@/components/analytics/PurchaseTracker";

export default function CampeonatoExitoPage() {
  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white">
      <PurchaseTracker kind="campeonato" />
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

        <a
          href={`https://wa.me/5493512520927?text=${encodeURIComponent(
            "Hola SIM, me inscribí al campeonato y quiero unirme al grupo de WhatsApp. Ya pagué la inscripción con Mercado Pago."
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 flex w-full max-w-md items-center justify-center gap-2.5 rounded-2xl bg-[#25D366] px-6 py-4 font-black text-white transition hover:bg-[#20bd5a]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.148-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.611-.916-2.206-.242-.58-.487-.501-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.626.712.227 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
          </svg>
          Pedir acceso al grupo de WhatsApp
        </a>

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

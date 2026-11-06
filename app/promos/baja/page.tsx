import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { moduloInstalado } from "@/lib/marketing/consentimientoServer";
import BajaPromos from "./BajaPromos";

// Baja de las promociones por WhatsApp (Ley 25.326 art. 27: se pide cuando se
// quiere, sin dar explicaciones). A propósito NO depende de la llave de
// captación ni del texto vigente: con la captación apagada o el texto retirado,
// la baja sigue disponible. Solo hace falta que el registro esté instalado.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dejar de recibir promociones",
  description: "Dejá de recibir promociones de SIM Argentina por WhatsApp.",
  robots: { index: false, follow: false },
};

export default async function BajaPromosPage() {
  const instalado = await moduloInstalado();
  if (!instalado.ok || !instalado.valor) notFound();
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-2xl px-4 py-10 md:px-6 md:py-14">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.45em] text-red-500">SIM Argentina</p>
        <h1 className="text-4xl font-black leading-tight md:text-5xl">Dejar de recibir promociones</h1>
        <p className="mt-4 text-lg leading-8 text-zinc-300">
          Escribí el número en el que las recibís. Vas a seguir recibiendo los avisos de tus reservas, gift cards o
          inscripciones: esos no son promociones.
        </p>
        <BajaPromos />
      </section>
    </main>
  );
}

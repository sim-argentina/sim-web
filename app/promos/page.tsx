import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { RUTA_BAJA } from "@/lib/marketing/consentimiento";
import AltaPromos from "./AltaPromos";

// Alta voluntaria a las promociones de SIM Argentina por WhatsApp (destino del QR
// del stand). Detrás de MARKETING_CONSENTIMIENTO_ENABLED: apagada, 404. El texto
// que se acepta sale de la base (versión vigente), nunca de este archivo.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Promociones por WhatsApp",
  description: "Anotate para recibir promociones y novedades de SIM Argentina por WhatsApp. Te das de baja cuando quieras.",
  robots: { index: false, follow: false },
};

export default function PromosPage() {
  if (!marketingConsentimientoHabilitado()) notFound();
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-2xl px-4 py-10 md:px-6 md:py-14">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.45em] text-red-500">SIM Argentina</p>
        <h1 className="flex items-center gap-3 text-4xl font-black leading-tight md:text-5xl">
          <MessageCircle className="h-9 w-9 shrink-0 text-red-500" aria-hidden />
          Promos por WhatsApp
        </h1>
        <p className="mt-4 text-lg leading-8 text-zinc-300">
          Dejanos tu número y te avisamos de descuentos y novedades. Es opcional y te das de baja cuando quieras.
        </p>

        <AltaPromos />

        <p className="mt-8 text-sm text-zinc-400">
          ¿Ya no querés recibirlas?{" "}
          <Link href={RUTA_BAJA} className="font-bold text-red-400 underline underline-offset-2 hover:text-red-300">
            Darte de baja
          </Link>
        </p>
      </section>
    </main>
  );
}

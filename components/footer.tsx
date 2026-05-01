import Link from "next/link";
import { siteConfig } from "@/data/site";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-3 md:px-6 lg:px-8">
        <div>
          <h3 className="text-lg font-bold text-white">SIM Argentina</h3>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Experiencias con simuladores de Fórmula 1, alquiler para eventos y
            activaciones de marca.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-red-500">
            Navegación
          </h4>
          <div className="mt-3 flex flex-col gap-2 text-sm text-zinc-300">
            <Link href="/reservas">Reserva tu turno</Link>
            <Link href="/alquiler">Alquiler de simuladores</Link>
            <Link href="/sobre-nosotros">Sobre nosotros</Link>
            <Link href="/novedades">Novedades</Link>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-red-500">
            Contacto
          </h4>
          <div className="mt-3 space-y-2 text-sm text-zinc-300">
            <p>Instagram: @{siteConfig.instagram}</p>
            <p>WhatsApp: {siteConfig.whatsapp}</p>
            <p>Horario: {siteConfig.horarios}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
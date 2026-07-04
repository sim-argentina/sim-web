import Link from "next/link";
import { RUTAS_LEGALES, legalConfig } from "@/data/legal";

const NAV = [
  { href: RUTAS_LEGALES.terminos, label: "Términos y Condiciones" },
  { href: RUTAS_LEGALES.privacidad, label: "Política de Privacidad" },
  { href: RUTAS_LEGALES.cookies, label: "Política de Cookies" },
  { href: RUTAS_LEGALES.arrepentimiento, label: "Botón de Arrepentimiento" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-28 md:px-6">
        <nav className="mb-10 flex flex-wrap gap-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-red-500/50 hover:text-white"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <article className="legal-prose space-y-5 text-sm leading-7 text-zinc-300">
          {children}
        </article>
        <p className="mt-12 border-t border-white/10 pt-6 text-xs text-zinc-500">
          Última actualización: {legalConfig.ultimaActualizacion}. Ante cualquier consulta escribinos por{" "}
          <a href={legalConfig.whatsappLink} className="text-red-400 hover:text-red-300" target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>{" "}
          o a{" "}
          <a href={`mailto:${legalConfig.email}`} className="text-red-400 hover:text-red-300">
            {legalConfig.email}
          </a>
          .
        </p>
      </div>
    </main>
  );
}

import Link from "next/link";
import Image from "next/image";

export default function SiteHeader() {
  const links = [
    { href: "/", label: "Inicio" },
    { href: "/alquiler", label: "Alquiler" },
    { href: "/sobre-nosotros", label: "Nosotros" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-6 lg:px-8">
        
        {/* LOGO */}
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/sim-logo.jpg"
            alt="Logo SIM"
            width={108}
            height={108}
            className="h-14 w-14 rounded-md object-contain"
            priority
          />
          <div className="flex items-center gap-2">
            <span className="text-sm font-black uppercase tracking-[0.35em] text-red-500">
              SIM
            </span>
            <span className="text-sm font-semibold uppercase tracking-[0.25em] text-white/80">
              Argentina
            </span>
          </div>
        </Link>

        {/* NAV */}
        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => {
            // INICIO EN ROJO
            if (link.href === "/") {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-semibold text-red-500 transition hover:text-red-400"
                >
                  {link.label}
                </Link>
              );
            }

            // RESTO NORMAL
            return (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-semibold text-zinc-300 transition hover:text-white"
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex">
          <Link
            href="/reservas"
            className="rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white transition hover:bg-red-500"
          >
            Reservar
          </Link>
        </div>
      </div>
    </header>
  );
}
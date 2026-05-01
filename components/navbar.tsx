import Link from "next/link";
import Image from "next/image";

export default function Navbar() {
  const links = [
    { href: "/", label: "Inicio" },
    { href: "/reservas", label: "Reserva" },
    { href: "/alquiler", label: "Alquiler" },
    { href: "/viaja-con-sim", label: "Viaja con SIM" },
    { href: "/sobre-nosotros", label: "Sobre nosotros" },
    { href: "/novedades", label: "Novedades" },
    { href: "/tienda", label: "Tienda" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-4">
          <Image
            src="/sim-logo.jpg"
            alt="Logo SIM"
            width={140}
            height={140}
            className="h-16 w-16 rounded-md object-contain"
            priority
          />

          <div className="flex flex-col justify-center leading-tight">
            <div className="text-xs font-black uppercase tracking-[0.35em] text-red-500">
              SIM ARGENTINA
            </div>
            <div className="mt-1 text-sm text-zinc-400">
              Simuladores de Fórmula 1
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap text-sm font-bold uppercase tracking-[0.08em] text-zinc-300 transition hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
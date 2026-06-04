"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Menu, X, MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/",              label: "Inicio"        },
  { href: "/reservas",      label: "Reservar"      },
  { href: "/alquiler",      label: "Alquiler"      },
  { href: "/viaja-con-sim", label: "Viaja con SIM" },
  { href: "/tienda",        label: "Tienda"        },
  { href: "/sobre-nosotros",label: "Sobre nosotros"},
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Cerrar al cambiar de ruta
  useEffect(() => { setOpen(false); }, [pathname]);

  // Bloquear scroll del body cuando el menú está abierto
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* ── Barra de navegación ── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 md:px-6 lg:px-8">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/sim-logo.jpg"
              alt="Logo SIM"
              width={140}
              height={140}
              className="h-11 w-11 rounded-md object-contain md:h-14 md:w-14"
              priority
            />
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] font-black uppercase tracking-[0.35em] text-red-500">
                SIM ARGENTINA
              </span>
              <span className="mt-0.5 hidden text-xs text-zinc-500 sm:block">
                Simuladores de Fórmula 1
              </span>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-6 md:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap text-sm font-bold uppercase tracking-[0.08em] transition hover:text-white ${
                  pathname === link.href ? "text-white" : "text-zinc-400"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTA */}
          <a
            href="https://wa.me/5493512520927"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-2 border border-white/15 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-white/60 transition hover:border-red-600 hover:text-white md:flex"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp
          </a>

          {/* Mobile — botón hamburguesa */}
          <button
            onClick={() => setOpen(true)}
            className="flex h-11 w-11 items-center justify-center text-white md:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </header>

      {/* ── Menú mobile fullscreen ── */}
      <div
        className={`fixed inset-0 z-[60] flex flex-col bg-black transition-transform duration-300 ease-in-out md:hidden ${
          open ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        {/* Header del menú */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-5 py-3.5">
          <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-3">
            <Image
              src="/sim-logo.jpg"
              alt="Logo SIM"
              width={140}
              height={140}
              className="h-11 w-11 rounded-md object-contain"
            />
            <span className="text-[11px] font-black uppercase tracking-[0.35em] text-red-500">
              SIM ARGENTINA
            </span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="flex h-11 w-11 items-center justify-center text-white/50 transition hover:text-white"
            aria-label="Cerrar menú"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Línea roja */}
        <div className="h-[2px] w-full shrink-0 bg-red-600" />

        {/* Links */}
        <nav className="flex flex-1 flex-col overflow-y-auto px-6 py-2">
          {LINKS.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`flex items-center justify-between border-b border-white/5 py-5 text-[1.6rem] font-black uppercase leading-none transition-colors active:text-red-500 ${
                pathname === link.href ? "text-red-500" : "text-white/80"
              }`}
            >
              {link.label}
              <span className="text-xs font-black text-white/15">
                {String(i + 1).padStart(2, "0")}
              </span>
            </Link>
          ))}
        </nav>

        {/* CTAs inferiores */}
        <div className="shrink-0 space-y-3 border-t border-white/8 p-5 pb-8">
          <Link
            href="/reservas"
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-center bg-red-600 py-4 text-sm font-black uppercase tracking-widest text-white transition active:bg-red-700"
          >
            RESERVAR AHORA
          </Link>
          <a
            href="https://wa.me/5493512520927"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-center gap-2 border border-white/10 py-4 text-sm font-black uppercase tracking-widest text-white/50 transition active:border-white/30"
          >
            <MessageCircle className="h-4 w-4" />
            Hablar por WhatsApp
          </a>
        </div>
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type Props = {
  role: string;
};

export default function AdminSidebar({ role }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = [
    {
      label: "Calendario",
      href: "/admin/calendario",
      roles: ["admin", "staff"],
    },
    {
      label: "Turnero",
      href: "/admin/turnero",
      roles: ["admin", "staff"],
    },
    {
  label: "Promociones",
  href: "/admin/promociones",
  roles: ["admin", "staff"],
},
    {
  label: "Códigos",
  href: "/admin/codigos",
  roles: ["admin"],
},
    {
  label: "Bloqueos",
  href: "/admin/bloqueos",
  roles: ["admin"],
},
    {
      label: "Campeonatos",
      href: "/admin/campeonatos",
      roles: ["admin", "staff"],
    },
    {
      label: "Gift Cards",
      href: "/admin/gift-cards",
      roles: ["admin", "staff"],
    },
    {
      label: "Reservas / Gestión",
      href: "/admin",
      roles: ["admin"],
    },
  ];

  const visibleLinks = links.filter((link) => link.roles.includes(role));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed top-5 left-5 z-50 bg-red-600 hover:bg-red-700 text-white rounded-xl px-4 py-3 font-bold shadow-lg"
      >
        ☰
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 bg-black/70 z-50"
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-screen w-[280px] bg-black border-r border-zinc-800 text-white p-6 transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between mb-10">
          <div>
            <p className="text-red-500 tracking-[0.3em] text-xs mb-2">
              PANEL INTERNO
            </p>

            <h2 className="text-2xl font-bold">SIM Argentina</h2>

            <p className="text-zinc-500 text-sm mt-2">Rol: {role}</p>
          </div>

          <button
            onClick={() => setOpen(false)}
            className="text-zinc-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        <nav className="flex flex-col gap-3">
          {visibleLinks.map((link) => {
            const active = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`rounded-xl px-4 py-3 transition-all ${
                  active
                    ? "bg-red-600 text-white"
                    : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
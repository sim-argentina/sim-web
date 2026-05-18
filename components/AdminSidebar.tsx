"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  role: string;
};

export default function AdminSidebar({ role }: Props) {
  const pathname = usePathname();

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
      label: "Reservas / Gestión",
      href: "/admin",
      roles: ["admin"],
    },
  ];

  return (
    <aside className="w-[260px] min-h-screen bg-black border-r border-zinc-800 text-white p-6">
      <div className="mb-10">
        <p className="text-red-500 tracking-[0.3em] text-xs mb-2">
          PANEL INTERNO
        </p>

        <h2 className="text-2xl font-bold">
          SIM Argentina
        </h2>

        <p className="text-zinc-500 text-sm mt-2">
          Rol: {role}
        </p>
      </div>

      <nav className="flex flex-col gap-3">
        {links
          .filter((link) => link.roles.includes(role))
          .map((link) => {
            const active = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
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
  );
}
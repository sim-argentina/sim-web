"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES = [
  { href: "/admin/crm/seguimiento", texto: "Seguimiento" },
  { href: "/admin/crm/negocios", texto: "Negocios" },
  { href: "/admin/crm/jornadas", texto: "Jornadas" },
  { href: "/admin/crm/configuracion", texto: "Configuración" },
];

export default function NavCrm() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del CRM" className="mb-6 mt-2 flex flex-wrap gap-2">
      {SECCIONES.map((s) => {
        const activa = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link key={s.href} href={s.href} aria-current={activa ? "page" : undefined}
            className={`min-h-11 rounded-xl px-4 py-2.5 text-sm font-bold ${activa ? "bg-red-600 text-white" : "border border-white/15 text-white/80 hover:border-white/40"}`}>
            {s.texto}
          </Link>
        );
      })}
    </nav>
  );
}

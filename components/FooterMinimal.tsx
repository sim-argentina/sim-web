import Link from "next/link";
import { RUTAS_LEGALES } from "@/data/legal";

// Footer mínimo para el resto de las páginas: solo copyright + enlaces legales
// básicos. El footer completo (Navegación / Legales / Contacto) vive en la Home.
export default function FooterMinimal() {
  return (
    <footer className="border-t border-white/10 bg-black">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 md:flex-row md:items-center md:justify-between md:px-6 lg:px-8">
        <p className="text-xs text-zinc-500">
          © {new Date().getFullYear()} SIM Argentina. Todos los derechos reservados.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-400">
          <Link href={RUTAS_LEGALES.terminos} className="hover:text-white">Términos y Condiciones</Link>
          <Link href={RUTAS_LEGALES.privacidad} className="hover:text-white">Política de Privacidad</Link>
          <Link href={RUTAS_LEGALES.cookies} className="hover:text-white">Política de Cookies</Link>
          <Link href={RUTAS_LEGALES.arrepentimiento} className="hover:text-white">Botón de Arrepentimiento</Link>
        </div>
      </div>
    </footer>
  );
}

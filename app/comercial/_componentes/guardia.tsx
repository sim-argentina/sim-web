import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { actorCrmActual } from "@/lib/crmAuth";
import { Aviso } from "@/app/admin/(panel)/interacciones/ui";

// Guarda de servidor de las páginas comerciales (B1): sin sesión comercial válida
// vuelve al ingreso; con la sesión de Administración, al inicio (que lo explica).
// Las APIs se protegen solas: esto evita mostrar la cáscara.
export async function exigirComercial(): Promise<{ usuarioId: string; nombre: string } | null> {
  const r = await actorCrmActual();
  if (r.estado === "no_disponible") return null;
  if (r.estado !== "ok") redirect("/comercial/ingresar");
  if (r.actor.tipo !== "comercial") redirect("/comercial");
  return { usuarioId: r.actor.usuarioId, nombre: r.actor.nombre };
}

export function Marco({ titulo, volver, children }: { titulo?: string; volver?: { href: string; texto: string }; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-10 pt-5">
      {volver ? (
        <Link href={volver.href} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-white/70 hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden />{volver.texto}
        </Link>
      ) : null}
      {titulo ? <h1 id="titulo-pagina" tabIndex={-1} className="mb-4 text-2xl font-black outline-none">{titulo}</h1> : null}
      {children}
    </main>
  );
}

export const SinVerificar = () => (
  <main className="mx-auto w-full max-w-md px-4 pt-8">
    <Aviso tipo="error" titulo="No se pudo verificar la sesión">Probá de nuevo en un momento. Si sigue pasando, avisale a la administración.</Aviso>
  </main>
);

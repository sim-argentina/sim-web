import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { ventasPublicasHabilitadas } from "@/lib/mensualidadesVentas";
import { getPlanesActivos } from "@/lib/mensualidadesCompra";
import CompraMensualidad from "./CompraMensualidad";
import IdentificarMensualidad from "./IdentificarMensualidad";

// Compra pública de Mensualidades SIM (Bloque M3).
// La ruta entera está detrás de la flag server-side MENSUALIDADES_ENABLED: sin
// esa variable en "true", responde 404 y no filtra planes ni precios.
//
// force-dynamic para que la flag y el catálogo se evalúen por request y la página
// nunca quede prerenderizada con lo que había en el build.
export const dynamic = "force-dynamic";

// (M8A) La indexación sigue a la llave GENERAL, no a la comercial: mientras el
// módulo esté oculto la página ni siquiera existe (404), así que se marca
// noindex por las dudas; cuando se publique, es una landing comercial normal y
// tiene que poder indexarse. Que las ventas estén pausadas NO la desindexa: el
// producto existe, simplemente no se puede comprar en este momento, y eso lo
// dice la propia página.
export async function generateMetadata() {
  const base = pageMetadata({
    title: "Mensualidades SIM — Horas prepagas de simulador",
    description:
      "Comprá horas por adelantado, reservá cuando quieras y aprovechá un mejor precio durante 30 días en los simuladores de SIM Argentina.",
    path: "/mensualidades",
  });
  return mensualidadesHabilitadas()
    ? base
    : { ...base, robots: { index: false, follow: false } };
}

export default async function MensualidadesPage() {
  // Guarda server-side: con la flag apagada la ruta no existe.
  if (!mensualidadesHabilitadas()) notFound();

  // Los planes salen SIEMPRE de la base, nunca de constantes del front.
  // (M8A) El estado comercial también: se consulta por request, así una pausa
  // se ve enseguida sin esperar a que caduque ninguna caché.
  const [planes, ventasActivas] = await Promise.all([
    getPlanesActivos(),
    ventasPublicasHabilitadas(),
  ]);

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-10 md:px-6 lg:px-8">
        <Link
          href="/vivi-sim"
          className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-zinc-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>

        <div className="mb-10">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.45em] text-red-500">
            SIM Argentina
          </p>
          <h1 className="text-4xl font-black leading-tight md:text-6xl">
            Mensualidades <span className="text-red-600">SIM</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
            Comprá horas por adelantado, reservá cuando quieras y aprovechá un mejor
            precio durante 30 días.
          </p>
        </div>

        {planes.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-6 text-zinc-400">
            No hay planes disponibles en este momento.
          </p>
        ) : (
          <CompraMensualidad planes={planes} ventasActivas={ventasActivas} />
        )}

        {/* Acceso para quien ya compró: código + teléfono, sin cuentas. */}
        <IdentificarMensualidad />
      </section>
    </main>
  );
}

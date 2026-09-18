import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { COOKIE_SESION, leerSesion } from "@/lib/mensualidadSesion";
import { getMiPlan, getReservasDeMiPlan } from "@/lib/mensualidadesMiPlan";
import { ventasPublicasHabilitadas } from "@/lib/mensualidadesVentas";
import MiPlanCliente from "./MiPlanCliente";

// "Mi mensualidad" (Bloque M4). La sesión sale de la cookie HttpOnly: el código
// y el teléfono nunca viajan por la URL ni quedan en el navegador.
//
// NO depende de la feature flag: la flag gobierna los accesos NUEVOS. Sin sesión
// válida devuelve 404, así que con la venta apagada la función tampoco se revela.
export const dynamic = "force-dynamic";

export const metadata = {
  ...pageMetadata({
    title: "Mi mensualidad SIM",
    description: "Consultá el saldo y el vencimiento de tu mensualidad de SIM Argentina.",
    path: "/mensualidades/mi-plan",
  }),
  robots: { index: false, follow: false },
};

export default async function MiPlanPage() {
  const store = await cookies();
  const sesion = await leerSesion(store.get(COOKIE_SESION)?.value);
  if (!sesion) notFound();

  const plan = await getMiPlan(sesion.mensualidadId);
  if (!plan) notFound();

  // (M5A) Historial de la mensualidad DE LA SESIÓN, resuelto en el servidor.
  const reservas = await getReservasDeMiPlan(sesion.mensualidadId);

  // (M8A) La pausa comercial NO afecta a un titular: sigue viendo su saldo y
  // sigue pudiendo reservar. Lo único que cambia es que no puede renovar, y eso
  // hay que decirlo donde está el botón, no esconderlo.
  const ventasActivas = await ventasPublicasHabilitadas();

  return (
    <main className="min-h-screen bg-black px-4 py-16 text-white md:py-24">
      <section className="mx-auto max-w-3xl">
        <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Mi mensualidad
        </p>
        <MiPlanCliente plan={plan} reservas={reservas} ventasActivas={ventasActivas} />
      </section>
    </main>
  );
}

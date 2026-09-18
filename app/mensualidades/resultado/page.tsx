import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import ResultadoCliente from "./ResultadoCliente";

// Resultado de una compra de Mensualidad (Bloque M3, guard de M7.1).
//
// Server Component cuyo único trabajo es la puerta: con la feature flag apagada
// esta ruta NO EXISTE, igual que /mensualidades, /mensualidades/mi-plan y
// /mensualidades/reservar. El 404 se decide en el servidor y ANTES de renderizar
// nada, así que no depende de que el navegador ejecute JavaScript ni cambia con
// los query params que traiga la vuelta de Mercado Pago.
//
// force-dynamic es parte del guard, no una decoración: sin él la página se
// prerenderiza en el build y la flag se evaluaría una sola vez, al compilar.

export const dynamic = "force-dynamic";

// (M8A) Esta pantalla muestra el CÓDIGO y el saldo de quien acaba de comprar.
// Hoy no se indexa porque con la flag apagada devuelve 404, pero eso deja de ser
// cierto el día que el módulo se publique: el noindex tiene que ser explícito y
// no un efecto secundario de la flag. Mismo criterio que Mi Plan y Reservar.
export const metadata = {
  ...pageMetadata({
    title: "Resultado de tu compra — Mensualidades SIM",
    description: "Estado de tu compra de Mensualidad SIM.",
    path: "/mensualidades/resultado",
  }),
  robots: { index: false, follow: false },
};

export default function ResultadoPage() {
  if (!mensualidadesHabilitadas()) notFound();
  return <ResultadoCliente />;
}

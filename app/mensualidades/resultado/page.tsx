import { notFound } from "next/navigation";
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

export default function ResultadoPage() {
  if (!mensualidadesHabilitadas()) notFound();
  return <ResultadoCliente />;
}

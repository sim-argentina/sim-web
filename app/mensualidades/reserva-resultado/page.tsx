import type { Metadata } from "next";
import ResultadoReservaMixta from "./ResultadoReservaMixta";

// Resultado de una reserva mixta (Bloque M5B).
//
// NO depende de la feature flag: apagar la venta no puede dejar a alguien que ya
// pagó sin poder ver si su turno quedó confirmado. La página no lee nada por sí
// misma: todo sale de /api/mensualidades/reserva-resultado con el token.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // El layout ya agrega "| SIM Argentina": acá va solo el nombre de la pantalla.
  title: "Resultado de tu reserva",
  // Una pantalla con un token en la URL no se indexa nunca.
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 md:py-20">
      <ResultadoReservaMixta />
    </main>
  );
}

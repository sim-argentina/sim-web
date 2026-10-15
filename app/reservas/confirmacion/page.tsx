import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { reservaPostpayHabilitada } from "@/lib/featureFlags";
import { comprobantePorToken, leerVuelta, type ComprobantePublico } from "@/lib/reservaPostpay";
import ConfirmacionReserva from "./ConfirmacionReserva";

// Experiencia post-pago de Reservas (EXPERIMENTAL, todavía no pública). Mercado
// Pago vuelve acá solo para quien entró al experimento (ver lib/reservaPostpay.ts).
// Lo que se muestra sale de la BASE con el enlace firmado (?t=); de la URL de
// Mercado Pago no se usa nada para decidir si la reserva está pagada. Con la
// variable apagada o un enlace que no es auténtico: 404.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Tu reserva | SIM Argentina" },
  robots: { index: false, follow: false },
};

export default async function ConfirmacionPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!reservaPostpayHabilitada()) notFound();
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  const vuelta = leerVuelta(sp.vuelta);

  let inicial: ComprobantePublico | null;
  try {
    inicial = await comprobantePorToken(token, vuelta);
  } catch {
    // La base no respondió: la página arranca "confirmando" y vuelve a consultar.
    inicial = { estado: "procesando", reserva: null, calendario: null, analitica: null };
  }
  if (!inicial) notFound();

  return <ConfirmacionReserva token={token} vuelta={vuelta} inicial={inicial} />;
}

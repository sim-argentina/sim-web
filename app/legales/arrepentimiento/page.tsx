import type { Metadata } from "next";
import Link from "next/link";
import { legalConfig, RUTAS_LEGALES } from "@/data/legal";

export const metadata: Metadata = {
  title: "Botón de Arrepentimiento | SIM Argentina",
  description:
    "Ejercé tu derecho de revocación de compra dentro de los 10 días, conforme a la Ley 24.240 y la Resolución 424/2020.",
};

const MENSAJE = `Hola, quiero ejercer el Botón de Arrepentimiento y revocar mi compra.
Nombre y apellido:
DNI:
Fecha de la compra:
Nº de operación / comprobante:
Servicio o producto adquirido:`;

export default function ArrepentimientoPage() {
  const waLink = `${legalConfig.whatsappLink}?text=${encodeURIComponent(MENSAJE)}`;
  const mailLink = `mailto:${legalConfig.email}?subject=${encodeURIComponent(
    "Botón de Arrepentimiento - Revocación de compra"
  )}&body=${encodeURIComponent(MENSAJE)}`;

  return (
    <>
      <h1>Botón de Arrepentimiento</h1>
      <p>
        De acuerdo con el art. 34 de la Ley 24.240 de Defensa del Consumidor y la Resolución 424/2020, tenés derecho a{" "}
        <strong>revocar tu compra dentro de los {legalConfig.diasArrepentimiento} (diez) días corridos</strong>{" "}
        posteriores a la operación, sin necesidad de expresar el motivo y sin costo alguno, siempre que el servicio
        contratado no haya sido aún prestado o utilizado.
      </p>

      <h2>Cómo ejercer tu derecho</h2>
      <p>
        Envianos tu solicitud por cualquiera de estos medios, indicando tu nombre y apellido, DNI, fecha de la compra,
        número de operación o comprobante y el servicio o producto adquirido:
      </p>

      <div className="my-4 flex flex-wrap gap-3">
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "none" }}
          className="rounded-2xl bg-red-600 px-6 py-3 text-sm font-black uppercase tracking-wide text-white transition hover:bg-red-500"
        >
          Solicitar por WhatsApp
        </a>
        <a
          href={mailLink}
          style={{ textDecoration: "none" }}
          className="rounded-2xl border border-white/20 px-6 py-3 text-sm font-black uppercase tracking-wide text-white transition hover:border-red-500/60"
        >
          Solicitar por Email
        </a>
      </div>

      <h2>Qué sucede después</h2>
      <ul>
        <li>Confirmaremos la recepción de tu solicitud.</li>
        <li>
          Si corresponde, se te reintegrará el importe abonado por el mismo medio de pago utilizado (a través de
          Mercado Pago), en los plazos que dicha plataforma disponga.
        </li>
        <li>
          El derecho de revocación no aplica cuando el servicio ya fue prestado o el turno fue utilizado antes de la
          solicitud.
        </li>
      </ul>

      <p>
        Podés consultar más detalles en nuestros{" "}
        <Link href={RUTAS_LEGALES.terminos}>Términos y Condiciones</Link>.
      </p>
    </>
  );
}

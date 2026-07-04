import type { Metadata } from "next";
import Link from "next/link";
import { legalConfig, RUTAS_LEGALES } from "@/data/legal";

export const metadata: Metadata = {
  title: "Política de Cookies | SIM Argentina",
  description: "Qué cookies utiliza el sitio de SIM Argentina: técnicas necesarias y analíticas (Google Analytics) con consentimiento.",
};

export default function CookiesPage() {
  return (
    <>
      <h1>Política de Cookies</h1>
      <p>
        Esta política explica cómo <strong>{legalConfig.nombreComercial}</strong> utiliza cookies en su sitio web.
      </p>

      <h2>1. ¿Qué son las cookies?</h2>
      <p>
        Las cookies son pequeños archivos que un sitio web guarda en tu dispositivo para permitir su funcionamiento o
        recordar información entre páginas.
      </p>

      <h2>2. Cookies técnicas (necesarias)</h2>
      <p>
        Son las estrictamente necesarias para el funcionamiento del sitio. En concreto, se emplea una cookie de sesión
        para el acceso al panel de administración interno. Por su carácter necesario, no requieren consentimiento
        previo. Al procesar un pago, Mercado Pago puede utilizar sus propias cookies bajo su política, ya que la
        operación se realiza en su entorno.
      </p>

      <h2>3. Cookies analíticas (Google Analytics)</h2>
      <p>
        Utilizamos <strong>Google Analytics 4</strong>, gestionado a través de Google Tag Manager, para entender de
        forma estadística cómo se usa el sitio (páginas visitadas, origen del tráfico, interacciones) y así mejorarlo.
        Estas cookies <strong>solo se activan si prestás tu consentimiento</strong> en el banner de cookies.
      </p>
      <ul>
        <li>Aplicamos <strong>Google Consent Mode v2</strong>: por defecto el almacenamiento analítico está <strong>desactivado</strong> hasta que aceptás.</li>
        <li>Si rechazás, no se instalan cookies analíticas y la medición queda desactivada.</li>
        <li>No utilizamos cookies de publicidad ni de seguimiento entre sitios con fines publicitarios.</li>
      </ul>

      <h2>4. Cómo gestionar o revocar tu elección</h2>
      <p>
        Podés aceptar o rechazar las cookies analíticas desde el banner de cookies. Para cambiar tu decisión, borrá las
        cookies y datos del sitio en tu navegador y volverá a mostrarse el banner. También podés configurar tu
        navegador para bloquear o eliminar cookies; el bloqueo de las cookies técnicas podría afectar el
        funcionamiento de algunas secciones.
      </p>

      <h2>5. Más información</h2>
      <p>
        Para más detalles sobre el tratamiento de tus datos, consultá nuestra{" "}
        <Link href={RUTAS_LEGALES.privacidad}>Política de Privacidad</Link>.
      </p>
    </>
  );
}

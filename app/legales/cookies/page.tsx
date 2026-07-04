import type { Metadata } from "next";
import Link from "next/link";
import { legalConfig, RUTAS_LEGALES } from "@/data/legal";

export const metadata: Metadata = {
  title: "Política de Cookies | SIM Argentina",
  description: "Qué cookies utiliza el sitio de SIM Argentina. Solo cookies técnicas estrictamente necesarias.",
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

      <h2>2. Cookies que utilizamos</h2>
      <p>
        Este sitio utiliza <strong>únicamente cookies técnicas estrictamente necesarias</strong> para su
        funcionamiento. En concreto, se emplea una cookie de sesión para el acceso al panel de administración interno.
      </p>
      <ul>
        <li><strong>No</strong> utilizamos cookies de analítica web ni de medición de audiencia.</li>
        <li><strong>No</strong> utilizamos cookies de publicidad ni de seguimiento entre sitios.</li>
        <li><strong>No</strong> compartimos información de navegación con terceros con fines publicitarios.</li>
      </ul>
      <p>
        Por tratarse exclusivamente de cookies estrictamente necesarias, no se requiere tu consentimiento previo para
        su uso, conforme a las buenas prácticas en la materia. Al procesar un pago, Mercado Pago puede utilizar sus
        propias cookies bajo su política, ya que la operación se realiza en su entorno.
      </p>

      <h2>3. Cómo gestionar las cookies</h2>
      <p>
        Podés configurar tu navegador para bloquear o eliminar cookies. Tené en cuenta que, al tratarse de cookies
        técnicas, su bloqueo podría afectar el correcto funcionamiento de algunas secciones del sitio.
      </p>

      <h2>4. Más información</h2>
      <p>
        Para más detalles sobre el tratamiento de tus datos, consultá nuestra{" "}
        <Link href={RUTAS_LEGALES.privacidad}>Política de Privacidad</Link>.
      </p>
    </>
  );
}

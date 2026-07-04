import type { Metadata } from "next";
import Link from "next/link";
import { legalConfig, RUTAS_LEGALES } from "@/data/legal";

export const metadata: Metadata = {
  title: "Términos y Condiciones | SIM Argentina",
  description: "Términos y condiciones de uso, compra de turnos, gift cards e inscripciones de SIM Argentina.",
};

export default function TerminosPage() {
  return (
    <>
      <h1>Términos y Condiciones</h1>
      <p>
        Los presentes Términos y Condiciones (los &quot;Términos&quot;) regulan el uso del sitio web de{" "}
        <strong>{legalConfig.nombreComercial}</strong> y la contratación de turnos, alquileres, gift cards,
        inscripciones a campeonatos y productos ofrecidos a través del mismo. Al utilizar el sitio o realizar una
        compra, el usuario declara haber leído, comprendido y aceptado estos Términos.
      </p>

      <h2>1. Titular</h2>
      <p>
        El sitio es operado por <strong>{legalConfig.nombreComercial}</strong>, con domicilio en {legalConfig.domicilio}.
        Contacto: <a href={legalConfig.whatsappLink} target="_blank" rel="noopener noreferrer">WhatsApp {legalConfig.whatsapp}</a>{" "}
        · <a href={`mailto:${legalConfig.email}`}>{legalConfig.email}</a>.
      </p>

      <h2>2. Objeto</h2>
      <p>
        A través del sitio se ofrecen: reserva y pago de turnos para el uso de simuladores, alquiler de simuladores
        para eventos, compra de gift cards, inscripción a campeonatos y venta de productos relacionados. La
        disponibilidad de turnos y productos puede variar y está sujeta a confirmación.
      </p>

      <h2>3. Precios y medios de pago</h2>
      <ul>
        <li>Los precios se expresan en pesos argentinos (ARS) e incluyen los impuestos aplicables, salvo indicación en contrario.</li>
        <li>Los precios pueden modificarse sin previo aviso; el precio aplicable es el vigente al momento de confirmar la operación.</li>
        <li>
          Los pagos se procesan a través de <strong>Mercado Pago</strong>. Al pagar, el usuario acepta también los
          términos y la política de privacidad de Mercado Pago. {legalConfig.nombreComercial} no accede ni almacena
          los datos completos de tarjetas: esa información es gestionada de forma segura por Mercado Pago.
        </li>
      </ul>

      <h2>4. Reservas y confirmación</h2>
      <p>
        La reserva de un turno queda confirmada una vez acreditado el pago (o registrada, en el caso de turnos
        bonificados). Recibirás la confirmación por los canales informados. Es responsabilidad del usuario ingresar
        datos de contacto correctos.
      </p>

      <h2>5. Cancelaciones, reprogramaciones y reembolsos</h2>
      <ul>
        <li>Podés solicitar la reprogramación o cancelación de un turno contactándonos por WhatsApp con la mayor antelación posible.</li>
        <li>Las gift cards tienen la vigencia y condiciones indicadas al momento de la compra.</li>
        <li>
          Los reembolsos, cuando correspondan, se realizan por el mismo medio de pago utilizado, a través de
          Mercado Pago, dentro de los plazos que dicha plataforma disponga.
        </li>
      </ul>

      <h2>6. Derecho de revocación (Botón de Arrepentimiento)</h2>
      <p>
        Conforme al art. 34 de la Ley 24.240 de Defensa del Consumidor y la Resolución 424/2020, el consumidor puede
        revocar la compra realizada a distancia dentro de los <strong>{legalConfig.diasArrepentimiento} (diez) días
        corridos</strong> contados desde la celebración de la operación, siempre que el servicio no haya sido aún
        prestado o utilizado (por ejemplo, que el turno no haya sido usado). Para ejercer este derecho podés usar el{" "}
        <Link href={RUTAS_LEGALES.arrepentimiento}>Botón de Arrepentimiento</Link>. La revocación no genera costo para
        el consumidor cuando corresponde.
      </p>

      <h2>7. Condiciones de uso de los simuladores</h2>
      <ul>
        <li>Por razones de seguridad, la altura mínima para utilizar los simuladores es de 1,40 metros y el peso máximo permitido es de 110 kg.</li>
        <li>Los menores de edad deben contar con la autorización y supervisión de sus padres, madres o tutores.</li>
        <li>El usuario se compromete a seguir las indicaciones del personal y a hacer un uso responsable del equipamiento.</li>
      </ul>

      <h2>8. Propiedad intelectual</h2>
      <p>
        Los contenidos del sitio (textos, imágenes, logotipos, videos y diseño) pertenecen a {legalConfig.nombreComercial}
        o se utilizan con autorización, y están protegidos por la normativa de propiedad intelectual. Las marcas de
        terceros mencionadas pertenecen a sus respectivos titulares y se utilizan de manera meramente referencial. No
        está permitida su reproducción sin autorización.
      </p>

      <h2>9. Responsabilidad</h2>
      <p>
        {legalConfig.nombreComercial} adopta medidas razonables para que la información del sitio sea correcta y esté
        actualizada, pero no garantiza la ausencia de errores u omisiones. El sitio puede contener enlaces a terceros
        (como Mercado Pago), sobre cuyos contenidos no somos responsables.
      </p>

      <h2>10. Protección de datos</h2>
      <p>
        El tratamiento de los datos personales se rige por nuestra{" "}
        <Link href={RUTAS_LEGALES.privacidad}>Política de Privacidad</Link> y por la{" "}
        <Link href={RUTAS_LEGALES.cookies}>Política de Cookies</Link>.
      </p>

      <h2>11. Ley aplicable y jurisdicción</h2>
      <p>
        Estos Términos se rigen por las leyes de la República Argentina, en particular la Ley 24.240 de Defensa del
        Consumidor. Para cualquier controversia resultan competentes los tribunales que correspondan conforme a las
        normas de protección del consumidor, pudiendo el consumidor optar por el juez de su domicilio (art. 36 Ley
        24.240). El usuario puede realizar reclamos ante la autoridad de aplicación en materia de defensa del
        consumidor.
      </p>

      <h2>12. Modificaciones</h2>
      <p>
        {legalConfig.nombreComercial} podrá actualizar estos Términos en cualquier momento. La versión vigente es la
        publicada en esta página.
      </p>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { legalConfig, RUTAS_LEGALES } from "@/data/legal";

export const metadata: Metadata = {
  title: "Política de Privacidad | SIM Argentina",
  description: "Cómo SIM Argentina recopila, usa y protege tus datos personales conforme a la Ley 25.326.",
};

export default function PrivacidadPage() {
  return (
    <>
      <h1>Política de Privacidad</h1>
      <p>
        En <strong>{legalConfig.nombreComercial}</strong> protegemos tus datos personales y cumplimos con la Ley
        25.326 de Protección de los Datos Personales de la República Argentina y su normativa complementaria. Esta
        política explica qué datos recopilamos, con qué finalidad y cómo podés ejercer tus derechos.
      </p>

      <h2>1. Responsable de la base de datos</h2>
      <p>
        <strong>{legalConfig.nombreComercial}</strong>, con domicilio en {legalConfig.domicilio}. Contacto:{" "}
        <a href={legalConfig.whatsappLink} target="_blank" rel="noopener noreferrer">WhatsApp {legalConfig.whatsapp}</a>{" "}
        · <a href={`mailto:${legalConfig.email}`}>{legalConfig.email}</a>.
      </p>

      <h2>2. Datos que recopilamos</h2>
      <p>Recopilamos únicamente los datos necesarios para prestar nuestros servicios:</p>
      <ul>
        <li><strong>Reservas y gift cards:</strong> nombre y apellido, teléfono y los datos propios de la reserva o del regalo.</li>
        <li><strong>Inscripciones a campeonatos:</strong> nombre, apellido, teléfono y DNI, necesarios para la identificación del participante.</li>
        <li><strong>Contacto:</strong> los datos que nos brindes al comunicarte con nosotros.</li>
      </ul>
      <p>
        <strong>No almacenamos datos de tarjetas ni credenciales de pago.</strong> Los pagos se procesan directamente
        a través de Mercado Pago, que gestiona esa información bajo sus propias políticas de seguridad y privacidad.
      </p>

      <h2>3. Finalidad del tratamiento</h2>
      <ul>
        <li>Gestionar y confirmar reservas de turnos, alquileres, gift cards e inscripciones.</li>
        <li>Procesar los pagos a través de Mercado Pago.</li>
        <li>Comunicarnos con vos respecto de tu operación y brindarte soporte.</li>
        <li>Cumplir con obligaciones legales, contables e impositivas.</li>
      </ul>
      <p>
        El suministro de los datos es voluntario, pero su falta puede impedir la prestación del servicio solicitado.
      </p>

      <h2>4. Comunicaciones comerciales</h2>
      <p>
        {legalConfig.nombreComercial} podrá utilizar los datos de contacto proporcionados por el usuario para enviarle
        comunicaciones relacionadas con sus servicios, incluyendo promociones, descuentos, beneficios, novedades,
        campeonatos, eventos, recordatorios de reservas, avisos operativos y comunicaciones comerciales, por WhatsApp,
        email, teléfono u otros canales informados por el usuario.
      </p>
      <p>
        El usuario podrá solicitar en cualquier momento dejar de recibir comunicaciones promocionales o comerciales por
        cualquiera de los medios de contacto habilitados, sin que ello afecte las comunicaciones operativas necesarias
        para gestionar reservas, pagos, gift cards, campeonatos o servicios contratados.
      </p>

      <h2>5. Cesión y encargados de tratamiento</h2>
      <p>
        No vendemos ni cedemos tus datos con fines comerciales de terceros. Compartimos datos únicamente con
        proveedores que nos permiten operar, en calidad de encargados de tratamiento y en la medida necesaria:
      </p>
      <ul>
        <li><strong>Mercado Pago:</strong> procesamiento de pagos.</li>
        <li><strong>Proveedores de infraestructura tecnológica y hosting</strong> utilizados para operar el sitio y almacenar la información de forma segura.</li>
      </ul>

      <h2>6. Conservación</h2>
      <p>
        Conservamos los datos mientras dure la relación comercial y durante los plazos que exijan las obligaciones
        legales, contables e impositivas aplicables. Luego son eliminados o anonimizados.
      </p>

      <h2>7. Derechos del titular de los datos</h2>
      <p>
        Podés ejercer en cualquier momento tus derechos de acceso, rectificación, actualización y supresión de tus
        datos personales. Para hacerlo, escribinos por{" "}
        <a href={legalConfig.whatsappLink} target="_blank" rel="noopener noreferrer">WhatsApp</a> o a{" "}
        <a href={`mailto:${legalConfig.email}`}>{legalConfig.email}</a>.
      </p>
      <p>
        <em>
          El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma
          gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto
          conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326.
        </em>
      </p>
      <p>
        <em>
          La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley Nº 25.326,
          tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de
          las normas sobre protección de datos personales.
        </em>
      </p>

      <h2>8. Menores de edad</h2>
      <p>
        La contratación de servicios y el uso de los simuladores por parte de menores de edad requieren el
        consentimiento, autorización y supervisión de sus padres, madres o tutores.
      </p>

      <h2>9. Seguridad</h2>
      <p>
        Adoptamos medidas técnicas y organizativas razonables para proteger los datos personales frente a accesos no
        autorizados, pérdida o alteración.
      </p>

      <h2>10. Cookies</h2>
      <p>
        El uso de cookies se detalla en nuestra <Link href={RUTAS_LEGALES.cookies}>Política de Cookies</Link>.
      </p>

      <h2>11. Cambios en esta política</h2>
      <p>
        Podemos actualizar esta Política de Privacidad. La versión vigente es la publicada en esta página, con la
        fecha de última actualización indicada al pie.
      </p>
    </>
  );
}

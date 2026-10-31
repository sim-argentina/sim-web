import { Marco, SinVerificar, exigirComercial } from "../../_componentes/guardia";
import NuevoNegocio from "../../_componentes/NuevoNegocio";

// Alta de un negocio para visitar después (CRM B1): queda asignado al comercial y
// no genera visita, jornada, lead ni interés.
export const metadata = { title: "Nuevo negocio" };

export default async function NuevoNegocioPage() {
  if (!(await exigirComercial())) return <SinVerificar />;
  return (
    <Marco titulo="Nuevo negocio" volver={{ href: "/comercial/negocios", texto: "Mis negocios" }}>
      <NuevoNegocio />
    </Marco>
  );
}

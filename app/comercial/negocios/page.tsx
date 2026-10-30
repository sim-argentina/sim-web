import ListaNegocios from "@/components/crm/ListaNegocios";
import { Marco, SinVerificar, exigirComercial } from "../_componentes/guardia";

// Mis negocios (CRM B1): solo los asignados al comercial.
export const metadata = { title: "Mis negocios" };

export default async function NegociosPage() {
  if (!(await exigirComercial())) return <SinVerificar />;
  return (
    <Marco titulo="Mis negocios" volver={{ href: "/comercial", texto: "Inicio" }}>
      <ListaNegocios modo="comercial" apiBase="/comercial/api" baseNegocio="/comercial/negocios/" rutaNuevo="/comercial/negocios/nuevo" />
    </Marco>
  );
}

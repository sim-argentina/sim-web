import FichaNegocio from "@/components/crm/FichaNegocio";
import { Marco, SinVerificar, exigirComercial } from "../../_componentes/guardia";

// Ficha de un negocio propio (CRM B1). Uno ajeno responde "no existe" (lo decide la API).
export const metadata = { title: "Negocio" };

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await exigirComercial())) return <SinVerificar />;
  const { id } = await params;
  return (
    <Marco volver={{ href: "/comercial/negocios", texto: "Mis negocios" }}>
      <FichaNegocio modo="comercial" apiBase="/comercial/api" id={id} rutaNuevaVisita={`/comercial/visitas/nueva?negocio=${id}`} baseJornada="/comercial/jornadas/" />
    </Marco>
  );
}

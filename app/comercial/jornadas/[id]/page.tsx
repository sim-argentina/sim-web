import { DetalleJornada } from "@/components/crm/Jornadas";
import { Marco, SinVerificar, exigirComercial } from "../../_componentes/guardia";

// Detalle de una jornada propia (CRM B1): km, gastos, cierre y sus visitas.
export const metadata = { title: "Jornada" };

export default async function JornadaPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await exigirComercial())) return <SinVerificar />;
  const { id } = await params;
  return (
    <Marco volver={{ href: "/comercial/jornadas", texto: "Mis jornadas" }}>
      <DetalleJornada modo="comercial" apiBase="/comercial/api" id={id} baseNegocio="/comercial/negocios/" />
    </Marco>
  );
}

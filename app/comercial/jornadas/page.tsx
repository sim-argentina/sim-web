import { ListaJornadas } from "@/components/crm/Jornadas";
import { Marco, SinVerificar, exigirComercial } from "../_componentes/guardia";

// Mis jornadas (CRM B1).
export const metadata = { title: "Mis jornadas" };

export default async function JornadasPage() {
  if (!(await exigirComercial())) return <SinVerificar />;
  return (
    <Marco titulo="Mis jornadas" volver={{ href: "/comercial", texto: "Inicio" }}>
      <ListaJornadas modo="comercial" apiBase="/comercial/api" baseJornada="/comercial/jornadas/" />
    </Marco>
  );
}

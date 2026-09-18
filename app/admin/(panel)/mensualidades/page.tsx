import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import MensualidadesAdminCliente from "./MensualidadesAdminCliente";

// Administración de Mensualidades (Bloque M7).
//
// El rol se resuelve en el servidor y viaja a la pantalla solo para decidir QUÉ
// SE MUESTRA. Lo que se puede HACER lo decide la API, que vuelve a comprobarlo
// en cada request: si esta línea mintiera, la escritura seguiría fallando.

export const dynamic = "force-dynamic";

export default async function MensualidadesAdminPage() {
  const role = await getCurrentAdminRole();
  if (!role) redirect("/admin/login");

  return <MensualidadesAdminCliente rol={role} />;
}

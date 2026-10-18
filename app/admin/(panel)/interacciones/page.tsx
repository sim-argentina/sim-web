import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import InteraccionesCliente from "./InteraccionesCliente";

// Interacciones (staff y admin). El rol sale de la sesión firmada en el servidor;
// la pantalla solo lo usa para mostrar u ocultar accesos: las APIs vuelven a
// exigir cada permiso.
export default async function InteraccionesPage() {
  const rol = await getCurrentAdminRole();
  if (!rol) redirect("/admin/login");
  return <InteraccionesCliente rol={rol} />;
}

import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import AnalisisCliente from "./AnalisisCliente";

// Análisis de Interacciones: SOLO admin. middleware.ts ya redirige a staff
// (ADMIN_ONLY) y la API de métricas exige requireAdmin; esto es la tercera
// cerradura, para que la cáscara tampoco se renderice.
export default async function AnalisisInteraccionesPage() {
  const rol = await getCurrentAdminRole();
  if (!rol) redirect("/admin/login");
  if (rol !== "admin") redirect("/admin/interacciones");
  return <AnalisisCliente />;
}

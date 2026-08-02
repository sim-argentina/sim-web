import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import PendientesClient from "./PendientesClient";

// Pendientes es solo-admin: se valida server-side (defensa en profundidad;
// el link del sidebar se oculta al staff y las APIs usan requireAdmin).
export default async function PendientesPage() {
  const role = await getCurrentAdminRole();
  if (role !== "admin") {
    redirect("/admin/calendario");
  }
  return <PendientesClient />;
}

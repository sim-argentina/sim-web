import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import CronogramaTabs from "./CronogramaTabs";

// Cronograma (IA SIM). Dos pestañas: Calendario (Bloque 2) y Equipo (Bloque 1).
// Visible para admin y staff (NO está en ADMIN_ONLY). El rol se resuelve
// server-side; la autoridad real siempre es la API.
export default async function CronogramaPage() {
  const role = await getCurrentAdminRole();
  if (!role) redirect("/admin/login");
  return <CronogramaTabs role={role} />;
}

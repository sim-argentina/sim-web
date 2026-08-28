import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import CronogramaClient from "./CronogramaClient";

// Cronograma (IA SIM · Bloque 1). Visible para admin y staff (NO está en
// ADMIN_ONLY). El rol se resuelve server-side y define qué puede hacer la UI;
// la autoridad real siempre es la API (requireAdmin / requireStaffOrAdmin).
export default async function CronogramaPage() {
  const role = await getCurrentAdminRole();
  if (!role) redirect("/admin/login");
  return <CronogramaClient role={role} />;
}

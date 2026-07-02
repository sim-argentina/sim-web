import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import FinanzasClient from "./FinanzasClient";

// Finanzas es solo-admin: el middleware ya redirige al staff, pero se valida
// también acá server-side (defensa en profundidad; las APIs usan requireAdmin).
export default async function FinanzasPage() {
  const role = await getCurrentAdminRole();
  if (role !== "admin") {
    redirect("/admin/calendario");
  }
  return <FinanzasClient />;
}

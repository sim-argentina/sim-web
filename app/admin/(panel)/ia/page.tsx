import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import IAChat from "./IAChat";

// IA SIM — solo admin. El gating es server-side: staff NO recibe la interfaz en SSR
// ni puede forzar el acceso por URL (además las APIs de IA responden 403 a staff).
export default async function IAPage() {
  const role = await getCurrentAdminRole();
  if (role !== "admin") redirect("/admin");
  return <IAChat />;
}

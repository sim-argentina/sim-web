import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import UsuariosComerciales from "./UsuariosComerciales";

// CRM · Configuración (B0): usuarios comerciales. Solo admin: el middleware ya
// redirige al staff, pero se valida también acá server-side (defensa en
// profundidad; las APIs usan requireAdmin).
export default async function CrmConfiguracionPage() {
  const role = await getCurrentAdminRole();
  if (role !== "admin") {
    redirect("/admin/calendario");
  }
  return <UsuariosComerciales />;
}

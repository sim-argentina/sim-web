import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import CategoriasCaja from "./CategoriasCaja";

// Categorías de la caja del Colectivo: SOLO admin. El middleware ya redirige al
// staff; esto lo vuelve a comprobar en el servidor. Las APIs exigen admin igual.
export default async function CategoriasCajaPage() {
  const role = await getCurrentAdminRole();
  if (role !== "admin") redirect("/admin/colectivo");
  return <CategoriasCaja />;
}

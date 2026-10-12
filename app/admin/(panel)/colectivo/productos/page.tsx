import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import CatalogoProductos from "./CatalogoProductos";

// Catálogo de productos del Colectivo: SOLO admin. El middleware ya redirige al
// staff; esto lo vuelve a comprobar en el servidor. Las APIs exigen admin igual.
export default async function ProductosColectivoPage() {
  const role = await getCurrentAdminRole();
  if (role !== "admin") redirect("/admin/colectivo");
  return <CatalogoProductos />;
}

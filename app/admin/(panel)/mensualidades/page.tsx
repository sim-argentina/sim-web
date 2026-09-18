import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { getPlanesActivos } from "@/lib/mensualidadesCompra";
import MensualidadesAdminCliente from "./MensualidadesAdminCliente";

// Administración de Mensualidades (Bloque M7).
//
// El rol se resuelve en el servidor y viaja a la pantalla solo para decidir QUÉ
// SE MUESTRA. Lo que se puede HACER lo decide la API, que vuelve a comprobarlo
// en cada request: si esta línea mintiera, la escritura seguiría fallando.
//
// (M7.4) Los planes se leen ACÁ, en el servidor, y viajan solo para dibujar las
// opciones. El precio que se cobra lo vuelve a leer la base al confirmar: lo que
// llegue del navegador no se usa para nada monetario.

export const dynamic = "force-dynamic";

export default async function MensualidadesAdminPage() {
  const role = await getCurrentAdminRole();
  if (!role) redirect("/admin/login");

  // Staff no registra mensualidades, así que no necesita ni el catálogo.
  const planes = role === "admin"
    ? (await getPlanesActivos()).map((p) => ({
        slug: p.slug, nombre: p.nombre, minutos: p.minutos, precio: p.precio,
      }))
    : [];

  return <MensualidadesAdminCliente rol={role} planes={planes} />;
}

import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { catalogoMensualidadesVigente } from "@/lib/mensualidadesComercial";
import MensualidadesAdminCliente from "./MensualidadesAdminCliente";

// Administración de Mensualidades (Bloque M7).
//
// El rol se resuelve en el servidor y viaja a la pantalla solo para decidir QUÉ
// SE MUESTRA. Lo que se puede HACER lo decide la API, que vuelve a comprobarlo
// en cada request: si esta línea mintiera, la escritura seguiría fallando.
//
// (M7.4) Los planes se leen ACÁ, en el servidor, y viajan solo para dibujar las
// opciones. El precio que se cobra lo vuelve a resolver el servidor al
// confirmar: lo que llegue del navegador no se usa para nada monetario.
//
// (B6) Con el precio de la modalidad comercial VIGENTE (mensualidad_plan_precios),
// resuelta en este request. La modalidad viaja para que el alta la devuelva
// (modalidad_vista) y el servidor pueda responder 409 si cambió.

export const dynamic = "force-dynamic";

export default async function MensualidadesAdminPage() {
  const role = await getCurrentAdminRole();
  if (!role) redirect("/admin/login");

  // Staff no registra mensualidades, así que no necesita ni el catálogo.
  const catalogo = role === "admin" ? await catalogoMensualidadesVigente() : null;
  const planes = catalogo
    ? catalogo.planes.map((p) => ({ slug: p.slug, nombre: p.nombre, minutos: p.minutos, precio: p.precio }))
    : [];

  return (
    <MensualidadesAdminCliente
      rol={role}
      planes={planes}
      modalidadComercial={catalogo?.modalidad ?? "legacy"}
    />
  );
}

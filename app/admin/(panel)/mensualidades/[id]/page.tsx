import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import DetalleMensualidadCliente from "./DetalleMensualidadCliente";

// Detalle administrativo de una mensualidad (Bloque M7).
//
// El rol viaja para decidir qué se dibuja. Quien decide qué se puede hacer es
// la API: staff que llegue hasta acá ve la ficha completa de atención y ningún
// botón de escritura, y si arma el request a mano igual se come un 403.

export const dynamic = "force-dynamic";

export default async function DetalleMensualidadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getCurrentAdminRole();
  if (!role) redirect("/admin/login");

  const { id } = await params;
  return <DetalleMensualidadCliente id={id} rol={role} />;
}

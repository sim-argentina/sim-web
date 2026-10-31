"use client";

import FichaNegocio from "@/components/crm/FichaNegocio";
import ComprasNegocio from "@/components/crm/ComprasNegocio";

// Ficha de negocio de Administración: la ficha compartida (B1) más la sección de
// compras y recompra (B3), que se inyecta acá para que el área comercial no la cargue.
export default function FichaNegocioAdmin({ id }: { id: string }) {
  const apiBase = "/api/admin/crm";
  return (
    <FichaNegocio modo="admin" apiBase={apiBase} id={id} baseJornada="/admin/crm/jornadas/" baseSeguimiento="/admin/crm/seguimiento?op="
      seccionCompras={(c) => <ComprasNegocio apiBase={apiBase} empresaId={id} {...c} />} />
  );
}

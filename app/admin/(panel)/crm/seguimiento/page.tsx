import { Suspense } from "react";
import Seguimiento from "@/components/crm/Seguimiento";
import { Cargando } from "../../interacciones/ui";

// CRM · Contactos para seguir (B2): la entrada principal del CRM. Solo admin (lo
// valida el layout de /admin/crm y cada API con actorAdmin).
export default function CrmSeguimientoPage() {
  return (
    <Suspense fallback={<Cargando />}>
      <Seguimiento />
    </Suspense>
  );
}

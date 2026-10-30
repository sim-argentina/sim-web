import UsuariosComerciales from "./UsuariosComerciales";
import CatalogoCrm from "./CatalogoCrm";

// CRM · Configuración: usuarios comerciales (B0) y rubros y zonas (B1). Solo admin:
// lo valida el layout de /admin/crm en el servidor y cada API con requireAdmin.
export default function CrmConfiguracionPage() {
  return (
    <div className="space-y-12">
      <UsuariosComerciales />
      <CatalogoCrm />
    </div>
  );
}

import UsuariosComerciales from "./UsuariosComerciales";
import CatalogoCrm from "./CatalogoCrm";
import ProductosCrm from "./ProductosCrm";

// CRM · Configuración: usuarios comerciales (B0), rubros y zonas (B1) y productos y
// comisiones de lista (B3). Solo admin:
// lo valida el layout de /admin/crm en el servidor y cada API con requireAdmin.
export default function CrmConfiguracionPage() {
  return (
    <div className="space-y-12">
      <UsuariosComerciales />
      <CatalogoCrm />
      <ProductosCrm />
    </div>
  );
}

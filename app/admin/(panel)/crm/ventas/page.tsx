import Ventas from "@/components/crm/Ventas";

// CRM · Ventas (B3): acuerdos cerrados, cobros según CRM y comisión comercial. Solo
// admin (lo valida el layout de /admin/crm y cada API con actorAdmin).
export default function CrmVentasPage() {
  return <Ventas />;
}

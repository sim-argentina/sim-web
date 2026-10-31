import { redirect } from "next/navigation";

// /admin/crm → Contactos para seguir (entrada principal desde B2).
export default function CrmPage() {
  redirect("/admin/crm/seguimiento");
}

import { redirect } from "next/navigation";

// /admin/crm → Negocios.
export default function CrmPage() {
  redirect("/admin/crm/negocios");
}

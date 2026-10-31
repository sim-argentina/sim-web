import { redirect } from "next/navigation";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import NavCrm from "./NavCrm";

// CRM (administración). Solo admin: el middleware ya redirige al staff (/admin/crm
// está en su lista solo-admin) y acá se vuelve a validar en el servidor; cada API
// usa requireAdmin.
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  if ((await getCurrentAdminRole()) !== "admin") redirect("/admin/calendario");
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 md:px-8">
      <p className="text-xs font-bold tracking-[0.3em] text-red-500">CRM B2B</p>
      <NavCrm />
      {children}
    </div>
  );
}

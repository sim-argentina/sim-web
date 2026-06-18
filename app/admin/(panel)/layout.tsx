import { redirect } from "next/navigation";
import AdminSidebar from "@/components/AdminSidebar";
import { getCurrentAdminRole } from "@/lib/adminGuards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getCurrentAdminRole();

  if (!role) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <AdminSidebar role={role} />

      <main className="min-h-screen overflow-x-auto pt-20">
        {children}
      </main>
    </div>
  );
}

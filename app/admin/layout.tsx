import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();

  const role = cookieStore.get("sim-admin-role")?.value;

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
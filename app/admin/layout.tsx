import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();

  const role =
    cookieStore.get("sim-admin-role")?.value;

  if (!role) {
    redirect("/admin/login");
  }

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <AdminSidebar role={role} />

      <main className="flex-1 overflow-x-auto">
        {children}
      </main>
    </div>
  );
}
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminRedirect() {
  const role =
    (await cookies()).get("sim-admin-role")?.value;

  if (role === "admin") {
    redirect("/admin/metricas");
  }

  redirect("/admin/login");
}
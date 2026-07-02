import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { getCuentas } from "@/lib/finanzas";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const cuentas = await getCuentas();
    return NextResponse.json({ cuentas });
  } catch (error) {
    return failResponse(500, "Error cargando cuentas", {
      logContext: "finanzas cuentas GET",
      error,
    });
  }
}

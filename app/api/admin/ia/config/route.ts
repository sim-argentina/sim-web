import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { iaEstaConfigurada, variablesFaltantes, getModelos, getLimites, getProveedor } from "@/lib/ia/config";

// Estado de configuración de IA SIM (admin-only). Nunca devuelve la API key.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const configurada = iaEstaConfigurada();
  return NextResponse.json({
    configurada,
    faltantes: configurada ? [] : variablesFaltantes(),
    proveedor: getProveedor(),
    modelos: getModelos(),
    limites: getLimites(),
  });
}

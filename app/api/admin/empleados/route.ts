import { NextResponse } from "next/server";
import { requireAdmin, requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { validarEmpleadoInput } from "@/lib/empleados";
import { listarActivos, listarArchivados, crearEmpleado } from "@/lib/empleadosServer";

// Integrantes del equipo (IA SIM · Bloque 1).
//   GET  → lectura (admin + staff). Activos siempre; archivados solo si es admin.
//   POST → crear (solo admin).
// La autorización real es server-side (requireAdmin / requireStaffOrAdmin);
// nunca se confía en la UI.

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  try {
    const empleados = await listarActivos();
    const { searchParams } = new URL(req.url);
    const incluirArchivados = auth.role === "admin" && searchParams.get("archivados") === "1";
    const archivados = incluirArchivados ? await listarArchivados() : [];
    return NextResponse.json({ empleados, archivados });
  } catch (error) {
    return failResponse(500, "Error cargando integrantes", { logContext: "empleados GET", error });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  if (!(await rateLimit(`empleados-write:${clientIp(req)}`, 30, 60_000))) {
    return tooManyResponse();
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const val = validarEmpleadoInput(body);
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  const res = await crearEmpleado(val.nombre, val.aliases);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ empleado: res.empleado }, { status: 201 });
}

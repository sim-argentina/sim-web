import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isValidUuid } from "@/lib/security";
import { validarEmpleadoInput } from "@/lib/empleados";
import { editarEmpleado, archivarEmpleado, reactivarEmpleado } from "@/lib/empleadosServer";

type Ctx = { params: Promise<{ id: string }> };

// Mutaciones de un integrante (SOLO admin). Acciones explícitas:
//   { accion: "editar", nombre, aliases }
//   { accion: "archivar" }
//   { accion: "reactivar" }
// No se aceptan campos internos (activo, es_fallback, id, timestamps) desde el
// cliente: la acción determina el cambio permitido (anti mass-assignment).
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  if (!(await rateLimit(`empleados-write:${clientIp(req)}`, 30, 60_000))) {
    return tooManyResponse();
  }

  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Integrante no encontrado." }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const accion = String((body as { accion?: unknown }).accion ?? "");

  if (accion === "editar") {
    const val = validarEmpleadoInput(body);
    if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });
    const res = await editarEmpleado(id, val.nombre, val.aliases);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ empleado: res.empleado });
  }

  if (accion === "archivar") {
    const res = await archivarEmpleado(id);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ empleado: res.empleado });
  }

  if (accion === "reactivar") {
    const res = await reactivarEmpleado(id);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ empleado: res.empleado });
  }

  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}

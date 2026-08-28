import { NextResponse } from "next/server";
import { requireAdmin, requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { validarAnioMes } from "@/lib/cronograma";
import { getMesVista, crearBorrador } from "@/lib/cronogramaServer";

// Cronograma mensual (IA SIM · Bloque 2).
//   GET  → vista de un mes. Admin ve borrador y confirmado; staff SOLO confirmado
//          (un borrador se le reporta como si no hubiera cronograma).
//   POST → crear borrador (solo admin).

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const val = validarAnioMes(searchParams.get("anio"), searchParams.get("mes"));
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  try {
    const vista = await getMesVista(val.anio, val.mes);
    // Staff no puede ver borradores: si no está confirmado, se reporta inexistente.
    if (auth.role !== "admin" && vista.estado !== "confirmado") {
      return NextResponse.json({
        mes: {
          estado: "inexistente",
          anio: val.anio,
          mes: val.mes,
          apertura_default: vista.apertura_default,
          cierre_default: vista.cierre_default,
          confirmado_at: null,
          fallback: vista.fallback,
          dias: [],
        },
      });
    }
    return NextResponse.json({ mes: vista });
  } catch (error) {
    return failResponse(500, "Error cargando el cronograma", { logContext: "cronograma GET", error });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  if (!(await rateLimit(`cronograma-write:${clientIp(req)}`, 40, 60_000))) {
    return tooManyResponse();
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const val = validarAnioMes((body as { anio?: unknown }).anio, (body as { mes?: unknown }).mes);
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  const res = await crearBorrador(val.anio, val.mes);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ mes: res.data }, { status: 201 });
}

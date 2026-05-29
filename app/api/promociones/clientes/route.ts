import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q")?.trim() || "";
  const dias = Number(searchParams.get("dias") || 30);
  const historico = searchParams.get("historico") === "true";

  const fechaDesde = new Date();
  fechaDesde.setDate(fechaDesde.getDate() - dias);

  let query = supabaseAdmin
    .from("turnos_stand")
    .select("id, nombre, telefono, fecha, hora, total, estado")
    .neq("estado", "cancelado")
    .not("nombre", "is", null)
    .not("telefono", "is", null)
    .order("fecha", { ascending: false });

  if (!historico) {
    query = query.gte("fecha", fechaDesde.toISOString().slice(0, 10));
  }

  if (q.length >= 2) {
    query = query.or(`nombre.ilike.%${q}%,telefono.ilike.%${q}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Error cargando clientes de promociones" },
      { status: 500 }
    );
  }

  const clientesMap = new Map<
    string,
    {
      nombre: string;
      telefono: string;
      cantidad_turnos: number;
      total_gastado: number;
      ultimo_turno: string;
    }
  >();

  data?.forEach((turno) => {
    const clave = `${turno.nombre}-${turno.telefono}`;

    const actual = clientesMap.get(clave);

    if (!actual) {
      clientesMap.set(clave, {
        nombre: turno.nombre || "",
        telefono: turno.telefono || "",
        cantidad_turnos: 1,
        total_gastado: Number(turno.total || 0),
        ultimo_turno: turno.fecha,
      });
    } else {
      actual.cantidad_turnos += 1;
      actual.total_gastado += Number(turno.total || 0);

      if (turno.fecha > actual.ultimo_turno) {
        actual.ultimo_turno = turno.fecha;
      }
    }
  });

  return NextResponse.json({
    clientes: Array.from(clientesMap.values()).sort(
      (a, b) => b.cantidad_turnos - a.cantidad_turnos
    ),
  });
}
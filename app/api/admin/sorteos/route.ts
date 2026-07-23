import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    // Archivados ocultos por defecto. Solo admin puede pedir verlos.
    const estado = new URL(req.url).searchParams.get("estado");
    const verArchivados = auth.role === "admin" && (estado === "eliminados" || estado === "todos");

    let query = supabaseAdmin.from("sorteos").select("*").order("created_at", { ascending: false });
    if (estado === "eliminados" && auth.role === "admin") query = query.not("deleted_at", "is", null);
    else if (!verArchivados) query = query.is("deleted_at", null);

    const { data, error } = await query;
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/sorteos", error });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();

    if (!body.titulo?.trim() || !body.premio?.trim()) {
      return NextResponse.json({ error: "Título y premio son obligatorios" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("sorteos")
      .insert([
        {
          titulo: body.titulo.trim(),
          descripcion: body.descripcion || null,
          premio: body.premio.trim(),
          estado: body.estado || "proximo",
          fecha_inicio: body.fecha_inicio || null,
          fecha_fin: body.fecha_fin || null,
          condiciones: body.condiciones || null,
          imagen_url: body.imagen_url || null,
        },
      ])
      .select()
      .single();

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/sorteos", error });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

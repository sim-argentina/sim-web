import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { validarTitulo, normalizarDescripcion, parseFechaLimite } from "@/lib/pendientes";

// Tareas pendientes internas de SIM. SOLO admin, vía service_role (la tabla es RLS
// deny-all: nunca se expone al cliente público). Modelo: titulo (obligatorio) +
// descripcion (opcional) + fecha_limite (opcional).

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("pendientes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return failResponse(500, "Error cargando pendientes", { logContext: "pendientes GET", error });
  return NextResponse.json({ pendientes: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const titulo = validarTitulo(body.titulo);
  if (!titulo.ok) return NextResponse.json({ error: titulo.error }, { status: 400 });

  const descripcion = normalizarDescripcion(body.descripcion);
  if (!descripcion.ok) return NextResponse.json({ error: descripcion.error }, { status: 400 });

  const fecha = parseFechaLimite(body.fecha_limite);
  if (!fecha.ok) return NextResponse.json({ error: "Fecha límite inválida (YYYY-MM-DD)" }, { status: 400 });

  // Solo campos permitidos (anti mass-assignment).
  const { data, error } = await supabaseAdmin
    .from("pendientes")
    .insert([{ titulo: titulo.value, descripcion: descripcion.value, fecha_limite: fecha.value }])
    .select()
    .single();

  if (error) return failResponse(500, "No se pudo crear el pendiente", { logContext: "pendientes POST", error });
  return NextResponse.json({ pendiente: data }, { status: 201 });
}

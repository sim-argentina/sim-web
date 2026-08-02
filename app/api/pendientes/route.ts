import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { isValidDateStr } from "@/lib/security";

// Tareas pendientes internas de SIM. Solo admin/staff, vía service_role
// (la tabla es RLS deny-all: nunca se expone al cliente público).

const MAX_DESC = 1000;

// Valida una fecha límite opcional. Devuelve { ok, value } con string 'YYYY-MM-DD'
// o null. Cadena vacía / null / undefined → null.
function parseFecha(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v === "string" && isValidDateStr(v.trim())) return { ok: true, value: v.trim() };
  return { ok: false };
}

export async function GET() {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("pendientes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return failResponse(500, "Error cargando pendientes", { logContext: "pendientes GET", error });
  return NextResponse.json({ pendientes: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const descripcion = String(body.descripcion ?? "").trim();
  if (!descripcion) return NextResponse.json({ error: "La descripción es obligatoria" }, { status: 400 });
  if (descripcion.length > MAX_DESC) return NextResponse.json({ error: "La descripción es demasiado larga" }, { status: 400 });

  const fecha = parseFecha(body.fecha_limite);
  if (!fecha.ok) return NextResponse.json({ error: "Fecha límite inválida (YYYY-MM-DD)" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("pendientes")
    .insert([{ descripcion, fecha_limite: fecha.value }])
    .select()
    .single();

  if (error) return failResponse(500, "No se pudo crear el pendiente", { logContext: "pendientes POST", error });
  return NextResponse.json({ pendiente: data }, { status: 201 });
}

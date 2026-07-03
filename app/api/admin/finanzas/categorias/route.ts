import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { TIPOS_CATEGORIA, getCategorias, registrarFinLog } from "@/lib/finanzas";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const categorias = await getCategorias();
    return NextResponse.json({ categorias });
  } catch (error) {
    return failResponse(500, "Error cargando categorías", { logContext: "finanzas categorias GET", error });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const nombre = String(body.nombre || "").trim().slice(0, 80);
  if (!nombre) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });

  const tipo = String(body.tipo || "").trim();
  if (!(TIPOS_CATEGORIA as readonly string[]).includes(tipo)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("fin_categorias")
    .insert([
      {
        nombre,
        ambito: "sim",
        tipo,
        activa: body.activa !== false,
        orden: Number(body.orden) || 50,
        color: body.color ? String(body.color).slice(0, 20) : null,
        descripcion: body.descripcion ? String(body.descripcion).slice(0, 300) : null,
      },
    ])
    .select()
    .single();

  if (error) {
    const dup = String((error as { code?: string }).code) === "23505";
    return dup
      ? NextResponse.json({ error: "Ya existe esa categoría" }, { status: 400 })
      : failResponse(500, "Error creando categoría", { logContext: "finanzas categorias POST", error });
  }

  await registrarFinLog("crear", "fin_categorias", data.id, { nombre, tipo }, auth.role);
  return NextResponse.json({ categoria: data }, { status: 201 });
}

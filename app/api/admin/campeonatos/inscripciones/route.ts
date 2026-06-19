import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const {
      nombre, apellido, telefono, dni, instagram,
      escuderia_favorita, categoria, campeonato_id, monto, metodo_pago,
    } = body;

    if (!nombre?.trim() || !apellido?.trim() || !telefono?.trim() || !dni?.trim() || !escuderia_favorita || !categoria || !campeonato_id || !monto || !metodo_pago) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    const montoFinal = Math.round(Number(monto));
    if (!Number.isFinite(montoFinal) || montoFinal <= 0) {
      return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    }

    const nombre_completo = `${nombre.trim()} ${apellido.trim()}`.trim();

    const { data, error } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .insert([{
        campeonato_id,
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        nombre_completo,
        telefono: telefono.trim(),
        dni: dni.trim(),
        instagram: instagram?.trim() || null,
        escuderia_favorita,
        categoria,
        monto: montoFinal,
        estado_pago: "pagado",
        metodo_pago,
      }])
      .select("id")
      .single();

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones", error });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(req.url);
    const campeonato_id = url.searchParams.get("campeonato_id");
    const categoria = url.searchParams.get("categoria");
    const estado_pago = url.searchParams.get("estado_pago");
    const q = sanitizeSearchTerm(url.searchParams.get("q"));

    let query = supabaseAdmin
      .from("campeonato_inscripciones")
      .select("*, campeonatos(nombre)")
      .order("created_at", { ascending: false });

    if (campeonato_id) query = query.eq("campeonato_id", campeonato_id);
    if (categoria) query = query.eq("categoria", categoria);
    if (estado_pago) query = query.eq("estado_pago", estado_pago);
    if (q) {
      query = query.or(
        `nombre_completo.ilike.%${q}%,dni.ilike.%${q}%,telefono.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones", error });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

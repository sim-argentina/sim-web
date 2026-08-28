import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";

// Precios especiales de reserva por fecha. ADMIN-ONLY. No expone escritura pública.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "" / null / no numérico → null (usar precio normal). Negativo → inválido.
function normPrecio(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === "" || v == null) return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: Math.round(n) };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data, error } = await supabaseAdmin
    .from("reservas_precios_especiales")
    .select("*")
    .order("fecha", { ascending: false });
  if (error) return failResponse(500, "Error cargando precios especiales", { logContext: "precios GET", error });
  return NextResponse.json({ precios: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const fecha = String(body.fecha ?? "").trim();
  if (!DATE_RE.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  const p15 = normPrecio(body.precio_15);
  const p30 = normPrecio(body.precio_30);
  if (!p15.ok || !p30.ok) {
    return NextResponse.json({ error: "Los precios deben ser números positivos." }, { status: 400 });
  }
  if (p15.value == null && p30.value == null) {
    return NextResponse.json({ error: "Cargá al menos un precio (15 o 30 min)." }, { status: 400 });
  }

  // Upsert por fecha (crear o sobrescribir el precio de esa fecha).
  const { data, error } = await supabaseAdmin
    .from("reservas_precios_especiales")
    .upsert(
      { fecha, precio_15: p15.value, precio_30: p30.value, created_by: auth.role, updated_at: new Date().toISOString() },
      { onConflict: "fecha" },
    )
    .select("*")
    .single();
  if (error || !data) return failResponse(500, "No se pudo guardar el precio especial", { logContext: "precios POST", error });
  return NextResponse.json({ precio: data }, { status: 201 });
}

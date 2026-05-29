import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const body = await req.json();

  if (!id) {
    return NextResponse.json(
      { error: "ID inválido" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("codigos_descuento")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Error actualizando código", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ codigo: data });
}
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });

  // Crear bucket si no existe
  await supabaseAdmin.storage.createBucket("campeonatos", { public: true }).catch(() => {});

  const ext = file.name.split(".").pop();
  const nombre = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabaseAdmin.storage
    .from("campeonatos")
    .upload(nombre, buffer, { contentType: file.type, upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = supabaseAdmin.storage.from("campeonatos").getPublicUrl(nombre);
  return NextResponse.json({ url: data.publicUrl });
}

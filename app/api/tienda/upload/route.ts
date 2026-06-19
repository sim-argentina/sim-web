import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { validateImageUpload, safeUploadName } from "@/lib/security";

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  const valid = await validateImageUpload(file);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: valid.status });

  const nombre = safeUploadName(valid.ext);
  const { error } = await supabaseAdmin.storage
    .from("tienda")
    .upload(nombre, valid.buffer, { contentType: valid.contentType, upsert: false });

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "tienda/upload", error });

  const { data } = supabaseAdmin.storage.from("tienda").getPublicUrl(nombre);
  return NextResponse.json({ url: data.publicUrl });
}

import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { validateImageUpload, safeUploadName } from "@/lib/security";

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  const valid = await validateImageUpload(file);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: valid.status });

  await supabaseAdmin.storage.createBucket("campeonatos", { public: true }).catch(() => {});

  const nombre = safeUploadName(valid.ext);
  const { error } = await supabaseAdmin.storage
    .from("campeonatos")
    .upload(nombre, valid.buffer, { contentType: valid.contentType, upsert: false });

  if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/upload", error });

  const { data } = supabaseAdmin.storage.from("campeonatos").getPublicUrl(nombre);
  return NextResponse.json({ url: data.publicUrl });
}

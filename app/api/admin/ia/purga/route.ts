import { NextResponse } from "next/server";
import { getCurrentAdminRole } from "@/lib/adminGuards";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { borrar } from "@/lib/ia/docs/storage";
import { limpiarStorageDeConversaciones } from "@/lib/ia/informes/informesServer";

// Purga definitiva de la papelera (> 30 días). Endpoint PROTEGIDO: lo dispara el Cron
// de Vercel (GET con `Authorization: Bearer ${CRON_SECRET}`), o un admin manualmente
// (POST con sesión). Nunca es un endpoint público desprotegido.
const DIAS_RETENCION = 30;

function tieneSecretoCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.IA_CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function purgar() {
  // Antes de eliminar las conversaciones vencidas, borrar del Storage los adjuntos NO
  // promovidos (los promovidos ya tienen copia independiente en el conocimiento).
  const corte = new Date(Date.now() - DIAS_RETENCION * 86400000).toISOString();
  const { data: convs } = await supabaseAdmin.from("ia_conversaciones").select("id").eq("estado", "papelera").lt("deleted_at", corte);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (ids.length > 0) {
    const { data: adjs } = await supabaseAdmin.from("ia_adjuntos_conversacion").select("storage_path, promovido_documento_id").in("conversacion_id", ids);
    const paths = (adjs ?? []).filter((a) => a.storage_path && !a.promovido_documento_id).map((a) => a.storage_path as string);
    if (paths.length > 0) await borrar(paths);
    // Bloque 4C: limpiar del Storage los archivos de informes de esas conversaciones
    // (el cascade de la DB borra las filas ia_informes/*; el Storage se limpia acá).
    await limpiarStorageDeConversaciones(ids);
  }
  const { data, error } = await supabaseAdmin.rpc("ia_purgar_papelera", { p_dias: DIAS_RETENCION });
  if (error) return NextResponse.json({ error: "No se pudo purgar." }, { status: 500 });
  return NextResponse.json({ ok: true, eliminadas: data ?? 0, retencion_dias: DIAS_RETENCION });
}

// Cron de Vercel (GET con el secreto).
export async function GET(req: Request) {
  if (!tieneSecretoCron(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return purgar();
}

// Disparo manual por un admin autenticado (o con el secreto de cron).
export async function POST(req: Request) {
  if (!tieneSecretoCron(req) && (await getCurrentAdminRole()) !== "admin") {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  return purgar();
}

import { requireAdmin } from "@/lib/adminGuards";
import { forbiddenOrigin, isAllowedOrigin } from "@/lib/originCheck";
import { inesperado, leerCuerpo, responder } from "@/lib/marketing/http";
import { diagnostico, procesarEventos } from "@/lib/marketing/whatsappServer";

// Marketing · diagnóstico de la integración con WhatsApp Cloud API (SOLO admin).
//   GET  → estado (sin configurar / incompleta / presente sin verificar /
//          verificada), qué variables faltan (por nombre, nunca su valor), si
//          los envíos reales están bloqueados, rechazos por motivo, últimos
//          eventos (teléfono enmascarado, sin textos) y errores.
//   POST → { accion: "reprocesar" }: procesa los eventos pendientes de la
//          bandeja. Es seguro repetirlo. No envía nada.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    return responder(await diagnostico());
  } catch (error) {
    return inesperado("whatsapp diagnóstico", error);
  }
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return forbiddenOrigin();
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.ok) return cuerpo.respuesta;
    if ((cuerpo.body as { accion?: unknown })?.accion !== "reprocesar") return responder({ error: "Acción inválida.", codigo: "datos_invalidos" }, 400);
    const r = await procesarEventos(200);
    if (!r.ok) return responder({ error: r.instalado ? "No se pudo procesar. Es seguro repetirlo." : "La bandeja no está instalada en esta base.", codigo: "no_disponible" }, 503);
    return responder({ resultado: r.valor });
  } catch (error) {
    return inesperado("whatsapp reprocesar", error);
  }
}

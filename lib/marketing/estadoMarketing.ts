// Marketing · estado de las llaves de ENTORNO, para el diagnóstico privado del
// panel (/api/admin/marketing/estado). PURO: recibe el entorno y no lee la base.
// Nunca devuelve valores de variables, solo si cada parte está encendida.
//   · Captación (MARKETING_CONSENTIMIENTO_ENABLED): /promos, la casilla del
//     checkout y las altas del panel (la captación del stand).
//   · Campañas (MARKETING_CAMPANIAS_ENABLED): API de campañas y ejecutor.
//   · Envíos reales a WhatsApp: llave maestra + MARKETING_WHATSAPP_ENVIOS_REALES
//     + configuración completa (evaluarEnvioReal).
// Las bajas no dependen de ninguna llave: siempre se respetan.

import { flagHabilitada, marketingCampaniasHabilitadas } from "@/lib/featureFlags";
import { evaluarEntornoCampanias } from "@/lib/marketing/entornoCampanias";
import { evaluarEnvioReal } from "@/lib/marketing/whatsappCloud";

export type ParteMarketing = { clave: "captacion" | "campanias" | "envios_reales"; titulo: string; habilitado: boolean; nota: string };
export type EstadoMarketing = { estado: "Deshabilitado" | "Habilitado en parte"; partes: ParteMarketing[] };

export function estadoMarketing(entorno: Record<string, string | undefined> = process.env): EstadoMarketing {
  const captacion = flagHabilitada(entorno.MARKETING_CONSENTIMIENTO_ENABLED);
  const campanias = marketingCampaniasHabilitadas(entorno);
  const envio = evaluarEnvioReal(entorno);
  const escritura = evaluarEntornoCampanias(entorno);
  const partes: ParteMarketing[] = [
    {
      clave: "captacion",
      titulo: "Captación de consentimiento",
      habilitado: captacion,
      nota: captacion
        ? "Encendida: /promos y la casilla del checkout responden si hay un texto publicado; el panel carga altas con evidencia."
        : "Deshabilitada (MARKETING_CONSENTIMIENTO_ENABLED no es \"true\"): /promos y la casilla del checkout no aparecen y el panel no carga altas ni publica textos. Las bajas siguen.",
    },
    {
      clave: "campanias",
      titulo: "Campañas",
      habilitado: campanias,
      nota: campanias
        ? escritura.motivo
        : "Deshabilitadas (MARKETING_CAMPANIAS_ENABLED no es \"true\"): las API de campañas y el ejecutor responden 503 y no se generan beneficios.",
    },
    {
      clave: "envios_reales",
      titulo: "Envíos reales a WhatsApp",
      habilitado: envio.ok,
      nota: envio.ok ? "El bloqueo está abierto." : envio.motivo,
    },
  ];
  return { estado: partes.some((p) => p.habilitado) ? "Habilitado en parte" : "Deshabilitado", partes };
}

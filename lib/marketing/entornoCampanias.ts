// Marketing · ¿en qué entorno se pueden ESCRIBIR campañas? PURO (recibe el entorno).
// Antes que nada, la llave maestra MARKETING_CAMPANIAS_ENABLED (lib/featureFlags.ts):
// apagada, no se escribe en ninguna base. Encendida, guardar, preparar y ejecutar
// solo en la base LOOPBACK de pruebas (datos sintéticos), fuera de Vercel y con el
// proveedor falso pedido explícitamente. En cualquier otro caso, solo se calcula
// la audiencia (lectura). Falla cerrada: lo que no se puede confirmar se trata
// como no permitido.

import { marketingCampaniasHabilitadas } from "@/lib/featureFlags";
import { destinoEsLoopback } from "@/lib/ia/proveedorPermitido";
import { evaluarProveedorWhatsapp } from "@/lib/marketing/proveedorWhatsapp";
import { CODIGO_MARKETING_DESHABILITADO } from "@/lib/marketing/whatsappCloud";

export type EntornoCampanias = { escritura: true; motivo: string } | { escritura: false; codigo: string; motivo: string };

export function evaluarEntornoCampanias(entorno: Record<string, string | undefined> = process.env): EntornoCampanias {
  if (!marketingCampaniasHabilitadas(entorno)) {
    return { escritura: false, codigo: CODIGO_MARKETING_DESHABILITADO, motivo: "Deshabilitado: las campañas de Marketing están apagadas (MARKETING_CAMPANIAS_ENABLED no es \"true\")." };
  }
  if (entorno.VERCEL || entorno.VERCEL_URL || entorno.VERCEL_ENV) {
    return { escritura: false, codigo: "campanias_en_vercel", motivo: "En Vercel las campañas solo calculan la audiencia (lectura)." };
  }
  if (!destinoEsLoopback(entorno.NEXT_PUBLIC_SUPABASE_URL)) {
    return { escritura: false, codigo: "campanias_base_no_local", motivo: "La base no es la local de pruebas: solo se calcula la audiencia (lectura)." };
  }
  const p = evaluarProveedorWhatsapp(entorno);
  if (!p.ok) return { escritura: false, codigo: p.codigo, motivo: p.motivo };
  return { escritura: true, motivo: "Base local de pruebas con proveedor falso: simulación con datos sintéticos." };
}

// Marketing · lectura del registro de consentimiento para la audiencia. Recibe el
// cliente por parámetro: el panel usa el de servidor; la simulación, uno de SOLO
// LECTURA (lib/marketing/soloLectura.ts). Solo lee la vista mkt_consentimiento_estado.

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorDeRpc, type Fuente } from "@/lib/marketing/consentimiento";

export type RegistroParaAudiencia = {
  instalado: boolean;
  /** Teléfono canónico → fuente del alta vigente. */
  consentimientos: Map<string, Fuente>;
  bajas: Set<string>;
};

const LOTE = 1000;

/** Estado vigente de todos los teléfonos, paginado (PostgREST corta en 1000). Sin tablas → instalado: false. */
export async function leerRegistroParaAudiencia(
  cliente: Pick<SupabaseClient, "from">,
): Promise<{ ok: true; valor: RegistroParaAudiencia } | { ok: false; causa: string }> {
  const consentimientos = new Map<string, Fuente>();
  const bajas = new Set<string>();
  for (let i = 0; ; i += LOTE) {
    const { data, error } = await cliente.from("mkt_consentimiento_estado")
      .select("telefono, estado, alta_fuente").order("telefono", { ascending: true }).range(i, i + LOTE - 1);
    if (error) {
      if (errorDeRpc(error)?.codigo === "modulo_no_instalado") return { ok: true, valor: { instalado: false, consentimientos, bajas } };
      return { ok: false, causa: `${error.code ?? ""} ${error.message ?? ""}`.trim() };
    }
    for (const f of (data ?? []) as { telefono: string; estado: string; alta_fuente: Fuente | null }[]) {
      if (f.estado === "alta" && f.alta_fuente) consentimientos.set(f.telefono, f.alta_fuente);
      else bajas.add(f.telefono);
    }
    if (!data || data.length < LOTE) break;
  }
  return { ok: true, valor: { instalado: true, consentimientos, bajas } };
}

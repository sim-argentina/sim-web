// ============================================================================
// Panel de Códigos · lo que se muestra de las retenciones de cupones. SOLO
// SERVIDOR, solo lectura. Mismos permisos que el resto del panel de Códigos
// (admin). Nunca expone el intento, la huella ni el link de pago de la persona.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { faltaMigracion, type Retencion } from "@/lib/cuponesRetencion";

export type ResumenRetenciones = { retenidas: number; a_revisar: number; sin_cupo: number };

/** Una retención pide revisión si ya venció y sigue retenida, o si se pagó sin cupo. */
export function requiereRevision(r: Pick<Retencion, "estado" | "vence_en" | "nota">, ahora = new Date()): string | null {
  if (r.nota === "aprobado_sin_cupo") return "pagada_sin_cupo";
  if (r.estado === "retenido" && Date.parse(r.vence_en) < ahora.getTime()) return r.nota === "legado" ? "legado_sin_confirmar" : "vencida_sin_confirmar";
  return null;
}

/** Por código: retenciones activas y las que piden revisión. null = la migración no está aplicada. */
export async function resumenRetencionesPorCodigo(): Promise<Map<number, ResumenRetenciones> | null> {
  const columnas = "id, codigo_id, estado, nota, vence_en";
  const [retenidas, sinCupo] = await Promise.all([
    supabaseAdmin.from("codigo_retenciones").select(columnas).eq("estado", "retenido").limit(5000),
    supabaseAdmin.from("codigo_retenciones").select(columnas).eq("nota", "aprobado_sin_cupo").limit(5000),
  ]);
  const error = retenidas.error ?? sinCupo.error;
  if (error) {
    if (faltaMigracion(error)) return null;
    throw new Error(`codigo_retenciones: ${error.message}`);
  }
  // Una retenida que además se pagó sin cupo no existe (sin cupo = liberada): sin duplicados.
  const vistas = new Set<string>();
  const data = [...(retenidas.data ?? []), ...(sinCupo.data ?? [])].filter((r) => !vistas.has(String(r.id)) && vistas.add(String(r.id)));
  const ahora = new Date();
  const m = new Map<number, ResumenRetenciones>();
  for (const r of (data ?? []) as (Pick<Retencion, "estado" | "vence_en" | "nota"> & { codigo_id: number })[]) {
    const s = m.get(r.codigo_id) ?? { retenidas: 0, a_revisar: 0, sin_cupo: 0 };
    if (r.estado === "retenido") s.retenidas++;
    if (r.nota === "aprobado_sin_cupo") s.sin_cupo++;
    if (requiereRevision(r, ahora)) s.a_revisar++;
    m.set(r.codigo_id, s);
  }
  return m;
}

/** ¿Están pausadas las retenciones NUEVAS (codigo_retenciones_control)? null = sin la migración. */
export async function pausaDeRetenciones(): Promise<{ pausadas: boolean; motivo: string | null; desde: string } | null> {
  const { data, error } = await supabaseAdmin.from("codigo_retenciones_control").select("nuevas_pausadas, motivo, cambiado_en").maybeSingle();
  if (error) {
    if (faltaMigracion(error)) return null;
    throw new Error(`codigo_retenciones_control: ${error.message}`);
  }
  if (!data) return null;
  return { pausadas: !!data.nuevas_pausadas, motivo: data.motivo ?? null, desde: data.cambiado_en };
}

export type RetencionPanel = {
  id: string;
  estado: Retencion["estado"];
  producto: Retencion["producto"];
  compra: { tipo: "reserva"; id: number | null; estado: string | null; fecha: string | null; hora: string | null }
    | { tipo: "gift_card"; grupo: string | null; estado: string | null; tarjetas: number; creada: string | null };
  external_reference: string | null;
  con_pago: boolean;
  preferencia: boolean;
  importes: { original: number | null; descuento: number | null; final: number | null };
  pago_id: string | null;
  retenido_en: string;
  vence_en: string;
  consumido_en: string | null;
  liberado_en: string | null;
  motivo_liberacion: string | null;
  nota: string | null;
  revisiones: number;
  revisada_en: string | null;
  revision_resultado: string | null;
  revision_motivo: string | null;
  requiere_revision: string | null;
};

/** Las retenciones de un código (las más nuevas primero), con el estado de su compra. */
export async function retencionesDeCodigo(codigoId: number, limite = 100): Promise<RetencionPanel[] | null> {
  const { data, error } = await supabaseAdmin
    .from("codigo_retenciones")
    .select("*")
    .eq("codigo_id", codigoId)
    .order("retenido_en", { ascending: false })
    .limit(Math.min(Math.max(limite, 1), 200));
  if (error) {
    if (faltaMigracion(error)) return null;
    throw new Error(`codigo_retenciones: ${error.message}`);
  }
  const filas = (data ?? []) as Retencion[];
  const reservas = filas.map((r) => r.reserva_id).filter((x): x is number => x != null);
  const grupos = filas.map((r) => r.grupo_compra_id).filter((x): x is string => !!x);
  const [res, gcs] = await Promise.all([
    reservas.length ? supabaseAdmin.from("reservas").select("id, estado, fecha, hora").in("id", reservas) : Promise.resolve({ data: [] }),
    grupos.length ? supabaseAdmin.from("gift_cards").select("grupo_compra_id, estado_pago, created_at").in("grupo_compra_id", grupos) : Promise.resolve({ data: [] }),
  ]);
  const porReserva = new Map((res.data ?? []).map((x) => [Number(x.id), x as { estado: string; fecha: string; hora: string }]));
  const porGrupo = new Map<string, { estados: Set<string>; tarjetas: number; creada: string | null }>();
  for (const g of (gcs.data ?? []) as { grupo_compra_id: string; estado_pago: string; created_at: string }[]) {
    const a = porGrupo.get(g.grupo_compra_id) ?? { estados: new Set<string>(), tarjetas: 0, creada: null };
    a.estados.add(g.estado_pago);
    a.tarjetas++;
    if (!a.creada || g.created_at < a.creada) a.creada = g.created_at;
    porGrupo.set(g.grupo_compra_id, a);
  }
  const ahora = new Date();
  return filas.map((r) => {
    const gc = r.grupo_compra_id ? porGrupo.get(r.grupo_compra_id) : undefined;
    const rv = r.reserva_id != null ? porReserva.get(Number(r.reserva_id)) : undefined;
    return {
      id: r.id,
      estado: r.estado,
      producto: r.producto,
      compra: r.producto === "reserva"
        ? { tipo: "reserva", id: r.reserva_id, estado: rv?.estado ?? null, fecha: rv?.fecha ?? null, hora: rv?.hora ?? null }
        : { tipo: "gift_card", grupo: r.grupo_compra_id, estado: gc ? [...gc.estados].sort().join(", ") : null, tarjetas: gc?.tarjetas ?? 0, creada: gc?.creada ?? null },
      external_reference: r.external_reference,
      con_pago: r.con_pago,
      preferencia: !!r.preferencia_id,
      importes: { original: num(r.total_original), descuento: num(r.descuento), final: num(r.total_final) },
      pago_id: r.pago_id,
      retenido_en: r.retenido_en,
      vence_en: r.vence_en,
      consumido_en: r.consumido_en ?? null,
      liberado_en: r.liberado_en ?? null,
      motivo_liberacion: r.motivo_liberacion ?? null,
      nota: r.nota,
      revisiones: Number(r.revisiones ?? 0),
      revisada_en: r.revisada_en ?? null,
      revision_resultado: r.revision_resultado ?? null,
      revision_motivo: r.revision_motivo ?? null,
      requiere_revision: requiereRevision(r, ahora),
    };
  });
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

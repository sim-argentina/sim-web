import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { distribucionCategorias, pilotoKey } from "@/lib/campeonatos";

// Devuelve la Fecha 0 (clasificación previa) del campeonato, creándola si no
// existe. La clasificación previa se apoya en esta fecha; sin ella, cargar un
// mejor tiempo no podía persistir el registro ni recalcular la categoría.
// La Fecha 0 no aparece como carrera en el público (se excluye de rankings y no
// genera pestaña ni circuito). Server-only (service role).
export async function getOrCreateFecha0(
  campeonatoId: string | null | undefined
): Promise<{ id: string; circuito: string | null } | null> {
  if (!campeonatoId) return null;

  const { data: existente } = await supabaseAdmin
    .from("campeonato_fechas")
    .select("id, circuito")
    .eq("campeonato_id", campeonatoId)
    .eq("numero_fecha", 0)
    .maybeSingle();
  if (existente) return existente;

  const { data: creada, error } = await supabaseAdmin
    .from("campeonato_fechas")
    .insert([{ campeonato_id: campeonatoId, numero_fecha: 0, nombre: "Clasificación", estado: "abierta" }])
    .select("id, circuito")
    .single();
  if (!error && creada) return creada;

  // Posible carrera / unicidad: reconsultar.
  const { data: reintento } = await supabaseAdmin
    .from("campeonato_fechas")
    .select("id, circuito")
    .eq("campeonato_id", campeonatoId)
    .eq("numero_fecha", 0)
    .maybeSingle();
  return reintento ?? null;
}

// Recalcula las categorías (oro/plata/bronce/sin_clasificar) de un campeonato a
// partir del MEJOR tiempo de cada piloto en la Fecha 0 (numero_fecha=0).
// - Respeta inscripciones con categoria_manual=true (override admin).
// - Actualiza la inscripción y todos sus registros (por inscripcion_id) para
//   mantener consistencia en turnero/rankings/puntos/público.
// Server-only (usa service role) — NUNCA importar desde el cliente.
export async function recalcularCategorias(campeonatoId: string | null | undefined): Promise<void> {
  if (!campeonatoId) return;

  // Fecha 0 del campeonato (clasificación previa).
  const { data: fecha0 } = await supabaseAdmin
    .from("campeonato_fechas")
    .select("id")
    .eq("campeonato_id", campeonatoId)
    .eq("numero_fecha", 0)
    .maybeSingle();
  if (!fecha0) return; // sin Fecha 0 no hay clasificación previa que aplicar

  // Inscripciones activas (no eliminadas) del campeonato.
  const { data: inscripciones } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("id, nombre_completo, categoria_manual")
    .eq("campeonato_id", campeonatoId)
    .is("eliminada_at", null);
  if (!inscripciones || inscripciones.length === 0) return;

  // Mejor tiempo crudo de Fecha 0 por piloto (registros válidos con tiempo).
  const { data: regs0 } = await supabaseAdmin
    .from("campeonato_registros")
    .select("inscripcion_id, nombre_completo, tiempo_crudo_ms")
    .eq("campeonato_fecha_id", fecha0.id)
    .eq("estado", "valido")
    .not("tiempo_crudo_ms", "is", null);

  const best: Record<string, number> = {};
  for (const r of regs0 ?? []) {
    const ms = Number(r.tiempo_crudo_ms);
    if (!Number.isFinite(ms)) continue;
    const k = pilotoKey(r.inscripcion_id, r.nombre_completo);
    if (best[k] === undefined || ms < best[k]) best[k] = ms;
  }

  // Clasificados (con tiempo) vs sin clasificar; se salta el override manual.
  const conTiempo: { id: string; ms: number }[] = [];
  const sinTiempo: string[] = [];
  for (const ins of inscripciones) {
    if (ins.categoria_manual) continue;
    const ms = best[`insc:${ins.id}`] ?? best[pilotoKey(null, ins.nombre_completo)];
    if (ms !== undefined) conTiempo.push({ id: ins.id, ms });
    else sinTiempo.push(ins.id);
  }

  conTiempo.sort((a, b) => a.ms - b.ms);
  const { oro, plata } = distribucionCategorias(conTiempo.length);

  // Aplicar: inscripción + todos sus registros (por inscripcion_id).
  for (let i = 0; i < conTiempo.length; i++) {
    const cat = i < oro ? "oro" : i < oro + plata ? "plata" : "bronce";
    const id = conTiempo[i].id;
    await supabaseAdmin.from("campeonato_inscripciones").update({ categoria: cat }).eq("id", id);
    await supabaseAdmin.from("campeonato_registros").update({ categoria: cat }).eq("inscripcion_id", id);
  }
  for (const id of sinTiempo) {
    await supabaseAdmin.from("campeonato_inscripciones").update({ categoria: "sin_clasificar" }).eq("id", id);
    await supabaseAdmin.from("campeonato_registros").update({ categoria: "sin_clasificar" }).eq("inscripcion_id", id);
  }
}

import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { PENALIZACION_MS, pilotoKey } from "@/lib/campeonatos";

type RouteContext = { params: Promise<{ id: string }> };

// Cierra una fecha (SOLO admin) y genera penalizaciones para la fecha siguiente.
// Idempotente: re-cerrar no duplica (short-circuit + índice único en la tabla).
export async function POST(_req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Fecha no encontrada" }, { status: 404 });
    }

    // 1) Cargar la fecha origen.
    const { data: fecha, error: fErr } = await supabaseAdmin
      .from("campeonato_fechas")
      .select("id, campeonato_id, numero_fecha, estado")
      .eq("id", id)
      .maybeSingle();
    if (fErr)
      return failResponse(500, "No se pudo completar la operación", { logContext: "cerrar load", error: fErr });
    if (!fecha) return NextResponse.json({ error: "Fecha no encontrada" }, { status: 404 });

    // Idempotencia: si ya está cerrada, no regenerar.
    if (fecha.estado === "cerrada") {
      const { data: existentes } = await supabaseAdmin
        .from("campeonato_penalizaciones")
        .select("categoria, posicion, piloto_nombre, penalizacion_ms")
        .eq("fecha_origen_id", id)
        .order("categoria")
        .order("posicion");
      return NextResponse.json({
        ok: true,
        ya_cerrada: true,
        mensaje: "La fecha ya estaba cerrada; no se regeneraron penalizaciones.",
        penalizaciones: existentes ?? [],
      });
    }

    // 2) Fecha siguiente del mismo campeonato (por numero_fecha).
    const { data: siguiente } = await supabaseAdmin
      .from("campeonato_fechas")
      .select("id, numero_fecha, nombre")
      .eq("campeonato_id", fecha.campeonato_id)
      .gt("numero_fecha", fecha.numero_fecha)
      .order("numero_fecha", { ascending: true })
      .limit(1)
      .maybeSingle();

    // 3) Ranking de la fecha origen: mejor tiempo OFICIAL por piloto por categoría.
    const { data: registros, error: rErr } = await supabaseAdmin
      .from("campeonato_registros")
      .select("inscripcion_id, nombre_completo, categoria, tiempo_oficial_ms")
      .eq("campeonato_fecha_id", id)
      .eq("estado", "valido")
      .not("tiempo_oficial_ms", "is", null);
    if (rErr)
      return failResponse(500, "No se pudo completar la operación", { logContext: "cerrar registros", error: rErr });

    type Best = { inscripcion_id: string | null; nombre: string; categoria: string; ms: number };
    const best: Record<string, Best> = {};
    for (const r of registros ?? []) {
      const cat = String(r.categoria);
      const ms = Number(r.tiempo_oficial_ms);
      if (!Number.isFinite(ms)) continue;
      const k = `${cat}__${pilotoKey(r.inscripcion_id, r.nombre_completo)}`;
      if (!best[k] || ms < best[k].ms) {
        best[k] = { inscripcion_id: r.inscripcion_id ?? null, nombre: r.nombre_completo ?? "", categoria: cat, ms };
      }
    }

    const porCat: Record<string, Best[]> = {};
    for (const b of Object.values(best)) (porCat[b.categoria] ??= []).push(b);

    // 4) Top 3 por categoría → penalizaciones para la fecha siguiente.
    type PenalRow = {
      campeonato_id: string; categoria: string; fecha_origen_id: string; fecha_destino_id: string;
      inscripcion_id: string | null; piloto_key: string; piloto_nombre: string; posicion: number; penalizacion_ms: number;
    };
    const aGenerar: PenalRow[] = [];
    if (siguiente) {
      for (const cat of Object.keys(porCat)) {
        const top = porCat[cat].sort((a, b) => a.ms - b.ms).slice(0, 3);
        top.forEach((b, idx) => {
          const posicion = idx + 1;
          aGenerar.push({
            campeonato_id: fecha.campeonato_id,
            categoria: cat,
            fecha_origen_id: id,
            fecha_destino_id: siguiente.id,
            inscripcion_id: b.inscripcion_id,
            piloto_key: pilotoKey(b.inscripcion_id, b.nombre),
            piloto_nombre: b.nombre,
            posicion,
            penalizacion_ms: PENALIZACION_MS[posicion],
          });
        });
      }
    }

    // 5) Recompute idempotente: borrar las penalizaciones previas de ESTA fecha
    //    origen y resetear la penalización de los registros de la fecha destino
    //    antes de regenerar. Soporta re-cierre tras reabrir (el ranking pudo cambiar);
    //    en un primer cierre es no-op.
    await supabaseAdmin.from("campeonato_penalizaciones").delete().eq("fecha_origen_id", id);
    if (siguiente) {
      await supabaseAdmin
        .from("campeonato_registros")
        .update({ penalizacion_ms: 0 })
        .eq("campeonato_fecha_id", siguiente.id);
    }

    // 6) Insertar penalizaciones (idempotente vía índice único) + aplicarlas a los
    //    registros ya cargados en la fecha destino (tiempo_oficial_ms se recalcula solo).
    if (aGenerar.length > 0) {
      const { error: pErr } = await supabaseAdmin
        .from("campeonato_penalizaciones")
        .upsert(aGenerar, {
          onConflict: "campeonato_id,fecha_origen_id,fecha_destino_id,categoria,piloto_key",
          ignoreDuplicates: true,
        });
      if (pErr)
        return failResponse(500, "No se pudo completar la operación", { logContext: "cerrar insert penal", error: pErr });

      for (const p of aGenerar) {
        let upd = supabaseAdmin
          .from("campeonato_registros")
          .update({ penalizacion_ms: p.penalizacion_ms })
          .eq("campeonato_fecha_id", p.fecha_destino_id)
          .eq("categoria", p.categoria);
        upd = p.inscripcion_id
          ? upd.eq("inscripcion_id", p.inscripcion_id)
          : upd.is("inscripcion_id", null).ilike("nombre_completo", p.piloto_nombre);
        await upd;
      }
    }

    // 6) Cerrar la fecha (auditoría mínima: cuándo y rol que cerró).
    const { error: cErr } = await supabaseAdmin
      .from("campeonato_fechas")
      .update({ estado: "cerrada", cerrado_at: new Date().toISOString(), cerrado_por: auth.role })
      .eq("id", id);
    if (cErr)
      return failResponse(500, "No se pudo completar la operación", { logContext: "cerrar update fecha", error: cErr });

    return NextResponse.json({
      ok: true,
      cerrada: true,
      fecha_siguiente: siguiente ? { id: siguiente.id, numero_fecha: siguiente.numero_fecha, nombre: siguiente.nombre } : null,
      penalizaciones_generadas: aGenerar.length,
      penalizaciones: aGenerar.map((p) => ({
        categoria: p.categoria,
        posicion: p.posicion,
        piloto_nombre: p.piloto_nombre,
        penalizacion_ms: p.penalizacion_ms,
      })),
      aviso: siguiente
        ? null
        : "No existe fecha siguiente; no se generaron penalizaciones.",
    });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

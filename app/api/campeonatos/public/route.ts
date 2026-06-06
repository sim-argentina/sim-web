import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const CATEGORIAS = ["oro", "plata", "bronce"] as const;

export async function GET() {
  try {
    const [campeonatosRes, sorteosRes, registrosRes, inscripcionesRes] =
      await Promise.all([
        supabaseAdmin
          .from("campeonatos")
          .select("*")
          .order("fecha_inicio", { ascending: false }),
        supabaseAdmin
          .from("sorteos")
          .select("*")
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("campeonato_registros")
          .select("*, campeonatos(nombre)")
          .eq("estado", "valido")
          .order("tiempo_segundos", { ascending: true }),
        supabaseAdmin
          .from("campeonato_inscripciones")
          .select("campeonato_id, estado_pago")
          .eq("estado_pago", "pagado"),
      ]);

    const campeonatos = campeonatosRes.data ?? [];
    const sorteos = sorteosRes.data ?? [];
    const registros = registrosRes.data ?? [];
    const inscripciones = inscripcionesRes.data ?? [];

    // Cupos por campeonato
    const insCount: Record<string, number> = {};
    for (const ins of inscripciones) {
      insCount[ins.campeonato_id] = (insCount[ins.campeonato_id] || 0) + 1;
    }

    const campeonatosConCupos = campeonatos.map((c) => ({
      ...c,
      inscriptos: insCount[c.id] || 0,
      cupos_disponibles: Math.max(
        0,
        (c.cupos_maximos || 0) - (insCount[c.id] || 0)
      ),
    }));

    // Rankings: mejor tiempo por piloto por categoría
    const rankings: Record<string, unknown[]> = { oro: [], plata: [], bronce: [] };
    for (const cat of CATEGORIAS) {
      const catReg = registros.filter((r) => r.categoria === cat);
      const pilotos: Record<string, unknown> = {};
      for (const r of catReg) {
        const key =
          r.nombre_completo || `${r.nombre || ""} ${r.apellido || ""}`.trim();
        const existing = pilotos[key] as { tiempo_segundos: number } | undefined;
        if (!existing || r.tiempo_segundos < existing.tiempo_segundos) {
          pilotos[key] = { ...r, piloto: key };
        }
      }
      rankings[cat] = Object.values(pilotos)
        .sort(
          (a: unknown, b: unknown) =>
            (a as { tiempo_segundos: number }).tiempo_segundos -
            (b as { tiempo_segundos: number }).tiempo_segundos
        )
        .map((r, i) => ({ ...(r as object), posicion: i + 1 }));
    }

    // Puntos: suma por piloto por semana por categoría
    const puntos: Record<string, unknown[]> = { oro: [], plata: [], bronce: [] };
    for (const cat of CATEGORIAS) {
      const catReg = registros.filter((r) => r.categoria === cat);
      const pilotos: Record<
        string,
        { nombre: string; semanas: Record<string, number>; total: number }
      > = {};
      for (const r of catReg) {
        const key =
          r.nombre_completo || `${r.nombre || ""} ${r.apellido || ""}`.trim();
        if (!pilotos[key]) pilotos[key] = { nombre: key, semanas: {}, total: 0 };
        const semKey = `semana_${r.semana}`;
        pilotos[key].semanas[semKey] =
          (pilotos[key].semanas[semKey] || 0) + (r.puntos || 0);
        pilotos[key].total += r.puntos || 0;
      }
      puntos[cat] = Object.values(pilotos)
        .sort((a, b) => b.total - a.total)
        .map((p, i) => ({ ...p, posicion: i + 1 }));
    }

    // Constructores: puntos por escudería
    const constMap: Record<
      string,
      { escuderia: string; puntos: number; pilotos: Set<string> }
    > = {};
    for (const r of registros) {
      if (!r.escuderia_favorita) continue;
      const key = r.escuderia_favorita;
      if (!constMap[key])
        constMap[key] = { escuderia: key, puntos: 0, pilotos: new Set() };
      constMap[key].puntos += r.puntos || 0;
      constMap[key].pilotos.add(
        r.nombre_completo || `${r.nombre || ""} ${r.apellido || ""}`.trim()
      );
    }
    const constructores = Object.values(constMap)
      .map((c) => ({
        escuderia: c.escuderia,
        puntos: c.puntos,
        pilotos: Array.from(c.pilotos),
      }))
      .sort((a, b) => b.puntos - a.puntos)
      .map((c, i) => ({ ...c, posicion: i + 1 }));

    // Resultados por fecha (todos los registros válidos para filtrar en frontend)
    const resultados_por_fecha = registros.map((r) => ({
      ...r,
      campeonato_nombre: (r as { campeonatos?: { nombre: string } }).campeonatos
        ?.nombre,
    }));

    return NextResponse.json({
      campeonatos: campeonatosConCupos,
      sorteos,
      rankings,
      puntos,
      constructores,
      resultados_por_fecha,
    });
  } catch (error) {
    console.error("Error en API pública campeonatos:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

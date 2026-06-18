import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const CATEGORIAS = ["oro", "plata", "bronce"] as const;

// Puntos F1 por posición dentro de cada semana/categoria
const F1_PUNTOS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

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

    const campeonatosConCupos = campeonatos.map((c) => ({ ...c }));

    // Rankings: mejor tiempo por piloto por categoría
    const rankings: Record<string, unknown[]> = { oro: [], plata: [], bronce: [] };
    for (const cat of CATEGORIAS) {
      const catReg = registros.filter((r) => r.categoria === cat);
      const pilotos: Record<string, unknown> = {};
      for (const r of catReg) {
        const key = r.nombre_completo || `${r.nombre} ${r.apellido || ""}`.trim();
        const ex = pilotos[key] as { tiempo_segundos: number } | undefined;
        if (!ex || r.tiempo_segundos < ex.tiempo_segundos) {
          // DTO sin PII (nunca telefono/observaciones/pagos)
          pilotos[key] = {
            piloto: key,
            tiempo: r.tiempo,
            tiempo_segundos: r.tiempo_segundos,
            circuito: r.circuito,
            fecha: r.fecha,
            categoria: r.categoria,
            escuderia_favorita: r.escuderia_favorita,
            campeonato_id: r.campeonato_id,
            simulador: r.simulador ?? null,
          };
        }
      }
      rankings[cat] = Object.values(pilotos)
        .sort((a, b) => (a as { tiempo_segundos: number }).tiempo_segundos - (b as { tiempo_segundos: number }).tiempo_segundos)
        .map((r, i) => ({ ...(r as object), posicion: i + 1 }));
    }

    // Puntos: calculados automáticamente por posición en ranking semanal (estilo F1)
    // Agrupa por campeonato + categoria + semana → ordena por mejor tiempo → asigna puntos por puesto
    const puntos: Record<string, unknown[]> = { oro: [], plata: [], bronce: [] };

    for (const cat of CATEGORIAS) {
      const catReg = registros.filter((r) => r.categoria === cat);

      // Agrupar por campeonato_id + semana
      const grupos: Record<string, typeof catReg> = {};
      for (const r of catReg) {
        const gKey = `${r.campeonato_id ?? "libre"}_${r.semana ?? 0}`;
        if (!grupos[gKey]) grupos[gKey] = [];
        grupos[gKey].push(r);
      }

      // Por cada grupo: mejor tiempo por piloto → ordena → asigna puntos F1
      const pilotoMap: Record<string, { nombre: string; semanas: Record<string, number>; total: number }> = {};

      for (const grupo of Object.values(grupos)) {
        // Mejor tiempo por piloto en este grupo
        const bestPerPilot: Record<string, { r: (typeof catReg)[0]; ts: number }> = {};
        for (const r of grupo) {
          const pKey = r.nombre_completo || `${r.nombre} ${r.apellido || ""}`.trim();
          if (!bestPerPilot[pKey] || r.tiempo_segundos < bestPerPilot[pKey].ts) {
            bestPerPilot[pKey] = { r, ts: r.tiempo_segundos };
          }
        }

        // Ordenar por mejor tiempo y asignar puntos
        const sorted = Object.entries(bestPerPilot).sort((a, b) => a[1].ts - b[1].ts);
        sorted.forEach(([piloto, { r }], idx) => {
          const pts = F1_PUNTOS[idx] ?? 0;
          if (!pilotoMap[piloto]) pilotoMap[piloto] = { nombre: piloto, semanas: {}, total: 0 };
          const semKey = `semana_${r.semana ?? 0}`;
          pilotoMap[piloto].semanas[semKey] = (pilotoMap[piloto].semanas[semKey] || 0) + pts;
          pilotoMap[piloto].total += pts;
        });
      }

      puntos[cat] = Object.values(pilotoMap)
        .sort((a, b) => b.total - a.total)
        .map((p, i) => ({ ...p, posicion: i + 1 }));
    }

    // Constructores: puntos auto-calculados acumulados por escudería
    const constMap: Record<string, { escuderia: string; puntos: number; pilotos: Set<string> }> = {};

    for (const cat of CATEGORIAS) {
      const catReg = registros.filter((r) => r.categoria === cat);

      const grupos: Record<string, typeof catReg> = {};
      for (const r of catReg) {
        const gKey = `${r.campeonato_id ?? "libre"}_${r.semana ?? 0}`;
        if (!grupos[gKey]) grupos[gKey] = [];
        grupos[gKey].push(r);
      }

      for (const grupo of Object.values(grupos)) {
        const bestPerPilot: Record<string, { r: (typeof catReg)[0]; ts: number }> = {};
        for (const r of grupo) {
          const pKey = r.nombre_completo || `${r.nombre} ${r.apellido || ""}`.trim();
          if (!bestPerPilot[pKey] || r.tiempo_segundos < bestPerPilot[pKey].ts) {
            bestPerPilot[pKey] = { r, ts: r.tiempo_segundos };
          }
        }
        const sorted = Object.entries(bestPerPilot).sort((a, b) => a[1].ts - b[1].ts);
        sorted.forEach(([piloto, { r }], idx) => {
          const pts = F1_PUNTOS[idx] ?? 0;
          const esc = r.escuderia_favorita;
          if (!esc) return;
          if (!constMap[esc]) constMap[esc] = { escuderia: esc, puntos: 0, pilotos: new Set() };
          constMap[esc].puntos += pts;
          constMap[esc].pilotos.add(piloto);
        });
      }
    }

    const constructores = Object.values(constMap)
      .map((c) => ({ escuderia: c.escuderia, puntos: c.puntos, pilotos: Array.from(c.pilotos) }))
      .sort((a, b) => b.puntos - a.puntos)
      .map((c, i) => ({ ...c, posicion: i + 1 }));

    // Calcular puntos ganados por registro individual
    // Misma lógica que puntos: agrupa por campeonato+categoria+semana, mejor tiempo por piloto, F1 pts
    const puntosXRegistro: Record<string, number> = {};
    for (const cat of CATEGORIAS) {
      const catReg = registros.filter((r) => r.categoria === cat);
      const grupos: Record<string, typeof catReg> = {};
      for (const r of catReg) {
        const gKey = `${r.campeonato_id ?? "libre"}_${r.semana ?? 0}`;
        if (!grupos[gKey]) grupos[gKey] = [];
        grupos[gKey].push(r);
      }
      for (const grupo of Object.values(grupos)) {
        const bestPerPilot: Record<string, { id: string; ts: number }> = {};
        for (const r of grupo) {
          const pKey = r.nombre_completo || `${r.nombre} ${r.apellido || ""}`.trim();
          if (!bestPerPilot[pKey] || r.tiempo_segundos < bestPerPilot[pKey].ts) {
            bestPerPilot[pKey] = { id: r.id, ts: r.tiempo_segundos };
          }
        }
        const sorted = Object.values(bestPerPilot).sort((a, b) => a.ts - b.ts);
        sorted.forEach(({ id }, idx) => {
          puntosXRegistro[id] = F1_PUNTOS[idx] ?? 0;
        });
      }
    }

    // Resultados por fecha — DTO público sin PII ni datos financieros internos.
    const resultados_por_fecha = registros.map((r) => ({
      id: r.id,
      fecha: r.fecha,
      nombre_completo: r.nombre_completo || `${r.nombre} ${r.apellido || ""}`.trim(),
      categoria: r.categoria,
      campeonato_id: r.campeonato_id,
      campeonato_nombre: (r as { campeonatos?: { nombre: string } }).campeonatos?.nombre ?? null,
      circuito: r.circuito,
      tiempo: r.tiempo,
      tiempo_segundos: r.tiempo_segundos,
      escuderia_favorita: r.escuderia_favorita,
      semana: r.semana,
      simulador: r.simulador ?? null,
      puntos_ganados: puntosXRegistro[r.id] ?? 0,
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

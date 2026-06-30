import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { normalizeEscuderia, pilotoKey } from "@/lib/campeonatos";

const CATEGORIAS = ["oro", "plata", "bronce"] as const;

// Puntos F1 por posición dentro de cada semana/categoria
const F1_PUNTOS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// Tiempo OFICIAL en ms para rankear. Usa tiempo_oficial_ms (crudo+penalización)
// cuando existe; fallback seguro a tiempo_crudo_ms y, para históricos sin ms, a
// tiempo_segundos. 999999000 = "sin tiempo" (sentinela, ordena último).
function oficialMs(r: {
  tiempo_oficial_ms?: number | null;
  tiempo_crudo_ms?: number | null;
  tiempo_segundos?: number | null;
}): number {
  if (r.tiempo_oficial_ms != null) return r.tiempo_oficial_ms;
  if (r.tiempo_crudo_ms != null) return r.tiempo_crudo_ms;
  if (r.tiempo_segundos != null) return Math.round(Number(r.tiempo_segundos) * 1000);
  return 999999000;
}

export async function GET(req: Request) {
  // Defensa en profundidad: además del cache de edge, límite por IP en cache-miss.
  if (!(await rateLimit(`camp-public:${clientIp(req)}`, 120, 60_000))) {
    return tooManyResponse();
  }
  try {
    const [campeonatosRes, sorteosRes, registrosRes, inscripcionesRes, fechasRes] =
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
          .select("id, campeonato_id, nombre_completo, categoria, estado_pago")
          .eq("estado_pago", "pagado")
          .is("eliminada_at", null),
        supabaseAdmin
          .from("campeonato_fechas")
          .select("id, campeonato_id, numero_fecha, nombre, circuito, estado")
          .order("numero_fecha", { ascending: true }),
      ]);

    const campeonatos = campeonatosRes.data ?? [];
    const sorteos = sorteosRes.data ?? [];
    const inscripciones = inscripcionesRes.data ?? [];
    const fechas = fechasRes.data ?? [];

    // La Fecha 0 (clasificación previa) NO entra en rankings/puntos oficiales: se
    // separa de los registros que alimentan el ranking.
    const fecha0Ids = new Set(
      (fechas as { id: string; numero_fecha: number }[])
        .filter((f) => Number(f.numero_fecha) === 0)
        .map((f) => f.id)
    );
    const registrosRaw = registrosRes.data ?? [];
    const registrosFecha0 = registrosRaw.filter(
      (r: { campeonato_fecha_id?: string | null }) => r.campeonato_fecha_id != null && fecha0Ids.has(r.campeonato_fecha_id)
    );
    const registros = registrosRaw.filter(
      (r: { campeonato_fecha_id?: string | null }) => !(r.campeonato_fecha_id != null && fecha0Ids.has(r.campeonato_fecha_id))
    );

    const campeonatosConCupos = campeonatos.map((c) => ({ ...c }));

    // Rankings: mejor tiempo por piloto por categoría
    const rankings: Record<string, unknown[]> = { oro: [], plata: [], bronce: [] };
    for (const cat of CATEGORIAS) {
      const catReg = registros.filter((r) => r.categoria === cat);
      const pilotos: Record<string, unknown> = {};
      for (const r of catReg) {
        const key = r.nombre_completo || `${r.nombre} ${r.apellido || ""}`.trim();
        const ofi = oficialMs(r);
        const ex = pilotos[key] as { oficial_ms: number } | undefined;
        if (!ex || ofi < ex.oficial_ms) {
          // DTO sin PII (nunca telefono/observaciones/pagos)
          pilotos[key] = {
            piloto: key,
            tiempo: r.tiempo,
            tiempo_segundos: r.tiempo_segundos,
            tiempo_crudo_ms: r.tiempo_crudo_ms ?? null,
            penalizacion_ms: r.penalizacion_ms ?? 0,
            tiempo_oficial_ms: r.tiempo_oficial_ms ?? null,
            oficial_ms: ofi,
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
        .sort((a, b) => (a as { oficial_ms: number }).oficial_ms - (b as { oficial_ms: number }).oficial_ms)
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
          const ofi = oficialMs(r);
          if (!bestPerPilot[pKey] || ofi < bestPerPilot[pKey].ts) {
            bestPerPilot[pKey] = { r, ts: ofi };
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
          const ofi = oficialMs(r);
          if (!bestPerPilot[pKey] || ofi < bestPerPilot[pKey].ts) {
            bestPerPilot[pKey] = { r, ts: ofi };
          }
        }
        const sorted = Object.entries(bestPerPilot).sort((a, b) => a[1].ts - b[1].ts);
        sorted.forEach(([piloto, { r }], idx) => {
          const pts = F1_PUNTOS[idx] ?? 0;
          const esc = normalizeEscuderia(r.escuderia_favorita);
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
          const ofi = oficialMs(r);
          if (!bestPerPilot[pKey] || ofi < bestPerPilot[pKey].ts) {
            bestPerPilot[pKey] = { id: r.id, ts: ofi };
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
      tiempo_crudo_ms: r.tiempo_crudo_ms ?? null,
      penalizacion_ms: r.penalizacion_ms ?? 0,
      tiempo_oficial_ms: r.tiempo_oficial_ms ?? null,
      escuderia_favorita: r.escuderia_favorita,
      semana: r.semana,
      simulador: r.simulador ?? null,
      puntos_ganados: puntosXRegistro[r.id] ?? 0,
    }));

    // Clasificación previa (Fecha 0): por piloto inscripto, mejor tiempo de Fecha 0
    // + categoría asignada (o "pendiente"). Sin PII (solo nombre + categoría + tiempo).
    const bestFecha0: Record<string, { tiempo: string | null; ms: number }> = {};
    for (const r of registrosFecha0 as {
      inscripcion_id?: string | null; nombre_completo?: string | null; tiempo?: string | null; tiempo_crudo_ms?: number | null;
    }[]) {
      const ms = Number(r.tiempo_crudo_ms);
      if (!Number.isFinite(ms)) continue;
      const k = pilotoKey(r.inscripcion_id, r.nombre_completo);
      if (!bestFecha0[k] || ms < bestFecha0[k].ms) bestFecha0[k] = { tiempo: r.tiempo ?? null, ms };
    }
    const clasificacion = (inscripciones as {
      id: string; nombre_completo?: string | null; categoria?: string | null; campeonato_id?: string | null;
    }[]).map((ins) => {
      const best = bestFecha0[`insc:${ins.id}`] ?? bestFecha0[pilotoKey(null, ins.nombre_completo)];
      return {
        piloto: ins.nombre_completo ?? "",
        campeonato_id: ins.campeonato_id ?? null,
        categoria: ins.categoria ?? "sin_clasificar",
        tiempo: best?.tiempo ?? null,
        tiempo_oficial_ms: best?.ms ?? null,
        pendiente: !best,
      };
    });

    return NextResponse.json(
      {
        campeonatos: campeonatosConCupos,
        fechas,
        clasificacion,
        sorteos,
        rankings,
        puntos,
        constructores,
        resultados_por_fecha,
      },
      {
        // Cache en el edge de Vercel: la query pesada pega a la DB como máximo
        // una vez por minuto, sin importar el volumen de tráfico (defensa DoS).
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error("Error en API pública campeonatos:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

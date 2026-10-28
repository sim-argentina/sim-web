import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { hoyEnSim } from "@/lib/agenda";
import {
  comparar,
  enRango,
  filtrar,
  hallazgos,
  leerParametros,
  minutoEnSim,
  rangoComparacion,
  rangoDePreset,
  resumir,
} from "@/lib/metricasStandDashboard";
import { operacionesEntre, primeraFechaConDatos } from "@/lib/metricasStandServer";

// GET /api/admin/metricas/stand — resumen del dashboard del Stand.
// Devuelve el período pedido y el de comparación ya agregados (KB, no el
// historial): cada cifra sale de lib/metricasStandDashboard.ts, la misma
// definición que usa el detalle (/operaciones). Staff y admin. Solo lectura.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const sp = new URL(req.url).searchParams;
    const p = leerParametros(sp);
    const ahora = new Date();
    const hoy = hoyEnSim(ahora);
    const minuto = minutoEnSim(ahora);
    const fresco = sp.get("fresco") === "1";

    const rango = rangoDePreset(p.preset, hoy, minuto, p.desde && p.hasta ? { desde: p.desde, hasta: p.hasta } : undefined);
    const comp = rangoComparacion(rango, p.preset, p.comparar);
    const [opsA, opsB, datosDesde] = await Promise.all([
      operacionesEntre(rango.desde, rango.hasta, { fresco }),
      comp ? operacionesEntre(comp.desde, comp.hasta, { fresco }) : Promise.resolve(null),
      primeraFechaConDatos(),
    ]);
    // "Todo": el período empieza en el primer dato, no en una fecha arbitraria.
    if (p.preset === "todo" && datosDesde && datosDesde > rango.desde) rango.desde = datosDesde;

    const actual = resumir(filtrar(enRango(opsA, rango), p.filtros), rango, hoy);
    const anterior = comp && opsB ? resumir(filtrar(enRango(opsB, comp), p.filtros), comp, hoy) : null;
    const comparacion = anterior ? comparar(actual, anterior) : null;

    return NextResponse.json(
      {
        generado: ahora.toISOString(),
        hoy,
        minuto,
        datosDesde,
        parametros: p,
        actual,
        anterior,
        comparacion,
        lectura: hallazgos(actual, anterior, comparacion),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failResponse(500, "No se pudieron calcular las métricas del Stand", { logContext: "metricas-stand", error });
  }
}

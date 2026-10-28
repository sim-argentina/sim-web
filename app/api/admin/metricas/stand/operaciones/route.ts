import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { hoyEnSim } from "@/lib/agenda";
import {
  combinar,
  enRango,
  filtrar,
  leerParametros,
  leerSeleccion,
  minutoEnSim,
  paginaDetalle,
  rangoComparacion,
  rangoDePreset,
  type OrdenDetalle,
} from "@/lib/metricasStandDashboard";
import { operacionesEntre, primeraFechaConDatos } from "@/lib/metricasStandServer";

// GET /api/admin/metricas/stand/operaciones — las ventas concretas detrás de una
// cifra del dashboard, paginadas. Usa el MISMO período, los MISMOS filtros y las
// MISMAS funciones que el resumen; la selección (parámetros s_*) los acota. El
// contexto devuelto (operaciones, personas, importe) es el total de TODO el
// conjunto, no solo de la página. Staff y admin. Solo lectura.

export const dynamic = "force-dynamic";

const ORDENES: OrdenDetalle[] = ["reciente", "antiguo", "importe", "personas", "espera"];

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const sp = new URL(req.url).searchParams;
    const p = leerParametros(sp);
    const seleccion = leerSeleccion(sp);
    const orden = (ORDENES as string[]).includes(sp.get("orden") ?? "") ? (sp.get("orden") as OrdenDetalle) : "reciente";
    const pagina = Number(sp.get("pagina")) || 1;
    const periodo = sp.get("periodo") === "comparacion" ? "comparacion" : "actual";

    const ahora = new Date();
    const hoy = hoyEnSim(ahora);
    const actual = rangoDePreset(p.preset, hoy, minutoEnSim(ahora), p.desde && p.hasta ? { desde: p.desde, hasta: p.hasta } : undefined);
    if (p.preset === "todo") {
      const datosDesde = await primeraFechaConDatos();
      if (datosDesde && datosDesde > actual.desde) actual.desde = datosDesde;
    }
    const rango = periodo === "comparacion" ? rangoComparacion(actual, p.preset, p.comparar) : actual;
    if (!rango) return NextResponse.json({ error: "Este período no tiene comparación." }, { status: 400 });

    const criterios = combinar(p.filtros, seleccion);
    const ops = filtrar(enRango(await operacionesEntre(rango.desde, rango.hasta), rango), criterios);
    return NextResponse.json(
      { rango, periodo, criterios, ...paginaDetalle(ops, orden, pagina, seleccion.medio) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failResponse(500, "No se pudieron listar las operaciones", { logContext: "metricas-stand-operaciones", error });
  }
}

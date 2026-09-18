import { NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import {
  esEstadoFiltro, listarMensualidades, POR_PAGINA, POR_PAGINA_MAX,
} from "@/lib/mensualidadesAdmin";

// Listado administrativo de Mensualidades (Bloque M7).
//
// Lo pueden leer admin y staff: quien atiende necesita encontrar la mensualidad
// de quien tiene enfrente. Ninguna escritura vive acá.
//
// NO depende de MENSUALIDADES_ENABLED: esa flag oculta la experiencia PÚBLICA.
// La administración tiene que poder trabajar antes del lanzamiento, que es
// justamente para lo que existe este bloque.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const estadoCrudo = url.searchParams.get("estado") ?? "todas";
    if (!esEstadoFiltro(estadoCrudo)) {
      return NextResponse.json({ error: "Filtro inválido" }, { status: 400, headers: sinCache });
    }

    const paginaCruda = url.searchParams.get("pagina") ?? "1";
    if (!/^\d{1,6}$/.test(paginaCruda)) {
      return NextResponse.json({ error: "Página inválida" }, { status: 400, headers: sinCache });
    }

    const porPaginaCrudo = url.searchParams.get("por_pagina");
    if (porPaginaCrudo !== null && !/^\d{1,3}$/.test(porPaginaCrudo)) {
      return NextResponse.json({ error: "Tamaño de página inválido" }, { status: 400, headers: sinCache });
    }

    const listado = await listarMensualidades({
      busqueda: url.searchParams.get("q"),
      estado: estadoCrudo,
      pagina: Number(paginaCruda),
      porPagina: porPaginaCrudo ? Math.min(Number(porPaginaCrudo), POR_PAGINA_MAX) : POR_PAGINA,
    });

    return NextResponse.json(listado, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo cargar el listado", {
      logContext: "admin-mensualidades-listar", error,
    });
  }
}

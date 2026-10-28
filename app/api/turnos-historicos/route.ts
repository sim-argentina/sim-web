import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { hoyEnSim } from "@/lib/agenda";
import { validarLoteHistorico } from "@/lib/historicosStand";
import { borrarImportacionHistorica, guardarTurnosHistoricos, resumenImportaciones } from "@/lib/historicosStandServer";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    // Filtros opcionales por fecha/rango/importación: permiten no leer toda la
    // tabla histórica cuando solo se necesita un subconjunto. Sin parámetros
    // mantiene el comportamiento anterior (todos los registros), que usan las
    // métricas. Se apoya en el orden por fecha (índice recomendado).
    const { searchParams } = new URL(req.url);

    // ?resumen=archivos — una fila por importación (archivo + año), sin bajar
    // las ventas: es lo único que necesita el panel "Históricos importados".
    if (searchParams.get("resumen") === "archivos") {
      const r = await resumenImportaciones();
      if (!r.ok) {
        return failResponse(500, "No se pudo completar la operación", { logContext: "turnos-historicos", error: r.error });
      }
      return NextResponse.json({ importaciones: r.importaciones });
    }

    const fecha = searchParams.get("fecha");
    const desde = searchParams.get("desde");
    const hasta = searchParams.get("hasta");
    const archivoKey = searchParams.get("archivo_key");

    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      let query = supabaseAdmin
        .from("turnos_historicos")
        .select("*")
        .order("fecha", { ascending: true })
        .order("hora_subida", { ascending: true });

      if (fecha && FECHA_RE.test(fecha)) {
        query = query.eq("fecha", fecha);
      } else {
        if (desde && FECHA_RE.test(desde)) query = query.gte("fecha", desde);
        if (hasta && FECHA_RE.test(hasta)) query = query.lte("fecha", hasta);
      }
      if (archivoKey) query = query.eq("archivo_key", archivoKey);

      const { data, error } = await query.range(from, from + pageSize - 1);

      if (error) {
        return failResponse(500, "No se pudo completar la operación", { logContext: "turnos-historicos", error });
      }

      allData = [...allData, ...(data || [])];

      if (!data || data.length < pageSize) break;

      from += pageSize;
    }

    return NextResponse.json({ turnos: allData });
  } catch (error) {
    console.error("GET turnos_historicos error:", error);
    return NextResponse.json(
      { error: "Error interno cargando turnos históricos" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();

    const turnos = body?.turnos;

    // El año de cada archivo lo confirma quien importa; acá se rechaza cualquier
    // fecha inexistente o futura, y un hash que no corresponda a la fecha.
    const invalido = validarLoteHistorico(turnos, hoyEnSim());
    if (invalido) {
      return NextResponse.json({ error: invalido }, { status: 400 });
    }

    const r = await guardarTurnosHistoricos(turnos);

    if (!r.ok) {
      return failResponse(500, "No se pudo completar la operación", { logContext: "turnos-historicos", error: r.error });
    }

    return NextResponse.json({
      ok: true,
      recibidos: r.recibidos,
      insertados: r.insertados,
    });
  } catch (error) {
    console.error("POST turnos_historicos error:", error);
    return NextResponse.json(
      { error: "Error interno guardando turnos históricos" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(req.url);
    const archivoKey = searchParams.get("archivo_key");
    const anioParam = searchParams.get("anio");

    if (!archivoKey) {
      return NextResponse.json(
        { error: "Falta archivo_key" },
        { status: 400 }
      );
    }

    if (anioParam !== null && !/^\d{4}$/.test(anioParam)) {
      return NextResponse.json({ error: "Año inválido" }, { status: 400 });
    }

    const r = await borrarImportacionHistorica(archivoKey, anioParam === null ? null : Number(anioParam));

    if (!r.ok) {
      return failResponse(500, "No se pudo completar la operación", { logContext: "turnos-historicos", error: r.error });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE turnos_historicos error:", error);
    return NextResponse.json(
      { error: "Error interno borrando importación" },
      { status: 500 }
    );
  }
}
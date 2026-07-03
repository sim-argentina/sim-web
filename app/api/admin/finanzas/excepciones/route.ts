import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { FECHA_RE, getExcepcionesMes, mesValido, registrarFinLog } from "@/lib/finanzas";

// Excepciones operativas por fecha: día cerrado, horas u/o simuladores distintos
// al default. Se usan para capacidad y ocupación. GET por mes.

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const mes = req.nextUrl.searchParams.get("mes") || "";
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
  }
  try {
    const excepciones = await getExcepcionesMes(mes);
    return NextResponse.json({ mes, excepciones });
  } catch (error) {
    return failResponse(500, "Error cargando excepciones", { logContext: "finanzas excepciones GET", error });
  }
}

// POST { fecha, cerrado?, horas?, simuladores?, motivo? } → upsert por fecha
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const fecha = String(body.fecha || "").trim();
  if (!FECHA_RE.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida (YYYY-MM-DD)" }, { status: 400 });
  }

  const cerrado = body.cerrado === true;

  let horas: number | null = null;
  if (body.horas !== undefined && body.horas !== null && body.horas !== "") {
    horas = Number(body.horas);
    if (!Number.isFinite(horas) || horas < 0 || horas > 24) {
      return NextResponse.json({ error: "Horas inválidas (0 a 24)" }, { status: 400 });
    }
  }

  let simuladores: number | null = null;
  if (body.simuladores !== undefined && body.simuladores !== null && body.simuladores !== "") {
    simuladores = Math.trunc(Number(body.simuladores));
    if (!Number.isFinite(simuladores) || simuladores < 0 || simuladores > 50) {
      return NextResponse.json({ error: "Simuladores inválidos (0 a 50)" }, { status: 400 });
    }
  }

  if (!cerrado && horas === null && simuladores === null) {
    return NextResponse.json({ error: "Indicá cerrado, horas o simuladores" }, { status: 400 });
  }

  const motivo = body.motivo ? String(body.motivo).slice(0, 200) : null;

  const { data, error } = await supabaseAdmin
    .from("fin_excepciones_operativas")
    .upsert([{ fecha, cerrado, horas: cerrado ? null : horas, simuladores: cerrado ? null : simuladores, motivo }], {
      onConflict: "fecha",
    })
    .select()
    .single();

  if (error) {
    return failResponse(500, "Error guardando excepción", { logContext: "finanzas excepciones POST", error });
  }

  await registrarFinLog("upsert_excepcion", "fin_excepciones_operativas", fecha, { cerrado, horas, simuladores }, auth.role);
  return NextResponse.json({ excepcion: data }, { status: 201 });
}

// DELETE ?fecha=YYYY-MM-DD → quita la excepción de esa fecha
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const fecha = req.nextUrl.searchParams.get("fecha") || "";
  if (!FECHA_RE.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida (YYYY-MM-DD)" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("fin_excepciones_operativas").delete().eq("fecha", fecha);
  if (error) {
    return failResponse(500, "Error eliminando excepción", { logContext: "finanzas excepciones DELETE", error });
  }
  await registrarFinLog("eliminar_excepcion", "fin_excepciones_operativas", fecha, {}, auth.role);
  return NextResponse.json({ ok: true });
}

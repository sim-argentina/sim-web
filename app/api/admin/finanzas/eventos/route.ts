import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { FECHA_RE, mesActual, mesValido, registrarFinLog } from "@/lib/finanzas";
import { estaVencido, getEventosRango, hoyISO, validarEvento } from "@/lib/finanzasEventos";

// GET ?mes=YYYY-MM  ó  ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve eventos con flag calculado `vencido` (no se persiste).
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams;
  let desde = q.get("desde") || "";
  let hasta = q.get("hasta") || "";

  if (!desde || !hasta) {
    const mes = q.get("mes") || mesActual();
    if (!mesValido(mes)) {
      return NextResponse.json({ error: "Mes inválido (YYYY-MM)" }, { status: 400 });
    }
    desde = `${mes}-01`;
    hasta = `${mes}-31`;
  }
  if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta) || desde > hasta) {
    return NextResponse.json({ error: "Rango de fechas inválido" }, { status: 400 });
  }

  try {
    const hoy = hoyISO();
    const eventos = (await getEventosRango(desde, hasta)).map((e) => ({
      ...e,
      vencido: estaVencido(e, hoy),
    }));
    return NextResponse.json({ desde, hasta, hoy, eventos });
  } catch (error) {
    return failResponse(500, "Error cargando eventos", { logContext: "finanzas eventos GET", error });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const val = await validarEvento(body);
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("fin_eventos_futuros")
    .insert([{ ...val.row, creado_por: auth.role }])
    .select()
    .single();

  if (error) {
    return failResponse(500, "Error creando evento", { logContext: "finanzas eventos POST", error });
  }

  await registrarFinLog("crear", "fin_eventos_futuros", data.id, { tipo: data.tipo, monto: data.monto, fecha: data.fecha }, auth.role);
  return NextResponse.json({ evento: data }, { status: 201 });
}

import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";

function tiempoASegundos(tiempo: string): number {
  if (!tiempo?.trim()) return 999999;
  const t = tiempo.trim();
  if (t.includes(":")) {
    const [mins, secs] = t.split(":");
    return parseFloat(mins) * 60 + parseFloat(secs || "0");
  }
  return parseFloat(t) || 999999;
}

// Calcula la semana ISO del año para agrupar resultados semanales automáticamente
function getISOWeek(dateStr: string): number {
  const date = new Date(dateStr + "T00:00:00Z");
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(req.url);
    const nombre = sanitizeSearchTerm(url.searchParams.get("nombre"));
    const campeonato_id = url.searchParams.get("campeonato_id");
    const categoria = url.searchParams.get("categoria");
    const circuito = url.searchParams.get("circuito");
    const estado = url.searchParams.get("estado");
    const fecha = url.searchParams.get("fecha");
    const desde = url.searchParams.get("desde");
    const hasta = url.searchParams.get("hasta");

    let query = supabaseAdmin
      .from("campeonato_registros")
      .select("*, campeonatos(nombre)")
      .order("created_at", { ascending: false });

    if (nombre) query = query.ilike("nombre_completo", `%${nombre}%`);
    if (campeonato_id) query = query.eq("campeonato_id", campeonato_id);
    if (categoria) query = query.eq("categoria", categoria);
    if (circuito) query = query.eq("circuito", circuito);
    if (estado) query = query.eq("estado", estado);
    if (fecha) query = query.eq("fecha", fecha);
    // Rango de fechas (fecha es texto ISO YYYY-MM-DD, el orden lexicográfico coincide)
    if (desde) query = query.gte("fecha", desde);
    if (hasta) query = query.lte("fecha", hasta);

    const { data, error } = await query;
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/registros", error });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();

    if (!body.nombre?.trim() || !body.apellido?.trim() || !body.telefono?.trim() || !body.fecha || !body.categoria) {
      return NextResponse.json(
        { error: "Nombre, apellido, teléfono, fecha y categoría son obligatorios" },
        { status: 400 }
      );
    }

    const nombre_completo = `${body.nombre.trim()} ${body.apellido.trim()}`.trim();
    const tiempo_segundos = tiempoASegundos(body.tiempo || "");
    // Semana calculada automáticamente desde la fecha (ISO week)
    const semana = getISOWeek(body.fecha);

    const { data, error } = await supabaseAdmin
      .from("campeonato_registros")
      .insert([
        {
          fecha: body.fecha,
          hora: body.hora || null,
          hora_estimada_subida: body.hora_estimada_subida || null,
          hora_subida: body.hora_subida || null,
          hora_bajada: body.hora_bajada || null,
          nombre: body.nombre.trim(),
          apellido: body.apellido.trim(),
          nombre_completo,
          telefono: body.telefono.trim(),
          categoria: body.categoria,
          campeonato_id: body.campeonato_id || null,
          campeonato_fecha_id: body.campeonato_fecha_id || null,
          circuito: body.circuito || null,
          tiempo: body.tiempo || null,
          tiempo_segundos,
          semana,
          escuderia_favorita: body.escuderia_favorita || null,
          observaciones: body.observaciones || null,
          estado: "valido",
          cantidad_minutos: Number(body.cantidad_minutos) || 15,
          cantidad_turnos: Number(body.cantidad_turnos) || 1,
          turno_listo: body.turno_listo === true,
          pagos_detalle: body.pagos_detalle || null,
          total: Number(body.total) || 0,
          // puntos siempre en 0: se calculan automáticamente por posición en el ranking público
          puntos: 0,
          simulador: null,
        },
      ])
      .select()
      .single();

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/registros", error });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

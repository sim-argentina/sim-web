import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";
import { tiempoToMs } from "@/lib/campeonatos";
import { recalcularCategorias } from "@/lib/campeonatosCategorias";

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const {
      nombre, apellido, telefono, dni, instagram,
      escuderia_favorita, categoria, campeonato_id, monto, metodo_pago,
      hora_toma, hora_subida, hora_bajada, cantidad_minutos,
    } = body;

    if (!nombre?.trim() || !apellido?.trim() || !telefono?.trim() || !dni?.trim() || !escuderia_favorita || !categoria || !campeonato_id || !monto || !metodo_pago) {
      return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    const montoFinal = Math.round(Number(monto));
    if (!Number.isFinite(montoFinal) || montoFinal <= 0) {
      return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    }

    const nombre_completo = `${nombre.trim()} ${apellido.trim()}`.trim();

    const { data, error } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .insert([{
        campeonato_id,
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        nombre_completo,
        telefono: telefono.trim(),
        dni: dni.trim(),
        instagram: instagram?.trim() || null,
        escuderia_favorita,
        categoria,
        monto: montoFinal,
        estado_pago: "pagado",
        metodo_pago,
        // Datos operativos del turno incluidos con la inscripción (#4). Opcionales.
        hora_toma: typeof hora_toma === "string" && hora_toma.trim() ? hora_toma.trim() : null,
        hora_subida: typeof hora_subida === "string" && hora_subida.trim() ? hora_subida.trim() : null,
        hora_bajada: typeof hora_bajada === "string" && hora_bajada.trim() ? hora_bajada.trim() : null,
        cantidad_minutos: Number.isFinite(Number(cantidad_minutos)) && Number(cantidad_minutos) > 0 ? Math.round(Number(cantidad_minutos)) : null,
      }])
      .select("id")
      .single();

    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones", error });

    // Tiempo de clasificación opcional (Fecha 0): si se carga, crea el registro
    // vinculado a la inscripción en la Fecha 0 (sin penalización, sin puntos) y
    // recalcula las categorías. Si no, la inscripción queda "Sin clasificar".
    const tiempoClasif = typeof body.tiempo_clasificacion === "string" ? body.tiempo_clasificacion.trim() : "";
    if (tiempoClasif) {
      const crudoMs = tiempoToMs(tiempoClasif);
      const { data: fecha0 } = await supabaseAdmin
        .from("campeonato_fechas")
        .select("id, circuito")
        .eq("campeonato_id", campeonato_id)
        .eq("numero_fecha", 0)
        .maybeSingle();
      if (fecha0 && crudoMs != null) {
        await supabaseAdmin.from("campeonato_registros").insert([{
          campeonato_id,
          campeonato_fecha_id: fecha0.id,
          inscripcion_id: data.id,
          categoria: "sin_clasificar",
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          nombre_completo,
          telefono: telefono.trim(),
          escuderia_favorita,
          circuito: fecha0.circuito || null,
          tiempo: tiempoClasif,
          tiempo_crudo_ms: crudoMs,
          penalizacion_ms: 0,
          estado: "valido",
          fecha: new Date().toISOString().slice(0, 10),
        }]);
        await recalcularCategorias(campeonato_id);
      }
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(req.url);
    const campeonato_id = url.searchParams.get("campeonato_id");
    const categoria = url.searchParams.get("categoria");
    const estado_pago = url.searchParams.get("estado_pago");
    const q = sanitizeSearchTerm(url.searchParams.get("q"));

    let query = supabaseAdmin
      .from("campeonato_inscripciones")
      .select("*, campeonatos(nombre)")
      .is("eliminada_at", null)
      .order("created_at", { ascending: false });

    if (campeonato_id) query = query.eq("campeonato_id", campeonato_id);
    if (categoria) query = query.eq("categoria", categoria);
    if (estado_pago) query = query.eq("estado_pago", estado_pago);
    if (q) {
      query = query.or(
        `nombre_completo.ilike.%${q}%,dni.ilike.%${q}%,telefono.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones", error });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

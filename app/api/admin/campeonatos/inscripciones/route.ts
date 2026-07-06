import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";
import { tiempoToMs, msToTiempo, inscripcionEstaLista } from "@/lib/campeonatos";
import { recalcularCategorias, getOrCreateFecha0 } from "@/lib/campeonatosCategorias";

// Métodos de pago aceptados en el stand (mismos que el Turnero). "online" y
// "mercadopago" representan un pago online ya realizado (no requiere stand).
const METODOS_STAND = ["qr", "efectivo", "debito", "credito", "transferencia", "stand", "multiple"];

type PagoLimpio = { metodo_pago: string; monto: number; posnet_pago: string | null };

// Normaliza pagos parciales (igual que el Turnero): descarta montos no positivos.
function limpiarPagos(input: unknown): PagoLimpio[] {
  if (!Array.isArray(input)) return [];
  const out: PagoLimpio[] = [];
  for (const p of input) {
    if (!p || typeof p !== "object") continue;
    const metodo = String((p as Record<string, unknown>).metodo_pago ?? "").trim();
    const monto = Math.round(Number((p as Record<string, unknown>).monto) || 0);
    if (!metodo || !Number.isFinite(monto) || monto <= 0) continue;
    const posnetRaw = (p as Record<string, unknown>).posnet_pago;
    const posnet = typeof posnetRaw === "string" && posnetRaw.trim() ? posnetRaw.trim() : null;
    out.push({ metodo_pago: metodo, monto, posnet_pago: posnet });
  }
  return out;
}

const txt = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// Columnas operativas nuevas (hora_estimada_subida, pagos_detalle). Si la
// migración todavía no corrió, Postgres devuelve PGRST204: en ese caso se
// reintenta sin esas columnas para no romper el alta. Cuando la migración
// esté aplicada, este fallback simplemente no se usa.
function faltanColumnasNuevas(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  return error.code === "PGRST204" || msg.includes("pagos_detalle") || msg.includes("hora_estimada_subida");
}

export async function POST(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json();
    const {
      nombre, apellido, telefono, dni, instagram,
      escuderia_favorita, categoria, campeonato_id, monto, metodo_pago,
      hora_toma, hora_estimada_subida, hora_subida, hora_bajada, cantidad_minutos,
      pagos_detalle, observaciones,
    } = body;

    // Únicos obligatorios: nombre, apellido, DNI, teléfono y campeonato.
    // Categoría, escudería, monto y método de pago son opcionales: el piloto
    // puede inscribirse primero y correr / pagar después.
    if (!nombre?.trim() || !apellido?.trim() || !telefono?.trim() || !dni?.trim() || !campeonato_id) {
      return NextResponse.json(
        { error: "Faltan datos obligatorios (nombre, apellido, DNI, teléfono y campeonato)" },
        { status: 400 }
      );
    }

    // Pagos múltiples (opcional). Si vienen, definen el total y el estado.
    const pagos = limpiarPagos(pagos_detalle);
    const totalPagos = pagos.reduce((s, p) => s + p.monto, 0);

    // Monto: explícito > suma de pagos > precio del campeonato > 0.
    let montoFinal = 0;
    if (monto !== undefined && monto !== null && monto !== "" && Number.isFinite(Number(monto))) {
      montoFinal = Math.round(Number(monto));
    } else if (totalPagos > 0) {
      montoFinal = totalPagos;
    } else {
      const { data: camp } = await supabaseAdmin
        .from("campeonatos")
        .select("precio_inscripcion")
        .eq("id", campeonato_id)
        .maybeSingle();
      montoFinal = Math.round(Number(camp?.precio_inscripcion) || 0);
    }
    if (!Number.isFinite(montoFinal) || montoFinal < 0) montoFinal = 0;

    // Método + estado de pago:
    // - pagos múltiples o método de stand → pagado en el stand.
    // - online / mercadopago → pagado online (no requiere cobro en el stand).
    // - sin método → queda inscripto con pago pendiente en stand.
    const esOnline = metodo_pago === "online" || metodo_pago === "mercadopago";
    let metodoFinal: string | null;
    let estadoFinal: string;
    if (pagos.length > 0) {
      metodoFinal = pagos.length === 1 ? pagos[0].metodo_pago : "multiple";
      estadoFinal = "pagado";
    } else if (esOnline) {
      metodoFinal = "mercadopago";
      estadoFinal = "pagado";
    } else if (metodo_pago && METODOS_STAND.includes(String(metodo_pago).trim())) {
      metodoFinal = String(metodo_pago).trim();
      estadoFinal = "pagado";
    } else {
      metodoFinal = null;
      estadoFinal = "pendiente_pago_stand";
    }

    const nombre_completo = `${nombre.trim()} ${apellido.trim()}`.trim();
    const categoriaTrim = txt(categoria);
    const minutos = Number.isFinite(Number(cantidad_minutos)) && Number(cantidad_minutos) > 0
      ? Math.round(Number(cantidad_minutos)) : null;

    const insertRow: Record<string, unknown> = {
      campeonato_id,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      nombre_completo,
      telefono: telefono.trim(),
      dni: dni.trim(),
      instagram: txt(instagram),
      // La columna es NOT NULL; escudería opcional se guarda como cadena vacía.
      escuderia_favorita: txt(escuderia_favorita) ?? "",
      categoria: categoriaTrim,
      // Si el staff asigna categoría a mano, se marca manual para que la
      // auto-clasificación por tiempo no la pise. Si queda vacía, la define el tiempo.
      categoria_manual: Boolean(categoriaTrim),
      monto: montoFinal,
      estado_pago: estadoFinal,
      metodo_pago: metodoFinal,
      pagos_detalle: pagos.length > 0 ? pagos : null,
      observaciones: txt(observaciones),
      // Datos operativos del turno (opcionales), igual que el Turnero.
      hora_toma: txt(hora_toma),
      hora_estimada_subida: txt(hora_estimada_subida),
      hora_subida: txt(hora_subida),
      hora_bajada: txt(hora_bajada),
      cantidad_minutos: minutos,
    };

    let { data, error } = await supabaseAdmin
      .from("campeonato_inscripciones")
      .insert([insertRow])
      .select("id")
      .single();

    if (error && faltanColumnasNuevas(error)) {
      const compat = { ...insertRow };
      delete compat.hora_estimada_subida;
      delete compat.pagos_detalle;
      ({ data, error } = await supabaseAdmin
        .from("campeonato_inscripciones")
        .insert([compat])
        .select("id")
        .single());
    }

    if (error || !data) return failResponse(500, "No se pudo completar la operación", { logContext: "admin/campeonatos/inscripciones", error });

    // Tiempo de clasificación opcional (Fecha 0): si se carga, crea el registro
    // vinculado a la inscripción en la Fecha 0 (sin penalización, sin puntos) y
    // recalcula las categorías. Si no, la inscripción queda "Sin clasificar".
    const tiempoClasif = txt(body.tiempo_clasificacion);
    if (tiempoClasif) {
      const crudoMs = tiempoToMs(tiempoClasif);
      const fecha0 = await getOrCreateFecha0(campeonato_id);
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
          escuderia_favorita: txt(escuderia_favorita),
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

    // Enriquecer con el MEJOR tiempo del piloto (mínimo tiempo_crudo_ms entre sus
    // registros válidos). Solo lectura; no altera rankings ni cálculos.
    const ids = (data ?? []).map((d) => d.id);
    const mejores: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: regs } = await supabaseAdmin
        .from("campeonato_registros")
        .select("inscripcion_id, tiempo_crudo_ms")
        .in("inscripcion_id", ids)
        .eq("estado", "valido")
        .not("tiempo_crudo_ms", "is", null);
      for (const r of regs ?? []) {
        const ms = Number(r.tiempo_crudo_ms);
        if (!Number.isFinite(ms) || !r.inscripcion_id) continue;
        if (mejores[r.inscripcion_id] === undefined || ms < mejores[r.inscripcion_id]) {
          mejores[r.inscripcion_id] = ms;
        }
      }
    }
    const enriched = (data ?? []).map((d) => ({
      ...d,
      mejor_tiempo_ms: mejores[d.id] ?? null,
      mejor_tiempo: mejores[d.id] != null ? msToTiempo(mejores[d.id]) : null,
      turno_listo: inscripcionEstaLista(d.observaciones),
    }));

    return NextResponse.json(enriched);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

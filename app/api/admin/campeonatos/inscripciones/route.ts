import { NextResponse } from "next/server";
import { failResponse } from "@/lib/apiError";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";
import { tiempoToMs, msToTiempo, inscripcionEstaLista } from "@/lib/campeonatos";
import { recalcularCategorias, getOrCreateFecha0 } from "@/lib/campeonatosCategorias";
import { getInscripcionCampos, campoVisible, faltantesRequeridos, estadoPendientePago, type CampoInscripcion } from "@/lib/campeonatosInscripcionConfig";

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

    if (!campeonato_id) {
      return NextResponse.json({ error: "Falta el campeonato" }, { status: 400 });
    }

    // Un campeonato archivado (deleted_at) no acepta nuevas inscripciones.
    const { data: campActivo } = await supabaseAdmin
      .from("campeonatos")
      .select("id, permite_pago_stand, modalidad, config, precio_inscripcion")
      .eq("id", campeonato_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!campActivo) {
      return NextResponse.json({ error: "El campeonato no existe o fue eliminado" }, { status: 400 });
    }
    const permiteStand = campActivo.permite_pago_stand !== false;

    // Configuración del formulario de ESTE campeonato (misma fuente que admin/público).
    // Valida required/optional/hidden de forma DINÁMICA y no confía en inputs ocultos.
    const campos = getInscripcionCampos(campActivo);
    const vis = (k: CampoInscripcion) => campoVisible(campos, k);
    const faltan = faltantesRequeridos(campos, body);
    if (faltan.length > 0) {
      return NextResponse.json({ error: `Faltan datos obligatorios: ${faltan.join(", ")}` }, { status: 400 });
    }
    const nombreT = String(nombre ?? "").trim();
    const apellidoT = String(apellido ?? "").trim();

    // Forma de pago / monto: si el campo está OCULTO por config, se ignora lo entrante.
    const metodoPagoIn = vis("forma_pago") ? metodo_pago : undefined;
    const pagosIn = vis("forma_pago") ? pagos_detalle : undefined;
    const montoIn = vis("monto") ? monto : undefined;

    // Pagos múltiples (opcional). Si vienen, definen el total y el estado.
    const pagos = limpiarPagos(pagosIn);
    const totalPagos = pagos.reduce((s, p) => s + p.monto, 0);

    // Monto: explícito (si el campo es visible) > suma de pagos > precio del campeonato.
    let montoFinal = 0;
    if (montoIn !== undefined && montoIn !== null && montoIn !== "" && Number.isFinite(Number(montoIn))) {
      montoFinal = Math.round(Number(montoIn));
    } else if (totalPagos > 0) {
      montoFinal = totalPagos;
    } else {
      montoFinal = Math.round(Number(campActivo.precio_inscripcion) || 0);
    }
    if (!Number.isFinite(montoFinal) || montoFinal < 0) montoFinal = 0;

    // Método + estado de pago:
    // - pagos múltiples o método de stand → pagado en el stand.
    // - online / mercadopago → pagado online (no requiere cobro en el stand).
    // - sin método → queda pendiente; sin pago en stand, el pendiente es ONLINE.
    const esOnline = metodoPagoIn === "online" || metodoPagoIn === "mercadopago";
    let metodoFinal: string | null;
    let estadoFinal: string;
    if (pagos.length > 0) {
      metodoFinal = pagos.length === 1 ? pagos[0].metodo_pago : "multiple";
      estadoFinal = "pagado";
    } else if (esOnline) {
      metodoFinal = "mercadopago";
      estadoFinal = "pagado";
    } else if (metodoPagoIn && METODOS_STAND.includes(String(metodoPagoIn).trim())) {
      metodoFinal = String(metodoPagoIn).trim();
      estadoFinal = "pagado";
    } else {
      metodoFinal = null;
      // Gate server-side: sin pago en stand NUNCA queda "pendiente de cobro en stand".
      estadoFinal = estadoPendientePago(permiteStand);
    }

    const nombre_completo = `${nombreT} ${apellidoT}`.trim();
    // Campos gateados por visibilidad: si están ocultos, no se persiste valor entrante.
    const categoriaVal = vis("categoria") ? txt(categoria) : null;
    const minutos = vis("cantidad_minutos") && Number.isFinite(Number(cantidad_minutos)) && Number(cantidad_minutos) > 0
      ? Math.round(Number(cantidad_minutos)) : null;

    const insertRow: Record<string, unknown> = {
      campeonato_id,
      nombre: nombreT,
      apellido: apellidoT,
      nombre_completo,
      // Columnas NOT NULL: si el campo se oculta, se guarda cadena vacía (no rompe).
      telefono: vis("telefono") ? String(telefono ?? "").trim() : "",
      dni: vis("dni") ? String(dni ?? "").trim() : "",
      instagram: vis("instagram") ? txt(instagram) : null,
      escuderia_favorita: vis("escuderia") ? (txt(escuderia_favorita) ?? "") : "",
      categoria: categoriaVal,
      // Si el staff asigna categoría a mano, se marca manual para que la
      // auto-clasificación por tiempo no la pise. Si queda vacía, la define el tiempo.
      categoria_manual: Boolean(categoriaVal),
      monto: montoFinal,
      estado_pago: estadoFinal,
      metodo_pago: metodoFinal,
      pagos_detalle: pagos.length > 0 ? pagos : null,
      observaciones: txt(observaciones),
      // Datos operativos del turno (opcionales), igual que el Turnero.
      hora_toma: vis("hora_toma") ? txt(hora_toma) : null,
      hora_estimada_subida: vis("hora_estimada_subida") ? txt(hora_estimada_subida) : null,
      hora_subida: vis("hora_subida") ? txt(hora_subida) : null,
      hora_bajada: vis("hora_bajada") ? txt(hora_bajada) : null,
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
    // Mejor tiempo: SOLO si el campo está visible por config. En modalidad eliminación
    // (Duelo) está oculto y el tiempo se carga después en Bracket → Clasificación.
    const tiempoClasif = vis("mejor_tiempo") ? txt(body.tiempo_clasificacion) : null;
    if (tiempoClasif) {
      const crudoMs = tiempoToMs(tiempoClasif);
      const fecha0 = await getOrCreateFecha0(campeonato_id);
      if (fecha0 && crudoMs != null) {
        await supabaseAdmin.from("campeonato_registros").insert([{
          campeonato_id,
          campeonato_fecha_id: fecha0.id,
          inscripcion_id: data.id,
          categoria: "sin_clasificar",
          nombre: nombreT,
          apellido: apellidoT,
          nombre_completo,
          telefono: String(telefono ?? "").trim(),
          escuderia_favorita: vis("escuderia") ? txt(escuderia_favorita) : null,
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

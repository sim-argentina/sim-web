import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { leerSesion, tokenDeRequest } from "@/lib/mensualidadSesion";
import { huellaCodigo } from "@/lib/mensualidadHuella";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { REGLAS_POR_PRODUCTO, fechasPublicasPara } from "@/lib/agenda";
import {
  MENSAJE_PLAN_ACTUALIZADO, falloMensualidadesActualizadas, modalidadDeMensualidad, modalidadPersistida,
} from "@/lib/mensualidadesComercial";
import { duracionesMensualidad, simuladoresLibresMensualidad } from "@/lib/mensualidadesAgenda";

// Disponibilidad CON NOMBRES de simulador para Mensualidades (Bloque M5A).
//
// Existe aparte de /api/disponibilidad porque devuelve más: qué simuladores
// concretos están libres, no cuántos. Eso solo se entrega a quien ya probó ser
// el titular (sesión de M4). El DTO público genérico de M6 no se toca ni se
// debilita: sigue devolviendo cantidades a cualquiera.
//
// (B6) La modalidad NO es la global: es la del PLAN de la sesión
// (mensualidades.modalidad, NULL = legacy) y, para reprogramar, la de la
// RESERVA (`referencia`), que conserva la suya aunque el plan haya renovado en
// otra modalidad. El cálculo es el motor de B2 (lib/mensualidadesAgenda.ts).
//
// Lo que NO devuelve: reservas, nombres de personas, teléfonos, emails, ids
// internos ni nada de la billetera más allá del saldo del propio titular.

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

// Misma respuesta para "sin cookie", "token inválido" y "sesión vencida".
const sinSesion = () =>
  NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });

const REF_RE = /^RES-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export async function GET(req: Request) {
  // Acceso NUEVO a la función de reservar: depende de la flag.
  if (!mensualidadesHabilitadas()) return sinSesion();
  if (!(await rateLimit(`mens-disp-ip:${clientIp(req)}`, 90, 60_000))) return tooManyResponse();

  try {
    const sesion = await leerSesion(tokenDeRequest(req));
    if (!sesion) return sinSesion();

    // Segundo carril del rate limit: por sesión, con huella no reversible. Una
    // sola sesión no puede barrer el calendario entero aunque rote de IP.
    if (!(await rateLimit(`mens-disp-ses:${huellaCodigo(sesion.sesionId)}`, 120, 60_000))) {
      return tooManyResponse();
    }

    const url = new URL(req.url);
    // (M8C.1) Los días en que Mensualidades opera: los siete. La ventana sale
    // de la fuente canónica, igual que para Reservas.
    const publicas = fechasPublicasPara("mensualidad");
    // Sin fecha se contesta el primer día operativo. Así una pantalla puede
    // abrirse sin conocer las reglas, y una reserva vieja que cayó en un día
    // que hoy no opera igual puede reprogramarse.
    const fecha = url.searchParams.get("fecha") || publicas[0] || "";

    const modalidadPlan = await modalidadDeMensualidad(sesion.mensualidadId);
    if (!modalidadPlan) return sinSesion();

    let modalidad = modalidadPlan;
    let excluirReservaId: number | string | undefined;
    let duracionCruda = url.searchParams.get("duracion");

    // (B6) Reprogramar: la reserva manda. Su modalidad y su duración salen de la
    // base (una reserva ajena o inexistente es indistinguible: 404).
    const referencia = (url.searchParams.get("referencia") ?? "").trim().toUpperCase();
    if (referencia) {
      if (!REF_RE.test(referencia)) {
        return NextResponse.json({ error: "No encontramos esa reserva." }, { status: 404, headers: sinCache });
      }
      const { data: reserva } = await supabaseAdmin
        .from("reservas")
        .select("id, duracion_minutos, modalidad")
        .eq("referencia_publica", referencia)
        .eq("mensualidad_id", sesion.mensualidadId)
        .eq("origen", "mensualidad")
        .eq("estado", "activa")
        .maybeSingle();
      if (!reserva) {
        return NextResponse.json({ error: "No encontramos esa reserva." }, { status: 404, headers: sinCache });
      }
      modalidad = modalidadPersistida(reserva.modalidad);
      excluirReservaId = reserva.id as number;
      duracionCruda = String(reserva.duracion_minutos);
    }

    const duraciones = duracionesMensualidad(modalidad);
    // Sin duración: la primera del catálogo DEL PLAN. La pantalla no la adivina.
    if (duracionCruda === null || duracionCruda === "") duracionCruda = String(duraciones[0]);
    if (!/^\d+$/.test(duracionCruda)) {
      return NextResponse.json({ error: "Duración inválida" }, { status: 400, headers: sinCache });
    }
    // Una duración que el plan no tiene viene de una pantalla armada con otra
    // modalidad (el plan renovó con la pestaña abierta): 409 y a recargar.
    if (!referencia && !duraciones.includes(Number(duracionCruda))) {
      const f = falloMensualidadesActualizadas(MENSAJE_PLAN_ACTUALIZADO);
      return NextResponse.json(
        { error: f.error, codigo: f.codigo, modalidad, duraciones },
        { status: f.status, headers: sinCache },
      );
    }

    const r = await simuladoresLibresMensualidad({
      modalidad, fecha, duracion: Number(duracionCruda), excluirReservaId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: sinCache });

    return NextResponse.json({
      // La modalidad viaja para que la pantalla la devuelva al reservar
      // (modalidad_vista). No se le muestra a la persona.
      modalidad,
      fecha,
      duracion: Number(duracionCruda),
      duraciones,
      fechas: publicas,
      // (M5C.1) Los límites de cantidad también viajan: la pantalla no los
      // inventa ni los codifica a mano. El servidor vuelve a validarlos igual.
      simuladores_min: REGLAS_POR_PRODUCTO.mensualidad.simuladoresMin,
      simuladores_max: REGLAS_POR_PRODUCTO.mensualidad.simuladoresMax,
      horarios: r.horarios,
    }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo calcular la disponibilidad", {
      logContext: "mens-disponibilidad", error,
    });
  }
}

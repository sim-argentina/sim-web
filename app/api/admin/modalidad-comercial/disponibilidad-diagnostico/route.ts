import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { esFinDeSemana, fechaValida } from "@/lib/agenda";
import {
  MODALIDADES, bufferMinutos, esModalidad, ocupacionMinutos, pasoAgendaMin, type Modalidad,
} from "@/lib/catalogoComercial";
import {
  PRODUCTOS_AGENDA, duracionValida, esProductoAgenda, horaDeMinutos, type ProductoAgenda,
} from "@/lib/agendaIntervalos";
import { RECURSOS_AGENDA, bloqueosAplicables, type OcupacionRecurso } from "@/lib/disponibilidadIntervalos";
import { cargarFuentesAgenda, disponibilidadDesdeFuentes } from "@/lib/disponibilidadIntervalosServer";

// Diagnóstico de la agenda por intervalos (Bloque B2). SOLO ADMIN y SOLO LECTURA.
//
// Simula la disponibilidad de un día con el motor nuevo, en la modalidad que se
// pida o en las dos (legacy y v2_10) para compararlas. La modalidad es SIEMPRE
// un parámetro: este endpoint no la decide por el reloj. No crea reservas, no
// inserta slots y ningún flujo comercial lo lee. Devuelve recursos e intervalos,
// nunca nombres, teléfonos ni identificadores de reservas.
//
//   ?fecha=AAAA-MM-DD&duracion=N[&modalidad=legacy|v2_10][&producto=reserva|…]

export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

const invalido = (error: string) =>
  NextResponse.json({ error }, { status: 400, headers: sinCache });

const ocupacionPublica = (o: OcupacionRecurso) => ({
  recurso: o.recurso,
  desde: horaDeMinutos(o.intervalo.desde),
  hasta: horaDeMinutos(o.intervalo.hasta),
  modalidad: o.modalidad,
  fuente: o.fuente,
  origen: o.origen,
});

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const fecha = url.searchParams.get("fecha") ?? "";
  const duracionCruda = url.searchParams.get("duracion") ?? "";
  const modalidadCruda = url.searchParams.get("modalidad");
  const productoCrudo = url.searchParams.get("producto") ?? "reserva";

  if (!fechaValida(fecha)) return invalido("Fecha inválida: usá AAAA-MM-DD.");
  if (!/^\d{1,3}$/.test(duracionCruda)) return invalido("Duración inválida: minutos enteros.");
  if (modalidadCruda !== null && !esModalidad(modalidadCruda)) {
    return invalido(`Modalidad inválida: ${MODALIDADES.join(" o ")}, o sin el parámetro para comparar las dos.`);
  }
  if (!esProductoAgenda(productoCrudo)) return invalido(`Producto inválido: ${PRODUCTOS_AGENDA.join(", ")}.`);

  const duracion = Number(duracionCruda);
  const producto: ProductoAgenda = productoCrudo;
  const modalidades: readonly Modalidad[] = modalidadCruda ? [modalidadCruda] : MODALIDADES;

  try {
    const fuentes = await cargarFuentesAgenda(fecha, fecha);
    // `ahora` solo decide qué pendientes siguen reteniendo y qué bloqueos vencieron.
    const ahora = new Date();

    const porModalidad = modalidades.map((modalidad) => ({
      modalidad,
      r: disponibilidadDesdeFuentes(fuentes, { modalidad, producto, fecha, duracion, ahora }),
    }));
    // Las ocupaciones no dependen de la modalidad pedida: cada reserva usa la suya.
    const { ocupaciones, resumen } = porModalidad[0].r;

    const resultados = porModalidad.map(({ modalidad, r }) => {
      const horarios = r.disponibilidad.horarios;
      return {
        modalidad,
        duracion_comercial: duracion,
        duracion_valida: duracionValida(modalidad, producto, duracion),
        ocupacion_min: ocupacionMinutos(modalidad, duracion),
        buffer_min: bufferMinutos(modalidad, duracion),
        paso_min: pasoAgendaMin(modalidad),
        inicios: horarios.length,
        horarios: horarios.map((h) => ({
          hora: h.hora,
          fin_comercial: horaDeMinutos(h.turno.finComercial),
          fin_ocupacion: horaDeMinutos(h.turno.finOcupacion),
          disponibles: h.libres.length,
          libres: h.libres,
          ocupados: h.recursos.filter((e) => e.ocupado).map((e) => e.recurso),
          bloqueados: h.recursos.filter((e) => e.bloqueado).map((e) => e.recurso),
        })),
      };
    });

    return NextResponse.json({
      solo_lectura: true,
      fecha,
      dia: esFinDeSemana(fecha) ? "fin_de_semana" : "semana",
      producto,
      duracion_comercial: duracion,
      recursos: RECURSOS_AGENDA,
      consultas: fuentes.consultas,
      fuentes: resumen,
      ocupaciones: ocupaciones.map(ocupacionPublica),
      bloqueos: bloqueosAplicables(fuentes.bloqueos, fecha, ahora).map((b) => ({
        todo_el_dia: b.todo_el_dia, hora_inicio: b.hora_inicio, hora_fin: b.hora_fin, simulador: b.simulador,
      })),
      resultados,
      notas: [
        "Solo lectura: no crea reservas ni slots y no cambia nada.",
        "La modalidad es un parámetro: el motor nunca la decide por el reloj.",
        "(B2) Ningún flujo comercial usa este motor todavía: /reservas y el resto siguen con el motor actual.",
        "Cada reserva existente ocupa según SU modalidad guardada (NULL = legacy).",
      ],
    }, { headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo generar el diagnóstico de disponibilidad", {
      logContext: "admin-modalidad-disponibilidad", error,
    });
  }
}

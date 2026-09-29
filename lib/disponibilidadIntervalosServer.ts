// ============================================================================
// Carga de la agenda por intervalos (Bloque B2). SOLO SERVIDOR, SOLO LECTURA.
// ----------------------------------------------------------------------------
// Lee UNA vez las tres fuentes de un rango de fechas —reservas activas y
// pendientes, slots activos y bloqueos habilitados— y deja todo el cálculo en
// memoria (lib/disponibilidadIntervalos.ts). Son tres consultas por rango, no
// una por día ni por horario; solo se suma una página si alguna tabla trae más
// de 1.000 filas en el rango (el tope de PostgREST).
//
// (B2) Ningún flujo comercial usa este módulo: lo consumen el diagnóstico
// administrativo y los tests. /reservas, Mercado Pago, el webhook, Gift Cards,
// Mensualidades y Empresas siguen con lib/disponibilidad.ts.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PENDIENTE_TTL_MIN } from "@/lib/disponibilidad";
import { fechaValida } from "@/lib/agenda";
import type { Modalidad } from "@/lib/catalogoComercial";
import type { ProductoAgenda } from "@/lib/agendaIntervalos";
import {
  disponibilidadIntervalos, ocupacionesDelDia,
  type DisponibilidadIntervalos, type FilaBloqueo, type FilaReserva, type FilaSlot,
  type OcupacionRecurso, type ResumenFuentes,
} from "@/lib/disponibilidadIntervalos";

/** Tope de filas por respuesta de PostgREST. */
const PAGINA = 1000;

export type FuentesAgenda = {
  desde: string;
  hasta: string;
  reservas: FilaReserva[];
  slots: FilaSlot[];
  bloqueos: FilaBloqueo[];
  /** Consultas hechas a la base para armar el rango. */
  consultas: number;
};

type Pagina<T> = { data: T[] | null; error: { message: string } | null };

async function todasLasPaginas<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<Pagina<T>>,
  contar: () => void,
): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    contar();
    const { data, error } = await pedir(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PAGINA) return out;
  }
}

/** Las tres fuentes de [desde, hasta] (fechas YYYY-MM-DD, inclusive). */
export async function cargarFuentesAgenda(desde: string, hasta: string): Promise<FuentesAgenda> {
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) {
    throw new Error("Rango de fechas inválido");
  }
  let consultas = 0;
  const contar = () => { consultas++; };

  const [reservas, slots, bloqueos] = await Promise.all([
    todasLasPaginas<FilaReserva>((a, b) => supabaseAdmin
      .from("reservas")
      .select("id, fecha, hora, duracion_minutos, simuladores, estado, created_at, modalidad, origen")
      .gte("fecha", desde).lte("fecha", hasta)
      .in("estado", ["activa", "pendiente_pago"])
      .order("id", { ascending: true })
      .range(a, b) as unknown as PromiseLike<Pagina<FilaReserva>>, contar),
    todasLasPaginas<FilaSlot>((a, b) => supabaseAdmin
      .from("reserva_slots")
      .select("reserva_id, fecha, hora, simulador, estado, ocupacion_min")
      .gte("fecha", desde).lte("fecha", hasta)
      .eq("estado", "activa")
      .order("id", { ascending: true })
      .range(a, b) as unknown as PromiseLike<Pagina<FilaSlot>>, contar),
    todasLasPaginas<FilaBloqueo>((a, b) => supabaseAdmin
      .from("bloqueos_reservas")
      .select("fecha, todo_el_dia, hora_inicio, hora_fin, simulador, activo")
      .gte("fecha", desde).lte("fecha", hasta)
      .eq("activo", true)
      .order("id", { ascending: true })
      .range(a, b) as unknown as PromiseLike<Pagina<FilaBloqueo>>, contar),
  ]);

  return { desde, hasta, reservas, slots, bloqueos, consultas };
}

export type ResultadoDia = {
  disponibilidad: DisponibilidadIntervalos;
  ocupaciones: OcupacionRecurso[];
  resumen: ResumenFuentes;
};

/**
 * Disponibilidad de UN día a partir de fuentes ya cargadas: no consulta la base.
 * La modalidad es la del turno que se quiere vender y llega siempre explícita.
 */
export function disponibilidadDesdeFuentes(
  fuentes: FuentesAgenda,
  args: {
    modalidad: Modalidad;
    producto: ProductoAgenda;
    fecha: string;
    duracion: number;
    ahora: Date;
    recursos?: readonly string[];
  },
): ResultadoDia {
  const { fecha, ahora } = args;
  const { ocupaciones, resumen } = ocupacionesDelDia({
    fecha, reservas: fuentes.reservas, slots: fuentes.slots, ahora, pendienteTtlMin: PENDIENTE_TTL_MIN,
  });
  const disponibilidad = disponibilidadIntervalos({ ...args, ocupaciones, bloqueos: fuentes.bloqueos });
  return { disponibilidad, ocupaciones, resumen };
}

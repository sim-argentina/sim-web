import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Bloqueos de reservas online configurados por el admin. Permiten cerrar fechas,
// rangos horarios y/o simuladores puntuales sin tocar reservas existentes.

export type BloqueoReserva = {
  fecha: string;
  todo_el_dia: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  simulador: string | null;
};

// Bloqueos ACTIVOS de una fecha (YYYY-MM-DD).
export async function getBloqueosActivos(
  fecha: string
): Promise<BloqueoReserva[]> {
  const { data, error } = await supabaseAdmin
    .from("bloqueos_reservas")
    .select("fecha, todo_el_dia, hora_inicio, hora_fin, simulador")
    .eq("fecha", fecha)
    .eq("activo", true);

  if (error) throw new Error(error.message);
  return (data as BloqueoReserva[]) ?? [];
}

// ¿El bloqueo cubre un slot "HH:MM"? Todo el día cubre cualquiera; si no, rango
// inclusivo [hora_inicio, hora_fin] (comparar HH:MM como string = orden horario).
function cubreSlot(b: BloqueoReserva, slot: string): boolean {
  if (b.todo_el_dia) return true;
  const ini = b.hora_inicio || "00:00";
  const fin = b.hora_fin || "23:59";
  return slot >= ini && slot <= fin;
}

// ¿Algún (slot, simulador) del turno cae dentro de un bloqueo activo?
// Un bloqueo con simulador null afecta a todos; con simulador puntual, solo ese.
export function turnoBloqueado(
  bloqueos: BloqueoReserva[],
  slots: string[],
  simuladores: string[]
): boolean {
  for (const b of bloqueos) {
    for (const sim of simuladores) {
      if (b.simulador && b.simulador !== sim) continue;
      for (const slot of slots) {
        if (cubreSlot(b, slot)) return true;
      }
    }
  }
  return false;
}

// Conveniencia para las rutas que crean reservas: consulta DB y evalúa.
export async function reservaEstaBloqueada(
  fecha: string,
  slots: string[],
  simuladores: string[]
): Promise<boolean> {
  const bloqueos = await getBloqueosActivos(fecha);
  return turnoBloqueado(bloqueos, slots, simuladores);
}

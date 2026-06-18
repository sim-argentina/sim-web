import { getSlotsForDate } from "@/lib/reservasSlots";

// Validación server-side centralizada de inputs de reserva.
// Nunca se confía en el cliente: precio y disponibilidad se recalculan aparte.

export const SIMULADORES_VALIDOS = [
  "Ferrari",
  "McLaren",
  "Red Bull",
  "Alpine",
] as const;

// Ventana máxima de reserva hacia el futuro (días).
export const MAX_FUTURO_DIAS = 120;

export type ReservaValida = {
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[];
  duracion: 15 | 30;
  codigo_descuento: string | null;
};

export type ValidacionReserva =
  | { ok: true; value: ReservaValida }
  | { ok: false; error: string };

function fail(error: string): ValidacionReserva {
  return { ok: false, error };
}

export function validarReservaInput(body: unknown): ValidacionReserva {
  const b = (body ?? {}) as Record<string, unknown>;

  // ── Datos personales ──
  const nombre = String(b.nombre ?? "").trim();
  const telefono = String(b.telefono ?? "").trim();
  if (!nombre || nombre.length > 80) return fail("Nombre inválido");
  if (!telefono || !/^[0-9+()\s-]{6,30}$/.test(telefono)) {
    return fail("Teléfono inválido");
  }

  // ── Fecha (formato real, no pasada, dentro de ventana) ──
  const fecha = String(b.fecha ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fail("Fecha inválida");
  const fechaDate = new Date(fecha + "T00:00:00");
  if (Number.isNaN(fechaDate.getTime())) return fail("Fecha inválida");
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (fechaDate < hoy) return fail("La fecha ya pasó");
  const max = new Date(hoy);
  max.setDate(max.getDate() + MAX_FUTURO_DIAS);
  if (fechaDate > max) return fail("La fecha está fuera del rango permitido");

  // ── Duración (15/30) ──
  const duracion: 15 | 30 = Number(b.duracion_minutos) === 30 ? 30 : 15;

  // ── Hora (debe ser un slot real del sistema) ──
  const slots = getSlotsForDate(fecha);
  const hora = String(b.hora ?? "");
  if (!slots.includes(hora)) return fail("Horario inválido");
  if (duracion === 30) {
    const idx = slots.indexOf(hora);
    if (idx === -1 || idx + 1 >= slots.length) {
      return fail("No hay un turno consecutivo disponible para 30 minutos");
    }
  }

  // ── Simuladores (set permitido, 1..4, sin duplicados) ──
  const sims = b.simuladores;
  if (!Array.isArray(sims) || sims.length < 1 || sims.length > 4) {
    return fail("Selección de simuladores inválida");
  }
  const norm = sims.map((s) => String(s));
  if (new Set(norm).size !== norm.length) return fail("Simuladores duplicados");
  for (const s of norm) {
    if (!(SIMULADORES_VALIDOS as readonly string[]).includes(s)) {
      return fail("Simulador inválido");
    }
  }

  // ── Condiciones ──
  if (b.acepto_condiciones !== true) {
    return fail("Debés aceptar las condiciones");
  }

  const codigo_descuento = b.codigo_descuento
    ? String(b.codigo_descuento).trim().slice(0, 40)
    : null;

  return {
    ok: true,
    value: {
      nombre: nombre.slice(0, 80),
      telefono: telefono.slice(0, 30),
      fecha,
      hora,
      simuladores: norm,
      duracion,
      codigo_descuento,
    },
  };
}

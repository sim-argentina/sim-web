import {
  DIAS_MAXIMO_ANTICIPACION, DIAS_MINIMO_ANTICIPACION,
  bloquesDeAgenda, cantidadSimuladoresValida, duracionValidaPara,
  fechaDentroDeVentana, fechaValida, hoyEnSim, horariosDe,
  type Producto,
} from "@/lib/agenda";
import { duracionPermitida, type Modalidad } from "@/lib/catalogoComercial";
import { turnoPara } from "@/lib/agendaIntervalos";

// Validación server-side centralizada de inputs de reserva.
// Nunca se confía en el cliente: precio y disponibilidad se recalculan aparte.
//
// (M6) La ventana de fechas ya no es una constante global ambigua de 120 días:
// es la MISMA política pública que ve el cliente en /reservas —de mañana a
// hoy + 15, en hora de Córdoba— y vive en lib/agenda.ts. Esa política aplica al
// flujo PÚBLICO. Empresas y Administración no pasan por acá y conservan sus
// propias reglas (ver lib/empresasServer.ts y /api/admin/*).

export const SIMULADORES_VALIDOS = [
  "Ferrari",
  "McLaren",
  "Red Bull",
  "Alpine",
] as const;

// Se mantienen exportadas por claridad de la política pública.
export { DIAS_MINIMO_ANTICIPACION, DIAS_MAXIMO_ANTICIPACION };

export type ReservaValida = {
  nombre: string;
  telefono: string;
  fecha: string;
  hora: string;
  simuladores: string[];
  duracion: number;
  bloques: string[];
  codigo_descuento: string | null;
};

export type ValidacionReserva =
  | { ok: true; value: ReservaValida }
  | { ok: false; error: string };

function fail(error: string): ValidacionReserva {
  return { ok: false, error };
}

export type OpcionesValidacion = {
  /** Producto que reserva. Por defecto la reserva pública normal (15/30). */
  producto?: Producto;
  /** "Hoy" en Córdoba; se inyecta en los tests para fijar la ventana. */
  hoy?: string;
  /**
   * (B3) Modalidad del turno que se crea, resuelta por el servidor. Sin valor
   * o 'legacy': exactamente la validación de siempre. 'v2_10': duración del
   * catálogo v2 (obligatoria) e inicio en la grilla v2.
   */
  modalidad?: Modalidad;
};

export function validarReservaInput(
  body: unknown,
  opciones: OpcionesValidacion = {},
): ValidacionReserva {
  const producto: Producto = opciones.producto ?? "reserva";
  const hoy = opciones.hoy ?? hoyEnSim();
  const b = (body ?? {}) as Record<string, unknown>;

  // ── Datos personales ──
  const nombre = String(b.nombre ?? "").trim();
  const telefono = String(b.telefono ?? "").trim();
  if (!nombre || nombre.length > 80) return fail("Nombre inválido");
  if (!telefono || !/^[0-9+()\s-]{6,30}$/.test(telefono)) {
    return fail("Teléfono inválido");
  }

  // ── Fecha: real, desde mañana y dentro de la ventana pública ──
  const fecha = String(b.fecha ?? "");
  if (!fechaValida(fecha)) return fail("Fecha inválida");
  if (!fechaDentroDeVentana(fecha, hoy)) {
    return fail("La fecha está fuera del rango permitido");
  }

  const duracionCruda = b.duracion_minutos;
  const hora = String(b.hora ?? "");
  let duracion: number;
  let bloques: string[];

  if (opciones.modalidad === "v2_10") {
    // ── (B3) v2: duración del catálogo v2, sin default; inicio en la grilla v2
    // (paso 10; L-V el tiempo comercial termina ≤ 22:00; finde último inicio 14:00).
    if (!duracionPermitida("v2_10", producto, duracionCruda)) return fail("Duración inválida");
    duracion = Number(duracionCruda);
    if (!turnoPara({ modalidad: "v2_10", producto, fecha, hora, duracion })) {
      return fail("Horario inválido");
    }
    // Una reserva v2 ocupa UNA fila por simulador, en su hora de inicio.
    bloques = [hora];
  } else {
    // ── Duración: solo las que admite ESTE producto ──
    // Si no viene el campo se mantiene el default histórico de 15; si viene un
    // valor, tiene que ser válido (antes 45 o 60 se convertían en 15 en silencio).
    duracion = duracionCruda === undefined || duracionCruda === null
      ? 15
      : Number(duracionCruda);
    if (!duracionValidaPara(producto, duracion)) return fail("Duración inválida");

    // ── Hora: tiene que existir en el calendario del día y entrar completa ──
    if (!horariosDe(fecha).includes(hora)) return fail("Horario inválido");
    const legacy = bloquesDeAgenda(fecha, hora, duracion);
    if (!legacy) {
      return fail("No hay tiempo consecutivo disponible para esa duración");
    }
    bloques = legacy;
  }

  // ── Simuladores (set permitido, 1..4, sin duplicados) ──
  const sims = b.simuladores;
  if (!Array.isArray(sims) || !cantidadSimuladoresValida(sims.length)) {
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
      bloques,
      codigo_descuento,
    },
  };
}

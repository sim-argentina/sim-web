// Condiciones de compra de Mensualidades SIM (Bloque M3).
// Módulo PURO: lo usa la página pública para mostrarlas y el servidor para
// registrar qué versión aceptó cada comprador. Si el texto cambia de fondo, se
// sube la versión: las compras viejas conservan la que aceptaron.

export const CONDICIONES_VERSION = "2026-09-m5c1";

export const CONDICIONES_MENSUALIDAD: readonly string[] = [
  "La mensualidad dura 30 días desde que Mercado Pago aprueba el pago.",
  "Se puede usar hasta las 23:59 del día de vencimiento.",
  "No tiene renovación automática.",
  "El saldo se usa reservando turnos desde la web, sujetos a disponibilidad real.",
  "Las reservas pueden ser de 15, 30, 45 o 60 minutos, con 2, 3 o 4 simuladores.",
  "Los turnos con saldo son de lunes a viernes, entre las 10:00 y las 22:00: la experiencia tiene que terminar antes de las 22:00.",
  "Se reserva desde el día siguiente y hasta 15 días de anticipación.",
  "El saldo consumido es la duración del turno multiplicada por la cantidad de simuladores: por ejemplo, 2 simuladores durante 30 minutos consumen 60 minutos.",
  "Cada reserva puede durar como máximo 60 minutos.",
  "El turno tiene que realizarse dentro de la vigencia: reservar antes del vencimiento no habilita una fecha posterior.",
  "El saldo que no se usa antes del vencimiento se pierde y no se recupera.",
  "Si comprás otra mensualidad antes de que venza la actual, conservás el mismo código y se trasladan hasta 60 minutos del saldo anterior.",
  "Las mensualidades no aceptan códigos de descuento ni se combinan con otras promociones.",
  "El titular puede reservar para otras personas y es responsable del grupo.",
  "Requisitos para usar los simuladores: altura mínima 1,35 m y peso máximo 110 kg.",
  "Al comprar, el titular declara que todos los participantes cumplen esos requisitos.",
];

// ── Condiciones de CADA RESERVA hecha con saldo (Bloque M5A) ────────────────
// Son distintas de las de compra y llevan su propia versión: lo que se guarda en
// la reserva es qué aceptó el titular ESE día, no lo que dice la web hoy.
// El texto no pide datos de los acompañantes: el titular acepta por el grupo.

export const CONDICIONES_RESERVA_VERSION = "2026-09-m5a";

export const CONDICIONES_RESERVA: readonly string[] = [
  "El titular declara que todos los participantes cumplen la altura mínima de 1,35 m y el peso máximo de 110 kg.",
  "El titular acepta estas condiciones en nombre de todo el grupo y es responsable de que se cumplan.",
  "La reserva queda a nombre del titular de la mensualidad, aunque el titular no asista.",
  "El saldo se descuenta al confirmar: la duración del turno multiplicada por la cantidad de simuladores.",
  "La reserva está sujeta a las políticas de cancelación y reprogramación de Mensualidades SIM.",
];

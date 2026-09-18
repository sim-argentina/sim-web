// Condiciones de compra de Mensualidades SIM (Bloque M3).
// Módulo PURO: lo usa la página pública para mostrarlas y el servidor para
// registrar qué versión aceptó cada comprador. Si el texto cambia de fondo, se
// sube la versión: las compras viejas conservan la que aceptaron.

// (M8A) Se sube la versión porque el texto cambió de fondo: se agregaron las
// reglas de cancelación, reprogramación y no-show, que M5C ya aplicaba pero que
// el comprador no veía al aceptar. Las compras viejas conservan la versión que
// aceptaron.
export const CONDICIONES_VERSION = "2026-09-m8a";

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
  "Si comprás cuando ya venció, se genera un código nuevo y el saldo vencido no se recupera.",
  "Reservás con tu código y tu teléfono: no hace falta crear una cuenta.",
  // (M8A) Estas tres reglas ya las aplicaba el servidor desde M5C, pero no
  // figuraban en lo que el comprador acepta. Ahora sí.
  "Podés cancelar o reprogramar un turno con al menos 24 horas de anticipación, y los minutos vuelven a tu saldo.",
  "Con menos de 24 horas todavía podés cancelar para liberar los simuladores, pero esos minutos no se devuelven.",
  "Si no te presentás al turno, los minutos se consumen igual.",
  "Las reservas están sujetas a disponibilidad real: comprar una mensualidad no reserva ningún turno ni garantiza horarios.",
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

import { ALTURA_MINIMA_M, PESO_MAXIMO_KG } from "@/lib/requisitos";
import { REGLAS_POR_PRODUCTO, WEEKDAY_SLOTS, WEEKEND_SLOTS } from "@/lib/agenda";

// Condiciones de Mensualidades SIM. Módulo PURO: lo usa la landing para
// mostrarlas y el servidor para registrar qué versión aceptó cada comprador.
// Si el texto cambia de fondo, sube la versión y las compras viejas conservan
// la que aceptaron.
//
// (M8C) La lista pasó de 22 renglones sueltos a OCHO condiciones agrupadas por
// tema. No es un resumen ni un extracto: son las condiciones completas. No hay
// lista larga escondida detrás de un "ver más", ni acordeón, ni modal. Veintidós
// viñetas planas eran una pared de texto que nadie leía; ocho bloques con título
// se recorren de un vistazo y dicen exactamente lo mismo.

/** Una condición: el título es de qué habla, el texto es la regla. */
export type Condicion = { titulo: string; texto: string };

// (M8C) Sube porque cambió una regla MATERIAL: el mínimo de simuladores pasó de
// 2 a 1. Quien acepte desde ahora acepta otra cosa que quien aceptó antes, así
// que no se reescribe ninguna aceptación histórica: las compras y reservas
// viejas siguen guardando la versión que efectivamente se les mostró.
// (M8C.1) Vuelve a subir: Mensualidades pasa a operar los siete días, con
// horario distinto el fin de semana. Es otra regla material.
export const CONDICIONES_VERSION = "2026-09-m8c1";

/** "15, 30, 45 o 60" a partir de la fuente de dominio, no escrito a mano. */
function enumerar(valores: readonly number[]): string {
  if (valores.length === 1) return String(valores[0]);
  return `${valores.slice(0, -1).join(", ")} o ${valores[valores.length - 1]}`;
}

const { duraciones, simuladoresMin, simuladoresMax, limiteTurno } = REGLAS_POR_PRODUCTO.mensualidad;

/** 1320 → "22:00". El horario que se publica es el que aplica el motor. */
function hhmm(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// De lunes a viernes lo que se publica es el horario de atención: se abre a las
// 10:00 y el turno tiene que terminar a las 22:00.
const ABRE_SEMANA = WEEKDAY_SLOTS[0];
const CIERRA_SEMANA = limiteTurno.semana.tipo === "cierre"
  ? hhmm(limiteTurno.semana.minuto)
  : WEEKDAY_SLOTS[WEEKDAY_SLOTS.length - 1];

// (M8C.1) El fin de semana lo que se publica son los INICIOS, de punta a punta
// de la grilla. No se anuncia una hora de cierre porque no hay: el turno que
// arranca a las 14:00 termina cuando termina su duración.
const PRIMER_INICIO_FINDE = WEEKEND_SLOTS[0];
const ULTIMO_INICIO_FINDE = WEEKEND_SLOTS[WEEKEND_SLOTS.length - 1];

/** 1..4 → [1, 2, 3, 4]. Así el texto no puede contradecir a la validación. */
const CANTIDADES = Array.from(
  { length: simuladoresMax - simuladoresMin + 1 },
  (_, i) => simuladoresMin + i,
);

// El máximo por reserva sale de la duración más larga que admite el producto.
const DURACION_MAXIMA = Math.max(...duraciones);

export const CONDICIONES_MENSUALIDAD: readonly Condicion[] = [
  {
    titulo: "Vigencia",
    texto:
      "Dura 30 días desde que Mercado Pago aprueba el pago y puede utilizarse hasta las 23:59 del día de vencimiento. " +
      "No tiene renovación automática y el saldo no utilizado se pierde.",
  },
  {
    // (M8C.1) Los horarios se derivan de la agenda: si mañana cambia el cierre,
    // la condición cambia con él en vez de quedar mintiendo.
    titulo: "Reservas",
    texto:
      "Se realizan desde la web con el código y el teléfono, sin crear una cuenta. " +
      `Podés reservar de lunes a viernes de ${ABRE_SEMANA} a ${CIERRA_SEMANA}, ` +
      `y sábados y domingos con horarios de inicio de ${PRIMER_INICIO_FINDE} a ${ULTIMO_INICIO_FINDE}. ` +
      "Se reserva desde el día siguiente y hasta 15 días de anticipación. " +
      "El turno debe realizarse dentro de la vigencia y está sujeto a disponibilidad.",
  },
  {
    titulo: "Duración y simuladores",
    texto:
      `Los turnos pueden ser de ${enumerar(duraciones)} minutos, con ${enumerar(CANTIDADES)} simuladores. ` +
      `Cada reserva puede durar como máximo ${DURACION_MAXIMA} minutos.`,
  },
  {
    titulo: "Consumo del saldo",
    texto:
      "Se descuenta la duración del turno multiplicada por la cantidad de simuladores elegidos. " +
      "Por ejemplo, 4 simuladores durante 15 minutos consumen 60 minutos de saldo.",
  },
  {
    titulo: "Cancelaciones y cambios",
    texto:
      "Con al menos 24 horas de anticipación podés cancelar o reprogramar y los minutos vuelven a tu saldo. " +
      "Con menos de 24 horas podés cancelar para liberar los simuladores, pero los minutos no se devuelven. " +
      "Si no te presentás, también se consumen.",
  },
  {
    titulo: "Renovación",
    texto:
      "Si renovás antes del vencimiento, conservás el código y podés trasladar hasta 60 minutos del saldo anterior. " +
      "Si la mensualidad ya venció, recibís un código nuevo y el saldo vencido no se recupera.",
  },
  {
    titulo: "Titular y participantes",
    texto:
      "El titular puede reservar para otras personas y es responsable de todo el grupo. " +
      `Todos los participantes deben medir al menos ${ALTURA_MINIMA_M} m y pesar como máximo ${PESO_MAXIMO_KG} kg. ` +
      "Al comprar, el titular declara que todos cumplen estos requisitos.",
  },
  {
    titulo: "Disponibilidad y promociones",
    texto:
      "Los turnos están sujetos a disponibilidad real. Comprar una mensualidad no reserva ni garantiza horarios. " +
      "No se aceptan cupones de descuento ni se combina con otras promociones.",
  },
];

/**
 * Las mismas ocho condiciones en texto plano, "Título: regla".
 * Es una PROYECCIÓN de la lista de arriba, no una segunda copia: sirve para
 * buscar, auditar o comparar sin tener que recorrer objetos.
 */
export const CONDICIONES_MENSUALIDAD_TEXTO: readonly string[] =
  CONDICIONES_MENSUALIDAD.map((c) => `${c.titulo}: ${c.texto}`);

/** Lo que dice la casilla. Obligatoria y nunca premarcada. */
export const ACEPTACION_MENSUALIDAD = "Leí y acepto las condiciones de la mensualidad.";

// ── Condiciones de CADA RESERVA hecha con saldo (Bloque M5A) ────────────────
// Son distintas de las de compra y llevan su propia versión: lo que se guarda en
// la reserva es qué aceptó el titular ESE día, no lo que dice la web hoy.
// El texto no pide datos de los acompañantes: el titular acepta por el grupo.

// (M8C.1) Sube junto con la de compra: cambió el calendario del producto.
// Las reservas ya hechas conservan la versión que se les mostró.
export const CONDICIONES_RESERVA_VERSION = "2026-09-m8c1";

export const CONDICIONES_RESERVA: readonly string[] = [
  `El titular declara que todos los participantes cumplen la altura mínima de ${ALTURA_MINIMA_M} m y el peso máximo de ${PESO_MAXIMO_KG} kg.`,
  "El titular acepta estas condiciones en nombre de todo el grupo y es responsable de que se cumplan.",
  "La reserva queda a nombre del titular de la mensualidad, aunque el titular no asista.",
  "El saldo se descuenta al confirmar: la duración del turno multiplicada por la cantidad de simuladores.",
  "La reserva está sujeta a las políticas de cancelación y reprogramación de Mensualidades SIM.",
];

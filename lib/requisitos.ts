// Requisitos físicos para usar los simuladores. Fuente única y PURA.
//
// Existe porque el valor estaba escrito a mano en cada pantalla y Mensualidades
// terminó diciendo 1,35 m mientras el resto del sitio decía 1,40 m. Un cliente
// podía leer dos cifras distintas según por dónde entrara.
//
// Los valores son de SEGURIDAD, no comerciales: no dependen del producto, del
// plan ni del canal. Por eso viven acá y no dentro de un módulo.
//
// ALCANCE: hoy lo consume Mensualidades. Las otras seis pantallas que ya dicen
// 1,40 m —Campeonatos, Gift Cards, Reservas, Empresas, Sobre nosotros y los
// Términos legales— siguen con su texto propio y correcto; adoptar esta
// constante ahí es una limpieza aparte, no de este arreglo.

/** Altura mínima, en metros. Se escribe con coma: es texto para leer. */
export const ALTURA_MINIMA_M = "1,40";

/** Peso máximo, en kilogramos. */
export const PESO_MAXIMO_KG = 110;

/** "altura mínima 1,40 m y peso máximo 110 kg" — para intercalar en una frase. */
export const REQUISITOS_TEXTO =
  `altura mínima ${ALTURA_MINIMA_M} m y peso máximo ${PESO_MAXIMO_KG} kg`;

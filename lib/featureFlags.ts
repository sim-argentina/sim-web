// Feature flags del sitio público. Fuente de verdad ÚNICA y SERVER-SIDE: se leen
// de process.env sin prefijo NEXT_PUBLIC_*, así que el valor nunca viaja al bundle
// del navegador y no se puede activar desde el cliente. Importar solo desde Server
// Components, route handlers o middleware — nunca desde un archivo "use client".
//
// Semántica deliberadamente estricta: la variable tiene que valer exactamente
// "true" (sin espacios, en minúsculas). Cualquier otra cosa — ausente, vacía,
// "1", "TRUE", "yes" — deja la función DESHABILITADA. Es la opción segura para un
// módulo que todavía no existe: un typo en Vercel no lo publica por accidente.

// Normaliza y compara. Exportada aparte para poder testearla sin tocar process.env.
export function flagHabilitada(valor: string | undefined | null): boolean {
  return valor === "true";
}

// Mensualidades SIM (planes prepagos de horas). Mientras esté deshabilitada:
//  · /vivi-sim muestra solo Reservas y Gift Cards;
//  · /mensualidades responde 404.
// No agregar MENSUALIDADES_ENABLED a producción hasta terminar todos los bloques.
export function mensualidadesHabilitadas(): boolean {
  return flagHabilitada(process.env.MENSUALIDADES_ENABLED);
}

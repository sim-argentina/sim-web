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

// Experiencia post-pago de Reservas (pública desde el 18/10/2026). La variable
// queda como KILL SWITCH: en "true", Mercado Pago vuelve a /reservas/confirmacion
// para TODAS las Reservas web; apagada (ausente o cualquier otro valor), todo
// exactamente como antes y las rutas nuevas responden 404. La vista previa
// interna sigue siendo solo admin. Ver lib/reservaPostpay.ts.
export function reservaPostpayHabilitada(): boolean {
  return flagHabilitada(process.env.EXPERIMENTAL_RESERVA_POSTPAY);
}

// Marketing · CAPTACIÓN de promociones: el formulario /promos, /api/promos/texto,
// /api/promos/alta y la casilla voluntaria del checkout de Reservas y Gift Cards.
// Apagada, el formulario responde 404 y la casilla no aparece. Es la llave de
// ENTORNO; la de la BASE es el texto vigente (sin texto publicado no hay altas).
// NO apaga las bajas: /promos/baja y /api/promos/baja siguen siempre que el
// registro esté instalado. Con la llave apagada el panel (/admin/marketing)
// consulta y carga bajas, pero NO carga altas con evidencia (la captación del
// stand) ni publica textos: responde 503 "Deshabilitado".
export function marketingConsentimientoHabilitado(): boolean {
  return flagHabilitada(process.env.MARKETING_CONSENTIMIENTO_ENABLED);
}

// Marketing · CAMPAÑAS, llave maestra. Apagada (lo normal mientras Marketing no
// esté aprobado): todas las rutas de campañas responden 503 "Deshabilitado" —
// también a llamadas directas, antes de mirar la sesión—, el ejecutor de
// servidor no corre, no se escribe ninguna campaña aunque la base sea la local y
// el bloqueo de envíos reales a WhatsApp no se abre (falla antes de la red; ese
// chequeo vive en lib/marketing/whatsappCloud.ts con la misma regla estricta).
// En las pruebas locales la enciende `next-local.mjs --marketing-simulado`.
export function marketingCampaniasHabilitadas(entorno: Record<string, string | undefined> = process.env): boolean {
  return flagHabilitada(entorno.MARKETING_CAMPANIAS_ENABLED);
}

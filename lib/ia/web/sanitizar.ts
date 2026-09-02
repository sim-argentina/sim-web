// IA SIM · Bloque 4D — Prevención de filtraciones hacia la búsqueda web.
// NUNCA debe salir de SIM: emails, teléfonos, documentos, tarjetas, códigos de reserva,
// secretos, tokens, IDs internos. Funciones PURAS y testeables. Los nombres del equipo
// (Federico/Francisco/Ramiro) NO son PII de clientes.

export type DeteccionPII = { hay: boolean; tipos: string[] };

const PATRONES: Array<{ tipo: string; re: RegExp }> = [
  { tipo: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  // Teléfono: 8+ dígitos seguidos (con separadores opcionales), o prefijo +54 / 0351.
  { tipo: "telefono", re: /(?:\+?54\s?9?\s?)?(?:0?\d{2,4}[\s.-]?)?\d{3}[\s.-]?\d{4,}/ },
  { tipo: "documento", re: /\b(?:dni|documento|cuit|cuil|pasaporte)\b[\s:#]*\d[\d.\-]{5,}/i },
  { tipo: "tarjeta", re: /\b(?:\d[ -]?){13,19}\b/ },
  { tipo: "reserva", re: /\b(?:reserva|c[oó]digo|voucher|ticket|orden)\b[\s:#]*[A-Z0-9]{5,}/i },
  { tipo: "token", re: /\b(?:sk-ant-|sk-|bearer\s|api[_-]?key|token|secret|password|contrase[nñ]a)\b/i },
  { tipo: "uuid", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
];

// ¿El texto contiene PII / datos privados que NO deben convertirse en una consulta web?
export function contienePII(texto: string): DeteccionPII {
  const s = texto || "";
  const tipos: string[] = [];
  for (const p of PATRONES) if (p.re.test(s)) tipos.push(p.tipo);
  return { hay: tipos.length > 0, tipos };
}

// Sanea una cadena que se registrará como "consulta ejecutada": redacta PII y recorta.
// (La consulta real la forma el modelo; esto asegura que lo AUDITADO no filtre PII).
export function sanitizarConsultaWeb(texto: string, max = 300): string {
  let s = (texto || "").toString();
  s = s
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\b(?:sk-ant-[a-z0-9-]+|sk-[a-z0-9-]{10,})\b/gi, "[secreto]")
    .replace(/(?:\+?54\s?9?\s?)?(?:0?\d{2,4}[\s.-]?)?\d{3}[\s.-]?\d{4,}/g, "[telefono]")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, max);
}

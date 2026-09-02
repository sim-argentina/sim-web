// IA SIM · Bloque 4C — Sanitización de contenido no confiable.
// El texto de un informe puede venir de documentos/adjuntos: es DATO, nunca código.

// Formula injection (Excel/CSV): una celda de TEXTO que empieza con = + - @ (o
// tab/CR que algunos parsers colapsan) puede ejecutarse como fórmula. Se neutraliza
// prefijando un apóstrofo, sin alterar números reales (los números se exportan tipados).
const PELIGRO_INICIAL = /^[=+\-@\t\r]/;

export function neutralizarFormula(valor: unknown): string {
  const s = valor == null ? "" : String(valor);
  if (PELIGRO_INICIAL.test(s)) return `'${s}`;
  return s;
}

// ¿La celda de texto sería peligrosa como fórmula? (para marcar/auditar)
export function esFormulaPeligrosa(valor: unknown): boolean {
  return typeof valor === "string" && PELIGRO_INICIAL.test(valor);
}

// CSV: escapa comillas, envuelve en comillas si hay separador/salto/comilla, y
// neutraliza fórmulas. Separador por defecto coma.
export function celdaCSV(valor: unknown, sep = ","): string {
  const s = neutralizarFormula(valor);
  if (s.includes('"') || s.includes(sep) || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Links: solo se permiten http/https absolutos y bien formados. Cualquier otro
// esquema (javascript:, data:, file:, vbscript:…) se descarta.
export function linkSeguro(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const s = url.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Texto plano para PDF/DOCX/PNG: quita caracteres de control (excepto \t \n \r)
// que podrían romper el render, y recorta.
export function textoPlano(valor: unknown, max = 20000): string {
  const s = valor == null ? "" : String(valor);
  // Control chars excepto \t (09), \n (0A), \r (0D).
  const CTRL = new RegExp("[\x00-\x08\x0B\x0C\x0E-\x1F]", "g");
  return s.replace(CTRL, "").slice(0, max);
}

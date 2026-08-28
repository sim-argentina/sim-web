// Consolidación PURA de "Fuente / Medio" de GA4: agrupa SOLO equivalencias
// INEQUÍVOCAS (variantes de Instagram y Facebook, incluidos sus redirectores) en una
// única fuente legible. NO agrupa fuentes ambiguas y NO reemplaza la vista RAW (que se
// muestra aparte). No falsea datos: solo suma etiquetas que representan el mismo origen.
export type Fuente = { label: string; value: number };

const REGLAS: ReadonlyArray<{ grupo: string; test: RegExp }> = [
  // ig / social · l.instagram.com / referral · instagram.com / referral · instagram / *
  { grupo: "Instagram", test: /(^|[^a-z])(instagram|l\.instagram\.com|ig)([^a-z]|$)/i },
  // facebook / * · l.facebook.com · m.facebook.com · lm.facebook.com · fb
  { grupo: "Facebook", test: /(^|[^a-z])(facebook|l\.facebook\.com|m\.facebook\.com|lm\.facebook\.com|fb)([^a-z]|$)/i },
];

export function consolidarFuentes(items: Fuente[]): Fuente[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const label = it.label || "(not set)";
    const regla = REGLAS.find((r) => r.test.test(label));
    const key = regla ? regla.grupo : label;
    map.set(key, (map.get(key) ?? 0) + (Number(it.value) || 0));
  }
  return Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// Formatos del dashboard del Stand (es-AR). Puros: se usan en tarjetas, ejes,
// tooltips y en el detalle, así un mismo número se lee igual en todas partes.

const ENTERO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export function pesos(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$ ${ENTERO.format(Math.round(n))}`;
}

/** Para ejes y etiquetas cortas: $ 1,2 M · $ 450 k · $ 900. */
export function pesosCorto(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$ ${(n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: a >= 10_000_000 ? 0 : 1 })} M`;
  if (a >= 1_000) return `$ ${(n / 1_000).toLocaleString("es-AR", { maximumFractionDigits: 0 })} k`;
  return `$ ${ENTERO.format(n)}`;
}

export function entero(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return ENTERO.format(Math.round(n));
}

export function decimal(n: number | null | undefined, dec = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** 0,1234 → "12,3 %". */
export function porcentaje(x: number | null | undefined, dec = 1) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;
}

export function minutos(n: number | null | undefined, dec = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${decimal(n, Number.isInteger(n) ? 0 : dec)} min`;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-10-03" → "03/10/2026". */
export function fechaCorta(f: string) {
  const [y, m, d] = f.split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-10-03" → "3 oct". */
export function fechaDiaMes(f: string) {
  const [, m, d] = f.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
}

/** "2026-10" → "octubre 2026". */
export function mesLargo(clave: string) {
  const [y, m] = clave.split("-").map(Number);
  return `${MESES_LARGOS[m - 1]} ${y}`;
}

export function mesCorto(clave: string) {
  const [y, m] = clave.split("-").map(Number);
  return `${MESES[m - 1]} ${String(y).slice(2)}`;
}

/** Rango legible: "1–28 oct 2026", "3 sep – 2 oct 2026", "1 dic 2025 – 28 oct 2026". */
export function rangoTexto(desde: string, hasta: string) {
  const [y1, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  if (desde === hasta) return `${d1} ${MESES[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MESES[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]} ${y1}`;
  return `${d1} ${MESES[m1 - 1]} ${y1} – ${d2} ${MESES[m2 - 1]} ${y2}`;
}

export function horaRango(h: number) {
  return `${String(h).padStart(2, "0")}–${String(h + 1).padStart(2, "0")} h`;
}

export function minutoTexto(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

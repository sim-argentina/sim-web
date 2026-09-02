// IA SIM · Bloque 4D.1 — Semántica de período SEPARADA (no un único booleano ambiguo).
// - periodo_calendario: en curso / finalizado (según fecha de Córdoba).
// - cronograma_estado / finanzas_estado / datos_hasta: los informa cada fuente por separado.

const TZ = "America/Argentina/Cordoba";

export type EstadoPeriodo = {
  anio: number; mes: number;
  primer_dia: string; ultimo_dia: string;
  hoy_cordoba: string;
  periodo_calendario: "en_curso" | "finalizado";
  descripcion: string; // frase lista para el modelo, sin ambigüedad
};

function hoyCordoba(ahora: Date): string {
  return ahora.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

// Estado calendario del mes (anio-mes) respecto a HOY en Córdoba.
export function estadoPeriodoCalendario(anio: number, mes: number, ahora: Date = new Date()): EstadoPeriodo {
  const mm = String(mes).padStart(2, "0");
  const primer = `${anio}-${mm}-01`;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  const hoy = hoyCordoba(ahora);
  const finalizado = hoy > ultimo; // el último día del mes ya pasó en Córdoba
  return {
    anio, mes, primer_dia: primer, ultimo_dia: ultimo, hoy_cordoba: hoy,
    periodo_calendario: finalizado ? "finalizado" : "en_curso",
    descripcion: finalizado ? "Período calendario finalizado." : "Período calendario en curso (datos hasta la fecha/hora de corte).",
  };
}

const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

// ¿El texto menciona un mes+año que YA está finalizado (calendario Córdoba)? Se usa para
// validar que una respuesta no llame "incompleto" a un mes que ya terminó.
export function mesFinalizadoMencionado(texto: string, ahora: Date = new Date()): boolean {
  const t = (texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // "agosto de 2026" / "agosto 2026"
  for (const [nombre, m] of Object.entries(MESES)) {
    const re = new RegExp(`\\b${nombre}\\b[^\\d]{0,6}(20\\d{2})`);
    const mm = re.exec(t);
    if (mm) { if (estadoPeriodoCalendario(Number(mm[1]), m, ahora).periodo_calendario === "finalizado") return true; }
  }
  // "2026-08"
  for (const mm of t.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])\b/g)) {
    if (estadoPeriodoCalendario(Number(mm[1]), Number(mm[2]), ahora).periodo_calendario === "finalizado") return true;
  }
  return false;
}

// Frase honesta que combina calendario + cierre financiero (sin llamar "incompleto" a un mes
// que ya terminó). No inventa completitud si el sistema no la puede comprobar.
export function fraseEstado(periodo: EstadoPeriodo, opts?: { cronogramaEstado?: string | null; finanzasEstado?: string | null }): string {
  const partes: string[] = [periodo.descripcion];
  if (opts?.cronogramaEstado) partes.push(`Cronograma ${opts.cronogramaEstado}.`);
  if (opts?.finanzasEstado) {
    const f = opts.finanzasEstado;
    if (periodo.periodo_calendario === "finalizado" && f === "abierto") partes.push("Cierre financiero pendiente.");
    else partes.push(`Estado financiero: ${f}.`);
  }
  return partes.join(" ");
}

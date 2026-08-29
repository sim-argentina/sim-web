// Parser de cronogramas PDF/Canva (IA SIM · Bloque 2B) — lógica PURA y testeable.
// NO usa pdfjs ni DB: recibe items de texto YA posicionados {str,x,y,width} (y
// medida desde ARRIBA) + metadata de página, y reconstruye la grilla mensual.
// La extracción con pdfjs vive en lib/cronogramaPdfExtract.ts (server-only) y la
// resolución de alias/persistencia en lib/cronogramaImportServer.ts.
//
// Alcance soportado (primera versión): la plantilla de Canva del PDF real
// (una página horizontal, título "<Mes> <Año>", grilla SEMANA + Lunes..Domingo,
// jornadas "<alias> <hh>:<hh>hs"). No pretende interpretar PDFs arbitrarios.

import { normalizarAlias } from "@/lib/empleados";

export type TextItem = { str: string; x: number; y: number; width: number };
export type PdfMeta = { numPages: number; width: number; height: number };

export type JornadaCruda = {
  fecha: string; // YYYY-MM-DD (siempre del mes importado)
  alias_texto: string;
  hora_inicio: string; // "HH:MM"
  hora_fin: string; // "HH:MM"
};

export type TipoIncidencia =
  | "formato_no_reconocido"
  | "mes_anio_dudoso"
  | "fecha_dudosa"
  | "alias_desconocido"
  | "horario_invalido"
  | "jornada_fuera_horario"
  | "superposicion_invalida"
  | "posible_cerrado"
  | "entrada_no_reconocida"
  | "conflicto_borrador";

export type Incidencia = {
  tipo: TipoIncidencia;
  severidad: "bloqueante" | "advertencia";
  detalle: string;
  fecha?: string;
  texto?: string;
};

export type ParseFatal = { ok: false; incidencia: Incidencia };
export type ParseOk = {
  ok: true;
  anio: number;
  mes: number;
  jornadas: JornadaCruda[];
  diasCerrados: string[];
  aliasesTexto: string[];
  incidencias: Incidencia[];
};
export type ParseResult = ParseFatal | ParseOk;

export const APERTURA_OPERATIVA = "10:00";
export const CIERRE_OPERATIVO = "22:00";

const MESES_ES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const DIAS_ES = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

const pad = (n: number) => String(n).padStart(2, "0");

// "Agosto 2026" → {mes:8, anio:2026}. Tolera mayúsculas/acentos/espacios.
export function parseTituloMesAnio(s: string): { mes: number; anio: number } | null {
  const t = normalizarAlias(s); // minúsculas, sin acentos, espacios colapsados
  const m = t.match(/^([a-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const mes = MESES_ES[m[1]];
  const anio = Number(m[2]);
  if (!mes || anio < 2020 || anio > 2100) return null;
  return { mes, anio };
}

// Interpreta el rango horario de una jornada del cronograma: "10:20hs" → 10:00–20:00.
// Los dos números son HORAS (rango), no hora:minuto. Devuelve null si es inválido
// (inicio>=fin o fuera de 0..24), para marcarlo como incidencia.
export function parseRangoHoras(hRaw: string): { inicio: string; fin: string } | null {
  const m = hRaw.trim().match(/^(\d{1,2})\s*:\s*(\d{1,2})\s*hs$/i);
  if (!m) return null;
  const ini = Number(m[1]);
  const fin = Number(m[2]);
  if (!Number.isInteger(ini) || !Number.isInteger(fin)) return null;
  if (ini < 0 || fin > 24 || ini >= fin) return null;
  return { inicio: `${pad(ini)}:00`, fin: `${pad(fin)}:00` };
}

// Patrón de jornada completo: "<alias> <hh>:<hh>hs".
const JORNADA_RE = /^([\p{L}][\p{L}.]{1,})\s+(\d{1,2}\s*:\s*\d{1,2}\s*hs)$/iu;

// Grilla lunes-primero del mes: 6 filas × 7 columnas con la fecha (YYYY-MM-DD) o
// null para las celdas de meses adyacentes (grises).
export function construirGrilla(anio: number, mes: number): (string | null)[][] {
  const offset = (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7; // Lunes=0
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const grid: (string | null)[][] = [];
  for (let r = 0; r < 6; r++) {
    const fila: (string | null)[] = [];
    for (let c = 0; c < 7; c++) {
      const dayNum = r * 7 + c - offset + 1;
      fila.push(dayNum >= 1 && dayNum <= dias ? `${anio}-${pad(mes)}-${pad(dayNum)}` : null);
    }
    grid.push(fila);
  }
  return grid;
}

// Agrupa valores por saltos (clustering 1-D). Devuelve los centros ordenados.
function clusterY(valores: number[], gap: number): number[] {
  const ord = [...valores].sort((a, b) => a - b);
  const centros: number[] = [];
  let grupo: number[] = [];
  for (const v of ord) {
    if (grupo.length && v - grupo[grupo.length - 1] > gap) {
      centros.push(grupo.reduce((a, b) => a + b, 0) / grupo.length);
      grupo = [];
    }
    grupo.push(v);
  }
  if (grupo.length) centros.push(grupo.reduce((a, b) => a + b, 0) / grupo.length);
  return centros;
}

const centro = (it: TextItem) => it.x + it.width / 2;

// Parser principal. Determinístico; nunca inventa datos.
export function parseCronogramaPdf(items: TextItem[], meta: PdfMeta): ParseResult {
  const fatal = (tipo: TipoIncidencia, detalle: string): ParseFatal => ({
    ok: false,
    incidencia: { tipo, severidad: "bloqueante", detalle },
  });

  if (meta.numPages !== 1) {
    return fatal("formato_no_reconocido", "El PDF debe tener exactamente una página con un único calendario mensual.");
  }
  const conTexto = items.filter((it) => it.str && it.str.trim().length > 0);
  if (conTexto.length === 0) {
    return fatal("formato_no_reconocido", "El PDF no tiene capa de texto (¿es una imagen escaneada?). No se admite OCR en este bloque.");
  }

  // 1) Header: ubicar los 7 nombres de día para fijar columnas y la línea del header.
  const headerHits = new Map<number, TextItem>(); // colIndex → item
  for (const it of conTexto) {
    const idx = DIAS_ES.indexOf(normalizarAlias(it.str));
    if (idx >= 0 && !headerHits.has(idx)) headerHits.set(idx, it);
  }
  if (headerHits.size < 7) {
    return fatal("formato_no_reconocido", "No se pudo reconstruir la grilla (faltan encabezados de días de la semana).");
  }
  const colCentros: number[] = [];
  let headerY = 0;
  for (let i = 0; i < 7; i++) {
    const it = headerHits.get(i)!;
    colCentros.push(centro(it));
    headerY = Math.max(headerY, it.y + 4);
  }
  const anchoCol = (colCentros[6] - colCentros[0]) / 6;
  const colBordes: number[] = [];
  for (let i = 0; i < 6; i++) colBordes.push((colCentros[i] + colCentros[i + 1]) / 2);
  const colLimIzq = colCentros[0] - anchoCol * 0.75;
  const colLimDer = colCentros[6] + anchoCol * 0.75;

  const asignarCol = (it: TextItem): number => {
    const cx = centro(it);
    if (cx < colLimIzq || cx > colLimDer) return -1; // columna SEMANA / fuera de grilla
    let c = 0;
    while (c < 6 && colBordes[c] < cx) c++;
    return c;
  };

  // 2) Título mes/año (por encima del header).
  const titulos: Array<{ mes: number; anio: number }> = [];
  for (const it of conTexto) {
    if (it.y >= headerY) continue;
    const t = parseTituloMesAnio(it.str);
    if (t) titulos.push(t);
  }
  const distintos = [...new Set(titulos.map((t) => `${t.anio}-${t.mes}`))];
  if (distintos.length === 0) {
    return fatal("mes_anio_dudoso", "No se encontró un mes/año reconocible en el título (por ejemplo, 'Agosto 2026').");
  }
  if (distintos.length > 1) {
    return fatal("formato_no_reconocido", "El PDF contiene más de un calendario mensual. Solo se admite uno por archivo.");
  }
  const { mes, anio } = titulos[0];
  const grid = construirGrilla(anio, mes);

  // 3) Filas: anclas en los números de día (dentro de la grilla, debajo del header).
  const numItems = conTexto.filter(
    (it) => it.y > headerY && /^\d{1,2}$/.test(it.str.trim()) && asignarCol(it) >= 0,
  );
  const anchorsY = clusterY(numItems.map((it) => it.y), 25);
  if (anchorsY.length === 0) {
    return fatal("formato_no_reconocido", "No se pudo reconstruir la grilla (no se detectaron las filas del calendario).");
  }
  const rowBordes: number[] = [];
  for (let i = 0; i < anchorsY.length - 1; i++) rowBordes.push((anchorsY[i] + anchorsY[i + 1]) / 2);
  const asignarFila = (y: number): number => {
    let r = 0;
    while (r < rowBordes.length && rowBordes[r] < y) r++;
    return r;
  };

  // 4) Recorrer items del cuerpo → jornadas / cerrado / no reconocido.
  const jornadas: JornadaCruda[] = [];
  const diasCerrados = new Set<string>();
  const incidencias: Incidencia[] = [];
  const aliasesSet = new Map<string, string>(); // normalizado → texto original

  const apMin = 10 * 60; // 10:00
  const ciMin = 22 * 60; // 22:00

  for (const it of conTexto) {
    if (it.y <= headerY) continue; // header/título/notas
    const col = asignarCol(it);
    if (col < 0) continue; // SEMANA / fuera de grilla
    const fila = asignarFila(it.y);
    const fecha = grid[fila]?.[col] ?? null;
    if (!fecha) continue; // celda gris (mes adyacente) o fuera de rango

    const txt = it.str.trim();
    if (/^\d{1,2}$/.test(txt)) continue; // número de día

    if (/^cerrad[oa]$/i.test(txt)) {
      diasCerrados.add(fecha);
      continue;
    }
    if (/cerrad/i.test(txt)) {
      incidencias.push({ tipo: "posible_cerrado", severidad: "advertencia", detalle: `Posible indicación de cierre no reconocida: "${txt}".`, fecha, texto: txt });
      continue;
    }

    const m = txt.match(JORNADA_RE);
    if (!m) {
      incidencias.push({ tipo: "entrada_no_reconocida", severidad: "advertencia", detalle: `Texto no reconocido en la celda del ${fecha}: "${txt}".`, fecha, texto: txt });
      continue;
    }
    const aliasTexto = m[1].trim();
    const rango = parseRangoHoras(m[2]);
    if (!rango) {
      incidencias.push({ tipo: "horario_invalido", severidad: "bloqueante", detalle: `Horario ambiguo o inválido en "${txt}" (${fecha}). Se interpreta "H:H" como rango de horas.`, fecha, texto: txt });
      continue;
    }
    // Fuera del horario operativo por defecto (10–22) → advertencia (ajustable).
    const iniMin = Number(rango.inicio.slice(0, 2)) * 60;
    const finMin = Number(rango.fin.slice(0, 2)) * 60;
    if (iniMin < apMin || finMin > ciMin) {
      incidencias.push({ tipo: "jornada_fuera_horario", severidad: "advertencia", detalle: `La jornada "${txt}" (${fecha}) queda fuera del horario operativo por defecto (10–22).`, fecha, texto: txt });
    }
    aliasesSet.set(normalizarAlias(aliasTexto), aliasTexto);
    jornadas.push({ fecha, alias_texto: aliasTexto, hora_inicio: rango.inicio, hora_fin: rango.fin });
  }

  return {
    ok: true,
    anio,
    mes,
    jornadas,
    diasCerrados: [...diasCerrados],
    aliasesTexto: [...aliasesSet.values()],
    incidencias,
  };
}

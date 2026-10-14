// ============================================================================
// Importación de Excel HISTÓRICOS del stand (Métricas → Stand → Subir Excel).
// ----------------------------------------------------------------------------
// Módulo PURO: sin supabaseAdmin, sin red, sin xlsx. Lo usan la página de
// Métricas (navegador), la API /api/turnos-historicos (servidor) y las pruebas.
//
// EL AÑO NUNCA SE ASUME
// El importador original armaba la fecha con `new Date().getFullYear()` y el mes
// del nombre del archivo. Los Excel de octubre, noviembre y diciembre de 2025
// se cargaron el 20/05/2026 y quedaron guardados como 2026 (meses que todavía
// no habían ocurrido). Ahora cada archivo se confirma con mes y año antes de
// importar: si el archivo trae un año explícito y válido se PRESELECCIONA, y si
// no, hay que elegirlo. Una fecha futura o inexistente bloquea la importación.
//
// EL HASH INCLUYE LA FECHA
// `hash_unico` = archivo_key | fecha | horas | pago | monto | sims | turnos |
// duración | escudería. Reimportar el mismo archivo con el MISMO año no duplica
// (upsert ignora el hash repetido); con OTRO año son ventas distintas. Por eso
// la corrección de datos reescribe el segmento de fecha del hash junto con la
// fecha (db/turnos-historicos-correccion-anio.sql).
//
// UNA SOLA NORMALIZACIÓN
// El pago y el hash se calculan con las mismas funciones en el navegador y en
// el servidor: la API rearma cada fila con filaHistoricaCanonica y recalcula el
// hash, sin confiar en el que manda el navegador. "Trasf", "Tranf" y "Transf."
// son TRANSFERENCIA (db/turnos-historicos-transferencias.sql unificó las cuatro
// filas que habían quedado como TRASF/TRANF).
// ============================================================================

/** Primer año aceptado para un Excel histórico. */
export const ANIO_MINIMO_HISTORICO = 2020;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MESES: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function nombreMes(mes: string): string {
  return NOMBRES_MES[Number(mes) - 1] ?? mes;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// ── Normalizadores (los mismos que usaba la página; el hash depende de ellos) ──

export function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;

  return (
    Number(
      String(value)
        .replace("$", "")
        .replace(/\./g, "")
        .replace(",", ".")
        .trim()
    ) || 0
  );
}

export function excelTimeToString(value: unknown) {
  if (!value) return "";

  if (value instanceof Date) {
    return value.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return String(value);
}

export function normalizarMetodoPago(value: unknown) {
  const v = normalizeText(value);

  if (!v) return "";
  if (v.includes("qr") || v.includes("mp") || v.includes("mercado")) return "QR";
  if (v === "ef" || v.includes("efectivo") || v.includes("cash")) return "EFECTIVO";
  if (v.includes("deb")) return "DÉBITO";
  if (v.includes("cred") || v.includes("credito")) return "CRÉDITO";
  // "transf" (p. ej. "Transf."): los Excel se importaron el 20/05/2026 cuando la
  // condición era includes("trans") y guardaron TRANSFERENCIA. Sin esta variante,
  // reimportarlos daba "TRANSF", otro hash y ventas duplicadas.
  if (  v.includes("trasf") ||  v.includes("tranf") ||  v.includes("transf") ||  v.includes("transfer") ||
  v.includes("transferencia")
)
  return "TRANSFERENCIA";

  return v.toUpperCase();
}

export function getRowValue(row: object, posiblesNombres: string[]) {
  const entries = Object.entries(row);

  for (const nombre of posiblesNombres) {
    const buscado = normalizeText(nombre);
    const match = entries.find(([key]) => normalizeText(key) === buscado);
    if (match) return match[1];
  }

  for (const nombre of posiblesNombres) {
    const buscado = normalizeText(nombre);
    const match = entries.find(([key]) => normalizeText(key).includes(buscado));
    if (match) return match[1];
  }

  return null;
}

export function crearArchivoKey(fileName: string) {
  return normalizeText(fileName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Campos que intervienen en la deduplicación (fila en vivo o de Excel). */
export type FilaDeduplicable = {
  id?: number | null;
  origen?: string | null;
  archivo_key?: string | null;
  fecha?: string | null;
  hora_tomado?: unknown;
  hora_subida?: unknown;
  hora_bajada?: unknown;
  metodo_pago?: unknown;
  total?: unknown;
  monto?: unknown;
  cantidad_simuladores?: unknown;
  personas?: unknown;
  cantidad_turnos?: unknown;
  duracion?: unknown;
  escuderia?: unknown;
  simulador?: unknown;
};

export function crearHashTurno(t: FilaDeduplicable, archivoKey = "") {
  // Filas en vivo del turnero (no Excel) tienen id único (PK): se deduplican por
  // ese id. Los campos hora_tomado/duracion/escuderia están vacíos en vivo, así
  // que el hash por contenido colapsaba ventas distintas que coincidían en
  // fecha/monto/turnos (mismo importe, mismo día). El id evita ese falso duplicado.
  if (t.origen !== "excel" && t.id != null) {
    return `stand-id:${t.id}`;
  }
  return [
    archivoKey || t.archivo_key || "",
    t.fecha || "",
    excelTimeToString(t.hora_tomado || ""),
    excelTimeToString(t.hora_subida || ""),
    excelTimeToString(t.hora_bajada || ""),
    normalizarMetodoPago(t.metodo_pago),
    numberValue(t.total ?? t.monto),
    numberValue(t.cantidad_simuladores || t.personas || 1),
    numberValue(t.cantidad_turnos || 1),
    numberValue(t.duracion || 0),
    normalizeText(t.escuderia || t.simulador || ""),
  ].join("|");
}

// ── Mes, año y fecha ─────────────────────────────────────────────────────────

/** Mes ("01".."12") escrito en el nombre del archivo, o null. Nunca el mes actual. */
export function mesDesdeNombre(fileName: string): string | null {
  const name = normalizeText(fileName);
  for (const key of Object.keys(MESES)) {
    if (name.includes(key)) return MESES[key];
  }
  return null;
}

/** Años de cuatro cifras (20xx) escritos en el nombre del archivo. */
export function aniosEnNombre(fileName: string): number[] {
  const encontrados = new Set<number>();
  for (const m of fileName.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)) encontrados.add(Number(m[1]));
  return [...encontrados].sort();
}

/**
 * Día que representa una hoja. "5" o "05" → día 5; "02-10", "2/10", "02.10" →
 * día 2 del mes 10. Cualquier otro nombre (TOTAL, RESUMEN, "0111") no es un día.
 */
export function diaDesdeHoja(nombre: string): { dia: number; mes: string | null } | null {
  const s = String(nombre).trim();
  let m = /^(\d{1,2})$/.exec(s);
  if (m) {
    const dia = Number(m[1]);
    return dia >= 1 && dia <= 31 ? { dia, mes: null } : null;
  }
  m = /^(\d{1,2})\s*[-/._ ]\s*(\d{1,2})$/.exec(s);
  if (m) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) return { dia, mes: pad2(mes) };
  }
  return null;
}

/** YYYY-MM-DD si la fecha existe en el calendario (31/11 no existe), o null. */
export function fechaHistorica(anio: number, mes: string, dia: number): string | null {
  const m = Number(mes);
  if (!Number.isInteger(anio) || !Number.isInteger(m) || !Number.isInteger(dia)) return null;
  if (m < 1 || m > 12 || dia < 1) return null;
  const ultimo = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  if (dia > ultimo) return null;
  return `${anio}-${pad2(m)}-${pad2(dia)}`;
}

/** Años que se pueden elegir para un Excel histórico, del más reciente al más viejo. */
export function aniosSeleccionables(hoy: string): number[] {
  const actual = Number(hoy.slice(0, 4));
  const out: number[] = [];
  for (let a = actual; a >= ANIO_MINIMO_HISTORICO; a--) out.push(a);
  return out;
}

/** null si mes/año sirven para un histórico; si no, el motivo. */
export function validarPeriodo(anio: number | null, mes: string | null, hoy: string): string | null {
  if (!mes || !/^(0[1-9]|1[0-2])$/.test(mes)) return "Elegí el mes.";
  if (anio == null || !Number.isInteger(anio)) return "Elegí el año.";
  const actual = Number(hoy.slice(0, 4));
  if (anio < ANIO_MINIMO_HISTORICO || anio > actual) {
    return `El año tiene que estar entre ${ANIO_MINIMO_HISTORICO} y ${actual}.`;
  }
  if (`${anio}-${mes}` > hoy.slice(0, 7)) {
    return `${capitalizar(nombreMes(mes))} de ${anio} todavía no ocurrió.`;
  }
  return null;
}

/** null si la fecha de una venta histórica es válida; si no, el motivo. */
export function validarFechaHistorica(fecha: unknown, hoy: string): string | null {
  if (typeof fecha !== "string" || !FECHA_RE.test(fecha)) return `Fecha con formato inválido: ${String(fecha)}`;
  const [y, m, d] = fecha.split("-").map(Number);
  if (fechaHistorica(y, pad2(m), d) !== fecha) return `La fecha ${fecha} no existe.`;
  if (y < ANIO_MINIMO_HISTORICO) return `La fecha ${fecha} es anterior a ${ANIO_MINIMO_HISTORICO}.`;
  if (fecha > hoy) return `La fecha ${fecha} es posterior a hoy (${hoy}).`;
  return null;
}

function capitalizar(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// ── Análisis de un archivo y armado de las ventas ────────────────────────────

/** Una hoja ya leída del libro: filas como objetos y las fechas reales que contiene. */
export type HojaExcel = {
  nombre: string;
  filas: Record<string, unknown>[];
  /** Celdas con fecha de calendario (las horas sueltas de Excel quedan en 1899 y no cuentan). */
  fechas: Date[];
};

export type DiaArchivo = {
  hoja: string;
  dia: number;
  /** Mes escrito en el nombre de la hoja ("02-10" → "10"), o null. */
  mesHoja: string | null;
  filas: Record<string, unknown>[];
};

export type ArchivoAnalizado = {
  nombre: string;
  archivoKey: string;
  mesDetectado: string | null;
  /** Año explícito y válido para preseleccionar, o null (hay que elegirlo). */
  anioDetectado: number | null;
  /** Explicación para quien confirma: de dónde sale el año o por qué no se preselecciona. */
  motivoAnio: string;
  dias: DiaArchivo[];
  /** Hojas con ventas cuyo nombre no es un día reconocible: no se importan. */
  hojasIgnoradas: string[];
  ventasLeidas: number;
};

function esVenta(row: Record<string, unknown>) {
  const monto = numberValue(getRowValue(row, ["Monto"]));
  const metodoPago = normalizarMetodoPago(getRowValue(row, ["Metodo de Pago", "Método de Pago", "Pago"]));
  return Boolean(monto && monto > 0 && metodoPago);
}

export function analizarArchivo(nombre: string, hojas: HojaExcel[], hoy: string): ArchivoAnalizado {
  const dias: DiaArchivo[] = [];
  const hojasIgnoradas: string[] = [];
  let ventasLeidas = 0;

  for (const hoja of hojas) {
    const ventas = hoja.filas.filter(esVenta).length;
    const dia = diaDesdeHoja(hoja.nombre);
    if (!dia) {
      if (ventas > 0) hojasIgnoradas.push(hoja.nombre);
      continue;
    }
    dias.push({ hoja: hoja.nombre, dia: dia.dia, mesHoja: dia.mes, filas: hoja.filas });
    ventasLeidas += ventas;
  }

  // Mes: el del nombre del archivo; si no lo tiene, el de las hojas "DD-MM" cuando coinciden todas.
  let mesDetectado = mesDesdeNombre(nombre);
  if (!mesDetectado) {
    const mesesHojas = new Set(dias.map((d) => d.mesHoja).filter((m): m is string => Boolean(m)));
    if (mesesHojas.size === 1) mesDetectado = [...mesesHojas][0];
  }

  // Año: el escrito en el nombre y el de las fechas de calendario dentro del libro
  // (si se conoce el mes, solo las fechas de ese mes). Se preselecciona solo si
  // toda la evidencia apunta a UN año y ese año es válido para el mes.
  const delNombre = aniosEnNombre(nombre);
  const fechas = hojas.flatMap((h) => h.fechas).filter((f) => f instanceof Date && !Number.isNaN(f.getTime()) && f.getFullYear() >= 2000);
  const delMes = mesDetectado ? fechas.filter((f) => pad2(f.getMonth() + 1) === mesDetectado) : fechas;
  const delContenido = [...new Set(delMes.map((f) => f.getFullYear()))].sort();
  const evidencia = [...new Set([...delNombre, ...delContenido])].sort();

  let anioDetectado: number | null = null;
  let motivoAnio: string;
  if (evidencia.length === 0) {
    motivoAnio = "El archivo no indica el año: elegilo.";
  } else if (evidencia.length > 1) {
    motivoAnio = `El archivo menciona varios años (${evidencia.join(", ")}): elegí el correcto.`;
  } else {
    const anio = evidencia[0];
    const fuente = delNombre.length && delContenido.length ? "del nombre y de las fechas del archivo" : delNombre.length ? "del nombre del archivo" : "de las fechas dentro del archivo";
    const problema = mesDetectado ? validarPeriodo(anio, mesDetectado, hoy) : null;
    if (anio < ANIO_MINIMO_HISTORICO || anio > Number(hoy.slice(0, 4))) {
      motivoAnio = `El archivo indica ${anio}, fuera del rango permitido: elegí el año.`;
    } else if (problema) {
      motivoAnio = `El archivo indica ${anio}, pero no es válido: ${problema}`;
    } else {
      anioDetectado = anio;
      motivoAnio = `Año ${anio} tomado ${fuente}. Confirmalo.`;
    }
  }

  return {
    nombre,
    archivoKey: crearArchivoKey(nombre),
    mesDetectado,
    anioDetectado,
    motivoAnio,
    dias,
    hojasIgnoradas,
    ventasLeidas,
  };
}

/** Venta lista para POST /api/turnos-historicos. */
export type TurnoHistoricoImportado = {
  archivo_nombre: string;
  archivo_key: string;
  fecha: string;
  hora_tomado: string;
  hora_subida: string;
  hora_bajada: string;
  metodo_pago: string;
  total: number;
  cantidad_simuladores: number;
  cantidad_turnos: number;
  duracion: number;
  escuderia: string;
  simulador: string;
  origen: "excel";
  hash_unico: string;
};

/**
 * Arma las ventas de un archivo con el mes y el año CONFIRMADOS. Si algo no
 * cierra (período futuro, día inexistente, hoja de otro mes) devuelve errores y
 * ninguna venta: el archivo no se importa a medias.
 */
export function construirTurnos(
  archivo: ArchivoAnalizado,
  anio: number | null,
  mes: string | null,
  hoy: string,
): { turnos: TurnoHistoricoImportado[]; errores: string[] } {
  const problema = validarPeriodo(anio, mes, hoy);
  if (problema) return { turnos: [], errores: [problema] };
  const anioOk = anio as number;
  const mesOk = mes as string;

  const errores: string[] = [];
  const turnos: TurnoHistoricoImportado[] = [];
  const claves = new Set<string>();

  for (const d of archivo.dias) {
    const ventas = d.filas.filter(esVenta);
    if (ventas.length === 0) continue;

    if (d.mesHoja && d.mesHoja !== mesOk) {
      errores.push(`La hoja "${d.hoja}" es de ${nombreMes(d.mesHoja)}, no de ${nombreMes(mesOk)}.`);
      continue;
    }
    const fecha = fechaHistorica(anioOk, mesOk, d.dia);
    if (!fecha) {
      errores.push(`La hoja "${d.hoja}" tiene ventas, pero ${nombreMes(mesOk)} de ${anioOk} no tiene día ${d.dia}.`);
      continue;
    }
    const invalida = validarFechaHistorica(fecha, hoy);
    if (invalida) {
      errores.push(`Hoja "${d.hoja}": ${invalida}`);
      continue;
    }

    for (const row of ventas) {
      const monto = numberValue(getRowValue(row, ["Monto"]));
      const metodoPago = normalizarMetodoPago(
        getRowValue(row, ["Metodo de Pago", "Método de Pago", "Pago"])
      );

      const escuderia = String(
        getRowValue(row, ["Escuderia", "Escudería", "Simulador"]) || ""
      );

      const cantidadSimuladores =
        numberValue(getRowValue(row, ["Cant. de Sim.", "Cantidad de Sim", "Cant Sim"])) || 1;

      const cantidadTurnos =
        numberValue(getRowValue(row, ["Cant. Turnos", "Cantidad Turnos", "Turnos"])) ||
        cantidadSimuladores ||
        1;

      const duracion =
        numberValue(getRowValue(row, ["Tiempo (Min)", "Tiempo", "Duracion", "Duración"])) || 15;

      const turno: Omit<TurnoHistoricoImportado, "hash_unico"> = {
        archivo_nombre: archivo.nombre,
        archivo_key: archivo.archivoKey,
        fecha,
        hora_tomado: excelTimeToString(
          getRowValue(row, ["Hora que se tomo el turno", "Hora tomado"])
        ),
        hora_subida: excelTimeToString(getRowValue(row, ["Hora de subida", "Hora subida"])),
        hora_bajada: excelTimeToString(getRowValue(row, ["Hora de bajada", "Hora bajada"])),
        metodo_pago: metodoPago,
        total: monto,
        cantidad_simuladores: cantidadSimuladores,
        cantidad_turnos: cantidadTurnos,
        duracion,
        escuderia,
        simulador: escuderia,
        origen: "excel",
      };

      const hash = crearHashTurno(turno, archivo.archivoKey);
      if (claves.has(hash)) continue;
      claves.add(hash);
      turnos.push({ ...turno, hash_unico: hash });
    }
  }

  if (errores.length) return { turnos: [], errores };
  return { turnos, errores };
}

// ── Validación del lote en el servidor ───────────────────────────────────────

/**
 * Valida lo que llega a POST /api/turnos-historicos: archivo identificado,
 * fecha que exista y no sea futura, y un medio de pago reconocible. El hash no
 * se valida porque el servidor lo recalcula (filaHistoricaCanonica).
 */
export function validarLoteHistorico(turnos: unknown, hoy: string): string | null {
  if (!Array.isArray(turnos) || turnos.length === 0) return "No se recibieron turnos para guardar";
  for (const t of turnos as Record<string, unknown>[]) {
    const archivoKey = typeof t?.archivo_key === "string" ? t.archivo_key : "";
    if (!archivoKey || typeof t?.archivo_nombre !== "string" || !t.archivo_nombre) {
      return "Cada turno necesita archivo_nombre y archivo_key";
    }
    const invalida = validarFechaHistorica(t.fecha, hoy);
    if (invalida) return `${t.archivo_nombre}: ${invalida}`;
    if (!normalizarMetodoPago(t.metodo_pago)) return `${t.archivo_nombre}: falta el medio de pago (${String(t.fecha)})`;
  }
  return null;
}

/** Venta tal como se guarda en turnos_historicos. */
export type FilaHistoricaGuardable = {
  archivo_nombre: string;
  archivo_key: string;
  fecha: string;
  hora_subida: string | null;
  hora_bajada: string | null;
  hora_tomado: string | null;
  metodo_pago: string;
  total: number;
  cantidad_simuladores: number;
  cantidad_turnos: number;
  duracion: number;
  escuderia: string | null;
  hash_unico: string;
  origen: "excel";
};

/**
 * La fila que se guarda, armada en el SERVIDOR con las mismas funciones que el
 * importador: pago normalizado ("Trasf", "Tranf", "Transf." → TRANSFERENCIA) y
 * hash recalculado sobre los valores que se guardan. Un navegador con una
 * versión vieja de la página no puede guardar otra variante ni otro hash para
 * la misma venta. Para una venta armada por construirTurnos da el mismo hash.
 */
export function filaHistoricaCanonica(t: Record<string, unknown>): FilaHistoricaGuardable {
  const texto = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  const fila = {
    archivo_nombre: String(t.archivo_nombre ?? ""),
    archivo_key: String(t.archivo_key ?? ""),
    fecha: String(t.fecha ?? ""),
    hora_subida: texto(t.hora_subida),
    hora_bajada: texto(t.hora_bajada),
    hora_tomado: texto(t.hora_tomado),
    metodo_pago: normalizarMetodoPago(t.metodo_pago),
    total: Number(t.total || 0),
    cantidad_simuladores: Number(t.cantidad_simuladores || 1),
    cantidad_turnos: Number(t.cantidad_turnos || 1),
    duracion: Number(t.duracion || 15),
    escuderia: texto(t.escuderia),
    origen: "excel" as const,
  };
  return { ...fila, hash_unico: crearHashTurno(fila, fila.archivo_key) };
}

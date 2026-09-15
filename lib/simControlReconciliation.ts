// Conciliación de una jornada: lo que registraron las terminales de SIM Control contra lo que
// registró el sistema central (Turnero + Reservas).
//
// ── La unidad es SIMULADOR-MINUTOS ──────────────────────────────────────────────
// Un simulador ocupado un minuto = 1 simulador-minuto. Así, 4 cabinas media hora y una cabina dos
// horas son lo mismo: 120. Es la única unidad que sobrevive a que las cabinas cambien de nombre, se
// renumeren o pasen a ser todas iguales.
//
// ── Lo que esta conciliación NO hace ────────────────────────────────────────────
// NO le pregunta a nadie qué cabina hizo qué. "Ferrari", "McLaren", "Red Bull" y "Alpine" son hoy
// nombres visuales de cuatro cabinas comercialmente equivalentes. Si el total del día cuadra, cuadra.
//
// NO espera a que "todas las terminales" reporten. Una PC que estuvo apagada, fuera de servicio o
// simplemente sin clientes no tiene por qué mandar un paquete vacío para que las demás puedan
// verificar, ni hay que darla de baja administrativamente porque ese día no se usó.
//
// `simuladores[]` y `terminal_key` se conservan como dato operativo —sirven para diagnóstico,
// auditoría y métricas— pero NINGUNO de los dos participa de la decisión.
//
// ── La regla, entera ────────────────────────────────────────────────────────────
//   SIM Control  <  Central  → pending   (falta sincronizar; todavía no hay nada que reclamar)
//   SIM Control  == Central  → verified
//   SIM Control  >  Central  → mismatch  (hay actividad que el central no respalda)
//
// Que falte es Pending y que sobre es Mismatch, y la asimetría es a propósito: si faltan minutos,
// lo más probable es que otra PC no haya sincronizado todavía. Si sobran, esperar no ayuda — sumar
// más sesiones solo agranda la diferencia.
//
// ── Es una FOTO, no un veredicto definitivo ─────────────────────────────────────
// Se recalcula en cada ingestión y en cada reintento. Una fecha puede cuadrar a las 19:00 (120/120),
// volver a operar, y cuadrar otra vez a las 22:00 (180/180) sin ninguna contradicción. Un paquete
// que ya recibió un Verified real NO vuelve atrás por actividad posterior: su comprobante sigue
// valiendo y lo nuevo se verifica con los paquetes siguientes.
//
// Módulo PURO: sin Supabase, sin red, sin fecha del sistema. Todo entra por parámetro para poder
// testear los casos de borde exactos.

export const MINUTOS_POR_BLOQUE = 15;

/** Estado de la conciliación de una fecha comercial completa. */
export type EstadoConciliacion = "pending" | "verified" | "mismatch";

/**
 * Momento del corte, en hora LOCAL de SIM, como `YYYY-MM-DDTHH:mm`.
 *
 * Se compara como texto contra `fecha`+`hora` de las filas centrales, que también son hora local.
 * Nunca se construye un `Date` con esos campos: mezclar la hora de pared del Turnero con el UTC del
 * servidor de Vercel es la forma clásica de correr un día entero.
 */
export type CorteLocal = string;

/** Fila de `turnos_stand` con lo mínimo necesario para conciliar. */
export type FilaStandConciliable = {
  id?: number | string | null;
  estado?: string | null;
  fecha?: string | null;
  hora?: string | null;
  cantidad_simuladores?: number | string | null;
  cantidad_minutos?: number | string | null;
  cantidad_turnos?: number | string | null;
  cantidad_personas?: number | string | null;
  // Evidencia operativa de uso, cargada desde el Turnero.
  hora_subida?: string | null;
  hora_bajada?: string | null;
  turno_listo?: boolean | null;
};

/** Fila de `reservas` + su `reserva_operacion`, con lo mínimo necesario para conciliar. */
export type FilaReservaConciliable = {
  id?: number | string | null;
  estado?: string | null;
  no_show?: boolean | null;
  fecha?: string | null;
  hora?: string | null;
  duracion_minutos?: number | string | null;
  simuladores?: string[] | string | null;
  cantidad_turnos?: number | string | null;
  // Evidencia operativa de uso (vive en reserva_operacion).
  hora_subida?: string | null;
  hora_bajada?: string | null;
  listo?: boolean | null;
};

/** Sesión ya ingerida de SIM Control (proyección de `sim_control_sessions`). */
export type SesionConciliable = {
  terminal_key: string;
  local_session_id: string;
  counts_for_reconciliation: boolean;
  authorized_duration_minutes: number;
  session_type?: string | null;
  status?: string | null;
  /** Instantes UTC reales del turno. Deciden a qué corte pertenece la sesión. */
  finished_at_utc?: string | null;
  started_at_utc?: string | null;
};

/** Por qué una fila central no aportó minutos. Se guarda para poder explicar un total. */
export type MotivoExclusion = "cancelada" | "no_show" | "sin_datos" | "todavia_no_usada";

export type AporteCentral = {
  fuente: "stand" | "reserva";
  id: string;
  simuladorMinutos: number;
  /** Qué cálculo se usó, para que una diferencia se pueda auditar en vez de adivinar. */
  formula: "simuladores_x_minutos" | "turnos_x_15" | "excluida";
  excluidaPor?: MotivoExclusion;
};

export type TotalesCentral = {
  simuladorMinutos: number;
  bloques: number;
  operaciones: number;
  operacionesStand: number;
  operacionesReserva: number;
  excluidas: number;
  /** Vendidas pero agendadas para después del corte: todavía no son uso real. */
  noUsadasTodavia: number;
  aportes: AporteCentral[];
};

export type TotalesSimControl = {
  simuladorMinutos: number;
  bloques: number;
  /** Sesiones que cuentan para conciliación (las que representan una venta). */
  sesionesConciliables: number;
  sesionesNoConciliables: number;
  sesionesMantenimiento: number;
  sesionesReiniciadas: number;
  terminales: string[];
  /** Sesiones de la misma fecha que quedaron fuera por ser posteriores al corte. */
  sesionesPosterioresAlCorte: number;
};

export type ResultadoConciliacion = {
  businessDate: string;
  estado: EstadoConciliacion;
  central: TotalesCentral;
  simControl: TotalesSimControl;
  /** central − simControl, en simulador-minutos. 0 = cuadra; >0 falta sincronizar; <0 sobra. */
  diferenciaSimuladorMinutos: number;
  /** Terminales que aportaron algo a esta fecha. SOLO auditoría: no participa de la decisión. */
  terminalesQueAportaron: string[];
  /** Frase corta y sin secretos para mostrarle a OWNER o al panel. */
  resumen: string;
};

// ── Parseo tolerante ─────────────────────────────────────────────────────────────
// Mismo criterio que `lib/metricasStand.ts`: los datos vienen de carga manual y de importaciones
// históricas, así que un "30" string o un " 2 " no pueden romper una conciliación.
function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace("$", "").replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

// ── Atribución temporal ─────────────────────────────────────────────────────────
// A qué cierre pertenece una operación. La conciliación compara TURNOS COMPLETOS, no fracciones de
// ejecución, así que lo que decide es cuándo EMPEZÓ — nunca cuándo terminó.
//
// Un turno que arranca 18:50 y termina 19:20 pertenece al cierre de las 19:00 con sus 30 minutos
// enteros. Decidir por el final lo dejaría fuera de ese cierre para siempre, y P1 quedaría Pending
// eternamente esperando minutos que ya nadie le va a atribuir.

/** `HH:mm` normalizado (acepta `HH:mm:ss`). Null si no se entiende. */
function horaNormalizada(hora: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Instante al que se atribuye una operación central, como `YYYY-MM-DDTHH:mm` local.
 *
 *  1. `hora_subida` — el momento REAL en que el cliente se subió. Es la mejor señal que hay.
 *  2. Si no está, el horario programado de la fila. No es un dato inventado: es de la propia fila,
 *     y evita el peor error posible — si se exigiera `hora_subida` siempre, una tarde en la que
 *     nadie la cargó dejaría al central por debajo de SIM Control, y eso no es "faltan datos" sino
 *     `mismatch`: una alarma de actividad sin respaldo, todos los días, por un campo sin llenar.
 *
 * `hora_bajada` y `listo` NO participan: dicen cuándo terminó o que terminó, no a qué período
 * pertenece el turno. Se conservan para auditoría.
 */
function instanteDeAtribucion(fila: {
  fecha?: string | null;
  hora?: string | null;
  hora_subida?: string | null;
}): string | null {
  const fecha = fila.fecha ? String(fila.fecha).slice(0, 10) : null;
  if (!fecha) return null;

  const inicioReal = horaNormalizada(fila.hora_subida);
  if (inicioReal) return `${fecha}T${inicioReal}`;

  const programada = horaNormalizada(fila.hora);
  return programada ? `${fecha}T${programada}` : null;
}

/** ¿Esta operación empezó DESPUÉS del corte? Entonces es de un cierre posterior. */
function esPosteriorAlCorteCentral(
  fila: { fecha?: string | null; hora?: string | null; hora_subida?: string | null },
  corte: CorteLocal | undefined
): boolean {
  if (!corte) return false; // sin corte no se descarta nada: el llamador decidió no filtrar

  const instante = instanteDeAtribucion(fila);
  if (!instante) return false; // sin horario no hay forma de ubicarla: no se descarta

  // Comparación textual sobre `YYYY-MM-DDTHH:mm`, que ordena igual que el tiempo.
  return instante > corte;
}

function simuladoresDe(valor: string[] | string | null | undefined): string[] {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === "string" && valor.trim()) {
    try {
      const parsed = JSON.parse(valor);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ── Central ─────────────────────────────────────────────────────────────────────

/**
 * Simulador-minutos de un turno del stand.
 *
 * Fórmula principal: `cantidad_simuladores × cantidad_minutos`.
 *
 * Si `cantidad_simuladores` no está cargado (la selección de cabinas es opcional en el Turnero), se
 * usa `cantidad_turnos × 15`, que da EXACTAMENTE lo mismo cuando los datos están completos: el
 * Turnero calcula `cantidad_turnos = cantidad_personas × (cantidad_minutos / 15)` y en el stand hay
 * una persona por cabina. Una fila sin cabinas cargadas concilia igual: no vale bloquear una jornada
 * por un dato visual.
 */
export function simuladorMinutosStand(fila: FilaStandConciliable, corte?: CorteLocal): AporteCentral {
  const id = String(fila.id ?? "");
  if (String(fila.estado ?? "").toLowerCase() === "cancelado") {
    return { fuente: "stand", id, simuladorMinutos: 0, formula: "excluida", excluidaPor: "cancelada" };
  }

  if (esPosteriorAlCorteCentral(fila, corte)) {
    return { fuente: "stand", id, simuladorMinutos: 0, formula: "excluida", excluidaPor: "todavia_no_usada" };
  }

  const sims = num(fila.cantidad_simuladores);
  const minutos = num(fila.cantidad_minutos);
  if (sims > 0 && minutos > 0) {
    return { fuente: "stand", id, simuladorMinutos: sims * minutos, formula: "simuladores_x_minutos" };
  }

  const turnos = num(fila.cantidad_turnos);
  if (turnos > 0) {
    return { fuente: "stand", id, simuladorMinutos: turnos * MINUTOS_POR_BLOQUE, formula: "turnos_x_15" };
  }

  // Último recurso: personas × minutos. Si tampoco hay, la fila no aporta y queda contada como
  // excluida por falta de datos — visible en el detalle, nunca silenciosa.
  const personas = num(fila.cantidad_personas);
  if (personas > 0 && minutos > 0) {
    return { fuente: "stand", id, simuladorMinutos: personas * minutos, formula: "simuladores_x_minutos" };
  }

  return { fuente: "stand", id, simuladorMinutos: 0, formula: "excluida", excluidaPor: "sin_datos" };
}

/**
 * Simulador-minutos de una reserva web.
 *
 * Solo cuentan las reservas CONFIRMADAS y efectivamente usadas: una cancelada no se usó, y una
 * no-show se pagó pero nadie se subió al simulador — esperar una sesión de SIM Control por ella
 * generaría un Mismatch falso todos los días.
 */
export function simuladorMinutosReserva(fila: FilaReservaConciliable, corte?: CorteLocal): AporteCentral {
  const id = String(fila.id ?? "");
  const estado = String(fila.estado ?? "").toLowerCase();
  if (estado !== "activa") {
    return { fuente: "reserva", id, simuladorMinutos: 0, formula: "excluida", excluidaPor: "cancelada" };
  }

  if (fila.no_show === true) {
    return { fuente: "reserva", id, simuladorMinutos: 0, formula: "excluida", excluidaPor: "no_show" };
  }

  // Reservada para más tarde: está vendida, pero nadie se subió todavía.
  if (esPosteriorAlCorteCentral(fila, corte)) {
    return { fuente: "reserva", id, simuladorMinutos: 0, formula: "excluida", excluidaPor: "todavia_no_usada" };
  }

  const sims = simuladoresDe(fila.simuladores).length;
  const minutos = num(fila.duracion_minutos);
  if (sims > 0 && minutos > 0) {
    return { fuente: "reserva", id, simuladorMinutos: sims * minutos, formula: "simuladores_x_minutos" };
  }

  const turnos = num(fila.cantidad_turnos);
  if (turnos > 0) {
    return { fuente: "reserva", id, simuladorMinutos: turnos * MINUTOS_POR_BLOQUE, formula: "turnos_x_15" };
  }

  return { fuente: "reserva", id, simuladorMinutos: 0, formula: "excluida", excluidaPor: "sin_datos" };
}

/**
 * Actividad comercial esperada del día.
 *
 * Stand y Reservas son dominios SEPARADOS —el alta de una reserva nunca escribe en `turnos_stand`—
 * así que se suman sin riesgo de contar dos veces el mismo uso.
 */
export function totalesCentral(
  stand: readonly FilaStandConciliable[],
  reservas: readonly FilaReservaConciliable[],
  corte?: CorteLocal
): TotalesCentral {
  const aportes = [
    ...stand.map((f) => simuladorMinutosStand(f, corte)),
    ...reservas.map((f) => simuladorMinutosReserva(f, corte)),
  ];
  const cuentan = aportes.filter((a) => a.simuladorMinutos > 0);
  const simuladorMinutos = cuentan.reduce((acc, a) => acc + a.simuladorMinutos, 0);

  return {
    simuladorMinutos,
    bloques: simuladorMinutos / MINUTOS_POR_BLOQUE,
    operaciones: cuentan.length,
    operacionesStand: cuentan.filter((a) => a.fuente === "stand").length,
    operacionesReserva: cuentan.filter((a) => a.fuente === "reserva").length,
    excluidas: aportes.length - cuentan.length,
    noUsadasTodavia: aportes.filter((a) => a.excluidaPor === "todavia_no_usada").length,
    aportes,
  };
}

// ── SIM Control ─────────────────────────────────────────────────────────────────

/**
 * Actividad real registrada por las terminales.
 *
 * `counts_for_reconciliation` es AUTORITATIVO: lo decidió SIM Control con el contexto operativo
 * completo, y el receptor no vuelve a deducirlo. Eso ya resuelve solo tres casos:
 *  · mantenimiento no suma;
 *  · un turno reiniciado por incidente no suma (sí suma su reemplazo — el cliente pagó una vez);
 *  · los minutos son los AUTORIZADOS, o sea base + extensiones: 15 + 5 son 20, no 15 ni dos ventas.
 */
export function totalesSimControl(
  sesiones: readonly SesionConciliable[],
  corteUtc?: string
): TotalesSimControl {
  const delPeriodo = sesiones.filter((s) => !esPosteriorAlCorte(s, corteUtc));
  const conciliables = delPeriodo.filter((s) => s.counts_for_reconciliation);
  const simuladorMinutos = conciliables.reduce((acc, s) => acc + num(s.authorized_duration_minutes), 0);

  return {
    simuladorMinutos,
    bloques: simuladorMinutos / MINUTOS_POR_BLOQUE,
    sesionesConciliables: conciliables.length,
    sesionesNoConciliables: delPeriodo.length - conciliables.length,
    sesionesMantenimiento: delPeriodo.filter((s) => s.session_type === "Maintenance").length,
    sesionesReiniciadas: delPeriodo.filter((s) => s.status === "RestartedIncident").length,
    terminales: [...new Set(delPeriodo.map((s) => s.terminal_key))].sort(),
    sesionesPosterioresAlCorte: sesiones.length - delPeriodo.length,
  };
}

/**
 * ¿Esta sesión EMPEZÓ después del cierre que estamos verificando?
 *
 * Hace falta porque los paquetes siguen llegando: cuando entra P2 con los turnos de las 20:00, al
 * recalcular P1 (corte 19:00) esas sesiones no pueden aparecer. Si aparecieran, P1 mostraría más
 * actividad que la que el central respalda a las 19:00 — o sea `mismatch` — por turnos que ni
 * existían cuando P1 se cerró.
 *
 * Decide el INICIO, nunca el final. Un turno de 18:50 a 19:20 pertenece al cierre de las 19:00 con
 * sus 30 minutos completos: ya estaba en curso cuando se cerró. Mirar el final lo dejaría afuera de
 * P1 para siempre —porque terminó a las 19:20— y también afuera de P2 si P2 solo mira lo nuevo, así
 * que P1 quedaría Pending eternamente por 30 minutos que nadie le puede atribuir.
 *
 * Y NO se prorratea: los 30 minutos autorizados cuentan enteros en el período donde empezó. La
 * conciliación compara turnos comerciales completos, no fracciones de ejecución.
 */
function esPosteriorAlCorte(sesion: SesionConciliable, corteUtc: string | undefined): boolean {
  if (!corteUtc) return false;

  // Si faltara el inicio (no debería: el contrato lo exige), el fin es mejor que nada.
  const inicio = sesion.started_at_utc ?? sesion.finished_at_utc;
  if (!inicio) return false; // sin instante no se puede ubicar: no se descarta

  const t = Date.parse(inicio);
  const corte = Date.parse(corteUtc);
  if (Number.isNaN(t) || Number.isNaN(corte)) return false;

  return t > corte;
}

// ── Conciliación ────────────────────────────────────────────────────────────────

export type EntradaConciliacion = {
  businessDate: string;
  stand: readonly FilaStandConciliable[];
  reservas: readonly FilaReservaConciliable[];
  /** TODAS las sesiones ya ingeridas de esta fecha, de cualquier terminal. */
  sesiones: readonly SesionConciliable[];
  /**
   * Corte en hora local de SIM (`YYYY-MM-DDTHH:mm`), para las filas centrales, que guardan hora de
   * pared. Lo agendado para después NO cuenta como esperado.
   */
  corte?: CorteLocal;
  /**
   * EL MISMO corte, como instante UTC, para las sesiones de SIM Control, que guardan UTC.
   * Los dos salen del mismo timestamp persistido del cierre.
   */
  corteUtc?: string;
};

/**
 * Concilia una fecha comercial, comparando totales y nada más.
 *
 * No mira qué terminal mandó qué, ni si falta alguna por reportar: si las PCs que tuvieron actividad
 * ya sincronizaron exactamente lo que el central esperaba, la jornada cuadra — aunque otras dos
 * estuvieran apagadas todo el día.
 */
export function conciliar(entrada: EntradaConciliacion): ResultadoConciliacion {
  const central = totalesCentral(entrada.stand, entrada.reservas, entrada.corte);
  const simControl = totalesSimControl(entrada.sesiones, entrada.corteUtc);

  const diferencia = central.simuladorMinutos - simControl.simuladorMinutos;

  // Falta → todavía no hay nada que reclamar (seguro falta sincronizar otra PC).
  // Sobra  → hay actividad sin respaldo comercial, y esperar no lo arregla.
  const estado: EstadoConciliacion = diferencia > 0 ? "pending" : diferencia === 0 ? "verified" : "mismatch";

  return {
    businessDate: entrada.businessDate,
    estado,
    central,
    simControl,
    diferenciaSimuladorMinutos: diferencia,
    terminalesQueAportaron: simControl.terminales,
    resumen: describir(estado, central, simControl, diferencia),
  };
}

function describir(
  estado: EstadoConciliacion,
  central: TotalesCentral,
  simControl: TotalesSimControl,
  diferencia: number
): string {
  if (estado === "pending") {
    return `Faltan ${diferencia} simulador-minutos por sincronizar (central ${central.simuladorMinutos} · SIM Control ${simControl.simuladorMinutos}).`;
  }

  if (estado === "verified") {
    return `${central.simuladorMinutos} simulador-minutos en ${central.operaciones} operaciones · ${simControl.sesionesConciliables} turnos.`;
  }

  return `SIM Control registró ${Math.abs(diferencia)} simulador-minutos que el sistema central no respalda (central ${central.simuladorMinutos} · SIM Control ${simControl.simuladorMinutos}).`;
}

/**
 * Pasa un instante UTC a hora de pared de SIM (`YYYY-MM-DDTHH:mm`).
 *
 * Se arma con `Intl` sobre la zona del negocio, NUNCA con la del servidor: Vercel corre en UTC y
 * convertir ahí la hora de pared del Turnero correría el día entero.
 */
export function corteLocalDesdeUtc(instanteUtc: Date | string, zona = "America/Argentina/Cordoba"): CorteLocal {
  const fecha = typeof instanteUtc === "string" ? new Date(instanteUtc) : instanteUtc;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(fecha);

  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";
  return `${parte("year")}-${parte("month")}-${parte("day")}T${parte("hour")}:${parte("minute")}`;
}

/**
 * "Ahora" como corte local. SOLO para diagnóstico y tests.
 *
 * El camino productivo NO puede usar esto: verificar un cierre contra el reloj del momento haría
 * que el mismo paquete diera distinto según cuándo se reintente. Para eso está
 * {@link conciliarCierre}, que exige el corte persistido.
 */
export function corteAhora(ahora: Date = new Date(), zona = "America/Argentina/Cordoba"): CorteLocal {
  return corteLocalDesdeUtc(ahora, zona);
}

/**
 * Concilia UN CIERRE concreto contra su propio corte persistido.
 *
 * Es el único camino que usa producción, y por eso el corte es obligatorio: viene de
 * `periodEndUtc` del paquete —el instante en que el empleado cerró la jornada, sellado por SIM
 * Control y nunca modificado—, no del reloj del servidor ni del momento del reintento.
 *
 * Consecuencia buscada: reintentar P1 a las 21:30 da EXACTAMENTE lo mismo que a las 19:00. Los
 * turnos de las 20:00 pertenecen al próximo cierre, no a este.
 */
export function conciliarCierre(entrada: {
  businessDate: string;
  /** `periodEndUtc` del paquete: el instante real del cierre. */
  cierreUtc: string;
  stand: readonly FilaStandConciliable[];
  reservas: readonly FilaReservaConciliable[];
  sesiones: readonly SesionConciliable[];
  zona?: string;
}): ResultadoConciliacion {
  return conciliar({
    businessDate: entrada.businessDate,
    stand: entrada.stand,
    reservas: entrada.reservas,
    sesiones: entrada.sesiones,
    corte: corteLocalDesdeUtc(entrada.cierreUtc, entrada.zona),
    corteUtc: entrada.cierreUtc,
  });
}

/**
 * Estado que le corresponde a un paquete después de una corrida de conciliación.
 *
 * Un paquete que YA recibió un Verified real no vuelve atrás nunca: su comprobante es definitivo y
 * la actividad posterior del mismo día se verifica con los paquetes siguientes. Sin esta regla, un
 * cierre legítimo de las 19:00 se "despendería" a las 20:00 solo porque alguien volvió a operar.
 */
export function estadoDePaqueteTrasCorrida(
  estadoActualDelPaquete: string,
  estadoDeLaCorrida: EstadoConciliacion
): "verified" | "reconciliation_pending" | "mismatch" {
  if (estadoActualDelPaquete === "verified") {
    return "verified";
  }

  if (estadoDeLaCorrida === "verified") return "verified";
  if (estadoDeLaCorrida === "mismatch") return "mismatch";
  return "reconciliation_pending";
}

// ============================================================================
// Audiencia de una campaña de recuperación del stand (Marketing). PURO.
// ----------------------------------------------------------------------------
// Sin base, sin red y sin secretos: recibe filas de `turnos_stand` ya leídas, un
// reloj y la configuración, y devuelve quién sería destinatario, por qué quedó
// afuera cada fila y cada teléfono, y qué efecto tuvo cada filtro. Sirve para
// SIMULAR: no crea códigos ni envía.
//
// Reglas (ver .claude/agents/sim-marketing.md):
//   · "Hoy" es la fecha de negocio de Argentina (hoyEnSim), nunca la de UTC.
//   · Visita: turno no cancelado con fecha en [hoy − N, hoy − 1]. Hoy queda
//     afuera de la ventana, pero cuenta para saber si alguien ya volvió.
//   · Filtros COMERCIALES, configurables y nunca obligatorios:
//       soloPagos (por defecto sí)          deja afuera turnos gratis o sin cobro;
//       excluirRetornados (por defecto no)  deja afuera a quien vino 2+ días.
//     Apagados, esas personas participan como cualquier otra.
//   · Teléfono canónico = normalizarTelefonoDetallado (espejo exacto de
//     public.mensualidad_normalizar_telefono). Lo que no normaliza se excluye
//     con su motivo: nunca se adivina.
//   · Segmento geográfico: indicativo OFICIAL completo (lib/marketing/indicativo.ts),
//     comparado por igualdad, nunca por prefijo. Un número cuyo indicativo no se
//     puede determinar queda afuera del segmento con su motivo y sin área.
//   · Un destinatario por teléfono. Con más de un nombre no se personaliza.
//   · Sin consentimiento con evidencia no hay destinatario: dar el teléfono para
//     gestionar un turno no es aceptar promociones. La baja siempre gana.
// ============================================================================

import { hoyEnSim, sumarDias } from "@/lib/agenda";
import {
  normalizarTelefono,
  normalizarTelefonoDetallado,
  type TelefonoRechazo,
} from "@/lib/mensualidades";
import { esIndicativoOficial, indicativoDe } from "@/lib/marketing/indicativo";

export const VENTANAS_AUDIENCIA = [14, 21] as const;
export type VentanaAudiencia = (typeof VENTANAS_AUDIENCIA)[number];

/** Las columnas de `turnos_stand` que hacen falta. Ninguna otra. */
export type TurnoAudiencia = {
  id: number | string;
  nombre: string | null;
  telefono: string | null;
  fecha: string;
  estado: string | null;
  total: number | string | null;
  metodo_pago: string | null;
};

export type ConfigAudiencia = {
  ventanaDias: VentanaAudiencia;
  /** Solo turnos pagos. Por defecto sí; en false entran también gratis o sin cobro. */
  soloPagos?: boolean;
  /** Excluir a quien ya volvió: visitas en 2 o más días entre hoy − N y hoy. Por defecto no. */
  excluirRetornados?: boolean;
  /** Indicativos oficiales completos (ENACOM). Vacío o ausente = sin segmento. */
  indicativos?: readonly string[];
};

export type MotivoExterno = "titular_mensualidad" | "en_otra_campania";

export type ContextoAudiencia = {
  ahora: Date;
  /** Teléfonos con consentimiento promocional vigente y evidencia (origen, texto, fecha). */
  consentimientos: ReadonlySet<string>;
  /** Teléfonos con baja. Ganan sobre cualquier consentimiento. */
  bajas?: ReadonlySet<string>;
  /** Otras exclusiones por teléfono (p. ej. titulares de mensualidad). */
  otrasExclusiones?: ReadonlyMap<string, MotivoExterno>;
};

/** Por qué una fila de la ventana no aporta una visita. Uno solo por fila, en este orden. */
export const MOTIVOS_FILA = ["cancelado", "no_pago", "sin_telefono", "telefono_no_normalizable"] as const;
export type MotivoFila = (typeof MOTIVOS_FILA)[number];

/** Por qué un teléfono no es destinatario. Uno solo por teléfono, en este orden. */
export const MOTIVOS_TELEFONO = [
  "con_baja",
  "titular_mensualidad",
  "en_otra_campania",
  "indicativo_indeterminado",
  "fuera_de_segmento",
  "ya_volvio",
  "sin_consentimiento",
] as const;
export type MotivoTelefono = (typeof MOTIVOS_TELEFONO)[number];

export type Destinatario = {
  /** Número nacional canónico de 10 dígitos. */
  telefono: string;
  /** Destino para la Cloud API: 549 + canónico. */
  destinoWhatsapp: string;
  /** Indicativo oficial; null si no se pudo determinar. */
  indicativo: string | null;
  /** Área de numeración de ENACOM (no residencia); null si el indicativo no se determinó. */
  areaNumeracion: string | null;
  /** Nombre para personalizar; null si no hay o si el teléfono tiene varios. */
  nombre: string | null;
  variosNombres: boolean;
  ultimaVisita: string;
  /** id de `turnos_stand` de la visita más reciente. */
  turnoId: string;
  /** Turnos válidos dentro de la ventana. */
  visitas: number;
  /** Días distintos con un turno no cancelado entre hoy − N y hoy (hoy incluido). */
  diasConVisita: number;
};

/** Qué hizo cada filtro en esta corrida, y qué haría si se cambiara. */
export type EfectoFiltros = {
  ventana: { desde: string; hasta: string; filasEnVentana: number; filasFuera: number };
  soloPagos: { activo: boolean; filasExcluidas: number; filasAfectables: number };
  excluirRetornados: { activo: boolean; telefonosExcluidos: number; telefonosAfectables: number };
  segmento: {
    activo: boolean;
    indicativos: string[];
    telefonosFuera: number;
    telefonosIndeterminados: number;
  };
  bajas: { telefonosExcluidos: number };
  consentimiento: { telefonosSin: number };
};

export type ResultadoAudiencia = {
  hoy: string;
  desde: string;
  hasta: string;
  ventanaDias: VentanaAudiencia;
  /** La configuración efectivamente usada (con los valores por defecto resueltos). */
  config: { ventanaDias: VentanaAudiencia; soloPagos: boolean; excluirRetornados: boolean; indicativos: string[] };
  filtros: EfectoFiltros;
  filas: {
    leidas: number;
    fechaInvalida: number;
    futuras: number;
    fueraDeVentana: number;
    deHoy: number;
    enVentana: number;
    validas: number;
    excluidas: Record<MotivoFila, number>;
    /** Detalle de `telefono_no_normalizable` según el normalizador. */
    rechazosTelefono: Partial<Record<TelefonoRechazo, number>>;
  };
  telefonos: {
    /** Teléfonos canónicos con al menos una visita válida en la ventana. */
    unicos: number;
    elegibles: number;
    excluidos: Record<MotivoTelefono, number>;
    /** Teléfonos sin indicativo determinable (con o sin segmento activo). */
    sinIndicativo: number;
  };
  elegibles: Destinatario[];
  /** Pasan todo salvo el consentimiento: la audiencia si se registrara. No se les escribe. */
  pendientesConsentimiento: Destinatario[];
  excluidos: { motivo: MotivoTelefono; destinatario: Destinatario }[];
  advertencias: string[];
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const CANONICO_RE = /^[0-9]{10}$/;

function fechaValida(fecha: unknown): fecha is string {
  if (typeof fecha !== "string" || !FECHA_RE.test(fecha)) return false;
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Ventana de visitas para `ahora`, por fecha de negocio de Argentina. */
export function ventanaAudiencia(ahora: Date, ventanaDias: VentanaAudiencia) {
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) {
    throw new Error("Reloj inválido para calcular la audiencia.");
  }
  const hoy = hoyEnSim(ahora);
  return { hoy, desde: sumarDias(hoy, -ventanaDias), hasta: sumarDias(hoy, -1) };
}

export function destinoWhatsapp(canonico: string): string {
  if (!CANONICO_RE.test(canonico)) throw new Error("Teléfono no canónico.");
  return `549${canonico}`;
}

/** `351*****01`: nunca más de 5 dígitos a la vista. */
export function enmascararTelefono(canonico: string): string {
  return CANONICO_RE.test(canonico) ? `${canonico.slice(0, 3)}*****${canonico.slice(-2)}` : "**********";
}

/** `+54 9 351 ***** 01`. */
export function enmascararDestino(canonico: string): string {
  return CANONICO_RE.test(canonico) ? `+54 9 ${canonico.slice(0, 3)} ***** ${canonico.slice(-2)}` : "+54 9 ***";
}

/**
 * Valida una lista de indicativos para segmentar: tienen que ser oficiales
 * (lib/indicativosArgentina.ts, 300 de ENACOM) y completos. "35" o "354" no lo
 * son: no hay prefijos de conveniencia.
 */
export function validarIndicativos(codigos: readonly string[]): { indicativos: string[]; errores: string[] } {
  const errores: string[] = [];
  const validos = new Set<string>();
  for (const crudo of codigos) {
    const c = String(crudo ?? "").trim();
    if (!/^[0-9]{2,4}$/.test(c)) errores.push(`"${c}" no es un indicativo (2 a 4 dígitos).`);
    else if (!esIndicativoOficial(c)) errores.push(`"${c}" no es un indicativo oficial de ENACOM: el segmento compara indicativos completos, no prefijos.`);
    else validos.add(c);
  }
  return { indicativos: [...validos].sort(), errores };
}

/** Errores de configuración. Vacío = válida. */
export function validarConfigAudiencia(config: ConfigAudiencia): string[] {
  const errores: string[] = [];
  if (!(VENTANAS_AUDIENCIA as readonly number[]).includes(config.ventanaDias)) {
    errores.push(`La ventana tiene que ser de ${VENTANAS_AUDIENCIA.join(" o ")} días.`);
  }
  if (config.indicativos) errores.push(...validarIndicativos(config.indicativos).errores);
  return errores;
}

function esPago(f: TurnoAudiencia): boolean {
  const total = Number(f.total);
  const metodo = String(f.metodo_pago ?? "").trim().toLowerCase();
  // Mismo criterio que la venta verificada de Interacciones: total positivo y no
  // "gratis". Un dato contradictorio no se interpreta como pago.
  return Number.isFinite(total) && total > 0 && metodo !== "gratis";
}

function esCancelado(f: TurnoAudiencia): boolean {
  return String(f.estado ?? "").trim().toLowerCase() === "cancelado";
}

function nombreVisible(nombre: string | null): string | null {
  const n = String(nombre ?? "").replace(/\s+/g, " ").trim();
  return n || null;
}

/** Clave para comparar nombres: sin tildes, mayúsculas ni espacios de más. */
function claveNombre(nombre: string): string {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

type Visita = { id: string; fecha: string; nombre: string | null };

/** Compara ids numéricos de `turnos_stand` sin perder precisión. */
function idMayor(a: string, b: string): boolean {
  return a.length !== b.length ? a.length > b.length : a > b;
}

/** La visita más reciente: por fecha y, en el mismo día, por id. */
function masReciente(a: Visita, b: Visita): boolean {
  return a.fecha !== b.fecha ? a.fecha > b.fecha : idMayor(a.id, b.id);
}

/** Normaliza las claves de un conjunto de teléfonos; devuelve las que no se pudieron leer. */
function normalizarClaves(telefonos: Iterable<string>): { canonicos: Set<string>; ilegibles: number } {
  const canonicos = new Set<string>();
  let ilegibles = 0;
  for (const t of telefonos) {
    const c = normalizarTelefono(t);
    if (c) canonicos.add(c);
    else ilegibles++;
  }
  return { canonicos, ilegibles };
}

type Grupo = { telefono: string; visitas: Visita[]; escritos: Set<string> };

export function calcularAudiencia(
  filas: readonly TurnoAudiencia[],
  config: ConfigAudiencia,
  contexto: ContextoAudiencia,
): ResultadoAudiencia {
  const errores = validarConfigAudiencia(config);
  if (errores.length > 0) throw new Error(`Configuración de audiencia inválida: ${errores.join(" ")}`);

  const soloPagos = config.soloPagos ?? true;
  const excluirRetornados = config.excluirRetornados ?? false;
  const segmento = validarIndicativos(config.indicativos ?? []).indicativos;
  const { hoy, desde, hasta } = ventanaAudiencia(contexto.ahora, config.ventanaDias);
  const advertencias: string[] = [];

  const excluidasFila = Object.fromEntries(MOTIVOS_FILA.map((m) => [m, 0])) as Record<MotivoFila, number>;
  const rechazosTelefono: Partial<Record<TelefonoRechazo, number>> = {};
  const conteo = { leidas: 0, fechaInvalida: 0, futuras: 0, fueraDeVentana: 0, deHoy: 0, enVentana: 0, validas: 0 };
  let filasNoPago = 0;
  const diasPorTelefono = new Map<string, Set<string>>();
  const grupos = new Map<string, Grupo>();

  for (const f of filas) {
    conteo.leidas++;
    if (!fechaValida(f.fecha)) { conteo.fechaInvalida++; continue; }
    if (f.fecha > hoy) { conteo.futuras++; continue; }
    if (f.fecha < desde) { conteo.fueraDeVentana++; continue; }

    const cancelado = esCancelado(f);
    const tel = normalizarTelefonoDetallado(f.telefono);
    // Cualquier turno no cancelado con teléfono legible cuenta como día de visita
    // (también uno gratis o el de hoy): sirve para saber si la persona ya volvió.
    if (!cancelado && tel.ok) {
      const dias = diasPorTelefono.get(tel.valor) ?? new Set<string>();
      dias.add(f.fecha);
      diasPorTelefono.set(tel.valor, dias);
    }

    if (f.fecha === hoy) { conteo.deHoy++; continue; }
    conteo.enVentana++;

    if (cancelado) { excluidasFila.cancelado++; continue; }
    if (!esPago(f)) {
      filasNoPago++;
      if (soloPagos) { excluidasFila.no_pago++; continue; }
    }
    if (!tel.ok) {
      if (tel.motivo === "vacio") {
        excluidasFila.sin_telefono++;
      } else {
        excluidasFila.telefono_no_normalizable++;
        rechazosTelefono[tel.motivo] = (rechazosTelefono[tel.motivo] ?? 0) + 1;
      }
      continue;
    }

    conteo.validas++;
    const grupo = grupos.get(tel.valor) ?? { telefono: tel.valor, visitas: [], escritos: new Set<string>() };
    grupo.visitas.push({ id: String(f.id), fecha: f.fecha, nombre: nombreVisible(f.nombre) });
    if (f.telefono) grupo.escritos.add(f.telefono);
    grupos.set(tel.valor, grupo);
  }

  const bajas = normalizarClaves(contexto.bajas ?? []);
  if (bajas.ilegibles > 0) {
    advertencias.push(`${bajas.ilegibles} baja(s) con un teléfono que no se puede normalizar: revisalas, no se pueden aplicar.`);
  }
  const consentimientos = normalizarClaves(contexto.consentimientos);
  if (consentimientos.canonicos.size === 0) {
    advertencias.push("No hay consentimientos registrados: ningún teléfono es elegible.");
  }
  const otras = new Map<string, MotivoExterno>();
  for (const [t, motivo] of contexto.otrasExclusiones ?? []) {
    const c = normalizarTelefono(t);
    if (c) otras.set(c, motivo);
  }

  const excluidosTel = Object.fromEntries(MOTIVOS_TELEFONO.map((m) => [m, 0])) as Record<MotivoTelefono, number>;
  const elegibles: Destinatario[] = [];
  const pendientes: Destinatario[] = [];
  const excluidos: { motivo: MotivoTelefono; destinatario: Destinatario }[] = [];
  let sinIndicativo = 0;
  let retornados = 0;

  for (const grupo of grupos.values()) {
    let ultima = grupo.visitas[0];
    let ultimaConNombre: Visita | null = null;
    for (const v of grupo.visitas) {
      if (masReciente(v, ultima)) ultima = v;
      if (v.nombre && (!ultimaConNombre || masReciente(v, ultimaConNombre))) ultimaConNombre = v;
    }
    const nombres = new Set(grupo.visitas.flatMap((v) => (v.nombre ? [claveNombre(v.nombre)] : [])));
    const ind = indicativoDe(grupo.telefono, [...grupo.escritos]);
    if (!ind.ok) sinIndicativo++;
    const destinatario: Destinatario = {
      telefono: grupo.telefono,
      destinoWhatsapp: destinoWhatsapp(grupo.telefono),
      indicativo: ind.ok ? ind.indicativo : null,
      areaNumeracion: ind.ok ? ind.area : null,
      nombre: nombres.size === 1 ? ultimaConNombre?.nombre ?? null : null,
      variosNombres: nombres.size > 1,
      ultimaVisita: ultima.fecha,
      turnoId: ultima.id,
      visitas: grupo.visitas.length,
      diasConVisita: diasPorTelefono.get(grupo.telefono)?.size ?? 1,
    };
    if (destinatario.diasConVisita >= 2) retornados++;

    let motivo: MotivoTelefono | null = null;
    if (bajas.canonicos.has(grupo.telefono)) motivo = "con_baja";
    else if (otras.has(grupo.telefono)) motivo = otras.get(grupo.telefono)!;
    else if (segmento.length > 0 && !destinatario.indicativo) motivo = "indicativo_indeterminado";
    else if (segmento.length > 0 && !segmento.includes(destinatario.indicativo!)) motivo = "fuera_de_segmento";
    else if (excluirRetornados && destinatario.diasConVisita >= 2) motivo = "ya_volvio";
    else if (!consentimientos.canonicos.has(grupo.telefono)) motivo = "sin_consentimiento";

    if (motivo === null) {
      elegibles.push(destinatario);
    } else {
      excluidosTel[motivo]++;
      excluidos.push({ motivo, destinatario });
      if (motivo === "sin_consentimiento") pendientes.push(destinatario);
    }
  }

  if (sinIndicativo > 0) {
    advertencias.push(
      `${sinIndicativo} teléfono(s) sin indicativo determinable (fuera de la lista oficial, con dos lecturas posibles y ningún bloque asignado que decida, o contradicho por cómo se escribió): no se les atribuye área${segmento.length > 0 ? " y quedan fuera del segmento" : ""}.`,
    );
  }

  // Orden estable, independiente del orden de las filas: visita más reciente primero.
  const orden = (a: Destinatario, b: Destinatario) =>
    a.ultimaVisita !== b.ultimaVisita ? (a.ultimaVisita < b.ultimaVisita ? 1 : -1) : a.telefono < b.telefono ? -1 : 1;
  elegibles.sort(orden);
  pendientes.sort(orden);
  excluidos.sort((a, b) => orden(a.destinatario, b.destinatario));

  return {
    hoy,
    desde,
    hasta,
    ventanaDias: config.ventanaDias,
    config: { ventanaDias: config.ventanaDias, soloPagos, excluirRetornados, indicativos: segmento },
    filtros: {
      ventana: { desde, hasta, filasEnVentana: conteo.enVentana, filasFuera: conteo.fueraDeVentana + conteo.deHoy + conteo.futuras },
      soloPagos: { activo: soloPagos, filasExcluidas: excluidasFila.no_pago, filasAfectables: filasNoPago },
      excluirRetornados: { activo: excluirRetornados, telefonosExcluidos: excluidosTel.ya_volvio, telefonosAfectables: retornados },
      segmento: {
        activo: segmento.length > 0,
        indicativos: segmento,
        telefonosFuera: excluidosTel.fuera_de_segmento,
        telefonosIndeterminados: excluidosTel.indicativo_indeterminado,
      },
      bajas: { telefonosExcluidos: excluidosTel.con_baja },
      consentimiento: { telefonosSin: excluidosTel.sin_consentimiento },
    },
    filas: { ...conteo, excluidas: excluidasFila, rechazosTelefono },
    telefonos: { unicos: grupos.size, elegibles: elegibles.length, excluidos: excluidosTel, sinIndicativo },
    elegibles,
    pendientesConsentimiento: pendientes,
    excluidos,
    advertencias,
  };
}

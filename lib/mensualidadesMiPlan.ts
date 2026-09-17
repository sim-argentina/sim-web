import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { minutosATexto, type EstadoMensualidad } from "@/lib/mensualidades";

// Datos de "Mi mensualidad" (Bloque M4). Lo usan el endpoint y la página, así que
// el recorte de qué se expone vive en un solo lugar.
//
// Devuelve SOLO lo que el titular necesita ver. Nunca email, teléfono, ids
// internos, auditoría, referencias de Mercado Pago, importes internos, motivos de
// bloqueo ni movimientos. Y siempre de UNA mensualidad (la de la sesión): no se
// mezclan otras vencidas del mismo teléfono.

export type MotivoReserva = "ok" | "sin_saldo" | "vencida" | "bloqueada";

export type MiPlan = {
  estado: EstadoMensualidad;
  nombre: string;
  codigo: string;
  saldo_minutos: number;
  saldo_texto: string;
  vence_el: string;
  dias_restantes: number;
  bloqueada: boolean;
  ultimo_plan: string | null;
  ultima_compra_at: string | null;
  puede_reservar: boolean;
  motivo: MotivoReserva;
};

type FilaVista = {
  codigo: string;
  titular_nombre: string;
  saldo_minutos: number;
  vence_el: string;
  bloqueada: boolean;
  estado: string;
  dias_restantes: number;
};

// El estado NUNCA se persiste: sale de la vista mensualidades_estado, que lo
// calcula con mensualidad_estado(saldo, vence_el, bloqueada, hoy).
export async function getMiPlan(mensualidadId: string): Promise<MiPlan | null> {
  const { data } = await supabaseAdmin
    .from("mensualidades_estado")
    .select("codigo, titular_nombre, saldo_minutos, vence_el, bloqueada, estado, dias_restantes")
    .eq("id", mensualidadId)
    .maybeSingle();
  if (!data) return null;
  const m = data as unknown as FilaVista;

  // Última compra APROBADA de esta mensualidad (solo nombre del plan y fecha).
  const { data: compra } = await supabaseAdmin
    .from("mensualidad_compras")
    .select("plan_nombre, aprobado_at")
    .eq("mensualidad_id", mensualidadId)
    .eq("procesamiento", "aplicado")
    .order("aprobado_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const estado = m.estado as EstadoMensualidad;
  // Motivo público tipado: nada de detalles administrativos.
  const motivo: MotivoReserva =
    estado === "bloqueada" ? "bloqueada"
    : estado === "vencida" ? "vencida"
    : estado === "agotada" ? "sin_saldo"
    : "ok";

  return {
    estado,
    // Solo el nombre: el apellido no hace falta para saludar.
    nombre: String(m.titular_nombre ?? "").split(/\s+/)[0] ?? "",
    codigo: m.codigo,
    saldo_minutos: Number(m.saldo_minutos) || 0,
    saldo_texto: minutosATexto(Number(m.saldo_minutos) || 0),
    vence_el: String(m.vence_el),
    dias_restantes: Number(m.dias_restantes) || 0,
    bloqueada: Boolean(m.bloqueada),
    ultimo_plan: compra?.plan_nombre ?? null,
    ultima_compra_at: compra?.aprobado_at ?? null,
    // La reserva llega en M5; acá solo se informa si va a poder hacerla.
    puede_reservar: motivo === "ok",
    motivo,
  };
}

// ── Historial de reservas de la mensualidad (Bloque M5A) ───────────────────
// Solo lo mínimo para que el titular reconozca su turno. Sin ids internos, sin
// PII, sin nada de pagos y SIEMPRE de la mensualidad de la sesión.

export type ReservaDeMiPlan = {
  referencia: string;
  fecha: string;
  hora: string;
  duracion: number;
  simuladores: string[];
  minutos_consumidos: number;
  estado: string;
  /**
   * (M5C) Qué puede hacer el titular con ESTA reserva. Lo decide el servidor
   * con la hora de Córdoba; el navegador solo lo muestra. La RPC vuelve a
   * comprobarlo, así que esto es para la interfaz, no una autorización.
   */
  puede_cancelar: boolean;
  puede_reprogramar: boolean;
  /** (M5C) Si cancela AHORA, ¿le vuelven los minutos? Falta 24 h o más. */
  restituye_minutos: boolean;
  /** (M5C) Cuántos minutos volverían: los consumidos, o 0 si ya no restituye. */
  minutos_a_restituir: number;
  /** (M5C) Cómo terminó una cancelación: restituida | sin_restitucion | null. */
  cancelacion_resultado: string | null;
};

export type HistorialReservas = {
  proximas: ReservaDeMiPlan[];
  anteriores: ReservaDeMiPlan[];
  /** Hay más anteriores de las que se devolvieron (no se pagina hacia atrás en M5A). */
  hay_mas_anteriores: boolean;
};

/** Tope por tramo: suficiente para el uso real y sin traer la tabla entera. */
export const LIMITE_HISTORIAL = 20;

type FilaReserva = {
  referencia_publica: string | null;
  fecha: string;
  hora: string;
  duracion_minutos: number;
  simuladores: unknown;
  minutos_consumidos: number | null;
  estado: string;
  no_show: boolean | null;
  cancelacion_resultado: string | null;
};

/**
 * (M5C) Milisegundos que faltan para que empiece la reserva, en hora de
 * Córdoba. `fecha` es 'YYYY-MM-DD' y `hora` 'HH:MM'; Argentina es UTC-3 todo el
 * año (sin horario de verano), así que el instante se arma con el offset fijo
 * -03:00 y no depende de la zona del servidor. Es el mismo criterio que usa
 * lib/bloqueosEstado.ts desde antes de Mensualidades.
 */
export function faltanMsPara(fecha: string, hora: string, ahora: number = Date.now()): number {
  const t = Date.parse(`${fecha}T${hora}:00-03:00`);
  return Number.isFinite(t) ? t - ahora : Number.NaN;
}

/** (M5C) El corte de las 24 h es INCLUSIVO: con exactamente 24 h todavía se restituye. */
export const MS_24H = 24 * 60 * 60 * 1000;

function aDto(r: FilaReserva, ahora: number): ReservaDeMiPlan {
  const minutos = Number(r.minutos_consumidos) || 0;
  const faltan = faltanMsPara(r.fecha, r.hora, ahora);
  // Solo una reserva viva, futura y que no sea no-show admite acciones. Es la
  // misma lista de condiciones que aplica la RPC.
  const viva = r.estado === "activa" && !r.no_show && Number.isFinite(faltan) && faltan > 0;
  const conPlazo = viva && faltan >= MS_24H;
  return {
    referencia: String(r.referencia_publica ?? ""),
    fecha: r.fecha,
    hora: r.hora,
    duracion: Number(r.duracion_minutos) || 0,
    simuladores: Array.isArray(r.simuladores) ? r.simuladores.map(String) : [],
    minutos_consumidos: minutos,
    estado: String(r.estado),
    // Cancelar se puede hasta que empieza; reprogramar solo con 24 h o más.
    puede_cancelar: viva,
    puede_reprogramar: conPlazo,
    restituye_minutos: conPlazo,
    minutos_a_restituir: conPlazo ? minutos : 0,
    cancelacion_resultado: r.cancelacion_resultado ?? null,
  };
}

/**
 * Próximas y anteriores. El corte es la fecha de HOY en Córdoba, no la del
 * servidor: un turno de hoy sigue siendo "próximo" todo el día.
 */
export async function getReservasDeMiPlan(
  mensualidadId: string,
  limite: number = LIMITE_HISTORIAL,
): Promise<HistorialReservas> {
  const { data: hoy } = await supabaseAdmin.rpc("mensualidad_hoy");
  const corte = String(hoy ?? "");

  const columnas = "referencia_publica, fecha, hora, duracion_minutos, simuladores, " +
    "minutos_consumidos, estado, no_show, cancelacion_resultado";
  // Un solo "ahora" para todo el listado: si no, dos reservas del mismo lote
  // podrían quedar de distinto lado del corte de 24 h por unos milisegundos.
  const ahora = Date.now();

  // Dos consultas acotadas y ordenadas, en vez de traer todo y partirlo en
  // memoria: así el límite de PostgREST no puede recortar en silencio.
  const [prox, ant] = await Promise.all([
    supabaseAdmin
      .from("reservas")
      .select(columnas)
      .eq("mensualidad_id", mensualidadId)
      .gte("fecha", corte)
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true })
      .limit(limite),
    supabaseAdmin
      .from("reservas")
      .select(columnas)
      .eq("mensualidad_id", mensualidadId)
      .lt("fecha", corte)
      .order("fecha", { ascending: false })
      .order("hora", { ascending: false })
      .limit(limite + 1),
  ]);

  const anteriores = (ant.data ?? []) as unknown as FilaReserva[];
  return {
    proximas: ((prox.data ?? []) as unknown as FilaReserva[]).map((r) => aDto(r, ahora)),
    anteriores: anteriores.slice(0, limite).map((r) => aDto(r, ahora)),
    hay_mas_anteriores: anteriores.length > limite,
  };
}

// Busca la mensualidad por código + teléfono normalizado. Devuelve solo el id:
// quien llama decide qué hacer. No distingue "código inexistente" de "teléfono
// que no coincide": las dos cosas devuelven null.
export async function buscarPorCodigoYTelefono(
  codigoNormalizado: string,
  telefonoNormalizado: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("mensualidades")
    .select("id")
    .eq("codigo", codigoNormalizado)
    .eq("telefono_norm", telefonoNormalizado)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

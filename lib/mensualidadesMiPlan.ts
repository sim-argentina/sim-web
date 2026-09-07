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
  /**
   * (M5B) Minutos que YA salieron del saldo y están tomados por una reserva
   * mixta esperando el pago. `saldo_minutos` es siempre lo DISPONIBLE ahora
   * (la retención descuenta en el acto), así que sin este dato el titular vería
   * su saldo bajar sin explicación.
   */
  minutos_comprometidos: number;
  /** (M5B) Con una retención viva no se puede renovar ni empezar otra reserva. */
  tiene_pago_pendiente: boolean;
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

  // (M5B) Retención mixta viva: sus minutos ya se descontaron del saldo.
  const { data: pend } = await supabaseAdmin
    .from("mensualidad_reserva_pagos")
    .select("minutos_saldo")
    .eq("mensualidad_id", mensualidadId)
    .in("estado", ["pendiente", "rechazado"])
    .gt("retencion_vence_at", new Date().toISOString());
  const comprometidos = ((pend ?? []) as Array<{ minutos_saldo: number }>)
    .reduce((acc, p) => acc + (Number(p.minutos_saldo) || 0), 0);

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
    // Con una retención viva no se puede empezar otra reserva ni renovar: el
    // saldo está en 0 y los minutos ya están comprometidos.
    puede_reservar: motivo === "ok" && comprometidos === 0,
    motivo,
    minutos_comprometidos: comprometidos,
    tiene_pago_pendiente: comprometidos > 0,
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
  /** (M5B) "saldo" o "mixta". Una mixta pendiente todavía no está confirmada. */
  cobertura: string;
  /** (M5B) Dinero del complemento. 0 en las de M5A. */
  importe_complementario: number;
  /** (M5B) Solo en mixtas pendientes: hasta cuándo se puede pagar. */
  pagar_hasta?: string;
};

export type HistorialReservas = {
  proximas: ReservaDeMiPlan[];
  anteriores: ReservaDeMiPlan[];
  /** (M5B) Intentos mixtos que vencieron sin pagarse. Fuera del listado
   *  principal para no confundirlos con turnos confirmados, pero visibles: los
   *  minutos volvieron al saldo y el titular tiene que entender por qué. */
  vencidas: ReservaDeMiPlan[];
  /** Hay más anteriores de las que se devolvieron (no se pagina hacia atrás en M5A). */
  hay_mas_anteriores: boolean;
};

/** Tope por tramo: suficiente para el uso real y sin traer la tabla entera. */
export const LIMITE_HISTORIAL = 20;

type FilaReserva = {
  id: number;
  referencia_publica: string | null;
  fecha: string;
  hora: string;
  duracion_minutos: number;
  simuladores: unknown;
  minutos_consumidos: number | null;
  estado: string;
  cobertura: string | null;
  importe_complementario: number | string | null;
};

function aDto(r: FilaReserva, pagarHasta?: string): ReservaDeMiPlan {
  return {
    referencia: String(r.referencia_publica ?? ""),
    fecha: r.fecha,
    hora: r.hora,
    duracion: Number(r.duracion_minutos) || 0,
    simuladores: Array.isArray(r.simuladores) ? r.simuladores.map(String) : [],
    minutos_consumidos: Number(r.minutos_consumidos) || 0,
    estado: String(r.estado),
    cobertura: String(r.cobertura ?? "saldo"),
    importe_complementario: Number(r.importe_complementario) || 0,
    ...(pagarHasta ? { pagar_hasta: pagarHasta } : {}),
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

  const columnas = "id, referencia_publica, fecha, hora, duracion_minutos, simuladores, " +
    "minutos_consumidos, estado, cobertura, importe_complementario";

  // (M5B) 'activa' = confirmada · 'pendiente_pago' = mixta esperando el pago ·
  // 'cancelada' = intento vencido y liberado. Los tres se muestran, pero en
  // listas distintas: una reserva pendiente no puede parecer confirmada.
  const VIGENTES = ["activa", "pendiente_pago"];

  // Consultas acotadas y ordenadas, en vez de traer todo y partirlo en memoria:
  // así el límite de PostgREST no puede recortar en silencio.
  const [prox, ant, venc] = await Promise.all([
    supabaseAdmin
      .from("reservas")
      .select(columnas)
      .eq("mensualidad_id", mensualidadId)
      .in("estado", VIGENTES)
      .gte("fecha", corte)
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true })
      .limit(limite),
    supabaseAdmin
      .from("reservas")
      .select(columnas)
      .eq("mensualidad_id", mensualidadId)
      .in("estado", VIGENTES)
      .lt("fecha", corte)
      .order("fecha", { ascending: false })
      .order("hora", { ascending: false })
      .limit(limite + 1),
    supabaseAdmin
      .from("reservas")
      .select(columnas)
      .eq("mensualidad_id", mensualidadId)
      .eq("estado", "cancelada")
      .order("fecha", { ascending: false })
      .order("hora", { ascending: false })
      .limit(5),
  ]);

  const proximas = (prox.data ?? []) as unknown as FilaReserva[];

  // Para las mixtas todavía pendientes hace falta saber hasta cuándo se puede
  // pagar. Una sola consulta por lote: nada de N+1.
  const pendientes = proximas.filter((r) => r.estado === "pendiente_pago").map((r) => r.id);
  const vence = new Map<number, string>();
  if (pendientes.length > 0) {
    const { data: pagos } = await supabaseAdmin
      .from("mensualidad_reserva_pagos")
      .select("reserva_id, retencion_vence_at")
      .in("reserva_id", pendientes);
    for (const p of (pagos ?? []) as Array<{ reserva_id: number; retencion_vence_at: string }>) {
      vence.set(Number(p.reserva_id), String(p.retencion_vence_at));
    }
  }

  const anteriores = (ant.data ?? []) as unknown as FilaReserva[];
  return {
    proximas: proximas.map((r) => aDto(r, vence.get(r.id))),
    anteriores: anteriores.slice(0, limite).map((r) => aDto(r)),
    vencidas: ((venc.data ?? []) as unknown as FilaReserva[]).map((r) => aDto(r)),
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

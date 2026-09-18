import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AdminRole } from "@/lib/adminSession";

// Lecturas del panel administrativo de Mensualidades (Bloque M7). SOLO SERVIDOR.
//
// Todo lo que sale de acá ya viene filtrado, paginado y ordenado por la base:
// el navegador nunca recibe la tabla entera para filtrarla localmente.
//
// Qué NO viaja al cliente, ni siquiera al administrador:
//   · hashes de sesión, tokens, ids de Mercado Pago, claves de idempotencia;
//   · ids internos de compras, movimientos o reservas (la reserva se identifica
//     por su referencia pública, que es justamente para eso).
//
// El ÚNICO id que viaja es el de la billetera, porque es la dirección de su
// propia pantalla de detalle.
//
// El código de acceso es un caso aparte: está guardado en claro y sirve para
// entrar a Mi Plan, así que se lo entrega SOLO a un administrador. Para staff
// viaja en null con `codigo_visible: false`, y la diferencia la decide el
// servidor, no un `hidden` en la interfaz.

export const ESTADOS_FILTRO = ["todas", "vigente", "agotada", "vencida", "bloqueada"] as const;
export type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

export const POR_PAGINA = 25;
/** Tope duro: el mismo que aplica la función de la base. */
export const POR_PAGINA_MAX = 100;

export function esEstadoFiltro(v: unknown): v is EstadoFiltro {
  return typeof v === "string" && (ESTADOS_FILTRO as readonly string[]).includes(v);
}

// ── Listado ─────────────────────────────────────────────────────────────────

export type FilaListado = {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
  saldo_minutos: number;
  vence_el: string;
  estado: string;
  plan_nombre: string | null;
  plan_comprado_at: string | null;
  proxima_fecha: string | null;
  proxima_hora: string | null;
  ultima_actividad: string | null;
};

export type Listado = {
  filas: FilaListado[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
};

type FilaCruda = {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
  codigo: string;
  saldo_minutos: number;
  vence_el: string;
  estado: string;
  plan_nombre: string | null;
  plan_comprado_at: string | null;
  proxima_fecha: string | null;
  proxima_hora: string | null;
  ultima_actividad: string | null;
  total: number;
};

/**
 * Busca, filtra, ordena y pagina EN LA BASE. La búsqueda es una sola caja: el
 * administrador escribe lo que tiene a mano y la función decide contra qué
 * campo comparar según la forma del texto (código, teléfono, referencia de
 * reserva) o, si no reconoce ninguna, contra nombre, apellido y correo.
 *
 * El código llega en la fila cruda porque la función de la base lo devuelve,
 * pero NO se mapea al DTO: en el listado no hace falta y no se expone.
 */
export async function listarMensualidades(args: {
  busqueda?: string | null;
  estado?: EstadoFiltro;
  pagina?: number;
  porPagina?: number;
}): Promise<Listado> {
  const porPagina = Math.min(Math.max(Number(args.porPagina) || POR_PAGINA, 1), POR_PAGINA_MAX);
  const pagina = Math.max(Number(args.pagina) || 1, 1);
  const busqueda = (args.busqueda ?? "").trim().slice(0, 120) || null;

  const { data, error } = await supabaseAdmin.rpc("mensualidad_admin_listar", {
    p_busqueda: busqueda,
    p_estado: args.estado ?? "todas",
    p_limite: porPagina,
    p_offset: (pagina - 1) * porPagina,
  });
  if (error) throw new Error(error.message);

  const crudas = (data ?? []) as FilaCruda[];
  const total = crudas.length ? Number(crudas[0].total) || 0 : 0;

  return {
    filas: crudas.map((f) => ({
      id: String(f.id),
      nombre: String(f.nombre),
      apellido: String(f.apellido),
      telefono: String(f.telefono),
      email: String(f.email),
      saldo_minutos: Number(f.saldo_minutos) || 0,
      vence_el: String(f.vence_el),
      estado: String(f.estado),
      plan_nombre: f.plan_nombre ?? null,
      plan_comprado_at: f.plan_comprado_at ?? null,
      proxima_fecha: f.proxima_fecha ?? null,
      proxima_hora: f.proxima_hora ?? null,
      ultima_actividad: f.ultima_actividad ?? null,
    })),
    total,
    pagina,
    por_pagina: porPagina,
    paginas: Math.max(Math.ceil(total / porPagina), 1),
  };
}

// ── Detalle ─────────────────────────────────────────────────────────────────

export type ReservaAdmin = {
  referencia: string;
  fecha: string;
  hora: string;
  duracion: number;
  simuladores: number;
  minutos_consumidos: number;
  estado: string;
  cancelacion_resultado: string | null;
  reprogramaciones: number | null;
  no_show: boolean;
};

export type MovimientoHistorial = {
  /** 'compra' | 'renovacion' | 'descarte' | 'consumo' | 'devolucion' | 'ajuste_admin'
   *  para lo que movió saldo, o la acción administrativa que no lo movió. */
  tipo: string;
  fecha: string;
  /** Minutos con signo. null para las acciones que no tocan el saldo. */
  minutos: number | null;
  saldo_posterior: number | null;
  motivo: string | null;
  actor: string;
  /** Solo en acciones administrativas: qué cambió, sin datos completos. */
  detalle: Record<string, unknown> | null;
};

export type DetalleMensualidad = {
  id: string;
  titular: {
    nombre: string;
    apellido: string;
    telefono: string;
    email: string;
    estado: string;
    bloqueo_motivo: string | null;
  };
  /** Solo para admin. Para staff viaja null. */
  codigo: string | null;
  codigo_visible: boolean;
  plan: {
    nombre: string | null;
    comprado_at: string | null;
    minutos_originales: number | null;
    vigencia_dias: number | null;
    minutos_trasladados: number | null;
  };
  saldo_minutos: number;
  vence_el: string;
  creada_at: string;
  historial: MovimientoHistorial[];
  reservas: {
    proximas: ReservaAdmin[];
    pasadas: ReservaAdmin[];
    canceladas: ReservaAdmin[];
  };
};

/** Tope por tramo: alcanza para atender y no baja la tabla entera. */
export const LIMITE_DETALLE = 50;

type AuditoriaCruda = {
  accion: string;
  actor: string;
  actor_rol: string;
  motivo: string | null;
  valor_anterior: unknown;
  valor_nuevo: unknown;
  created_at: string;
};

type FilaReserva = {
  referencia_publica: string | null;
  fecha: string;
  hora: string;
  duracion_minutos: number | null;
  simuladores: unknown;
  minutos_consumidos: number | null;
  estado: string;
  no_show: boolean | null;
  cancelacion_resultado: string | null;
  reprogramaciones: number | null;
};

function aReserva(r: FilaReserva): ReservaAdmin {
  return {
    referencia: String(r.referencia_publica ?? ""),
    fecha: String(r.fecha),
    hora: String(r.hora),
    duracion: Number(r.duracion_minutos) || 0,
    // La CANTIDAD, no los nombres: la unidad operativa es cuántos simuladores.
    simuladores: Array.isArray(r.simuladores) ? r.simuladores.length : 0,
    minutos_consumidos: Number(r.minutos_consumidos) || 0,
    estado: String(r.estado),
    cancelacion_resultado: r.cancelacion_resultado ?? null,
    reprogramaciones: r.reprogramaciones ?? null,
    no_show: Boolean(r.no_show),
  };
}

async function hoyCordoba(): Promise<string> {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}

/**
 * Detalle completo de una billetera. `rol` decide qué se entrega: el código de
 * acceso es lo único que cambia entre admin y staff.
 *
 * Devuelve null si no existe, sin distinguir de "no tenés permiso": el permiso
 * ya se resolvió antes de llegar acá.
 */
export async function getDetalleMensualidad(
  id: string,
  rol: AdminRole,
): Promise<DetalleMensualidad | null> {
  const { data: m } = await supabaseAdmin
    .from("mensualidades")
    .select("id, codigo, titular_nombre, titular_apellido, titular_telefono, telefono_norm, titular_email, saldo_minutos, vence_el, bloqueada, bloqueo_motivo, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!m) return null;

  const hoy = await hoyCordoba();
  const { data: estadoRpc } = await supabaseAdmin.rpc("mensualidad_estado", {
    p_saldo: m.saldo_minutos, p_vence: m.vence_el, p_bloqueada: m.bloqueada, p_hoy: hoy,
  });
  const estado = String(estadoRpc ?? "vigente");

  // Última compra APLICADA: es la que define el plan vigente y el carry-over.
  const { data: compra } = await supabaseAdmin
    .from("mensualidad_compras")
    .select("plan_nombre, plan_minutos, plan_vigencia_dias, minutos_trasladados, aprobado_at")
    .eq("mensualidad_id", id)
    .eq("procesamiento", "aplicado")
    .order("aprobado_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const [movimientos, auditoria, reservas] = await Promise.all([
    supabaseAdmin
      .from("mensualidad_movimientos")
      .select("tipo, minutos, saldo_posterior, motivo, actor, created_at")
      .eq("mensualidad_id", id)
      .order("created_at", { ascending: false })
      .limit(LIMITE_DETALLE),
    // El rastro administrativo (quién bloqueó, quién cambió un teléfono, quién
    // rotó un código) es gobierno, no atención: solo lo ve un administrador.
    rol === "admin"
      ? supabaseAdmin
          .from("mensualidad_auditoria")
          .select("accion, actor, actor_rol, motivo, valor_anterior, valor_nuevo, created_at")
          .eq("mensualidad_id", id)
          .order("created_at", { ascending: false })
          .limit(LIMITE_DETALLE)
      : Promise.resolve({ data: [] as AuditoriaCruda[] }),
    supabaseAdmin
      .from("reservas")
      .select("referencia_publica, fecha, hora, duracion_minutos, simuladores, minutos_consumidos, estado, no_show, cancelacion_resultado, reprogramaciones")
      .eq("mensualidad_id", id)
      .eq("origen", "mensualidad")
      .order("fecha", { ascending: false })
      .order("hora", { ascending: false })
      .limit(LIMITE_DETALLE * 2),
  ]);

  // Los dos orígenes se funden en UNA línea de tiempo: lo que movió saldo y lo
  // que no. Para quien atiende, "se le extendió el vencimiento" y "se le
  // devolvieron 45 minutos" son el mismo tipo de evento.
  //
  // Los movimientos de saldo los ve también staff —explican por qué el saldo es
  // el que es, que es justo lo que pregunta un cliente—; las acciones
  // administrativas llegan vacías cuando no es un administrador.
  const historial: MovimientoHistorial[] = [
    ...(movimientos.data ?? []).map((mv) => ({
      tipo: String(mv.tipo),
      fecha: String(mv.created_at),
      minutos: Number(mv.minutos),
      saldo_posterior: Number(mv.saldo_posterior),
      motivo: mv.motivo ?? null,
      actor: String(mv.actor ?? "sistema"),
      detalle: null,
    })),
    ...(auditoria.data ?? [])
      // El ajuste de saldo ya aparece como movimiento: no se duplica.
      .filter((a) => a.accion !== "ajustar_saldo")
      .map((a) => ({
        tipo: String(a.accion),
        fecha: String(a.created_at),
        minutos: null,
        saldo_posterior: null,
        motivo: a.motivo ?? null,
        actor: `${a.actor} (${a.actor_rol})`,
        detalle: {
          anterior: a.valor_anterior ?? null,
          nuevo: a.valor_nuevo ?? null,
        } as Record<string, unknown>,
      })),
  ].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  const todas = (reservas.data ?? []) as FilaReserva[];
  const proximas: ReservaAdmin[] = [];
  const pasadas: ReservaAdmin[] = [];
  const canceladas: ReservaAdmin[] = [];
  for (const r of todas) {
    const dto = aReserva(r);
    if (dto.estado === "cancelada") canceladas.push(dto);
    else if (dto.fecha >= hoy) proximas.push(dto);
    else pasadas.push(dto);
  }
  // Las próximas se leen de la más cercana a la más lejana.
  proximas.reverse();

  return {
    id: String(m.id),
    titular: {
      nombre: String(m.titular_nombre),
      apellido: String(m.titular_apellido),
      telefono: String(m.telefono_norm),
      email: String(m.titular_email),
      estado,
      bloqueo_motivo: m.bloqueo_motivo ?? null,
    },
    codigo: rol === "admin" ? String(m.codigo) : null,
    codigo_visible: rol === "admin",
    plan: {
      nombre: compra?.plan_nombre ?? null,
      comprado_at: compra?.aprobado_at ?? null,
      minutos_originales: compra?.plan_minutos ?? null,
      vigencia_dias: compra?.plan_vigencia_dias ?? null,
      minutos_trasladados: compra?.minutos_trasladados ?? null,
    },
    saldo_minutos: Number(m.saldo_minutos) || 0,
    vence_el: String(m.vence_el),
    creada_at: String(m.created_at),
    historial,
    reservas: { proximas, pasadas, canceladas },
  };
}

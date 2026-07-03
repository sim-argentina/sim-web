// Calendario financiero — helpers server-side (eventos futuros, recurrencias,
// deudas y salud financiera proyectada).
//
// Regla central: NADA de lo futuro toca la caja real. Un evento solo impacta
// fin_movimientos cuando se marca como pagado/cobrado y se convierte
// explícitamente en movimiento real (respetando mes cerrado y mes inicial).

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { FECHA_RE, getCategorias, getCuentas, mesValido, registrarFinLog, type CuentaTipo } from "@/lib/finanzas";
import { validarMovimiento } from "@/lib/finanzasValidation";

// ── Tipos ────────────────────────────────────────────────────────────────────

export const TIPOS_EVENTO = [
  "cobro_futuro",
  "pago_futuro",
  "deuda",
  "cuota_deuda",
  "gasto_fijo",
  "ingreso_recurrente",
  "vencimiento",
  "compromiso_estimado",
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export const ESTADOS_EVENTO = ["pendiente", "cobrado", "pagado", "vencido", "cancelado", "estimado"] as const;
export type EstadoEvento = (typeof ESTADOS_EVENTO)[number];

export const FRECUENCIAS = ["semanal", "mensual", "anual"] as const;
export type Frecuencia = (typeof FRECUENCIAS)[number];

// Tipos de evento que representan plata que ENTRA
export const TIPOS_COBRO: readonly string[] = ["cobro_futuro", "ingreso_recurrente"];
// Tipos que representan plata que SALE (obligaciones)
export const TIPOS_PAGO: readonly string[] = ["pago_futuro", "deuda", "cuota_deuda", "gasto_fijo", "vencimiento", "compromiso_estimado"];
// Tipos que cuentan como pasivo/deuda
export const TIPOS_PASIVO: readonly string[] = ["deuda", "cuota_deuda"];

export type FinEvento = {
  id: string;
  fecha: string;
  mes_contable: string;
  tipo: TipoEvento;
  estado: EstadoEvento;
  descripcion: string;
  categoria_id: string | null;
  monto: number;
  cuenta_estimada: CuentaTipo;
  probabilidad: number;
  proveedor_cliente: string | null;
  observaciones: string | null;
  es_recurrente: boolean;
  recurrencia_id: string | null;
  deuda_id: string | null;
  cuota_numero: number | null;
  movimiento_id: string | null;
  fecha_real: string | null;
  editado_manual: boolean;
  creado_por: string | null;
  created_at: string;
};

export type FinDeuda = {
  id: string;
  descripcion: string;
  proveedor: string | null;
  monto_total: number;
  cuotas_total: number;
  estado: "activa" | "pagada" | "vencida" | "cancelada";
  observaciones: string | null;
};

// ── Utilidades de fecha ──────────────────────────────────────────────────────

export function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

export function sumarMesesFecha(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, ultimoDia));
  return base.toISOString().slice(0, 10);
}

// ── Estado efectivo (vencido se calcula, no se persiste) ─────────────────────

export function esPendiente(e: Pick<FinEvento, "estado">): boolean {
  return e.estado === "pendiente" || e.estado === "estimado";
}

export function estaVencido(e: Pick<FinEvento, "estado" | "fecha">, hoy: string): boolean {
  return esPendiente(e) && e.fecha < hoy;
}

// Monto ponderado por probabilidad (para cobros estimados).
export function montoPonderado(e: Pick<FinEvento, "monto" | "probabilidad">): number {
  return (e.monto * (Number(e.probabilidad) || 0)) / 100;
}

// ── Fetch de eventos ─────────────────────────────────────────────────────────

export async function getEventosRango(desde: string, hasta: string): Promise<FinEvento[]> {
  const out: FinEvento[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("fin_eventos_futuros")
      .select("*")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as FinEvento[];
    out.push(...rows.map((r) => ({ ...r, monto: Number(r.monto) || 0, probabilidad: Number(r.probabilidad) || 0 })));
    if (rows.length < PAGE) break;
  }
  return out;
}

// ── Validación de evento (POST/PUT) ─────────────────────────────────────────

export type EventoValidado =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

export async function validarEvento(body: Record<string, unknown>): Promise<EventoValidado> {
  const fecha = String(body.fecha || "").trim();
  if (!FECHA_RE.test(fecha)) return { ok: false, error: "Fecha inválida (YYYY-MM-DD)" };
  const mes = fecha.slice(0, 7);
  if (!mesValido(mes)) return { ok: false, error: "Mes inválido" };

  const tipo = String(body.tipo || "").trim();
  if (!(TIPOS_EVENTO as readonly string[]).includes(tipo)) {
    return { ok: false, error: "Tipo de evento inválido" };
  }

  const estado = String(body.estado || "pendiente").trim();
  if (!(ESTADOS_EVENTO as readonly string[]).includes(estado)) {
    return { ok: false, error: "Estado inválido" };
  }

  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto <= 0 || monto > 1e12) {
    return { ok: false, error: "Monto inválido" };
  }

  const cuenta = String(body.cuenta_estimada || "mercado_pago").trim();
  if (!["efectivo", "mercado_pago"].includes(cuenta)) {
    return { ok: false, error: "Cuenta estimada inválida (efectivo o mercado_pago)" };
  }

  let probabilidad = 100;
  if (body.probabilidad !== undefined && body.probabilidad !== null && body.probabilidad !== "") {
    probabilidad = Math.round(Number(body.probabilidad));
    if (!Number.isFinite(probabilidad) || probabilidad < 0 || probabilidad > 100) {
      return { ok: false, error: "Probabilidad inválida (0 a 100)" };
    }
  }

  const categoriaId = body.categoria_id ? String(body.categoria_id) : null;
  if (categoriaId) {
    const { data, error } = await supabaseAdmin
      .from("fin_categorias")
      .select("id")
      .eq("id", categoriaId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: "Categoría inexistente" };
  }

  return {
    ok: true,
    row: {
      fecha,
      mes_contable: mes,
      tipo,
      estado,
      descripcion: String(body.descripcion || "").slice(0, 300),
      categoria_id: categoriaId,
      monto,
      cuenta_estimada: cuenta,
      probabilidad,
      proveedor_cliente: body.proveedor_cliente ? String(body.proveedor_cliente).slice(0, 150) : null,
      observaciones: body.observaciones ? String(body.observaciones).slice(0, 500) : null,
    },
  };
}

// ── Generación de ocurrencias de una recurrencia ─────────────────────────────

const MAX_OCURRENCIAS = 60;
const HORIZONTE_DEFAULT: Record<Frecuencia, number> = { semanal: 26, mensual: 12, anual: 3 };

export function generarFechasRecurrencia(params: {
  frecuencia: Frecuencia;
  fecha_inicio: string;
  fecha_fin?: string | null;
  cantidad_repeticiones?: number | null;
}): string[] {
  const { frecuencia, fecha_inicio, fecha_fin, cantidad_repeticiones } = params;
  const max = Math.min(cantidad_repeticiones || HORIZONTE_DEFAULT[frecuencia], MAX_OCURRENCIAS);
  const fechas: string[] = [];
  for (let i = 0; i < max; i++) {
    let f: string;
    if (frecuencia === "semanal") f = sumarDias(fecha_inicio, i * 7);
    else if (frecuencia === "mensual") f = sumarMesesFecha(fecha_inicio, i);
    else f = sumarMesesFecha(fecha_inicio, i * 12);
    if (fecha_fin && f > fecha_fin) break;
    fechas.push(f);
  }
  return fechas;
}

// ── Resumen de proyección por ventanas ───────────────────────────────────────

export type VentanaProyeccion = {
  dias: number;
  cobros: number;
  cobros_ponderados: number;
  pagos: number;
  neto: number;
  neto_ponderado: number;
  cantidad_eventos: number;
};

export function calcularVentanas(eventos: FinEvento[], hoy: string, ventanas: number[]): VentanaProyeccion[] {
  return ventanas.map((dias) => {
    const hasta = sumarDias(hoy, dias);
    let cobros = 0;
    let cobrosPond = 0;
    let pagos = 0;
    let n = 0;
    for (const e of eventos) {
      if (!esPendiente(e)) continue;
      if (e.fecha < hoy || e.fecha > hasta) continue;
      n++;
      if (TIPOS_COBRO.includes(e.tipo)) {
        cobros += e.monto;
        cobrosPond += montoPonderado(e);
      } else {
        pagos += e.monto;
      }
    }
    return {
      dias,
      cobros,
      cobros_ponderados: Math.round(cobrosPond),
      pagos,
      neto: cobros - pagos,
      neto_ponderado: Math.round(cobrosPond - pagos),
      cantidad_eventos: n,
    };
  });
}

// ── Marcar pagado/cobrado + conversión a movimiento real ─────────────────────
//
// Respeta el modelo validado: usa validarMovimiento (mes cerrado, mes inicial,
// cuentas activas, categorías) y nunca duplica sin confirmación.

export type ResultadoMarcar =
  | { ok: true; evento: FinEvento; movimiento: Record<string, unknown> | null }
  | { ok: false; status: number; error: string; requiere_confirmacion?: boolean };

export async function marcarEvento(params: {
  eventoId: string;
  accion: "pagado" | "cobrado";
  fechaReal?: string | null;
  crearMovimiento: boolean;
  confirmarDuplicado: boolean;
  rol: string;
}): Promise<ResultadoMarcar> {
  const { eventoId, accion, crearMovimiento, confirmarDuplicado, rol } = params;

  const { data: evento, error: errEv } = await supabaseAdmin
    .from("fin_eventos_futuros")
    .select("*")
    .eq("id", eventoId)
    .maybeSingle();
  if (errEv) throw errEv;
  if (!evento) return { ok: false, status: 404, error: "Evento no encontrado" };

  if (evento.estado === "cancelado") {
    return { ok: false, status: 400, error: "El evento está cancelado" };
  }
  if (evento.estado === "pagado" || evento.estado === "cobrado") {
    return { ok: false, status: 400, error: `El evento ya está ${evento.estado}` };
  }
  const esCobro = TIPOS_COBRO.includes(evento.tipo);
  if (accion === "cobrado" && !esCobro) {
    return { ok: false, status: 400, error: "Este evento es un pago/obligación: marcalo como pagado" };
  }
  if (accion === "pagado" && esCobro) {
    return { ok: false, status: 400, error: "Este evento es un cobro: marcalo como cobrado" };
  }

  const fechaReal = params.fechaReal && FECHA_RE.test(params.fechaReal) ? params.fechaReal : hoyISO();

  let movimiento: Record<string, unknown> | null = null;

  if (crearMovimiento) {
    if (evento.movimiento_id && !confirmarDuplicado) {
      return {
        ok: false,
        status: 409,
        error: "Este evento ya generó un movimiento real. Confirmá para crear otro.",
        requiere_confirmacion: true,
      };
    }

    const [cuentas, categorias] = await Promise.all([getCuentas(), getCategorias()]);
    const cuenta = cuentas.find((c) => c.tipo === evento.cuenta_estimada);
    if (!cuenta) return { ok: false, status: 400, error: "No hay cuenta activa para la fuente estimada" };

    // Clasificación del movimiento según la categoría del evento (respeta Mi sueldo).
    let clasificacion = esCobro ? "ingreso" : "gasto";
    if (!esCobro && evento.categoria_id) {
      const cat = categorias.find((c) => c.id === evento.categoria_id);
      if (cat && ["costo", "gasto", "inversion", "sueldo_personal"].includes(cat.tipo)) {
        clasificacion = cat.tipo;
      }
    }

    const val = await validarMovimiento({
      fecha: fechaReal,
      tipo: esCobro ? "ingreso" : "egreso",
      clasificacion,
      cuenta_origen_id: cuenta.id,
      categoria_id: evento.categoria_id,
      descripcion: evento.descripcion || (esCobro ? "Cobro del calendario" : "Pago del calendario"),
      monto: evento.monto,
      observaciones: evento.observaciones,
      referencia_externa: `evento:${evento.id}`,
    });
    if (!val.ok) return { ok: false, status: 400, error: val.error };

    const { data: mov, error: errMov } = await supabaseAdmin
      .from("fin_movimientos")
      .insert([{ ...val.row, creado_por: rol }])
      .select()
      .single();
    if (errMov) throw errMov;
    movimiento = mov;
  }

  const { data: actualizado, error: errUp } = await supabaseAdmin
    .from("fin_eventos_futuros")
    .update({
      estado: accion,
      fecha_real: fechaReal,
      movimiento_id: movimiento ? (movimiento.id as string) : evento.movimiento_id,
    })
    .eq("id", eventoId)
    .select()
    .single();
  if (errUp) throw errUp;

  // Si era cuota de deuda, actualizar estado de la deuda si quedó saldada.
  if (evento.deuda_id) {
    const { data: pendientes } = await supabaseAdmin
      .from("fin_eventos_futuros")
      .select("id")
      .eq("deuda_id", evento.deuda_id)
      .in("estado", ["pendiente", "estimado"])
      .limit(1);
    if ((pendientes || []).length === 0) {
      await supabaseAdmin.from("fin_deudas").update({ estado: "pagada" }).eq("id", evento.deuda_id).eq("estado", "activa");
    }
  }

  await registrarFinLog(
    `marcar_${accion}`,
    "fin_eventos_futuros",
    eventoId,
    { monto: evento.monto, fecha_real: fechaReal, movimiento: Boolean(movimiento) },
    rol
  );

  return { ok: true, evento: actualizado as FinEvento, movimiento };
}

// Días hasta déficit: simula día a día caja + cobros ponderados − pagos.
export function diasHastaDeficit(eventos: FinEvento[], cajaInicial: number, hoy: string, horizonteDias = 90): number | null {
  if (cajaInicial < 0) return 0;
  const porDia: Record<string, number> = {};
  for (const e of eventos) {
    if (!esPendiente(e)) continue;
    if (e.fecha < hoy) continue;
    const delta = TIPOS_COBRO.includes(e.tipo) ? montoPonderado(e) : -e.monto;
    porDia[e.fecha] = (porDia[e.fecha] || 0) + delta;
  }
  let caja = cajaInicial;
  for (let i = 0; i <= horizonteDias; i++) {
    const f = sumarDias(hoy, i);
    caja += porDia[f] || 0;
    if (caja < 0) return i;
  }
  return null; // no hay déficit proyectado en el horizonte
}

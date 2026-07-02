// Módulo Finanzas — helpers server-side.
//
// IMPORTANTE: este módulo es satélite. Sobre las tablas operativas existentes
// (turnos_stand, reservas, gift_cards, campeonato_inscripciones) solo se hacen
// LECTURAS (vía funciones SQL read-only fin_ingresos_por_mes / fin_serie_ingresos).
// turnos_historicos NO es fuente de Finanzas: el módulo arranca en mes_inicio
// (2026-07) y no reconstruye plata histórica. Toda la escritura ocurre
// exclusivamente en tablas fin_*.

import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type FinCuenta = {
  id: string;
  nombre: string;
  ambito: "sim" | "personal" | "compartida";
  tipo: "efectivo" | "mercado_pago" | "banco" | "otro";
  activa: boolean;
  orden: number;
};

export type FinCategoria = {
  id: string;
  nombre: string;
  ambito: "sim" | "personal" | "ambos";
  tipo: "ingreso" | "costo" | "gasto" | "inversion" | "retiro" | "ajuste";
  activa: boolean;
  orden: number;
  color: string | null;
  descripcion: string | null;
};

export type FinMovimiento = {
  id: string;
  fecha: string;
  mes_contable: string;
  ambito: "sim" | "personal";
  tipo: "ingreso" | "egreso" | "transferencia" | "ajuste";
  clasificacion: string;
  cuenta_origen_id: string | null;
  cuenta_destino_id: string | null;
  categoria_id: string | null;
  subcategoria: string | null;
  descripcion: string;
  monto: number;
  observaciones: string | null;
  origen: string;
  referencia_externa: string | null;
  creado_por: string | null;
  created_at: string;
};

export type FinConfiguracion = {
  cantidad_simuladores: number;
  horas_operativas_dia: number;
  duracion_turno_min: number;
  dias_operativos_mes: number;
  valor_activos: number;
  inversion_inicial: number;
  meta_facturacion: number;
  meta_margen_operativo: number;
  meta_ocupacion: number;
  mes_inicio: string;
};

// Mes cero operativo de Finanzas si la config no puede leerse.
export const MES_INICIO_DEFAULT = "2026-07";

export type IngresoAutomatico = {
  fuente: string;
  fuenteLabel: string;
  categoria: string;
  metodo: string;
  cuentaTipo: "efectivo" | "mercado_pago" | "banco" | null;
  total: number;
  cantidad: number;
};

export type SaldoCuenta = {
  cuenta: FinCuenta;
  saldoInicial: number;
  ingresos: number;
  egresos: number;
  transferenciasEntrantes: number;
  transferenciasSalientes: number;
  saldoTeorico: number;
};

// ── Constantes ───────────────────────────────────────────────────────────────

export const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TIPOS_MOVIMIENTO = ["ingreso", "egreso", "transferencia", "ajuste"] as const;
export const CLASIFICACIONES = ["ingreso", "costo", "gasto", "inversion", "retiro", "ajuste", "otro"] as const;
export const AMBITOS_MOVIMIENTO = ["sim", "personal"] as const;

export const FUENTES_LABEL: Record<string, string> = {
  turnero: "Turnero del stand",
  reservas_online: "Reservas online",
  gift_cards: "Gift cards",
  campeonatos: "Campeonatos",
};

// ── Utilidades de mes ────────────────────────────────────────────────────────

export function mesValido(mes: string): boolean {
  return MES_RE.test(mes);
}

export function mesActual(): string {
  const d = new Date();
  const ar = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).format(d); // "YYYY-MM"
  return ar.slice(0, 7);
}

export function mesAnterior(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function restarMeses(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Mapeo método de pago → tipo de cuenta ────────────────────────────────────

export function metodoACuentaTipo(
  metodo: string
): "efectivo" | "mercado_pago" | "banco" | null {
  const m = metodo.toLowerCase().trim();
  if (m === "efectivo" || m === "cash") return "efectivo";
  if (m === "transferencia") return "banco";
  if (["qr", "debito", "crédito", "credito", "tarjeta", "mp", "mercadopago", "mercado_pago", "mercado pago"].includes(m)) {
    return "mercado_pago";
  }
  return null; // desconocido / mixto sin detalle / gratis
}

// ── Datos base ───────────────────────────────────────────────────────────────

export async function getCuentas(): Promise<FinCuenta[]> {
  const { data, error } = await supabaseAdmin
    .from("fin_cuentas")
    .select("*")
    .order("orden", { ascending: true });
  if (error) throw error;
  return (data || []) as FinCuenta[];
}

export async function getCategorias(): Promise<FinCategoria[]> {
  const { data, error } = await supabaseAdmin
    .from("fin_categorias")
    .select("*")
    .order("tipo", { ascending: true })
    .order("orden", { ascending: true });
  if (error) throw error;
  return (data || []) as FinCategoria[];
}

export async function getConfiguracion(): Promise<FinConfiguracion> {
  const { data, error } = await supabaseAdmin
    .from("fin_configuracion")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return {
    cantidad_simuladores: Number(data?.cantidad_simuladores ?? 4),
    horas_operativas_dia: Number(data?.horas_operativas_dia ?? 12),
    duracion_turno_min: Number(data?.duracion_turno_min ?? 15),
    dias_operativos_mes: Number(data?.dias_operativos_mes ?? 30),
    valor_activos: Number(data?.valor_activos ?? 0),
    inversion_inicial: Number(data?.inversion_inicial ?? 0),
    meta_facturacion: Number(data?.meta_facturacion ?? 0),
    meta_margen_operativo: Number(data?.meta_margen_operativo ?? 0),
    meta_ocupacion: Number(data?.meta_ocupacion ?? 0),
    mes_inicio: MES_RE.test(String(data?.mes_inicio || "")) ? String(data?.mes_inicio) : MES_INICIO_DEFAULT,
  };
}

// Mes inicial del módulo: los meses anteriores no son operación válida de Finanzas.
export async function getMesInicio(): Promise<string> {
  const config = await getConfiguracion();
  return config.mes_inicio;
}

// ── Ingresos automáticos (read-only sobre tablas operativas) ────────────────

export async function getIngresosAutomaticos(mes: string): Promise<{
  items: IngresoAutomatico[];
  totalPorFuente: Record<string, number>;
  total: number;
  turnosDelMes: number;
}> {
  const [{ data, error }, clasif] = await Promise.all([
    supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mes }),
    supabaseAdmin
      .from("fin_clasificacion_ingresos")
      .select("fuente, activa, categoria:fin_categorias(nombre)")
      .eq("activa", true),
  ]);
  if (error) throw error;

  const catPorFuente: Record<string, string> = {};
  for (const r of clasif.data || []) {
    const cat = r.categoria as unknown as { nombre?: string } | null;
    if (r.fuente && cat?.nombre) catPorFuente[r.fuente] = cat.nombre;
  }

  const items: IngresoAutomatico[] = [];
  const totalPorFuente: Record<string, number> = {};
  let total = 0;
  let turnosDelMes = 0;
  const turnosPorFuente: Record<string, number> = {};

  for (const row of (data || []) as Array<{ fuente: string; metodo: string; total: unknown; cantidad: unknown }>) {
    const monto = Number(row.total) || 0;
    const fuente = row.fuente;
    const metodo = String(row.metodo || "desconocido");
    if (monto === 0 && !Number(row.cantidad)) continue;

    items.push({
      fuente,
      fuenteLabel: FUENTES_LABEL[fuente] || fuente,
      categoria: catPorFuente[fuente] || "Sin clasificar",
      metodo,
      cuentaTipo: metodoACuentaTipo(metodo),
      total: monto,
      cantidad: Number(row.cantidad) || 0,
    });
    totalPorFuente[fuente] = (totalPorFuente[fuente] || 0) + monto;
    total += monto;

    // cantidad de turnos: solo el turnero (el resto son ventas, no turnos)
    if (fuente === "turnero") {
      // la función devuelve el total de turnos del mes repetido por fila de método:
      // tomamos el máximo para no duplicar
      turnosPorFuente[fuente] = Math.max(turnosPorFuente[fuente] || 0, Number(row.cantidad) || 0);
    }
  }
  turnosDelMes = Object.values(turnosPorFuente).reduce((a, b) => a + b, 0);

  return { items, totalPorFuente, total, turnosDelMes };
}

export async function getSerieIngresos(desde: string, hasta: string): Promise<
  Array<{ mes: string; fuente: string; total: number; turnos: number }>
> {
  const { data, error } = await supabaseAdmin.rpc("fin_serie_ingresos", {
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) throw error;
  return ((data || []) as Array<{ mes: string; fuente: string; total: unknown; turnos: unknown }>).map((r) => ({
    mes: r.mes,
    fuente: r.fuente,
    total: Number(r.total) || 0,
    turnos: Number(r.turnos) || 0,
  }));
}

// ── Movimientos ──────────────────────────────────────────────────────────────

export async function getMovimientosMes(mes: string): Promise<FinMovimiento[]> {
  const out: FinMovimiento[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("fin_movimientos")
      .select("*")
      .eq("mes_contable", mes)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as FinMovimiento[];
    out.push(...rows.map((r) => ({ ...r, monto: Number(r.monto) || 0 })));
    if (rows.length < PAGE) break;
  }
  return out;
}

// ── Saldos por cuenta ────────────────────────────────────────────────────────

async function getSaldosInicialesMes(mes: string, cuentas: FinCuenta[]): Promise<Record<string, number>> {
  // Saldo inicial = saldo real del cierre del mes anterior (si existe y está cerrado).
  const prev = mesAnterior(mes);
  const iniciales: Record<string, number> = {};
  for (const c of cuentas) iniciales[c.id] = 0;

  const { data: cierrePrev, error } = await supabaseAdmin
    .from("fin_cierres_mensuales")
    .select("id, estado, cuentas:fin_cierres_cuentas(cuenta_id, saldo_real)")
    .eq("mes", prev)
    .maybeSingle();
  if (error) throw error;

  if (cierrePrev && cierrePrev.estado !== "abierto") {
    for (const cc of (cierrePrev.cuentas || []) as Array<{ cuenta_id: string; saldo_real: unknown }>) {
      iniciales[cc.cuenta_id] = Number(cc.saldo_real) || 0;
    }
  }
  return iniciales;
}

export async function calcularSaldosMes(mes: string): Promise<{
  saldos: SaldoCuenta[];
  ingresosAuto: Awaited<ReturnType<typeof getIngresosAutomaticos>>;
  movimientos: FinMovimiento[];
}> {
  const cuentas = await getCuentas();
  const [iniciales, movimientos, ingresosAuto] = await Promise.all([
    getSaldosInicialesMes(mes, cuentas),
    getMovimientosMes(mes),
    getIngresosAutomaticos(mes),
  ]);

  const porCuenta: Record<string, SaldoCuenta> = {};
  for (const c of cuentas) {
    porCuenta[c.id] = {
      cuenta: c,
      saldoInicial: iniciales[c.id] || 0,
      ingresos: 0,
      egresos: 0,
      transferenciasEntrantes: 0,
      transferenciasSalientes: 0,
      saldoTeorico: 0,
    };
  }

  // Movimientos manuales
  for (const m of movimientos) {
    if (m.tipo === "ingreso" && m.cuenta_origen_id && porCuenta[m.cuenta_origen_id]) {
      porCuenta[m.cuenta_origen_id].ingresos += m.monto;
    } else if (m.tipo === "egreso" && m.cuenta_origen_id && porCuenta[m.cuenta_origen_id]) {
      porCuenta[m.cuenta_origen_id].egresos += m.monto;
    } else if (m.tipo === "transferencia") {
      if (m.cuenta_origen_id && porCuenta[m.cuenta_origen_id]) {
        porCuenta[m.cuenta_origen_id].transferenciasSalientes += m.monto;
      }
      if (m.cuenta_destino_id && porCuenta[m.cuenta_destino_id]) {
        porCuenta[m.cuenta_destino_id].transferenciasEntrantes += m.monto;
      }
    } else if (m.tipo === "ajuste") {
      if (m.cuenta_destino_id && porCuenta[m.cuenta_destino_id]) {
        porCuenta[m.cuenta_destino_id].ingresos += m.monto;
      } else if (m.cuenta_origen_id && porCuenta[m.cuenta_origen_id]) {
        porCuenta[m.cuenta_origen_id].egresos += m.monto;
      }
    }
  }

  // Ingresos automáticos: se asignan a la cuenta SIM que corresponde al método.
  const cuentaSimPorTipo: Record<string, string> = {};
  for (const c of cuentas) {
    if (c.ambito === "sim" && c.activa) cuentaSimPorTipo[c.tipo] = c.id;
  }
  for (const item of ingresosAuto.items) {
    if (!item.cuentaTipo) continue;
    const cid = cuentaSimPorTipo[item.cuentaTipo];
    if (cid && porCuenta[cid]) porCuenta[cid].ingresos += item.total;
  }

  const saldos = cuentas.map((c) => {
    const s = porCuenta[c.id];
    s.saldoTeorico =
      s.saldoInicial + s.ingresos - s.egresos + s.transferenciasEntrantes - s.transferenciasSalientes;
    return s;
  });

  return { saldos, ingresosAuto, movimientos };
}

// ── Resumen mensual ──────────────────────────────────────────────────────────

export type ResumenMes = {
  mes: string;
  ingresosAutomaticos: number;
  ingresosManualesSim: number;
  ingresosSim: number;
  costos: number;
  gastos: number;
  inversiones: number;
  retiros: number;
  ajustesSim: number;
  resultadoOperativo: number;
  personal: {
    ingresos: number;
    gastos: number;
    porCategoria: Record<string, number>;
  };
  turnosDelMes: number;
};

export function resumirMovimientos(
  mes: string,
  movimientos: FinMovimiento[],
  ingresosAuto: { total: number; turnosDelMes: number },
  categorias: FinCategoria[]
): ResumenMes {
  const catById: Record<string, FinCategoria> = {};
  for (const c of categorias) catById[c.id] = c;

  let ingresosManualesSim = 0;
  let costos = 0;
  let gastos = 0;
  let inversiones = 0;
  let retiros = 0;
  let ajustesSim = 0;
  let ingresosPersonal = 0;
  let gastosPersonal = 0;
  const personalPorCategoria: Record<string, number> = {};

  for (const m of movimientos) {
    if (m.tipo === "transferencia") continue; // no afecta resultado, solo saldos
    if (m.origen === "ajuste_inicial") continue; // inicialización de saldos: solo caja, nunca resultado

    if (m.ambito === "sim") {
      if (m.tipo === "ingreso") ingresosManualesSim += m.monto;
      else if (m.tipo === "egreso") {
        if (m.clasificacion === "costo") costos += m.monto;
        else if (m.clasificacion === "gasto") gastos += m.monto;
        else if (m.clasificacion === "inversion") inversiones += m.monto;
        else if (m.clasificacion === "retiro") retiros += m.monto;
        else gastos += m.monto; // otro/ajuste como gasto operativo por defecto
      } else if (m.tipo === "ajuste") {
        ajustesSim += m.cuenta_destino_id ? m.monto : -m.monto;
      }
    } else {
      if (m.tipo === "ingreso") ingresosPersonal += m.monto;
      else if (m.tipo === "egreso" || m.tipo === "ajuste") {
        const monto = m.tipo === "ajuste" && m.cuenta_destino_id ? -m.monto : m.monto;
        gastosPersonal += monto;
        const cat = m.categoria_id ? catById[m.categoria_id]?.nombre : null;
        const key = cat || "Sin categoría";
        personalPorCategoria[key] = (personalPorCategoria[key] || 0) + monto;
      }
    }
  }

  const ingresosSim = ingresosAuto.total + ingresosManualesSim;

  return {
    mes,
    ingresosAutomaticos: ingresosAuto.total,
    ingresosManualesSim,
    ingresosSim,
    costos,
    gastos,
    inversiones,
    retiros,
    ajustesSim,
    resultadoOperativo: ingresosSim - costos - gastos,
    personal: {
      ingresos: ingresosPersonal,
      gastos: gastosPersonal,
      porCategoria: personalPorCategoria,
    },
    turnosDelMes: ingresosAuto.turnosDelMes,
  };
}

// ── Log básico de auditoría ──────────────────────────────────────────────────

export async function registrarFinLog(
  accion: string,
  entidad: string,
  entidadId: string | null,
  detalle: Record<string, unknown> = {},
  rol?: string
): Promise<void> {
  try {
    await supabaseAdmin.from("fin_logs").insert([
      { accion, entidad, entidad_id: entidadId, detalle, rol: rol || null },
    ]);
  } catch {
    // el log nunca debe romper la operación principal
  }
}

// ── Clasificador de texto libre (reglas simples, sin IA externa) ─────────────

export type ClasificacionSugerida = {
  ambito: "sim" | "personal";
  tipo: "ingreso" | "egreso" | "transferencia" | "ajuste";
  clasificacion: string;
  cuenta_origen_id: string | null;
  cuenta_destino_id: string | null;
  categoria_id: string | null;
  categoria_nombre: string | null;
  monto: number | null;
  descripcion: string;
  confianza: number;
  requiere_confirmacion: boolean;
};

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function detectarMonto(texto: string): number | null {
  // "8500", "8.500", "8,500", "1500000", "$8500", "8500.50"
  const matches = texto.match(/\$?\s*\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\$?\s*\d+(?:[.,]\d{1,2})?/g);
  if (!matches) return null;
  // tomar el número más grande (el monto suele ser el mayor del texto)
  let best: number | null = null;
  for (const raw of matches) {
    const limpio = raw.replace(/[$\s]/g, "");
    let n: number;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(limpio)) {
      n = Number(limpio.replace(/\./g, "").replace(",", "."));
    } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(limpio)) {
      n = Number(limpio.replace(/,/g, ""));
    } else {
      n = Number(limpio.replace(",", "."));
    }
    if (Number.isFinite(n) && n > 0 && (best === null || n > best)) best = n;
  }
  return best;
}

function detectarCuenta(texto: string, cuentas: FinCuenta[], ambito: "sim" | "personal"): FinCuenta | null {
  const t = normalizar(texto);
  const candidatas = cuentas.filter((c) => c.activa && (c.ambito === ambito || c.ambito === "compartida"));
  const porTipo = (tipo: FinCuenta["tipo"]) => candidatas.find((c) => c.tipo === tipo) || null;

  if (/\bmp\b|mercado\s*pago|mercadopago/.test(t)) return porTipo("mercado_pago");
  if (/efectivo|cash/.test(t)) return porTipo("efectivo");
  if (/banco|transferencia bancaria|cbu|alias/.test(t)) return porTipo("banco");
  return null;
}

export async function clasificarTexto(texto: string): Promise<ClasificacionSugerida> {
  const [cuentas, categorias, reglasRes] = await Promise.all([
    getCuentas(),
    getCategorias(),
    supabaseAdmin
      .from("fin_reglas_clasificacion")
      .select("*")
      .eq("activa", true)
      .order("prioridad", { ascending: true }),
  ]);
  if (reglasRes.error) throw reglasRes.error;
  const reglas = (reglasRes.data || []) as Array<{
    ambito: string | null;
    keyword: string;
    tipo_sugerido: string | null;
    clasificacion_sugerida: string | null;
    categoria_id: string | null;
    cuenta_id: string | null;
    prioridad: number;
  }>;

  const t = normalizar(texto);
  let confianza = 0.2;

  // ámbito
  let ambito: "sim" | "personal" = "sim";
  if (/\bpersonal\b|\bmio\b|\bmío\b/.test(t)) {
    ambito = "personal";
    confianza += 0.15;
  } else if (/\bsim\b|\bstand\b/.test(t)) {
    ambito = "sim";
    confianza += 0.15;
  }

  // monto
  const monto = detectarMonto(texto);
  if (monto !== null) confianza += 0.25;

  // tipo base
  let tipo: ClasificacionSugerida["tipo"] = "egreso";
  let tipoExplicito = false;
  if (/transferi|transfer[íi]|pas[eé]\s|\bmov[íi]\b/.test(t) && /\ba\b|→|->/.test(t)) {
    tipo = "transferencia";
    tipoExplicito = true;
    confianza += 0.15;
  } else if (/\bingreso\b|\bvend[íi]\b|\bventa\b|\bcobr/.test(t)) {
    tipo = "ingreso";
    tipoExplicito = true;
    confianza += 0.1;
  }

  // regla por keyword (mayor prioridad = número menor)
  let categoriaId: string | null = null;
  let categoriaNombre: string | null = null;
  let clasificacion: string = tipo === "ingreso" ? "ingreso" : "gasto";
  let cuentaRegla: string | null = null;

  for (const r of reglas) {
    if (!t.includes(normalizar(r.keyword))) continue;
    // Una regla no puede contradecir un tipo explícito en el texto
    // (ej: "ingreso ... venta simulador" no debe volverse egreso por la keyword "simulador").
    if (tipoExplicito && r.tipo_sugerido && r.tipo_sugerido !== tipo) continue;
    if (r.ambito && r.ambito !== ambito) {
      // si la regla trae ámbito explícito distinto y el texto no fijó ámbito, adoptarlo
      if (!/\bpersonal\b|\bsim\b|\bstand\b|\bmio\b|\bmío\b/.test(t)) {
        ambito = r.ambito as "sim" | "personal";
      } else {
        continue;
      }
    }
    if (r.tipo_sugerido && tipo !== "transferencia") tipo = r.tipo_sugerido as ClasificacionSugerida["tipo"];
    if (r.clasificacion_sugerida) clasificacion = r.clasificacion_sugerida;
    if (r.categoria_id) {
      categoriaId = r.categoria_id;
      categoriaNombre = categorias.find((c) => c.id === r.categoria_id)?.nombre || null;
    }
    if (r.cuenta_id) cuentaRegla = r.cuenta_id;
    confianza += 0.25;
    break;
  }

  // cuentas
  let cuentaOrigen: string | null = null;
  let cuentaDestino: string | null = null;

  if (tipo === "transferencia") {
    // "transferi 450000 efectivo a mp" → origen antes de "a", destino después
    const partes = t.split(/\ba\b|→|->/);
    const origenDetectada = detectarCuenta(partes[0] || "", cuentas, ambito);
    const destinoDetectada = detectarCuenta(partes.slice(1).join(" ") || "", cuentas, ambito);
    cuentaOrigen = origenDetectada?.id || null;
    cuentaDestino = destinoDetectada?.id || null;
    if (cuentaOrigen && cuentaDestino) confianza += 0.2;
    clasificacion = "otro";
  } else {
    const detectada = detectarCuenta(texto, cuentas, ambito);
    cuentaOrigen = detectada?.id || cuentaRegla;
    if (cuentaOrigen) confianza += 0.15;
  }

  // fallback de categoría "sin clasificar" para ingresos / otros
  if (!categoriaId) {
    const fallbackTipo = clasificacion === "ingreso" ? "ingreso" : clasificacion;
    const cat = categorias.find(
      (c) =>
        c.activa &&
        c.tipo === (fallbackTipo as FinCategoria["tipo"]) &&
        (c.ambito === ambito || c.ambito === "ambos") &&
        /otros|sin clasificar/i.test(c.nombre)
    );
    if (cat) {
      categoriaId = cat.id;
      categoriaNombre = cat.nombre;
    }
  }

  confianza = Math.min(1, Math.round(confianza * 100) / 100);

  return {
    ambito,
    tipo,
    clasificacion,
    cuenta_origen_id: cuentaOrigen,
    cuenta_destino_id: cuentaDestino,
    categoria_id: categoriaId,
    categoria_nombre: categoriaNombre,
    monto,
    descripcion: texto.trim().slice(0, 300),
    confianza,
    requiere_confirmacion: confianza < 0.8 || monto === null,
  };
}

// ── Cierre: helpers ──────────────────────────────────────────────────────────

export async function getCierreMes(mes: string) {
  const { data, error } = await supabaseAdmin
    .from("fin_cierres_mensuales")
    .select("*, cuentas:fin_cierres_cuentas(*)")
    .eq("mes", mes)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function mesEstaCerrado(mes: string): Promise<boolean> {
  const cierre = await getCierreMes(mes);
  return Boolean(cierre && cierre.estado !== "abierto");
}

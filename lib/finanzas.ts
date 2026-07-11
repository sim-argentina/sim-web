// Módulo Finanzas — helpers server-side.
//
// Modelo de caja de SIM (simplificado):
// - Todo es SIM (sin ámbitos). Cuentas/fuentes: solo Efectivo y Mercado Pago.
// - Saldo inicial GENERAL por mes (no por cuenta).
// - "Mi sueldo": monto mensual asignado; los gastos personales son egresos
//   clasificados como sueldo_personal que salen de la caja del stand.
// - Sin "retiros" como concepto.
//
// IMPORTANTE: este módulo es satélite. Sobre las tablas operativas existentes
// (turnos_stand, reservas, gift_cards, campeonato_inscripciones) solo se hacen
// LECTURAS. turnos_historicos NO es fuente. Escritura solo en tablas fin_*.

import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type CuentaTipo = "efectivo" | "mercado_pago";

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
  tipo: "ingreso" | "costo" | "gasto" | "inversion" | "sueldo_personal" | "ajuste" | "retiro";
  activa: boolean;
  orden: number;
  color: string | null;
  descripcion: string | null;
  protegida: boolean;
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
  cantidad_simuladores: number; // default por día
  horas_operativas_dia: number; // default por día
  valor_activos: number;
  inversion_inicial: number;
  meta_facturacion: number;
  meta_margen_operativo: number;
  meta_ocupacion: number;
  mes_inicio: string;
};

export type FinExcepcion = {
  id: string;
  fecha: string;
  cerrado: boolean;
  horas: number | null;
  simuladores: number | null;
  motivo: string | null;
};

// Mes cero operativo de Finanzas si la config no puede leerse.
export const MES_INICIO_DEFAULT = "2026-07";
export const DURACION_BASE_MIN = 15;

export type IngresoAutomatico = {
  fuente: string;
  fuenteLabel: string;
  categoria: string;
  metodo: string;
  cuentaTipo: CuentaTipo;
  total: number;
  cantidad: number;
};

// ── Constantes ───────────────────────────────────────────────────────────────

export const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TIPOS_MOVIMIENTO = ["ingreso", "egreso", "transferencia", "ajuste"] as const;
// "retiro" queda por compatibilidad de datos viejos, pero no se usa en el flujo.
export const CLASIFICACIONES = [
  "ingreso", "costo", "gasto", "inversion", "sueldo_personal", "ajuste", "otro", "retiro",
  "financiamiento", "pago_deuda",
] as const;
export const TIPOS_CATEGORIA = [
  "ingreso", "costo", "gasto", "inversion", "sueldo_personal", "ajuste",
] as const;

// Fuentes de ingreso automático de SIM. La recaudación del colectivo se administra
// por separado y NO forma parte de Finanzas SIM: ninguna consulta financiera debe
// incluir tablas colectivo_* ni fuentes del colectivo.
export const FUENTES_LABEL: Record<string, string> = {
  turnero: "Turnero del stand",
  reservas_online: "Reservas online",
  gift_cards: "Gift cards",
  campeonatos: "Campeonatos",
};

// ── Utilidades de mes/fecha ──────────────────────────────────────────────────

export function mesValido(mes: string): boolean {
  return MES_RE.test(mes);
}

export function mesActual(): string {
  const ar = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
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

export function diasEnMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ── Mapeo método de pago → tipo de cuenta (solo efectivo / mercado_pago) ─────

export function metodoACuentaTipo(metodo: string): CuentaTipo {
  const m = metodo.toLowerCase().trim();
  if (m === "efectivo" || m === "cash") return "efectivo";
  // Todo lo no-efectivo (transferencia/banco/débito/crédito/qr/mp/…) va a Mercado Pago.
  return "mercado_pago";
}

// ── Datos base ───────────────────────────────────────────────────────────────

export async function getCuentas(): Promise<FinCuenta[]> {
  const { data, error } = await supabaseAdmin
    .from("fin_cuentas")
    .select("*")
    .eq("activa", true)
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
  return (data || []).map((c) => ({ ...c, protegida: Boolean(c.protegida) })) as FinCategoria[];
}

export async function getConfiguracion(): Promise<FinConfiguracion> {
  const { data, error } = await supabaseAdmin
    .from("fin_configuracion")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return {
    cantidad_simuladores: Number(data?.cantidad_simuladores ?? 4) || 4,
    horas_operativas_dia: Number(data?.horas_operativas_dia ?? 12) || 12,
    valor_activos: Number(data?.valor_activos ?? 0),
    inversion_inicial: Number(data?.inversion_inicial ?? 0),
    meta_facturacion: Number(data?.meta_facturacion ?? 0),
    meta_margen_operativo: Number(data?.meta_margen_operativo ?? 0),
    meta_ocupacion: Number(data?.meta_ocupacion ?? 0),
    mes_inicio: MES_RE.test(String(data?.mes_inicio || "")) ? String(data?.mes_inicio) : MES_INICIO_DEFAULT,
  };
}

export async function getMesInicio(): Promise<string> {
  return (await getConfiguracion()).mes_inicio;
}

export async function getSueldoMes(mes: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("fin_sueldos")
    .select("monto")
    .eq("mes", mes)
    .maybeSingle();
  if (error) throw error;
  return Number(data?.monto ?? 0) || 0;
}

export async function getExcepcionesMes(mes: string): Promise<FinExcepcion[]> {
  const { data, error } = await supabaseAdmin
    .from("fin_excepciones_operativas")
    .select("*")
    .gte("fecha", `${mes}-01`)
    .lte("fecha", `${mes}-31`)
    .order("fecha", { ascending: true });
  if (error) throw error;
  return (data || []).map((e) => ({
    id: e.id,
    fecha: e.fecha,
    cerrado: Boolean(e.cerrado),
    horas: e.horas === null ? null : Number(e.horas),
    simuladores: e.simuladores === null ? null : Number(e.simuladores),
    motivo: e.motivo ?? null,
  })) as FinExcepcion[];
}

// ── Duración promedio de turno (auto: 15 + demora promedio de subida) ────────

export async function getDuracionPromedioTurno(mes: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("turnos_stand")
    .select("hora_estimada_subida, hora_subida, fecha, estado")
    .gte("fecha", `${mes}-01`)
    .lte("fecha", `${mes}-31`);
  if (error) throw error;

  const toMin = (h: unknown): number | null => {
    if (!h || typeof h !== "string") return null;
    const [hh, mm] = h.split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  };

  const demoras: number[] = [];
  for (const t of (data || []) as Array<Record<string, unknown>>) {
    if (t.estado === "cancelado") continue;
    const est = toMin(t.hora_estimada_subida);
    const sub = toMin(t.hora_subida);
    if (est === null || sub === null) continue;
    const d = sub - est;
    // Solo demoras "normales": descarta negativas y extraordinarias (>30 min).
    if (d >= 0 && d <= 30) demoras.push(d);
  }
  if (demoras.length === 0) return DURACION_BASE_MIN;
  const avg = demoras.reduce((a, b) => a + b, 0) / demoras.length;
  return Math.max(DURACION_BASE_MIN, Math.round(DURACION_BASE_MIN + avg));
}

// Capacidad teórica del mes (por día, respetando excepciones).
export function capacidadYDiasOperativos(
  mes: string,
  config: FinConfiguracion,
  excepciones: FinExcepcion[],
  duracionTurnoMin: number
): { capacidad: number; diasOperativos: number; diasDelMes: number; diasCerrados: number } {
  const total = diasEnMes(mes);
  const excPorFecha: Record<string, FinExcepcion> = {};
  for (const e of excepciones) excPorFecha[e.fecha] = e;

  const dur = duracionTurnoMin > 0 ? duracionTurnoMin : DURACION_BASE_MIN;
  let capacidad = 0;
  let diasCerrados = 0;

  for (let d = 1; d <= total; d++) {
    const fecha = `${mes}-${String(d).padStart(2, "0")}`;
    const exc = excPorFecha[fecha];
    if (exc?.cerrado) {
      diasCerrados++;
      continue;
    }
    const horas = exc?.horas ?? config.horas_operativas_dia;
    const sims = exc?.simuladores ?? config.cantidad_simuladores;
    const slots = Math.floor((horas * 60) / dur);
    capacidad += sims * slots;
  }

  return { capacidad, diasOperativos: total - diasCerrados, diasDelMes: total, diasCerrados };
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

    if (fuente === "turnero") {
      turnosPorFuente[fuente] = Math.max(turnosPorFuente[fuente] || 0, Number(row.cantidad) || 0);
    }
  }
  const turnosDelMes = Object.values(turnosPorFuente).reduce((a, b) => a + b, 0);

  return { items, totalPorFuente, total, turnosDelMes };
}

export async function getSerieIngresos(desde: string, hasta: string): Promise<
  Array<{ mes: string; fuente: string; total: number; turnos: number }>
> {
  const { data, error } = await supabaseAdmin.rpc("fin_serie_ingresos", { p_desde: desde, p_hasta: hasta });
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

// ── Saldo inicial GENERAL ─────────────────────────────────────────────────────

export async function getSaldoInicialGeneral(mes: string): Promise<number> {
  // 1) Si el mes anterior está cerrado, arrastra su saldo real general.
  const prev = mesAnterior(mes);
  const { data: cierrePrev, error: e1 } = await supabaseAdmin
    .from("fin_cierres_mensuales")
    .select("estado, saldo_real_general")
    .eq("mes", prev)
    .maybeSingle();
  if (e1) throw e1;
  if (cierrePrev && cierrePrev.estado !== "abierto") {
    return Number(cierrePrev.saldo_real_general) || 0;
  }
  // 2) Si no, usa el saldo inicial general cargado manualmente para este mes.
  const { data: ini, error: e2 } = await supabaseAdmin
    .from("fin_saldos_iniciales")
    .select("monto")
    .eq("mes", mes)
    .maybeSingle();
  if (e2) throw e2;
  return Number(ini?.monto ?? 0) || 0;
}

// Reparte el saldo inicial GENERAL del mes entre Efectivo y Mercado Pago usando
// el desglose declarado en fin_saldos_iniciales (monto_efectivo / monto_mercado_pago).
// No cambia el saldo inicial general (fuente de verdad, ya calculado por
// getSaldoInicialGeneral y que respeta el arrastre de cierres): solo lo divide por
// fuente. El resultado SIEMPRE suma exactamente el general. Si no hay desglose
// cargado, el general no se puede repartir y queda todo en Efectivo (desglosado=false).
export async function getSaldoInicialPorFuente(
  mes: string,
  saldoInicialGeneral: number
): Promise<{ efectivo: number; mercado_pago: number; desglosado: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("fin_saldos_iniciales")
    .select("monto_efectivo, monto_mercado_pago")
    .eq("mes", mes)
    .maybeSingle();
  if (error) throw error;

  const ef = Number(data?.monto_efectivo ?? 0) || 0;
  const mp = Number(data?.monto_mercado_pago ?? 0) || 0;
  const suma = ef + mp;

  if (suma === 0) {
    return { efectivo: saldoInicialGeneral, mercado_pago: 0, desglosado: false };
  }
  // Aplica la proporción declarada al saldo inicial general (coincide exacto
  // cuando el desglose ya suma el general; se reescala si hubo arrastre de cierre).
  const efectivo = Math.round((saldoInicialGeneral * ef) / suma);
  return { efectivo, mercado_pago: saldoInicialGeneral - efectivo, desglosado: true };
}

// ── Resumen mensual (general + por fuente) ───────────────────────────────────

export type ResumenPorFuente = {
  tipo: CuentaTipo;
  nombre: string;
  ingresos: number; // operativos
  financiamiento: number;
  costos: number;
  gastos: number;
  inversiones: number;
  gastosSueldo: number;
  otros: number;
  pagosDeuda: number;
  transferenciasEntrantes: number;
  transferenciasSalientes: number;
  egresos: number; // total egresos (costos+gastos+inversiones+sueldo+otros+pagosDeuda)
  neto: number;
};

export type ResumenMes = {
  mes: string;
  ingresosAutomaticos: number;
  ingresosManuales: number;
  ingresos: number; // operativos (auto + manuales), SIN financiamiento
  financiamiento: number; // préstamos / entradas de financiamiento (no es revenue)
  costos: number;
  gastos: number;
  inversiones: number;
  gastosSueldo: number;
  pagosDeuda: number;
  otros: number;
  ajustesNet: number;
  sueldoAsignado: number;
  sueldoDisponible: number;
  resultadoOperativo: number;
  saldoInicialGeneral: number;
  saldoFinalTeoricoGeneral: number;
  turnosDelMes: number;
  porFuente: ResumenPorFuente[];
  sueldoPorCategoria: Record<string, number>;
  sueldoPorFuente: Record<string, number>;
};

export function resumirMes(params: {
  mes: string;
  movimientos: FinMovimiento[];
  ingresosAuto: IngresoAutomatico[];
  ingresosAutoTotal: number;
  turnosDelMes: number;
  saldoInicialGeneral: number;
  sueldoAsignado: number;
  cuentas: FinCuenta[];
  categorias: FinCategoria[];
}): ResumenMes {
  const { mes, movimientos, ingresosAuto, ingresosAutoTotal, turnosDelMes, saldoInicialGeneral, sueldoAsignado, cuentas, categorias } = params;

  const catById: Record<string, FinCategoria> = {};
  for (const c of categorias) catById[c.id] = c;

  // Por fuente (solo cuentas activas: efectivo / mercado_pago)
  const porFuenteMap: Record<string, ResumenPorFuente> = {};
  const cuentaTipoById: Record<string, CuentaTipo> = {};
  for (const c of cuentas) {
    const tipo = (c.tipo === "efectivo" ? "efectivo" : "mercado_pago") as CuentaTipo;
    cuentaTipoById[c.id] = tipo;
    porFuenteMap[tipo] = porFuenteMap[tipo] || {
      tipo,
      nombre: c.nombre,
      ingresos: 0,
      financiamiento: 0,
      costos: 0,
      gastos: 0,
      inversiones: 0,
      gastosSueldo: 0,
      otros: 0,
      pagosDeuda: 0,
      transferenciasEntrantes: 0,
      transferenciasSalientes: 0,
      egresos: 0,
      neto: 0,
    };
  }

  let ingresosManuales = 0;
  let financiamiento = 0;
  let costos = 0;
  let gastos = 0;
  let inversiones = 0;
  let gastosSueldo = 0;
  let pagosDeuda = 0;
  let otros = 0;
  let ajustesNet = 0;
  const sueldoPorCategoria: Record<string, number> = {};
  const sueldoPorFuente: Record<string, number> = {};
  const fuenteDe = (id: string | null) => (id ? porFuenteMap[cuentaTipoById[id]] : undefined);

  for (const m of movimientos) {
    if (m.origen === "ajuste_inicial") continue; // saldo inicial general, no es movimiento operativo

    const f = fuenteDe(m.tipo === "transferencia" ? null : m.cuenta_origen_id);

    if (m.tipo === "ingreso") {
      if (m.clasificacion === "financiamiento") {
        financiamiento += m.monto;
        if (f) f.financiamiento += m.monto;
      } else {
        ingresosManuales += m.monto;
        if (f) f.ingresos += m.monto;
      }
    } else if (m.tipo === "egreso") {
      if (m.clasificacion === "costo") { costos += m.monto; if (f) f.costos += m.monto; }
      else if (m.clasificacion === "gasto") { gastos += m.monto; if (f) f.gastos += m.monto; }
      else if (m.clasificacion === "inversion") { inversiones += m.monto; if (f) f.inversiones += m.monto; }
      else if (m.clasificacion === "sueldo_personal" || m.clasificacion === "retiro") {
        gastosSueldo += m.monto;
        if (f) f.gastosSueldo += m.monto;
        const cat = m.categoria_id ? catById[m.categoria_id]?.nombre : null;
        sueldoPorCategoria[cat || "Sin categoría"] = (sueldoPorCategoria[cat || "Sin categoría"] || 0) + m.monto;
        const ft = m.cuenta_origen_id ? cuentaTipoById[m.cuenta_origen_id] : null;
        if (ft) sueldoPorFuente[ft] = (sueldoPorFuente[ft] || 0) + m.monto;
      } else if (m.clasificacion === "pago_deuda") { pagosDeuda += m.monto; if (f) f.pagosDeuda += m.monto; }
      else { otros += m.monto; if (f) f.otros += m.monto; }
    } else if (m.tipo === "transferencia") {
      const fo = fuenteDe(m.cuenta_origen_id);
      const fd = fuenteDe(m.cuenta_destino_id);
      if (fo) fo.transferenciasSalientes += m.monto;
      if (fd) fd.transferenciasEntrantes += m.monto;
    } else if (m.tipo === "ajuste") {
      ajustesNet += m.cuenta_destino_id ? m.monto : -m.monto;
      const fd = fuenteDe(m.cuenta_destino_id);
      const fo = fuenteDe(m.cuenta_origen_id);
      if (fd) fd.ingresos += m.monto;
      else if (fo) fo.otros += m.monto;
    }
  }

  // Ingresos automáticos → suman a la fuente (efectivo / mercado_pago) según método
  for (const item of ingresosAuto) {
    const f = porFuenteMap[item.cuentaTipo];
    if (f) f.ingresos += item.total;
  }

  const porFuente = Object.values(porFuenteMap).map((f) => {
    const egresos = f.costos + f.gastos + f.inversiones + f.gastosSueldo + f.otros + f.pagosDeuda;
    return {
      ...f,
      egresos,
      neto: f.ingresos + f.financiamiento - egresos + f.transferenciasEntrantes - f.transferenciasSalientes,
    };
  });

  const ingresos = ingresosAutoTotal + ingresosManuales; // operativos, sin financiamiento
  const egresosTotales = costos + gastos + inversiones + gastosSueldo + otros + pagosDeuda;
  const saldoFinalTeoricoGeneral = saldoInicialGeneral + ingresos + financiamiento - egresosTotales + ajustesNet;

  return {
    mes,
    ingresosAutomaticos: ingresosAutoTotal,
    ingresosManuales,
    ingresos,
    financiamiento,
    costos,
    gastos,
    inversiones,
    gastosSueldo,
    pagosDeuda,
    otros,
    ajustesNet,
    sueldoAsignado,
    sueldoDisponible: sueldoAsignado - gastosSueldo,
    resultadoOperativo: ingresos - costos - gastos,
    saldoInicialGeneral,
    saldoFinalTeoricoGeneral,
    turnosDelMes,
    porFuente,
    sueldoPorCategoria,
    sueldoPorFuente,
  };
}

// Calcula todo lo necesario para resumen/cierre de un mes.
export async function calcularMes(mes: string): Promise<{
  resumen: ResumenMes;
  ingresosAuto: IngresoAutomatico[];
  movimientos: FinMovimiento[];
}> {
  const [cuentas, categorias, ingresosAutoData, movimientos, saldoInicial, sueldo] = await Promise.all([
    getCuentas(),
    getCategorias(),
    getIngresosAutomaticos(mes),
    getMovimientosMes(mes),
    getSaldoInicialGeneral(mes),
    getSueldoMes(mes),
  ]);

  const resumen = resumirMes({
    mes,
    movimientos,
    ingresosAuto: ingresosAutoData.items,
    ingresosAutoTotal: ingresosAutoData.total,
    turnosDelMes: ingresosAutoData.turnosDelMes,
    saldoInicialGeneral: saldoInicial,
    sueldoAsignado: sueldo,
    cuentas,
    categorias,
  });

  return { resumen, ingresosAuto: ingresosAutoData.items, movimientos };
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
    await supabaseAdmin.from("fin_logs").insert([{ accion, entidad, entidad_id: entidadId, detalle, rol: rol || null }]);
  } catch {
    // el log nunca debe romper la operación principal
  }
}

// ── Clasificador de texto libre (reglas simples, sin ámbito, sin IA) ─────────

export type ClasificacionSugerida = {
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
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function detectarMonto(texto: string): number | null {
  const matches = texto.match(/\$?\s*\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\$?\s*\d+(?:[.,]\d{1,2})?/g);
  if (!matches) return null;
  let best: number | null = null;
  for (const raw of matches) {
    const limpio = raw.replace(/[$\s]/g, "");
    let n: number;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(limpio)) n = Number(limpio.replace(/\./g, "").replace(",", "."));
    else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(limpio)) n = Number(limpio.replace(/,/g, ""));
    else n = Number(limpio.replace(",", "."));
    if (Number.isFinite(n) && n > 0 && (best === null || n > best)) best = n;
  }
  return best;
}

function detectarCuenta(texto: string, cuentas: FinCuenta[]): FinCuenta | null {
  const t = normalizar(texto);
  const porTipo = (tipo: string) => cuentas.find((c) => c.tipo === tipo) || null;
  if (/\bmp\b|mercado\s*pago|mercadopago|transferenci|banco|debito|credito|tarjeta|qr/.test(t)) return porTipo("mercado_pago");
  if (/efectivo|cash|\bcont[ao]do\b/.test(t)) return porTipo("efectivo");
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
    keyword: string;
    tipo_sugerido: string | null;
    clasificacion_sugerida: string | null;
    categoria_id: string | null;
    cuenta_id: string | null;
    prioridad: number;
  }>;

  const t = normalizar(texto);
  let confianza = 0.2;

  const monto = detectarMonto(texto);
  if (monto !== null) confianza += 0.3;

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

  let categoriaId: string | null = null;
  let categoriaNombre: string | null = null;
  let clasificacion: string = tipo === "ingreso" ? "ingreso" : "gasto";
  let cuentaRegla: string | null = null;

  for (const r of reglas) {
    if (!t.includes(normalizar(r.keyword))) continue;
    if (tipoExplicito && r.tipo_sugerido && r.tipo_sugerido !== tipo) continue;
    if (r.tipo_sugerido && tipo !== "transferencia") tipo = r.tipo_sugerido as ClasificacionSugerida["tipo"];
    if (r.clasificacion_sugerida) clasificacion = r.clasificacion_sugerida;
    if (r.categoria_id) {
      categoriaId = r.categoria_id;
      categoriaNombre = categorias.find((c) => c.id === r.categoria_id)?.nombre || null;
    }
    if (r.cuenta_id) cuentaRegla = r.cuenta_id;
    confianza += 0.3;
    break;
  }

  // Gasto de "Mi sueldo": si el texto menciona sueldo/personal, es un egreso
  // clasificado como sueldo_personal. Si además el texto nombra otra categoría
  // (de cualquier tipo activo, ej. comida, nafta, tarjeta…), se usa esa; si no,
  // cae en la categoría "Mi sueldo".
  if (/\bsueldo\b|mi\s*sueldo|\bpersonal\b|gasto\s*sueldo/.test(t)) {
    tipo = "egreso";
    clasificacion = "sueldo_personal";
    confianza += 0.2;
    const activas = categorias.filter((c) => c.activa);
    const esMiSueldo = (c: FinCategoria) => /mi\s*sueldo/.test(normalizar(c.nombre));
    const miSueldo = activas.find((c) => c.tipo === "sueldo_personal" && esMiSueldo(c));
    // Otra categoría mencionada en el texto (cualquier tipo), distinta de "Mi sueldo".
    const otra = activas.find((c) => {
      if (esMiSueldo(c)) return false;
      const token = normalizar(c.nombre.split("/")[0].trim());
      return token.length >= 3 && t.includes(token);
    });
    const cat = otra || miSueldo || activas.find((c) => c.tipo === "sueldo_personal") || null;
    if (cat) {
      categoriaId = cat.id;
      categoriaNombre = cat.nombre;
    }
  }

  let cuentaOrigen: string | null = null;
  let cuentaDestino: string | null = null;
  if (tipo === "transferencia") {
    const partes = t.split(/\ba\b|→|->/);
    cuentaOrigen = detectarCuenta(partes[0] || "", cuentas)?.id || null;
    cuentaDestino = detectarCuenta(partes.slice(1).join(" ") || "", cuentas)?.id || null;
    if (cuentaOrigen && cuentaDestino) confianza += 0.2;
    clasificacion = "otro";
  } else {
    cuentaOrigen = detectarCuenta(texto, cuentas)?.id || cuentaRegla;
    if (cuentaOrigen) confianza += 0.15;
  }

  confianza = Math.min(1, Math.round(confianza * 100) / 100);

  return {
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
    .select("*")
    .eq("mes", mes)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function mesEstaCerrado(mes: string): Promise<boolean> {
  const cierre = await getCierreMes(mes);
  return Boolean(cierre && cierre.estado !== "abierto");
}

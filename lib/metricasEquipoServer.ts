import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMesVista, getFallback, type MesVista } from "@/lib/cronogramaServer";
import { calcularHorasMensuales, horaAMinutos, type DiaResol } from "@/lib/cronograma";
import { personasDeFila, turnosDeFila, totalDeFila } from "@/lib/metricasStand";
import { calcularComisionesPagos, claveComision, type ComisionConfig } from "@/lib/finanzasComisiones";
import { getComisionesConfig } from "@/lib/finanzas";
import { idsReembolsadas } from "@/lib/reservasReembolsos";
import {
  CERO, sumarMetricas, calcularTurnos, resolverAtribucion, nuevoAcum, imputar, reconciliar,
  type Metricas, type MotivoNoAtribuir, type Reconciliacion,
} from "@/lib/metricasEquipo";

// IA SIM · Bloque 3B — Ensamblado server-side del reporte de métricas por integrante.
// CÁLCULO VIVO desde las fuentes (turnos_stand, reservas, cronograma, comisiones,
// reembolsos): las correcciones de cronograma o el registro de un reembolso se
// reflejan automáticamente, sin tabla derivada.
//
// Doble conteo: las fuentes son tablas DISTINTAS con ids propios (clave stand:<id> /
// reserva:<id>); el Turnero solo las UNE en memoria (no persiste reservas en
// turnos_stand). No se deduplica por nombre/teléfono/importe ni por coincidencias.

const TZ = "America/Argentina/Cordoba";

export type FuenteFiltro = "todas" | "stand" | "reservas";

export type ConsultaParams = {
  desde: string; // 'YYYY-MM-DD' (inclusive)
  hasta: string; // 'YYYY-MM-DD' (inclusive)
  empleadoId?: string | null; // filtra el detalle a un integrante
  fuentes?: FuenteFiltro; // 'todas' | 'stand' | 'reservas'
  corte?: string | null; // ISO datetime; default = ahora (Córdoba)
};

export type IntegranteMetricas = {
  empleado_id: string;
  nombre: string;
  archivado: boolean;
  horas_minutos: number;
  total: Metricas;
  stand: Metricas;
  reservas: Metricas;
};

export type SinAtribuir = { motivo: MotivoNoAtribuir; metricas: Metricas };
export type Exclusion = { tipo: string; cantidad: number; periodo: string; detalle: string };
export type Anomalia = { tipo: string; gravedad: "info" | "warn"; mensaje: string; cantidad?: number };

export type ReporteEquipo = {
  periodo: { desde: string; hasta: string };
  zonaHoraria: string;
  corte: string; // ISO (Córdoba wall-clock) hasta donde los resultados son reales
  cronograma: { cobertura: Array<{ mes: string; estado: string; dias: number; dias_cerrados: number }>; todosConfirmados: boolean };
  definiciones: Record<string, string>;
  fuentesUsadas: FuenteFiltro;
  integrantes: IntegranteMetricas[];
  totalesOrigen: Metricas;
  totalesAtribuidos: Metricas;
  sinAtribuir: SinAtribuir[];
  actividadFuturaPendiente: { cantidad: number; metricas: Metricas };
  exclusiones: Exclusion[];
  anomalias: Anomalia[];
  reconciliacion: { ok: boolean; filas: Reconciliacion[] };
  frescura: { turnos_stand: string | null; reservas: string | null; generado_at: string };
  registros: { stand: number; reservas: number; historicos_en_rango: number };
};

const DEFINICIONES: Record<string, string> = {
  turno: "1 turno = 15 minutos de uso por 1 persona/simulador (personas × minutos / 15).",
  operacion: "1 registro comercial/sesión fuente válido (turno del Stand o reserva web efectiva). Se reparte entre integrantes simultáneos.",
  personas: "Cantidad de personas/simuladores de la operación (Stand: cantidad_personas; Reserva: cantidad de simuladores).",
  minutos: "turnos × 15 (minutos-persona vendidos).",
  horas: "Minutos del cronograma CONFIRMADO por integrante; jornadas completas (no se reparten); huecos del horario operativo → Ramiro. Día cerrado / fuera de horario = 0.",
  bruto: "Facturación bruta de la operación (Stand: total; Reserva: total cobrado).",
  comision: "Comisión de cobro canónica (Stand: por pago con la config de Finanzas). Reservas web: Finanzas NO modela comisión → 0 (limitación declarada, no se inventa).",
  neto: "bruto − comisión.",
  atribucion: "Por fecha+hora de INICIO del servicio (Stand: hora_subida ó hora; Reserva: fecha+hora reservadas), zona America/Argentina/Cordoba, intervalos [inicio, fin). Solo cronograma confirmado atribuye.",
  mes_servicio: "Las métricas del equipo se imputan al MES DEL SERVICIO (no al del cobro); no alteran Finanzas.",
};

// ── Helpers de fecha/hora en Córdoba ──────────────────────────────────────────
function ahoraCordoba(): { fecha: string; hora: string; iso: string } {
  return desdeDate(new Date());
}
function desdeDate(d: Date): { fecha: string; hora: string; iso: string } {
  // en-CA da 'YYYY-MM-DD'; HH:MM 24h en la zona de Córdoba.
  const fecha = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const hora = d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return { fecha, hora, iso: `${fecha}T${hora}` };
}
function normHora(h: unknown): string | null {
  const s = String(h ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]); const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
// Compara "YYYY-MM-DD"+"HH:MM" contra el corte. true si es FUTURO (> corte).
function esFuturo(fecha: string, hora: string, corteFecha: string, corteHora: string): boolean {
  const a = `${fecha}T${hora}`;
  const b = `${corteFecha}T${corteHora}`;
  return a > b;
}
function mesesEnRango(desde: string, hasta: string): Array<{ anio: number; mes: number }> {
  const out: Array<{ anio: number; mes: number }> = [];
  let [y, m] = [Number(desde.slice(0, 4)), Number(desde.slice(5, 7))];
  const [yh, mh] = [Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7))];
  while (y < yh || (y === yh && m <= mh)) {
    out.push({ anio: y, mes: m });
    m++; if (m > 12) { m = 1; y++; }
    if (out.length > 120) break; // guarda anti-rango absurdo
  }
  return out;
}
function diaResolDe(vista: MesVista, fecha: string): DiaResol | null {
  const d = vista.dias.find((x) => x.fecha === fecha);
  if (d) return { cerrado: d.cerrado, apertura: d.apertura, cierre: d.cierre, jornadas: d.jornadas.map((j) => ({ empleado_id: j.empleado_id, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })) };
  // Mes confirmado sin fila de día (no debería pasar): día abierto con defaults → fallback.
  if (vista.estado === "confirmado") return { cerrado: false, apertura: vista.apertura_default, cierre: vista.cierre_default, jornadas: [] };
  return null;
}

// ── Función de dominio reutilizable (base para herramienta IA SIM) ────────────
export async function consultarMetricasEquipo(params: ConsultaParams): Promise<ReporteEquipo> {
  const desde = params.desde;
  const hasta = params.hasta;
  const fuentes: FuenteFiltro = params.fuentes ?? "todas";
  const corte = params.corte ? desdeDate(new Date(params.corte)) : ahoraCordoba();
  const generado_at = new Date().toISOString();

  // Cronograma por mes (cache) + fallback (Ramiro).
  const fallback = await getFallback();
  const fallbackId = fallback?.id ?? "";
  const vistas = new Map<string, MesVista>();
  const cobertura: ReporteEquipo["cronograma"]["cobertura"] = [];
  for (const { anio, mes } of mesesEnRango(desde, hasta)) {
    const v = await getMesVista(anio, mes);
    const key = `${anio}-${String(mes).padStart(2, "0")}`;
    vistas.set(key, v);
    cobertura.push({ mes: key, estado: v.estado, dias: v.dias.length, dias_cerrados: v.dias.filter((d) => d.cerrado).length });
  }
  const vistaDe = (fecha: string) => vistas.get(fecha.slice(0, 7)) ?? null;

  // Empleados (nombre + activo) para nombres y estado archivado.
  const { data: empRows } = await supabaseAdmin.from("empleados").select("id, nombre_formal, activo, es_fallback, created_at").order("es_fallback", { ascending: false }).order("created_at", { ascending: true });
  const empleados = (empRows ?? []) as Array<{ id: string; nombre_formal: string; activo: boolean; es_fallback: boolean }>;
  const nombrePorId = new Map(empleados.map((e) => [e.id, e.nombre_formal]));
  const activoPorId = new Map(empleados.map((e) => [e.id, e.activo]));

  const acum = nuevoAcum();
  const exclusiones: Exclusion[] = [];
  const anomalias: Anomalia[] = [];
  let futuraCant = 0;
  let futuraMetricas = CERO;
  let standCount = 0;
  let reservasCount = 0;

  // ── STAND (turnos_stand) ────────────────────────────────────────────────────
  let frescuraStand: string | null = null;
  if (fuentes === "todas" || fuentes === "stand") {
    // Config de comisiones canónica.
    const cfgArr = await getComisionesConfig();
    const configByKey: Record<string, ComisionConfig> = {};
    for (const c of cfgArr) if (c.activa) configByKey[claveComision(c.procesador, c.metodo_pago)] = c;

    const { data: standRows } = await supabaseAdmin
      .from("turnos_stand")
      .select("id, created_at, fecha, hora, hora_subida, estado, total, metodo_pago, posnet_pago, pagos_detalle, cantidad_personas, cantidad_simuladores, cantidad_turnos, cantidad_minutos")
      .gte("fecha", desde).lte("fecha", hasta)
      .order("fecha", { ascending: true });

    let sinHora = 0;
    for (const t of (standRows ?? []) as Array<Record<string, unknown>>) {
      const estado = String(t.estado ?? "").toLowerCase();
      if (estado === "anulado" || estado === "cancelado") continue; // regla canónica Métricas Stand
      standCount++;
      const ca = String(t.created_at ?? "");
      if (!frescuraStand || ca > frescuraStand) frescuraStand = ca;

      const fecha = String(t.fecha);
      const inicio = normHora(t.hora_subida) ?? normHora(t.hora); // servicio: subida real, si no la asignada
      const personas = personasDeFila(t as never);
      const turnos = turnosDeFila(t as never);
      const bruto = totalDeFila(t as never);
      const rawPagos = t.pagos_detalle;
      const pagos = Array.isArray(rawPagos) && rawPagos.length > 0 ? rawPagos : [{ metodo_pago: t.metodo_pago, monto: t.total, posnet_pago: t.posnet_pago }];
      const com = calcularComisionesPagos(pagos as never, configByKey);
      const m: Metricas = { turnos, personas, operaciones: 1, minutos: turnos * 15, bruto, comision: com.comision, neto: bruto - com.comision };

      if (!inicio) { sinHora++; imputar(acum, "stand", m, { atribuido: false, motivo: "fecha_hora_invalida" }); continue; }
      // Stand es walk-in (siempre pasado); igual respetamos el corte.
      if (esFuturo(fecha, inicio, corte.fecha, corte.hora)) { futuraCant++; futuraMetricas = sumarMetricas(futuraMetricas, m); continue; }

      const vista = vistaDe(fecha);
      const atrib = resolverAtribucion({ estado: vista?.estado ?? "inexistente", dia: vista ? diaResolDe(vista, fecha) : null, hora: inicio, fallbackEmpleadoId: fallbackId });
      imputar(acum, "stand", m, atrib);
    }
    if (sinHora > 0) anomalias.push({ tipo: "stand_sin_hora_inicio", gravedad: "warn", mensaje: "Turnos de Stand sin hora de inicio válida (no atribuibles).", cantidad: sinHora });
  }

  // ── RESERVAS web ────────────────────────────────────────────────────────────
  let frescuraReservas: string | null = null;
  if (fuentes === "todas" || fuentes === "reservas") {
    const { data: resRows } = await supabaseAdmin
      .from("reservas")
      .select("id, created_at, fecha, hora, estado, total, cantidad_turnos, duracion_minutos, simuladores, origen, no_show")
      .gte("fecha", desde).lte("fecha", hasta)
      .order("fecha", { ascending: true });

    const rows = (resRows ?? []) as Array<Record<string, unknown>>;
    const reembolsadas = await idsReembolsadas(rows.map((r) => Number(r.id)));
    let canceladasN = 0, reembolsadasN = 0, pendientesN = 0;

    for (const r of rows) {
      const ca = String(r.created_at ?? "");
      if (!frescuraReservas || ca > frescuraReservas) frescuraReservas = ca;
      const estado = String(r.estado ?? "");
      const id = Number(r.id);

      // Reembolsada → excluir COMPLETAMENTE (contrato Bloque 3A), sin importar el mes del reembolso.
      if (estado === "reembolsada" || reembolsadas.has(id)) { reembolsadasN++; continue; }
      if (estado === "cancelada") { canceladasN++; continue; }
      if (estado !== "activa") { pendientesN++; continue; } // pendiente_pago / error: no es actividad pagada

      reservasCount++;
      const fecha = String(r.fecha).slice(0, 10);
      const hora = normHora(r.hora);
      const sims = Array.isArray(r.simuladores) ? (r.simuladores as unknown[]).length : 0;
      const personas = Math.max(1, sims);
      const durMin = Number(r.duracion_minutos) || 15;
      const turnos = Number(r.cantidad_turnos) || calcularTurnos(personas, durMin);
      const bruto = Number(r.total) || 0;
      // Reservas: Finanzas no modela comisión → 0 (no se inventa).
      const m: Metricas = { turnos, personas, operaciones: 1, minutos: turnos * 15, bruto, comision: 0, neto: bruto };

      if (!hora) { imputar(acum, "reservas", m, { atribuido: false, motivo: "fecha_hora_invalida" }); continue; }
      // Reserva FUTURA (servicio aún no ocurrió) → actividad pendiente, no efectiva.
      if (esFuturo(fecha, hora, corte.fecha, corte.hora)) { futuraCant++; futuraMetricas = sumarMetricas(futuraMetricas, m); continue; }

      const vista = vistaDe(fecha);
      const atrib = resolverAtribucion({ estado: vista?.estado ?? "inexistente", dia: vista ? diaResolDe(vista, fecha) : null, hora, fallbackEmpleadoId: fallbackId });
      imputar(acum, "reservas", m, atrib);
    }
    if (canceladasN > 0) exclusiones.push({ tipo: "reserva_cancelada", cantidad: canceladasN, periodo: `${desde}..${hasta}`, detalle: "Reservas canceladas: excluidas de todas las métricas." });
    if (reembolsadasN > 0) exclusiones.push({ tipo: "reserva_reembolsada", cantidad: reembolsadasN, periodo: `${desde}..${hasta}`, detalle: "Reservas reembolsadas: excluidas por completo (Bloque 3A), aunque el reembolso sea de otro mes." });
    if (pendientesN > 0) exclusiones.push({ tipo: "reserva_no_pagada", cantidad: pendientesN, periodo: `${desde}..${hasta}`, detalle: "Reservas pendientes/errores de pago: no cuentan como actividad efectiva." });
  }

  // ── Datos históricos (turnos_historicos): NO se atribuyen; se informan ────────
  let historicosEnRango = 0;
  {
    const { data: hist } = await supabaseAdmin.from("turnos_historicos").select("id, fecha").gte("fecha", desde).lte("fecha", hasta);
    historicosEnRango = (hist ?? []).length;
    if (historicosEnRango > 0) {
      exclusiones.push({ tipo: "historico_excel", cantidad: historicosEnRango, periodo: `${desde}..${hasta}`, detalle: "Importaciones Excel históricas: sin hora de inicio de sesión confiable por registro → NO se atribuyen individualmente." });
    }
  }

  // ── HORAS por integrante (cronograma confirmado, recortado al rango y al corte) ─
  const horasPorEmpleado = new Map<string, number>();
  for (const [key, vista] of vistas) {
    if (vista.estado !== "confirmado") continue; // solo confirmado es oficial
    const diasClamp = vista.dias
      .filter((d) => d.fecha >= desde && d.fecha <= hasta && d.fecha <= corte.fecha)
      .map((d) => {
        // Día del corte: recorta el cierre a la hora del corte (horas trabajadas hasta ahora).
        let cierre = d.cierre;
        if (d.fecha === corte.fecha) {
          const ci = horaAMinutos(d.cierre); const ct = horaAMinutos(corte.hora);
          if (ci !== null && ct !== null && ct < ci) cierre = corte.hora;
        }
        return { cerrado: d.cerrado, apertura: d.apertura, cierre, jornadas: d.jornadas.map((j) => ({ empleado_id: j.empleado_id, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })) };
      });
    const map = calcularHorasMensuales(diasClamp, fallbackId);
    for (const [id, min] of Object.entries(map)) horasPorEmpleado.set(id, (horasPorEmpleado.get(id) ?? 0) + min);
    // nombres de archivados con jornadas históricas
    for (const d of vista.dias) for (const j of d.jornadas) if (!j.empleado_activo && !nombrePorId.has(j.empleado_id)) nombrePorId.set(j.empleado_id, j.nombre);
    void key;
  }

  // ── Ensamblar integrantes (activos + archivados con actividad/horas) ──────────
  const idsConDatos = new Set<string>([...acum.porEmpleado.keys(), ...horasPorEmpleado.keys()]);
  for (const e of empleados) idsConDatos.add(e.id);
  let integrantes: IntegranteMetricas[] = [];
  for (const id of idsConDatos) {
    const met = acum.porEmpleado.get(id) ?? { stand: CERO, reservas: CERO };
    const total = sumarMetricas(met.stand, met.reservas);
    // Archivado: no está entre los activos (activo=false, o id ausente = histórico).
    const archivado = activoPorId.has(id) ? activoPorId.get(id) === false : true;
    integrantes.push({
      empleado_id: id,
      nombre: nombrePorId.get(id) ?? "—",
      archivado,
      horas_minutos: horasPorEmpleado.get(id) ?? 0,
      total, stand: met.stand, reservas: met.reservas,
    });
  }
  // orden: fallback/activos primero (por orden de empleados), luego archivados
  const orden = new Map(empleados.map((e, i) => [e.id, i]));
  integrantes.sort((a, b) => (orden.get(a.empleado_id) ?? 999) - (orden.get(b.empleado_id) ?? 999));
  if (params.empleadoId) integrantes = integrantes.filter((i) => i.empleado_id === params.empleadoId);

  // Totales atribuidos
  let totalesAtribuidos = CERO;
  for (const v of acum.porEmpleado.values()) totalesAtribuidos = sumarMetricas(totalesAtribuidos, sumarMetricas(v.stand, v.reservas));

  const sinAtribuir: SinAtribuir[] = [...acum.sinAtribuir.entries()].map(([motivo, metricas]) => ({ motivo, metricas }));
  const recon = reconciliar(acum);
  if (!recon.ok) anomalias.push({ tipo: "reconciliacion", gravedad: "warn", mensaje: "La reconciliación origen = atribuido + sin-atribuir excede la tolerancia." });

  const todosConfirmados = cobertura.length > 0 && cobertura.every((c) => c.estado === "confirmado");
  if (!todosConfirmados) anomalias.push({ tipo: "cronograma_incompleto", gravedad: "info", mensaje: "Hay meses del rango sin cronograma confirmado: su actividad queda sin atribuir." });

  return {
    periodo: { desde, hasta },
    zonaHoraria: TZ,
    corte: corte.iso,
    cronograma: { cobertura, todosConfirmados },
    definiciones: DEFINICIONES,
    fuentesUsadas: fuentes,
    integrantes,
    totalesOrigen: acum.totalOrigen,
    totalesAtribuidos,
    sinAtribuir,
    actividadFuturaPendiente: { cantidad: futuraCant, metricas: futuraMetricas },
    exclusiones,
    anomalias,
    reconciliacion: recon,
    frescura: { turnos_stand: frescuraStand, reservas: frescuraReservas, generado_at },
    registros: { stand: standCount, reservas: reservasCount, historicos_en_rango: historicosEnRango },
  };
}

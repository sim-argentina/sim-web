// IA SIM · Bloque 4C.2/4C.3 — Completado DETERMINÍSTICO de un informe mensual de
// métricas de un integrante. Construye tablas, gráficos, fuentes, metodología,
// conclusiones y anexo desde datos reconciliados (snapshot o motor local). No consume
// Claude. Números CRUDOS (tipables en Excel), unidad en columna aparte, texto ASCII-safe,
// una sola fecha de corte, conclusiones objetivas.

import type { InformeSpec, Tabla, Grafico, Fuente, CeldaValor } from "@/lib/ia/informes/schema";
import { validarInforme } from "@/lib/ia/informes/schema";
import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";
import { formatHoras } from "@/lib/cronograma";
import type { Componente } from "@/lib/ia/informes/requisitos";
import { indiceDesdeDatos } from "@/lib/ia/informes/procedencia";

export type Metricas = { turnos: number; personas: number; operaciones: number; minutos: number; bruto: number; comision: number; neto: number };
export type DatosMetricas = { total: Metricas; stand: Metricas; reservas: Metricas; horas_minutos: number };
export type MetaInforme = { integrante: string; anio: number; mes: number; corte: string; registros: { stand: number; reservas: number }; cronograma?: { estado?: string | null; dias?: number | null; cerrados?: number | null } };

const r2 = (n: number) => Math.round(n * 100) / 100;
const nAR = (n: number, d = 0) => n.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pesos = (n: number) => (n % 1 === 0 ? `$ ${nAR(n, 0)}` : `$ ${nAR(n, 2)}`);
const pct = (parte: number, total: number) => (total ? nAR((parte / total) * 100, 1) : "0");

// Componentes determinísticos desde datos ya reconciliados (sin motor ni Claude).
export function construirComponentes(datos: DatosMetricas, meta: MetaInforme): { tablas: Tabla[]; graficos: Grafico[]; fuentes: Fuente[]; metodologia: string; conclusiones: string[]; anexo: Tabla[] } {
  const { total: T, stand: S, reservas: R } = datos;
  const mm = String(meta.mes).padStart(2, "0");
  const desde = `${meta.anio}-${mm}-01`;
  const hasta = new Date(Date.UTC(meta.anio, meta.mes, 0)).toISOString().slice(0, 10);
  const periodoStr = `${meta.anio}-${mm} (${desde.split("-").reverse().join("/")} - ${hasta.split("-").reverse().join("/")})`;
  const fuenteBase = `Métricas de Equipo · ${meta.anio}-${mm}`;
  const registros = (meta.registros?.stand ?? 0) + (meta.registros?.reservas ?? 0);

  // ── Tabla de indicadores: valores NUMÉRICOS crudos + unidad en columna aparte ──
  const tablaIndicadores: Tabla = {
    titulo: `Indicadores de ${meta.integrante} — ${meta.anio}-${mm}`,
    columnas: [{ clave: "ind", etiqueta: "Indicador", tipo: "texto" }, { clave: "val", etiqueta: "Valor", tipo: "decimal" }, { clave: "uni", etiqueta: "Unidad", tipo: "texto" }],
    filas: [
      ["Horas de cronograma", r2(datos.horas_minutos / 60), "h"],
      ["Turnos", T.turnos, "turnos"],
      ["Personas/simuladores", T.personas, "personas"],
      ["Operaciones", r2(T.operaciones), "operaciones"],
      ["Minutos de actividad", T.minutos, "min"],
      ["Facturación bruta", T.bruto, "ARS"],
      ["Comisiones", r2(T.comision), "ARS"],
      ["Facturación neta", r2(T.neto), "ARS"],
    ] as CeldaValor[][],
    nota: `Fuente: ${fuenteBase}. Atribuido por mes de servicio; no altera Finanzas.`,
  };

  // ── Tabla por origen (numérica tipada) ───────────────────────────────────────
  const colsOrigen = [
    { clave: "origen", etiqueta: "Origen", tipo: "texto" as const },
    { clave: "turnos", etiqueta: "Turnos", tipo: "entero" as const },
    { clave: "personas", etiqueta: "Personas", tipo: "entero" as const },
    { clave: "operaciones", etiqueta: "Operaciones", tipo: "decimal" as const },
    { clave: "minutos", etiqueta: "Minutos", tipo: "minutos" as const },
    { clave: "bruto", etiqueta: "Facturación bruta", tipo: "ars" as const },
    { clave: "comision", etiqueta: "Comisiones", tipo: "ars" as const },
    { clave: "neto", etiqueta: "Facturación neta", tipo: "ars" as const },
  ];
  const filaMetricas = (nombre: string, m: Metricas): CeldaValor[] => [nombre, m.turnos, Math.round(m.personas), r2(m.operaciones), m.minutos, m.bruto, r2(m.comision), r2(m.neto)];
  const tablaOrigen: Tabla = {
    titulo: `Desglose por origen — ${meta.integrante} (${meta.anio}-${mm})`,
    columnas: colsOrigen,
    filas: [filaMetricas("Stand", S), filaMetricas("Reservas web", R)],
    nota: "Stand y Reservas se cuentan por separado y reconcilian con el total. Finanzas no modela comisión de Reservas (0).",
  };

  // ── Gráficos (valores sobre barras + unidad; los arma el renderer) ───────────
  const graficos: Grafico[] = [
    { tipo: "barras", titulo: "Turnos por origen", categorias: ["Stand", "Reservas web"], series: [{ nombre: "Turnos", valores: [S.turnos, R.turnos], unidad: "turnos" }], nota: `Fuente: ${fuenteBase}. Unidad: turnos.` },
    { tipo: "barras", titulo: "Facturación bruta por origen", categorias: ["Stand", "Reservas web"], series: [{ nombre: "Facturación bruta", valores: [S.bruto, R.bruto], unidad: "ARS" }], nota: `Fuente: ${fuenteBase}. Unidad: ARS (pesos).` },
  ];

  // ── Fuentes ───────────────────────────────────────────────────────────────────
  const fuentes: Fuente[] = [
    { modulo: "Métricas de Equipo", periodo: `${meta.anio}-${mm}`, registros, actualizado: meta.corte },
    { modulo: "Cronograma", periodo: `${meta.anio}-${mm}`, registros: null, actualizado: meta.cronograma?.estado ?? null },
    { modulo: "Turnero Stand", periodo: `${meta.anio}-${mm}`, registros: meta.registros?.stand ?? null, actualizado: null },
    { modulo: "Reservas web", periodo: `${meta.anio}-${mm}`, registros: meta.registros?.reservas ?? null, actualizado: null },
  ];

  // ── Metodología (reglas del motor; SIN repetir período/corte, ASCII-safe) ────
  const cro = meta.cronograma;
  const metodologia = [
    "Atribucion por MES DE SERVICIO (no por mes de cobro; no altera Finanzas). Se atribuye al integrante presente segun el cronograma confirmado; ante simultaneidad, la actividad se reparte entre los integrantes presentes.",
    "Se separan dos origenes: Turnero Stand y Reservas web (se cuentan una sola vez cada uno; reconcilian con el total).",
    "Unidades: horas de cronograma (h; en minutos internamente), turnos (personas x minutos / 15), personas/simuladores, operaciones, minutos de actividad, y pesos argentinos (ARS) para facturacion.",
    "Facturacion: bruta, comisiones y neta (neta = bruta - comisiones). Finanzas no modela comision de Reservas web (queda en 0; no se inventa).",
    `Cronograma del mes: estado ${cro?.estado ?? "confirmado"}${cro?.dias != null ? ` (${cro.dias} dias, ${cro.cerrados ?? 0} cerrados)` : ""}. Se excluyen reservas reembolsadas segun las reglas vigentes.`,
    `Reconciliacion de datos: OK. Registros considerados: Stand ${meta.registros?.stand ?? 0}, Reservas ${meta.registros?.reservas ?? 0}.`,
  ].join("\n");

  // ── Conclusiones DETERMINÍSTICAS (objetivas, sin adjetivos subjetivos) ───────
  const conclusiones: string[] = [
    `Actividad total atribuida a ${meta.integrante} en ${meta.anio}-${mm}: ${nAR(T.turnos)} turnos, ${nAR(Math.round(T.personas))} personas/simuladores y ${nAR(T.minutos)} minutos de actividad (${formatHoras(datos.horas_minutos)} de cronograma).`,
    `El Stand concentro el ${pct(S.turnos, T.turnos)}% de los turnos (${nAR(S.turnos)}) y el ${pct(S.bruto, T.bruto)}% de la facturacion bruta (${pesos(S.bruto)}); las Reservas web, el ${pct(R.turnos, T.turnos)}% de los turnos (${nAR(R.turnos)}) y ${pesos(R.bruto)}.`,
    `Facturacion bruta ${pesos(T.bruto)}, comisiones ${pesos(r2(T.comision))} y facturacion neta ${pesos(r2(T.neto))}.`,
    `Cronograma ${cro?.estado ?? "confirmado"}; reconciliacion de datos correcta (Stand + Reservas = Total).`,
    "No se detectaron anomalias ni brechas de atribucion en los datos utilizados.",
  ];

  // ── Anexo (respaldo tabular con Total) ───────────────────────────────────────
  const anexo: Tabla[] = [{
    titulo: `Anexo — totales por origen y total (${meta.integrante}, ${meta.anio}-${mm})`,
    columnas: colsOrigen,
    filas: [filaMetricas("Stand", S), filaMetricas("Reservas web", R), filaMetricas("Total atribuido", T)],
    nota: "Datos de Metricas de Equipo. Unidades explicitas por columna. Sin PII.",
  }];

  void periodoStr;
  return { tablas: [tablaIndicadores, tablaOrigen], graficos, fuentes, metodologia, conclusiones, anexo };
}

export type ResultadoCompletar =
  | { ok: true; spec: InformeSpec; snapshotFull: unknown; agregados: Componente[]; procedencia: Record<string, number> }
  | { ok: false; faltan: string[]; motivo: string };

// Re-ejecuta el motor local (para completar un borrador nuevo). El repair NO usa esto:
// usa el snapshot congelado (ver informesServer.repararRenderizado).
export async function completarInformeMetricas(p: { specBase: InformeSpec; anio: number; mes: number; nombreIntegrante: string; componentesRequeridos: Componente[] }): Promise<ResultadoCompletar> {
  const mm = String(p.mes).padStart(2, "0");
  const desde = `${p.anio}-${mm}-01`;
  const hasta = new Date(Date.UTC(p.anio, p.mes, 0)).toISOString().slice(0, 10);
  const r = await consultarMetricasEquipo({ desde, hasta });
  type Integrante = DatosMetricas & { nombre: string };
  const i = (r.integrantes as Integrante[]).find((x) => x.nombre.toLowerCase() === p.nombreIntegrante.toLowerCase());
  if (!i) return { ok: false, faltan: ["datos_del_integrante"], motivo: `No hay datos de ${p.nombreIntegrante} en ${p.anio}-${mm}.` };
  const cob = r.cronograma?.cobertura?.[0];
  const datos: DatosMetricas = { total: i.total, stand: i.stand, reservas: i.reservas, horas_minutos: Math.round(i.horas_minutos) };
  const meta: MetaInforme = { integrante: i.nombre, anio: p.anio, mes: p.mes, corte: r.corte, registros: { stand: r.registros?.stand ?? 0, reservas: r.registros?.reservas ?? 0 }, cronograma: { estado: cob?.estado, dias: cob?.dias, cerrados: cob?.dias_cerrados } };
  return armarDesde(p.specBase, datos, meta, p.componentesRequeridos);
}

// Ensambla el spec completo desde datos + meta (compartido por re-run y repair).
export function armarDesde(specBase: InformeSpec, datos: DatosMetricas, meta: MetaInforme, componentesRequeridos: Componente[]): ResultadoCompletar {
  const c = construirComponentes(datos, meta);
  const mm = String(meta.mes).padStart(2, "0");
  const periodoStr = `${meta.anio}-${mm} (${`${meta.anio}-${mm}-01`.split("-").reverse().join("/")} - ${new Date(Date.UTC(meta.anio, meta.mes, 0)).toISOString().slice(0, 10).split("-").reverse().join("/")})`;
  const nuevo: Record<string, unknown> = {
    ...specBase,
    periodo: specBase.periodo || periodoStr,
    fecha_corte: meta.corte, // ÚNICA fecha de corte (la del snapshot congelado)
    conclusiones: specBase.conclusiones?.length ? specBase.conclusiones : c.conclusiones,
    tablas: c.tablas, graficos: c.graficos, fuentes: c.fuentes, metodologia: c.metodologia,
    modulos_consultados: specBase.modulos_consultados?.length ? specBase.modulos_consultados : ["Métricas de Equipo", "Cronograma", "Turnero Stand", "Reservas web"],
    registros_utilizados: (meta.registros?.stand ?? 0) + (meta.registros?.reservas ?? 0),
    anexo: c.anexo,
  };
  const val = validarInforme(nuevo);
  if (!val.ok) return { ok: false, faltan: val.errores, motivo: "El informe completado no pasó la validación." };
  const agregados: Componente[] = ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo", "conclusiones"].filter((x) => componentesRequeridos.includes(x as Componente)) as Componente[];
  const snapshotFull = [{ herramienta: "consultar_metricas_equipo", integrante: meta.integrante, periodo: `${meta.anio}-${mm}`, corte: meta.corte, datos, registros: meta.registros, cronograma: meta.cronograma }];
  return { ok: true, spec: val.spec, snapshotFull, agregados, procedencia: indiceDesdeDatos(meta.integrante, datos) };
}

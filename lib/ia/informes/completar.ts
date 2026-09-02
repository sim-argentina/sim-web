// IA SIM · Bloque 4C.2 — Completado DETERMINÍSTICO de un informe mensual de métricas
// de un integrante, usando SOLO el motor real (consultarMetricasEquipo). No consume Claude.
// Construye tablas, gráficos, fuentes, metodología y anexo desde los datos reconciliados,
// conservando unidad, período, integrante y origen. No inventa métricas ausentes.

import type { InformeSpec, Tabla, Grafico, Fuente, CeldaValor } from "@/lib/ia/informes/schema";
import { validarInforme } from "@/lib/ia/informes/schema";
import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";
import { formatHoras } from "@/lib/cronograma";
import type { Componente } from "@/lib/ia/informes/requisitos";
import { indiceDesdeDatos } from "@/lib/ia/informes/procedencia";

type Metricas = { turnos: number; personas: number; operaciones: number; minutos: number; bruto: number; comision: number; neto: number };
type Integrante = { nombre: string; archivado: boolean; horas_minutos: number; total: Metricas; stand: Metricas; reservas: Metricas };

const r2 = (n: number) => Math.round(n * 100) / 100;

export type ResultadoCompletar =
  | { ok: true; spec: InformeSpec; snapshotFull: unknown; agregados: Componente[]; procedencia: Record<string, number> }
  | { ok: false; faltan: string[]; motivo: string };

export async function completarInformeMetricas(p: { specBase: InformeSpec; anio: number; mes: number; nombreIntegrante: string; componentesRequeridos: Componente[] }): Promise<ResultadoCompletar> {
  const mm = String(p.mes).padStart(2, "0");
  const desde = `${p.anio}-${mm}-01`;
  const hasta = new Date(Date.UTC(p.anio, p.mes, 0)).toISOString().slice(0, 10);
  const r = await consultarMetricasEquipo({ desde, hasta });
  const i = (r.integrantes as Integrante[]).find((x) => x.nombre.toLowerCase() === p.nombreIntegrante.toLowerCase());
  if (!i) return { ok: false, faltan: ["datos_del_integrante"], motivo: `No hay datos de ${p.nombreIntegrante} en ${p.anio}-${mm}.` };

  const periodoStr = `${p.anio}-${mm} (${desde.split("-").reverse().join("/")} – ${hasta.split("-").reverse().join("/")})`;
  const cob = r.cronograma?.cobertura?.[0];
  const fuenteBase = `Métricas de Equipo · ${p.anio}-${mm}`;

  // ── 7.1 Tabla de indicadores principales (solo métricas disponibles, con unidad) ──
  const indicadores: Array<{ etiqueta: string; valor: string; unidad: string }> = [
    { etiqueta: "Horas de cronograma", valor: formatHoras(i.horas_minutos), unidad: "h" },
    { etiqueta: "Turnos", valor: String(i.total.turnos), unidad: "turnos" },
    { etiqueta: "Personas/simuladores", valor: String(i.total.personas), unidad: "personas" },
    { etiqueta: "Operaciones", valor: String(r2(i.total.operaciones)), unidad: "operaciones" },
    { etiqueta: "Minutos de actividad", valor: i.total.minutos.toLocaleString("es-AR"), unidad: "min" },
    { etiqueta: "Facturación bruta", valor: `$ ${i.total.bruto.toLocaleString("es-AR")}`, unidad: "ARS" },
    { etiqueta: "Comisiones", valor: `$ ${i.total.comision.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, unidad: "ARS" },
    { etiqueta: "Facturación neta", valor: `$ ${i.total.neto.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, unidad: "ARS" },
  ];
  const tablaIndicadores: Tabla = {
    titulo: `Indicadores de ${i.nombre} — ${p.anio}-${mm}`,
    columnas: [{ clave: "ind", etiqueta: "Indicador", tipo: "texto" }, { clave: "val", etiqueta: "Valor", tipo: "texto" }, { clave: "uni", etiqueta: "Unidad", tipo: "texto" }],
    filas: indicadores.map((x) => [x.etiqueta, x.valor, x.unidad] as CeldaValor[]),
    nota: `Fuente: ${fuenteBase} (consultar_metricas_equipo). Atribuido por mes de servicio; no altera Finanzas.`,
  };

  // ── 7.2 Tabla por origen (Stand / Reservas), métricas numéricas tipadas ──────
  const tablaOrigen: Tabla = {
    titulo: `Desglose por origen — ${i.nombre} (${p.anio}-${mm})`,
    columnas: [
      { clave: "origen", etiqueta: "Origen", tipo: "texto" },
      { clave: "turnos", etiqueta: "Turnos", tipo: "entero" },
      { clave: "personas", etiqueta: "Personas", tipo: "entero" },
      { clave: "operaciones", etiqueta: "Operaciones", tipo: "decimal" },
      { clave: "minutos", etiqueta: "Minutos", tipo: "minutos" },
      { clave: "bruto", etiqueta: "Facturación bruta", tipo: "ars" },
      { clave: "comision", etiqueta: "Comisiones", tipo: "ars" },
      { clave: "neto", etiqueta: "Facturación neta", tipo: "ars" },
    ],
    filas: [
      ["Stand", i.stand.turnos, Math.round(i.stand.personas), r2(i.stand.operaciones), i.stand.minutos, i.stand.bruto, r2(i.stand.comision), r2(i.stand.neto)],
      ["Reservas web", i.reservas.turnos, Math.round(i.reservas.personas), r2(i.reservas.operaciones), i.reservas.minutos, i.reservas.bruto, r2(i.reservas.comision), r2(i.reservas.neto)],
    ] as CeldaValor[][],
    nota: "Stand y Reservas se cuentan por separado y reconcilian con el total. Finanzas no modela comisión de Reservas (0).",
  };

  // ── 7.3 Gráficos (unidades no mezcladas) ─────────────────────────────────────
  const graficos: Grafico[] = [
    { tipo: "barras", titulo: "Turnos por origen", categorias: ["Stand", "Reservas"], series: [{ nombre: "Turnos", valores: [i.stand.turnos, i.reservas.turnos], unidad: "turnos" }], nota: `Fuente: ${fuenteBase}. Unidad: turnos.` },
    { tipo: "barras", titulo: "Facturación bruta por origen", categorias: ["Stand", "Reservas"], series: [{ nombre: "Facturación bruta", valores: [i.stand.bruto, i.reservas.bruto], unidad: "ARS" }], nota: `Fuente: ${fuenteBase}. Unidad: ARS (pesos).` },
  ];

  // ── 7.4 Fuentes (vinculadas automáticamente desde la ejecución de la tool) ───
  const registros = (r.registros?.stand ?? 0) + (r.registros?.reservas ?? 0);
  const fuentes: Fuente[] = [
    { modulo: fuenteBase, periodo: `${p.anio}-${mm}`, registros, actualizado: r.corte },
    { modulo: "Cronograma (jornadas + cobertura)", periodo: `${p.anio}-${mm}`, registros: null, actualizado: cob?.estado ?? null },
    { modulo: "Turnero Stand", periodo: `${p.anio}-${mm}`, registros: r.registros?.stand ?? null, actualizado: null },
    { modulo: "Reservas web", periodo: `${p.anio}-${mm}`, registros: r.registros?.reservas ?? null, actualizado: null },
  ];

  // ── 7.5 Metodología (reglas reales del motor; nada inventado) ─────────────────
  const metodologia = [
    `Período analizado: ${periodoStr}. Fecha/hora de corte: ${r.corte} (${r.zonaHoraria ?? "America/Argentina/Cordoba"}).`,
    `Atribución por MES DE SERVICIO (no por mes de cobro; no altera Finanzas). Se atribuye al integrante presente según el cronograma CONFIRMADO; ante simultaneidad, la actividad se reparte entre los integrantes presentes.`,
    `Se separan dos orígenes: Turnero Stand y Reservas web (se cuentan una sola vez cada uno; reconcilian con el total).`,
    `Unidades: horas de cronograma (h; en minutos internamente), turnos (personas × minutos ÷ 15), personas/simuladores, operaciones, minutos de actividad, y pesos argentinos (ARS) para facturación.`,
    `Facturación: bruta, comisiones y neta (neta = bruta − comisiones). Finanzas no modela comisión de Reservas web (queda en 0; no se inventa).`,
    `Cronograma del mes: estado ${cob?.estado ?? "—"} (${cob?.dias ?? "—"} días, ${cob?.dias_cerrados ?? 0} cerrados). Se excluyen reservas reembolsadas según las reglas vigentes.`,
    `Reconciliación de datos: ${r.reconciliacion?.ok ? "OK" : "con observaciones"}. Registros considerados: Stand ${r.registros?.stand ?? 0}, Reservas ${r.registros?.reservas ?? 0}.`,
  ].join("\n");

  // ── 7.6 Anexo (respaldo tabular, mismas cifras reconciliadas) ─────────────────
  const anexo: Tabla[] = [{
    titulo: `Anexo — totales por origen y total (${i.nombre}, ${p.anio}-${mm})`,
    columnas: tablaOrigen.columnas,
    filas: [
      ...tablaOrigen.filas,
      ["Total atribuido", i.total.turnos, Math.round(i.total.personas), r2(i.total.operaciones), i.total.minutos, i.total.bruto, r2(i.total.comision), r2(i.total.neto)],
    ] as CeldaValor[][],
    nota: `Datos de ${fuenteBase}. Unidades explícitas por columna. Sin PII.`,
  }];

  // Combinar con el spec base, conservando lo que el modelo ya escribió (resumen/secciones).
  const nuevo: Record<string, unknown> = {
    ...p.specBase,
    periodo: p.specBase.periodo || periodoStr,
    fecha_corte: p.specBase.fecha_corte || r.corte,
    tablas: [tablaIndicadores, tablaOrigen],
    graficos,
    fuentes,
    metodologia: p.specBase.metodologia || metodologia,
    modulos_consultados: p.specBase.modulos_consultados?.length ? p.specBase.modulos_consultados : ["Métricas de Equipo", "Cronograma", "Stand", "Reservas web"],
    registros_utilizados: registros,
    anexo,
  };

  const val = validarInforme(nuevo);
  if (!val.ok) return { ok: false, faltan: val.errores, motivo: "El informe completado no pasó la validación." };

  const agregados: Componente[] = ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo"].filter((c) => p.componentesRequeridos.includes(c as Componente)) as Componente[];
  // snapshot COMPLETO (para reconciliación con procedencia) + índice.
  const snapshotFull = [{ herramienta: "consultar_metricas_equipo", integrante: i.nombre, periodo: `${p.anio}-${mm}`, corte: r.corte, datos: { total: i.total, stand: i.stand, reservas: i.reservas, horas_minutos: Math.round(i.horas_minutos) }, registros: r.registros }];
  const procedencia = indiceDesdeDatos(i.nombre, { total: i.total, stand: i.stand, reservas: i.reservas, horas_minutos: i.horas_minutos });
  return { ok: true, spec: val.spec, snapshotFull, agregados, procedencia };
}

// IA SIM · Bloque 5B — Contrato y VALIDACIÓN del plan analítico interno. Puro (sin DB).
//
// El modelo nunca escribe SQL ni nombra tablas/columnas: propone un plan con identificadores de
// las listas CERRADAS del catálogo semántico. Este módulo lo valida contra ese catálogo y lo
// RECONSTRUYE desde cero —lo que venga de más se descarta—; el ejecutor recién trabaja sobre un
// plan ya validado. Si el plan es inválido devuelve un error ESTRUCTURADO, nunca una ejecución
// parcial ni aproximada.
//
// Dos clases de rechazo, porque no se arreglan igual:
//  · reparable  → el modelo puede corregir el plan y reintentar (una métrica que no existe, una
//    agrupación incompatible, un rango absurdo).
//  · aclaración → falta una decisión del administrador y hay que preguntarle UNA sola cosa
//    concreta ("¿el mejor según qué?"). No se adivina ni se ejecuta algo parecido.

import { resolverMesRelativo, ventanaHoy, ventanaAyer, ventanaEstaSemana, ventanaSemanaPasada, ventanaEsteAnio, ventanaAnioPasado } from "@/lib/ia/analisis/periodoRelativo";
import { ventanaMes } from "@/lib/ia/analisis/periodos";
import { FUENTES_FACTURACION } from "@/lib/facturacionFuentes";
import { MODALIDADES } from "@/lib/minutosComerciales";
import {
  METRICAS_SEMANTICAS, METRICAS_IDS, METRICAS_DERIVADAS, MAX_METRICAS,
  DIMENSIONES, DIMENSIONES_VALIDAS, MAX_DIMENSIONES, type Dimension,
  FILTROS_VALIDOS, type FiltroId,
  CALCULOS_VALIDOS, type Calculo,
  ORDENES, type Orden,
  SENTIDOS_RANKING, type SentidoRanking,
  TIPOS_SEGMENTACION, type TipoSegmentacion, CLASES_FACTURACION,
  LIMITE_MAX, LIMITE_DEFAULT, RANGO_MAX_DIAS,
  type Universo,
  universoComun, dimensionCompatible, filtroCompatible, calculoCompatible, parDimensionesCompatible,
} from "@/lib/ia/analisis/catalogoSemantico";

export { METRICAS_SEMANTICAS, METRICAS_IDS, DIMENSIONES_VALIDAS, CALCULOS_VALIDOS, LIMITE_MAX, LIMITE_DEFAULT, RANGO_MAX_DIAS, MAX_METRICAS, MAX_DIMENSIONES };
export type { Dimension, Calculo, Orden, Universo };

// Nombres que ya importaban otras partes del sistema (4E/5A): se conservan.
export const METRICAS_DERIVADAS_A_OTRA_HERRAMIENTA = METRICAS_DERIVADAS;
export const FUENTES_ACTIVIDAD = ["stand", "reservas"] as const;
export type FuenteActividad = (typeof FUENTES_ACTIVIDAD)[number];

export type VentanaPlan = { desde: string; hasta: string };

export type SegmentacionPlan = {
  tipo: TipoSegmentacion;
  grupoA: string[];
  grupoB: string[];
  etiquetaA: string;
  etiquetaB: string;
};

export type FiltrosPlan = {
  diasSemana: number[] | null; // ISO 1=lunes .. 7=domingo
  fuentes: string[] | null;
  clases: string[] | null;
  metodosPago: string[] | null;
  modalidades: string[] | null;
  duraciones: number[] | null;
  simuladores: number[] | null;
};

export type PlanAnalitico = {
  metricas: string[];
  universo: Universo;
  ventana: VentanaPlan;
  filtros: FiltrosPlan;
  dimensiones: Dimension[];
  segmentacion: SegmentacionPlan | null;
  calculos: Calculo[];
  orden: Orden;
  limite: number;
  ranking: { sentido: SentidoRanking; n: number } | null;
};

export type PlanInvalido = { ok: false; error: string; campo?: string; aclaracion?: boolean };
export type PlanValido = { ok: true; plan: PlanAnalitico };

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_MES = /^\d{4}-\d{2}$/;
// Método de pago: texto corto y acotado. Nunca se interpola en SQL (el filtro se aplica en
// memoria sobre eventos ya leídos), pero se valida igual para no arrastrar basura.
const RE_METODO = /^[a-zA-Z0-9 _\-áéíóúñÁÉÍÓÚÑ]{1,40}$/;

const DIAS_TEXTO: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6, domingo: 7,
};
// Atajos que el modelo puede usar tal como los dice el administrador.
const DIAS_GRUPO: Record<string, number[]> = {
  habiles: [1, 2, 3, 4, 5], hábiles: [1, 2, 3, 4, 5], entre_semana: [1, 2, 3, 4, 5], semana: [1, 2, 3, 4, 5],
  fin_de_semana: [6, 7], finde: [6, 7], fin_semana: [6, 7],
};
const DIAS_ISO_NOMBRE = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const conMayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(5, 7)) - 1, Number(desde.slice(8, 10)));
  const b = Date.UTC(Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7)) - 1, Number(hasta.slice(8, 10)));
  return Math.round((b - a) / 86_400_000) + 1;
}

function fechaValida(f: unknown): f is string {
  if (typeof f !== "string" || !RE_FECHA.test(f)) return false;
  const [a, m, d] = f.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(a, m - 1, d));
  return probe.getUTCFullYear() === a && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// Resuelve el período pedido a una ventana concreta de fechas (Córdoba, reloj inyectable).
export function resolverVentana(periodo: Record<string, unknown> | undefined, ahora: Date = new Date()): VentanaPlan | PlanInvalido {
  const p = periodo ?? {};
  const tipo = typeof p.tipo === "string" ? p.tipo : undefined;

  if (tipo === "mes" || (typeof p.mes === "string" && !tipo)) {
    const mes = String(p.mes ?? "");
    if (!RE_MES.test(mes)) return { ok: false, error: `Mes inválido: "${mes}". Usá "YYYY-MM".`, campo: "periodo.mes" };
    const [anio, m] = mes.split("-").map(Number);
    if (m < 1 || m > 12 || anio < 2020 || anio > 2100) return { ok: false, error: `Mes fuera de rango: "${mes}".`, campo: "periodo.mes" };
    return ventanaMes(anio, m);
  }

  if (tipo === "relativo" || typeof p.relativo === "string") {
    const token = String(p.relativo ?? "");
    if (token === "este_mes" || token === "mes_pasado" || token === "mismo_mes_anio_pasado") {
      const { anio, mes } = resolverMesRelativo(token, ahora);
      return ventanaMes(anio, mes);
    }
    if (token === "hoy") return ventanaHoy(ahora);
    if (token === "ayer") return ventanaAyer(ahora);
    if (token === "esta_semana") return ventanaEstaSemana(ahora);
    if (token === "semana_pasada") return ventanaSemanaPasada(ahora);
    if (token === "este_anio") return ventanaEsteAnio(ahora);
    if (token === "anio_pasado") return ventanaAnioPasado(ahora);
    return { ok: false, error: `Período relativo desconocido: "${token}".`, campo: "periodo.relativo" };
  }

  if (fechaValida(p.desde) && fechaValida(p.hasta)) {
    const desde = String(p.desde), hasta = String(p.hasta);
    if (hasta < desde) return { ok: false, error: "El fin del rango es anterior al inicio.", campo: "periodo" };
    const n = diasEntre(desde, hasta);
    if (n > RANGO_MAX_DIAS) return { ok: false, error: `El rango pedido (${n} días) supera el máximo de ${RANGO_MAX_DIAS} días.`, campo: "periodo" };
    return { desde, hasta };
  }

  return { ok: false, error: '¿De qué período? Usá {"mes":"YYYY-MM"}, {"desde":"YYYY-MM-DD","hasta":"YYYY-MM-DD"} o {"relativo":"este_mes"}.', campo: "periodo", aclaracion: true };
}

const esInvalido = (x: unknown): x is PlanInvalido => typeof x === "object" && x !== null && (x as PlanInvalido).ok === false;

function normalizarDiasSemana(raw: unknown, campo: string): number[] | null | PlanInvalido {
  if (raw == null) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  if (arr.length === 0) return null;
  const out: number[] = [];
  for (const v of arr) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7) { out.push(v); continue; }
    if (typeof v === "string") {
      const clave = v.trim().toLowerCase();
      if (DIAS_GRUPO[clave]) { out.push(...DIAS_GRUPO[clave]); continue; }
      if (DIAS_TEXTO[clave] != null) { out.push(DIAS_TEXTO[clave]); continue; }
      const n = Number(clave);
      if (Number.isInteger(n) && n >= 1 && n <= 7) { out.push(n); continue; }
    }
    return { ok: false, error: `Día de la semana inválido: ${JSON.stringify(v)}. Usá 1..7 (1=lunes), el nombre del día o "habiles"/"fin_de_semana".`, campo };
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function normalizarLista(raw: unknown, permitidos: readonly string[] | null, campo: string, forma: RegExp = RE_METODO): string[] | null | PlanInvalido {
  if (raw == null) return null;
  const arr = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim()).filter(Boolean);
  if (arr.length === 0) return null;
  for (const v of arr) {
    if (permitidos && !permitidos.includes(v)) {
      return { ok: false, error: `Valor no permitido en ${campo}: "${v}". Permitidos: ${permitidos.join(", ")}.`, campo };
    }
    if (!permitidos && !forma.test(v)) {
      return { ok: false, error: `Valor inválido en ${campo}: "${v}".`, campo };
    }
  }
  return [...new Set(arr)];
}

function normalizarEnteros(raw: unknown, campo: string, max: number): number[] | null | PlanInvalido {
  if (raw == null) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  if (arr.length === 0) return null;
  const out: number[] = [];
  for (const v of arr) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      return { ok: false, error: `Valor inválido en ${campo}: ${JSON.stringify(v)}. Usá enteros de 1 a ${max}.`, campo };
    }
    out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// ── Métricas ────────────────────────────────────────────────────────────────────
function normalizarMetricas(input: Record<string, unknown>): string[] | PlanInvalido {
  const crudo = input.metricas ?? input.metrica;
  const arr = (Array.isArray(crudo) ? crudo : crudo == null ? [] : [crudo]).map((v) => String(v).trim()).filter(Boolean);
  if (arr.length === 0) {
    return {
      ok: false,
      error: `¿Qué querés medir? Puedo con: ${METRICAS_IDS.map((id) => METRICAS_SEMANTICAS[id].etiqueta.toLowerCase()).join(", ")}.`,
      campo: "metricas",
      aclaracion: true,
    };
  }
  if (arr.length > MAX_METRICAS) {
    return { ok: false, error: `Demasiadas métricas (${arr.length}). El máximo es ${MAX_METRICAS} por consulta.`, campo: "metricas" };
  }
  for (const id of arr) {
    if (METRICAS_SEMANTICAS[id]) continue;
    const derivada = METRICAS_DERIVADAS[id];
    if (derivada) return { ok: false, error: derivada, campo: "metricas" };
    return { ok: false, error: `Métrica no disponible: "${id}". Disponibles: ${METRICAS_IDS.join(", ")}.`, campo: "metricas" };
  }
  return [...new Set(arr)];
}

// ── Dimensiones ─────────────────────────────────────────────────────────────────
function normalizarDimensiones(input: Record<string, unknown>, metricas: string[]): Dimension[] | PlanInvalido {
  const crudo = input.dimensiones ?? input.agrupar_por;
  const arr = (Array.isArray(crudo) ? crudo : crudo == null ? [] : [crudo])
    .map((v) => String(v).trim())
    .filter((v) => v && v !== "ninguno");
  if (arr.length > MAX_DIMENSIONES) {
    return { ok: false, error: `Demasiadas agrupaciones (${arr.length}). El máximo es ${MAX_DIMENSIONES}.`, campo: "dimensiones" };
  }
  const out: Dimension[] = [];
  for (const d of arr) {
    if (!DIMENSIONES_VALIDAS.includes(d as Dimension)) {
      return { ok: false, error: `Agrupación no permitida: "${d}". Permitidas: ${DIMENSIONES_VALIDAS.join(", ")}.`, campo: "dimensiones" };
    }
    const inc = dimensionCompatible(metricas, d as Dimension);
    if (inc) return { ok: false, error: inc.motivo, campo: inc.campo };
    out.push(d as Dimension);
  }
  const unicas = [...new Set(out)];
  const par = parDimensionesCompatible(unicas);
  if (par) return { ok: false, error: par.motivo, campo: par.campo };
  return unicas;
}

// ── Filtros ─────────────────────────────────────────────────────────────────────
function normalizarFiltros(input: Record<string, unknown>, metricas: string[], universo: Universo): FiltrosPlan | PlanInvalido {
  const raw = (input.filtros ?? {}) as Record<string, unknown>;

  // Un filtro que no está en el catálogo se RECHAZA en vez de ignorarse: si el modelo cree que
  // filtró por empleado, tiene que enterarse de que no.
  for (const clave of Object.keys(raw)) {
    if (raw[clave] == null) continue;
    if (!FILTROS_VALIDOS.includes(clave as FiltroId)) {
      if (/^(empleado|empleado_id|integrante|persona|vendedor)$/.test(clave)) {
        return {
          ok: false,
          error:
            "No puedo atribuirle ventas ni turnos a una persona: estar en el cronograma no demuestra que haya tomado esa venta, y en los datos no hay un vínculo autoritativo entre empleado y operación. Sí puedo darte las horas programadas por empleado (consultar_metricas_equipo o consultar_cronograma) y, por separado, la actividad o la facturación del local.",
          campo: "filtros.empleado",
        };
      }
      return { ok: false, error: `Filtro no permitido: "${clave}". Permitidos: ${FILTROS_VALIDOS.join(", ")}.`, campo: "filtros" };
    }
    const inc = filtroCompatible(metricas, clave as FiltroId);
    if (inc) return { ok: false, error: inc.motivo, campo: inc.campo };
  }

  const diasSemana = normalizarDiasSemana(raw.dias_semana, "filtros.dias_semana");
  if (esInvalido(diasSemana)) return diasSemana;

  const fuentesPermitidas = universo === "facturacion" ? FUENTES_FACTURACION : FUENTES_ACTIVIDAD;
  const fuentes = normalizarLista(raw.fuente, fuentesPermitidas, "filtros.fuente");
  if (esInvalido(fuentes)) return fuentes;

  const clases = normalizarLista(raw.clase, CLASES_FACTURACION, "filtros.clase");
  if (esInvalido(clases)) return clases;

  const metodosPago = normalizarLista(raw.metodo_pago, null, "filtros.metodo_pago");
  if (esInvalido(metodosPago)) return metodosPago;

  const modalidades = normalizarLista(raw.modalidad, MODALIDADES, "filtros.modalidad");
  if (esInvalido(modalidades)) return modalidades;

  const duraciones = normalizarEnteros(raw.duracion, "filtros.duracion", 600);
  if (esInvalido(duraciones)) return duraciones;

  const simuladores = normalizarEnteros(raw.simuladores, "filtros.simuladores", 20);
  if (esInvalido(simuladores)) return simuladores;

  return {
    diasSemana: diasSemana as number[] | null,
    fuentes: fuentes as string[] | null,
    clases: clases as string[] | null,
    metodosPago: metodosPago as string[] | null,
    modalidades: modalidades as string[] | null,
    duraciones: duraciones as number[] | null,
    simuladores: simuladores as number[] | null,
  };
}

// ── Segmentación en dos grupos ──────────────────────────────────────────────────
function etiquetaGrupoDias(dias: number[]): string {
  const clave = dias.join(",");
  if (clave === "1,2,3,4,5") return "Lunes a viernes";
  if (clave === "6,7") return "Sábados y domingos";
  if (dias.length === 1) return conMayuscula(DIAS_ISO_NOMBRE[dias[0]]);
  const contiguos = dias.length === dias[dias.length - 1] - dias[0] + 1;
  if (contiguos) return conMayuscula(`${DIAS_ISO_NOMBRE[dias[0]]} a ${DIAS_ISO_NOMBRE[dias[dias.length - 1]]}`);
  return conMayuscula(dias.map((d) => DIAS_ISO_NOMBRE[d]).join(", "));
}

function normalizarSegmentacion(input: Record<string, unknown>, metricas: string[], universo: Universo): SegmentacionPlan | null | PlanInvalido {
  const raw = input.segmentacion as Record<string, unknown> | undefined;
  if (raw == null) return null;

  const tipo = String(raw.tipo ?? "").trim();
  if (!TIPOS_SEGMENTACION.includes(tipo as TipoSegmentacion)) {
    return { ok: false, error: `Segmentación no permitida: "${tipo}". Permitidas: ${TIPOS_SEGMENTACION.join(", ")}.`, campo: "segmentacion.tipo" };
  }
  const t = tipo as TipoSegmentacion;

  const inc = filtroCompatible(metricas, t);
  if (inc) return { ok: false, error: inc.motivo, campo: "segmentacion.tipo" };

  if (t === "dias_semana") {
    const a = normalizarDiasSemana(raw.grupo_a, "segmentacion.grupo_a");
    if (esInvalido(a)) return a;
    const b = normalizarDiasSemana(raw.grupo_b, "segmentacion.grupo_b");
    if (esInvalido(b)) return b;
    if (!a || !b) return { ok: false, error: "La segmentación por días necesita los dos grupos.", campo: "segmentacion" };
    const solapan = (a as number[]).filter((d) => (b as number[]).includes(d));
    if (solapan.length > 0) {
      return { ok: false, error: `Los dos grupos comparten días (${solapan.map((d) => DIAS_ISO_NOMBRE[d]).join(", ")}): con días repetidos el total se contaría dos veces.`, campo: "segmentacion" };
    }
    return {
      tipo: t,
      grupoA: (a as number[]).map(String),
      grupoB: (b as number[]).map(String),
      etiquetaA: etiquetaGrupoDias(a as number[]),
      etiquetaB: etiquetaGrupoDias(b as number[]),
    };
  }

  const permitidos = t === "clase" ? CLASES_FACTURACION : universo === "facturacion" ? FUENTES_FACTURACION : FUENTES_ACTIVIDAD;
  const a = normalizarLista(raw.grupo_a, permitidos, "segmentacion.grupo_a");
  if (esInvalido(a)) return a;
  const b = normalizarLista(raw.grupo_b, permitidos, "segmentacion.grupo_b");
  if (esInvalido(b)) return b;
  if (!a || !b) return { ok: false, error: "La segmentación necesita los dos grupos.", campo: "segmentacion" };
  const solapan = (a as string[]).filter((v) => (b as string[]).includes(v));
  if (solapan.length > 0) {
    return { ok: false, error: `Los dos grupos comparten ${solapan.join(", ")}: con valores repetidos el total se contaría dos veces.`, campo: "segmentacion" };
  }
  const nombre = (vs: string[]) => vs.map((v) => (v === "automatico" ? "Automático" : v === "manual" ? "Manual" : v)).join(" + ");
  return { tipo: t, grupoA: a as string[], grupoB: b as string[], etiquetaA: nombre(a as string[]), etiquetaB: nombre(b as string[]) };
}

// ── Validación completa ─────────────────────────────────────────────────────────
export function validarPlan(input: Record<string, unknown>, ahora: Date = new Date()): PlanValido | PlanInvalido {
  const metricas = normalizarMetricas(input);
  if (esInvalido(metricas)) return metricas;

  const universo = universoComun(metricas as string[]);
  if (typeof universo === "object") return { ok: false, error: universo.motivo, campo: universo.campo };

  const ventana = resolverVentana(input.periodo as Record<string, unknown> | undefined, ahora);
  if (esInvalido(ventana)) return ventana;

  const filtros = normalizarFiltros(input, metricas as string[], universo);
  if (esInvalido(filtros)) return filtros;

  const dimensiones = normalizarDimensiones(input, metricas as string[]);
  if (esInvalido(dimensiones)) return dimensiones;

  const segmentacion = normalizarSegmentacion(input, metricas as string[], universo);
  if (esInvalido(segmentacion)) return segmentacion;

  // Cálculos. El total va siempre: es lo mínimo que se espera de cualquier consulta.
  const calcCrudo = input.calculos;
  const calcArr = (Array.isArray(calcCrudo) ? calcCrudo : calcCrudo == null ? [] : [calcCrudo]).map((v) => String(v).trim()).filter(Boolean);
  const calculos: Calculo[] = [];
  for (const c of calcArr) {
    if (!CALCULOS_VALIDOS.includes(c as Calculo)) {
      return { ok: false, error: `Cálculo no permitido: "${c}". Permitidos: ${CALCULOS_VALIDOS.join(", ")}.`, campo: "calculos" };
    }
    const inc = calculoCompatible(c as Calculo, { dimensiones: (dimensiones as Dimension[]).length, segmentado: segmentacion != null });
    if (inc) return { ok: false, error: inc.motivo, campo: inc.campo, aclaracion: inc.motivo.includes("decime") };
    if (!calculos.includes(c as Calculo)) calculos.push(c as Calculo);
  }
  if (!calculos.includes("total")) calculos.unshift("total");

  const ordenRaw = String(input.orden ?? "").trim();
  let orden: Orden = (dimensiones as Dimension[]).some((d) => DIMENSIONES[d].temporal) ? "cronologico" : "mayor_a_menor";
  if (ordenRaw) {
    if (!ORDENES.includes(ordenRaw as Orden)) {
      return { ok: false, error: `Orden no permitido: "${ordenRaw}". Permitidos: ${ORDENES.join(", ")}.`, campo: "orden" };
    }
    orden = ordenRaw as Orden;
  }

  let limite = LIMITE_DEFAULT;
  if (input.limite != null) {
    const n = Number(input.limite);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "El límite debe ser un entero positivo.", campo: "limite" };
    if (n > LIMITE_MAX) return { ok: false, error: `El límite máximo es ${LIMITE_MAX} filas.`, campo: "limite" };
    limite = n;
  }

  // Ranking: "los cinco mejores días", "el peor día".
  let ranking: PlanAnalitico["ranking"] = null;
  const rRaw = input.ranking as Record<string, unknown> | undefined;
  if (rRaw != null) {
    const sentido = String(rRaw.sentido ?? "mejores").trim();
    if (!SENTIDOS_RANKING.includes(sentido as SentidoRanking)) {
      return { ok: false, error: `Sentido de ranking no permitido: "${sentido}". Permitidos: ${SENTIDOS_RANKING.join(", ")}.`, campo: "ranking.sentido" };
    }
    const n = rRaw.n == null ? 5 : Number(rRaw.n);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAX) {
      return { ok: false, error: `El tamaño del ranking debe ser un entero de 1 a ${LIMITE_MAX}.`, campo: "ranking.n" };
    }
    if ((dimensiones as Dimension[]).length === 0) {
      return { ok: false, error: "Un ranking necesita una agrupación: decime de qué querés el ranking (días, semanas, fuentes…).", campo: "ranking", aclaracion: true };
    }
    ranking = { sentido: sentido as SentidoRanking, n };
    if (!calculos.includes("ranking")) calculos.push("ranking");
  }

  return {
    ok: true,
    plan: {
      metricas: metricas as string[],
      universo,
      ventana: ventana as VentanaPlan,
      filtros: filtros as FiltrosPlan,
      dimensiones: dimensiones as Dimension[],
      segmentacion: segmentacion as SegmentacionPlan | null,
      calculos,
      orden,
      limite,
      ranking,
    },
  };
}

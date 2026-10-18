// Interacciones del stand — métricas PURAS (Bloque 4). Sin base ni red: la
// carga paginada vive en lib/interaccionesMetricasServer.ts y la pantalla en
// app/admin/(panel)/interacciones/analisis. Definiciones: docs/interacciones.md.
//
// Unidades que NUNCA se mezclan:
//   · interacciones   visitas/grupos registrados (no anulados);
//   · personas        suma del tamaño declarado de esos grupos;
//   · turnos          filas de turnos_stand;
//   · participaciones suma de cantidad_personas de los turnos vinculados
//                     (no son personas únicas).
// Embudo acumulativo por interacción: Miraron = miro + pregunto + subio;
// Preguntaron = pregunto + subio; Se subieron = subio. 10/5/3 → 18/8/3.
// Toda tasa lleva numerador y denominador; denominador 0 → valor null ("Sin datos").

import { diasEntre, fechaValida, sumarDias } from "@/lib/agenda";
import {
  INICIADORES, MOTIVOS, RANGOS_ETARIOS, RESPUESTAS, RESULTADOS, fechaSim,
  type EstadoVinculo, type Iniciador, type Motivo, type RangoEtario, type Respuesta, type Resultado,
} from "@/lib/interacciones";

// ── Tipos de entrada (columnas de las vistas, IDs bigint como texto) ──────
export type FilaAnalisis = {
  interaccion_id: string;
  fecha_negocio: string;
  hora_negocio: string;
  resultado: Resultado;
  personas_grupo: number;
  hombres: number | null;
  mujeres: number | null;
  rango_etario: RangoEtario | null;
  conocia_sim: Respuesta | null;
  se_subio_antes: Respuesta | null;
  iniciador: Iniciador | null;
  atendio_empleado_id: string | null;
  motivo: Motivo | null;
  vinculo_estado: EstadoVinculo;
  turnos_vinculados: number;
  turnos_activos: number;
  turnos_pagos: number;
  turnos_gratis: number;
  turnos_pago_contradictorio: number;
  participaciones: number;
  venta_verificada: boolean;
};

export type FilaCobertura = { turno_stand_id: string; fecha: string; es_pago: boolean; pago_contradictorio: boolean; vinculado: boolean };
export type EmpleadoRef = { id: string; nombre: string; activo: boolean };

// ── Tasas y comparaciones ──────────────────────────────────────────────────
export type Tasa = { num: number; den: number; valor: number | null };
export const tasa = (num: number, den: number): Tasa => ({ num, den, valor: den > 0 ? num / den : null });

/** Cantidades: diferencia absoluta y variación %. Base 0 → variacion null ("Sin base"). */
export function compararCantidad(actual: number, anterior: number) {
  return { actual, anterior, diferencia: actual - anterior, variacion: anterior > 0 ? (actual - anterior) / anterior : null };
}

/** Tasas: diferencia en PUNTOS porcentuales. Si alguna no tiene denominador → null ("Sin datos"). */
export function compararTasa(actual: Tasa, anterior: Tasa) {
  return {
    actual, anterior,
    diferencia_pp: actual.valor === null || anterior.valor === null ? null : (actual.valor - anterior.valor) * 100,
  };
}

// ── Franjas y días ─────────────────────────────────────────────────────────
// Intervalos [desde, hasta): 12:00 es de 12–14, nunca de las dos. Lo que cae
// fuera de 10–22 va a "otros" para no perder registros.
export const FRANJAS = [
  { clave: "10-12", etiqueta: "10–12", desde: 600, hasta: 720 },
  { clave: "12-14", etiqueta: "12–14", desde: 720, hasta: 840 },
  { clave: "14-16", etiqueta: "14–16", desde: 840, hasta: 960 },
  { clave: "16-18", etiqueta: "16–18", desde: 960, hasta: 1080 },
  { clave: "18-20", etiqueta: "18–20", desde: 1080, hasta: 1200 },
  { clave: "20-22", etiqueta: "20–22", desde: 1200, hasta: 1320 },
] as const;
export type ClaveFranja = (typeof FRANJAS)[number]["clave"] | "otros";
export const CLAVES_FRANJA: readonly ClaveFranja[] = [...FRANJAS.map((f) => f.clave), "otros"];

export function franjaDe(hora: string): ClaveFranja {
  const m = /^(\d{2}):(\d{2})/.exec(hora);
  if (!m) return "otros";
  const min = Number(m[1]) * 60 + Number(m[2]);
  return FRANJAS.find((f) => min >= f.desde && min < f.hasta)?.clave ?? "otros";
}

export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
/** 0 = lunes … 6 = domingo, de una fecha YYYY-MM-DD (sin zona horaria). */
export function diaSemana(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export const TAMANOS = ["1", "2", "3", "4", "5+"] as const;
export type Tamano = (typeof TAMANOS)[number];
export const tamanoDe = (n: number): Tamano => (n >= 5 ? "5+" : (String(n) as Tamano));

// ── Período e inicio del registro ──────────────────────────────────────────
export type Periodo = {
  desde: string;
  hasta: string;
  dias: number;
  /** Días con registro posible: desde el inicio hasta hoy. null = ninguno. */
  cubierto: { desde: string; hasta: string; dias: number } | null;
  estado: "sin_inicio" | "sin_registro" | "parcial" | "completo";
};

/**
 * Qué parte del período tiene registro: [max(desde, día del inicio), min(hasta, hoy)].
 * Antes del inicio no hay datos de registro (nunca se reconstruyen con ventas).
 */
export function periodo(desde: string, hasta: string, inicioRegistro: string | null, hoy: string): Periodo {
  const dias = diasEntre(desde, hasta) + 1;
  if (!inicioRegistro) return { desde, hasta, dias, cubierto: null, estado: "sin_inicio" };
  const inicio = fechaSim(new Date(inicioRegistro));
  const d = desde > inicio ? desde : inicio;
  const h = hasta < hoy ? hasta : hoy;
  if (d > h) return { desde, hasta, dias, cubierto: null, estado: "sin_registro" };
  return {
    desde, hasta, dias,
    cubierto: { desde: d, hasta: h, dias: diasEntre(d, h) + 1 },
    estado: d === desde && h === hasta ? "completo" : "parcial",
  };
}

export type ClaveRango = "hoy" | "7d" | "30d";
/** Rangos rápidos, inclusivos, en fechas de Córdoba. */
export function rangoRapido(clave: ClaveRango, hoy: string): { desde: string; hasta: string } {
  if (clave === "hoy") return { desde: hoy, hasta: hoy };
  return { desde: sumarDias(hoy, clave === "7d" ? -6 : -29), hasta: hoy };
}
/** Período anterior equivalente (misma duración, justo antes). */
export function rangoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const dias = diasEntre(desde, hasta) + 1;
  return { desde: sumarDias(desde, -dias), hasta: sumarDias(desde, -1) };
}

// ── Filtros (se aplican a las interacciones de AMBOS períodos; nunca a la cobertura) ──
export type Filtros = {
  resultado?: Resultado;
  franja?: ClaveFranja;
  rango_etario?: RangoEtario | "sin_dato";
  conocia_sim?: Respuesta | "sin_dato";
  se_subio_antes?: Respuesta | "sin_dato";
  iniciador?: Iniciador | "sin_dato";
  motivo?: Motivo | "sin_motivo";
  atendio?: string | "sin_asignar";
  tamano?: Tamano;
};
export const CLAVES_FILTRO = ["resultado", "franja", "rango_etario", "conocia_sim", "se_subio_antes", "iniciador", "motivo", "atendio", "tamano"] as const;

export function aplicarFiltros(filas: FilaAnalisis[], f: Filtros): FilaAnalisis[] {
  const igual = <T>(valor: T | null, filtro: T | "sin_dato" | "sin_motivo" | "sin_asignar" | undefined) =>
    filtro === undefined || (filtro === "sin_dato" || filtro === "sin_motivo" || filtro === "sin_asignar" ? valor === null : valor === filtro);
  return filas.filter((x) =>
    (f.resultado === undefined || x.resultado === f.resultado)
    && (f.franja === undefined || franjaDe(x.hora_negocio) === f.franja)
    && igual(x.rango_etario, f.rango_etario)
    && igual(x.conocia_sim, f.conocia_sim)
    && igual(x.se_subio_antes, f.se_subio_antes)
    && igual(x.iniciador, f.iniciador)
    && igual(x.motivo, f.motivo)
    && igual(x.atendio_empleado_id, f.atendio)
    && (f.tamano === undefined || tamanoDe(x.personas_grupo) === f.tamano));
}

// ── Embudo ─────────────────────────────────────────────────────────────────
export type Embudo = {
  interacciones: number;
  personas: number;
  tamano_promedio: number | null;
  exclusivos: Record<Resultado, number>;
  miraron: number;
  preguntaron: number;
  subieron: number;
  tasas: { miro_pregunto: Tasa; pregunto_subio: Tasa; miro_subio: Tasa };
};

export function embudo(filas: FilaAnalisis[]): Embudo {
  const exclusivos = { miro: 0, pregunto: 0, subio: 0 } as Record<Resultado, number>;
  let personas = 0;
  for (const x of filas) {
    exclusivos[x.resultado]++;
    personas += x.personas_grupo;
  }
  const miraron = exclusivos.miro + exclusivos.pregunto + exclusivos.subio;
  const preguntaron = exclusivos.pregunto + exclusivos.subio;
  const subieron = exclusivos.subio;
  return {
    interacciones: filas.length,
    personas,
    tamano_promedio: filas.length > 0 ? personas / filas.length : null,
    exclusivos, miraron, preguntaron, subieron,
    tasas: { miro_pregunto: tasa(preguntaron, miraron), pregunto_subio: tasa(subieron, preguntaron), miro_subio: tasa(subieron, miraron) },
  };
}

// ── Distribuciones con base y "sin dato" ───────────────────────────────────
export type Distribucion<T extends string> = {
  /** Interacciones consideradas (todas las del conjunto). */
  total: number;
  con_dato: number;
  sin_dato: number;
  /** Cobertura del dato: con_dato / total. */
  cobertura: Tasa;
  /** n por valor y % sobre las que tienen dato; miro_subio = tasa Miró → Se subió dentro de ese valor. */
  valores: Array<{ valor: T; n: number; pct: Tasa; miro_subio: Tasa }>;
  sin_dato_miro_subio: Tasa;
};

function distribucion<T extends string>(filas: FilaAnalisis[], lista: readonly T[], de: (x: FilaAnalisis) => T | null): Distribucion<T> {
  const total = filas.length;
  const conDato = filas.filter((x) => de(x) !== null);
  const sinDato = filas.filter((x) => de(x) === null);
  return {
    total,
    con_dato: conDato.length,
    sin_dato: sinDato.length,
    cobertura: tasa(conDato.length, total),
    valores: lista.map((valor) => {
      const grupo = conDato.filter((x) => de(x) === valor);
      return { valor, n: grupo.length, pct: tasa(grupo.length, conDato.length), miro_subio: tasa(grupo.filter((x) => x.resultado === "subio").length, grupo.length) };
    }),
    sin_dato_miro_subio: tasa(sinDato.filter((x) => x.resultado === "subio").length, sinDato.length),
  };
}

// ── Resultado completo ─────────────────────────────────────────────────────
export type ResultadoMetricas = {
  embudo: Embudo;
  vinculo: {
    subidas_declaradas: number;
    con_turno: number;
    con_turno_pago: number;
    turno_no_activo: number;
    pendientes: number;
    cerradas_sin_turno: number;
    con_pago_contradictorio: number;
    turnos_vinculados: number;
    participaciones: number;
  };
  serie: Array<{ fecha: string; interacciones: number; miraron: number; preguntaron: number; subieron: number }>;
  dias_semana: Array<{ dia: number; etiqueta: string; embudo: Embudo }>;
  franjas: Array<{ clave: ClaveFranja; etiqueta: string; embudo: Embudo }>;
  motivos: {
    base: number;
    con_motivo: number;
    sin_motivo: number;
    cobertura: Tasa;
    valores: Array<{ motivo: Motivo; n: number; pct: Tasa }>;
    solo_miro: { base: number; con_motivo: number; valores: Array<{ motivo: Motivo; n: number; pct: Tasa }> };
  };
  perfil: {
    tamano: Array<{ valor: Tamano; n: number; pct: Tasa; miro_subio: Tasa }>;
    genero: { registros_con_desglose: number; personas_con_desglose: number; hombres: number; mujeres: number; cobertura: Tasa; hombres_pct: Tasa; mujeres_pct: Tasa };
    rango_etario: Distribucion<RangoEtario>;
    conocia_sim: Distribucion<Respuesta>;
    se_subio_antes: Distribucion<Respuesta>;
    iniciador: Distribucion<Iniciador>;
  };
  atendio: Array<{ empleado_id: string | null; nombre: string; activo: boolean; embudo: Embudo }>;
};

export function calcularMetricas(filas: FilaAnalisis[], fechas: { desde: string; hasta: string } | null, empleados: Map<string, EmpleadoRef>): ResultadoMetricas {
  const subidas = filas.filter((x) => x.resultado === "subio");
  const motivosDe = (base: FilaAnalisis[]) => {
    const con = base.filter((x) => x.motivo !== null);
    return { base: base.length, con, valores: MOTIVOS.map((motivo) => ({ motivo, n: con.filter((x) => x.motivo === motivo).length, pct: tasa(con.filter((x) => x.motivo === motivo).length, con.length) })) };
  };
  const pregunto = motivosDe(filas.filter((x) => x.resultado === "pregunto"));
  const miro = motivosDe(filas.filter((x) => x.resultado === "miro"));
  const conDesglose = filas.filter((x) => x.hombres !== null && x.mujeres !== null);
  const hombres = conDesglose.reduce((a, x) => a + (x.hombres ?? 0), 0);
  const mujeres = conDesglose.reduce((a, x) => a + (x.mujeres ?? 0), 0);
  const personas = filas.reduce((a, x) => a + x.personas_grupo, 0);

  const serie: ResultadoMetricas["serie"] = [];
  if (fechas && fechaValida(fechas.desde) && fechaValida(fechas.hasta)) {
    const porFecha = new Map<string, FilaAnalisis[]>();
    for (const x of filas) porFecha.set(x.fecha_negocio, [...(porFecha.get(x.fecha_negocio) ?? []), x]);
    for (let f = fechas.desde; f <= fechas.hasta; f = sumarDias(f, 1)) {
      const e = embudo(porFecha.get(f) ?? []);
      serie.push({ fecha: f, interacciones: e.interacciones, miraron: e.miraron, preguntaron: e.preguntaron, subieron: e.subieron });
    }
  }

  const porAtendio = new Map<string | null, FilaAnalisis[]>();
  for (const x of filas) porAtendio.set(x.atendio_empleado_id, [...(porAtendio.get(x.atendio_empleado_id) ?? []), x]);
  const atendio = [...porAtendio.entries()]
    .map(([id, grupo]) => {
      const emp = id ? empleados.get(id) : null;
      return { empleado_id: id, nombre: id ? emp?.nombre ?? "Integrante" : "Sin asignar", activo: id ? emp?.activo ?? false : true, embudo: embudo(grupo) };
    })
    .sort((a, b) => (a.empleado_id === null ? 1 : b.empleado_id === null ? -1 : b.embudo.interacciones - a.embudo.interacciones || a.nombre.localeCompare(b.nombre)));

  return {
    embudo: embudo(filas),
    vinculo: {
      subidas_declaradas: subidas.length,
      con_turno: subidas.filter((x) => x.vinculo_estado === "con_turno").length,
      con_turno_pago: subidas.filter((x) => x.venta_verificada).length,
      turno_no_activo: subidas.filter((x) => x.vinculo_estado === "turno_no_activo").length,
      pendientes: subidas.filter((x) => x.vinculo_estado === "pendiente").length,
      cerradas_sin_turno: subidas.filter((x) => x.vinculo_estado === "cerrada_sin_turno").length,
      con_pago_contradictorio: subidas.filter((x) => x.turnos_pago_contradictorio > 0).length,
      turnos_vinculados: subidas.reduce((a, x) => a + x.turnos_vinculados, 0),
      participaciones: subidas.reduce((a, x) => a + x.participaciones, 0),
    },
    serie,
    dias_semana: DIAS_SEMANA.map((etiqueta, dia) => ({ dia, etiqueta, embudo: embudo(filas.filter((x) => diaSemana(x.fecha_negocio) === dia)) })),
    franjas: CLAVES_FRANJA.map((clave) => ({
      clave, etiqueta: clave === "otros" ? "Otros horarios" : FRANJAS.find((f) => f.clave === clave)!.etiqueta,
      embudo: embudo(filas.filter((x) => franjaDe(x.hora_negocio) === clave)),
    })),
    motivos: {
      base: pregunto.base,
      con_motivo: pregunto.con.length,
      sin_motivo: pregunto.base - pregunto.con.length,
      cobertura: tasa(pregunto.con.length, pregunto.base),
      valores: pregunto.valores,
      solo_miro: { base: miro.base, con_motivo: miro.con.length, valores: miro.valores },
    },
    perfil: {
      tamano: TAMANOS.map((valor) => {
        const g = filas.filter((x) => tamanoDe(x.personas_grupo) === valor);
        return { valor, n: g.length, pct: tasa(g.length, filas.length), miro_subio: tasa(g.filter((x) => x.resultado === "subio").length, g.length) };
      }),
      genero: {
        registros_con_desglose: conDesglose.length,
        personas_con_desglose: hombres + mujeres,
        hombres, mujeres,
        cobertura: tasa(hombres + mujeres, personas),
        hombres_pct: tasa(hombres, hombres + mujeres),
        mujeres_pct: tasa(mujeres, hombres + mujeres),
      },
      rango_etario: distribucion(filas, RANGOS_ETARIOS, (x) => x.rango_etario),
      conocia_sim: distribucion(filas, RESPUESTAS, (x) => x.conocia_sim),
      se_subio_antes: distribucion(filas, RESPUESTAS, (x) => x.se_subio_antes),
      iniciador: distribucion(filas, INICIADORES, (x) => x.iniciador),
    },
    atendio,
  };
}

/** Cobertura general del stand: turnos del período (por fecha del TURNO) con interacción. Solo depende del período. */
export function cobertura(turnos: FilaCobertura[]) {
  const pagos = turnos.filter((t) => t.es_pago);
  const gratis = turnos.filter((t) => !t.es_pago);
  const contr = turnos.filter((t) => t.pago_contradictorio);
  const vinc = (l: FilaCobertura[]) => l.filter((t) => t.vinculado).length;
  return {
    turnos: turnos.length,
    vinculados: vinc(turnos),
    tasa: tasa(vinc(turnos), turnos.length),
    pagos: { total: pagos.length, vinculados: vinc(pagos), tasa: tasa(vinc(pagos), pagos.length) },
    gratis: { total: gratis.length, vinculados: vinc(gratis), tasa: tasa(vinc(gratis), gratis.length) },
    contradictorios: { total: contr.length, vinculados: vinc(contr) },
  };
}

// ── Parámetros de la consulta ──────────────────────────────────────────────
export const MAX_DIAS_PERIODO = 366;

export type ParamsMetricas = {
  desde: string;
  hasta: string;
  comparar: { desde: string; hasta: string } | null;
  filtros: Filtros;
};

/** GET /api/admin/interacciones/metricas?desde&hasta[&comp_desde&comp_hasta][&filtros…] (fechas inclusivas de Córdoba). */
export function validarParamsMetricas(p: URLSearchParams): { ok: true; valor: ParamsMetricas } | { ok: false; campo: string } {
  const permitidos = ["desde", "hasta", "comp_desde", "comp_hasta", ...CLAVES_FILTRO];
  for (const k of p.keys()) if (!permitidos.includes(k)) return { ok: false, campo: k.slice(0, 40) };
  const rango = (a: string, b: string) => {
    const d = p.get(a);
    const h = p.get(b);
    if (!fechaValida(d) || !fechaValida(h) || d > h || diasEntre(d, h) + 1 > MAX_DIAS_PERIODO) return null;
    return { desde: d, hasta: h };
  };
  const actual = rango("desde", "hasta");
  if (!actual) return { ok: false, campo: "desde" };
  let comparar: ParamsMetricas["comparar"] = null;
  if (p.has("comp_desde") || p.has("comp_hasta")) {
    comparar = rango("comp_desde", "comp_hasta");
    if (!comparar) return { ok: false, campo: "comp_desde" };
  }
  const filtros: Filtros = {};
  const en = <T extends string>(k: (typeof CLAVES_FILTRO)[number], lista: readonly T[], extra: string[] = []) => {
    const v = p.get(k);
    if (v === null) return true;
    if (![...lista, ...extra].includes(v)) return false;
    (filtros as Record<string, string>)[k] = v;
    return true;
  };
  const okFiltros =
    en("resultado", RESULTADOS) && en("franja", CLAVES_FRANJA) && en("rango_etario", RANGOS_ETARIOS, ["sin_dato"])
    && en("conocia_sim", RESPUESTAS, ["sin_dato"]) && en("se_subio_antes", RESPUESTAS, ["sin_dato"])
    && en("iniciador", INICIADORES, ["sin_dato"]) && en("motivo", MOTIVOS, ["sin_motivo"]) && en("tamano", TAMANOS);
  if (!okFiltros) return { ok: false, campo: "filtros" };
  const atendio = p.get("atendio");
  if (atendio !== null) {
    if (atendio !== "sin_asignar" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(atendio)) return { ok: false, campo: "atendio" };
    filtros.atendio = atendio.toLowerCase();
  }
  return { ok: true, valor: { desde: actual.desde, hasta: actual.hasta, comparar, filtros } };
}

// ============================================================================
// Campañas de Marketing — SERVIDOR (service_role). Simulación persistente.
// ----------------------------------------------------------------------------
// Solo lo importan /api/admin/marketing/campanias/* y sus pruebas.
//
//   · Vista previa: LECTURA. Calcula la audiencia con lib/marketing/audiencia.ts
//     (normalización, deduplicación por teléfono, fecha argentina, indicativos
//     oficiales, consentimiento y bajas) sobre turnos_stand y el registro. No
//     escribe nada: puede correr contra cualquier base.
//   · Guardar, preparar, ejecutar: ESCRITURA. Solo si evaluarEntornoCampanias lo
//     permite: base LOOPBACK (el stack local de pruebas, con datos sintéticos),
//     fuera de Vercel y con MARKETING_WHATSAPP_PROVIDER=fake. En cualquier otro
//     caso falla cerrada con 'solo_simulacion_local'. Toda transición pasa por
//     las RPCs de db/marketing-campanias.sql.
//   · Ejecutor por lotes: breve y reanudable. Toma un lote (la base bloquea la
//     campaña y marca cada destinatario con un turno), envía con el proveedor
//     SIMULADO, informa cada resultado y simula las entregas de lo aceptado en
//     lotes anteriores. Si el proceso se corta, el próximo lote sigue: lo que
//     quedó con el turno tomado pasa a 'incierto' y no se reenvía a ciegas.
// Nada de esto envía WhatsApp ni crea códigos: los beneficios son ficticios.
// ============================================================================

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim } from "@/lib/agenda";
import { evaluarEntornoCampanias, type EntornoCampanias } from "@/lib/marketing/entornoCampanias";
import {
  calcularAudiencia,
  enmascararTelefono,
  validarIndicativos,
  ventanaAudiencia,
  type MotivoExterno,
  type ResultadoAudiencia,
  type TurnoAudiencia,
} from "@/lib/marketing/audiencia";
import {
  aplicarTopes,
  capacidadesCodigos,
  condicionesParaDestinatario,
  describirBeneficio,
  errorCampanias,
  errorDeRpcCampanias,
  faltantesParaPreparar,
  renderizarMensaje,
  parametrosPlantilla,
  valoresMensaje,
  variablesDelMensaje,
  type DatosCampania,
  type ErrorCampanias,
  type EstadoCampania,
  type EstadoDestinatario,
  type SimulacionProveedor,
} from "@/lib/marketing/campanias";
import { ETIQUETA_FUENTE, type Fuente } from "@/lib/marketing/consentimiento";
import { leerRegistroParaAudiencia } from "@/lib/marketing/registroLectura";
import { procesarEventos } from "@/lib/marketing/whatsappServer";
import {
  crearProveedorSimulado,
  decidirEntregaSimulada,
  type ProveedorWhatsapp,
} from "@/lib/marketing/proveedorWhatsapp";

export type R<T> = { ok: true; valor: T } | { ok: false; e: ErrorCampanias | null; causa?: string };
type ErrorPg = { code?: string | null; message?: string | null } | null;

function fallo<T>(error: ErrorPg): R<T> {
  const e = errorDeRpcCampanias(error);
  return e ? { ok: false, e } : { ok: false, e: null, causa: `${error?.code ?? ""} ${error?.message ?? ""}`.trim() };
}
const falla = <T>(codigo: string, campo?: string): R<T> => ({ ok: false, e: errorCampanias(codigo, campo) });

// ── Entorno: dónde se puede escribir (lib/marketing/entornoCampanias.ts) ───
export { evaluarEntornoCampanias, type EntornoCampanias };

function exigirEscritura<T>(): R<T> | null {
  return evaluarEntornoCampanias().escritura ? null : falla("solo_simulacion_local");
}

// ── Lectura de la audiencia ────────────────────────────────────────────────
const LOTE = 1000;
const ACTIVAS: EstadoCampania[] = ["preparada", "ejecutando", "pausada"];
const EN_CURSO: EstadoDestinatario[] = ["pendiente", "enviando", "aceptado", "incierto"];

async function leerTurnos(desde: string, hoy: string): Promise<{ filas: TurnoAudiencia[]; esperado: number }> {
  const { count, error: e1 } = await supabaseAdmin.from("turnos_stand").select("id", { count: "exact", head: true }).gte("fecha", desde).lte("fecha", hoy);
  if (e1) throw new Error(`turnos_stand: ${e1.message}`);
  const filas: TurnoAudiencia[] = [];
  for (let i = 0; ; i += LOTE) {
    const { data, error } = await supabaseAdmin.from("turnos_stand")
      .select("id, nombre, telefono, fecha, estado, total, metodo_pago")
      .gte("fecha", desde).lte("fecha", hoy).order("id", { ascending: true }).range(i, i + LOTE - 1);
    if (error) throw new Error(`turnos_stand: ${error.message}`);
    filas.push(...((data ?? []) as TurnoAudiencia[]));
    if (!data || data.length < LOTE) break;
  }
  return { filas, esperado: count ?? -1 };
}

async function telefonosEnOtrasCampanias(excepto: string | null): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: camps, error } = await supabaseAdmin.from("mkt_campanias").select("id").in("estado", ACTIVAS);
  if (error) {
    if (errorDeRpcCampanias(error)?.codigo === "campanias_no_instaladas") return out;
    throw new Error(`mkt_campanias: ${error.message}`);
  }
  const ids = (camps ?? []).map((c) => String(c.id)).filter((id) => id !== excepto);
  if (!ids.length) return out;
  for (let i = 0; ; i += LOTE) {
    const { data, error: e2 } = await supabaseAdmin.from("mkt_campania_destinatarios").select("telefono")
      .in("campania_id", ids).in("estado", EN_CURSO).order("id", { ascending: true }).range(i, i + LOTE - 1);
    if (e2) throw new Error(`mkt_campania_destinatarios: ${e2.message}`);
    for (const f of (data ?? []) as { telefono: string }[]) out.add(f.telefono);
    if (!data || data.length < LOTE) break;
  }
  return out;
}

async function titularesDeMensualidad(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; ; i += LOTE) {
    const { data, error } = await supabaseAdmin.from("mensualidades").select("telefono_norm").not("telefono_norm", "is", null)
      .order("id", { ascending: true }).range(i, i + LOTE - 1);
    if (error) throw new Error(`mensualidades: ${error.message}`);
    for (const f of (data ?? []) as { telefono_norm: string }[]) out.add(f.telefono_norm);
    if (!data || data.length < LOTE) break;
  }
  return out;
}

export type Audiencia = {
  resultado: ResultadoAudiencia;
  calculadoEn: string;
  lectura: { filas: number; esperado: number; consistente: boolean };
  registro: { instalado: boolean; consentimientos: number; bajas: number; porFuenteElegibles: Partial<Record<Fuente, number>> };
};

export async function calcularAudienciaCampania(d: DatosCampania, ahora: Date, campaniaId: string | null = null): Promise<R<Audiencia>> {
  const ind = validarIndicativos(d.indicativos);
  if (ind.errores.length) return falla("datos_invalidos", "indicativos");
  const { hoy, desde } = ventanaAudiencia(ahora, d.ventana_dias);
  let lectura = await leerTurnos(desde, hoy);
  if (lectura.filas.length !== lectura.esperado) lectura = await leerTurnos(desde, hoy);
  if (lectura.filas.length !== lectura.esperado) return falla("lectura_inconsistente");

  const registro = await leerRegistroParaAudiencia(supabaseAdmin);
  if (!registro.ok) return { ok: false, e: null, causa: registro.causa };

  const otras = new Map<string, MotivoExterno>();
  if (d.excluir_mensualidades) for (const t of await titularesDeMensualidad()) otras.set(t, "titular_mensualidad");
  for (const t of await telefonosEnOtrasCampanias(campaniaId)) if (!otras.has(t)) otras.set(t, "en_otra_campania");

  const resultado = calcularAudiencia(lectura.filas, {
    ventanaDias: d.ventana_dias, soloPagos: d.solo_pagos, excluirRetornados: d.excluir_retornados, indicativos: ind.indicativos,
  }, { ahora, consentimientos: new Set(registro.valor.consentimientos.keys()), bajas: registro.valor.bajas, otrasExclusiones: otras });

  const porFuenteElegibles: Partial<Record<Fuente, number>> = {};
  for (const e of resultado.elegibles) {
    const f = registro.valor.consentimientos.get(e.telefono);
    if (f) porFuenteElegibles[f] = (porFuenteElegibles[f] ?? 0) + 1;
  }
  return {
    ok: true,
    valor: {
      resultado,
      calculadoEn: ahora.toISOString(),
      lectura: { filas: lectura.filas.length, esperado: lectura.esperado, consistente: true },
      registro: {
        instalado: registro.valor.instalado, consentimientos: registro.valor.consentimientos.size,
        bajas: registro.valor.bajas.size, porFuenteElegibles,
      },
    },
  };
}

/** Resumen del cálculo SIN teléfonos: lo que se guarda en la campaña y se muestra. */
function resumenAudiencia(a: Audiencia, d: DatosCampania) {
  const r = a.resultado;
  const topes = aplicarTopes(r.telefonos.elegibles, d);
  return {
    calculado_en: a.calculadoEn,
    hoy: r.hoy,
    ventana: { dias: r.ventanaDias, desde: r.desde, hasta: r.hasta },
    filtros: {
      solo_pagos: r.config.soloPagos, excluir_retornados: r.config.excluirRetornados,
      excluir_mensualidades: d.excluir_mensualidades, indicativos: r.config.indicativos,
    },
    efecto_filtros: r.filtros,
    lectura: a.lectura,
    filas: { en_ventana: r.filas.enVentana, validas: r.filas.validas, excluidas: r.filas.excluidas },
    candidatos: r.telefonos.unicos,
    elegibles: r.telefonos.elegibles,
    pendientes_consentimiento: r.pendientesConsentimiento.length,
    excluidos: r.telefonos.excluidos,
    sin_indicativo: r.telefonos.sinIndicativo,
    seleccionados: topes.seleccionados,
    recortado_por: topes.recortadoPor,
    costo: topes.costo ? { tarifa: topes.costo.tarifaPorEntregado, moneda: topes.costo.moneda, maximo: topes.costo.costoMaximo } : null,
    consentimiento: {
      registro_instalado: a.registro.instalado,
      registrados: a.registro.consentimientos,
      bajas: a.registro.bajas,
      elegibles_por_fuente: Object.fromEntries(Object.entries(a.registro.porFuenteElegibles).map(([k, n]) => [ETIQUETA_FUENTE[k as Fuente] ?? k, n])),
      // Ninguna fuente de hoy verifica que la persona controle el número: es una
      // decisión pendiente para habilitar la campaña real.
      control_telefono_verificado: 0,
      control_telefono_pendiente: true,
    },
    advertencias: r.advertencias,
  };
}
export type ResumenAudiencia = ReturnType<typeof resumenAudiencia>;

export type VistaPrevia = ResumenAudiencia & {
  muestra: { telefono: string; indicativo: string | null; ultima_visita: string; visitas: number }[];
  mensaje: { plantilla: string; ejemplo: string; variables: string[]; advertencias: string[] };
  condiciones: string[];
  capacidades: ReturnType<typeof capacidadesCodigos>;
  faltan_para_preparar: string[];
  beneficio: string;
};

/** Vista previa: solo lectura, en cualquier base. Teléfonos enmascarados; el mensaje de ejemplo no usa datos reales. */
export async function vistaPrevia(d: DatosCampania, ahora: Date, advertencias: string[] = [], campaniaId: string | null = null): Promise<R<VistaPrevia>> {
  const a = await calcularAudienciaCampania(d, ahora, campaniaId);
  if (!a.ok) return a;
  const resumen = resumenAudiencia(a.valor, d);
  const hoy = hoyEnSim(ahora);
  const ejemplo = renderizarMensaje(d.mensaje, valoresMensaje(d, { nombre: "Nombre de ejemplo", codigo: "SIMU-XXXXXXXX" }, hoy));
  return {
    ok: true,
    valor: {
      ...resumen,
      muestra: a.valor.resultado.elegibles.slice(0, resumen.seleccionados).slice(0, 10).map((x) => ({
        telefono: enmascararTelefono(x.telefono), indicativo: x.indicativo, ultima_visita: x.ultimaVisita, visitas: x.visitas,
      })),
      mensaje: { plantilla: d.mensaje, ejemplo, variables: variablesDelMensaje(d.mensaje).usadas, advertencias },
      condiciones: condicionesParaDestinatario(d, hoy),
      capacidades: capacidadesCodigos(d.productos),
      faltan_para_preparar: faltantesParaPreparar(d),
      beneficio: describirBeneficio(d.beneficio_tipo, d.beneficio_valor),
    },
  };
}

// ── Campañas ───────────────────────────────────────────────────────────────
export type FilaCampania = DatosCampania & {
  id: string; estado: EstadoCampania; version: number; modo: "simulacion";
  audiencia: (ResumenAudiencia & { al_preparar?: Record<string, number> }) | null;
  seleccionados: number | null; costo_maximo: number | null;
  preparada_en: string | null; iniciada_en: string | null; pausada_en: string | null; cancelada_en: string | null; completada_en: string | null;
  creada_en: string; actualizada_en: string;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
function normalizarFila(f: Record<string, unknown>): FilaCampania {
  return {
    ...(f as unknown as FilaCampania),
    beneficio_valor: num(f.beneficio_valor), tarifa: num(f.tarifa), presupuesto_maximo: num(f.presupuesto_maximo),
    costo_maximo: num(f.costo_maximo), limite_destinatarios: num(f.limite_destinatarios),
    beneficio_vigencia_dias: num(f.beneficio_vigencia_dias), seleccionados: num(f.seleccionados),
  };
}

export async function campaniasInstaladas(): Promise<R<boolean>> {
  const { error } = await supabaseAdmin.from("mkt_campanias").select("id").limit(1);
  if (!error) return { ok: true, valor: true };
  if (errorDeRpcCampanias(error)?.codigo === "campanias_no_instaladas") return { ok: true, valor: false };
  return fallo(error);
}

async function leerCampania(id: string): Promise<R<FilaCampania>> {
  const { data, error } = await supabaseAdmin.from("mkt_campanias").select("*").eq("id", id).maybeSingle();
  if (error) return fallo(error);
  if (!data) return falla("campania_inexistente");
  return { ok: true, valor: normalizarFila(data as Record<string, unknown>) };
}

type FilaDestinatario = {
  id: string; orden: number; telefono: string; nombre: string | null; indicativo: string | null; ultima_visita: string;
  beneficio_codigo: string; estado: EstadoDestinatario; intentos: number; motivo: string | null; ultimo_codigo: string | null;
  proximo_intento_en: string | null; aceptado_en: string | null; entregado_en: string | null; terminado_en: string | null;
  costo: number | string | null;
};

async function destinatariosDe(ids: string[], columnas: string): Promise<R<(FilaDestinatario & { campania_id: string })[]>> {
  const out: (FilaDestinatario & { campania_id: string })[] = [];
  if (!ids.length) return { ok: true, valor: out };
  for (let i = 0; ; i += LOTE) {
    const { data, error } = await supabaseAdmin.from("mkt_campania_destinatarios").select(columnas)
      .in("campania_id", ids).order("campania_id").order("orden", { ascending: true }).range(i, i + LOTE - 1);
    if (error) return fallo(error);
    out.push(...((data ?? []) as unknown as (FilaDestinatario & { campania_id: string })[]));
    if (!data || data.length < LOTE) break;
  }
  return { ok: true, valor: out };
}

export type Conteos = {
  preparados: number; pendientes: number; enviando: number; aceptados: number; entregados: number; no_entregados: number;
  fallidos: number; inciertos: number; excluidos: number; cancelados: number; costo_simulado: number;
  excluidos_por_motivo: Record<string, number>; fallidos_por_motivo: Record<string, number>;
};

function contar(filas: FilaDestinatario[]): Conteos {
  const c: Conteos = {
    preparados: filas.length, pendientes: 0, enviando: 0, aceptados: 0, entregados: 0, no_entregados: 0, fallidos: 0,
    inciertos: 0, excluidos: 0, cancelados: 0, costo_simulado: 0, excluidos_por_motivo: {}, fallidos_por_motivo: {},
  };
  for (const f of filas) {
    if (f.aceptado_en) c.aceptados++;
    c.costo_simulado += Number(f.costo ?? 0);
    switch (f.estado) {
      case "pendiente": c.pendientes++; break;
      case "enviando": c.enviando++; break;
      case "entregado": c.entregados++; break;
      case "no_entregado": c.no_entregados++; break;
      case "fallido": c.fallidos++; c.fallidos_por_motivo[f.motivo ?? "?"] = (c.fallidos_por_motivo[f.motivo ?? "?"] ?? 0) + 1; break;
      case "incierto": c.inciertos++; break;
      case "excluido": c.excluidos++; c.excluidos_por_motivo[f.motivo ?? "?"] = (c.excluidos_por_motivo[f.motivo ?? "?"] ?? 0) + 1; break;
      case "cancelado": c.cancelados++; break;
    }
  }
  c.costo_simulado = Math.round(c.costo_simulado * 1e6) / 1e6;
  return c;
}

export type ItemLista = Pick<FilaCampania, "id" | "nombre" | "objetivo" | "estado" | "ventana_dias" | "seleccionados" | "creada_en" | "actualizada_en" | "moneda"> & { conteos: Conteos };

export async function listarCampanias(): Promise<R<ItemLista[]>> {
  const { data, error } = await supabaseAdmin.from("mkt_campanias")
    .select("id, nombre, objetivo, estado, ventana_dias, seleccionados, creada_en, actualizada_en, moneda")
    .order("creada_en", { ascending: false }).limit(50);
  if (error) return fallo(error);
  const filas = (data ?? []) as ItemLista[];
  const dest = await destinatariosDe(filas.map((f) => f.id), "campania_id, estado, motivo, aceptado_en, costo, orden");
  if (!dest.ok) return dest;
  return { ok: true, valor: filas.map((f) => ({ ...f, conteos: contar(dest.valor.filter((d) => d.campania_id === f.id)) })) };
}

export type DestinatarioPanel = Omit<FilaDestinatario, "telefono" | "nombre" | "costo"> & { telefono: string; costo: number | null };

export type DetalleCampania = {
  campania: FilaCampania;
  conteos: Conteos;
  destinatarios: DestinatarioPanel[];
  eventos: { id: number; tipo: string; actor: string; detalle: Record<string, unknown>; creado_en: string }[];
  atribucion: { con_cupon_real: number; ficticios: number; reservas_pagadas: number; gift_cards_pagadas: number; regresos_stand: number };
  capacidades: ReturnType<typeof capacidadesCodigos>;
  condiciones: string[];
  mensaje_ejemplo: string;
};

export async function detalleCampania(id: string): Promise<R<DetalleCampania>> {
  const c = await leerCampania(id);
  if (!c.ok) return c;
  const [dest, ev, at] = await Promise.all([
    destinatariosDe([id], "campania_id, id, orden, telefono, indicativo, ultima_visita, beneficio_codigo, estado, intentos, motivo, ultimo_codigo, proximo_intento_en, aceptado_en, entregado_en, terminado_en, costo"),
    supabaseAdmin.from("mkt_campania_eventos").select("id, tipo, actor, detalle, creado_en").eq("campania_id", id).order("id", { ascending: false }).limit(60),
    supabaseAdmin.from("mkt_campania_atribucion").select("beneficio_ficticio, reserva_id, grupo_compra_id, regreso_turno_id").eq("campania_id", id).limit(5000),
  ]);
  if (!dest.ok) return dest;
  if (ev.error) return fallo(ev.error);
  if (at.error) return fallo(at.error);
  const atr = (at.data ?? []) as { beneficio_ficticio: boolean; reserva_id: number | null; grupo_compra_id: string | null; regreso_turno_id: number | null }[];
  const hoy = hoyEnSim();
  return {
    ok: true,
    valor: {
      campania: c.valor,
      conteos: contar(dest.valor),
      destinatarios: dest.valor.map((d) => ({ ...d, telefono: enmascararTelefono(d.telefono), nombre: undefined, costo: num(d.costo) }) as DestinatarioPanel),
      eventos: (ev.data ?? []) as DetalleCampania["eventos"],
      atribucion: {
        con_cupon_real: atr.filter((a) => !a.beneficio_ficticio).length,
        ficticios: atr.filter((a) => a.beneficio_ficticio).length,
        reservas_pagadas: atr.filter((a) => a.reserva_id !== null).length,
        gift_cards_pagadas: atr.filter((a) => a.grupo_compra_id !== null).length,
        regresos_stand: atr.filter((a) => a.regreso_turno_id !== null).length,
      },
      capacidades: capacidadesCodigos(c.valor.productos),
      condiciones: condicionesParaDestinatario(c.valor, hoy),
      mensaje_ejemplo: renderizarMensaje(c.valor.mensaje, valoresMensaje(c.valor, { nombre: "Nombre de ejemplo", codigo: "SIMU-XXXXXXXX" }, hoy)),
    },
  };
}

// ── Escrituras (solo simulación local) ─────────────────────────────────────
type RespCampania = { ok: true; repetida: boolean; campania: Record<string, unknown> };

export async function guardarCampania(args: { id: string | null; version: number | null; clave: string | null; datos: DatosCampania }): Promise<R<{ campania: FilaCampania; repetida: boolean }>> {
  const bloqueo = exigirEscritura<{ campania: FilaCampania; repetida: boolean }>();
  if (bloqueo) return bloqueo;
  if (validarIndicativos(args.datos.indicativos).errores.length) return falla("datos_invalidos", "indicativos");
  const { data, error } = await supabaseAdmin.rpc("mkt_campania_guardar", {
    p_id: args.id, p_version: args.version, p_clave: args.clave, p_datos: args.datos, p_rol: "admin",
  });
  if (error) return fallo(error);
  const r = data as RespCampania;
  return { ok: true, valor: { campania: normalizarFila(r.campania), repetida: r.repetida } };
}

/** Recalcula la audiencia EN EL SERVIDOR (nunca la del navegador), aplica los topes y la fija con sus beneficios. */
export async function prepararCampania(id: string, version: number, ahora: Date): Promise<R<{ campania: FilaCampania; repetida: boolean }>> {
  const bloqueo = exigirEscritura<{ campania: FilaCampania; repetida: boolean }>();
  if (bloqueo) return bloqueo;
  const c = await leerCampania(id);
  if (!c.ok) return c;
  // Doble clic: si ya se preparó con la versión que vio el panel, la base lo devuelve como repetida.
  if (c.valor.estado !== "borrador") {
    const { data, error } = await supabaseAdmin.rpc("mkt_campania_preparar", {
      p_id: id, p_version: version, p_audiencia: {}, p_destinatarios: [], p_rol: "admin",
    });
    if (error) return fallo(error);
    const r = data as RespCampania;
    return { ok: true, valor: { campania: normalizarFila(r.campania), repetida: r.repetida } };
  }
  if (faltantesParaPreparar(c.valor).length) return falla("campania_incompleta");
  const a = await calcularAudienciaCampania(c.valor, ahora, id);
  if (!a.ok) return a;
  const resumen = resumenAudiencia(a.valor, c.valor);
  const seleccion = a.valor.resultado.elegibles.slice(0, resumen.seleccionados).map((e) => ({
    telefono: e.telefono, nombre: e.nombre, indicativo: e.indicativo, ultima_visita: e.ultimaVisita, turno_id: e.turnoId,
  }));
  if (!seleccion.length) return falla("audiencia_vacia");
  const { data, error } = await supabaseAdmin.rpc("mkt_campania_preparar", {
    p_id: id, p_version: version, p_audiencia: resumen, p_destinatarios: seleccion, p_rol: "admin",
  });
  if (error) return fallo(error);
  const r = data as RespCampania;
  return { ok: true, valor: { campania: normalizarFila(r.campania), repetida: r.repetida } };
}

export type AccionEstado = "iniciar" | "pausar" | "reanudar" | "cancelar";

export async function cambiarEstado(id: string, accion: AccionEstado): Promise<R<{ campania: FilaCampania; repetida: boolean; pendientes_cancelados: number }>> {
  const bloqueo = exigirEscritura<{ campania: FilaCampania; repetida: boolean; pendientes_cancelados: number }>();
  if (bloqueo) return bloqueo;
  const { data, error } = await supabaseAdmin.rpc("mkt_campania_cambiar", { p_id: id, p_accion: accion, p_rol: "admin" });
  if (error) return fallo(error);
  const r = data as RespCampania & { pendientes_cancelados?: number };
  const campania = normalizarFila(r.campania);
  // Lo que el proveedor ya aceptó se entrega (o no) aunque la campaña se pause o
  // se cancele: en la etapa real llega por webhook; acá se simula al frenar.
  if (accion === "pausar" || accion === "cancelar") {
    const e = await simularEntregas(campania, campania.simulacion);
    if (!e.ok) return e;
  }
  return { ok: true, valor: { campania, repetida: r.repetida, pendientes_cancelados: r.pendientes_cancelados ?? 0 } };
}

export async function resolverIncierto(destinatarioId: string, decision: "reintentar" | "fallido"): Promise<R<{ estado: string }>> {
  const bloqueo = exigirEscritura<{ estado: string }>();
  if (bloqueo) return bloqueo;
  const { data, error } = await supabaseAdmin.rpc("mkt_campania_resolver_incierto", { p_destinatario: destinatarioId, p_decision: decision, p_rol: "admin" });
  if (error) return fallo(error);
  const r = data as { ok: boolean; estado: string; motivo?: string };
  if (!r.ok) return falla("transicion_invalida");
  return { ok: true, valor: { estado: r.estado } };
}

// ── Ejecutor por lotes ─────────────────────────────────────────────────────
export const LOTE_POR_DEFECTO = 10;
/** Tiempo máximo de una llamada al proveedor: pasado esto, el resultado es incierto. */
export const TIEMPO_ENVIO_MS = 10_000;
/** Espera antes de reintentar un error transitorio (la simulación usa poco para que se vea). */
export const ESPERA_REINTENTO_S = 5;

type Tomado = { id: string; telefono: string; nombre: string | null; beneficio_codigo: string; intentos: number; orden: number };
type RespLote = {
  ok: boolean; motivo?: string; tomados: Tomado[]; interrumpidos: number;
  excluidos?: { baja_posterior: number; sin_consentimiento: number; sin_cupo: number }; completada?: boolean;
};

export type ResultadoLote = {
  estado: EstadoCampania;
  tomados: number;
  aceptados: number;
  transitorios: number;
  fallidos: number;
  inciertos: number;
  entregas: { entregados: number; no_entregados: number };
  excluidos: { baja_posterior: number; sin_consentimiento: number; sin_cupo: number };
  interrumpidos: number;
  descartados: number;
  completada: boolean;
};

function clave(campaniaId: string, telefono: string) {
  return `${campaniaId}:${telefono}`;
}

async function conTiempo<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("tiempo_agotado")), ms); })]);
  } finally {
    if (t) clearTimeout(t);
  }
}

async function simularEntregas(c: FilaCampania, sim: SimulacionProveedor): Promise<R<{ entregados: number; no_entregados: number }>> {
  const out = { entregados: 0, no_entregados: 0 };
  const { data, error } = await supabaseAdmin.from("mkt_campania_destinatarios").select("id, telefono")
    .eq("campania_id", c.id).eq("estado", "aceptado").order("orden").limit(500);
  if (error) return fallo(error);
  for (const d of (data ?? []) as { id: string; telefono: string }[]) {
    const entregado = decidirEntregaSimulada(clave(c.id, d.telefono), sim);
    const { data: r, error: e } = await supabaseAdmin.rpc("mkt_campania_registrar_entrega", {
      p_destinatario: d.id, p_estado: entregado ? "entregado" : "no_entregado", p_codigo: entregado ? null : "131049",
    });
    if (e) return fallo(e);
    if ((r as { ok: boolean; repetida?: boolean }).ok && !(r as { repetida?: boolean }).repetida) {
      if (entregado) out.entregados++; else out.no_entregados++;
    }
  }
  return { ok: true, valor: out };
}

/**
 * Un lote breve. Reanudable: cada llamada sigue donde quedó la anterior, desde
 * cualquier proceso. `proveedor` solo lo inyectan las pruebas; si no, el simulado
 * con la configuración de la campaña.
 */
export async function ejecutarLote(campaniaId: string, opts: {
  tamano?: number; proveedor?: ProveedorWhatsapp; tiempoEnvioMs?: number; esperaReintentoS?: number; ahora?: () => Date;
} = {}): Promise<R<ResultadoLote>> {
  const bloqueo = exigirEscritura<ResultadoLote>();
  if (bloqueo) return bloqueo;
  const c = await leerCampania(campaniaId);
  if (!c.ok) return c;
  const sim = c.valor.simulacion;
  const proveedor = opts.proveedor ?? crearProveedorSimulado(sim);
  const tamano = Math.min(Math.max(opts.tamano ?? LOTE_POR_DEFECTO, 1), 50);
  const tiempo = opts.tiempoEnvioMs ?? TIEMPO_ENVIO_MS;
  // El turno cubre el lote entero aunque cada envío agote su tiempo.
  const turnoS = Math.min(600, Math.ceil((tamano * tiempo) / 1000) + 15);
  const ejecutor = randomUUID();
  const res: ResultadoLote = {
    estado: c.valor.estado, tomados: 0, aceptados: 0, transitorios: 0, fallidos: 0, inciertos: 0,
    entregas: { entregados: 0, no_entregados: 0 }, excluidos: { baja_posterior: 0, sin_consentimiento: 0, sin_cupo: 0 },
    interrumpidos: 0, descartados: 0, completada: c.valor.estado === "completada",
  };

  // 0 · Novedades del webhook que quedaron sin procesar (bajas, estados): así
  // una baja recibida mientras el proceso estaba caído excluye antes de tomar.
  await procesarEventos(100);

  // 1 · Entregas de lo aceptado en lotes anteriores (en la etapa real, webhook).
  const e1 = await simularEntregas(c.valor, sim);
  if (!e1.ok) return e1;
  res.entregas = e1.valor;

  // 2 · Tomar.
  const { data, error } = await supabaseAdmin.rpc("mkt_campania_tomar_lote", {
    p_id: campaniaId, p_ejecutor: ejecutor, p_tamano: tamano, p_turno_s: turnoS,
  });
  if (error) return fallo(error);
  const lote = data as RespLote;
  res.interrumpidos = lote.interrumpidos ?? 0;
  if (!lote.ok) {
    res.estado = (lote.motivo ?? c.valor.estado) as EstadoCampania;
    return { ok: true, valor: res };
  }
  res.excluidos = lote.excluidos ?? res.excluidos;
  res.tomados = lote.tomados.length;

  // 3 · Enviar e informar cada resultado.
  const hoy = hoyEnSim(opts.ahora?.() ?? new Date());
  for (const t of lote.tomados) {
    const valores = valoresMensaje(c.valor, { nombre: t.nombre, codigo: t.beneficio_codigo }, hoy);
    let resultado: "aceptado" | "fallido" | "transitorio" | "incierto";
    let datos: Record<string, unknown>;
    try {
      const r = await conTiempo(proveedor.enviarPlantilla({
        destino: `549${t.telefono}`, plantilla: "simulacion_recuperacion_stand", idioma: "es_AR",
        variables: parametrosPlantilla(valores),
        codigoCupon: t.beneficio_codigo, claveIdempotencia: clave(campaniaId, t.telefono), intento: t.intentos,
        referencia: `${t.id}:${t.intentos}`,
      }), tiempo);
      if (r.ok) { resultado = "aceptado"; datos = { wamid: r.wamid }; }
      else if (r.incierto) { resultado = "incierto"; datos = { codigo: r.codigo, detalle: r.detalle }; }
      else if (r.transitorio) { resultado = "transitorio"; datos = { codigo: r.codigo, detalle: r.detalle, reintentar_en_s: opts.esperaReintentoS ?? ESPERA_REINTENTO_S }; }
      else {
        resultado = "fallido";
        datos = { codigo: r.codigo, detalle: r.detalle };
        // 131050: la persona frenó el marketing en WhatsApp. Es una baja.
        if (r.codigo === "131050") {
          await supabaseAdmin.rpc("mkt_wa_registrar_baja", {
            p_telefono: `549${t.telefono}`, p_origen: "error_131050", p_referencia: `api:${t.id}:${t.intentos}`, p_ocurrido_en: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      // Sin respuesta (tiempo agotado, corte de red): no se sabe si salió.
      resultado = "incierto";
      datos = { codigo: "sin_respuesta", detalle: err instanceof Error ? err.message.slice(0, 200) : "sin respuesta" };
    }
    const { data: rr, error: er } = await supabaseAdmin.rpc("mkt_campania_registrar_envio", {
      p_destinatario: t.id, p_ejecutor: ejecutor, p_resultado: resultado, p_datos: datos,
    });
    if (er) return fallo(er);
    const ok = (rr as { ok: boolean }).ok;
    if (!ok) { res.descartados++; continue; }
    const estado = (rr as { estado: string }).estado;
    if (estado === "aceptado") res.aceptados++;
    else if (estado === "pendiente") res.transitorios++;
    else if (estado === "fallido") res.fallidos++;
    else if (estado === "incierto") res.inciertos++;
  }

  // 4 · ¿Terminó? Entonces, las entregas que faltan.
  const { data: fin, error: ef } = await supabaseAdmin.rpc("mkt_campania_verificar_fin", { p_id: campaniaId });
  if (ef) return fallo(ef);
  res.estado = (fin as { estado: EstadoCampania }).estado;
  res.completada = res.estado === "completada";
  if (res.completada) {
    const e2 = await simularEntregas(c.valor, sim);
    if (!e2.ok) return e2;
    res.entregas.entregados += e2.valor.entregados;
    res.entregas.no_entregados += e2.valor.no_entregados;
  }
  return { ok: true, valor: res };
}

/** Para un disparador de servidor: un lote de cada campaña en 'ejecutando' (las más viejas primero). */
export async function ejecutarPendientes(maxCampanias = 5): Promise<R<{ campania: string; resultado: ResultadoLote | null; error?: string }[]>> {
  const bloqueo = exigirEscritura<{ campania: string; resultado: ResultadoLote | null }[]>();
  if (bloqueo) return bloqueo;
  const { data, error } = await supabaseAdmin.from("mkt_campanias").select("id").eq("estado", "ejecutando")
    .order("iniciada_en", { ascending: true }).limit(maxCampanias);
  if (error) return fallo(error);
  const out: { campania: string; resultado: ResultadoLote | null; error?: string }[] = [];
  for (const { id } of (data ?? []) as { id: string }[]) {
    const r = await ejecutarLote(id);
    out.push(r.ok ? { campania: id, resultado: r.valor } : { campania: id, resultado: null, error: r.e?.codigo ?? "error" });
  }
  return { ok: true, valor: out };
}

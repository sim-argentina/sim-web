// CRM B2B · B3 — acceso de SERVIDOR a ventas, cobros y comisiones (solo
// Administración). Lo importan únicamente las rutas de /api/admin/crm (con
// actorAdmin): ningún dato de acá llega a la interfaz comercial ni a staff.
// Escrituras: solo por las RPCs de db/crm-b3-ventas.sql, con la huella calculada
// acá (nunca la manda el navegador). Lecturas: columnas explícitas. La campaña de
// Empresas se LEE (sin datos de beneficiarios ni los códigos en sí): el CRM no la
// modifica.

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim } from "@/lib/agenda";
import { canonico, esUuid } from "@/lib/crmB1";
import { actorRpc, nombres, revisar, rpc, trozos, type R } from "@/lib/crmB1Server";
import { estadoEfectivo, metricasCampania } from "@/lib/empresas";
import {
  PENDIENTES, aCentavos, anticipoEsperado, avisosCampania, comisionPropuesta, estadoCobro, estadoComision, filtrarVentas, pendientesDe,
  resumenCompras, totalesVentas,
  type CampaniaLectura, type Centavos, type CodigoProducto, type ComisionPropuesta, type Entrega, type FiltrosVentas, type Fundamento,
  type Pendiente, type Producto, type TipoComision, type VentaFila,
} from "@/lib/crmB3";

const ADMIN = { rol: "admin" } as const;
const COLS_VENTA = "id, oportunidad_id, empresa_id, ciclo, es_recompra, fecha_acuerdo, producto_codigo, producto_nombre, experiencias, duracion_minutos, "
  + "importe, precio_catalogo, comision_catalogo, comision_tipo, comision_importe, comision_beneficiario_id, comision_fundamento, comision_detalle, "
  + "comision_intervencion_visita_id, comision_intervencion_actividad_id, observacion, entrega_estado, entrega_fecha, entrega_detalle, campania_id, "
  + "campania_vinculada_en, registrada_en, anulada_en, anulada_motivo, version";

type FilaVenta = {
  id: string; oportunidad_id: string; empresa_id: string; ciclo: number; es_recompra: boolean; fecha_acuerdo: string; producto_codigo: CodigoProducto;
  producto_nombre: string; experiencias: number; duracion_minutos: number; importe: number | string; precio_catalogo: number | string | null;
  comision_catalogo: number | string | null; comision_tipo: TipoComision; comision_importe: number | string | null; comision_beneficiario_id: string | null;
  comision_fundamento: Fundamento; comision_detalle: string | null; comision_intervencion_visita_id: string | null;
  comision_intervencion_actividad_id: string | null; observacion: string | null; entrega_estado: Entrega; entrega_fecha: string | null;
  entrega_detalle: string | null; campania_id: string | null; campania_vinculada_en: string | null; registrada_en: string; anulada_en: string | null;
  anulada_motivo: string | null; version: number;
};
type FilaCobro = {
  id: string; venta_id: string; fecha_efectiva: string; importe: number | string; medio: string; referencia: string | null; concepto: string;
  registrado_en: string; anulado_en: string | null; anulado_motivo: string | null;
};
type FilaPago = {
  id: string; venta_id: string; beneficiario_id: string; fecha: string; importe: number | string; referencia: string | null; registrado_en: string;
  anulado_en: string | null; anulado_motivo: string | null;
};

const c = (v: number | string | null | undefined): Centavos => aCentavos(v) ?? 0;

async function porIds<T>(tabla: string, cols: string, campo: string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (const t of trozos([...new Set(ids)])) out.push(...((revisar(await supabaseAdmin.from(tabla).select(cols).in(campo, t), tabla) ?? []) as T[]));
  return out;
}

async function armarVentas(filas: FilaVenta[], mapa?: Map<string, string>): Promise<{ ventas: VentaFila[]; cobros: FilaCobro[]; pagos: FilaPago[] }> {
  if (!filas.length) return { ventas: [], cobros: [], pagos: [] };
  const ids = filas.map((v) => v.id);
  const [cobros, pagos, empresas, nom] = await Promise.all([
    porIds<FilaCobro>("crm_cobros", "id, venta_id, fecha_efectiva, importe, medio, referencia, concepto, registrado_en, anulado_en, anulado_motivo", "venta_id", ids),
    porIds<FilaPago>("crm_comision_pagos", "id, venta_id, beneficiario_id, fecha, importe, referencia, registrado_en, anulado_en, anulado_motivo", "venta_id", ids),
    porIds<{ id: string; nombre_comercial: string }>("crm_empresas", "id, nombre_comercial", "id", filas.map((v) => v.empresa_id)),
    mapa ? Promise.resolve(mapa) : nombres(ADMIN),
  ]);
  const empresa = new Map(empresas.map((e) => [e.id, e.nombre_comercial]));
  const ventas = filas.map((v) => {
    const importe = c(v.importe);
    const cobrado = cobros.filter((x) => x.venta_id === v.id && !x.anulado_en).reduce((s, x) => s + c(x.importe), 0);
    const pagosVig = pagos.filter((x) => x.venta_id === v.id && !x.anulado_en).map((x) => ({ importe: c(x.importe), beneficiario_id: x.beneficiario_id }));
    const pactada = v.comision_importe === null ? null : c(v.comision_importe);
    const com = estadoComision({ tipo: v.comision_tipo, pactada, beneficiario_id: v.comision_beneficiario_id, importe, cobrado, pagos: pagosVig });
    const fila: Omit<VentaFila, "pendientes"> = {
      id: v.id, version: v.version, oportunidad_id: v.oportunidad_id, es_recompra: v.es_recompra, fecha_acuerdo: v.fecha_acuerdo, registrada_en: v.registrada_en,
      empresa: { id: v.empresa_id, nombre: empresa.get(v.empresa_id) ?? "Negocio" },
      producto: { codigo: v.producto_codigo, nombre: v.producto_nombre }, experiencias: v.experiencias, duracion_minutos: v.duracion_minutos,
      importe, cobrado, saldo: importe - cobrado, anticipo_esperado: anticipoEsperado(importe), estado_cobro: estadoCobro(importe, cobrado),
      comision: {
        tipo: v.comision_tipo, fundamento: v.comision_fundamento, detalle: v.comision_detalle, pactada,
        beneficiario: v.comision_beneficiario_id ? { id: v.comision_beneficiario_id, nombre: nom.get(v.comision_beneficiario_id) ?? "Comercial" } : null,
        pagado: com.pagado, pendiente: com.pendiente, estado: com.estado, motivos: com.motivos,
      },
      entrega: { estado: v.entrega_estado, fecha: v.entrega_fecha },
      campania_id: v.campania_id,
      anulada: v.anulada_en ? { en: v.anulada_en, motivo: v.anulada_motivo ?? "" } : null,
    };
    return { ...fila, pendientes: pendientesDe(fila) };
  });
  return { ventas, cobros, pagos };
}

/** Venta vigente de una oportunidad (el detalle del seguimiento la resume y enlaza). */
export async function ventaDeOportunidad(oportunidadId: string): Promise<VentaFila | null> {
  const r = await supabaseAdmin.from("crm_ventas").select(COLS_VENTA).eq("oportunidad_id", oportunidadId).is("anulada_en", null).maybeSingle();
  const v = revisar(r, "venta") as unknown as FilaVenta | null;
  return v ? (await armarVentas([v])).ventas[0] : null;
}

// ── Catálogo ────────────────────────────────────────────────────────────────
export async function productos(soloActivos = false): Promise<Producto[]> {
  const r = await supabaseAdmin.from("crm_productos")
    .select("codigo, nombre, experiencias, minimo_experiencias, duracion_minutos, precio, comision_estandar, activo, orden, version").order("orden");
  const filas = (revisar(r, "productos") ?? []) as Array<Omit<Producto, "precio" | "comision_estandar"> & { precio: number | string | null; comision_estandar: number | string | null }>;
  return filas.filter((p) => !soloActivos || p.activo).map((p) => ({ ...p, precio: aCentavos(p.precio), comision_estandar: aCentavos(p.comision_estandar) }));
}

// ── Lista ───────────────────────────────────────────────────────────────────
export type VentasDto = {
  hoy: string;
  filas: VentaFila[];
  totales: ReturnType<typeof totalesVentas>;
  /** Cuántas ventas de la lista (filtrada, sin el filtro de pendiente) tienen cada pendiente. */
  pendientes: Record<Pendiente, number>;
  opciones: { productos: Array<{ codigo: string; nombre: string }> };
};

/** Lista de ventas. Los totales salen de la MISMA lista filtrada que se muestra (sin anuladas). */
export async function listarVentas(f: FiltrosVentas): Promise<VentasDto> {
  let q = supabaseAdmin.from("crm_ventas").select(COLS_VENTA).order("fecha_acuerdo", { ascending: false }).order("registrada_en", { ascending: false }).limit(1000);
  if (f.desde) q = q.gte("fecha_acuerdo", f.desde);
  if (f.hasta) q = q.lte("fecha_acuerdo", f.hasta);
  if (f.empresa) q = q.eq("empresa_id", f.empresa);
  if (f.producto) q = q.eq("producto_codigo", f.producto);
  if (!f.anuladas) q = q.is("anulada_en", null);
  const filas = (revisar(await q, "ventas") ?? []) as unknown as FilaVenta[];
  const [{ ventas }, prods] = await Promise.all([armarVentas(filas), productos()]);
  const lista = filtrarVentas(ventas, f);
  const base = filtrarVentas(ventas, { ...f, pendiente: undefined });
  const pendientes = Object.fromEntries(PENDIENTES.map((p) => [p.valor, base.filter((v) => v.pendientes.includes(p.valor)).length])) as Record<Pendiente, number>;
  return { hoy: hoyEnSim(), filas: lista, totales: totalesVentas(lista), pendientes, opciones: { productos: prods.map((p) => ({ codigo: p.codigo, nombre: p.nombre })) } };
}

// ── Campaña de Empresas (solo lectura) ─────────────────────────────────────
const COLS_CAMPANIA = "id, empresa, nombre_campania, estado, estado_pago, modalidad, cantidad_contratada, duracion_minutos, usos_por_codigo, fecha_inicio, fecha_vencimiento, deleted_at, created_at";
type FilaCampania = {
  id: string; empresa: string; nombre_campania: string | null; estado: string; estado_pago: string; modalidad: string; cantidad_contratada: number;
  duracion_minutos: number; usos_por_codigo: number; fecha_inicio: string | null; fecha_vencimiento: string | null; deleted_at: string | null; created_at: string;
};

export async function campaniaLectura(id: string): Promise<CampaniaLectura | null> {
  if (!esUuid(id)) return null;
  const k = revisar(await supabaseAdmin.from("empresa_campanias").select(COLS_CAMPANIA).eq("id", id).maybeSingle(), "campaña") as FilaCampania | null;
  if (!k) return null;
  // De los códigos solo el estado y los usos; de los canjes, solo cuántos hay (no
  // se leen beneficiarios ni los códigos en sí).
  const [cods, usos] = await Promise.all([
    supabaseAdmin.from("empresa_codigos").select("estado, usos_actuales, usos_maximos").eq("campania_id", id),
    supabaseAdmin.from("empresa_codigo_usos").select("id", { count: "exact", head: true }).eq("campania_id", id),
  ]);
  if (usos.error) throw new Error(`canjes: ${usos.error.message}`);
  const hoy = hoyEnSim();
  const m = metricasCampania({ campania: k, codigos: (revisar(cods, "códigos") ?? []) as Array<{ estado: string; usos_actuales: number; usos_maximos: number }>, usos: Array.from({ length: usos.count ?? 0 }), hoy });
  return {
    id: k.id, empresa: k.empresa, nombre: k.nombre_campania, estado: estadoEfectivo(k, hoy), estado_pago: k.estado_pago, modalidad: k.modalidad,
    cantidad_contratada: k.cantidad_contratada, duracion_minutos: k.duracion_minutos, usos_por_codigo: k.usos_por_codigo,
    fecha_inicio: k.fecha_inicio, fecha_vencimiento: k.fecha_vencimiento, eliminada: !!k.deleted_at,
    codigos: { generados: m.generados, disponibles: m.disponibles, utilizados: m.utilizados, vencidos: m.vencidos, cancelados: m.cancelados },
    usos: m.usados,
  };
}

export type CampaniaCandidata = {
  id: string; empresa: string; nombre: string | null; estado: string; cantidad_contratada: number; duracion_minutos: number;
  fecha_vencimiento: string | null; creada_en: string; vinculada_a: { venta_id: string; empresa: string } | null;
};

/** Búsqueda de campañas para vincular (no eliminadas). Marca las que ya tienen una venta vigente. */
export async function buscarCampanias(texto: string): Promise<CampaniaCandidata[]> {
  const t = texto.replace(/[%_,()]/g, " ").trim().slice(0, 60);
  let q = supabaseAdmin.from("empresa_campanias").select(COLS_CAMPANIA).is("deleted_at", null).order("created_at", { ascending: false }).limit(20);
  if (t) q = q.or(`empresa.ilike.%${t}%,nombre_campania.ilike.%${t}%`);
  const filas = (revisar(await q, "campañas") ?? []) as FilaCampania[];
  const ventas = await porIds<{ id: string; campania_id: string; empresa_id: string; anulada_en: string | null }>(
    "crm_ventas", "id, campania_id, empresa_id, anulada_en", "campania_id", filas.map((k) => k.id));
  const vig = ventas.filter((v) => !v.anulada_en);
  const empresas = await porIds<{ id: string; nombre_comercial: string }>("crm_empresas", "id, nombre_comercial", "id", vig.map((v) => v.empresa_id));
  const hoy = hoyEnSim();
  return filas.map((k) => {
    const v = vig.find((x) => x.campania_id === k.id);
    return {
      id: k.id, empresa: k.empresa, nombre: k.nombre_campania, estado: estadoEfectivo(k, hoy), cantidad_contratada: k.cantidad_contratada,
      duracion_minutos: k.duracion_minutos, fecha_vencimiento: k.fecha_vencimiento, creada_en: k.created_at,
      vinculada_a: v ? { venta_id: v.id, empresa: empresas.find((e) => e.id === v.empresa_id)?.nombre_comercial ?? "Negocio" } : null,
    };
  });
}

// ── Detalle ─────────────────────────────────────────────────────────────────
export type CobroDto = {
  id: string; fecha_efectiva: string; importe: Centavos; medio: string; referencia: string | null; concepto: string; registrado_en: string;
  anulado: { en: string; motivo: string } | null;
};
export type PagoComisionDto = {
  id: string; beneficiario: { id: string; nombre: string }; fecha: string; importe: Centavos; referencia: string | null; registrado_en: string;
  anulado: { en: string; motivo: string } | null;
};
export type CorreccionDto = { en: string; accion: string; datos: Record<string, unknown> };
export type DetalleVentaDto = {
  hoy: string;
  venta: VentaFila & {
    ciclo: number; observacion: string | null; precio_catalogo: Centavos | null; comision_catalogo: Centavos | null; entrega_detalle: string | null;
    campania_vinculada_en: string | null;
  };
  oportunidad: { id: string; estado: string; origen_tipo: "visita" | "recompra_admin"; origen: { id: string; nombre: string } | null; lead_en: string; ganada_en: string | null };
  intervencion: { tipo: "visita" | "actividad"; id: string; en: string; descripcion: string } | null;
  cobros: CobroDto[];
  pagos: PagoComisionDto[];
  campania: (CampaniaLectura & { avisos: string[] }) | null;
  historial: CorreccionDto[];
  /** Otra oportunidad abierta del negocio: impide anular (dejaría dos abiertas). */
  otra_abierta: boolean;
  minimo_experiencias: number | null;
};

export async function detalleVenta(id: string): Promise<DetalleVentaDto | null> {
  if (!esUuid(id)) return null;
  const v = revisar(await supabaseAdmin.from("crm_ventas").select(COLS_VENTA).eq("id", id).maybeSingle(), "venta") as unknown as FilaVenta | null;
  if (!v) return null;
  const mapa = await nombres(ADMIN);
  const [{ ventas, cobros, pagos }, o, aud, abiertas, prods] = await Promise.all([
    armarVentas([v], mapa),
    supabaseAdmin.from("crm_oportunidades").select("id, estado, origen_tipo, origen_usuario_id, lead_en, ganada_en").eq("id", v.oportunidad_id).single(),
    supabaseAdmin.from("crm_auditoria").select("en, accion, datos, entidad, entidad_id").eq("entidad", "crm_ventas").eq("entidad_id", id).order("en", { ascending: false }),
    supabaseAdmin.from("crm_oportunidades").select("id").eq("empresa_id", v.empresa_id).is("cerrada_en", null).neq("id", v.oportunidad_id).limit(1),
    productos(),
  ]);
  const opp = revisar(o, "oportunidad") as { id: string; estado: string; origen_tipo: "visita" | "recompra_admin"; origen_usuario_id: string | null; lead_en: string; ganada_en: string | null };
  let intervencion: DetalleVentaDto["intervencion"] = null;
  if (v.comision_intervencion_visita_id) {
    const x = revisar(await supabaseAdmin.from("crm_visitas").select("id, ocurrida_en, realizada_por_usuario, observacion").eq("id", v.comision_intervencion_visita_id).single(), "visita") as
      { id: string; ocurrida_en: string; realizada_por_usuario: string; observacion: string | null };
    intervencion = { tipo: "visita", id: x.id, en: x.ocurrida_en, descripcion: `Visita de ${mapa.get(x.realizada_por_usuario) ?? "Comercial"}${x.observacion ? ` · «${x.observacion}»` : ""}` };
  } else if (v.comision_intervencion_actividad_id) {
    const x = revisar(await supabaseAdmin.from("crm_actividades").select("id, tipo, ocurrida_en, observacion").eq("id", v.comision_intervencion_actividad_id).single(), "actividad") as
      { id: string; tipo: string; ocurrida_en: string; observacion: string | null };
    intervencion = { tipo: "actividad", id: x.id, en: x.ocurrida_en, descripcion: `Gestión «${x.tipo}»${x.observacion ? ` · ${x.observacion}` : ""}` };
  }
  const venta = ventas[0];
  const camp = v.campania_id ? await campaniaLectura(v.campania_id) : null;
  return {
    hoy: hoyEnSim(),
    venta: {
      ...venta, ciclo: v.ciclo, observacion: v.observacion, precio_catalogo: aCentavos(v.precio_catalogo), comision_catalogo: aCentavos(v.comision_catalogo),
      entrega_detalle: v.entrega_detalle, campania_vinculada_en: v.campania_vinculada_en,
    },
    oportunidad: {
      id: opp.id, estado: opp.estado, origen_tipo: opp.origen_tipo, lead_en: opp.lead_en, ganada_en: opp.ganada_en,
      origen: opp.origen_usuario_id ? { id: opp.origen_usuario_id, nombre: mapa.get(opp.origen_usuario_id) ?? "Comercial" } : null,
    },
    intervencion,
    cobros: cobros.sort((a, b) => b.fecha_efectiva.localeCompare(a.fecha_efectiva) || b.registrado_en.localeCompare(a.registrado_en)).map((x) => ({
      id: x.id, fecha_efectiva: x.fecha_efectiva, importe: c(x.importe), medio: x.medio, referencia: x.referencia, concepto: x.concepto,
      registrado_en: x.registrado_en, anulado: x.anulado_en ? { en: x.anulado_en, motivo: x.anulado_motivo ?? "" } : null,
    })),
    pagos: pagos.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.registrado_en.localeCompare(a.registrado_en)).map((x) => ({
      id: x.id, beneficiario: { id: x.beneficiario_id, nombre: mapa.get(x.beneficiario_id) ?? "Comercial" }, fecha: x.fecha, importe: c(x.importe),
      referencia: x.referencia, registrado_en: x.registrado_en, anulado: x.anulado_en ? { en: x.anulado_en, motivo: x.anulado_motivo ?? "" } : null,
    })),
    campania: camp ? { ...camp, avisos: avisosCampania(venta, camp) } : null,
    historial: ((revisar(aud, "auditoría") ?? []) as Array<{ en: string; accion: string; datos: Record<string, unknown> }>)
      .map((a) => ({ en: a.en, accion: a.accion, datos: a.datos })),
    otra_abierta: ((revisar(abiertas, "oportunidades") ?? []) as unknown[]).length > 0,
    minimo_experiencias: prods.find((p) => p.codigo === "personalizado")?.minimo_experiencias ?? null,
  };
}

// ── Formulario «Registrar venta» ───────────────────────────────────────────
export type FormularioVentaDto = {
  hoy: string;
  oportunidad: {
    id: string; version: number; estado: string; abierta: boolean; origen_tipo: "visita" | "recompra_admin";
    origen: { id: string; nombre: string } | null; inicio_ciclo: string;
  };
  empresa: { id: string; nombre: string; cliente_previo: boolean; responsable: { id: string; nombre: string } | null };
  es_recompra: boolean;
  venta_vigente: { id: string } | null;
  productos: Producto[];
  comerciales: Array<{ id: string; nombre: string; activo: boolean }>;
  intervenciones: Array<{ tipo: "visita" | "actividad"; id: string; en: string; usuario_id: string | null; descripcion: string }>;
  propuestas: Record<string, ComisionPropuesta>;
};

export async function formularioVenta(oportunidadId: string): Promise<FormularioVentaDto | null> {
  if (!esUuid(oportunidadId)) return null;
  const o = revisar(await supabaseAdmin.from("crm_oportunidades")
    .select("id, version, estado, cerrada_en, empresa_id, origen_tipo, origen_usuario_id, ciclo_inicio_en").eq("id", oportunidadId).maybeSingle(), "oportunidad") as
    { id: string; version: number; estado: string; cerrada_en: string | null; empresa_id: string; origen_tipo: "visita" | "recompra_admin"; origen_usuario_id: string | null; ciclo_inicio_en: string } | null;
  if (!o) return null;
  const [e, vig, vis, act, prods, us] = await Promise.all([
    supabaseAdmin.from("crm_empresas").select("id, nombre_comercial, cliente_previo, responsable_id").eq("id", o.empresa_id).single(),
    supabaseAdmin.from("crm_ventas").select("id, oportunidad_id").eq("empresa_id", o.empresa_id).is("anulada_en", null),
    supabaseAdmin.from("crm_visitas").select("id, ocurrida_en, realizada_por_usuario, observacion").eq("oportunidad_id", o.id).is("anulada_en", null).order("ocurrida_en", { ascending: false }),
    supabaseAdmin.from("crm_actividades").select("id, tipo, ocurrida_en, actor_usuario_id, observacion").eq("oportunidad_id", o.id).neq("tipo", "cambio_estado").order("ocurrida_en", { ascending: false }),
    productos(true),
    supabaseAdmin.from("crm_usuarios").select("id, nombre, activo").order("nombre"),
  ]);
  const emp = revisar(e, "empresa") as { id: string; nombre_comercial: string; cliente_previo: boolean; responsable_id: string | null };
  const vigentes = (revisar(vig, "ventas") ?? []) as Array<{ id: string; oportunidad_id: string }>;
  const comerciales = (revisar(us, "usuarios") ?? []) as Array<{ id: string; nombre: string; activo: boolean }>;
  const nombre = new Map(comerciales.map((u) => [u.id, u.nombre]));
  const esRecompra = emp.cliente_previo || vigentes.some((x) => x.oportunidad_id !== o.id);
  return {
    hoy: hoyEnSim(),
    oportunidad: {
      id: o.id, version: o.version, estado: o.estado, abierta: !o.cerrada_en, origen_tipo: o.origen_tipo,
      origen: o.origen_usuario_id ? { id: o.origen_usuario_id, nombre: nombre.get(o.origen_usuario_id) ?? "Comercial" } : null,
      inicio_ciclo: hoyEnSim(new Date(o.ciclo_inicio_en)),
    },
    empresa: {
      id: emp.id, nombre: emp.nombre_comercial, cliente_previo: emp.cliente_previo,
      responsable: emp.responsable_id ? { id: emp.responsable_id, nombre: nombre.get(emp.responsable_id) ?? "Comercial" } : null,
    },
    es_recompra: esRecompra,
    venta_vigente: vigentes.find((x) => x.oportunidad_id === o.id) ?? null,
    productos: prods,
    comerciales,
    intervenciones: [
      ...((revisar(vis, "visitas") ?? []) as Array<{ id: string; ocurrida_en: string; realizada_por_usuario: string; observacion: string | null }>).map((x) => ({
        tipo: "visita" as const, id: x.id, en: x.ocurrida_en, usuario_id: x.realizada_por_usuario,
        descripcion: `Visita de ${nombre.get(x.realizada_por_usuario) ?? "Comercial"}${x.observacion ? ` · «${x.observacion.slice(0, 80)}»` : ""}`,
      })),
      ...((revisar(act, "actividades") ?? []) as Array<{ id: string; tipo: string; ocurrida_en: string; actor_usuario_id: string | null; observacion: string | null }>).map((x) => ({
        tipo: "actividad" as const, id: x.id, en: x.ocurrida_en, usuario_id: x.actor_usuario_id,
        descripcion: `Gestión de Administración · ${x.tipo}${x.observacion ? ` · ${x.observacion.slice(0, 80)}` : ""}`,
      })),
    ],
    propuestas: Object.fromEntries(prods.map((p) => [p.codigo, comisionPropuesta({ esRecompra, origenUsuarioId: o.origen_usuario_id }, p, p.precio)])),
  };
}

// ── Historial de compras del negocio (ficha) ───────────────────────────────
export type ComprasNegocioDto = {
  cliente_previo: boolean;
  ventas: VentaFila[];
  resumen: ReturnType<typeof resumenCompras>;
  /** Se puede crear una oportunidad de recompra: compró antes, no está archivado y no hay otra abierta. */
  recompra: { posible: boolean; motivo: string | null };
};

export async function comprasNegocio(empresaId: string): Promise<ComprasNegocioDto | null> {
  if (!esUuid(empresaId)) return null;
  const e = revisar(await supabaseAdmin.from("crm_empresas").select("id, cliente_previo, archivada_en").eq("id", empresaId).maybeSingle(), "empresa") as
    { id: string; cliente_previo: boolean; archivada_en: string | null } | null;
  if (!e) return null;
  const [v, ab] = await Promise.all([
    supabaseAdmin.from("crm_ventas").select(COLS_VENTA).eq("empresa_id", empresaId).order("fecha_acuerdo", { ascending: false }),
    supabaseAdmin.from("crm_oportunidades").select("id").eq("empresa_id", empresaId).is("cerrada_en", null).limit(1),
  ]);
  const { ventas } = await armarVentas((revisar(v, "ventas") ?? []) as unknown as FilaVenta[]);
  const resumen = resumenCompras(ventas);
  const abierta = ((revisar(ab, "oportunidades") ?? []) as unknown[]).length > 0;
  const motivo = e.archivada_en ? "El negocio está archivado."
    : abierta ? "Ya hay una oportunidad abierta: seguila desde «Seguimiento»."
      : !e.cliente_previo && resumen.compras === 0 ? "Todavía no tiene compras registradas." : null;
  return { cliente_previo: e.cliente_previo, ventas, resumen, recompra: { posible: motivo === null, motivo } };
}

// ── Escrituras ──────────────────────────────────────────────────────────────
const huella = (x: unknown) => createHash("sha256").update(canonico(x)).digest("hex");

export type ResultadoVenta = { resultado: "ok"; repetida: boolean; venta: { id: string; version: number }; oportunidad: { id: string; estado: "ganada"; version: number } };
export type ResultadoGestionVenta =
  | { resultado: "ok"; repetida: boolean; id: string | null; venta: { id: string; version: number; cobrado: number; comision_pagada: number; anulada: boolean } }
  | { resultado: "posible_duplicado"; venta: { id: string; version: number } };
export type ResultadoRecompra = { resultado: "ok"; repetida: boolean; empresa_id: string; oportunidad: { id: string; estado: string; version: number } };

export const ACCIONES_VENTA = ["cobro", "anular_cobro", "pago_comision", "anular_pago_comision", "corregir", "anular", "entrega", "vincular_campania"] as const;
export type AccionVenta = (typeof ACCIONES_VENTA)[number];

/** Misma venta (oportunidad, versión vista y datos) → misma huella. */
export const huellaVenta = (oportunidad: string, version: number, datos: Record<string, unknown>) => huella({ oportunidad, version, datos });
export const huellaGestionVenta = (venta: string, version: number, accion: string, datos: Record<string, unknown>) => huella({ venta, version, accion, datos });
export const huellaRecompra = (empresa: string, datos: Record<string, unknown>) => huella({ empresa, datos });

export const registrarVenta = (clave: string, oportunidad: string, version: number, datos: Record<string, unknown>): Promise<R<ResultadoVenta>> =>
  rpc<ResultadoVenta>("crm_venta_registrar", {
    p_clave: clave, p_huella: huellaVenta(oportunidad, version, datos), p_oportunidad: oportunidad, p_version: version, p_datos: datos, ...actorRpc(ADMIN),
  });

export const gestionarVenta = (clave: string, venta: string, version: number, accion: AccionVenta, datos: Record<string, unknown>): Promise<R<ResultadoGestionVenta>> =>
  rpc<ResultadoGestionVenta>("crm_venta_gestionar", {
    p_clave: clave, p_huella: huellaGestionVenta(venta, version, accion, datos), p_venta: venta, p_version: version, p_accion: accion, p_datos: datos,
    ...actorRpc(ADMIN),
  });

export const crearRecompra = (clave: string, empresa: string, datos: Record<string, unknown>): Promise<R<ResultadoRecompra>> =>
  rpc<ResultadoRecompra>("crm_oportunidad_recompra", { p_clave: clave, p_huella: huellaRecompra(empresa, datos), p_empresa: empresa, p_datos: datos, ...actorRpc(ADMIN) });

export const actualizarProducto = (codigo: string, version: number, cambios: Record<string, unknown>) =>
  rpc<{ codigo: string; version: number }>("crm_producto_actualizar", { p_codigo: codigo, p_version: version, p_cambios: cambios, ...actorRpc(ADMIN) });

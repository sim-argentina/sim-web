// CRM B2B · B4 — carga de SERVIDOR para las métricas (solo Administración). Lo
// importa únicamente la ruta /api/admin/crm/metricas (con actorAdmin).
//
// Lee TODO lo que usan las métricas, de a páginas (todasLasFilas): ninguna cifra
// se calcula sobre un límite de filas. Solo lectura: no escribe nada ni corrige
// datos para que el tablero cierre. Las definiciones viven en lib/crmB4.ts (puro).
// No lee notas ni observaciones: nada privado viaja en el detalle.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { aCentavos } from "@/lib/crmB3";
import { catalogo, todasLasFilas } from "@/lib/crmB1Server";
import type { Ciclo, Cobro, DatosCrm, Empresa, Jornada, Oportunidad, Pago, Usuario, Venta, Visita } from "@/lib/crmB4";

type Num = number | string | null;
const cent = (v: Num) => (v === null ? null : aCentavos(v));
const todas = <T,>(tabla: string, cols: string) =>
  todasLasFilas<T>((a, b) => supabaseAdmin.from(tabla).select(cols).order("id").range(a, b), tabla);

export async function cargarDatos(): Promise<DatosCrm> {
  const [cat, empresas, usuarios, jornadas, visitas, oportunidades, ciclos, ventas, cobros, pagos] = await Promise.all([
    catalogo(false),
    todas<{ id: string; nombre_comercial: string; rubro_id: string | null; rubro_detalle: string | null; zona_id: string | null; cliente_previo: boolean; archivada_en: string | null }>(
      "crm_empresas", "id, nombre_comercial, rubro_id, rubro_detalle, zona_id, cliente_previo, archivada_en"),
    todas<Usuario>("crm_usuarios", "id, nombre"),
    todas<{ id: string; usuario_id: string; fecha: string; zona_id: string | null; cerrada_en: string | null; km_recorridos: Num; combustible_importe: Num;
      estacionamiento_importe: Num; peajes_importe: Num; otros_importe: Num }>(
      "crm_jornadas", "id, usuario_id, fecha, zona_id, cerrada_en, km_recorridos, combustible_importe, estacionamiento_importe, peajes_importe, otros_importe"),
    todas<{ id: string; empresa_id: string; jornada_id: string; oportunidad_id: string | null; realizada_por_usuario: string; fecha: string; ocurrida_en: string;
      hablo_con_responsable: boolean; decisor_contactado: boolean; contacto_util: boolean; interes: string | null; necesidades: string[] | null; pack_potencial: string | null; anulada_en: string | null }>(
      "crm_visitas", "id, empresa_id, jornada_id, oportunidad_id, realizada_por_usuario, fecha, ocurrida_en, hablo_con_responsable, decisor_contactado, contacto_util, interes, necesidades, pack_potencial, anulada_en"),
    todas<Oportunidad>("crm_oportunidades",
      "id, empresa_id, origen_tipo, origen_visita_id, origen_usuario_id, lead_en, estado, cierre_motivo, interesado_en, negociacion_en, perdida_en, perdida_motivo"),
    todas<Ciclo>("crm_oportunidad_ciclos", "oportunidad_id, ciclo, interesado_en, negociacion_en, perdida_en, perdida_motivo"),
    todas<{ id: string; oportunidad_id: string; empresa_id: string; es_recompra: boolean; fecha_acuerdo: string; producto_codigo: string; producto_nombre: string;
      experiencias: number; importe: Num; comision_tipo: "pactada" | "no_corresponde"; comision_importe: Num; comision_beneficiario_id: string | null;
      comision_fundamento: string; comision_intervencion_visita_id: string | null; anulada_en: string | null }>(
      "crm_ventas", "id, oportunidad_id, empresa_id, es_recompra, fecha_acuerdo, producto_codigo, producto_nombre, experiencias, importe, comision_tipo, comision_importe, comision_beneficiario_id, comision_fundamento, comision_intervencion_visita_id, anulada_en"),
    todas<{ id: string; venta_id: string; fecha_efectiva: string; importe: Num; concepto: string; registrado_en: string; anulado_en: string | null }>(
      "crm_cobros", "id, venta_id, fecha_efectiva, importe, concepto, registrado_en, anulado_en"),
    todas<{ id: string; venta_id: string; fecha: string; importe: Num; beneficiario_id: string; registrado_en: string; anulado_en: string | null }>(
      "crm_comision_pagos", "id, venta_id, fecha, importe, beneficiario_id, registrado_en, anulado_en"),
  ]);
  const rubro = new Map(cat.rubros.map((r) => [r.id, r.nombre]));
  const zona = new Map(cat.zonas.map((z) => [z.id, z.nombre]));
  return {
    empresas: empresas.map((e): Empresa => ({
      id: e.id, nombre: e.nombre_comercial, rubro_id: e.rubro_id, rubro: e.rubro_id ? rubro.get(e.rubro_id) ?? null : null,
      zona_id: e.zona_id, zona: e.zona_id ? zona.get(e.zona_id) ?? null : null, cliente_previo: e.cliente_previo, archivada: !!e.archivada_en,
    })),
    usuarios,
    jornadas: jornadas.map((j): Jornada => ({
      id: j.id, usuario_id: j.usuario_id, fecha: j.fecha, zona_id: j.zona_id, zona: j.zona_id ? zona.get(j.zona_id) ?? null : null, cerrada: !!j.cerrada_en,
      km: j.km_recorridos === null ? null : Number(j.km_recorridos),
      gastos: [cent(j.combustible_importe), cent(j.estacionamiento_importe), cent(j.peajes_importe), cent(j.otros_importe)],
    })),
    visitas: visitas.map((v): Visita => ({
      id: v.id, empresa_id: v.empresa_id, jornada_id: v.jornada_id, oportunidad_id: v.oportunidad_id, usuario_id: v.realizada_por_usuario, fecha: v.fecha,
      ocurrida_en: v.ocurrida_en, responsable: !!v.hablo_con_responsable, decisor: !!v.decisor_contactado, contacto_util: !!v.contacto_util, interes: v.interes,
      necesidades: v.necesidades ?? [], pack: v.pack_potencial, anulada: !!v.anulada_en,
    })),
    oportunidades,
    ciclos,
    ventas: ventas.map((v): Venta => ({
      id: v.id, oportunidad_id: v.oportunidad_id, empresa_id: v.empresa_id, es_recompra: v.es_recompra, fecha_acuerdo: v.fecha_acuerdo, producto_codigo: v.producto_codigo,
      producto_nombre: v.producto_nombre, experiencias: v.experiencias, importe: cent(v.importe) ?? 0, comision_tipo: v.comision_tipo, comision_importe: cent(v.comision_importe),
      beneficiario_id: v.comision_beneficiario_id, fundamento: v.comision_fundamento, intervencion_visita_id: v.comision_intervencion_visita_id, anulada: !!v.anulada_en,
    })),
    cobros: cobros.map((c): Cobro => ({ id: c.id, venta_id: c.venta_id, fecha: c.fecha_efectiva, importe: cent(c.importe) ?? 0, concepto: c.concepto, registrado_en: c.registrado_en, anulado: !!c.anulado_en })),
    pagos: pagos.map((p): Pago => ({ id: p.id, venta_id: p.venta_id, fecha: p.fecha, importe: cent(p.importe) ?? 0, beneficiario_id: p.beneficiario_id, registrado_en: p.registrado_en, anulado: !!p.anulado_en })),
    zonas: cat.zonas.map((z) => ({ id: z.id, nombre: z.nombre })),
    rubros: cat.rubros.map((r) => ({ id: r.id, nombre: r.nombre })),
  };
}

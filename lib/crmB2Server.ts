// CRM B2B · B2 — acceso de SERVIDOR al seguimiento comercial (solo Administración).
// Lo importan únicamente las rutas de /api/admin/crm (con actorAdmin): ningún dato
// de acá llega a la interfaz comercial. Escrituras: solo por la RPC
// crm_oportunidad_gestionar, con la huella calculada acá (nunca la manda el
// navegador). Lecturas: columnas explícitas; consultar no escribe nada (abrir una
// oportunidad no la marca como gestionada).

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim } from "@/lib/agenda";
import { canonico, type ContactoDto, type Interes, type Necesidad, type Pack, type VisitaDto } from "@/lib/crmB1";
import { COLS_VISITA, actorRpc, armarVisitas, catalogo, nombres, revisar, rpc, trozos, type FilaVisita, type R } from "@/lib/crmB1Server";
import {
  advertenciasDe, contar, filtrar, grupoDe, ordenar,
  type EstadoOportunidad, type Etapa, type FilaBandeja, type FiltrosBandeja, type Grupo, type Pendiente,
} from "@/lib/crmB2";

const ADMIN = { rol: "admin" } as const;
const COLS_OPP = "id, empresa_id, estado, estado_previo, version, ciclo, contacto_id, origen_usuario_id, origen_visita_id, lead_en, gestionada_en, "
  + "perdida_en, perdida_motivo, perdida_detalle, retomar_el, cerrada_en, cierre_motivo, ciclo_inicio_en, ciclo_estado_inicial, conversacion_en, "
  + "interesado_en, propuesta_en, negociacion_en, pausada_en, estado_al_perder";

type FilaOpp = {
  id: string; empresa_id: string; estado: EstadoOportunidad; estado_previo: Etapa | null; version: number; ciclo: number; contacto_id: string | null;
  origen_usuario_id: string; origen_visita_id: string; lead_en: string; gestionada_en: string | null; perdida_en: string | null;
  perdida_motivo: string | null; perdida_detalle: string | null; retomar_el: string | null; cerrada_en: string | null; cierre_motivo: string | null;
  ciclo_inicio_en: string; ciclo_estado_inicial: Etapa; conversacion_en: string | null; interesado_en: string | null; propuesta_en: string | null;
  negociacion_en: string | null; pausada_en: string | null; estado_al_perder: Etapa | null;
};

export type Vista = "abiertas" | "perdidas";

export type BandejaDto = {
  hoy: string;
  vista: Vista;
  conteos: Record<Grupo, number>;
  total: number;
  filas: FilaBandeja[];
  opciones: { origenes: Array<{ id: string; nombre: string }>; rubros: Array<{ id: string; nombre: string }>; zonas: Array<{ id: string; nombre: string }> };
};

type FiltroExtra = { nulo?: string; igual?: [string, string] };
async function porIds<T>(tabla: string, cols: string, campo: string, ids: string[], extra: FiltroExtra = {}): Promise<T[]> {
  const out: T[] = [];
  for (const t of trozos([...new Set(ids)])) {
    let q = supabaseAdmin.from(tabla).select(cols).in(campo, t);
    if (extra.nulo) q = q.is(extra.nulo, null);
    if (extra.igual) q = q.eq(extra.igual[0], extra.igual[1]);
    out.push(...((revisar(await q, tabla) ?? []) as T[]));
  }
  return out;
}

/** Filas de la bandeja (sin filtrar) para un conjunto de oportunidades. */
async function armarFilas(opps: FilaOpp[], hoy: string): Promise<FilaBandeja[]> {
  if (!opps.length) return [];
  const ids = opps.map((o) => o.id);
  const [empresas, contactos, visitas, actividades, pendientes, cat, mapa] = await Promise.all([
    porIds<{ id: string; nombre_comercial: string; rubro_id: string | null; rubro_detalle: string | null; zona_id: string | null; archivada_en: string | null }>(
      "crm_empresas", "id, nombre_comercial, rubro_id, rubro_detalle, zona_id, archivada_en", "id", opps.map((o) => o.empresa_id)),
    porIds<{ id: string; nombre: string | null; cargo: string | null; es_decisor: string; telefono: string | null; telefono_normalizado: string | null; archivado_en: string | null }>(
      "crm_contactos", "id, nombre, cargo, es_decisor, telefono, telefono_normalizado, archivado_en", "id", opps.map((o) => o.contacto_id).filter((x): x is string => !!x)),
    porIds<{ id: string; oportunidad_id: string; ocurrida_en: string; interes: Interes | null; necesidades: Necesidad[]; necesidad_otra: string | null; pack_potencial: Pack | null; observacion: string | null }>(
      "crm_visitas", "id, oportunidad_id, ocurrida_en, interes, necesidades, necesidad_otra, pack_potencial, observacion", "oportunidad_id", ids, { nulo: "anulada_en" }),
    porIds<{ oportunidad_id: string; tipo: string; ocurrida_en: string; estado_despues: string | null }>(
      "crm_actividades", "oportunidad_id, tipo, ocurrida_en, estado_despues", "oportunidad_id", ids),
    porIds<Pendiente & { oportunidad_id: string }>(
      "crm_seguimientos", "id, oportunidad_id, tipo, vence_el, descripcion", "oportunidad_id", ids, { igual: ["estado", "pendiente"] }),
    catalogo(false), nombres(ADMIN),
  ]);
  const notas = await porIds<{ visita_id: string; texto: string; creada_en: string }>(
    "crm_visita_notas", "visita_id, texto, creada_en", "visita_id", visitas.map((v) => v.id), { igual: ["creada_por_rol", "comercial"] });
  const empresaDe = new Map(empresas.map((e) => [e.id, e]));
  const contactoDe = new Map(contactos.map((c) => [c.id, c]));
  const pendienteDe = new Map(pendientes.map((p) => [p.oportunidad_id, p]));
  const visitasDe = new Map<string, typeof visitas>();
  for (const v of visitas) visitasDe.set(v.oportunidad_id, [...(visitasDe.get(v.oportunidad_id) ?? []), v]);
  const ultimaActividad = new Map<string, (typeof actividades)[number]>();
  for (const a of actividades) {
    const u = ultimaActividad.get(a.oportunidad_id);
    if (!u || a.ocurrida_en > u.ocurrida_en) ultimaActividad.set(a.oportunidad_id, a);
  }
  const visitaDeNota = new Map(visitas.map((v) => [v.id, v.oportunidad_id]));
  const notasDe = new Map<string, Array<{ texto: string; en: string }>>();
  for (const n of notas) {
    const op = visitaDeNota.get(n.visita_id)!;
    notasDe.set(op, [...(notasDe.get(op) ?? []), { texto: n.texto, en: n.creada_en }]);
  }
  return opps.map((o) => {
    const e = empresaDe.get(o.empresa_id)!;
    const c = o.contacto_id ? contactoDe.get(o.contacto_id) ?? null : null;
    const vs = (visitasDe.get(o.id) ?? []).sort((a, b) => b.ocurrida_en.localeCompare(a.ocurrida_en));
    const necesidades = [...new Set(vs.flatMap((v) => v.necesidades ?? []))].sort() as Necesidad[];
    const textos = [
      ...vs.filter((v) => v.observacion).map((v) => ({ texto: v.observacion as string, en: v.ocurrida_en })),
      ...(notasDe.get(o.id) ?? []),
    ].sort((a, b) => b.en.localeCompare(a.en));
    const p = pendienteDe.get(o.id) ?? null;
    const pendiente: Pendiente | null = p ? { id: p.id, tipo: p.tipo, vence_el: p.vence_el, descripcion: p.descripcion } : null;
    const empresa = {
      id: e.id, nombre: e.nombre_comercial, rubro_id: e.rubro_id, rubro: cat.rubros.find((r) => r.id === e.rubro_id)?.nombre ?? e.rubro_detalle,
      zona_id: e.zona_id, zona: cat.zonas.find((z) => z.id === e.zona_id)?.nombre ?? null, archivada: !!e.archivada_en,
    };
    const contacto = c ? {
      id: c.id, nombre: c.nombre, cargo: c.cargo, es_decisor: c.es_decisor, telefono: c.telefono, telefono_normalizado: c.telefono_normalizado,
      archivado: !!c.archivado_en,
    } : null;
    const ua = ultimaActividad.get(o.id);
    const abierta = !o.cerrada_en;
    return {
      id: o.id, version: o.version, ciclo: o.ciclo, estado: o.estado, estado_previo: o.estado_previo, empresa, contacto,
      necesidades, necesidad_otra: [...new Set(vs.map((v) => v.necesidad_otra).filter((x): x is string => !!x))],
      interes: vs.find((v) => v.interes)?.interes ?? null, pack: vs.find((v) => v.pack_potencial)?.pack_potencial ?? null,
      nota_comercial: textos[0] ?? null,
      origen: { usuario_id: o.origen_usuario_id, nombre: mapa.get(o.origen_usuario_id) ?? "Comercial", lead_en: o.lead_en },
      ultima_gestion: ua ? { tipo: ua.tipo, ocurrida_en: ua.ocurrida_en, estado_despues: ua.estado_despues } : null,
      pendiente, gestionada: !!o.gestionada_en,
      grupo: abierta ? grupoDe({ pendiente, gestionada: !!o.gestionada_en }, hoy) : "sin_proxima",
      advertencias: abierta ? advertenciasDe({ contacto, empresa }) : [],
      perdida: o.estado === "perdida" && o.perdida_en ? {
        en: o.perdida_en, motivo: o.perdida_motivo ?? "", detalle: o.perdida_detalle,
        visitas_posteriores: vs.filter((v) => v.ocurrida_en > (o.perdida_en as string)).length,
      } : null,
    } satisfies FilaBandeja;
  });
}

/**
 * Bandeja "Contactos para seguir". Vista general = oportunidades abiertas (incluye
 * pausadas y las de negocios archivados, con advertencia); vista "perdidas" = las
 * cerradas por pérdida. Los contadores salen de la MISMA lista filtrada que las
 * filas (contar(filtrar(...))); el grupo elegido solo recorta las filas.
 */
export async function bandeja(vista: Vista, f: FiltrosBandeja): Promise<BandejaDto> {
  const hoy = hoyEnSim();
  let q = supabaseAdmin.from("crm_oportunidades").select(COLS_OPP).order("lead_en").limit(1000);
  q = vista === "perdidas" ? q.eq("cierre_motivo", "perdida") : q.is("cerrada_en", null);
  const opps = (revisar(await q, "oportunidades") ?? []) as unknown as FilaOpp[];
  const todas = await armarFilas(opps, hoy);
  const filtradas = filtrar(todas, { ...f, grupo: undefined }, hoy);
  const conteos = contar(vista === "abiertas" ? filtradas : []);
  const filas = vista === "perdidas"
    ? [...filtradas].sort((a, b) => (b.perdida?.en ?? "").localeCompare(a.perdida?.en ?? ""))
    : ordenar(f.grupo ? filtradas.filter((o) => o.grupo === f.grupo) : filtradas);
  const [cat, mapa] = await Promise.all([catalogo(false), nombres(ADMIN)]);
  const origenes = [...new Set(todas.map((o) => o.origen.usuario_id))].map((id) => ({ id, nombre: mapa.get(id) ?? "Comercial" }));
  return {
    hoy, vista, conteos, total: filtradas.length, filas,
    opciones: { origenes, rubros: cat.rubros.map((r) => ({ id: r.id, nombre: r.nombre })), zonas: cat.zonas.map((z) => ({ id: z.id, nombre: z.nombre })) },
  };
}

// ── Detalle ─────────────────────────────────────────────────────────────────
export type ActividadDto = {
  id: string; ciclo: number; tipo: string; contacto: { id: string; nombre: string | null } | null; ocurrida_en: string; registrada_en: string;
  observacion: string | null; estado_antes: string | null; estado_despues: string | null; motivo: string | null;
};
export type SeguimientoDto = {
  id: string; ciclo: number; tipo: "seguimiento" | "retomar"; vence_el: string; descripcion: string | null; estado: "pendiente" | "hecha" | "reprogramada" | "cancelada";
  anterior_id: string | null; creada_en: string; cerrada_en: string | null; resuelta_por_actividad_id: string | null; cancelada_motivo: string | null;
};
export type CicloDto = {
  ciclo: number; inicio_en: string; estado_inicial: string; conversacion_en: string | null; interesado_en: string | null; propuesta_en: string | null;
  negociacion_en: string | null; estado_al_perder: string; perdida_en: string; perdida_motivo: string; perdida_detalle: string | null;
  reabierta_en: string; reapertura_motivo: string;
};
export type DetalleOportunidadDto = {
  hoy: string;
  fila: FilaBandeja;
  oportunidad: Pick<FilaOpp, "lead_en" | "ciclo_inicio_en" | "ciclo_estado_inicial" | "conversacion_en" | "interesado_en" | "propuesta_en"
    | "negociacion_en" | "pausada_en" | "retomar_el" | "gestionada_en" | "estado_al_perder" | "cerrada_en" | "cierre_motivo" | "origen_visita_id">;
  contactos: ContactoDto[];
  visitas: VisitaDto[];
  actividades: ActividadDto[];
  seguimientos: SeguimientoDto[];
  ciclos: CicloDto[];
};

export async function detalleOportunidad(id: string): Promise<DetalleOportunidadDto | null> {
  const o = revisar(await supabaseAdmin.from("crm_oportunidades").select(COLS_OPP).eq("id", id).maybeSingle(), "oportunidad") as unknown as FilaOpp | null;
  if (!o) return null;
  const hoy = hoyEnSim();
  const [filas, c, v, a, s, ci, mapa] = await Promise.all([
    armarFilas([o], hoy),
    supabaseAdmin.from("crm_contactos").select("id, nombre, cargo, telefono, telefono_normalizado, tiene_whatsapp, es_decisor, archivado_en, version")
      .eq("empresa_id", o.empresa_id).order("creado_en"),
    supabaseAdmin.from("crm_visitas").select(COLS_VISITA).eq("oportunidad_id", id).order("ocurrida_en", { ascending: false }).limit(100),
    supabaseAdmin.from("crm_actividades").select("id, ciclo, tipo, contacto_id, ocurrida_en, registrada_en, observacion, estado_antes, estado_despues, motivo")
      .eq("oportunidad_id", id).order("ocurrida_en", { ascending: false }),
    supabaseAdmin.from("crm_seguimientos").select("id, ciclo, tipo, vence_el, descripcion, estado, anterior_id, creada_en, cerrada_en, resuelta_por_actividad_id, cancelada_motivo")
      .eq("oportunidad_id", id).order("creada_en", { ascending: false }),
    supabaseAdmin.from("crm_oportunidad_ciclos").select("ciclo, inicio_en, estado_inicial, conversacion_en, interesado_en, propuesta_en, negociacion_en, estado_al_perder, perdida_en, perdida_motivo, perdida_detalle, reabierta_en, reapertura_motivo")
      .eq("oportunidad_id", id).order("ciclo"),
    nombres(ADMIN),
  ]);
  const contactos = ((revisar(c, "contactos") ?? []) as Array<ContactoDto & { archivado_en: string | null }>).map((x) => ({
    id: x.id, nombre: x.nombre, cargo: x.cargo, telefono: x.telefono, telefono_normalizado: x.telefono_normalizado, tiene_whatsapp: x.tiene_whatsapp,
    es_decisor: x.es_decisor, archivado: !!x.archivado_en, version: x.version,
  }));
  const nombreContacto = new Map(contactos.map((x) => [x.id, x.nombre]));
  return {
    hoy, fila: filas[0],
    oportunidad: {
      lead_en: o.lead_en, ciclo_inicio_en: o.ciclo_inicio_en, ciclo_estado_inicial: o.ciclo_estado_inicial, conversacion_en: o.conversacion_en,
      interesado_en: o.interesado_en, propuesta_en: o.propuesta_en, negociacion_en: o.negociacion_en, pausada_en: o.pausada_en, retomar_el: o.retomar_el,
      gestionada_en: o.gestionada_en, estado_al_perder: o.estado_al_perder, cerrada_en: o.cerrada_en, cierre_motivo: o.cierre_motivo,
      origen_visita_id: o.origen_visita_id,
    },
    contactos,
    visitas: await armarVisitas(ADMIN, (revisar(v, "visitas") ?? []) as FilaVisita[], mapa, false),
    actividades: ((revisar(a, "actividades") ?? []) as Array<Omit<ActividadDto, "contacto"> & { contacto_id: string | null }>).map(({ contacto_id, ...x }) => ({
      ...x, contacto: contacto_id ? { id: contacto_id, nombre: nombreContacto.get(contacto_id) ?? null } : null,
    })),
    seguimientos: (revisar(s, "seguimientos") ?? []) as SeguimientoDto[],
    ciclos: (revisar(ci, "ciclos") ?? []) as CicloDto[],
  };
}

// ── Gestión ─────────────────────────────────────────────────────────────────
export const ACCIONES = ["gestion", "programar", "reprogramar", "pausar", "retomar", "perder", "reabrir", "contacto_principal"] as const;
export type Accion = (typeof ACCIONES)[number];

export type ResultadoGestion = {
  resultado: "ok"; repetida: boolean;
  oportunidad: { id: string; estado: EstadoOportunidad; version: number; ciclo: number };
  actividad_id: string | null;
  seguimiento: Pendiente | null;
};

/** Misma operación (oportunidad, versión vista, acción y datos) → misma huella. */
export function huellaGestion(oportunidad: string, version: number, accion: string, datos: Record<string, unknown>): string {
  return createHash("sha256").update(canonico({ oportunidad, version, accion, datos })).digest("hex");
}

export function gestionar(clave: string, oportunidad: string, version: number, accion: Accion, datos: Record<string, unknown>): Promise<R<ResultadoGestion>> {
  return rpc<ResultadoGestion>("crm_oportunidad_gestionar", {
    p_clave: clave, p_huella: huellaGestion(oportunidad, version, accion, datos), p_oportunidad: oportunidad, p_version: version,
    p_accion: accion, p_datos: datos, ...actorRpc(ADMIN),
  });
}

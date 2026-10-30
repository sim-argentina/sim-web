// CRM B2B · B1 — acceso de SERVIDOR (service_role). Solo lo importan las rutas de
// /comercial/api y /api/admin/crm (vía lib/crmB1Rutas.ts).
//
// Escrituras: siempre por las RPCs de db/crm-b1-prospeccion.sql, con el actor que
// verificó la sesión (nunca del formulario). Lecturas: columnas explícitas y ALCANCE
// aplicado acá: el comercial solo ve negocios con responsable = él y no archivados,
// sus jornadas, sus revisitas y sus visitas; un ID ajeno devuelve null (404), igual
// que uno inexistente. A un comercial nunca se le devuelve el nombre de otro
// comercial: aparece como "Otro comercial".

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim } from "@/lib/agenda";
import { causaPg } from "@/lib/crmUsuarios";
import {
  armarDatosVisita, canonico, errorDeRpcCrm, esUuid, normalizarTexto, pendientesJornada,
  type Autor, type Catalogo, type ContactoDto, type EmpresaDto, type ErrorCrm, type EstadoNegocio, type FichaEmpresaDto,
  type InicioDto, type JornadaDto, type OportunidadDto, type ResultadoVisita, type TareaDto, type VisitaDto,
} from "@/lib/crmB1";

export type ActorRpc = { rol: "admin" } | { rol: "comercial"; usuarioId: string };
export type R<T> = { ok: true; valor: T } | { ok: false; e: ErrorCrm | null; causa?: string };

export const actorRpc = (a: ActorRpc) => ({ p_actor_rol: a.rol, p_actor_usuario: a.rol === "comercial" ? a.usuarioId : null });
const esComercial = (a: ActorRpc): a is { rol: "comercial"; usuarioId: string } => a.rol === "comercial";

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<R<T>> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) {
    const e = errorDeRpcCrm(error);
    return e ? { ok: false, e } : { ok: false, e: null, causa: `${fn}: ${causaPg(error)}` };
  }
  return { ok: true, valor: data as T };
}

export function revisar<T>(r: { data: T | null; error: { code?: string | null; message?: string | null } | null }, que: string): T {
  if (r.error) throw new Error(`${que}: ${causaPg(r.error)}`);
  return r.data as T;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const trozos = <T,>(xs: T[], n = 100): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ── Catálogo y nombres ──────────────────────────────────────────────────────
export async function catalogo(soloActivos: boolean): Promise<Catalogo> {
  const [r, z] = await Promise.all([
    supabaseAdmin.from("crm_rubros").select("id, nombre, activo, orden, version").order("orden").order("nombre"),
    supabaseAdmin.from("crm_zonas").select("id, nombre, activo, orden, version").order("orden").order("nombre"),
  ]);
  const rubros = revisar(r, "rubros") ?? [];
  const zonas = revisar(z, "zonas") ?? [];
  return {
    rubros: (soloActivos ? rubros.filter((x) => x.activo) : rubros) as Catalogo["rubros"],
    zonas: (soloActivos ? zonas.filter((x) => x.activo) : zonas) as Catalogo["zonas"],
  };
}

export async function usuariosComerciales(): Promise<Array<{ id: string; nombre: string; activo: boolean }>> {
  const r = await supabaseAdmin.from("crm_usuarios").select("id, nombre, activo").order("nombre");
  return (revisar(r, "usuarios") ?? []) as Array<{ id: string; nombre: string; activo: boolean }>;
}

export async function nombres(actor: ActorRpc): Promise<Map<string, string>> {
  if (esComercial(actor)) return new Map();
  return new Map((await usuariosComerciales()).map((u) => [u.id, u.nombre]));
}

function autorDe(actor: ActorRpc, rol: string | null, usuarioId: string | null, mapa: Map<string, string>): Autor {
  if (rol === "admin" && !usuarioId) return { tipo: "admin", nombre: "Administración" };
  if (esComercial(actor)) return usuarioId === actor.usuarioId ? { tipo: "vos", nombre: "Vos" } : { tipo: "otro", nombre: "Otro comercial" };
  return { tipo: "comercial", nombre: (usuarioId && mapa.get(usuarioId)) || "Comercial" };
}

// ── Negocios ────────────────────────────────────────────────────────────────
const COLS_EMPRESA = "id, nombre_comercial, rubro_id, rubro_detalle, direccion, zona_id, instagram, web, prioridad, responsable_id, cliente_previo, origen, similar_a, archivada_en, archivada_motivo, version";

type FilaEmpresa = {
  id: string; nombre_comercial: string; rubro_id: string | null; rubro_detalle: string | null; direccion: string | null; zona_id: string | null;
  instagram: string | null; web: string | null; prioridad: "A" | "B" | "C" | null; responsable_id: string | null; cliente_previo: boolean;
  origen: string; similar_a: string[]; archivada_en: string | null; archivada_motivo: string | null; version: number;
};
type Estadistica = { visitas: number; ultima: string | null; oportunidad: boolean; revisita: string | null | false };

async function estadisticas(ids: string[]): Promise<Map<string, Estadistica>> {
  const m = new Map<string, Estadistica>(ids.map((id) => [id, { visitas: 0, ultima: null, oportunidad: false, revisita: false }]));
  for (const t of trozos(ids)) {
    const [v, o, ta] = await Promise.all([
      supabaseAdmin.from("crm_visitas").select("empresa_id, ocurrida_en").in("empresa_id", t).is("anulada_en", null),
      supabaseAdmin.from("crm_oportunidades").select("empresa_id").in("empresa_id", t).is("cerrada_en", null),
      supabaseAdmin.from("crm_tareas").select("empresa_id, vence_el").in("empresa_id", t).eq("estado", "pendiente"),
    ]);
    for (const x of revisar(v, "visitas") ?? []) {
      const s = m.get(x.empresa_id)!;
      s.visitas++;
      if (!s.ultima || x.ocurrida_en > s.ultima) s.ultima = x.ocurrida_en;
    }
    for (const x of revisar(o, "oportunidades") ?? []) m.get(x.empresa_id)!.oportunidad = true;
    for (const x of revisar(ta, "tareas") ?? []) m.get(x.empresa_id)!.revisita = x.vence_el ?? null;
  }
  return m;
}

function estadoDe(e: FilaEmpresa, s: Estadistica): EstadoNegocio {
  if (e.archivada_en) return "archivado";
  if (s.oportunidad) return "con_oportunidad";
  return s.visitas > 0 ? "visitado" : "por_visitar";
}

function dtoEmpresa(actor: ActorRpc, e: FilaEmpresa, s: Estadistica, cat: Catalogo, mapa: Map<string, string>): EmpresaDto {
  const base: EmpresaDto = {
    id: e.id, nombre_comercial: e.nombre_comercial, rubro_id: e.rubro_id, rubro: cat.rubros.find((r) => r.id === e.rubro_id)?.nombre ?? null,
    rubro_detalle: e.rubro_detalle, direccion: e.direccion, zona_id: e.zona_id, zona: cat.zonas.find((z) => z.id === e.zona_id)?.nombre ?? null,
    instagram: e.instagram, web: e.web, prioridad: e.prioridad, cliente_previo: e.cliente_previo, version: e.version, estado: estadoDe(e, s),
    visitas: s.visitas, ultima_visita: s.ultima, revisita_pendiente: s.revisita,
  };
  if (esComercial(actor)) return base;
  return {
    ...base,
    responsable: e.responsable_id ? { id: e.responsable_id, nombre: mapa.get(e.responsable_id) ?? "Comercial" } : null,
    posible_duplicado: (e.similar_a ?? []).length > 0, origen: e.origen, archivada_motivo: e.archivada_motivo,
  };
}

export type FiltrosEmpresas = {
  q?: string | null; responsable?: string | null; rubro?: string | null; zona?: string | null; prioridad?: string | null;
  estado?: string | null; archivadas?: boolean; duplicados?: boolean;
};

export async function listarEmpresas(actor: ActorRpc, f: FiltrosEmpresas = {}): Promise<EmpresaDto[]> {
  let q = supabaseAdmin.from("crm_empresas").select(COLS_EMPRESA).order("nombre_comercial").limit(300);
  if (esComercial(actor)) {
    q = q.eq("responsable_id", actor.usuarioId).is("archivada_en", null);
  } else {
    if (!f.archivadas && f.estado !== "archivado") q = q.is("archivada_en", null);
    if (f.estado === "archivado") q = q.not("archivada_en", "is", null);
    if (f.responsable === "sin_asignar") q = q.is("responsable_id", null);
    else if (esUuid(f.responsable)) q = q.eq("responsable_id", f.responsable);
    if (f.duplicados) q = q.neq("similar_a", "{}");
  }
  if (f.rubro === "sin_clasificar") q = q.is("rubro_id", null);
  else if (esUuid(f.rubro)) q = q.eq("rubro_id", f.rubro);
  if (esUuid(f.zona)) q = q.eq("zona_id", f.zona);
  if (f.prioridad && ["A", "B", "C"].includes(f.prioridad)) q = q.eq("prioridad", f.prioridad);
  const busca = normalizarTexto(f.q).slice(0, 60);
  if (busca) q = q.ilike("nombre_normalizado", `%${busca}%`);
  const filas = (revisar(await q, "empresas") ?? []) as FilaEmpresa[];
  const [s, cat, mapa] = await Promise.all([estadisticas(filas.map((e) => e.id)), catalogo(false), nombres(actor)]);
  const out = filas.map((e) => dtoEmpresa(actor, e, s.get(e.id)!, cat, mapa));
  return f.estado && f.estado !== "archivado" ? out.filter((e) => e.estado === f.estado) : out;
}

// ── Visitas (DTO) ───────────────────────────────────────────────────────────
export const COLS_VISITA = "id, empresa_id, jornada_id, oportunidad_id, realizada_por_usuario, registrada_por_rol, registrada_por_usuario, ocurrida_en, fecha, cerrado, hablo_con_empleado, hablo_con_responsable, responsable_ausente, contacto_id, contacto_obtenido, hablo_con_contacto, contacto_util, decisor_contactado, interes, necesidades, necesidad_otra, pack_potencial, volver_otro_dia, revisita_para, observacion, anulada_en, anulada_motivo, version";
export type FilaVisita = Record<string, unknown> & {
  id: string; empresa_id: string; jornada_id: string; oportunidad_id: string | null; realizada_por_usuario: string; registrada_por_rol: string;
  registrada_por_usuario: string | null; contacto_id: string | null; anulada_en: string | null; anulada_motivo: string | null;
};

export async function armarVisitas(actor: ActorRpc, filas: FilaVisita[], mapa: Map<string, string>, conEmpresa: boolean): Promise<VisitaDto[]> {
  const ids = filas.map((v) => v.id);
  const contactoIds = [...new Set(filas.map((v) => v.contacto_id).filter((x): x is string => !!x))];
  const empresaIds = [...new Set(filas.map((v) => v.empresa_id))];
  const oppIds = [...new Set(filas.map((v) => v.oportunidad_id).filter((x): x is string => !!x))];
  const contactos = new Map<string, { nombre: string | null; cargo: string | null }>();
  const notas = new Map<string, VisitaDto["notas"]>();
  const empresas = new Map<string, string>();
  const origenes = new Set<string>();
  for (const t of trozos(contactoIds)) {
    for (const c of revisar(await supabaseAdmin.from("crm_contactos").select("id, nombre, cargo").in("id", t), "contactos") ?? []) contactos.set(c.id, c);
  }
  for (const t of trozos(ids)) {
    const r = await supabaseAdmin.from("crm_visita_notas").select("id, visita_id, texto, creada_en, creada_por_rol, creada_por_usuario").in("visita_id", t).order("creada_en");
    for (const n of revisar(r, "notas") ?? []) {
      const lista = notas.get(n.visita_id) ?? [];
      lista.push({ id: n.id, texto: n.texto, creada_en: n.creada_en, autor: autorDe(actor, n.creada_por_rol, n.creada_por_usuario, mapa) });
      notas.set(n.visita_id, lista);
    }
  }
  if (conEmpresa) {
    for (const t of trozos(empresaIds)) {
      for (const e of revisar(await supabaseAdmin.from("crm_empresas").select("id, nombre_comercial").in("id", t), "empresas") ?? []) empresas.set(e.id, e.nombre_comercial);
    }
  }
  for (const t of trozos(oppIds)) {
    for (const o of revisar(await supabaseAdmin.from("crm_oportunidades").select("origen_visita_id").in("id", t), "oportunidades") ?? []) origenes.add(o.origen_visita_id);
  }
  return filas.map((v) => ({
    id: v.id, empresa_id: v.empresa_id, ...(conEmpresa ? { empresa: empresas.get(v.empresa_id) ?? "" } : {}), jornada_id: v.jornada_id,
    ocurrida_en: v.ocurrida_en as string, fecha: v.fecha as string, cerrado: !!v.cerrado, hablo_con_empleado: !!v.hablo_con_empleado,
    hablo_con_responsable: !!v.hablo_con_responsable, responsable_ausente: !!v.responsable_ausente,
    contacto: v.contacto_id ? { id: v.contacto_id, ...(contactos.get(v.contacto_id) ?? { nombre: null, cargo: null }) } : null,
    contacto_obtenido: !!v.contacto_obtenido, hablo_con_contacto: !!v.hablo_con_contacto, contacto_util: !!v.contacto_util,
    decisor_contactado: !!v.decisor_contactado, interes: (v.interes as VisitaDto["interes"]) ?? null,
    necesidades: (v.necesidades as VisitaDto["necesidades"]) ?? [], necesidad_otra: (v.necesidad_otra as string) ?? null,
    pack_potencial: (v.pack_potencial as VisitaDto["pack_potencial"]) ?? null, volver_otro_dia: !!v.volver_otro_dia,
    revisita_para: (v.revisita_para as string) ?? null, observacion: (v.observacion as string) ?? null,
    realizada_por: autorDe(actor, "comercial", v.realizada_por_usuario, mapa),
    registrada_por: autorDe(actor, v.registrada_por_rol, v.registrada_por_usuario, mapa),
    es_origen_oportunidad: origenes.has(v.id), anulada: !!v.anulada_en,
    ...(esComercial(actor) ? {} : { anulada_motivo: v.anulada_motivo }),
    version: v.version as number, notas: notas.get(v.id) ?? [],
  }));
}

// ── Ficha de negocio ────────────────────────────────────────────────────────
export async function fichaEmpresa(actor: ActorRpc, id: string): Promise<FichaEmpresaDto | null> {
  if (!esUuid(id)) return null;
  const e = revisar(await supabaseAdmin.from("crm_empresas").select(COLS_EMPRESA).eq("id", id).maybeSingle(), "empresa") as FilaEmpresa | null;
  if (!e) return null;
  if (esComercial(actor) && (e.responsable_id !== actor.usuarioId || e.archivada_en)) return null;
  let qc = supabaseAdmin.from("crm_contactos").select("id, nombre, cargo, telefono, telefono_normalizado, tiene_whatsapp, es_decisor, archivado_en, version").eq("empresa_id", id).order("creado_en");
  if (esComercial(actor)) qc = qc.is("archivado_en", null);
  let qv = supabaseAdmin.from("crm_visitas").select(COLS_VISITA).eq("empresa_id", id).order("ocurrida_en", { ascending: false }).limit(100);
  if (esComercial(actor)) qv = qv.is("anulada_en", null);
  let qo = supabaseAdmin.from("crm_oportunidades").select("id, estado, cerrada_en, cierre_motivo, lead_en, interesado_en, origen_usuario_id, origen_visita_id").eq("empresa_id", id).order("creada_en", { ascending: false });
  // Comercial: resumen de la abierta y de las perdidas (estado, origen); nunca las
  // cerradas por anulación ni nada del seguimiento de Administración.
  if (esComercial(actor)) qo = qo.or("cerrada_en.is.null,cierre_motivo.eq.perdida");
  const [c, v, o, t, s, cat, mapa] = await Promise.all([
    qc, qv, qo,
    supabaseAdmin.from("crm_tareas").select("id, empresa_id, vence_el, estado, version, responsable_id").eq("empresa_id", id).eq("estado", "pendiente").maybeSingle(),
    estadisticas([id]), catalogo(false), nombres(actor),
  ]);
  const visitas = await armarVisitas(actor, (revisar(v, "visitas") ?? []) as FilaVisita[], mapa, false);
  const tarea = revisar(t, "tarea");
  const ficha: FichaEmpresaDto = {
    empresa: dtoEmpresa(actor, e, s.get(id)!, cat, mapa),
    contactos: (revisar(c, "contactos") ?? []).map((x) => ({
      id: x.id, nombre: x.nombre, cargo: x.cargo, telefono: x.telefono, telefono_normalizado: x.telefono_normalizado,
      tiene_whatsapp: x.tiene_whatsapp, es_decisor: x.es_decisor, archivado: !!x.archivado_en, version: x.version,
    })) as ContactoDto[],
    visitas,
    oportunidades: (revisar(o, "oportunidades") ?? []).map((x) => ({
      id: x.id, estado: x.estado, abierta: !x.cerrada_en, cierre_motivo: x.cierre_motivo, lead_en: x.lead_en,
      interesado_en: esComercial(actor) ? null : x.interesado_en,
      origen: autorDe(actor, "comercial", x.origen_usuario_id, mapa), origen_visita_id: x.origen_visita_id,
    })) as OportunidadDto[],
    revisita: tarea && (!esComercial(actor) || tarea.responsable_id === actor.usuarioId)
      ? { id: tarea.id, empresa_id: id, empresa: e.nombre_comercial, vence_el: tarea.vence_el, estado: tarea.estado, version: tarea.version,
          responsable: autorDe(actor, "comercial", tarea.responsable_id, mapa) }
      : null,
  };
  if (!esComercial(actor) && (e.similar_a ?? []).length) {
    const r = await supabaseAdmin.from("crm_empresas").select("id, nombre_comercial").in("id", e.similar_a);
    ficha.similares = (revisar(r, "similares") ?? []) as Array<{ id: string; nombre_comercial: string }>;
  }
  return ficha;
}

// ── Jornadas ────────────────────────────────────────────────────────────────
const COLS_JORNADA = "id, usuario_id, fecha, nombre, zona_id, abierta_en, cerrada_en, km_inicial, km_final, km_recorridos, combustible_cantidad, combustible_unidad, combustible_importe, estacionamiento_importe, peajes_importe, otros_importe, otros_detalle, version, creada_por_rol";
type FilaJornada = Record<string, unknown> & { id: string; usuario_id: string; zona_id: string | null; creada_por_rol: string };

async function armarJornadas(actor: ActorRpc, filas: FilaJornada[], mapa: Map<string, string>, cat: Catalogo): Promise<JornadaDto[]> {
  const cuenta = new Map<string, number>();
  for (const t of trozos(filas.map((j) => j.id))) {
    for (const v of revisar(await supabaseAdmin.from("crm_visitas").select("jornada_id").in("jornada_id", t).is("anulada_en", null), "visitas") ?? []) {
      cuenta.set(v.jornada_id, (cuenta.get(v.jornada_id) ?? 0) + 1);
    }
  }
  return filas.map((j) => {
    const d = {
      id: j.id, usuario: autorDe(actor, "comercial", j.usuario_id, mapa), fecha: j.fecha as string, nombre: (j.nombre as string) ?? null,
      zona_id: j.zona_id, zona: cat.zonas.find((z) => z.id === j.zona_id)?.nombre ?? null, abierta_en: j.abierta_en as string,
      cerrada_en: (j.cerrada_en as string) ?? null, km_inicial: num(j.km_inicial), km_final: num(j.km_final), km_recorridos: num(j.km_recorridos),
      combustible_cantidad: num(j.combustible_cantidad), combustible_unidad: (j.combustible_unidad as JornadaDto["combustible_unidad"]) ?? null,
      combustible_importe: num(j.combustible_importe), estacionamiento_importe: num(j.estacionamiento_importe), peajes_importe: num(j.peajes_importe),
      otros_importe: num(j.otros_importe), otros_detalle: (j.otros_detalle as string) ?? null, cargada_por_admin: j.creada_por_rol === "admin",
      visitas: cuenta.get(j.id) ?? 0, version: j.version as number,
    };
    return { ...d, pendientes: pendientesJornada(d) };
  });
}

export type FiltrosJornadas = { usuario?: string | null; desde?: string | null; hasta?: string | null; estado?: string | null; pendientes?: boolean };

export async function listarJornadas(actor: ActorRpc, f: FiltrosJornadas = {}): Promise<JornadaDto[]> {
  let q = supabaseAdmin.from("crm_jornadas").select(COLS_JORNADA).order("fecha", { ascending: false }).order("abierta_en", { ascending: false }).limit(150);
  if (esComercial(actor)) q = q.eq("usuario_id", actor.usuarioId);
  else if (esUuid(f.usuario)) q = q.eq("usuario_id", f.usuario);
  if (f.desde && /^\d{4}-\d{2}-\d{2}$/.test(f.desde)) q = q.gte("fecha", f.desde);
  if (f.hasta && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) q = q.lte("fecha", f.hasta);
  if (f.estado === "abierta") q = q.is("cerrada_en", null);
  if (f.estado === "cerrada") q = q.not("cerrada_en", "is", null);
  const [filas, mapa, cat] = await Promise.all([q.then((r) => (revisar(r, "jornadas") ?? []) as FilaJornada[]), nombres(actor), catalogo(false)]);
  const out = await armarJornadas(actor, filas, mapa, cat);
  return f.pendientes ? out.filter((j) => j.pendientes.length > 0) : out;
}

export async function detalleJornada(actor: ActorRpc, id: string): Promise<{ jornada: JornadaDto; visitas: VisitaDto[] } | null> {
  if (!esUuid(id)) return null;
  const j = revisar(await supabaseAdmin.from("crm_jornadas").select(COLS_JORNADA).eq("id", id).maybeSingle(), "jornada") as FilaJornada | null;
  if (!j || (esComercial(actor) && j.usuario_id !== actor.usuarioId)) return null;
  const [mapa, cat] = await Promise.all([nombres(actor), catalogo(false)]);
  let qv = supabaseAdmin.from("crm_visitas").select(COLS_VISITA).eq("jornada_id", id).order("ocurrida_en", { ascending: false });
  if (esComercial(actor)) qv = qv.is("anulada_en", null);
  const [jornada] = await armarJornadas(actor, [j], mapa, cat);
  return { jornada, visitas: await armarVisitas(actor, (revisar(await qv, "visitas") ?? []) as FilaVisita[], mapa, true) };
}

// ── Inicio del comercial ────────────────────────────────────────────────────
export async function inicioComercial(actor: { rol: "comercial"; usuarioId: string }, nombre: string): Promise<InicioDto> {
  const hoy = hoyEnSim();
  const uid = actor.usuarioId;
  const [jr, vr, tr, er, cat] = await Promise.all([
    supabaseAdmin.from("crm_jornadas").select(COLS_JORNADA).eq("usuario_id", uid).or(`cerrada_en.is.null,fecha.eq.${hoy}`).order("abierta_en", { ascending: false }),
    supabaseAdmin.from("crm_visitas").select(COLS_VISITA).eq("realizada_por_usuario", uid).eq("fecha", hoy).is("anulada_en", null).order("ocurrida_en", { ascending: false }).limit(50),
    supabaseAdmin.from("crm_tareas").select("id, empresa_id, vence_el, estado, version").eq("responsable_id", uid).eq("estado", "pendiente").order("vence_el", { ascending: true, nullsFirst: false }),
    supabaseAdmin.from("crm_empresas").select("id, nombre_comercial").eq("responsable_id", uid).is("archivada_en", null),
    catalogo(false),
  ]);
  const mapa = new Map<string, string>();
  const jornadas = await armarJornadas(actor, (revisar(jr, "jornadas") ?? []) as FilaJornada[], mapa, cat);
  const empresas = new Map((revisar(er, "empresas") ?? []).map((e) => [e.id, e.nombre_comercial as string]));
  const s = await estadisticas([...empresas.keys()]);
  return {
    usuario: { id: uid, nombre }, hoy,
    jornada_abierta: jornadas.find((j) => !j.cerrada_en) ?? null,
    jornadas_hoy: jornadas.filter((j) => j.fecha === hoy),
    visitas_hoy: await armarVisitas(actor, (revisar(vr, "visitas") ?? []) as FilaVisita[], mapa, true),
    revisitas: (revisar(tr, "tareas") ?? []).filter((t) => empresas.has(t.empresa_id))
      .map((t) => ({ id: t.id, empresa_id: t.empresa_id, empresa: empresas.get(t.empresa_id)!, vence_el: t.vence_el, estado: t.estado, version: t.version })) as TareaDto[],
    negocios: { asignados: empresas.size, por_visitar: [...s.values()].filter((x) => x.visitas === 0 && !x.oportunidad).length },
  };
}

// ── Escrituras (RPC) ────────────────────────────────────────────────────────
type Ref = { id: string; version: number };

export const crearEmpresa = (a: ActorRpc, datos: unknown, confirmar: boolean) =>
  rpc<{ resultado: "ok"; id: string } | { resultado: "posible_duplicado"; candidatos: unknown[] }>("crm_empresa_crear", { p_datos: datos, p_confirmar_duplicado: confirmar, ...actorRpc(a) });
export const actualizarEmpresa = (a: ActorRpc, id: string, version: number, cambios: unknown) =>
  rpc<Ref>("crm_empresa_actualizar", { p_id: id, p_version: version, p_cambios: cambios, ...actorRpc(a) });
export const archivarEmpresa = (a: ActorRpc, id: string, version: number, archivar: boolean, motivo: string | null) =>
  rpc<Ref>("crm_empresa_archivar", { p_id: id, p_version: version, p_archivar: archivar, p_motivo: motivo, ...actorRpc(a) });
export const crearContacto = (a: ActorRpc, empresaId: string, datos: unknown) =>
  rpc<Ref>("crm_contacto_crear", { p_empresa: empresaId, p_datos: datos, ...actorRpc(a) });
export const actualizarContacto = (a: ActorRpc, id: string, version: number, cambios: unknown) =>
  rpc<Ref>("crm_contacto_actualizar", { p_id: id, p_version: version, p_cambios: cambios, ...actorRpc(a) });
export const crearJornada = (a: ActorRpc, datos: unknown) => rpc<Ref>("crm_jornada_crear", { p_datos: datos, ...actorRpc(a) });
export const actualizarJornada = (a: ActorRpc, id: string, version: number, cambios: unknown, cerrar: boolean) =>
  rpc<Ref>("crm_jornada_actualizar", { p_id: id, p_version: version, p_cambios: cambios, p_cerrar: cerrar, ...actorRpc(a) });
export const corregirVisita = (a: ActorRpc, id: string, version: number, cambios: unknown, motivo: string) =>
  rpc<Ref>("crm_visita_corregir", { p_id: id, p_version: version, p_cambios: cambios, p_motivo: motivo, ...actorRpc(a) });
export const anularVisita = (a: ActorRpc, id: string, version: number, motivo: string, resolucion: string | null, nuevoOrigen: string | null) =>
  rpc<Ref>("crm_visita_anular", { p_id: id, p_version: version, p_motivo: motivo, p_resolucion: resolucion, p_nuevo_origen: nuevoOrigen, ...actorRpc(a) });
export const notaVisita = (a: ActorRpc, visitaId: string, texto: string) =>
  rpc<{ id: string }>("crm_visita_nota_agregar", { p_visita: visitaId, p_texto: texto, ...actorRpc(a) });
export const actualizarTarea = (a: ActorRpc, id: string, version: number, accion: string, venceEl: string | null, motivo: string | null) =>
  rpc<Ref>("crm_tarea_actualizar", { p_id: id, p_version: version, p_accion: accion, p_vence_el: venceEl, p_motivo: motivo, ...actorRpc(a) });
export const guardarCatalogo = (a: ActorRpc, tipo: string, id: string | null, version: number | null, datos: unknown) =>
  rpc<Ref>("crm_catalogo_guardar", { p_tipo: tipo, p_id: id, p_version: version, p_datos: datos, ...actorRpc(a) });

/** Registro idempotente: la huella se calcula acá, sobre los datos ya armados (nunca la manda el navegador). */
export function huellaVisita(datos: Record<string, unknown>): string {
  return createHash("sha256").update(canonico(datos)).digest("hex");
}

export function registrarVisita(a: ActorRpc, clave: string, cuerpo: unknown): Promise<R<ResultadoVisita>> {
  const datos = armarDatosVisita(cuerpo, a.rol);
  return rpc<ResultadoVisita>("crm_visita_registrar", { p_clave: clave, p_huella: huellaVisita(datos), p_datos: datos, ...actorRpc(a) });
}

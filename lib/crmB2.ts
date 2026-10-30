// CRM B2B · B2 — seguimiento comercial de Administración (puro: sin base ni red).
// Estados, actividades, motivos de pérdida, la regla de grupos de la bandeja y lo
// que comparten servidor y navegador. Definiciones: docs/crm/b2-seguimiento.md.

import type { Interes, Necesidad, Pack } from "@/lib/crmB1";

// ── Estados de la oportunidad ───────────────────────────────────────────────
export const ESTADOS_OPORTUNIDAD = [
  { valor: "contacto", texto: "Contacto conseguido" },
  { valor: "conversacion", texto: "En conversación" },
  { valor: "interesado", texto: "Interesado" },
  { valor: "negociacion", texto: "Negociación" },
  { valor: "pausada", texto: "Retomar más adelante" },
  { valor: "perdida", texto: "Perdido" },
  // B3: solo se llega registrando la venta (crm_venta_registrar), nunca a mano.
  { valor: "ganada", texto: "Ganado" },
] as const;
export type EstadoOportunidad = (typeof ESTADOS_OPORTUNIDAD)[number]["valor"];
/** Etapas con orden de avance (pausa, pérdida y ganada no son etapas). */
export const ETAPAS = ["contacto", "conversacion", "interesado", "negociacion"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const textoEstado = (e: string | null | undefined) => ESTADOS_OPORTUNIDAD.find((x) => x.valor === e)?.texto ?? (e ?? "—");
/** 1..4 para las etapas; null para pausa, pérdida o desconocido (igual que crm_rango_estado). */
export const rangoEtapa = (e: string | null | undefined): number | null => {
  const i = ETAPAS.indexOf(e as Etapa);
  return i < 0 ? null : i + 1;
};
export const esRetroceso = (desde: string, hacia: string) => {
  const a = rangoEtapa(desde);
  const b = rangoEtapa(hacia);
  return a !== null && b !== null && b < a;
};

// ── Actividades que registra Administración ─────────────────────────────────
export const TIPOS_ACTIVIDAD = [
  { valor: "whatsapp_enviado", texto: "WhatsApp enviado" },
  { valor: "respondio", texto: "Respondió" },
  { valor: "no_respondio", texto: "No respondió" },
  { valor: "llamada", texto: "Llamada realizada" },
  { valor: "nota", texto: "Nota" },
  { valor: "propuesta_enviada", texto: "Propuesta enviada" },
  { valor: "inicio_negociacion", texto: "Inicio de negociación" },
  { valor: "cambio_estado", texto: "Cambio de estado" },
] as const;
export type TipoActividad = (typeof TIPOS_ACTIVIDAD)[number]["valor"];
export const textoActividad = (t: string) => TIPOS_ACTIVIDAD.find((x) => x.valor === t)?.texto ?? t;

/**
 * Estado que deja una actividad (misma regla que la RPC): "Respondió" lleva
 * contacto → conversación; "Inicio de negociación" lleva a negociación desde una
 * etapa anterior; el resto (incluida la propuesta y la nota) no cambia el estado.
 */
export function estadoTrasActividad(estado: string, tipo: string, destino?: string | null): string {
  if (tipo === "respondio" && estado === "contacto") return "conversacion";
  if (tipo === "inicio_negociacion" && (rangoEtapa(estado) ?? 99) < 4) return "negociacion";
  if (tipo === "cambio_estado" && destino && rangoEtapa(destino) !== null) return destino;
  return estado;
}

// ── Pérdida ─────────────────────────────────────────────────────────────────
export const MOTIVOS_PERDIDA = [
  { valor: "precio", texto: "Precio" },
  { valor: "sin_presupuesto", texto: "Sin presupuesto" },
  { valor: "sin_utilidad", texto: "No le encontró utilidad" },
  { valor: "no_le_interesa", texto: "No le interesa el producto" },
  { valor: "otro_sistema", texto: "Ya utiliza otro sistema de beneficios" },
  { valor: "no_prioridad", texto: "No es prioridad actualmente" },
  { valor: "sin_decisor", texto: "No se pudo llegar al decisor" },
  { valor: "dejo_de_responder", texto: "Dejó de responder" },
  { valor: "condiciones", texto: "Condiciones / horarios" },
  { valor: "otro", texto: "Otro" },
] as const;
export type MotivoPerdida = (typeof MOTIVOS_PERDIDA)[number]["valor"];
export const textoMotivoPerdida = (m: string | null) => MOTIVOS_PERDIDA.find((x) => x.valor === m)?.texto ?? (m ?? "—");

// ── Bandeja ─────────────────────────────────────────────────────────────────
/**
 * Grupos de la vista general, en el orden en que se muestran. Cada oportunidad
 * abierta cae en UNO solo (ver grupoDe): no hay filas repetidas y los contadores
 * se calculan sobre la misma lista que las filas.
 */
export const GRUPOS = [
  { id: "vencidos", texto: "Seguimientos vencidos" },
  { id: "hoy", texto: "Acciones de hoy" },
  { id: "nuevos", texto: "Leads nuevos sin gestionar" },
  { id: "sin_proxima", texto: "Sin próxima acción" },
  { id: "retomar", texto: "Retomar: llegó la fecha" },
  { id: "proximas", texto: "Próximas acciones y pausas" },
] as const;
export type Grupo = (typeof GRUPOS)[number]["id"];

export type Pendiente = { id: string; tipo: "seguimiento" | "retomar"; vence_el: string; descripcion: string | null };

/**
 * Regla de grupos (precedencia explícita, de arriba hacia abajo):
 *   1. Con acción pendiente de tipo "retomar" (pausa): llegó la fecha (vence ≤ hoy)
 *      → "retomar"; si no → "proximas" (pausa futura).
 *   2. Con seguimiento pendiente: vence < hoy → "vencidos"; = hoy → "hoy";
 *      > hoy → "proximas".
 *   3. Sin acción pendiente: nunca gestionada → "nuevos"; gestionada → "sin_proxima".
 * Advertencias (contacto incompleto, negocio archivado) son etiquetas, no grupos.
 * `hoy` es la fecha de negocio de SIM (Córdoba), en formato YYYY-MM-DD.
 */
export function grupoDe(o: { pendiente: Pendiente | null; gestionada: boolean }, hoy: string): Grupo {
  const p = o.pendiente;
  if (p?.tipo === "retomar") return p.vence_el <= hoy ? "retomar" : "proximas";
  if (p) return p.vence_el < hoy ? "vencidos" : p.vence_el === hoy ? "hoy" : "proximas";
  return o.gestionada ? "sin_proxima" : "nuevos";
}

export type Advertencia = "sin_contacto" | "contacto_archivado" | "contacto_sin_telefono" | "negocio_archivado";
export const TEXTO_ADVERTENCIA: Record<Advertencia, string> = {
  sin_contacto: "Sin contacto principal",
  contacto_archivado: "El contacto principal está archivado",
  contacto_sin_telefono: "El contacto principal no tiene un teléfono utilizable",
  negocio_archivado: "El negocio está archivado",
};

export function advertenciasDe(o: {
  contacto: { archivado: boolean; telefono_normalizado: string | null } | null; empresa: { archivada: boolean };
}): Advertencia[] {
  const a: Advertencia[] = [];
  if (!o.contacto) a.push("sin_contacto");
  else {
    if (o.contacto.archivado) a.push("contacto_archivado");
    if (!o.contacto.telefono_normalizado || !/^\d{8,15}$/.test(o.contacto.telefono_normalizado)) a.push("contacto_sin_telefono");
  }
  if (o.empresa.archivada) a.push("negocio_archivado");
  return a;
}

export type Proxima = "vencida" | "hoy" | "futura" | "sin";
export function proximaDe(p: Pendiente | null, hoy: string): Proxima {
  if (!p) return "sin";
  return p.vence_el < hoy ? "vencida" : p.vence_el === hoy ? "hoy" : "futura";
}

export type FilaBandeja = {
  id: string;
  version: number;
  ciclo: number;
  estado: EstadoOportunidad;
  estado_previo: Etapa | null;
  empresa: { id: string; nombre: string; rubro_id: string | null; rubro: string | null; zona_id: string | null; zona: string | null; archivada: boolean };
  contacto: { id: string; nombre: string | null; cargo: string | null; es_decisor: string; telefono: string | null; telefono_normalizado: string | null; archivado: boolean } | null;
  necesidades: Necesidad[];
  necesidad_otra: string[];
  interes: Interes | null;
  pack: Pack | null;
  nota_comercial: { texto: string; en: string } | null;
  /** usuario_id null: oportunidad de recompra creada por Administración (B3), sin visita de origen. */
  origen: { usuario_id: string | null; nombre: string; lead_en: string };
  ultima_gestion: { tipo: string; ocurrida_en: string; estado_despues: string | null } | null;
  pendiente: Pendiente | null;
  gestionada: boolean;
  grupo: Grupo;
  advertencias: Advertencia[];
  perdida: { en: string; motivo: string; detalle: string | null; visitas_posteriores: number } | null;
};

export type FiltrosBandeja = {
  q?: string; estado?: string; origen?: string; interes?: string; rubro?: string; zona?: string; proxima?: string; grupo?: string;
};

/** Valor del filtro «Originado por» para las recompras creadas por Administración. */
export const ORIGEN_ADMIN = "admin";

const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Filtros de la bandeja (todos opcionales). La búsqueda mira negocio y contacto. */
export function filtrar(filas: FilaBandeja[], f: FiltrosBandeja, hoy: string): FilaBandeja[] {
  const q = f.q?.trim() ? normalizar(f.q.trim()) : "";
  return filas.filter((o) =>
    (!q || normalizar(o.empresa.nombre).includes(q) || normalizar(o.contacto?.nombre ?? "").includes(q))
    && (!f.estado || o.estado === f.estado)
    && (!f.origen || (f.origen === ORIGEN_ADMIN ? o.origen.usuario_id === null : o.origen.usuario_id === f.origen))
    && (!f.interes || (f.interes === "no_evaluado" ? o.interes === null : o.interes === f.interes))
    && (!f.rubro || (f.rubro === "sin_clasificar" ? o.empresa.rubro_id === null : o.empresa.rubro_id === f.rubro))
    && (!f.zona || o.empresa.zona_id === f.zona)
    && (!f.proxima || proximaDe(o.pendiente, hoy) === f.proxima));
}

/** Contadores por grupo: SIEMPRE sobre la misma lista (ya filtrada) que se muestra. */
export function contar(filas: FilaBandeja[]): Record<Grupo, number> {
  const c = Object.fromEntries(GRUPOS.map((g) => [g.id, 0])) as Record<Grupo, number>;
  for (const o of filas) c[o.grupo]++;
  return c;
}

/** Orden dentro de cada grupo: lo que vence antes primero; sin fecha, el lead más viejo primero. */
export function ordenar(filas: FilaBandeja[]): FilaBandeja[] {
  return [...filas].sort((a, b) =>
    (a.pendiente?.vence_el ?? "9999").localeCompare(b.pendiente?.vence_el ?? "9999") || a.origen.lead_en.localeCompare(b.origen.lead_en));
}

// ── WhatsApp manual ─────────────────────────────────────────────────────────
/**
 * Enlace para ABRIR WhatsApp (no envía nada ni registra nada). Solo si el número
 * se escribió completo en formato internacional (con "+", "00" o empezando con
 * 549 para Argentina): no se inventa el código de país ni el 9 de los celulares.
 * Un número argentino sin el 9 no se ofrece (WhatsApp lo necesita).
 */
export function enlaceWhatsappManual(telefono: string | null): { url: string } | { motivo: string } {
  if (!telefono?.trim()) return { motivo: "Sin teléfono cargado." };
  const t = telefono.trim();
  let d = t.replace(/\D/g, "");
  const internacional = t.startsWith("+") || d.startsWith("00") || d.startsWith("549");
  if (d.startsWith("00")) d = d.slice(2);
  if (!internacional) return { motivo: "Falta el código de país: cargá el número como +54 9 …" };
  if (d.length < 10 || d.length > 15) return { motivo: "El número no tiene una longitud válida." };
  if (d.startsWith("54") && !d.startsWith("549")) return { motivo: "A los celulares argentinos les falta el 9 (+54 9 …)." };
  return { url: `https://wa.me/${d}` };
}

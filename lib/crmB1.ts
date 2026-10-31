// CRM B2B · B1 (prospección y visitas) — contrato puro: opciones, tipos de la API,
// armado del cuerpo de una visita, forma canónica para la huella y errores.
// Sin dependencias de servidor: lo usan las rutas, las pantallas y las pruebas.
// La autoridad es la base (db/crm-b1-prospeccion.sql): acá solo se da forma.

export type Rol = "admin" | "comercial";

// ── Opciones ────────────────────────────────────────────────────────────────
export const NECESIDADES = [
  { valor: "fidelizacion", texto: "Fidelización de clientes" },
  { valor: "premio_compra", texto: "Premio por compra" },
  { valor: "referidos", texto: "Referidos" },
  { valor: "sorteos", texto: "Sorteos" },
  { valor: "redes", texto: "Acciones en redes" },
  { valor: "beneficios_empleados", texto: "Beneficios para empleados" },
  { valor: "incentivos_desempeno", texto: "Incentivos por desempeño" },
  { valor: "premios_comerciales", texto: "Premios comerciales" },
  { valor: "regalos", texto: "Regalos" },
  { valor: "relaciones_clientes", texto: "Relaciones con clientes" },
  { valor: "otra", texto: "Otra" },
] as const;
export type Necesidad = (typeof NECESIDADES)[number]["valor"];

/** Interés: sin elegir = no evaluado (NULL). "Sin interés" es un rechazo explícito. */
export const INTERESES = [
  { valor: "sin_interes", texto: "Sin interés" },
  { valor: "frio", texto: "Frío" },
  { valor: "tibio", texto: "Tibio" },
  { valor: "caliente", texto: "Caliente" },
] as const;
export type Interes = (typeof INTERESES)[number]["valor"];

export const PACKS = [
  { valor: "10", texto: "Pack 10" },
  { valor: "25", texto: "Pack 25" },
  { valor: "personalizado", texto: "Personalizado" },
  { valor: "no_determinado", texto: "No determinado" },
] as const;
export type Pack = (typeof PACKS)[number]["valor"];

export const DECISOR = [
  { valor: "si", texto: "Sí" },
  { valor: "no", texto: "No" },
  { valor: "no_sabe", texto: "No sabemos" },
] as const;
export type Decisor = (typeof DECISOR)[number]["valor"];

export const PRIORIDADES = [
  { valor: "A", texto: "A · alta" },
  { valor: "B", texto: "B · potencial" },
  { valor: "C", texto: "C · exploratorio" },
] as const;
export type Prioridad = (typeof PRIORIDADES)[number]["valor"];

export const UNIDADES_COMBUSTIBLE = [
  { valor: "litros", texto: "Litros" },
  { valor: "m3", texto: "m³ (GNC)" },
] as const;

export const texto = <T extends string>(lista: ReadonlyArray<{ valor: T; texto: string }>, v: T | string | null | undefined) =>
  lista.find((o) => o.valor === v)?.texto ?? null;

// ── Tipos de la API ─────────────────────────────────────────────────────────
export type Catalogo = {
  rubros: Array<{ id: string; nombre: string; activo: boolean; orden: number; version: number }>;
  zonas: Array<{ id: string; nombre: string; activo: boolean; orden: number; version: number }>;
};

export type EstadoNegocio = "por_visitar" | "visitado" | "con_oportunidad" | "archivado";

export type EmpresaDto = {
  id: string;
  nombre_comercial: string;
  rubro_id: string | null;
  rubro: string | null;
  rubro_detalle: string | null;
  direccion: string | null;
  zona_id: string | null;
  zona: string | null;
  instagram: string | null;
  web: string | null;
  prioridad: Prioridad | null;
  cliente_previo: boolean;
  version: number;
  estado: EstadoNegocio;
  visitas: number;
  ultima_visita: string | null;
  revisita_pendiente: string | null | false;
  /** Solo admin. */
  responsable?: { id: string; nombre: string } | null;
  posible_duplicado?: boolean;
  origen?: string;
  archivada_motivo?: string | null;
};

export type ContactoDto = {
  id: string;
  nombre: string | null;
  cargo: string | null;
  telefono: string | null;
  telefono_normalizado: string | null;
  tiene_whatsapp: boolean | null;
  es_decisor: Decisor;
  archivado: boolean;
  version: number;
};

/** "vos" / "otro comercial" para el comercial; nombre para admin. */
export type Autor = { tipo: "vos" | "admin" | "otro" | "comercial"; nombre: string };

export type VisitaDto = {
  id: string;
  empresa_id: string;
  empresa?: string;
  jornada_id: string;
  ocurrida_en: string;
  fecha: string;
  cerrado: boolean;
  hablo_con_empleado: boolean;
  hablo_con_responsable: boolean;
  responsable_ausente: boolean;
  contacto: { id: string; nombre: string | null; cargo: string | null } | null;
  contacto_obtenido: boolean;
  hablo_con_contacto: boolean;
  contacto_util: boolean;
  decisor_contactado: boolean;
  interes: Interes | null;
  necesidades: Necesidad[];
  necesidad_otra: string | null;
  pack_potencial: Pack | null;
  volver_otro_dia: boolean;
  revisita_para: string | null;
  observacion: string | null;
  realizada_por: Autor;
  registrada_por: Autor;
  es_origen_oportunidad: boolean;
  anulada: boolean;
  anulada_motivo?: string | null;
  version: number;
  notas: Array<{ id: string; texto: string; creada_en: string; autor: Autor }>;
};

export type OportunidadDto = {
  id: string;
  /** Estados de B2/B3 (lib/crmB2.ts). Al comercial solo le llega este resumen (nunca una ganada ni su venta). */
  estado: "contacto" | "conversacion" | "interesado" | "negociacion" | "pausada" | "perdida" | "ganada";
  abierta: boolean;
  cierre_motivo: string | null;
  lead_en: string;
  interesado_en: string | null;
  origen: Autor;
  origen_visita_id?: string;
};

export type TareaDto = {
  id: string;
  empresa_id: string;
  empresa: string;
  vence_el: string | null;
  estado: "pendiente" | "hecha" | "cancelada";
  version: number;
  responsable?: Autor;
};

export type JornadaDto = {
  id: string;
  usuario: Autor;
  fecha: string;
  nombre: string | null;
  zona_id: string | null;
  zona: string | null;
  abierta_en: string;
  cerrada_en: string | null;
  km_inicial: number | null;
  km_final: number | null;
  km_recorridos: number | null;
  combustible_cantidad: number | null;
  combustible_unidad: "litros" | "m3" | null;
  combustible_importe: number | null;
  estacionamiento_importe: number | null;
  peajes_importe: number | null;
  otros_importe: number | null;
  otros_detalle: string | null;
  cargada_por_admin: boolean;
  visitas: number;
  pendientes: string[];
  version: number;
};

export type FichaEmpresaDto = {
  empresa: EmpresaDto;
  contactos: ContactoDto[];
  visitas: VisitaDto[];
  oportunidades: OportunidadDto[];
  revisita: TareaDto | null;
  similares?: Array<{ id: string; nombre_comercial: string }>;
};

export type CandidatoDuplicado = {
  id?: string;
  nombre_comercial: string;
  zona: string | null;
  rubro: string | null;
  direccion?: string | null;
  asignacion: "vos" | "otra_persona" | "sin_asignar";
};

export type ResultadoVisita =
  | { resultado: "posible_duplicado"; candidatos: CandidatoDuplicado[] }
  | {
    resultado: "ok";
    repetida: boolean;
    visita: { id: string; empresa_id: string; jornada_id: string; ocurrida_en: string; fecha: string; contacto_util: boolean; decisor_contactado: boolean; interes: Interes | null; version: number };
    empresa_creada: boolean;
    contacto_id: string | null;
    contacto_creado: boolean;
    /** Con estado "perdida": la visita quedó ligada a la oportunidad perdida (no la reabre). */
    oportunidad: { id: string; estado: OportunidadDto["estado"]; creada: boolean; origen_es_esta_visita: boolean } | null;
    tarea: { id: string; vence_el: string | null } | null;
  };

export type InicioDto = {
  usuario: { id: string; nombre: string };
  hoy: string;
  jornada_abierta: JornadaDto | null;
  jornadas_hoy: JornadaDto[];
  visitas_hoy: VisitaDto[];
  revisitas: TareaDto[];
  negocios: { asignados: number; por_visitar: number };
};

// ── Normalización (misma regla que crm_normalizar_texto) ────────────────────
export function normalizarTexto(v: string | null | undefined): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[áàäâã]/g, "a").replace(/[éèëê]/g, "e").replace(/[íìïî]/g, "i").replace(/[óòöôõ]/g, "o").replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Enlace de WhatsApp (solo abre la app: el envío es manual). */
export function enlaceWhatsapp(telefonoNormalizado: string | null): string | null {
  return telefonoNormalizado && /^\d{8,15}$/.test(telefonoNormalizado) ? `https://wa.me/${telefonoNormalizado}` : null;
}

// ── Cuerpo de una visita ────────────────────────────────────────────────────
const CLAVES_VISITA = ["jornada_id", "empresa_id", "empresa_nueva", "confirmar_duplicado", "cerrado", "hablo_con_empleado", "hablo_con_responsable",
  "responsable_ausente", "contacto_id", "contacto_nuevo", "contacto_obtenido", "hablo_con_contacto", "interes", "necesidades", "necesidad_otra",
  "pack_potencial", "volver_otro_dia", "revisita_para", "observacion"] as const;
const CLAVES_SOLO_ADMIN = ["realizada_por", "ocurrida_en"] as const;
const CLAVES_EMPRESA_NUEVA = ["nombre_comercial", "rubro_id", "rubro_detalle", "direccion", "zona_id", "instagram", "web", "prioridad"] as const;
const CLAVES_CONTACTO_NUEVO = ["nombre", "cargo", "telefono", "tiene_whatsapp", "es_decisor"] as const;

function elegir(o: unknown, claves: readonly string[], conservarFalso: readonly string[] = []): Record<string, unknown> {
  const fuente = (o && typeof o === "object" && !Array.isArray(o) ? o : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of claves) {
    const v = fuente[k];
    if (v === undefined || v === null || v === "" || (v === false && !conservarFalso.includes(k))) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
    if (out[k] === "") delete out[k];
  }
  return out;
}

/**
 * Datos de una visita listos para la RPC: solo claves conocidas, sin vacíos ni
 * "false" (equivalen a no marcado), objetos anidados recortados. El autor y la hora
 * solo los fija la administración; del comercial se descartan (no se toman del
 * formulario: la base pone el comercial de la sesión y la hora del servidor).
 */
export function armarDatosVisita(cuerpo: unknown, rol: Rol): Record<string, unknown> {
  const datos = elegir(cuerpo, rol === "admin" ? [...CLAVES_VISITA, ...CLAVES_SOLO_ADMIN] : CLAVES_VISITA);
  if (datos.empresa_nueva !== undefined) {
    const e = elegir(datos.empresa_nueva, CLAVES_EMPRESA_NUEVA);
    if (Object.keys(e).length) datos.empresa_nueva = e;
    else delete datos.empresa_nueva;
  }
  if (datos.contacto_nuevo !== undefined) {
    const c = elegir(datos.contacto_nuevo, CLAVES_CONTACTO_NUEVO, ["tiene_whatsapp"]);
    if (Object.keys(c).length) datos.contacto_nuevo = c;
    else delete datos.contacto_nuevo;
  }
  if (Array.isArray(datos.necesidades)) {
    const n = [...new Set(datos.necesidades.filter((x): x is string => typeof x === "string"))].sort();
    if (n.length) datos.necesidades = n;
    else delete datos.necesidades;
  }
  return datos;
}

/** JSON canónico (claves ordenadas): misma visita → misma huella. */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

// ── Borradores (por usuario autenticado) ───────────────────────────────────
export const PREFIJO_BORRADOR = "crm-borrador-visita:";
export const claveBorrador = (usuarioId: string) => `${PREFIJO_BORRADOR}${usuarioId}`;

// ── Errores de las RPCs ─────────────────────────────────────────────────────
export type ErrorCrm = { status: number; codigo: string; error: string; campo?: string };

const ERRORES: Record<string, Omit<ErrorCrm, "codigo">> = {
  actor_invalido: { status: 401, error: "La sesión ya no es válida. Volvé a ingresar." },
  no_autorizado: { status: 403, error: "No tenés permiso para esa acción." },
  empresa_no_encontrada: { status: 404, error: "El negocio no existe o no está asignado a vos." },
  contacto_no_encontrado: { status: 404, error: "El contacto no existe en ese negocio." },
  jornada_no_encontrada: { status: 404, error: "La jornada no existe o no es tuya." },
  visita_no_encontrada: { status: 404, error: "La visita no existe." },
  tarea_no_encontrada: { status: 404, error: "La revisita no existe." },
  no_encontrado: { status: 404, error: "No existe." },
  version_desactualizada: { status: 409, error: "Alguien cambió este registro mientras lo editabas. Recargá para ver la versión actual." },
  jornada_abierta: { status: 409, error: "Ya tenés una jornada abierta. Cerrala antes de abrir otra." },
  jornada_cerrada: { status: 409, error: "Esa jornada ya está cerrada." },
  jornada_de_otra_fecha: { status: 409, error: "La visita no corresponde al día de esa jornada. Cerrá la jornada anterior y abrí la de hoy." },
  empresa_archivada: { status: 409, error: "El negocio está archivado." },
  clave_reutilizada: { status: 409, error: "Este envío no coincide con uno anterior. Revisá los datos y volvé a guardar." },
  resolucion_requerida: { status: 409, error: "Esta visita originó la oportunidad: elegí qué hacer con ella." },
  sin_cambio: { status: 409, error: "Ya estaba en ese estado." },
  visita_anulada: { status: 409, error: "La visita está anulada." },
  nombre_existente: { status: 409, error: "Ya existe uno con ese nombre." },
  contacto_sin_canal: { status: 400, error: "Para marcar el contacto como útil hace falta un teléfono." },
  revisita_fecha_pasada: { status: 400, error: "La fecha de la revisita ya pasó." },
  km_final_menor: { status: 400, error: "Los km finales no pueden ser menores que los iniciales." },
  // B2 (seguimiento de Administración)
  oportunidad_no_encontrada: { status: 404, error: "La oportunidad no existe." },
  oportunidad_perdida: { status: 409, error: "La oportunidad está perdida: reabrila para registrar gestiones o programar acciones." },
  oportunidad_pausada: { status: 409, error: "La oportunidad está en pausa: retomala antes de avanzar o programar." },
  oportunidad_no_pausada: { status: 409, error: "La oportunidad no está en pausa." },
  oportunidad_no_perdida: { status: 409, error: "Solo se puede reabrir una oportunidad perdida." },
  seguimiento_pendiente: { status: 409, error: "Ya hay una próxima acción pendiente: resolvela con la gestión o reprogramala." },
  seguimiento_no_vigente: { status: 409, error: "La próxima acción cambió mientras la mirabas. Recargá." },
  otra_oportunidad_abierta: { status: 409, error: "El negocio ya tiene otra oportunidad abierta: no se puede reabrir esta sin cerrar la otra." },
  oportunidad_gestionada: { status: 409, error: "Esa oportunidad ya tiene gestión de Administración: reasigná el origen o marcala como perdida antes de anular la visita." },
  // B3 (ventas, cobros y comisiones)
  oportunidad_ganada: { status: 409, error: "La oportunidad ya está ganada: su venta se gestiona desde «Ventas». Solo admite notas." },
  oportunidad_cerrada: { status: 409, error: "La oportunidad está cerrada." },
  confirmar_importe: { status: 409, error: "El importe no es el de lista: confirmá que es el acordado." },
  confirmar_comision: { status: 409, error: "La comisión se aparta de la regla estándar: revisala y confirmala." },
  comision_origen: { status: 409, error: "En una venta nueva la comisión es del comercial que originó el lead." },
  comision_recompra: { status: 409, error: "Es una recompra: elegí «recompra trabajada» (con la intervención del comercial) o «espontánea»." },
  comision_no_es_recompra: { status: 409, error: "No es una recompra: el negocio no tiene compras anteriores." },
  cobro_excede_saldo: { status: 409, error: "El cobro supera el saldo de la venta." },
  comision_no_generada: { status: 409, error: "La comisión todavía no está generada: la venta tiene que estar cobrada por completo." },
  comision_no_corresponde: { status: 409, error: "Esta venta no lleva comisión." },
  comision_a_revisar: { status: 409, error: "La comisión está a revisar (los pagos no coinciden con lo pactado): corregila antes de registrar otro pago." },
  pago_excede_comision: { status: 409, error: "El pago supera lo que falta pagar de la comisión." },
  importe_menor_que_cobrado: { status: 409, error: "El importe no puede quedar por debajo de lo ya cobrado." },
  venta_con_cobros: { status: 409, error: "La venta tiene cobros vigentes: anulalos (con motivo) antes de anular la venta." },
  venta_con_pagos_comision: { status: 409, error: "La venta tiene pagos de comisión vigentes: anulalos (con motivo) antes de anular la venta." },
  venta_no_encontrada: { status: 404, error: "La venta no existe." },
  venta_anulada: { status: 409, error: "La venta está anulada: no admite cambios." },
  cobro_no_encontrado: { status: 404, error: "El cobro no existe en esta venta." },
  pago_no_encontrado: { status: 404, error: "El pago no existe en esta venta." },
  campania_no_encontrada: { status: 404, error: "La campaña no existe en Empresas." },
  campania_vinculada: { status: 409, error: "Esa campaña ya está vinculada a otra venta vigente." },
  sin_compras_previas: { status: 409, error: "El negocio no tiene compras: una venta nueva nace de la prospección, no de una recompra." },
  visita_con_venta: { status: 409, error: "Esa visita sostiene una venta vigente (origen o intervención de la comisión): no se puede anular." },
};

const CAMPOS: Record<string, string> = {
  nombre_comercial: "el nombre del negocio", telefono: "el teléfono", resultado: "qué pasó en la visita", cerrado: "la visita cerrada (sin contacto, interés ni necesidades)",
  contacto: "el contacto", necesidad_otra: "la necesidad «Otra»", revisita_para: "la fecha de revisita", motivo: "el motivo", empresa: "el negocio",
  km_inicial: "los km iniciales", km_final: "los km finales", combustible_unidad: "la unidad del combustible", rubro_detalle: "el rubro",
  nuevo_origen: "la visita de origen", responsable_ausente: "«el responsable no estaba» junto con «habló con el responsable»",
  tipo: "el tipo de gestión", observacion: "la observación", ocurrida_en: "el momento de la gestión (no futuro ni anterior al lead)",
  estado: "el estado", resolver: "la acción a resolver (una nota no la completa)", vence_el: "la fecha de la próxima acción",
  retomar_el: "la fecha para retomar (desde mañana)", detalle: "el detalle del motivo", contacto_id: "el contacto",
  // B3
  producto: "el producto", fecha_acuerdo: "la fecha del acuerdo (no futura ni anterior al inicio del ciclo)", experiencias: "la cantidad de experiencias",
  importe: "el importe (hasta 2 decimales, mayor que cero)", comision: "la comisión", comision_tipo: "el tipo de comisión",
  comision_fundamento: "el fundamento de la comisión", comision_importe: "el importe de la comisión (mayor que cero y no mayor que la venta)",
  comision_beneficiario: "quién cobra la comisión", comision_intervencion: "la intervención del comercial (una visita suya en esta oportunidad)",
  comision_detalle: "el detalle del acuerdo especial", comision_no_corresponde: "la comisión (sin comisión no lleva importe ni beneficiario)",
  fecha_efectiva: "la fecha efectiva del cobro (entre el acuerdo y hoy)", medio: "el medio y el concepto del cobro", fecha: "la fecha (entre el acuerdo y hoy)",
  precio: "el precio", comision_estandar: "la comisión de lista", campania_id: "la campaña", cambios: "los cambios",
};

/** Error conocido de una RPC, o null (la ruta contesta 500 genérico). Nunca pasa detalles de Postgres. */
export function errorDeRpcCrm(err: { code?: string | null; message?: string | null } | null | undefined): ErrorCrm | null {
  if (!err) return null;
  const msg = String(err.message ?? "");
  if (msg.startsWith("datos_invalidos:")) {
    const campo = msg.slice("datos_invalidos:".length);
    if (!/^[a-z_]{1,40}$/.test(campo)) return { status: 400, codigo: "datos_invalidos", error: "Datos inválidos." };
    return { status: 400, codigo: "datos_invalidos", campo, error: `Revisá ${CAMPOS[campo] ?? campo.replace(/_/g, " ")}.` };
  }
  const e = ERRORES[msg];
  return e ? { ...e, codigo: msg } : null;
}

export function esUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Lo que falta cargar de una jornada (para la ficha y las listas). NULL = sin cargar; 0 = cero confirmado. */
export function pendientesJornada(j: Pick<JornadaDto, "km_inicial" | "km_final" | "combustible_importe" | "estacionamiento_importe" | "peajes_importe" | "otros_importe">): string[] {
  const p: string[] = [];
  if (j.km_inicial === null) p.push("km iniciales");
  if (j.km_final === null) p.push("km finales");
  if (j.combustible_importe === null) p.push("combustible");
  if (j.estacionamiento_importe === null) p.push("estacionamiento");
  if (j.peajes_importe === null) p.push("peajes");
  if (j.otros_importe === null) p.push("otros gastos");
  return p;
}

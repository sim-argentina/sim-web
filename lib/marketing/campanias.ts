// ============================================================================
// Campañas de Marketing — reglas y textos PUROS (servidor y panel).
// ----------------------------------------------------------------------------
// Sin base, sin red y sin secretos. La cola, los lotes y la base están en
// lib/marketing/campaniasServer.ts y db/marketing-campanias.sql.
//
// Lo que esta etapa NO hace: enviar WhatsApp, crear códigos de descuento, cobrar.
// Todo lo que muestra como "enviado", "entregado" o "costo" es SIMULADO, y los
// beneficios son ficticios (SIMU-XXXXXXXX): no existen en codigos_descuento.
//
// Condiciones comerciales: el 15 % y los 7 días son una PROPUESTA sin aprobar.
// El formulario arranca vacío y la propuesta solo se puede cargar a mano,
// rotulada como tal.
// ============================================================================

import { sumarDias } from "@/lib/agenda";
import { RUTA_BAJA } from "@/lib/marketing/consentimiento";
import { estimarCosto, type EstimacionCosto } from "@/lib/marketing/costo";

export const VENTANAS_CAMPANIA = [14, 21] as const;
export type VentanaCampania = (typeof VENTANAS_CAMPANIA)[number];

export const PRODUCTOS_CAMPANIA = [
  { valor: "reserva", etiqueta: "Reservas web" },
  { valor: "gift_card", etiqueta: "Gift Cards" },
] as const;
export type ProductoCampania = (typeof PRODUCTOS_CAMPANIA)[number]["valor"];

export const TIPOS_BENEFICIO = [
  { valor: "porcentaje", etiqueta: "Porcentaje de descuento" },
  { valor: "monto_fijo", etiqueta: "Monto fijo de descuento ($)" },
] as const;
export type TipoBeneficio = (typeof TIPOS_BENEFICIO)[number]["valor"];

/** Lo que se discutió y NADIE aprobó. Se muestra como propuesta, nunca como condición vigente. */
export const PROPUESTA_SIN_APROBAR = { beneficio_tipo: "porcentaje" as TipoBeneficio, beneficio_valor: 15, beneficio_vigencia_dias: 7 };

export const VARIABLES_MENSAJE = [
  { clave: "nombre", descripcion: "Nombre de la última visita (vacío si hay varios o ninguno)" },
  { clave: "beneficio", descripcion: "El beneficio, p. ej. «10 % de descuento»" },
  { clave: "codigo", descripcion: "El cupón del destinatario (en la simulación, ficticio)" },
  { clave: "vence", descripcion: "Último día para usarlo (dd/mm)" },
  { clave: "productos", descripcion: "Dónde vale: reservas web y/o Gift Cards" },
  { clave: "baja", descripcion: "Enlace para dejar de recibir promociones" },
] as const;
export type VariableMensaje = (typeof VARIABLES_MENSAJE)[number]["clave"];

export const LIMITES_CAMPANIA = {
  nombre: [3, 80], objetivo: [3, 300], mensaje: [10, 1024], limite: [1, 5000], vigencia: [1, 60],
  porcentaje: [1, 100], montoFijo: [1, 1_000_000], tarifaMax: 100, presupuestoMax: 1_000_000, indicativos: 50,
} as const;

export type SimulacionProveedor = {
  fallo_definitivo_pct: number;
  fallo_transitorio_pct: number;
  incierto_pct: number;
  no_entregado_pct: number;
};
export const SIMULACION_POR_DEFECTO: SimulacionProveedor = {
  fallo_definitivo_pct: 5, fallo_transitorio_pct: 10, incierto_pct: 5, no_entregado_pct: 5,
};

export type DatosCampania = {
  nombre: string;
  objetivo: string;
  ventana_dias: VentanaCampania;
  solo_pagos: boolean;
  excluir_retornados: boolean;
  excluir_mensualidades: boolean;
  indicativos: string[];
  mensaje: string;
  productos: ProductoCampania[];
  beneficio_tipo: TipoBeneficio | null;
  beneficio_valor: number | null;
  beneficio_vigencia_dias: number | null;
  limite_destinatarios: number | null;
  tarifa: number | null;
  moneda: string | null;
  presupuesto_maximo: number | null;
  simulacion: SimulacionProveedor;
};

export type ErrorCampo = { campo: string; error: string };
export type Validacion =
  | { ok: true; valor: DatosCampania; advertencias: string[] }
  | { ok: false; errores: ErrorCampo[] };

const VARIABLE_RE = /\{([a-z_]+)\}/g;
const CLAVES = new Set<string>(VARIABLES_MENSAJE.map((v) => v.clave));

/** Variables usadas en el mensaje y las que no existen. */
export function variablesDelMensaje(mensaje: string): { usadas: VariableMensaje[]; desconocidas: string[] } {
  const usadas = new Set<VariableMensaje>();
  const desconocidas = new Set<string>();
  for (const m of mensaje.matchAll(VARIABLE_RE)) {
    if (CLAVES.has(m[1])) usadas.add(m[1] as VariableMensaje);
    else desconocidas.add(m[1]);
  }
  // Llaves sueltas o mal formadas: "{ nombre }", "{Nombre}", "{{1}}".
  const resto = mensaje.replace(VARIABLE_RE, "");
  if (/[{}]/.test(resto)) desconocidas.add("llaves mal formadas");
  return { usadas: [...usadas], desconocidas: [...desconocidas] };
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}
function numeroOpcional(v: unknown): number | null | "invalido" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : Number.NaN;
  return Number.isFinite(n) ? n : "invalido";
}
function pct(v: unknown): number | "invalido" {
  const n = numeroOpcional(v);
  if (n === null) return 0;
  return n === "invalido" || n < 0 || n > 100 ? "invalido" : n;
}

/**
 * Valida y normaliza lo que manda el panel. No decide nada que dependa de la
 * base (los indicativos oficiales los confirma el servidor con audiencia.ts).
 */
export function validarDatosCampania(body: unknown): Validacion {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errores: ErrorCampo[] = [];
  const advertencias: string[] = [];
  const L = LIMITES_CAMPANIA;
  const err = (campo: string, error: string) => errores.push({ campo, error });

  const nombre = texto(b.nombre);
  if (nombre.length < L.nombre[0] || nombre.length > L.nombre[1]) err("nombre", `El nombre va de ${L.nombre[0]} a ${L.nombre[1]} caracteres.`);
  const objetivo = texto(b.objetivo);
  if (objetivo.length < L.objetivo[0] || objetivo.length > L.objetivo[1]) err("objetivo", `El objetivo va de ${L.objetivo[0]} a ${L.objetivo[1]} caracteres.`);

  const ventana = Number(b.ventana_dias);
  if (!(VENTANAS_CAMPANIA as readonly number[]).includes(ventana)) err("ventana_dias", "La ventana es de 14 o 21 días.");

  const indicativos = Array.isArray(b.indicativos)
    ? [...new Set(b.indicativos.map((x) => String(x ?? "").trim()).filter(Boolean))].sort()
    : typeof b.indicativos === "string"
      ? [...new Set(b.indicativos.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))].sort()
      : [];
  if (indicativos.length > L.indicativos) err("indicativos", `Hasta ${L.indicativos} indicativos.`);
  for (const i of indicativos) if (!/^[0-9]{2,4}$/.test(i)) { err("indicativos", `"${i}" no es un indicativo (2 a 4 dígitos).`); break; }

  const mensaje = typeof b.mensaje === "string" ? b.mensaje.replace(/\r\n/g, "\n").trim() : "";
  if (mensaje.length < L.mensaje[0] || mensaje.length > L.mensaje[1]) err("mensaje", `El mensaje va de ${L.mensaje[0]} a ${L.mensaje[1]} caracteres.`);
  const vars = variablesDelMensaje(mensaje);
  if (vars.desconocidas.length) err("mensaje", `Variables no admitidas: ${vars.desconocidas.join(", ")}. Se pueden usar: ${VARIABLES_MENSAJE.map((v) => `{${v.clave}}`).join(" ")}.`);
  if (!vars.usadas.includes("codigo")) advertencias.push("El mensaje no incluye {codigo}: el destinatario no sabría qué cupón usar.");
  if (!vars.usadas.includes("baja")) advertencias.push("El mensaje no incluye {baja}: conviene decir cómo dejar de recibir promociones.");

  const productos = Array.isArray(b.productos)
    ? [...new Set(b.productos.map(String))].filter((p): p is ProductoCampania => p === "reserva" || p === "gift_card").sort()
    : [];
  if (productos.length === 0) err("productos", "Elegí al menos un producto.");

  const tipo = b.beneficio_tipo === "porcentaje" || b.beneficio_tipo === "monto_fijo" ? b.beneficio_tipo : null;
  if (b.beneficio_tipo && !tipo) err("beneficio_tipo", "Tipo de beneficio inválido.");
  const valor = numeroOpcional(b.beneficio_valor);
  if (valor === "invalido") err("beneficio_valor", "El valor del beneficio tiene que ser un número.");
  else if (valor !== null) {
    if (!tipo) err("beneficio_tipo", "Elegí el tipo de beneficio.");
    else if (tipo === "porcentaje" && (valor < L.porcentaje[0] || valor > L.porcentaje[1])) err("beneficio_valor", "El porcentaje va de 1 a 100.");
    else if (tipo === "monto_fijo" && (valor < L.montoFijo[0] || valor > L.montoFijo[1])) err("beneficio_valor", "El monto va de $1 a $1.000.000.");
  }
  const vigencia = numeroOpcional(b.beneficio_vigencia_dias);
  if (vigencia === "invalido" || (vigencia !== null && (!Number.isInteger(vigencia) || vigencia < L.vigencia[0] || vigencia > L.vigencia[1]))) {
    err("beneficio_vigencia_dias", "La vigencia va de 1 a 60 días.");
  }

  const limite = numeroOpcional(b.limite_destinatarios);
  if (limite === "invalido" || (limite !== null && (!Number.isInteger(limite) || limite < L.limite[0] || limite > L.limite[1]))) {
    err("limite_destinatarios", "El límite va de 1 a 5000 destinatarios (vacío = sin límite).");
  }
  const tarifa = numeroOpcional(b.tarifa);
  if (tarifa === "invalido" || (tarifa !== null && (tarifa <= 0 || tarifa > L.tarifaMax))) err("tarifa", "La tarifa tiene que ser un número positivo.");
  const moneda = texto(b.moneda).toUpperCase() || null;
  if (moneda !== null && !/^[A-Z]{3}$/.test(moneda)) err("moneda", "Moneda de 3 letras (p. ej. USD).");
  if (tarifa !== null && tarifa !== "invalido" && !moneda) err("moneda", "Falta la moneda de la tarifa.");
  const presupuesto = numeroOpcional(b.presupuesto_maximo);
  if (presupuesto === "invalido" || (presupuesto !== null && (presupuesto < 0 || presupuesto > L.presupuestoMax))) err("presupuesto_maximo", "Presupuesto inválido.");
  if (presupuesto !== null && presupuesto !== "invalido" && tarifa === null) err("tarifa", "El presupuesto necesita la tarifa.");

  const s = (b.simulacion && typeof b.simulacion === "object" ? b.simulacion : SIMULACION_POR_DEFECTO) as Record<string, unknown>;
  const simulacion = {
    fallo_definitivo_pct: pct(s.fallo_definitivo_pct),
    fallo_transitorio_pct: pct(s.fallo_transitorio_pct),
    incierto_pct: pct(s.incierto_pct),
    no_entregado_pct: pct(s.no_entregado_pct),
  };
  if (Object.values(simulacion).some((v) => v === "invalido")) err("simulacion", "Los porcentajes de la simulación van de 0 a 100.");
  else if ((simulacion.fallo_definitivo_pct as number) + (simulacion.fallo_transitorio_pct as number) + (simulacion.incierto_pct as number) > 100) {
    err("simulacion", "Definitivos + transitorios + inciertos no pueden pasar el 100 %.");
  }

  if (errores.length) return { ok: false, errores };
  return {
    ok: true,
    advertencias,
    valor: {
      nombre, objetivo, ventana_dias: ventana as VentanaCampania,
      solo_pagos: b.solo_pagos !== false, excluir_retornados: b.excluir_retornados === true, excluir_mensualidades: b.excluir_mensualidades === true,
      indicativos, mensaje, productos,
      beneficio_tipo: tipo, beneficio_valor: valor as number | null, beneficio_vigencia_dias: vigencia as number | null,
      limite_destinatarios: limite as number | null, tarifa: tarifa as number | null, moneda, presupuesto_maximo: presupuesto as number | null,
      simulacion: simulacion as SimulacionProveedor,
    },
  };
}

/** Lo que falta para poder preparar (calcular y fijar la audiencia con sus beneficios). */
export function faltantesParaPreparar(d: Pick<DatosCampania, "beneficio_tipo" | "beneficio_valor" | "beneficio_vigencia_dias" | "tarifa" | "moneda">): string[] {
  const f: string[] = [];
  if (!d.beneficio_tipo || d.beneficio_valor === null) f.push("tipo y valor del beneficio");
  if (d.beneficio_vigencia_dias === null) f.push("vencimiento del beneficio");
  if (d.tarifa === null || !d.moneda) f.push("tarifa de referencia y moneda");
  return f;
}

// ── Textos para el destinatario ───────────────────────────────────────────
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export function describirBeneficio(tipo: TipoBeneficio | null, valor: number | null): string {
  if (!tipo || valor === null) return "(beneficio sin definir)";
  return tipo === "porcentaje" ? `${valor.toLocaleString("es-AR")} % de descuento` : `${pesos(valor)} de descuento`;
}

export function describirProductos(productos: readonly ProductoCampania[]): string {
  const p = new Set(productos);
  if (p.has("reserva") && p.has("gift_card")) return "reservas web y Gift Cards";
  return p.has("gift_card") ? "Gift Cards" : "reservas web";
}

/** Último día de uso, dd/mm, contando desde `hoy` (fecha de negocio de Argentina). */
export function venceEl(hoy: string, dias: number | null): string {
  if (!dias) return "(sin vencimiento definido)";
  const f = sumarDias(hoy, dias);
  return `${f.slice(8, 10)}/${f.slice(5, 7)}`;
}

export const ENLACE_BAJA = `simexperience.com.ar${RUTA_BAJA}`;

export type ValoresMensaje = Record<VariableMensaje, string>;

/** Reemplaza las variables y limpia los espacios que deja un {nombre} vacío. */
export function renderizarMensaje(plantilla: string, valores: ValoresMensaje): string {
  return plantilla
    .replace(VARIABLE_RE, (_, k: string) => (CLAVES.has(k) ? valores[k as VariableMensaje] ?? "" : `{${k}}`))
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "");
}

export function valoresMensaje(d: Pick<DatosCampania, "beneficio_tipo" | "beneficio_valor" | "beneficio_vigencia_dias" | "productos">,
  destinatario: { nombre: string | null; codigo: string }, hoy: string): ValoresMensaje {
  return {
    nombre: destinatario.nombre ?? "",
    beneficio: describirBeneficio(d.beneficio_tipo, d.beneficio_valor),
    codigo: destinatario.codigo,
    vence: venceEl(hoy, d.beneficio_vigencia_dias),
    productos: describirProductos(d.productos),
    baja: ENLACE_BAJA,
  };
}

/** Las condiciones como las leería el destinatario. */
export function condicionesParaDestinatario(d: Pick<DatosCampania, "beneficio_tipo" | "beneficio_valor" | "beneficio_vigencia_dias" | "productos">, hoy: string): string[] {
  return [
    `${describirBeneficio(d.beneficio_tipo, d.beneficio_valor)} con un código personal de un solo uso.`,
    `Vale hasta el ${venceEl(hoy, d.beneficio_vigencia_dias)} inclusive (fecha de Argentina).`,
    `Se usa en la web, para ${describirProductos(d.productos)}.`,
    `Para no recibir más promociones: ${ENLACE_BAJA}.`,
  ];
}

// ── Qué puede hacer cumplir HOY el módulo de Códigos ──────────────────────
export type Capacidad = { restriccion: string; estado: "aplicada" | "parcial" | "no_aplicada"; detalle: string };

export function capacidadesCodigos(productos: readonly ProductoCampania[]): Capacidad[] {
  const ambos = productos.includes("reserva") && productos.includes("gift_card");
  const otro = productos.includes("reserva") ? "Gift Cards" : "reservas web";
  return [
    { restriccion: "Tipo y valor del descuento", estado: "aplicada", detalle: "Porcentaje o monto fijo, calculado por el servidor en Reservas y Gift Cards." },
    { restriccion: "Vencimiento", estado: "aplicada", detalle: "Fecha de fin por día de Argentina (fecha_fin del código)." },
    { restriccion: "Un solo uso, exclusivo entre productos", estado: "aplicada", detalle: "usos_maximos = 1 con retención atómica (exige db/cupones-retencion.sql en la base)." },
    ambos
      ? { restriccion: "Productos alcanzados", estado: "aplicada", detalle: "El código vale en reservas web y en Gift Cards, que es lo elegido." }
      : { restriccion: "Productos alcanzados", estado: "no_aplicada", detalle: `No se hace cumplir: el código también descontaría en ${otro}. El módulo no tiene restricción por producto.` },
    { restriccion: "Días, duraciones o días hábiles", estado: "parcial", detalle: "Solo en Reservas; Gift Cards los ignora. Esta campaña no los usa." },
    { restriccion: "Cantidad de Gift Cards por compra", estado: "no_aplicada", detalle: "No se valida al comprar: un cupón descuenta sobre el total de hasta 10 Gift Cards y cuenta un uso." },
    { restriccion: "Tope del descuento en pesos", estado: "no_aplicada", detalle: "No existe: un porcentaje se aplica sobre el total de la compra." },
    { restriccion: "Atado al teléfono del destinatario", estado: "no_aplicada", detalle: "No: quien recibe el código puede reenviarlo; el primero que lo usa lo consume." },
    { restriccion: "Canje en el stand", estado: "no_aplicada", detalle: "El Turnero no tiene campo de código: solo compras web." },
  ];
}

// ── Topes ─────────────────────────────────────────────────────────────────
export type Topes = { seleccionados: number; recortadoPor: EstimacionCosto["recortadoPor"]; costo: EstimacionCosto | null };

/** Cuántos de `elegibles` entran con el límite y el presupuesto. Sin tarifa, solo el límite. */
export function aplicarTopes(elegibles: number, d: Pick<DatosCampania, "limite_destinatarios" | "tarifa" | "moneda" | "presupuesto_maximo">): Topes {
  if (d.tarifa === null || !d.moneda) {
    const n = d.limite_destinatarios === null ? elegibles : Math.min(elegibles, d.limite_destinatarios);
    return { seleccionados: n, recortadoPor: n < elegibles ? ["limite"] : [], costo: null };
  }
  const costo = estimarCosto({
    destinatarios: elegibles, tarifaPorEntregado: d.tarifa, moneda: d.moneda,
    limiteDestinatarios: d.limite_destinatarios, presupuestoMaximo: d.presupuesto_maximo,
  });
  return { seleccionados: costo.enviables, recortadoPor: costo.recortadoPor, costo };
}

// ── Estados y motivos (etiquetas del panel) ───────────────────────────────
export const ESTADOS_CAMPANIA = {
  borrador: "Borrador", preparada: "Preparada", ejecutando: "Ejecutando (simulación)", pausada: "Pausada",
  cancelada: "Cancelada", completada: "Completada (simulación)",
} as const;
export type EstadoCampania = keyof typeof ESTADOS_CAMPANIA;

export const ESTADOS_DESTINATARIO = {
  pendiente: "Pendiente", enviando: "Enviando", aceptado: "Aceptado (simulado)", entregado: "Entregado (simulado)",
  no_entregado: "No entregado (simulado)", fallido: "Fallido", incierto: "Incierto", excluido: "Excluido", cancelado: "Cancelado",
} as const;
export type EstadoDestinatario = keyof typeof ESTADOS_DESTINATARIO;

export const MOTIVOS_DESTINATARIO: Record<string, string> = {
  baja_posterior: "Pidió la baja después de preparar",
  sin_consentimiento: "Sin consentimiento vigente al enviar",
  sin_cupo: "Sin cupo de límite o presupuesto",
  campania_cancelada: "Campaña cancelada",
  error_definitivo: "Error definitivo del proveedor",
  reintentos_agotados: "Reintentos agotados",
  error_transitorio: "Error transitorio: se reintenta",
  respuesta_incierta: "Sin respuesta del proveedor",
  ejecutor_interrumpido: "El ejecutor se cortó con el envío en curso",
  reintento_manual: "Reintento decidido por un admin",
  incierto_descartado: "Incierto dado por fallido",
};

export const MOTIVOS_AUDIENCIA: Record<string, string> = {
  cancelado: "Turno cancelado", no_pago: "Turno sin pago (filtro solo pagos)", sin_telefono: "Sin teléfono",
  telefono_no_normalizable: "Teléfono que no se puede normalizar",
  con_baja: "Con baja", titular_mensualidad: "Titular de mensualidad", en_otra_campania: "En otra campaña en curso",
  indicativo_indeterminado: "Indicativo indeterminado", fuera_de_segmento: "Fuera del segmento",
  ya_volvio: "Ya volvió (2+ días)", sin_consentimiento: "Sin consentimiento registrado",
};

// ── Errores de la API ─────────────────────────────────────────────────────
export type ErrorCampanias = { status: number; codigo: string; error: string; campo?: string };

const MENSAJES: Record<string, { status: number; error: string }> = {
  datos_invalidos: { status: 400, error: "Hay datos inválidos." },
  campania_incompleta: { status: 400, error: "Para preparar faltan el beneficio (tipo, valor y vencimiento) o la tarifa y su moneda." },
  solo_admin: { status: 403, error: "Solo un admin puede crear, modificar o ejecutar campañas." },
  solo_simulacion_local: { status: 403, error: "En esta base no se guardan ni se ejecutan campañas: solo la base local de pruebas, con datos sintéticos." },
  campania_inexistente: { status: 404, error: "La campaña no existe." },
  destinatario_inexistente: { status: 404, error: "El destinatario no existe." },
  no_editable: { status: 409, error: "La campaña ya no es un borrador: no se puede modificar." },
  version_desactualizada: { status: 409, error: "Alguien cambió la campaña mientras la mirabas. Recargá y volvé a intentar." },
  transicion_invalida: { status: 409, error: "Esa acción no corresponde al estado actual de la campaña." },
  tope_excedido: { status: 409, error: "La selección supera el límite de destinatarios o el presupuesto." },
  audiencia_vacia: { status: 409, error: "No hay destinatarios elegibles: no hay nada que preparar." },
  destinatario_duplicado: { status: 409, error: "Un teléfono aparece dos veces en la selección." },
  campanias_no_instaladas: { status: 503, error: "Las campañas no están instaladas en esta base (falta db/marketing-campanias.sql)." },
  lectura_inconsistente: { status: 503, error: "La lectura de turnos no coincidió con el conteo: no se usa. Probá de nuevo." },
};

export function errorCampanias(codigo: string, campo?: string): ErrorCampanias {
  const m = MENSAJES[codigo] ?? { status: 500, error: "No se pudo completar la operación." };
  return { status: m.status, codigo, error: m.error, ...(campo ? { campo } : {}) };
}

const SIN_INSTALAR = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);
const CONSTRAINT_CAMPO: Record<string, string> = {
  mkt_campanias_nombre: "nombre", mkt_campanias_objetivo: "objetivo", mkt_campanias_ventana: "ventana_dias",
  mkt_campanias_indicativos: "indicativos", mkt_campanias_mensaje: "mensaje", mkt_campanias_productos: "productos",
  mkt_campanias_beneficio: "beneficio_valor", mkt_campanias_topes: "tarifa", mkt_campanias_simulacion: "simulacion",
};

/** Error de PostgREST/RPC → error conocido; null = inesperado (500, detalle solo en el log). */
export function errorDeRpcCampanias(err: { code?: string | null; message?: string | null } | null | undefined): ErrorCampanias | null {
  if (!err) return null;
  if (err.code && SIN_INSTALAR.has(err.code)) return errorCampanias("campanias_no_instaladas");
  const msg = String(err.message ?? "");
  if (err.code === "23514") {
    const c = Object.keys(CONSTRAINT_CAMPO).find((k) => msg.includes(k));
    return errorCampanias("datos_invalidos", c ? CONSTRAINT_CAMPO[c] : undefined);
  }
  if (err.code === "22P02" || err.code === "22003") return errorCampanias("datos_invalidos");
  const [codigo, detalle] = msg.split(":");
  if (!MENSAJES[codigo]) return null;
  return errorCampanias(codigo, codigo === "tope_excedido" || codigo === "datos_invalidos" ? detalle || undefined : undefined);
}

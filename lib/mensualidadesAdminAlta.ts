import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AdminRole } from "@/lib/adminSession";
import {
  normalizarTelefonoDetallado,
  telefonoNormalizadoValido,
  estadoMensualidad,
  simularCompra,
  type EstadoMensualidad,
} from "@/lib/mensualidades";
import { getPlanesActivos } from "@/lib/mensualidadesCompra";
import { fechaValida } from "@/lib/agenda";

// Alta y renovación administrativa de mensualidades (Bloque M7.4). SOLO SERVIDOR.
//
// Reemplaza la regla anterior de "compra solo web": un administrador puede
// registrar una mensualidad desde el panel, en dos modalidades que NO se
// distinguen por el precio sino por el canal que queda escrito en la compra:
//
//   · venta      → se cobró fuera del checkout. Genera ingreso en Finanzas.
//   · cortesia   → no se cobró nada. NUNCA genera ingreso.
//
// Este módulo NO decide reglas de negocio. El precio sale del plan activo, los
// minutos y el vencimiento los calcula la base, el código lo genera la base y la
// comisión sale de fin_comisiones_cobro. Acá solo se valida la FORMA de la
// solicitud y se traducen los errores del motor a algo legible.
//
// EL PERMISO NO SE COMPRUEBA ACÁ: lo comprueba el route handler con
// requireAdmin(). La RPC además exige rol 'admin' por su cuenta, así que staff
// no puede dar de alta aunque alguien saltee la puerta de la ruta.
//
// Funciona con MENSUALIDADES_ENABLED apagada a propósito: esa bandera controla
// la exposición PÚBLICA del producto, no la gestión interna.

export const MODALIDADES = ["venta", "cortesia"] as const;
export type Modalidad = (typeof MODALIDADES)[number];

// Solo los medios con cuenta inequívoca en el modelo financiero vigente:
// efectivo → cuenta Efectivo; qr/débito/crédito → procesador Mercado Pago →
// cuenta Mercado Pago. Payway y transferencia quedan fuera a propósito hasta
// que exista una regla de imputación para ellos.
export const MEDIOS_PAGO = ["efectivo", "qr", "debito", "credito"] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number];

export const CORTESIA_TIPOS = ["cortesia_comercial", "compensacion", "correccion_autorizada"] as const;
export type CortesiaTipo = (typeof CORTESIA_TIPOS)[number];

export const CORTESIA_LABEL: Record<CortesiaTipo, string> = {
  cortesia_comercial: "Cortesía comercial",
  compensacion: "Compensación",
  correccion_autorizada: "Corrección autorizada",
};

export const MEDIO_LABEL: Record<MedioPago, string> = {
  efectivo: "Efectivo",
  qr: "QR",
  debito: "Débito",
  credito: "Crédito",
};

export const MOTIVO_MAX = 500;
const MAX_NOMBRE = 60;
const MAX_EMAIL = 120;
const IDEM_RE = /^[A-Za-z0-9_-]{16,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type FalloAlta = { ok: false; status: number; codigo: string; error: string; campo?: string };
export type ResultadoAlta<T> = { ok: true; data: T } | FalloAlta;

const fail = (status: number, codigo: string, error: string, campo?: string): FalloAlta =>
  ({ ok: false, status, codigo, error, campo });

// Errores de la RPC → respuesta pública. Nunca se devuelve el texto crudo ni el
// nombre de una constraint.
const MAPA: Record<string, { status: number; error: string; campo?: string }> = {
  motivo_requerido: { status: 422, error: "Escribí el motivo de la operación.", campo: "motivo" },
  motivo_demasiado_largo: { status: 422, error: `El motivo no puede superar los ${MOTIVO_MAX} caracteres.`, campo: "motivo" },
  actor_requerido: { status: 400, error: "Solicitud inválida." },
  idempotency_key_invalida: { status: 400, error: "Solicitud inválida." },
  // La RPC exige rol 'admin' por su cuenta: es la segunda puerta, después de
  // requireAdmin(). Si esto salta, alguien llegó sin permiso.
  rol_no_autorizado: { status: 403, error: "No tenés permiso para registrar mensualidades." },
  declaracion_requerida: {
    status: 422,
    error: "Confirmá que le informaste al titular las condiciones de uso y vigencia.",
    campo: "declaracion",
  },
  modalidad_invalida: { status: 422, error: "Elegí si es una venta o una cortesía.", campo: "modalidad" },
  medio_pago_invalido: { status: 422, error: "Elegí un medio de pago.", campo: "medio_pago" },
  medio_pago_no_corresponde: { status: 422, error: "Una cortesía no lleva medio de pago.", campo: "medio_pago" },
  cortesia_tipo_invalido: { status: 422, error: "Elegí el tipo de otorgamiento.", campo: "cortesia_tipo" },
  cortesia_tipo_no_corresponde: { status: 422, error: "Una venta no lleva tipo de cortesía.", campo: "cortesia_tipo" },
  plan_inexistente: { status: 404, error: "Ese plan no está disponible.", campo: "plan_slug" },
  telefono_invalido: {
    status: 422,
    error: "Ese teléfono no es válido. Usá código de área y número, sin 0 ni 15.",
    campo: "telefono",
  },
  telefono_no_canonico: { status: 422, error: "Ese teléfono no es válido.", campo: "telefono" },
  email_invalido: { status: 422, error: "Revisá el correo electrónico.", campo: "email" },
  nombre_invalido: { status: 422, error: "Revisá el nombre y el apellido.", campo: "nombre" },
  fecha_cobro_futura: {
    status: 422,
    error: "La fecha del cobro no puede ser posterior a hoy.",
    campo: "cobrado_el",
  },
  // Deliberado: una billetera bloqueada NO se reactiva por una venta. El admin
  // tiene que desbloquearla explícitamente, que es otra acción y queda auditada.
  mensualidad_bloqueada: {
    status: 409,
    error: "Esa mensualidad está bloqueada. Reactivala desde su detalle antes de renovarla.",
  },
  clave_de_otra_compra: {
    status: 409,
    error: "Esa operación ya se registró con otros datos. Recargá y volvé a intentar.",
  },
  compra_no_web: { status: 409, error: "Solicitud inválida." },
};

function traducir(mensaje: string): FalloAlta {
  for (const clave of Object.keys(MAPA)) {
    if (mensaje.includes(clave)) {
      const m = MAPA[clave];
      return fail(m.status, clave, m.error, m.campo);
    }
  }
  return fail(500, "error", "No pudimos completar la operación. Probá de nuevo.");
}

function texto(v: unknown): string {
  return String(v ?? "").trim();
}

// Sin caracteres de control: rompen logs, encabezados y la pantalla de detalle.
function tieneControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// ── Entrada validada ────────────────────────────────────────────────────────

export type DatosAlta = {
  nombre: string;
  apellido: string;
  telefono: string;
  telefonoNorm: string;
  email: string;
  planSlug: string;
  modalidad: Modalidad;
  medioPago: MedioPago | null;
  cortesiaTipo: CortesiaTipo | null;
  motivo: string;
  declaracion: boolean;
  cobradoEl: string | null;
};

/**
 * Valida la FORMA de la solicitud. Todo lo monetario y todo lo que define el
 * resultado (precio, minutos, vencimiento, código) se resuelve después en la
 * base: acá no se acepta ninguno de esos valores aunque vengan en el cuerpo.
 */
export function validarAlta(body: unknown): ResultadoAlta<DatosAlta> {
  const b = (body ?? {}) as Record<string, unknown>;

  const nombre = texto(b.nombre);
  if (!nombre || nombre.length > MAX_NOMBRE || tieneControl(nombre)) {
    return fail(422, "nombre_invalido", "Revisá el nombre.", "nombre");
  }
  const apellido = texto(b.apellido);
  if (!apellido || apellido.length > MAX_NOMBRE || tieneControl(apellido)) {
    return fail(422, "nombre_invalido", "Revisá el apellido.", "apellido");
  }

  const telefonoCrudo = texto(b.telefono);
  const tel = normalizarTelefonoDetallado(telefonoCrudo);
  if (!tel.ok || !telefonoNormalizadoValido(tel.valor)) {
    return fail(
      422,
      "telefono_invalido",
      "Ese teléfono no es válido. Usá código de área y número, sin 0 ni 15.",
      "telefono",
    );
  }

  const email = texto(b.email).toLowerCase();
  if (!email || email.length > MAX_EMAIL || tieneControl(email) || !EMAIL_RE.test(email)) {
    return fail(422, "email_invalido", "Revisá el correo electrónico.", "email");
  }

  const planSlug = texto(b.plan_slug);
  if (!planSlug || planSlug.length > 32 || !/^[a-z0-9_-]+$/.test(planSlug)) {
    return fail(422, "plan_inexistente", "Elegí un plan.", "plan_slug");
  }

  const modalidad = texto(b.modalidad) as Modalidad;
  if (!(MODALIDADES as readonly string[]).includes(modalidad)) {
    return fail(422, "modalidad_invalida", "Elegí si es una venta o una cortesía.", "modalidad");
  }

  let medioPago: MedioPago | null = null;
  let cortesiaTipo: CortesiaTipo | null = null;
  let cobradoEl: string | null = null;

  if (modalidad === "venta") {
    const m = texto(b.medio_pago) as MedioPago;
    if (!(MEDIOS_PAGO as readonly string[]).includes(m)) {
      return fail(422, "medio_pago_invalido", "Elegí un medio de pago.", "medio_pago");
    }
    medioPago = m;
    const f = texto(b.cobrado_el);
    if (f) {
      // fechaValida() rechaza lo que el regex deja pasar y el calendario no
      // tiene: 2026-13-01 o 2026-02-31 no llegan nunca a la base.
      if (!fechaValida(f)) return fail(422, "fecha_cobro_futura", "Elegí una fecha válida.", "cobrado_el");
      cobradoEl = f;
    }
  } else {
    const c = texto(b.cortesia_tipo) as CortesiaTipo;
    if (!(CORTESIA_TIPOS as readonly string[]).includes(c)) {
      return fail(422, "cortesia_tipo_invalido", "Elegí el tipo de otorgamiento.", "cortesia_tipo");
    }
    cortesiaTipo = c;
  }

  // El motivo se recorta antes de mirarlo: "   " es motivo vacío.
  const motivo = texto(b.motivo);
  if (!motivo) return fail(422, "motivo_requerido", "Escribí el motivo de la operación.", "motivo");
  if (motivo.length > MOTIVO_MAX) {
    return fail(422, "motivo_demasiado_largo", `El motivo no puede superar los ${MOTIVO_MAX} caracteres.`, "motivo");
  }

  // Tiene que llegar true explícito: la casilla nunca viene premarcada.
  if (b.declaracion !== true) {
    return fail(
      422,
      "declaracion_requerida",
      "Confirmá que le informaste al titular las condiciones de uso y vigencia.",
      "declaracion",
    );
  }

  return {
    ok: true,
    data: {
      nombre,
      apellido,
      telefono: telefonoCrudo.slice(0, 40),
      telefonoNorm: tel.valor,
      email,
      planSlug,
      modalidad,
      medioPago,
      cortesiaTipo,
      motivo,
      declaracion: true,
      cobradoEl,
    },
  };
}

// ── Vista previa ────────────────────────────────────────────────────────────

export type SituacionTitular =
  | { tipo: "sin_mensualidad" }
  | {
      tipo: "existente";
      mensualidadId: string;
      estado: EstadoMensualidad;
      saldoMinutos: number;
      venceEl: string;
      bloqueada: boolean;
      titular: string;
    };

export type PreviaAlta = {
  situacion: SituacionTitular;
  operacion: "alta" | "renovacion";
  bloqueada: boolean;
  plan: { slug: string; nombre: string; minutos: number; precio: number; vigenciaDias: number };
  minutosTrasladados: number;
  minutosDescartados: number;
  saldoResultante: number;
  venceEstimado: string;
  codigoConservado: boolean;
  importe: number | null;
};

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Qué va a pasar si se confirma. Lo calcula el SERVIDOR con los mismos helpers
 * que replican la RPC (simularCompra / estadoMensualidad), para que la pantalla
 * no invente nada. Es una previsualización: la verdad la sigue escribiendo la
 * base, que puede ver un estado distinto si algo cambia en el medio.
 */
export async function previsualizarAlta(
  telefonoCrudo: string,
  planSlug: string,
  modalidad: Modalidad,
): Promise<ResultadoAlta<PreviaAlta>> {
  const tel = normalizarTelefonoDetallado(telefonoCrudo);
  if (!tel.ok || !telefonoNormalizadoValido(tel.valor)) {
    return fail(
      422,
      "telefono_invalido",
      "Ese teléfono no es válido. Usá código de área y número, sin 0 ni 15.",
      "telefono",
    );
  }
  if (!(MODALIDADES as readonly string[]).includes(modalidad)) {
    return fail(422, "modalidad_invalida", "Elegí si es una venta o una cortesía.", "modalidad");
  }

  const planes = await getPlanesActivos();
  const plan = planes.find((p) => p.slug === planSlug);
  if (!plan) return fail(404, "plan_inexistente", "Ese plan no está disponible.", "plan_slug");

  const { data: hoyRaw } = await supabaseAdmin.rpc("mensualidad_hoy");
  const hoy = String(hoyRaw);

  const { data: fila } = await supabaseAdmin
    .from("mensualidades")
    .select("id, saldo_minutos, vence_el, bloqueada, titular_nombre, titular_apellido")
    .eq("telefono_norm", tel.valor)
    .order("vence_el", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let situacion: SituacionTitular = { tipo: "sin_mensualidad" };
  let saldoActual = 0;
  let venceActual: string | null = null;
  let bloqueada = false;

  if (fila) {
    saldoActual = Number(fila.saldo_minutos) || 0;
    venceActual = String(fila.vence_el);
    bloqueada = Boolean(fila.bloqueada);
    situacion = {
      tipo: "existente",
      mensualidadId: String(fila.id),
      estado: estadoMensualidad({ saldoMinutos: saldoActual, venceEl: venceActual, bloqueada, hoy }),
      saldoMinutos: saldoActual,
      venceEl: venceActual,
      bloqueada,
      titular: `${fila.titular_nombre ?? ""} ${fila.titular_apellido ?? ""}`.trim(),
    };
  }

  const sim = simularCompra({
    saldoActual,
    venceActual,
    planMinutos: plan.minutos,
    hoy,
  });

  return {
    ok: true,
    data: {
      situacion,
      operacion: sim.tipo,
      bloqueada,
      plan: {
        slug: plan.slug,
        nombre: plan.nombre,
        minutos: plan.minutos,
        precio: plan.precio,
        vigenciaDias: plan.vigencia_dias,
      },
      minutosTrasladados: sim.trasladados,
      minutosDescartados: sim.descartados,
      saldoResultante: sim.saldoResultante,
      venceEstimado: sumarDias(hoy, plan.vigencia_dias),
      codigoConservado: sim.tipo === "renovacion",
      // Una cortesía no tiene importe: no es "precio cero", es sin cobro.
      importe: modalidad === "venta" ? plan.precio : null,
    },
  };
}

// ── Alta / renovación ───────────────────────────────────────────────────────

export type AltaRegistrada = {
  compra_id: string;
  mensualidad_id: string;
  codigo: string;
  tipo: "alta" | "renovacion";
  canal: "admin_venta" | "admin_cortesia";
  minutos_plan: number;
  saldo_anterior: number;
  saldo_posterior: number;
  vence_anterior: string | null;
  vence_el: string;
  codigo_conservado: boolean;
  importe_bruto: number | null;
  comision: number | null;
  importe_neto: number | null;
  idempotente: boolean;
};

export type ContextoAlta = { actor: string; rol: AdminRole; idempotencyKey: string };

/**
 * Registra el alta o la renovación. Una sola llamada a una RPC que hace TODO
 * dentro de una transacción: valida, bloquea por titular, crea la compra, la
 * aplica con la MISMA operación autoritativa que usa el webhook público y
 * audita. Si algo falla, no queda nada a medias.
 *
 * Idempotencia: la clave tiene índice único sobre mensualidad_compras, así que
 * dos envíos con la misma clave no pueden crear dos compras. El segundo
 * devuelve el resultado del primero con idempotente = true.
 */
export async function registrarAltaAdministrativa(
  datos: DatosAlta,
  ctx: ContextoAlta,
): Promise<ResultadoAlta<AltaRegistrada>> {
  if (!IDEM_RE.test(ctx.idempotencyKey)) {
    return fail(400, "idempotency_invalida", "Solicitud inválida.");
  }
  // Segunda puerta, además de requireAdmin() en la ruta. La RPC vuelve a
  // comprobarlo: staff no puede dar de alta por ningún camino.
  if (ctx.rol !== "admin") {
    return fail(403, "rol_no_autorizado", "No tenés permiso para registrar mensualidades.");
  }

  const { data, error } = await supabaseAdmin.rpc("mensualidad_admin_alta", {
    p_plan_slug: datos.planSlug,
    p_nombre: datos.nombre,
    p_apellido: datos.apellido,
    p_telefono: datos.telefono,
    p_email: datos.email,
    p_modalidad: datos.modalidad,
    p_medio_pago: datos.medioPago,
    p_cortesia_tipo: datos.cortesiaTipo,
    p_motivo: datos.motivo,
    p_actor: ctx.actor,
    p_actor_rol: ctx.rol,
    p_idempotency_key: ctx.idempotencyKey,
    p_declaracion: datos.declaracion,
    p_cobrado_el: datos.cobradoEl,
  });
  if (error) return traducir(String(error.message ?? ""));

  const fila = (Array.isArray(data) ? data[0] : data) as AltaRegistrada | undefined;
  if (!fila) return fail(500, "error", "No pudimos completar la operación. Probá de nuevo.");
  return { ok: true, data: fila };
}

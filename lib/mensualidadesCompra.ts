import { randomBytes, randomUUID } from "crypto";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizarTelefonoDetallado, telefonoNormalizadoValido, type Plan } from "@/lib/mensualidades";
import { PREFIJO_EXT_REF } from "@/lib/mensualidadesPago";
import { catalogoParaCrear } from "@/lib/mensualidadesComercial";

// Creación de la compra pública de Mensualidades (Bloque M3). Solo servidor.
// El navegador manda datos del comprador y el SLUG del plan: precio, minutos,
// vigencia y etiqueta los resuelve SIEMPRE el servidor. Nada monetario que
// venga del cliente se usa para nada.
//
// (B6) El precio sale del catálogo de la modalidad vigente
// (mensualidad_plan_precios, lib/mensualidadesComercial.ts), resuelta UNA vez en
// este request, y queda en el SNAPSHOT de la compra junto con la modalidad. Un
// reintento de una compra que ya existe usa SU snapshot, nunca el catálogo de
// hoy: así la preferencia, el webhook y la compra no pueden divergir.

export type Fallo = { ok: false; status: number; error: string; campo?: string; codigo?: string };
export type Ok<T> = { ok: true; data: T };
const fail = (status: number, error: string, campo?: string): Fallo => ({ ok: false, status, error, campo });

const MAX_NOMBRE = 60;
const MAX_EMAIL = 120;
const MAX_SLUG = 32;
const MAX_IDEM = 80;
// Sin caracteres de control: rompen logs, headers y la pantalla de resultado.
function tieneControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Token público de la pantalla de resultado: 24 bytes → 32 caracteres base64url.
export function nuevoTokenPublico(): string {
  return randomBytes(24).toString("base64url");
}

// external_reference NO predecible y SIN PII (nada de teléfono ni email).
export function nuevaExternalReference(): string {
  return `${PREFIJO_EXT_REF}${randomBytes(16).toString("base64url")}`;
}

// ── Catálogo ────────────────────────────────────────────────────────────────

// Planes activos, ordenados, con datos válidos. Es la única fuente de precios.
export async function getPlanesActivos(): Promise<Plan[]> {
  const { data, error } = await supabaseAdmin
    .from("mensualidad_planes")
    .select("id, slug, nombre, minutos, precio, vigencia_dias, etiqueta, orden, activo")
    .eq("activo", true)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((p) => ({ ...p, precio: Number(p.precio), minutos: Number(p.minutos), vigencia_dias: Number(p.vigencia_dias) }))
    .filter((p) => p.minutos > 0 && p.precio > 0 && p.vigencia_dias > 0) as Plan[];
}

// ── Validación del formulario ───────────────────────────────────────────────

export type DatosCompra = {
  nombre: string; apellido: string; telefono: string; telefonoNorm: string;
  email: string; planSlug: string; idempotencyKey: string;
};

function textoLimpio(v: unknown): string {
  return String(v ?? "").trim();
}

export function validarDatosCompra(body: unknown): Ok<DatosCompra> | Fallo {
  const b = (body ?? {}) as Record<string, unknown>;

  const nombre = textoLimpio(b.nombre);
  if (!nombre || nombre.length > MAX_NOMBRE || tieneControl(nombre)) {
    return fail(400, "Revisá el nombre.", "nombre");
  }
  const apellido = textoLimpio(b.apellido);
  if (!apellido || apellido.length > MAX_NOMBRE || tieneControl(apellido)) {
    return fail(400, "Revisá el apellido.", "apellido");
  }

  const telefonoCrudo = textoLimpio(b.telefono);
  const tel = normalizarTelefonoDetallado(telefonoCrudo);
  if (!tel.ok || !telefonoNormalizadoValido(tel.valor)) {
    return fail(400, "El teléfono no parece un número argentino válido. Escribilo con código de área, por ejemplo 351 512 3456.", "telefono");
  }

  const email = textoLimpio(b.email).toLowerCase();
  if (!email || email.length > MAX_EMAIL || tieneControl(email) || !EMAIL_RE.test(email)) {
    return fail(400, "Revisá el correo electrónico.", "email");
  }

  const planSlug = textoLimpio(b.plan_slug);
  if (!planSlug || planSlug.length > MAX_SLUG || !/^[a-z0-9_-]+$/.test(planSlug)) {
    return fail(400, "Elegí un plan.", "plan_slug");
  }

  // La casilla nunca viene premarcada: tiene que llegar true explícito.
  if (b.acepto_condiciones !== true) {
    return fail(400, "Tenés que aceptar las condiciones para continuar.", "acepto_condiciones");
  }

  const idemCrudo = textoLimpio(b.idempotency_key);
  const idempotencyKey = idemCrudo && idemCrudo.length <= MAX_IDEM && /^[A-Za-z0-9_-]+$/.test(idemCrudo)
    ? idemCrudo
    : randomUUID();

  return {
    ok: true,
    data: { nombre, apellido, telefono: telefonoCrudo.slice(0, 40), telefonoNorm: tel.valor, email, planSlug, idempotencyKey },
  };
}

// ── Bloqueo administrativo ──────────────────────────────────────────────────

// ¿El titular tiene una mensualidad VIGENTE y BLOQUEADA? En ese caso no se puede
// iniciar una compra. Nunca se revela el motivo interno del bloqueo.
export async function tieneMensualidadBloqueada(telefonoNorm: string): Promise<boolean> {
  const { data: hoy } = await supabaseAdmin.rpc("mensualidad_hoy");
  const { data } = await supabaseAdmin
    .from("mensualidades")
    .select("bloqueada, vence_el")
    .eq("telefono_norm", telefonoNorm)
    .order("vence_el", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  return Boolean(data.bloqueada) && String(data.vence_el) >= String(hoy);
}

// ── Creación de compra pendiente + preferencia ──────────────────────────────

export type CompraCreada = { init_point: string; token_publico: string; plan: string; precio: number };

/** Lo que se cobra y se acredita: el snapshot de la compra, nunca el catálogo de hoy. */
type Snapshot = {
  id: string; externalReference: string; token: string;
  slug: string; nombre: string; minutos: number; precio: number; vigencia: number;
};

const COLUMNAS_SNAPSHOT =
  "id, mp_init_point, token_publico, external_reference, procesamiento, " +
  "plan_slug, plan_nombre, plan_minutos, plan_precio, plan_vigencia_dias, modalidad";

type FilaSnapshot = {
  id: string; mp_init_point: string | null; token_publico: string | null; external_reference: string | null;
  plan_slug: string; plan_nombre: string; plan_minutos: number | string; plan_precio: number | string;
  plan_vigencia_dias: number | string;
};

function snapshotDe(f: FilaSnapshot): Snapshot | null {
  if (!f.external_reference || !f.token_publico) return null;
  return {
    id: f.id, externalReference: f.external_reference, token: f.token_publico,
    slug: f.plan_slug, nombre: f.plan_nombre, minutos: Number(f.plan_minutos),
    precio: Number(f.plan_precio), vigencia: Number(f.plan_vigencia_dias),
  };
}

const yaCreada = (f: FilaSnapshot): Ok<CompraCreada> => ({
  ok: true,
  data: {
    init_point: String(f.mp_init_point),
    token_publico: String(f.token_publico),
    plan: f.plan_nombre,
    precio: Number(f.plan_precio),
  },
});

export async function crearCompraYPreferencia(
  datos: DatosCompra,
  baseUrl: string,
  /** (B6) El cuerpo (modalidad_vista / precio_visto) y el reloj, para resolver la modalidad. */
  ctx: { body?: unknown; ahora?: Date } = {},
): Promise<Ok<CompraCreada> | Fallo> {
  // 1) Reintento con la MISMA idempotency key: no se crea nada nuevo.
  const { data: previaCruda } = await supabaseAdmin
    .from("mensualidad_compras")
    .select(COLUMNAS_SNAPSHOT)
    .eq("idempotency_key", datos.idempotencyKey)
    .maybeSingle();
  const previa = previaCruda as FilaSnapshot | null;

  if (previa?.mp_init_point && previa.token_publico) return yaCreada(previa);

  let snap: Snapshot | null = previa ? snapshotDe(previa) : null;
  if (previa && !snap) return fail(500, "No se pudo iniciar la compra. Probá de nuevo.");

  if (!snap) {
    // 2) Compra NUEVA. (B6) La modalidad se resuelve UNA vez, acá. Si la
    //    pantalla mostró otro catálogo (pestaña abierta antes del corte), 409:
    //    0 compra, 0 preferencia, 0 pago, 0 Finanzas.
    const c = await catalogoParaCrear(ctx.body ?? {}, { ahora: ctx.ahora });
    if (!c.ok) return { ok: false, status: c.status, error: c.error, codigo: c.codigo };

    // Plan ACTIVO con precio en esta modalidad. Un plan inactivo, inexistente o
    // sin versión de precio no se vende.
    const plan = c.catalogo.planes.find((p) => p.slug === datos.planSlug);
    if (!plan) return fail(404, "Ese plan no está disponible.", "plan_slug");

    // 3) Compra pendiente con snapshot COMPLETO: plan, minutos, precio de esta
    //    modalidad, la modalidad y la versión de condiciones que se aceptó. Si
    //    el catálogo cambia después, esta compra conserva lo que se le cobró.
    const externalReference = nuevaExternalReference();
    const token = nuevoTokenPublico();
    const { data: creada, error: errIns } = await supabaseAdmin
      .from("mensualidad_compras")
      .insert({
        plan_id: plan.id,
        plan_slug: plan.slug,
        plan_nombre: plan.nombre,
        plan_minutos: plan.minutos,
        plan_precio: plan.precio,
        plan_vigencia_dias: plan.vigencia_dias,
        plan_etiqueta: plan.etiqueta,
        comprador_nombre: datos.nombre,
        comprador_apellido: datos.apellido,
        comprador_telefono: datos.telefono,
        telefono_norm: datos.telefonoNorm,
        comprador_email: datos.email,
        importe_bruto: plan.precio,
        external_reference: externalReference,
        idempotency_key: datos.idempotencyKey,
        token_publico: token,
        condiciones_version: c.catalogo.condiciones_version,
        condiciones_aceptadas_at: new Date().toISOString(),
        modalidad: c.catalogo.modalidad,
      })
      .select("id")
      .single();

    if (errIns || !creada) {
      // Carrera de doble clic: la key única ya existe → se sigue con ESA compra
      // y con SU snapshot.
      if ((errIns as { code?: string } | null)?.code === "23505") {
        const { data: yaEstaCruda } = await supabaseAdmin
          .from("mensualidad_compras")
          .select(COLUMNAS_SNAPSHOT)
          .eq("idempotency_key", datos.idempotencyKey)
          .maybeSingle();
        const yaEsta = yaEstaCruda as FilaSnapshot | null;
        if (yaEsta?.mp_init_point && yaEsta.token_publico) return yaCreada(yaEsta);
        snap = yaEsta ? snapshotDe(yaEsta) : null;
      }
      if (!snap) return fail(500, "No se pudo iniciar la compra. Probá de nuevo.");
    } else {
      snap = {
        id: String(creada.id), externalReference, token,
        slug: plan.slug, nombre: plan.nombre, minutos: plan.minutos,
        precio: plan.precio, vigencia: plan.vigencia_dias,
      };
    }
  }

  const { id: idCompra, externalReference, token, precio, minutos, vigencia } = snap;
  const plan = { slug: snap.slug, nombre: snap.nombre };
  if (!Number.isFinite(precio) || precio <= 0 || !(minutos > 0) || !(vigencia > 0)) {
    return fail(409, "Ese plan no está disponible.", "plan_slug");
  }

  // 4) Preferencia de Mercado Pago con el precio del SNAPSHOT.
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return fail(503, "El pago no está disponible en este momento.");

  const client = new MercadoPagoConfig({ accessToken });
  let resultado;
  try {
    resultado = await new Preference(client).create({
      body: {
        items: [
          {
            id: `mensualidad-${plan.slug}`,
            title: `Mensualidad SIM · ${plan.nombre}`,
            description: `${minutos} minutos de simulador, válidos ${vigencia} días.`,
            quantity: 1,
            unit_price: precio,
            currency_id: "ARS",
          },
        ],
        payer: { name: datos.nombre, surname: datos.apellido, email: datos.email },
        external_reference: externalReference,
        metadata: { producto: "mensualidad", compra_id: idCompra, plan_slug: plan.slug },
        back_urls: {
          success: `${baseUrl}/mensualidades/resultado?t=${token}`,
          pending: `${baseUrl}/mensualidades/resultado?t=${token}`,
          failure: `${baseUrl}/mensualidades/resultado?t=${token}`,
        },
        notification_url: `${baseUrl}/api/mensualidades/webhook`,
      },
      // Idempotencia también del lado de Mercado Pago.
      requestOptions: { idempotencyKey: datos.idempotencyKey },
    });
  } catch {
    // La compra queda pendiente y recuperable: reintentar con la misma key
    // retoma esta misma fila en vez de crear otra.
    return fail(502, "No se pudo conectar con Mercado Pago. Probá de nuevo en unos segundos.");
  }

  const initPoint = resultado?.init_point;
  if (!initPoint) return fail(502, "No se pudo iniciar el pago. Probá de nuevo.");

  await supabaseAdmin
    .from("mensualidad_compras")
    .update({ mp_preference_id: resultado.id ?? null, mp_init_point: initPoint })
    .eq("id", idCompra!);

  return { ok: true, data: { init_point: initPoint, token_publico: token, plan: plan.nombre, precio } };
}

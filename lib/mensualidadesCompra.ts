import { randomBytes, randomUUID } from "crypto";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizarTelefonoDetallado, telefonoNormalizadoValido, type Plan } from "@/lib/mensualidades";
import { CONDICIONES_VERSION } from "@/lib/mensualidadesCondiciones";
import { PREFIJO_EXT_REF } from "@/lib/mensualidadesPago";

// Creación de la compra pública de Mensualidades (Bloque M3). Solo servidor.
// El navegador manda datos del comprador y el SLUG del plan: precio, minutos,
// vigencia y etiqueta se releen SIEMPRE de mensualidad_planes. Nada monetario
// que venga del cliente se usa para nada.

export type Fallo = { ok: false; status: number; error: string; campo?: string };
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

export async function crearCompraYPreferencia(
  datos: DatosCompra,
  baseUrl: string,
): Promise<Ok<CompraCreada> | Fallo> {
  // 1) Reintento con la MISMA idempotency key: no se crea nada nuevo.
  const { data: previa } = await supabaseAdmin
    .from("mensualidad_compras")
    .select("id, mp_init_point, token_publico, plan_nombre, plan_precio, external_reference, procesamiento")
    .eq("idempotency_key", datos.idempotencyKey)
    .maybeSingle();

  if (previa?.mp_init_point && previa.token_publico) {
    return {
      ok: true,
      data: {
        init_point: previa.mp_init_point,
        token_publico: previa.token_publico,
        plan: previa.plan_nombre,
        precio: Number(previa.plan_precio),
      },
    };
  }

  // 2) Plan ACTIVO desde la base. Un plan inactivo o inexistente no se vende.
  const { data: plan } = await supabaseAdmin
    .from("mensualidad_planes")
    .select("id, slug, nombre, minutos, precio, vigencia_dias, etiqueta, activo")
    .eq("slug", datos.planSlug)
    .eq("activo", true)
    .maybeSingle();
  if (!plan) return fail(404, "Ese plan no está disponible.", "plan_slug");

  const precio = Number(plan.precio);
  const minutos = Number(plan.minutos);
  const vigencia = Number(plan.vigencia_dias);
  if (!Number.isFinite(precio) || precio <= 0 || minutos <= 0 || vigencia <= 0) {
    return fail(409, "Ese plan no está disponible.", "plan_slug");
  }

  // 3) Compra pendiente con snapshot COMPLETO del plan. Si el catálogo cambia
  //    después, esta compra conserva lo que se le cobró.
  const compraId = previa?.id ?? null;
  const externalReference = previa?.external_reference ?? nuevaExternalReference();
  const token = previa?.token_publico ?? nuevoTokenPublico();
  const ahora = new Date().toISOString();

  let idCompra = compraId;
  if (!idCompra) {
    const { data: creada, error: errIns } = await supabaseAdmin
      .from("mensualidad_compras")
      .insert({
        plan_id: plan.id,
        plan_slug: plan.slug,
        plan_nombre: plan.nombre,
        plan_minutos: minutos,
        plan_precio: precio,
        plan_vigencia_dias: vigencia,
        plan_etiqueta: plan.etiqueta,
        comprador_nombre: datos.nombre,
        comprador_apellido: datos.apellido,
        comprador_telefono: datos.telefono,
        telefono_norm: datos.telefonoNorm,
        comprador_email: datos.email,
        importe_bruto: precio,
        external_reference: externalReference,
        idempotency_key: datos.idempotencyKey,
        token_publico: token,
        condiciones_version: CONDICIONES_VERSION,
        condiciones_aceptadas_at: ahora,
      })
      .select("id")
      .single();

    if (errIns || !creada) {
      // Carrera de doble clic: la key única ya existe → devolver esa compra.
      if ((errIns as { code?: string } | null)?.code === "23505") {
        const { data: yaEsta } = await supabaseAdmin
          .from("mensualidad_compras")
          .select("id, mp_init_point, token_publico, plan_nombre, plan_precio")
          .eq("idempotency_key", datos.idempotencyKey)
          .maybeSingle();
        if (yaEsta?.mp_init_point && yaEsta.token_publico) {
          return {
            ok: true,
            data: {
              init_point: yaEsta.mp_init_point,
              token_publico: yaEsta.token_publico,
              plan: yaEsta.plan_nombre,
              precio: Number(yaEsta.plan_precio),
            },
          };
        }
        idCompra = yaEsta?.id ?? null;
      }
      if (!idCompra) return fail(500, "No se pudo iniciar la compra. Probá de nuevo.");
    } else {
      idCompra = creada.id;
    }
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

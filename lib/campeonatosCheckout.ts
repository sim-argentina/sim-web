import { randomBytes, randomUUID } from "crypto";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { permitePagoStand } from "@/lib/campeonatosConfig";
import {
  getInscripcionCampos, campoVisible, campoRequerido,
  type CamposInscripcion,
} from "@/lib/campeonatosInscripcionConfig";

// Checkout de inscripción a un campeonato con pago ONLINE obligatorio.
//
// Tocar "Inscribirme" ya NO crea una inscripción: crea un INTENTO en
// campeonato_checkouts, que reserva un cupo por un rato corto y manda a Mercado
// Pago. La inscripción deportiva nace recién cuando el pago queda aprobado
// (ver lib/campeonatosPago.ts). Si la persona abandona, el intento vence solo y
// no queda ningún fantasma en campeonato_inscripciones.
//
// Nada monetario viene del cliente: el precio se relee de campeonatos.precio_inscripcion.

// Cuánto tiempo el intento retiene el cupo. Es también el vencimiento de la
// preferencia de Mercado Pago, para que no se pueda pagar una reserva ya vencida.
export const TTL_CHECKOUT_MIN = 20;

// TTL histórico de las inscripciones PENDIENTES que siguen ocupando cupo (altas
// de stand/admin recientes). Se mantiene igual que antes de este cambio.
export const TTL_PENDIENTES_MIN = 30;

// Prefijo propio: separa estos pagos de los de reservas, gift cards, mensualidades
// y del flujo viejo de campeonatos ("campeonato_inscripcion_").
export const PREFIJO_EXT_REF = "campeonato_checkout_";

export type Fallo = { ok: false; status: number; error: string; campo?: string };
export type Ok<T> = { ok: true; data: T };
const fail = (status: number, error: string, campo?: string): Fallo => ({ ok: false, status, error, campo });

const MAX_TEXTO = 60;
const MAX_IDEM = 80;

// Token público de la pantalla de resultado: 24 bytes → 32 caracteres base64url.
export function nuevoTokenPublico(): string {
  return randomBytes(24).toString("base64url");
}

// external_reference NO predecible y SIN PII (nada de nombre, teléfono ni DNI).
export function nuevaExternalReference(): string {
  return `${PREFIJO_EXT_REF}${randomBytes(16).toString("base64url")}`;
}

// Fecha ISO con offset explícito, como la espera Mercado Pago
// ("2026-09-15T13:40:00.000+00:00"). El runtime de Vercel corre en UTC.
export function isoConOffset(d: Date): string {
  return d.toISOString().replace("Z", "+00:00");
}

// Sin caracteres de control: rompen logs, headers y la pantalla de resultado.
function tieneControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

const limpio = (v: unknown): string => String(v ?? "").trim();

export type CampeonatoCheckoutRow = {
  id: string;
  nombre: string;
  inscripcion_habilitada?: boolean | null;
  cupos_maximos?: number | string | null;
  precio_inscripcion?: number | string | null;
  modalidad?: string | null;
  permite_pago_stand?: boolean | null;
  config?: Record<string, unknown> | null;
};

export type DatosInscripcion = {
  nombre: string; apellido: string; telefono: string; dni: string;
  instagram: string | null; escuderia_favorita: string | null;
  metodoStand: boolean; idempotencyKey: string;
};

// ── Validación del formulario (pura: sin DB, sin red) ───────────────────────
// Usa EXACTAMENTE la misma configuración que el admin y el formulario público
// (`config.inscripcion.campos` sobre el preset de la modalidad). Un campo oculto
// no se exige ni se persiste, aunque el cliente lo mande.
export function validarInscripcionPublica(
  body: unknown,
  campeonato: CampeonatoCheckoutRow,
): Ok<{ datos: DatosInscripcion; campos: CamposInscripcion }> | Fallo {
  const b = (body ?? {}) as Record<string, unknown>;

  const nombre = limpio(b.nombre);
  if (!nombre || nombre.length > MAX_TEXTO || tieneControl(nombre)) {
    return fail(400, "Revisá el nombre.", "nombre");
  }
  const apellido = limpio(b.apellido);
  if (!apellido || apellido.length > MAX_TEXTO || tieneControl(apellido)) {
    return fail(400, "Revisá el apellido.", "apellido");
  }
  if (b.acepto_condiciones !== true) {
    return fail(400, "Tenés que aceptar las condiciones para continuar.", "acepto_condiciones");
  }

  const campos = getInscripcionCampos(campeonato);
  const telefono = limpio(b.telefono);
  const dni = limpio(b.dni);
  const instagram = limpio(b.instagram).slice(0, MAX_TEXTO);
  const escuderia = limpio(b.escuderia_favorita).slice(0, MAX_TEXTO);

  if (campoRequerido(campos, "telefono") && !telefono) {
    return fail(400, "Falta el teléfono", "telefono");
  }
  if (campoVisible(campos, "telefono") && telefono && !/^[0-9+()\s-]{6,30}$/.test(telefono)) {
    return fail(400, "Teléfono inválido", "telefono");
  }
  if (campoRequerido(campos, "dni") && !dni) {
    return fail(400, "Falta el DNI", "dni");
  }
  if (campoVisible(campos, "dni") && dni && !/^[0-9.\s-]{6,15}$/.test(dni)) {
    return fail(400, "DNI inválido", "dni");
  }
  // Escudería: obligatoria SOLO si la config del campeonato la marca "required".
  // La modalidad decide si el campo tiene sentido deportivo (liga → ranking de
  // constructores) y por eso se MUESTRA, pero no lo vuelve obligatorio: la única
  // fuente de obligatoriedad es config.inscripcion.campos, la misma que usa el
  // alta del admin. En liga el preset es "optional" → visible y opcional.
  if (campoRequerido(campos, "escuderia") && !escuderia) {
    return fail(400, "Falta la escudería favorita", "escuderia_favorita");
  }

  // Gate server-side del pago en stand: no alcanza con ocultar el radio en el
  // front. Si el campeonato no lo permite, se rechaza el intento.
  const metodoStand = b.metodo_pago_inscripcion === "stand";
  if (metodoStand && !permitePagoStand(campeonato)) {
    return fail(400, "Este campeonato no permite el pago en el stand. Pagá online con Mercado Pago.");
  }

  const idemCrudo = limpio(b.idempotency_key);
  const idempotencyKey =
    idemCrudo && idemCrudo.length <= MAX_IDEM && /^[A-Za-z0-9_-]+$/.test(idemCrudo)
      ? idemCrudo
      : randomUUID();

  return {
    ok: true,
    data: {
      datos: {
        nombre, apellido,
        // Campos ocultos por config no se persisten aunque lleguen en el body.
        telefono: campoVisible(campos, "telefono") ? telefono : "",
        dni: campoVisible(campos, "dni") ? dni : "",
        instagram: campoVisible(campos, "instagram") ? (instagram || null) : null,
        escuderia_favorita: campoVisible(campos, "escuderia") ? (escuderia || null) : null,
        metodoStand,
        idempotencyKey,
      },
      campos,
    },
  };
}

// Precio REAL del campeonato, en entero. Nunca el monto que mande el navegador.
export function montoDelCampeonato(campeonato: CampeonatoCheckoutRow): number | null {
  const n = Math.round(Number(campeonato.precio_inscripcion));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Estado público de un intento ────────────────────────────────────────────

export type EstadoCheckoutPublico = "confirmado" | "sin_cupo" | "rechazado" | "expirado" | "pendiente";

// Estados de Mercado Pago en los que el pago todavía puede terminar aprobándose.
const MP_EN_CURSO = new Set(["pending", "in_process", "authorized"]);
const MP_CAIDO = new Set(["rejected", "cancelled"]);

// Margen después de expira_el antes de dar un intento por abandonado EN PANTALLA.
// Quien paga sobre el final de la ventana puede tener el aviso de Mercado Pago en
// camino cuando la reserva ya venció: durante este margen se sigue mostrando
// "Confirmando tu pago..." en vez de decirle que no se completó. No afecta al
// cupo (ese se libera puntual a expira_el) ni a la confirmación.
export const GRACIA_CONFIRMACION_MS = 5 * 60_000;

// Traducción PURA del intento a lo que ve la persona. "confirmado" sale única y
// exclusivamente de que la base tenga el intento aprobado (es decir: webhook o
// reconciliación ya crearon la inscripción). Un pago 'pending' de Mercado Pago
// NUNCA se muestra como confirmado.
export function estadoPublicoCheckout(
  chk: { estado: string; mp_status?: string | null; expira_el: string },
  ahoraMs = Date.now(),
): EstadoCheckoutPublico {
  if (chk.estado === "aprobado") return "confirmado";
  if (chk.estado === "sin_cupo") return "sin_cupo";
  const mp = String(chk.mp_status ?? "");
  if (MP_EN_CURSO.has(mp)) return "pendiente";
  if (MP_CAIDO.has(mp)) return "rechazado";
  // Sin noticias de Mercado Pago y con la reserva vencida hace rato: abandonado.
  if (Date.parse(chk.expira_el) + GRACIA_CONFIRMACION_MS <= ahoraMs) return "expirado";
  return "pendiente";
}

// ── Cupo ────────────────────────────────────────────────────────────────────

// Ocupados = pagadas + pendientes vigentes + intentos de checkout vigentes.
// Definición ÚNICA, en SQL, compartida con el alta atómica y el contador público.
export async function cupoOcupados(campeonatoId: string): Promise<number> {
  const { data } = await supabaseAdmin.rpc("campeonato_cupo_ocupados", {
    p_campeonato_id: campeonatoId,
    p_ttl_pendientes_min: TTL_PENDIENTES_MIN,
  });
  return Number(data) || 0;
}

// ── Creación del intento + preferencia ──────────────────────────────────────

export type CheckoutCreado = {
  init_point: string;
  token_publico: string;
  external_reference: string;
  monto: number;
  expira_el: string;
};

type RpcCrear = {
  resultado: "creado" | "reintento" | "sin_cupo" | "campeonato_inexistente";
  checkout_id?: string;
  external_reference?: string;
  token_publico?: string;
  init_point?: string | null;
  expira_el?: string;
  monto?: number | string;
};

export async function crearCheckoutYPreferencia(
  campeonato: CampeonatoCheckoutRow,
  datos: DatosInscripcion,
  monto: number,
  baseUrl: string,
): Promise<Ok<CheckoutCreado> | Fallo> {
  // 1) Intento + reserva de cupo, en UNA transacción con lock por campeonato:
  //    dos personas peleando por el último lugar no pueden entrar las dos.
  const externalReference = nuevaExternalReference();
  const token = nuevoTokenPublico();

  const { data, error } = await supabaseAdmin.rpc("campeonato_checkout_crear", {
    p_campeonato_id: campeonato.id,
    p_nombre: datos.nombre,
    p_apellido: datos.apellido,
    p_telefono: datos.telefono,
    p_dni: datos.dni,
    p_instagram: datos.instagram,
    p_escuderia: datos.escuderia_favorita,
    p_monto: monto,
    p_external_reference: externalReference,
    p_token_publico: token,
    p_idempotency_key: datos.idempotencyKey,
    p_ttl_min: TTL_CHECKOUT_MIN,
    p_ttl_pendientes_min: TTL_PENDIENTES_MIN,
  });

  if (error || !data) return fail(500, "No se pudo iniciar la inscripción. Probá de nuevo.");

  const r = data as RpcCrear;
  if (r.resultado === "sin_cupo") {
    return fail(409, "No quedan cupos disponibles para este campeonato.");
  }
  if (r.resultado === "campeonato_inexistente") {
    return fail(404, "Campeonato no encontrado");
  }
  // Reintento con la misma key y preferencia ya creada: se reusa tal cual.
  if (r.resultado === "reintento" && r.init_point) {
    return {
      ok: true,
      data: {
        init_point: r.init_point,
        token_publico: String(r.token_publico),
        external_reference: String(r.external_reference),
        monto: Number(r.monto) || monto,
        expira_el: String(r.expira_el),
      },
    };
  }

  const checkoutId = String(r.checkout_id);
  const extRef = String(r.external_reference);
  const tokenFinal = String(r.token_publico);
  const expiraEl = String(r.expira_el);

  // 2) Preferencia de Mercado Pago con el precio del SERVIDOR.
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return fail(503, "El pago no está disponible en este momento.");

  const client = new MercadoPagoConfig({ accessToken });
  // La vuelta es SIEMPRE a /campeonatos con el token opaco. Los query params que
  // agrega Mercado Pago (collection_status y compañía) se ignoran: el estado real
  // lo da el servidor en /api/campeonatos/inscripcion-status.
  const retorno = `${baseUrl}/campeonatos?checkout=${tokenFinal}`;

  let resultado;
  try {
    resultado = await new Preference(client).create({
      body: {
        items: [
          {
            id: `campeonato-${campeonato.id}`,
            title: `Inscripción Campeonato SIM - ${campeonato.nombre}`,
            quantity: 1,
            unit_price: monto,
            currency_id: "ARS",
          },
        ],
        external_reference: extRef,
        metadata: { producto: "campeonato", checkout_id: checkoutId, campeonato_id: campeonato.id },
        back_urls: { success: retorno, pending: retorno, failure: retorno },
        notification_url: `${baseUrl}/api/campeonatos/webhook`,
        // La preferencia caduca junto con la reserva de cupo: así Mercado Pago no
        // acepta un pago sobre un lugar que ya se liberó.
        expires: true,
        expiration_date_from: isoConOffset(new Date()),
        expiration_date_to: isoConOffset(new Date(expiraEl)),
      },
      requestOptions: { idempotencyKey: datos.idempotencyKey },
    });
  } catch {
    return fail(502, "No se pudo conectar con Mercado Pago. Probá de nuevo en unos segundos.");
  }

  const initPoint = resultado?.init_point;
  if (!initPoint) return fail(502, "No se pudo iniciar el pago. Probá de nuevo.");

  await supabaseAdmin
    .from("campeonato_checkouts")
    .update({ preference_id: resultado.id ?? null, init_point: initPoint })
    .eq("id", checkoutId);

  return {
    ok: true,
    data: {
      init_point: initPoint,
      token_publico: tokenFinal,
      external_reference: extRef,
      monto,
      expira_el: expiraEl,
    },
  };
}

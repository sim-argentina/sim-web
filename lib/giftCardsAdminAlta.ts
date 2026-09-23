import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AdminRole } from "@/lib/adminSession";
import {
  GIFT_CARD_MAX_CANTIDAD,
  GIFT_CARD_OBSERVACIONES_MAX,
  GIFT_CARD_VIGENCIA_DIAS,
  MEDIO_PAGO_GIFT_CARD_LABEL,
  PROCESADORES_GIFT_CARD,
  calcularVencimientoGiftCard,
  generarCodigoGiftCard,
  getProductoPorDuracion,
  repartirMonto,
  requiereProcesador,
  type GiftCardProducto,
  type MedioPagoGiftCard,
  type ModoUso,
  type ProcesadorGiftCard,
} from "@/lib/giftCards";
import { esMetodoPagoValido } from "@/lib/finanzasComisiones";

// Emisión administrativa de Gift Cards. SOLO SERVIDOR.
//
// Es otra forma de EMITIR la misma Gift Card, no otro producto: misma tabla,
// mismo catálogo, mismo generador de código, mismo estado y mismo canje que una
// comprada por web. Lo único distinto es que el cobro ocurrió en el mostrador,
// así que no hay preference, ni checkout, ni webhook.
//
// Nada monetario se acepta del navegador. El cuerpo manda la DURACIÓN (que es
// el identificador del producto en el catálogo) y el precio lo pone el catálogo
// server-side. Si alguien manda `monto`, `estado_pago`, `codigo_unico`,
// `fecha_pago`, `fecha_vencimiento` o `canal`, no se leen.
//
// Del cobro sí se leen dos datos, porque son hechos del mostrador que el
// servidor no puede adivinar: el medio y, cuando el medio pasa por posnet, el
// procesador. Los dos se validan contra el modelo de Finanzas, no contra una
// lista propia. La COMISIÓN no se acepta ni se guarda: se calcula al leer, con
// la tasa vigente de fin_comisiones_cobro.
//
// EL PERMISO NO SE COMPRUEBA ACÁ: lo comprueba el route handler con
// requireAdmin(). Este módulo asume que quien lo llama ya tiene derecho.

// La lista de medios y el tope de la observación viven en lib/giftCards.ts, que
// es client-safe: el formulario del panel los necesita y este módulo arrastra
// supabaseAdmin. Una sola lista para los dos lados.
type MedioPago = MedioPagoGiftCard;
type Procesador = ProcesadorGiftCard;

const MAX_NOMBRE = 80;
const TELEFONO_RE = /^[0-9+()\s-]{6,30}$/;

export type DatosAltaGiftCard = {
  producto: GiftCardProducto;
  compradorNombre: string;
  compradorTelefono: string;
  destinatarioNombre: string | null;
  cantidad: number;
  modoUso: ModoUso;
  medioPago: MedioPago;
  procesador: Procesador | null;
  observaciones: string | null;
};

export type FalloAlta = { ok: false; status: number; codigo: string; error: string; campo?: string };
export type ResultadoAlta<T> = { ok: true; data: T } | FalloAlta;

const fail = (status: number, codigo: string, error: string, campo?: string): FalloAlta =>
  ({ ok: false, status, codigo, error, campo });

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// ── Validación de la FORMA de la solicitud ──────────────────────────────────
// No decide reglas de negocio: el precio sale del catálogo y el vencimiento de
// GIFT_CARD_VIGENCIA_DIAS. Acá solo se acepta o se rechaza lo que llegó.
export function validarAltaGiftCard(body: Record<string, unknown>): ResultadoAlta<DatosAltaGiftCard> {
  const producto = getProductoPorDuracion(Number(body.duracion_minutos));
  if (!producto) {
    return fail(422, "producto_invalido", "Elegí una Gift Card del catálogo.", "duracion_minutos");
  }

  const compradorNombre = texto(body.comprador_nombre);
  if (!compradorNombre || compradorNombre.length > MAX_NOMBRE) {
    return fail(422, "comprador_invalido", "Escribí el nombre del comprador.", "comprador_nombre");
  }

  const compradorTelefono = texto(body.comprador_telefono);
  if (!TELEFONO_RE.test(compradorTelefono)) {
    return fail(422, "telefono_invalido", "Revisá el teléfono del comprador.", "comprador_telefono");
  }

  const destinatarioCrudo = texto(body.destinatario_nombre);
  if (destinatarioCrudo.length > MAX_NOMBRE) {
    return fail(422, "destinatario_invalido", "El nombre del destinatario es demasiado largo.", "destinatario_nombre");
  }

  const cantidad = Math.round(Number(body.cantidad ?? 1));
  if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > GIFT_CARD_MAX_CANTIDAD) {
    return fail(
      422,
      "cantidad_invalida",
      `La cantidad debe estar entre 1 y ${GIFT_CARD_MAX_CANTIDAD}.`,
      "cantidad",
    );
  }

  const modoUso: ModoUso = body.modo_uso === "juntas" ? "juntas" : "separadas";

  const medioPago = texto(body.medio_pago).toLowerCase() as MedioPago;
  if (!esMetodoPagoValido(medioPago)) {
    return fail(422, "medio_pago_invalido", "Elegí cómo se cobró.", "medio_pago");
  }

  // El procesador NO es opcional ni libre: lo decide el medio. qr/débito/crédito
  // pasan por posnet y necesitan saber cuál, porque de ahí sale la tasa de
  // fin_comisiones_cobro. Efectivo y transferencia no tienen quién cobre
  // comisión, así que un procesador ahí sería una combinación imposible.
  const procesadorCrudo = texto(body.procesador).toLowerCase();
  let procesador: Procesador | null = null;
  if (requiereProcesador(medioPago)) {
    if (!(PROCESADORES_GIFT_CARD as readonly string[]).includes(procesadorCrudo)) {
      return fail(
        422,
        "procesador_invalido",
        "Elegí con qué posnet se cobró.",
        "procesador",
      );
    }
    procesador = procesadorCrudo as Procesador;
  } else if (procesadorCrudo) {
    return fail(
      422,
      "procesador_no_corresponde",
      `Un cobro en ${MEDIO_PAGO_GIFT_CARD_LABEL[medioPago] ?? medioPago} no pasa por posnet.`,
      "procesador",
    );
  }

  const observaciones = texto(body.observaciones);
  if (observaciones.length > GIFT_CARD_OBSERVACIONES_MAX) {
    return fail(
      422,
      "observaciones_demasiado_largas",
      `La observación no puede superar los ${GIFT_CARD_OBSERVACIONES_MAX} caracteres.`,
      "observaciones",
    );
  }

  return {
    ok: true,
    data: {
      producto,
      compradorNombre,
      compradorTelefono,
      destinatarioNombre: destinatarioCrudo || null,
      cantidad,
      modoUso,
      medioPago,
      procesador,
      observaciones: observaciones || null,
    },
  };
}

// Genera N códigos distintos entre sí, con el MISMO generador criptográfico del
// flujo público. La unicidad global la garantiza el índice único de la tabla,
// no este Set.
function generarCodigosUnicos(n: number): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(generarCodigoGiftCard());
  return Array.from(set);
}

export type GiftCardEmitida = {
  id: string;
  codigo_unico: string;
  duracion_minutos: number;
  monto: number;
  usos_totales: number;
  modo_uso: string;
  destinatario_nombre: string | null;
  estado_pago: string;
  estado_uso: string;
  fecha_pago: string;
  fecha_vencimiento: string | null;
};

export type AltaRegistrada = {
  grupo_compra_id: string;
  cantidad: number;
  monto_total: number;
  medio_pago: MedioPago;
  procesador: Procesador | null;
  vigencia_dias: number;
  cards: GiftCardEmitida[];
};

// Filas a insertar. Réplica EXACTA del reparto del flujo público: en "juntas"
// una fila con N usos, en "separadas" N filas de un uso con el total repartido
// en enteros. La diferencia está solo en el cobro, no en la forma de la compra.
function construirFilas(datos: DatosAltaGiftCard, grupoId: string, nowIso: string, rol: AdminRole) {
  const { producto, cantidad, modoUso } = datos;
  const unit = producto.monto;
  const montoTotal = unit * cantidad;
  const vencimiento = calcularVencimientoGiftCard(nowIso);

  const base = {
    comprador_nombre: datos.compradorNombre,
    comprador_telefono: datos.compradorTelefono,
    destinatario_nombre: datos.destinatarioNombre,
    duracion_minutos: producto.duracion,
    modo_uso: modoUso,
    grupo_compra_id: grupoId,
    // Estado funcional idéntico al de una Gift Card web con el pago aprobado.
    // El origen NO se codifica en el estado: para eso está `canal`.
    estado_pago: "pagado",
    estado_uso: "pendiente",
    fecha_pago: nowIso,
    fecha_vencimiento: vencimiento,
    // Sin código de descuento: el precio de mostrador es el del catálogo.
    codigo_descuento: null,
    descuento_aplicado: 0,
    canal: "admin",
    medio_pago: datos.medioPago,
    procesador: datos.procesador,
    // Quién la emitió sale de la cookie firmada, nunca del cuerpo.
    registrado_por: rol,
    observaciones: datos.observaciones,
  };

  if (modoUso === "juntas") {
    return {
      montoTotal,
      filas: [
        {
          ...base,
          codigo_unico: generarCodigosUnicos(1)[0],
          cantidad,
          usos_totales: cantidad,
          usos_disponibles: cantidad,
          monto: montoTotal,
          monto_original: montoTotal,
        },
      ],
    };
  }

  const codigos = generarCodigosUnicos(cantidad);
  const montos = repartirMonto(montoTotal, cantidad);
  return {
    montoTotal,
    filas: codigos.map((codigo, i) => ({
      ...base,
      codigo_unico: codigo,
      cantidad: 1,
      usos_totales: 1,
      usos_disponibles: 1,
      monto: montos[i],
      monto_original: unit,
    })),
  };
}

const SELECT_EMITIDA =
  "id, codigo_unico, duracion_minutos, monto, usos_totales, modo_uso, destinatario_nombre, estado_pago, estado_uso, fecha_pago, fecha_vencimiento";

// Deja constancia en el historial de la Gift Card. Nunca rompe la emisión: si
// el log falla, la Gift Card ya está emitida y es válida.
async function registrarLogAlta(ids: string[], rol: AdminRole, medio: MedioPago) {
  try {
    await supabaseAdmin.from("gift_card_logs").insert(
      ids.map((id) => ({
        gift_card_id: id,
        accion: "Creada manualmente",
        rol,
        detalle: { canal: "admin", medio_pago: medio },
      })),
    );
  } catch {
    /* el log nunca debe romper la emisión */
  }
}

// ── Emisión ─────────────────────────────────────────────────────────────────
// Atómica por construcción: es UN insert. O entran todas las filas con su
// código, su monto, su estado y su vencimiento, o no entra ninguna. No se
// inserta ningún movimiento financiero: el ingreso lo lee Finanzas de esta
// misma fila (fin_ingresos_por_mes), así que una Gift Card es un ingreso y solo
// uno. Escribir además un fin_movimientos la contaría dos veces.
export async function emitirGiftCardAdmin(
  datos: DatosAltaGiftCard,
  ctx: { rol: AdminRole },
): Promise<ResultadoAlta<AltaRegistrada>> {
  // Reintenta solo ante choque de código (23505 sobre el índice único). El
  // espacio es de 32^8 combinaciones: en la práctica no ocurre, pero si
  // ocurriera sería absurdo perder la venta por eso.
  for (let intento = 0; intento < 3; intento++) {
    const nowIso = new Date().toISOString();
    const grupoId = randomUUID();
    const { filas, montoTotal } = construirFilas(datos, grupoId, nowIso, ctx.rol);

    const { data, error } = await supabaseAdmin
      .from("gift_cards")
      .insert(filas)
      .select(SELECT_EMITIDA);

    if (!error && data) {
      const cards = data as GiftCardEmitida[];
      await registrarLogAlta(cards.map((c) => c.id), ctx.rol, datos.medioPago);
      return {
        ok: true,
        data: {
          grupo_compra_id: grupoId,
          cantidad: cards.length,
          monto_total: montoTotal,
          medio_pago: datos.medioPago,
          procesador: datos.procesador,
          vigencia_dias: GIFT_CARD_VIGENCIA_DIAS,
          cards,
        },
      };
    }

    const codigoPg = (error as { code?: string } | null)?.code;
    if (codigoPg === "23505") continue;

    return fail(500, "alta_fallida", "No se pudo emitir la Gift Card.");
  }

  return fail(
    503,
    "codigo_no_disponible",
    "No se pudo generar un código único. Volvé a intentar.",
  );
}

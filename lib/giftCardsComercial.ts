// ============================================================================
// Gift Cards con modalidad comercial (Bloque B5). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// El catálogo vigente se usa SOLO para CREAR una Gift Card (compra web, 100%
// bonificada o alta del panel): la modalidad se resuelve UNA vez por request
// con modalidadVigente() (override > calendario). Antes del corte legacy
// (15/30), desde el primer request posterior v2_10 (10/20/30). Nada se cachea.
//
// Después de creada, LA FILA ES LA VERDAD: duración, monto, vencimiento, usos,
// canal y pago quedan guardados. Ni el webhook, ni el canje, ni la renovación,
// ni la descarga vuelven a mirar el catálogo, así que una pendiente legacy que
// se paga después del corte sigue siendo lo que se compró.
// ============================================================================

import { CATALOGO_ACTUALIZADO, esModalidad, type Modalidad } from "@/lib/catalogoComercial";
import { modalidadVigente } from "@/lib/modalidadComercial";
import {
  GIFT_CARD_MAX_CANTIDAD, GIFT_CARD_VIGENCIA_DIAS, productosGiftCardDe, type GiftCardProducto,
} from "@/lib/giftCards";

/** El 409 de la compra web: la pestaña se armó con otro catálogo. */
export const MENSAJE_GIFT_CARDS_ACTUALIZADAS =
  "Actualizamos nuestras Gift Cards y precios. Revisá las nuevas opciones para continuar.";

/** El 409 del alta desde el panel. */
export const MENSAJE_GIFT_CARDS_ACTUALIZADAS_ADMIN =
  "Cambió la modalidad comercial. Revisá las nuevas Gift Cards antes de registrar la venta.";

export type CatalogoGiftCards = {
  modalidad: Modalidad;
  /** Instante con el que el servidor resolvió la modalidad. */
  resuelto_en: string;
  productos: GiftCardProducto[];
  vigencia_dias: number;
  max_cantidad: number;
};

/** El catálogo de Gift Cards de una modalidad EXPLÍCITA. No consulta la base. */
export function catalogoGiftCardsPara(modalidad: Modalidad, ahora: Date): CatalogoGiftCards {
  return {
    modalidad,
    resuelto_en: ahora.toISOString(),
    productos: productosGiftCardDe(modalidad),
    vigencia_dias: GIFT_CARD_VIGENCIA_DIAS,
    max_cantidad: GIFT_CARD_MAX_CANTIDAD,
  };
}

/** El catálogo VIGENTE: resuelve la modalidad en este request. */
export async function catalogoGiftCardsVigente(ahora: Date = new Date()): Promise<CatalogoGiftCards> {
  const { modalidad } = await modalidadVigente(ahora);
  return catalogoGiftCardsPara(modalidad, ahora);
}

export type FalloModalidadGiftCard = { ok: false; status: number; error: string; codigo: string };

/**
 * La modalidad con la que se CREA una Gift Card en este request, contrastada
 * con la que vio el navegador (`modalidad_vista`). Sin el campo es un cliente
 * anterior a B5, que solo conocía legacy. Un valor que no es una modalidad →
 * 400; una modalidad distinta de la vigente → 409, antes de crear nada.
 */
export async function modalidadParaNuevaGiftCard(
  body: unknown,
  opts: { mensaje: string; ahora?: Date },
): Promise<{ ok: true; modalidad: Modalidad } | FalloModalidadGiftCard> {
  const { modalidad } = await modalidadVigente(opts.ahora ?? new Date());
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const vista = b.modalidad_vista === undefined ? "legacy" : b.modalidad_vista;
  if (!esModalidad(vista)) return { ok: false, status: 400, error: "Modalidad inválida.", codigo: "modalidad_invalida" };
  if (vista !== modalidad) return { ok: false, status: 409, error: opts.mensaje, codigo: CATALOGO_ACTUALIZADO.codigo };
  return { ok: true, modalidad };
}

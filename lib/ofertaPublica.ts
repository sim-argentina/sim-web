// ============================================================================
// Oferta pública vigente (bloque final: Viví SIM). SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// Las tarjetas de Viví SIM muestran la duración de Reservas y los "Desde" de
// Mensualidades y Gift Cards. Salen de los MISMOS catálogos que venden (nada
// escrito a mano): con override `legacy`, 15/30 · $30.000 · $12.000; sin
// override (v2), 10/20/30 · $38.000 · $10.000. La modalidad se resuelve UNA vez
// por request, así las tres tarjetas nunca mezclan modalidades. La página es
// force-dynamic: quitar el override se ve en el request siguiente, sin redeploy.
// ============================================================================

import type { Modalidad } from "@/lib/catalogoComercial";
import { modalidadVigente } from "@/lib/modalidadComercial";
import { catalogoPara } from "@/lib/reservasComercial";
import { catalogoGiftCardsPara } from "@/lib/giftCardsComercial";
import { catalogoMensualidadesPara } from "@/lib/mensualidadesComercial";
import { precioDesde } from "@/lib/ofertaPublicaTexto";

export type OfertaPublica = {
  modalidad: Modalidad;
  reservas: { duraciones: number[] };
  giftCards: { desde: number | null };
  /** null si Mensualidades no se muestra; `desde` null si no se pudo leer el precio. */
  mensualidades: { desde: number | null } | null;
};

export async function ofertaPublicaVigente(
  opts: { conMensualidades: boolean; ahora?: Date },
): Promise<OfertaPublica> {
  const ahora = opts.ahora ?? new Date();
  const { modalidad } = await modalidadVigente(ahora);
  const reservas = catalogoPara(modalidad, ahora);
  const giftCards = catalogoGiftCardsPara(modalidad, ahora);

  let mensualidades: OfertaPublica["mensualidades"] = null;
  if (opts.conMensualidades) {
    try {
      const catalogo = await catalogoMensualidadesPara(modalidad, ahora);
      mensualidades = { desde: precioDesde(catalogo.planes.map((p) => p.precio)) };
    } catch {
      // Un error de lectura no rompe la página: la tarjeta muestra "—".
      mensualidades = { desde: null };
    }
  }

  return {
    modalidad,
    reservas: { duraciones: [...reservas.duraciones] },
    giftCards: { desde: precioDesde(giftCards.productos.map((p) => p.monto)) },
    mensualidades,
  };
}

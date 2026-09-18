import type { MetadataRoute } from "next";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";

const BASE = "https://simexperience.com.ar";

// (M8A) El sitemap depende de la flag, así que tiene que evaluarse por request:
// si quedara prerenderizado, publicar Mensualidades no lo actualizaría hasta el
// siguiente build.
export const dynamic = "force-dynamic";

// Rutas públicas indexables (no se modifican URLs existentes). Se excluyen
// /admin, /api y las páginas transaccionales (/exito, /pendiente, /error).
const RUTAS = [
  "",
  "/reservas",
  "/alquiler",
  "/gift-cards",
  "/vivi-sim",
  "/campeonatos",
  "/tienda",
  "/sobre-nosotros",
  "/viaja-con-sim",
  "/legales/terminos",
  "/legales/privacidad",
  "/legales/cookies",
  "/legales/arrepentimiento",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // (M8A) Mensualidades entra al sitemap SOLO cuando el módulo está publicado, y
  // entra solo la landing: Mi Plan, Reservar y Resultado muestran datos del
  // titular y llevan noindex, así que nunca se listan.
  //
  // Que las ventas estén pausadas NO la saca del sitemap: el producto existe y
  // la página explica por sí misma que las compras están pausadas. Desindexar
  // por una pausa comercial tiraría el posicionamiento cada vez.
  const rutas = mensualidadesHabilitadas() ? [...RUTAS, "/mensualidades"] : RUTAS;

  return rutas.map((ruta) => ({
    url: `${BASE}${ruta}`,
    lastModified: now,
    changeFrequency: ruta === "" ? "weekly" : "monthly",
    priority: ruta === "" ? 1 : 0.7,
  }));
}

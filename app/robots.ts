import type { MetadataRoute } from "next";

const BASE = "https://simexperience.com.ar";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Panel/API y páginas transaccionales de resultado (éxito/pendiente/error):
      // son de confirmación, sin valor de búsqueda y no deben indexarse.
      disallow: [
        "/admin",
        "/api",
        "/reservas/exito",
        "/reservas/pendiente",
        "/reservas/error",
        "/gift-cards/exito",
        "/gift-cards/pendiente",
        "/gift-cards/error",
        "/campeonatos/exito",
        "/campeonatos/pendiente",
        "/campeonatos/error",
      ],
    },
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}

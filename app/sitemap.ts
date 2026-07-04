import type { MetadataRoute } from "next";

const BASE = "https://simexperience.com.ar";

// Rutas públicas indexables (no se modifican URLs existentes). Se excluyen
// /admin, /api y las páginas transaccionales (/exito, /pendiente, /error).
const RUTAS = [
  "",
  "/reservas",
  "/alquiler",
  "/gift-cards",
  "/reservas-gift-cards",
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
  return RUTAS.map((ruta) => ({
    url: `${BASE}${ruta}`,
    lastModified: now,
    changeFrequency: ruta === "" ? "weekly" : "monthly",
    priority: ruta === "" ? 1 : 0.7,
  }));
}

import { siteConfig } from "@/data/site";

// Datos legales del titular del sitio y constantes reutilizadas por las páginas
// de Términos, Privacidad, Cookies y Botón de Arrepentimiento.
export const legalConfig = {
  nombreComercial: "SIM Argentina",
  actividad:
    "experiencias con simuladores de automovilismo, alquiler de simuladores para eventos, gift cards, campeonatos e inscripciones y venta de productos relacionados",
  domicilio: "Nuevo Centro Shopping, Ciudad de Córdoba, Provincia de Córdoba, Argentina",
  jurisdiccion: "Ciudad de Córdoba, Provincia de Córdoba, Argentina",
  email: "sim.cafe.racer@gmail.com",
  whatsapp: siteConfig.whatsapp,
  whatsappLink: siteConfig.whatsappLink,
  instagram: siteConfig.instagram,
  // Fecha de última actualización de los textos legales.
  ultimaActualizacion: "3 de julio de 2026",
  // Plazo legal del derecho de revocación (art. 34 Ley 24.240).
  diasArrepentimiento: 10,
} as const;

export const RUTAS_LEGALES = {
  terminos: "/legales/terminos",
  privacidad: "/legales/privacidad",
  cookies: "/legales/cookies",
  arrepentimiento: "/legales/arrepentimiento",
} as const;

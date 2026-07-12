import "./globals.css";
import NavbarWrapper from "@/components/NavbarWrapper";
import FooterWrapper from "@/components/FooterWrapper";
import {
  GoogleTagManagerHead,
  GoogleTagManagerNoscript,
} from "@/components/analytics/GoogleTagManager";
import PageViewTracker from "@/components/analytics/PageViewTracker";
import InteractionTracker from "@/components/analytics/InteractionTracker";
import CookieConsent from "@/components/analytics/CookieConsent";
import StructuredData from "@/components/seo/StructuredData";
import type { Metadata } from "next";

const DESCRIPCION =
  "Simuladores profesionales de Fórmula 1 y GT en Córdoba (Nuevo Centro Shopping). Reservá turnos, regalá gift cards, sumate a los campeonatos y contratá simuladores para eventos y empresas.";

export const metadata: Metadata = {
  metadataBase: new URL("https://simexperience.com.ar"),
  title: {
    default: "SIM Argentina — Simuladores de F1 y automovilismo en Córdoba",
    template: "%s | SIM Argentina",
  },
  description: DESCRIPCION,
  applicationName: "SIM Argentina",
  keywords: [
    "simuladores F1 Córdoba",
    "simulador de manejo Córdoba",
    "simuladores de carreras Córdoba",
    "experiencia F1 Córdoba",
    "gift card simuladores",
    "campeonatos de simuladores",
    "alquiler de simuladores para eventos",
    "simuladores para empresas",
    "SIM Argentina",
    "Nuevo Centro Shopping",
  ],
  alternates: { canonical: "/" },
  icons: { icon: "/sim-logo.png", apple: "/sim-logo.png" },
  openGraph: {
    type: "website",
    url: "https://simexperience.com.ar",
    siteName: "SIM Argentina",
    locale: "es_AR",
    title: "SIM Argentina — Simuladores de F1 y automovilismo en Córdoba",
    description: DESCRIPCION,
    images: [{ url: "/sim-logo.png", alt: "SIM Argentina" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SIM Argentina — Simuladores de F1 en Córdoba",
    description: DESCRIPCION,
    images: ["/sim-logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <GoogleTagManagerHead />
        <StructuredData />
      </head>
      <body>
        <GoogleTagManagerNoscript />
        <NavbarWrapper />
        {children}
        <FooterWrapper />
        <PageViewTracker />
        <InteractionTracker />
        <CookieConsent />
      </body>
    </html>
  );
}

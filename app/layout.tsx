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

export const metadata = {
  metadataBase: new URL("https://simexperience.com.ar"),
  title: "SIM Argentina",
  description: "Simuladores de Fórmula 1",
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

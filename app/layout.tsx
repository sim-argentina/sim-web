import "./globals.css";
import NavbarWrapper from "@/components/NavbarWrapper";
import FooterWrapper from "@/components/FooterWrapper";

export const metadata = {
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
      <body>
        <NavbarWrapper />
        {children}
        <FooterWrapper />
      </body>
    </html>
  );
}
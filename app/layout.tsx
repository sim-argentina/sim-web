import "./globals.css";
import Navbar from "@/components/navbar";

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
        <Navbar />
        {children}
      </body>
    </html>
  );
}
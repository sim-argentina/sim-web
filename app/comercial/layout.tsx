import type { Metadata } from "next";
import AislamientoAnalitica from "./AislamientoAnalitica";

// Interfaz comercial del CRM (B0). Separada del panel: sin el menú del stand ni
// la navegación del sitio público (NavbarWrapper/FooterWrapper la excluyen) y
// fuera de la analítica pública: no carga Google Tag Manager
// (components/analytics/GoogleTagManagerCarga.tsx), se entra con navegación de
// documento completo (middleware.ts) y se sale igual (enlaces <a>, no <Link>).
// La autorización la hace cada página y cada ruta en el servidor
// (lib/crmAuth.ts), no este layout.

export const metadata: Metadata = {
  title: { default: "CRM comercial", template: "%s · CRM comercial | SIM Argentina" },
  robots: { index: false, follow: false },
};

export default function ComercialLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-black text-white">
      <AislamientoAnalitica />
      {children}
    </div>
  );
}

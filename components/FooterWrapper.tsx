"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/footer";
import FooterMinimal from "@/components/FooterMinimal";

// El footer completo (Navegación / Legales / Contacto) se muestra únicamente en
// la Home. El resto del sitio público lleva un footer mínimo (copyright + enlaces
// legales básicos). En el panel de administración y en la interfaz comercial del
// CRM no se muestra footer.
export default function FooterWrapper() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin") || pathname === "/comercial" || pathname.startsWith("/comercial/")) {
    return null;
  }

  if (pathname === "/") {
    return <Footer />;
  }

  return <FooterMinimal />;
}

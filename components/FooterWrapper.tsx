"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/footer";

// El footer (con los enlaces legales) se muestra en todo el sitio público,
// pero no dentro del panel de administración.
export default function FooterWrapper() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return null;
  }

  return <Footer />;
}

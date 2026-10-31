"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/navbar";
import { esAreaComercial } from "@/lib/areaComercial";

export default function NavbarWrapper() {
  const pathname = usePathname();

  // El panel y la interfaz comercial del CRM no llevan la navegación pública.
  if (pathname.startsWith("/admin") || esAreaComercial(pathname)) {
    return null;
  }

  return <Navbar />;
}
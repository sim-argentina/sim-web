"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/navbar";

export default function NavbarWrapper() {
  const pathname = usePathname();

  // El panel y la interfaz comercial del CRM no llevan la navegación pública.
  if (pathname.startsWith("/admin") || pathname === "/comercial" || pathname.startsWith("/comercial/")) {
    return null;
  }

  return <Navbar />;
}
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { gaEvent, trackLeadOnce } from "@/lib/analytics";

// Eventos de interacción: scroll 90% (una vez por página) + clics salientes
// (WhatsApp / Instagram / email / teléfono) mediante un único listener delegado,
// sin tocar los enlaces existentes.
export default function InteractionTracker() {
  const pathname = usePathname();

  // Scroll 90% — se reinicia en cada cambio de ruta.
  useEffect(() => {
    let fired = false;
    const onScroll = () => {
      if (fired) return;
      const doc = document.documentElement;
      const alcance = doc.scrollHeight - doc.clientHeight;
      if (alcance <= 0) return;
      const pct = (window.scrollY / alcance) * 100;
      if (pct >= 90) {
        fired = true;
        gaEvent("scroll", { percent_scrolled: 90 });
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  // Clics salientes (delegado en document).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = (anchor.getAttribute("href") || "").toLowerCase();
      if (!href) return;

      if (href.includes("wa.me") || href.includes("whatsapp.com") || href.includes("api.whatsapp")) {
        gaEvent("click_whatsapp", { link_url: anchor.href });
        trackLeadOnce("whatsapp");
      } else if (href.includes("instagram.com")) {
        gaEvent("click_instagram", { link_url: anchor.href });
      } else if (href.startsWith("mailto:")) {
        gaEvent("click_email", { link_url: anchor.href });
      } else if (href.startsWith("tel:")) {
        gaEvent("click_phone", { link_url: anchor.href });
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}

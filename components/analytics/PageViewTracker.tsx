"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { gaEvent } from "@/lib/analytics";

// Envía page_view en las navegaciones SPA (client-side). Se SALTEA la primera
// carga porque GA4 (Enhanced Measurement) ya emite el page_view inicial → evita
// page_view duplicados.
function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const qs = searchParams?.toString();
    const path = qs ? `${pathname}?${qs}` : pathname;
    gaEvent("page_view", {
      page_path: path,
      page_location: typeof window !== "undefined" ? window.location.href : path,
      page_title: typeof document !== "undefined" ? document.title : undefined,
    });
  }, [pathname, searchParams]);

  return null;
}

export default function PageViewTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}

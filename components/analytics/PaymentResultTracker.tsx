"use client";

import { useEffect } from "react";
import { trackPaymentResult, type Funnel } from "@/lib/analytics";

// Mide un resultado de pago no-exitoso en las páginas reales /error y /pendiente.
// Es medible de verdad (el usuario llegó a la página); NO es un evento de "abandono".
// Sin PII: solo funnel + status. El guard de producción vive en gaEvent().
export default function PaymentResultTracker({ funnel, status }: { funnel: Funnel; status: "failed" | "pending" }) {
  useEffect(() => {
    trackPaymentResult(funnel, status);
  }, [funnel, status]);
  return null;
}

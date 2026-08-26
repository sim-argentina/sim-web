"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { trackPurchase } from "@/lib/analytics";

// Dispara la conversión en las páginas /exito. El transaction_id se toma de forma
// ESTABLE del external_reference (reserva_<id> / gift_card_<grupo> / campeonato_<id>),
// que es joinable con Supabase sin PII; si no viniera, cae a los ids de Mercado Pago.
// El value/currency vienen del begin_checkout (sessionStorage). Dedup por transaction_id
// para no duplicar en recargas ni contra la conversión de ramas 100% bonificadas.
function Tracker({ kind }: { kind: "reserva" | "gift_card" | "campeonato" }) {
  const params = useSearchParams();

  useEffect(() => {
    const id =
      params.get("external_reference") ||
      params.get("payment_id") ||
      params.get("collection_id") ||
      params.get("preference_id") ||
      "";
    if (!id) return;
    trackPurchase(kind, id);
  }, [kind, params]);

  return null;
}

export default function PurchaseTracker({ kind }: { kind: "reserva" | "gift_card" | "campeonato" }) {
  return (
    <Suspense fallback={null}>
      <Tracker kind={kind} />
    </Suspense>
  );
}

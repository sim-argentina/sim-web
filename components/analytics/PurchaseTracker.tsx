"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { trackPurchase } from "@/lib/analytics";

// Dispara la conversión en las páginas /exito. El transaction_id se toma de los
// parámetros que agrega Mercado Pago al volver (payment_id / collection_id /
// external_reference). El value/currency vienen del begin_checkout (sessionStorage).
// Dedup por transaction_id para no duplicar en recargas.
function Tracker({ kind }: { kind: "reserva" | "gift_card" | "campeonato" }) {
  const params = useSearchParams();

  useEffect(() => {
    const id =
      params.get("payment_id") ||
      params.get("collection_id") ||
      params.get("external_reference") ||
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

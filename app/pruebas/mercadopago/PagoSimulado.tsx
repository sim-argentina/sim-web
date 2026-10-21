"use client";

import { useState } from "react";

// Checkout de Mercado Pago SIMULADO: tres botones que hacen lo que haría la
// persona en el checkout real (pagar bien, que la rechacen, quedar en proceso).

type Props = { pref: string; titulo: string; total: number; vence: string | null; referencia: string };

export default function PagoSimulado({ pref, titulo, total, vence, referencia }: Props) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const vencida = !!vence && Date.parse(vence) < Date.now();

  async function pagar(estado: "approved" | "rejected" | "in_process") {
    setEnviando(estado);
    setError("");
    try {
      const res = await fetch("/api/pruebas/mercadopago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "pagar", pref, estado }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "No se pudo simular el pago."); return; }
      window.location.href = d.redirect || "/";
    } catch {
      setError("Error de conexión.");
    } finally {
      setEnviando(null);
    }
  }

  const boton = "w-full rounded-xl px-4 py-3 text-sm font-bold text-white transition disabled:opacity-40";
  return (
    <main className="min-h-screen bg-[#ededed] px-4 py-10 text-[#333]">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow">
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[#009ee3]">Mercado Pago · simulado</p>
        <p className="mb-5 text-xs text-[#666]">Entorno local de pruebas: no hay dinero ni conexión con Mercado Pago.</p>
        <h1 className="text-lg font-bold">{titulo}</h1>
        <p className="mt-1 text-3xl font-light">${total.toLocaleString("es-AR")}</p>
        <p className="mt-2 text-xs text-[#666]">Referencia: {referencia}</p>
        {vence && (
          <p className={`mt-1 text-xs ${vencida ? "font-bold text-red-600" : "text-[#666]"}`}>
            {vencida ? "Este link de pago venció." : `Se puede pagar hasta las ${new Date(vence).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })}`}
          </p>
        )}
        <div className="mt-6 space-y-3">
          <button type="button" disabled={!!enviando || vencida} onClick={() => pagar("approved")} className={`${boton} bg-[#009ee3] hover:bg-[#007eb5]`}>
            {enviando === "approved" ? "Pagando…" : "Pagar (aprobado)"}
          </button>
          <button type="button" disabled={!!enviando || vencida} onClick={() => pagar("rejected")} className={`${boton} bg-[#666] hover:bg-[#555]`}>
            {enviando === "rejected" ? "Enviando…" : "Tarjeta rechazada"}
          </button>
          <button type="button" disabled={!!enviando || vencida} onClick={() => pagar("in_process")} className={`${boton} bg-[#999] hover:bg-[#888]`}>
            {enviando === "in_process" ? "Enviando…" : "Dejar en proceso"}
          </button>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}

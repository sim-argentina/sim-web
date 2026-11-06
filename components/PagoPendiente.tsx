"use client";

import { useEffect, useState } from "react";
import { leerPagoPendiente, olvidarPagoPendiente, olvidarIntento, type PagoPendiente as Pendiente } from "@/lib/intentoCompra";

// Aviso de "pago ya iniciado en esta pestaña" para Reservas y Gift Cards: al
// volver desde Mercado Pago la compra sigue pendiente (y su cupón, si tenía uno
// limitado, sigue apartado por ella). Continuar = el MISMO link de pago, sin
// abrir otro. Descartar no libera nada: lo dice.

export default function PagoPendiente({ flujo }: { flujo: "reserva" | "gift_card" }) {
  const [p, setP] = useState<Pendiente | null>(null);
  const [descartado, setDescartado] = useState<Pendiente | null>(null);

  useEffect(() => { setP(leerPagoPendiente(flujo)); }, [flujo]);

  if (descartado) {
    return (
      <div role="status" className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
        Listo, podés armar otra compra.
        {descartado.conCupon && " El código de descuento que usaste queda apartado por la compra anterior hasta que su link de pago venza; si no la pagás, vuelve a quedar disponible después."}
      </div>
    );
  }
  if (!p) return null;
  const hasta = new Date(p.hasta).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" });
  return (
    <div role="region" aria-label="Pago iniciado" className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 md:p-5">
      <p className="text-sm font-black uppercase tracking-[0.15em] text-amber-300">Tenés un pago iniciado</p>
      <p className="mt-1 text-sm text-zinc-200">{p.descripcion} · podés terminarlo hasta las {hasta}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={p.link} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white transition hover:bg-red-700">
          Continuar el pago
        </a>
        <button
          type="button"
          onClick={() => { olvidarPagoPendiente(flujo); olvidarIntento(flujo); setDescartado(p); setP(null); }}
          className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-zinc-200 transition hover:bg-white/10"
        >
          Armar otra compra
        </button>
      </div>
    </div>
  );
}

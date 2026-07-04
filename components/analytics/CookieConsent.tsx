"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConsent, setConsent } from "@/lib/analytics";
import { RUTAS_LEGALES } from "@/data/legal";

// Banner de consentimiento de cookies analíticas. Barra inferior discreta (no es
// un popup que bloquee el sitio). Recuerda la elección (localStorage) vía
// getConsent/setConsent, que además actualizan Consent Mode v2.
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Se difiere para no llamar a setState de forma síncrona dentro del efecto
    // (y para leer localStorage recién en cliente, evitando desajustes de SSR).
    const t = setTimeout(() => {
      if (getConsent() === null) setVisible(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const decidir = (valor: "granted" | "denied") => {
    setConsent(valor);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur sm:flex-row sm:items-center sm:gap-4 sm:p-5">
        <p className="flex-1 text-xs leading-5 text-zinc-300 sm:text-sm">
          Usamos cookies analíticas (Google Analytics) para entender cómo se usa el sitio y
          mejorarlo. Podés aceptarlas o rechazarlas. Más info en nuestra{" "}
          <Link href={RUTAS_LEGALES.cookies} className="font-semibold text-red-400 underline underline-offset-2 hover:text-red-300">
            Política de Cookies
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decidir("denied")}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Rechazar
          </button>
          <button
            onClick={() => decidir("granted")}
            className="rounded-xl bg-red-600 px-5 py-2.5 text-xs font-black uppercase tracking-wide text-white transition hover:bg-red-500"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}

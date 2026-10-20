"use client";

import { useEffect, useState } from "react";

// Casilla VOLUNTARIA para recibir promociones de SIM por WhatsApp en el checkout
// de Reservas y Gift Cards. Separada de Términos y Privacidad: comprar no exige
// marcarla y nunca viene marcada.
//   · Solo aparece si la captación está encendida y hay un texto publicado
//     (/api/promos/texto responde 200). Si no, no se muestra nada.
//   · Muestra el texto vigente tal cual y, si se marca, entrega a la compra su
//     versión, huella y el token firmado de cuando se mostró.
//   · No confirma nada por sí sola: la compra devuelve si quedó registrada.

export type OptInPromosValor = { acepto: true; texto_version: string; texto_huella: string; token: string } | null;

type Texto = { version: string; titulo: string; texto: string; huella: string };

export default function OptInPromos({ onChange }: { onChange: (v: OptInPromosValor) => void }) {
  const [texto, setTexto] = useState<Texto | null>(null);
  const [token, setToken] = useState("");
  const [marcada, setMarcada] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/promos/texto", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const d = await res.json().catch(() => null);
        if (vivo && d?.texto && d?.token) {
          setTexto(d.texto as Texto);
          setToken(String(d.token));
        }
      })
      .catch(() => { /* sin casilla: la compra sigue igual */ });
    return () => { vivo = false; };
  }, []);

  if (!texto) return null;

  return (
    <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm leading-6 text-zinc-300">
      <input
        type="checkbox"
        checked={marcada}
        aria-labelledby="optin-promos-texto"
        className="mt-1 h-4 w-4 shrink-0 accent-red-600"
        onChange={(e) => {
          setMarcada(e.target.checked);
          onChange(e.target.checked ? { acepto: true, texto_version: texto.version, texto_huella: texto.huella, token } : null);
        }}
      />
      <span>
        <span className="block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Opcional</span>
        <span id="optin-promos-texto">{texto.texto}</span>
      </span>
    </label>
  );
}

/** Texto honesto para después de una compra: solo confirma si quedó registrada. */
export function mensajePromosTrasCompra(estado: unknown): string | null {
  if (estado === "registrada") return "Además, te anotamos para recibir promociones por WhatsApp.";
  if (estado === "no_registrada") return "No pudimos anotarte a las promociones; podés hacerlo desde simexperience.com.ar/promos.";
  return null;
}

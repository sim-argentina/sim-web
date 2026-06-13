"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import GiftCardDownloadable, { type GiftCardData } from "@/components/GiftCardDownloadable";

type ApiGiftCard = GiftCardData & {
  estado_pago: string;
  estado_uso: string;
  fecha_pago: string | null;
  created_at: string;
};

function ExitoContent() {
  const params = useSearchParams();
  const extRef = params.get("external_reference") || "";
  const id = extRef.startsWith("gift_card_")
    ? extRef.replace("gift_card_", "")
    : params.get("gift_card_id") || "";

  const [card, setCard] = useState<ApiGiftCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [intentos, setIntentos] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCard = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/gift-cards/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setCard(data);
    } catch {
      // se reintenta
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCard();
  }, [fetchCard]);

  // Auto-reintento mientras el webhook confirma el pago (hasta ~40s)
  useEffect(() => {
    if (!card) return;
    if (card.estado_pago === "pagado") return;
    if (intentos >= 10) return;
    timerRef.current = setTimeout(() => {
      setIntentos((n) => n + 1);
      fetchCard();
    }, 4000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [card, intentos, fetchCard]);

  const pagada = card?.estado_pago === "pagado" && card?.codigo_unico;

  return (
    <main className="min-h-screen bg-black px-4 py-20 text-white">
      <section className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <div className="mb-6 rounded-full border border-green-500/30 bg-green-500/10 p-5 text-green-400">
          <CheckCircle2 className="h-12 w-12" />
        </div>

        <p className="mb-3 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Gift Card SIM
        </p>
        <h1 className="text-4xl font-black md:text-5xl">¡Pago aprobado!</h1>

        {loading ? (
          <div className="mt-10 flex items-center gap-3 text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Buscando tu Gift Card...
          </div>
        ) : !card ? (
          <p className="mt-6 max-w-lg text-lg leading-8 text-zinc-300">
            No pudimos encontrar la Gift Card. Si ya pagaste, escribinos por
            WhatsApp y te la enviamos al instante.
          </p>
        ) : pagada ? (
          <>
            <p className="mt-5 max-w-lg text-lg leading-8 text-zinc-300">
              Tu Gift Card está lista. Descargala y compartila con quien quieras.
            </p>
            <div className="mt-8 w-full">
              <GiftCardDownloadable
                card={{
                  codigo_unico: card.codigo_unico,
                  duracion_minutos: card.duracion_minutos,
                  monto: card.monto,
                  destinatario_nombre: card.destinatario_nombre,
                  fecha: card.fecha_pago || card.created_at,
                }}
              />
            </div>
          </>
        ) : (
          <>
            <p className="mt-5 max-w-lg text-lg leading-8 text-zinc-300">
              Estamos confirmando tu pago con Mercado Pago. Esto puede tardar unos
              segundos.
            </p>
            <div className="mt-6 flex items-center gap-3 text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              Confirmando pago...
            </div>
            <button
              onClick={() => {
                setIntentos(0);
                setLoading(true);
                fetchCard();
              }}
              className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-6 py-3 font-black text-white transition hover:bg-white/10"
            >
              Actualizar
            </button>
          </>
        )}

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/gift-cards"
            className="rounded-2xl bg-red-600 px-6 py-4 font-black text-white transition hover:bg-red-500"
          >
            Comprar otra Gift Card
          </Link>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 font-black text-white transition hover:bg-white/10"
          >
            Volver al inicio
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function GiftCardExitoPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-black" />}>
      <ExitoContent />
    </Suspense>
  );
}

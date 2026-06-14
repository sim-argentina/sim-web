"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, ArrowRight, Download } from "lucide-react";
import GiftCardDownloadable, {
  downloadGiftCardPng,
  type GiftCardData,
} from "@/components/GiftCardDownloadable";

type ApiCard = {
  id: string;
  estado_pago: string;
  estado_uso: string;
  duracion_minutos: number;
  monto: number;
  cantidad: number;
  modo_uso: string;
  usos_totales: number;
  usos_disponibles: number;
  destinatario_nombre: string | null;
  fecha_pago: string | null;
  created_at: string;
  codigo_unico: string | null;
};

type GrupoResp = {
  grupo_compra_id: string;
  pagado: boolean;
  modo_uso: string;
  cards: ApiCard[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ExitoContent() {
  const params = useSearchParams();
  const extRef = params.get("external_reference") || "";
  const grupoId = extRef.startsWith("gift_card_")
    ? extRef.replace("gift_card_", "")
    : params.get("grupo_compra_id") || "";

  const [grupo, setGrupo] = useState<GrupoResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [intentos, setIntentos] = useState(0);
  const [bulk, setBulk] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGrupo = useCallback(async () => {
    if (!grupoId) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/gift-cards/grupo/${grupoId}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setGrupo(data);
    } catch {
      // se reintenta
    } finally {
      setLoading(false);
    }
  }, [grupoId]);

  useEffect(() => {
    fetchGrupo();
  }, [fetchGrupo]);

  // Auto-reintento mientras el webhook confirma el pago (hasta ~40s)
  useEffect(() => {
    if (!grupo) return;
    if (grupo.pagado) return;
    if (intentos >= 10) return;
    timerRef.current = setTimeout(() => {
      setIntentos((n) => n + 1);
      fetchGrupo();
    }, 4000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [grupo, intentos, fetchGrupo]);

  const pagado = !!grupo?.pagado && grupo.cards.every((c) => c.codigo_unico);
  const cards = grupo?.cards ?? [];

  const toCardData = (c: ApiCard, i: number): GiftCardData => ({
    codigo_unico: c.codigo_unico ?? "",
    duracion_minutos: c.duracion_minutos,
    monto: c.monto,
    destinatario_nombre: c.destinatario_nombre,
    fecha: c.fecha_pago || c.created_at,
    usos_totales: c.usos_totales,
    modo_uso: c.modo_uso,
    indexLabel: cards.length > 1 ? `${i + 1} / ${cards.length}` : null,
  });

  async function descargarTodas() {
    setBulk(true);
    for (let i = 0; i < cards.length; i++) {
      await downloadGiftCardPng(toCardData(cards[i], i));
      await sleep(500);
    }
    setBulk(false);
  }

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
            Buscando tu compra...
          </div>
        ) : !grupo ? (
          <p className="mt-6 max-w-lg text-lg leading-8 text-zinc-300">
            No pudimos encontrar la compra. Si ya pagaste, escribinos por
            WhatsApp y te enviamos las Gift Cards al instante.
          </p>
        ) : pagado ? (
          <>
            <p className="mt-5 max-w-lg text-lg leading-8 text-zinc-300">
              {cards.length > 1
                ? `Se generaron ${cards.length} Gift Cards. Descargalas y compartilas con quien quieras.`
                : "Tu Gift Card está lista. Descargala y compartila con quien quieras."}
            </p>

            {cards.length > 1 && (
              <button
                onClick={descargarTodas}
                disabled={bulk}
                className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-4 text-base font-black text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                <Download className="h-5 w-5" />
                {bulk ? "Generando..." : `Descargar todas (${cards.length})`}
              </button>
            )}

            <div className={cards.length > 1 ? "mt-8 grid w-full gap-8 sm:grid-cols-2" : "mt-8 w-full"}>
              {cards.map((c, i) => (
                <GiftCardDownloadable key={c.id} card={toCardData(c, i)} />
              ))}
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
                fetchGrupo();
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

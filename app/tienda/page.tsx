"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, X, MessageCircle, Zap } from "lucide-react";

type Producto = {
  id: string;
  nombre: string;
  descripcion: string;
  imagenes: string[];
  caracteristicas: string[];
};

const MOCK: Producto[] = [
  {
    id: "1",
    nombre: "Simulador Formula Pro SIM",
    descripcion:
      "El mismo simulador que usamos en SIM Argentina, ahora disponible para que lo tengas en tu casa o negocio. Estructura de acero reforzado, volante de fuerza directa, pedalera de carga de células y pantallas triple setup. Una experiencia de Fórmula 1 real, sin límites.",
    imagenes: ["/sim-alquiler-1.jpg", "/sim-alquiler-2.jpg", "/sim-alquiler-3.jpg"],
    caracteristicas: [
      "Volante Fanatec DD Pro",
      "Pedalera Heusinkveld Sprint",
      "Triple pantalla 27\"",
      "Estructura acero reforzado",
      "Asiento racing ajustable",
      "PC Gaming incluida",
    ],
  },
];

const WA = "https://wa.me/5493512520927";

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({
  imagenes,
  inicial,
  onClose,
}: {
  imagenes: string[];
  inicial: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(inicial);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % imagenes.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + imagenes.length) % imagenes.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imagenes.length, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-5 right-5 z-10 rounded-full border border-white/15 bg-black p-2 text-white hover:border-white/40 transition"
      >
        <X className="h-5 w-5" />
      </button>

      {imagenes.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + imagenes.length) % imagenes.length); }}
            className="absolute left-4 z-10 rounded-full border border-white/15 bg-black p-3 text-white hover:border-white/40 transition md:left-8"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % imagenes.length); }}
            className="absolute right-4 z-10 rounded-full border border-white/15 bg-black p-3 text-white hover:border-white/40 transition md:right-8"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      <div
        className="relative mx-16 max-h-[85vh] max-w-5xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={imagenes[idx]}
          alt=""
          width={1200}
          height={800}
          className="mx-auto max-h-[85vh] w-auto rounded-2xl object-contain"
        />
        {imagenes.length > 1 && (
          <p className="mt-4 text-center text-xs font-black uppercase tracking-widest text-white/30">
            {idx + 1} / {imagenes.length}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Galería del producto ──────────────────────────────────────────────────────
function GaleriaProducto({ imagenes }: { imagenes: string[] }) {
  const [activa, setActiva] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (imagenes.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-3xl bg-zinc-900 text-zinc-700">
        <Zap className="h-12 w-12" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* imagen principal */}
        <div
          className="relative aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-3xl bg-zinc-900"
          onClick={() => setLightbox(activa)}
        >
          <Image
            src={imagenes[activa]}
            alt=""
            fill
            className="object-cover transition-transform duration-500 hover:scale-[1.02]"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
          {imagenes.length > 1 && (
            <div className="absolute bottom-4 right-4 rounded-full bg-black/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white backdrop-blur-sm">
              {activa + 1}/{imagenes.length} · Ver todas
            </div>
          )}
        </div>

        {/* thumbnails */}
        {imagenes.length > 1 && (
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
            {imagenes.map((img, i) => (
              <button
                key={i}
                onClick={() => setActiva(i)}
                className={`relative h-20 w-24 shrink-0 overflow-hidden rounded-xl transition ${
                  i === activa
                    ? "ring-2 ring-red-600 ring-offset-2 ring-offset-black"
                    : "opacity-50 hover:opacity-80"
                }`}
              >
                <Image src={img} alt="" fill className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox !== null && (
        <Lightbox imagenes={imagenes} inicial={lightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

// ── Tarjeta de producto ───────────────────────────────────────────────────────
function CardProducto({ p, invertido }: { p: Producto; invertido: boolean }) {
  return (
    <article className={`grid gap-0 overflow-hidden rounded-3xl border border-white/8 bg-[#0a0a0a] md:grid-cols-2`}>
      {/* galería — alterna lado */}
      <div className={`${invertido ? "md:order-2" : ""}`}>
        <GaleriaProducto imagenes={p.imagenes} />
      </div>

      {/* info */}
      <div className={`flex flex-col justify-between p-8 md:p-12 ${invertido ? "md:order-1" : ""}`}>
        <div>
          {/* eyebrow */}
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px w-8 bg-red-600" />
            <p className="text-[10px] font-black uppercase tracking-[0.45em] text-red-500">
              En venta
            </p>
          </div>

          <h2 className="text-4xl font-black uppercase leading-[0.9] text-white md:text-5xl">
            {p.nombre}
          </h2>

          <p className="mt-5 text-[15px] leading-8 text-zinc-500">
            {p.descripcion}
          </p>

          {/* características */}
          {p.caracteristicas.length > 0 && (
            <div className="mt-8">
              <p className="mb-4 text-[10px] font-black uppercase tracking-[0.4em] text-zinc-700">
                Especificaciones
              </p>
              <ul className="space-y-2.5">
                {p.caracteristicas.map((c) => (
                  <li key={c} className="flex items-center gap-3 text-sm text-zinc-400">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-red-600" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="mt-10">
          <p className="mb-4 text-xs text-zinc-700">
            Precio a consultar · Financiación disponible
          </p>
          <Link
            href={`${WA}?text=${encodeURIComponent(`Hola! Me interesa el ${p.nombre}. ¿Podés darme más información?`)}`}
            target="_blank"
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-red-600 px-8 py-5 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
          >
            <MessageCircle className="h-5 w-5" />
            Consultar por WhatsApp
          </Link>
        </div>
      </div>
    </article>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TiendaPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tienda")
      .then((r) => r.json())
      .then((d) => setProductos(d.productos?.length ? d.productos : MOCK))
      .catch(() => setProductos(MOCK))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-black text-white">

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-white/5">
        {/* fondo */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(220,38,38,0.2),transparent)]" />
          {/* líneas de velocidad */}
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute top-0 h-full w-px"
              style={{
                left: `${10 + i * 11}%`,
                background: `linear-gradient(to bottom, transparent, rgba(255,255,255,${0.012 - i * 0.001}), transparent)`,
              }}
            />
          ))}
        </div>

        <div className="relative mx-auto max-w-7xl px-6 pt-20 pb-16 md:pt-28 md:pb-20">
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex items-center gap-4">
              <div className="h-px w-12 bg-red-600" />
              <p className="text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
                SIM Argentina
              </p>
              <div className="h-px w-12 bg-red-600" />
            </div>

            <h1 className="text-[5rem] font-black uppercase leading-[0.85] md:text-[9rem]">
              Tien<span className="text-red-600">da</span>
            </h1>

            <p className="mt-6 max-w-lg text-[15px] leading-8 text-zinc-500">
              Los mismos simuladores que usamos en pista, disponibles para llevar. Consultanos por WhatsApp y te damos todos los detalles.
            </p>

            <Link
              href={WA}
              target="_blank"
              className="mt-8 inline-flex items-center gap-3 rounded-full border border-white/15 px-7 py-3.5 text-sm font-black uppercase tracking-widest text-white transition hover:border-red-600 hover:text-red-500"
            >
              <MessageCircle className="h-4 w-4" />
              Contactar por WhatsApp
            </Link>
          </div>
        </div>
      </section>

      {/* ── PRODUCTOS ─────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 py-16 md:py-20">

        {loading && (
          <div className="flex justify-center py-32">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-red-600" />
          </div>
        )}

        {!loading && productos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
            <Zap className="h-10 w-10 text-zinc-800" />
            <p className="font-black uppercase text-zinc-700">Próximamente</p>
            <p className="text-sm text-zinc-800">Estamos preparando el catálogo.</p>
          </div>
        )}

        {!loading && productos.length > 0 && (
          <div className="space-y-6">
            {productos.map((p, i) => (
              <CardProducto key={p.id} p={p} invertido={i % 2 !== 0} />
            ))}
          </div>
        )}
      </section>

      {/* ── BANNER FINAL ──────────────────────────────────── */}
      <section className="border-t border-white/5 bg-[#070707]">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
                ¿Tenés dudas?
              </p>
              <h2 className="text-3xl font-black uppercase leading-tight md:text-4xl">
                Hablá con nosotros.<br />
                <span className="text-red-600">Te asesoramos sin compromiso.</span>
              </h2>
            </div>
            <Link
              href={WA}
              target="_blank"
              className="flex shrink-0 items-center gap-3 rounded-2xl bg-red-600 px-8 py-5 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
            >
              <MessageCircle className="h-5 w-5" />
              WhatsApp
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <style jsx global>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { GoogleReview } from "@/lib/googleReviews";

const AUTO_MS = 6000;

// 1 reseña visible en mobile, 3 en desktop (md+).
function useItemsPerView(): number {
  const [n, setN] = useState(1);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setN(mq.matches ? 3 : 1);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return n;
}

// 5 estrellas (solo se muestran reseñas de 5★; la sección lo avisa).
function Stars() {
  return (
    <div className="flex gap-0.5" aria-label="5 de 5 estrellas">
      {[...Array(5)].map((_, j) => (
        <svg key={j} viewBox="0 0 24 24" className="h-4 w-4" fill="#fbbc04" aria-hidden="true">
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      ))}
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

// Avatar del autor (atribución de Google). Sin foto o si no carga: la inicial.
function Avatar({ r }: { r: GoogleReview }) {
  const [fallo, setFallo] = useState(false);
  if (r.authorPhoto && !fallo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar remoto de Google, 40 px
      <img
        src={r.authorPhoto}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFallo(true)}
        className="h-10 w-10 shrink-0 rounded-full bg-white/10 object-cover"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white/80">
      {r.author.charAt(0).toUpperCase()}
    </div>
  );
}

function ReviewCard({ r, fichaUrl }: { r: GoogleReview; fichaUrl: string }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-5">
      {/* autor (atribución: avatar, nombre y perfil en Google Maps) */}
      <div className="flex items-center gap-3">
        <Avatar r={r} />
        <div className="min-w-0">
          {r.authorUri ? (
            <a
              href={r.authorUri}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-sm font-semibold text-white/90 hover:underline"
            >
              {r.author}
            </a>
          ) : (
            <p className="truncate text-sm font-semibold text-white/90">{r.author}</p>
          )}
          {r.relativeTime && <p className="text-xs text-white/40">{r.relativeTime}</p>}
        </div>
      </div>

      <Stars />

      {/* texto del autor (truncado solo visualmente; completo en Google Maps) */}
      <p className="line-clamp-5 flex-1 text-sm leading-6 text-white/70">{r.text}</p>

      {/* la reseña en Google Maps (fuente) */}
      <a
        href={r.reviewUri ?? fichaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-medium text-white/45 transition-colors hover:text-white/80"
      >
        Ver reseña en Google Maps ↗
      </a>
    </article>
  );
}

export default function ReviewsCarousel({
  reviews,
  fichaUrl,
}: {
  reviews: GoogleReview[];
  fichaUrl: string;
}) {
  const perView = useItemsPerView();
  const maxActive = Math.max(0, reviews.length - perView);
  const [elegido, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // Índice recortado al layout (resize mobile<->desktop), derivado sin efecto.
  const active = Math.min(elegido, maxActive);

  // Auto-avance (pausa al hover; sin indicador visual de páginas).
  useEffect(() => {
    if (paused || maxActive <= 0) return;
    const id = setInterval(() => setActive((a) => (Math.min(a, maxActive) >= maxActive ? 0 : Math.min(a, maxActive) + 1)), AUTO_MS);
    return () => clearInterval(id);
  }, [paused, maxActive]);

  const canMove = maxActive > 0;
  const step = 100 / perView;
  const go = (dir: number) =>
    setActive((a) => {
      const n = Math.min(a, maxActive) + dir;
      if (n < 0) return maxActive;
      if (n > maxActive) return 0;
      return n;
    });

  return (
    <div
      className="relative px-9 py-6 md:px-14 md:py-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${active * step}%)` }}
        >
          {reviews.map((r) => (
            <div key={r.id} className="w-full shrink-0 px-2 md:w-1/3">
              <ReviewCard r={r} fichaUrl={fichaUrl} />
            </div>
          ))}
        </div>
      </div>

      {/* flechas laterales discretas */}
      {canMove && (
        <>
          <button
            type="button"
            aria-label="Reseñas anteriores"
            onClick={() => go(-1)}
            className="absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/70 transition-colors hover:border-white/40 hover:text-white md:left-3"
          >
            <Chevron dir="left" />
          </button>
          <button
            type="button"
            aria-label="Reseñas siguientes"
            onClick={() => go(1)}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/70 transition-colors hover:border-white/40 hover:text-white md:right-3"
          >
            <Chevron dir="right" />
          </button>
        </>
      )}
    </div>
  );
}

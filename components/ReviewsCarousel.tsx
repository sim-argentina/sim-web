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

// Logo "G" de Google (atribución real, no un sello inventado).
function GoogleG({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

// 5 estrellas doradas tipo Google (solo entran reseñas de 5★).
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

function ReviewCard({ r, placeUrl }: { r: GoogleReview; placeUrl: string | null }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-5">
      {/* autor + marca Google */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white/80">
          {r.author.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white/90">{r.author}</p>
          {r.relativeTime && <p className="text-xs text-white/40">{r.relativeTime}</p>}
        </div>
        <GoogleG className="ml-auto h-5 w-5 shrink-0" />
      </div>

      <Stars />

      {/* texto exacto de la reseña (truncado solo visualmente) */}
      <p className="line-clamp-5 flex-1 text-sm leading-6 text-white/70">{r.text}</p>

      {/* link a la reseña en Google Maps */}
      {placeUrl ? (
        <a
          href={placeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-white/45 transition-colors hover:text-white/80"
        >
          Reseña en Google Maps ↗
        </a>
      ) : (
        <span className="text-xs font-medium text-white/45">Reseña en Google Maps</span>
      )}
    </article>
  );
}

export default function ReviewsCarousel({
  reviews,
  placeUrl,
}: {
  reviews: GoogleReview[];
  placeUrl: string | null;
}) {
  const perView = useItemsPerView();
  const maxActive = Math.max(0, reviews.length - perView);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // Clamp del índice cuando cambia el layout (resize mobile<->desktop).
  useEffect(() => {
    setActive((a) => Math.min(a, maxActive));
  }, [maxActive]);

  // Auto-avance (pausa al hover; sin indicador visual de páginas).
  useEffect(() => {
    if (paused || maxActive <= 0) return;
    const id = setInterval(() => setActive((a) => (a >= maxActive ? 0 : a + 1)), AUTO_MS);
    return () => clearInterval(id);
  }, [paused, maxActive]);

  const canMove = maxActive > 0;
  const step = 100 / perView;
  const go = (dir: number) =>
    setActive((a) => {
      const n = a + dir;
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
              <ReviewCard r={r} placeUrl={placeUrl} />
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

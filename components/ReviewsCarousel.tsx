"use client";

import { useEffect, useMemo, useState } from "react";
import type { GoogleReview } from "@/lib/googleReviews";

const AUTO_MS = 6000;

// 1 reseña por vista en mobile, 3 en desktop (md+).
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

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 1) return arr.map((x) => [x]);
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

function ReviewCard({ r, placeUrl }: { r: GoogleReview; placeUrl: string | null }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border border-black/10 bg-white p-6 shadow-sm">
      {/* autor */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-sm font-semibold text-black/70">
          {r.author.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-black/85">{r.author}</p>
          {r.relativeTime && <p className="text-xs text-black/40">{r.relativeTime}</p>}
        </div>
      </div>

      <Stars />

      {/* texto exacto de la reseña (truncado solo visualmente) */}
      <p className="line-clamp-6 flex-1 text-sm leading-6 text-black/70">{r.text}</p>

      {/* atribución sobria a Google */}
      {placeUrl ? (
        <a
          href={placeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-black/45 transition-colors hover:text-black/75"
        >
          <GoogleG className="h-4 w-4" />
          Reseña en Google
        </a>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-black/45">
          <GoogleG className="h-4 w-4" />
          Reseña en Google
        </span>
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
  const slides = useMemo(() => chunk(reviews, perView), [reviews, perView]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // Clamp del índice cuando cambia el layout (resize mobile<->desktop).
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, slides.length - 1)));
  }, [slides.length]);

  // Auto-avance (pausa al hover y si hay una sola slide). Sin indicador visual.
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = setInterval(() => setActive((a) => (a + 1) % slides.length), AUTO_MS);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  return (
    <div
      className="overflow-hidden px-8 py-10 md:px-14"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="flex transition-transform duration-700 ease-out"
        style={{ transform: `translateX(-${active * 100}%)` }}
      >
        {slides.map((group, gi) => (
          <div key={gi} className="grid w-full shrink-0 gap-5 md:grid-cols-3">
            {group.map((r) => (
              <ReviewCard key={r.id} r={r} placeUrl={placeUrl} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

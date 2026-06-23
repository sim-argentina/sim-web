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

function ReviewCard({ r }: { r: GoogleReview }) {
  return (
    <div className="flex h-full flex-col justify-between px-8 py-10">
      {/* stars — todas rojas (solo entran reseñas de 5★) */}
      <div className="mb-4 flex gap-0.5" aria-label={`${r.rating} de 5 estrellas`}>
        {[...Array(5)].map((_, j) => (
          <span key={j} className="text-lg text-red-600">
            ★
          </span>
        ))}
      </div>

      <p className="flex-1 text-base leading-8 text-black/70">{`“${r.text}”`}</p>

      <div className="mt-6 flex items-center gap-3 border-t border-black/8 pt-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-black text-white">
          {r.author.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-black uppercase tracking-wide">{r.author}</p>
          {r.relativeTime && (
            <p className="text-[10px] font-black uppercase tracking-widest text-black/30">
              {r.relativeTime}
            </p>
          )}
        </div>
      </div>
    </div>
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

  // Auto-avance (pausa al hover y si hay una sola slide).
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = setInterval(
      () => setActive((a) => (a + 1) % slides.length),
      AUTO_MS
    );
    return () => clearInterval(id);
  }, [paused, slides.length]);

  const multiple = slides.length > 1;

  return (
    <div>
      <div
        className="overflow-hidden"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div
          className="flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${active * 100}%)` }}
        >
          {slides.map((group, gi) => (
            <div key={gi} className="grid w-full shrink-0 md:grid-cols-3">
              {group.map((r, i) => (
                <div
                  key={r.id}
                  className={
                    i < group.length - 1
                      ? "border-b border-black/8 md:border-b-0 md:border-r"
                      : ""
                  }
                >
                  <ReviewCard r={r} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Controles + atribución a Google */}
      {(multiple || placeUrl) && (
        <div className="flex items-center justify-between gap-4 border-t border-black/8 px-8 py-5 md:px-14">
          <div className="flex gap-2">
            {multiple &&
              slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Ir al grupo de reseñas ${i + 1}`}
                  onClick={() => setActive(i)}
                  className={`h-1.5 transition-all ${
                    i === active ? "w-7 bg-red-600" : "w-3 bg-black/15 hover:bg-black/30"
                  }`}
                />
              ))}
          </div>
          {placeUrl && (
            <a
              href={placeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[10px] font-black uppercase tracking-widest text-black/30 transition-colors hover:text-red-600"
            >
              Ver todas en Google ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

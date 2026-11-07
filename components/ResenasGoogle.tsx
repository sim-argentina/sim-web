"use client";

import { useEffect, useRef, useState } from "react";
import AtribucionGoogleMaps from "@/components/AtribucionGoogleMaps";
import ReviewsCarousel from "@/components/ReviewsCarousel";
import type { ResenasHome } from "@/lib/googleReviews";

// 03 · Reseñas reales de Google Maps en la Home.
//
// NO viajan en el HTML ni en el RSC de la Home (ISR): las políticas de Google
// Maps Platform no permiten guardar reseñas. El servidor solo pinta el
// encabezado y el enlace a la ficha (armado con el Place ID, que sí puede
// guardarse); el navegador pide /api/resenas (sin caché) cuando la sección
// está por verse. Una visita que nunca llega a la sección no consulta a Google.
//
// Estados, todos con salida: carga (máximo 12 s) → reseñas, o el enlace a
// Google Maps si no hay reseñas para mostrar, Google falla, falta configuración
// o se superó un límite. Sin JavaScript se ve directamente el enlace. Nunca un
// esqueleto indefinido ni contenido inventado.

const ESPERA_MAXIMA_MS = 12_000;
const MARGEN_PREVIO = "600px 0px";

type Estado = { fase: "esperando" | "cargando" } | { fase: "listo"; datos: ResenasHome } | { fase: "sin_datos" };

function formatoRating(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function EnlaceFicha({ fichaUrl }: { fichaUrl: string }) {
  return (
    <div className="relative px-6 pb-16 md:px-12 md:pb-20">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center">
        <p className="max-w-md text-sm leading-6 text-white/65">
          Las opiniones de quienes ya corrieron en SIM están en nuestra ficha de Google Maps.
        </p>
        <a
          href={fichaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 border border-white/20 px-6 py-3 text-xs font-black uppercase tracking-widest text-white/80 transition-all hover:border-red-600 hover:text-white"
        >
          Ver reseñas en Google Maps ↗
        </a>
      </div>
    </div>
  );
}

// Carga acotada: se ve solo mientras se espera la respuesta (máximo 12 s).
function Cargando() {
  return (
    <div className="resenas-cargando relative px-9 pb-16 pt-6 md:px-14 md:pb-20 md:pt-8" aria-busy="true">
      <p className="sr-only">Cargando reseñas de Google Maps…</p>
      <div className="grid gap-4 md:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`${i > 0 ? "hidden md:flex" : "flex"} h-48 animate-pulse flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-5`}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-white/10" />
              <div className="h-3 w-24 rounded bg-white/10" />
            </div>
            <div className="h-2.5 w-full rounded bg-white/5" />
            <div className="h-2.5 w-4/5 rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResenasGoogle({ fichaUrl }: { fichaUrl: string }) {
  const seccion = useRef<HTMLElement>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "esperando" });

  useEffect(() => {
    const el = seccion.current;
    if (!el) return;
    let vivo = true;
    const control = new AbortController();
    let reloj: ReturnType<typeof setTimeout> | undefined;

    const cargar = () => {
      if (!vivo) return;
      setEstado({ fase: "cargando" });
      reloj = setTimeout(() => control.abort(), ESPERA_MAXIMA_MS);
      fetch("/api/resenas", { cache: "no-store", signal: control.signal })
        .then((r) => r.json() as Promise<ResenasHome | { estado: "limitado" }>)
        .then((d) => {
          if (!vivo) return;
          const ok = d.estado === "ok" && "reviews" in d && Array.isArray(d.reviews) && d.reviews.length > 0;
          setEstado(ok ? { fase: "listo", datos: d as ResenasHome } : { fase: "sin_datos" });
        })
        .catch(() => {
          if (vivo) setEstado({ fase: "sin_datos" });
        })
        .finally(() => clearTimeout(reloj));
    };

    if (typeof IntersectionObserver === "undefined") {
      const inicio = setTimeout(cargar, 0);
      return () => { vivo = false; clearTimeout(inicio); control.abort(); clearTimeout(reloj); };
    }
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          obs.disconnect();
          cargar();
        }
      },
      { rootMargin: MARGEN_PREVIO },
    );
    obs.observe(el);
    return () => { vivo = false; obs.disconnect(); control.abort(); clearTimeout(reloj); };
  }, []);

  const datos = estado.fase === "listo" ? estado.datos : null;
  const resumen = datos?.resumen ?? null;
  // "Ver todas": la ficha de reseñas que da Google si vino; si no, la armada con el Place ID.
  const verTodas = datos?.fichaUrl ?? fichaUrl;

  return (
    <section ref={seccion} className="relative overflow-hidden border-y border-white/5 bg-black text-white">
      {/* degradado sutil + leve glow rojo racing */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.03] via-transparent to-black" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-red-600/10 blur-[100px]" />

      {/* header */}
      <div className="relative px-6 pb-6 pt-14 md:px-12 md:pb-8 md:pt-16">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.55em] text-red-500">
              Lo que importa
            </p>
            <h2 className="text-2xl font-black uppercase leading-[1.05] md:text-[2.6rem]">
              Clientes que ya vivieron la{" "}
              <span className="whitespace-nowrap text-red-600">experiencia SIM.</span>
            </h2>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 md:items-end">
            {resumen?.rating != null && (
              <p className="text-sm font-semibold text-white/80">
                <span className="text-[#fbbc04]">★</span> {formatoRating(resumen.rating)}
                {resumen.total != null && (
                  <span className="font-normal text-white/50"> · {resumen.total.toLocaleString("es-AR")} reseñas</span>
                )}
              </p>
            )}
            <a
              href={verTodas}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white"
            >
              Ver todas en Google Maps ↗
            </a>
          </div>
        </div>
      </div>

      {datos ? (
        <>
          <ReviewsCarousel reviews={datos.reviews} fichaUrl={verTodas} />
          {/* aviso de filtro y atribución (políticas de Google Maps Platform) */}
          <div className="relative flex flex-col gap-3 px-6 pb-12 md:flex-row md:items-center md:justify-between md:px-12 md:pb-14">
            <p className="max-w-2xl text-[11px] leading-5 text-white/40">
              Mostramos solo reseñas de 5 estrellas, elegidas entre las más relevantes que muestra Google.
              Google no verifica las reseñas, pero revisa y elimina el contenido falso cuando lo detecta.
            </p>
            <AtribucionGoogleMaps />
          </div>
        </>
      ) : estado.fase === "sin_datos" ? (
        <EnlaceFicha fichaUrl={fichaUrl} />
      ) : (
        <>
          <Cargando />
          {/* Sin JavaScript no hay carga: se ve directamente el enlace. */}
          <noscript>
            <style>{".resenas-cargando{display:none}"}</style>
            <EnlaceFicha fichaUrl={fichaUrl} />
          </noscript>
        </>
      )}
    </section>
  );
}

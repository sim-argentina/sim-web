import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HeroHome from "@/components/HeroHome";
import ReviewsCarousel from "@/components/ReviewsCarousel";
import { getGoogleReviews, getGooglePlaceUrl } from "@/lib/googleReviews";

// ISR: la Home se revalida cada 6h para refrescar las reseñas de Google.
export const revalidate = 21600;

// ─── 01 · QUÉ ES SIM ────────────────────────────────────────────
function QueEsSim() {
  return (
    <section className="border-y border-white/5 bg-black">
      <div className="mx-auto max-w-7xl">

        {/* layout asimétrico */}
        <div className="grid md:grid-cols-[1fr_auto]">

          {/* izquierda — frase de impacto */}
          <div className="relative flex flex-col justify-center border-b border-white/5 px-8 py-14 md:border-b-0 md:border-r md:px-14 md:py-16">
            {/* franja roja vertical */}
            <div className="absolute left-0 top-10 bottom-10 w-[3px] bg-red-600" />

            <p className="mb-5 text-[10px] font-black uppercase tracking-[0.55em] text-red-500">
              Por qué SIM
            </p>

            <h2 className="text-[2.1rem] font-black uppercase leading-[0.9] sm:text-[2.6rem] md:text-[3.3rem] lg:text-[4rem]">
              Entrás como fan.<br />
              <span className="text-white/40">Salís como piloto.</span>
            </h2>

            <p className="mt-6 max-w-md text-base leading-7 text-white/55">
              El cockpit no sabe si sos profesional o no. Solo sabe que tenés el
              volante en las manos y la pista en la pantalla.
            </p>
          </div>

          {/* derecha — detalles verticales */}
          <div className="flex flex-col justify-center divide-y divide-white/5 px-8 py-8 md:min-w-[260px] md:px-10">
            {[
              { label: "UBICACIÓN",   val: "Nuevo Centro · Córdoba" },
              { label: "SIMULADORES", val: "Fórmula 1 y GT"         },
              { label: "HARDWARE",    val: "Moza R5 Bundle"          },
              { label: "SESIONES",    val: "15 y 30 minutos"         },
            ].map((d) => (
              <div key={d.label} className="py-4">
                <p className="text-[9px] font-black uppercase tracking-[0.45em] text-white/25">
                  {d.label}
                </p>
                <p className="mt-1 text-sm font-black uppercase text-white/70">
                  {d.val}
                </p>
              </div>
            ))}

            <div className="pt-6">
              <Link
                href="/reservas"
                className="inline-flex w-full items-center justify-center gap-2 bg-red-600 px-6 py-3.5 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-white hover:text-black sm:w-fit sm:justify-start"
              >
                Reservar <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

// ─── 02 · GALERÍA EDITORIAL ──────────────────────────────────────
function Galeria() {
  return (
    <section className="bg-black">

      {/* FILA 1 — foto full width */}
      <div className="group relative h-[55vh] min-h-[360px] overflow-hidden md:h-[65vh]">
        <Image
          src="/sim-home-2.jpg"
          alt="SIM Argentina"
          fill
          className="object-cover object-center transition-transform duration-700 group-hover:scale-[1.02]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" />

        {/* copy superpuesto — esquina inferior izquierda */}
        <div className="absolute bottom-0 left-0 p-8 md:p-14">
          <p className="text-[10px] font-black uppercase tracking-[0.55em] text-red-500 mb-3">
            En pista
          </p>
          <p className="text-4xl font-black uppercase leading-[0.88] text-white md:text-6xl">
            Acá se corre.
          </p>
        </div>

        {/* etiqueta esquina superior derecha */}
        <div className="absolute right-6 top-6 border border-white/15 px-3 py-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-white/40">
            SIM Argentina
          </p>
        </div>
      </div>

      {/* FILA 2 — dos fotos asimétricas */}
      <div className="grid grid-cols-[1.4fr_1fr] gap-0 sm:grid-cols-[1.4fr_1fr]">

        {/* foto izquierda — más alta — stand lleno de gente */}
        <div className="group relative h-[30vh] min-h-[200px] overflow-hidden sm:h-[40vh] md:h-[50vh]">
          <Image
            src="/sim-stand.jpg"
            alt="Stand SIM Argentina lleno de gente"
            fill
            sizes="(max-width: 640px) 100vw, 58vw"
            className="object-cover object-center transition-transform duration-700 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-black/30 transition-opacity duration-300 group-hover:bg-black/15" />

          {/* copy superpuesto */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 md:p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/50">
              El stand · En vivo
            </p>
          </div>
        </div>

        {/* foto derecha — persona conduciendo + copy editorial */}
        <div className="group relative h-[30vh] min-h-[200px] overflow-hidden border-l border-black sm:h-[40vh] md:h-[50vh]">
          <Image
            src="/sim-driver.jpg"
            alt="Piloto manejando un simulador SIM Argentina"
            fill
            sizes="(max-width: 640px) 100vw, 42vw"
            className="object-cover object-center transition-transform duration-700 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-black/50 transition-opacity duration-300 group-hover:bg-black/35" />

          {/* copy centrado sobre la foto */}
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="mb-3 h-px w-8 bg-red-600" />
            <p className="text-xl font-black uppercase leading-tight text-white md:text-2xl">
              Cada vuelta<br />cuenta.
            </p>
            <div className="mt-3 h-px w-8 bg-red-600" />
          </div>
        </div>

      </div>
    </section>
  );
}

// ─── 03 · TESTIMONIOS — PREPARADO PARA GOOGLE MAPS ──────────────
async function Testimonios() {
  // Reseñas reales de Google Places (server-side, solo 5★). Ante error o falta
  // de envs, getGoogleReviews() devuelve [] y se muestra el fallback elegante.
  const reviews = await getGoogleReviews();
  const placeUrl = getGooglePlaceUrl();
  const tieneReviews = reviews.length > 0;

  return (
    <section className="relative overflow-hidden border-y border-white/5 bg-black text-white">
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
            <h2 className="text-2xl font-black uppercase leading-[0.95] md:text-[2.6rem]">
              Clientes que ya vivieron la{" "}
              <span className="text-red-600">experiencia SIM.</span>
            </h2>
            <p className="mt-3 flex items-center gap-2 text-sm text-white/45">
              <svg viewBox="0 0 48 48" className="h-4 w-4 shrink-0" aria-hidden="true">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
              </svg>
              Reseñas reales de Google Maps.
            </p>
          </div>
          {placeUrl && (
            <a
              href={placeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit shrink-0 items-center gap-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white"
            >
              Ver todas en Google Maps ↗
            </a>
          )}
        </div>
      </div>

      {tieneReviews ? (
        <ReviewsCarousel reviews={reviews} placeUrl={placeUrl} />
      ) : (
        // Fallback oscuro elegante
        <div className="relative flex flex-col items-center justify-center gap-6 px-6 pb-16 text-center md:pb-20">
          <div className="grid w-full max-w-5xl gap-4 md:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex gap-1">
                  {[...Array(5)].map((_, j) => (
                    <span key={j} className="text-base text-white/10">★</span>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="h-2.5 w-full rounded bg-white/5" />
                  <div className="h-2.5 w-4/5 rounded bg-white/5" />
                  <div className="h-2.5 w-3/5 rounded bg-white/5" />
                </div>
                <div className="mt-2 flex items-center gap-3 border-t border-white/10 pt-5">
                  <div className="h-9 w-9 rounded-full bg-white/5" />
                  <div className="space-y-1.5">
                    <div className="h-2 w-20 bg-white/5" />
                    <div className="h-2 w-12 bg-white/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.45em] text-white/25">
            Reseñas verificadas · En camino
          </p>
        </div>
      )}

    </section>
  );
}

// ─── 04 · COMUNIDAD ──────────────────────────────────────────────
function Comunidad() {
  return (
    <section className="border-y border-white/5 bg-black">
      <div className="mx-auto max-w-7xl">
        <div className="grid md:grid-cols-2">

          {/* izquierda — texto */}
          <div className="border-b border-white/5 px-8 py-16 md:border-b-0 md:border-r md:px-14 md:py-20">
            <p className="mb-6 text-[10px] font-black uppercase tracking-[0.55em] text-red-500">
              Comunidad
            </p>

            <h2 className="text-[2rem] font-black uppercase leading-[0.88] sm:text-4xl md:text-5xl">
              SIM no es<br />solo un turno.
            </h2>

            <div className="mt-10 space-y-0 divide-y divide-white/5 border-y border-white/5">
              {[
                { num: "01", text: "Torneos con clasificación real" },
                { num: "02", text: "Eventos grupales y corporativos" },
                { num: "03", text: "Sesiones para mejorar tu tiempo" },
                { num: "04", text: "Una comunidad que vuelve" },
              ].map((item) => (
                <div key={item.num} className="flex items-center gap-5 py-5">
                  <span className="text-sm font-black text-red-600/50 shrink-0">{item.num}</span>
                  <p className="text-sm font-black uppercase tracking-wide text-white/60">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>

            <Link
              href="https://www.instagram.com/sim_argentina"
              target="_blank"
              className="mt-10 inline-flex items-center gap-3 border border-white/15 px-7 py-4 text-xs font-black uppercase tracking-widest text-white/50 transition-all hover:border-red-600 hover:text-white"
            >
              Seguir en Instagram <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* derecha — declaración */}
          <div className="relative flex flex-col items-start justify-end overflow-hidden bg-[#0a0a0a] px-8 py-16 md:px-14 md:py-20">
            {/* pattern de fondo */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.025]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, #fff 0px, #fff 1px, transparent 1px, transparent 40px), repeating-linear-gradient(-45deg, #fff 0px, #fff 1px, transparent 1px, transparent 40px)",
              }}
            />
            {/* acento rojo */}
            <div className="absolute right-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-transparent via-red-600 to-transparent opacity-40" />

            <div className="relative">
              <p className="text-[10px] font-black uppercase tracking-[0.55em] text-white/20 mb-6">
                Volvé a intentarlo
              </p>
              <p className="text-[2.8rem] font-black uppercase leading-[0.88] text-white/25 sm:text-5xl md:text-7xl">
                CADA<br />VUELTA<br />CUENTA.
              </p>
              <div className="mt-8 h-px w-12 bg-red-600" />
              <p className="mt-6 text-sm leading-8 text-white/30">
                El mejor tiempo de esta semana te está esperando.
              </p>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

// ─── 05 · CTA FINAL ──────────────────────────────────────────────
function CTAFinal() {
  return (
    <section className="relative overflow-hidden bg-red-600">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, #000 0px, #000 1px, transparent 1px, transparent 80px)",
        }}
      />
      <div className="relative mx-auto max-w-4xl px-6 py-28 text-center md:py-36">
        <p className="mb-5 text-[10px] font-black uppercase tracking-[0.55em] text-white/50">
          ¿Listo?
        </p>
        <h2 className="text-[2.5rem] font-black uppercase leading-[0.88] text-white sm:text-5xl md:text-7xl">
          ¿LISTO PARA<br />VIVIR LA<br />EXPERIENCIA?
        </h2>
        <p className="mt-6 text-sm text-white/60">
          Reservá tu turno online. Sin vueltas.
        </p>
        <Link
          href="/reservas"
          className="mt-10 inline-flex items-center gap-3 bg-black px-12 py-5 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-white hover:text-black"
        >
          RESERVAR AHORA
          <ArrowRight className="h-4 w-4" />
        </Link>
        <div className="mt-5">
          <a
            href="https://wa.me/5493512520927"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/40 transition-colors hover:text-white"
          >
            O consultá por WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <HeroHome />
      <QueEsSim />
      <Galeria />
      <Testimonios />
      <Comunidad />
      <CTAFinal />
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HeroHome from "@/components/HeroHome";

// ─── 01 · QUÉ ES SIM ────────────────────────────────────────────
function QueEsSim() {
  return (
    <section className="border-y border-white/5 bg-black">
      <div className="mx-auto max-w-7xl">

        {/* layout asimétrico */}
        <div className="grid md:grid-cols-[1fr_auto]">

          {/* izquierda — frase de impacto */}
          <div className="relative border-b border-white/5 px-8 py-16 md:border-b-0 md:border-r md:px-14 md:py-20">
            {/* franja roja vertical */}
            <div className="absolute left-0 top-8 bottom-8 w-[3px] bg-red-600" />

            <p className="mb-6 text-[10px] font-black uppercase tracking-[0.55em] text-red-500">
              Por qué SIM
            </p>

            <h2 className="text-[2rem] font-black uppercase leading-[0.88] sm:text-[2.6rem] md:text-[3.8rem] lg:text-[4.5rem]">
              Entrás como fan.<br />
              <span className="text-white/30">Salís como piloto.</span>
            </h2>

            <p className="mt-7 max-w-md text-sm leading-8 text-white/40">
              El cockpit no sabe si sos profesional o no. Solo sabe que tenés el volante en las manos y la pista en la pantalla.
            </p>
          </div>

          {/* derecha — detalles verticales */}
          <div className="flex flex-col justify-center gap-0 divide-y divide-white/5 px-8 py-10 md:min-w-[260px] md:px-10">
            {[
              { label: "UBICACIÓN",   val: "Nuevo Centro · Córdoba" },
              { label: "SIMULADORES", val: "Fórmula 1 y GT"         },
              { label: "HARDWARE",    val: "Moza R5 Bundle"          },
              { label: "SESIONES",    val: "15 y 30 minutos"         },
            ].map((d) => (
              <div key={d.label} className="py-5">
                <p className="text-[9px] font-black uppercase tracking-[0.45em] text-white/25">
                  {d.label}
                </p>
                <p className="mt-1.5 text-sm font-black uppercase text-white/70">
                  {d.val}
                </p>
              </div>
            ))}

            <div className="pt-6">
              <Link
                href="/reservas"
                className="inline-flex items-center gap-2 bg-red-600 px-6 py-3.5 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-white hover:text-black"
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

        {/* foto izquierda — más alta */}
        <div className="group relative h-[30vh] min-h-[200px] overflow-hidden sm:h-[40vh] md:h-[50vh]">
          {/* fondo difuminado que rellena el panel sin recortar el colectivo */}
          <Image
            src="/sim-bus.jpg"
            alt=""
            aria-hidden
            fill
            className="scale-110 object-cover object-center opacity-50 blur-2xl"
          />
          <Image
            src="/sim-bus.jpg"
            alt="Colectivo SIM Racer Argentina"
            fill
            className="object-contain object-center transition-transform duration-700 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-black/30 transition-opacity duration-300 group-hover:bg-black/15" />

          {/* copy superpuesto */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 md:p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/50">
              SIM Racer · Argentina
            </p>
          </div>
        </div>

        {/* foto derecha — con copy editorial */}
        <div className="group relative h-[30vh] min-h-[200px] overflow-hidden border-l border-black sm:h-[40vh] md:h-[50vh]">
          <Image
            src="/sim-home-11.jpg"
            alt="SIM Argentina"
            fill
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
function Testimonios() {
  // Estructura lista para reseñas reales.
  // Cuando lleguen las reales, reemplazar REVIEWS con los datos reales.
  const REVIEWS: Array<{
    nombre: string;
    ciudad: string;
    estrellas: number;
    texto: string;
    foto?: string;
  }> = [
    // Descomentar y completar cuando lleguen las reseñas reales:
    // { nombre: "Nombre Apellido", ciudad: "Córdoba", estrellas: 5, texto: "...", foto: undefined },
  ];

  const tieneReviews = REVIEWS.length > 0;

  return (
    <section className="bg-white text-black">

      {/* header */}
      <div className="border-b border-black/8 px-8 py-10 md:px-14">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.55em] text-red-600">
              Pilotos SIM
            </p>
            <h2 className="mt-2 text-3xl font-black uppercase leading-tight md:text-4xl">
              Lo que dicen.
            </h2>
          </div>
          {/* badge Google Maps */}
          <div className="flex items-center gap-2 border border-black/10 px-4 py-2 w-fit">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#EA4335"/>
              <circle cx="12" cy="9" r="2.5" fill="white"/>
            </svg>
            <p className="text-[10px] font-black uppercase tracking-widest text-black/40">
              Google Maps · Reseñas verificadas
            </p>
          </div>
        </div>
      </div>

      {tieneReviews ? (
        // Layout de reviews reales
        <div className="grid md:grid-cols-3">
          {REVIEWS.map((r, i) => (
            <div
              key={i}
              className={`flex flex-col justify-between px-8 py-10 ${i < REVIEWS.length - 1 ? "border-b border-black/8 md:border-b-0 md:border-r" : ""}`}
            >
              {/* stars */}
              <div className="mb-4 flex gap-0.5">
                {[...Array(5)].map((_, j) => (
                  <span key={j} className={`text-lg ${j < r.estrellas ? "text-red-600" : "text-black/15"}`}>★</span>
                ))}
              </div>

              <p className="flex-1 text-base leading-8 text-black/70">
                "{r.texto}"
              </p>

              <div className="mt-6 flex items-center gap-3 border-t border-black/8 pt-5">
                {r.foto ? (
                  <div className="relative h-9 w-9 overflow-hidden rounded-full bg-black/10">
                    <Image src={r.foto} alt={r.nombre} fill className="object-cover" />
                  </div>
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-xs font-black text-white">
                    {r.nombre.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="text-sm font-black uppercase tracking-wide">{r.nombre}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-black/30">{r.ciudad}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Estado: próximamente
        <div className="flex flex-col items-center justify-center gap-6 px-8 py-20 text-center md:py-24">
          {/* 3 slots skeleton */}
          <div className="grid w-full max-w-4xl gap-px bg-black/5 md:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col gap-4 bg-white px-8 py-10">
                <div className="flex gap-1">
                  {[...Array(5)].map((_, j) => (
                    <span key={j} className="text-lg text-black/10">★</span>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="h-2.5 w-full rounded-none bg-black/5" />
                  <div className="h-2.5 w-4/5 rounded-none bg-black/5" />
                  <div className="h-2.5 w-3/5 rounded-none bg-black/5" />
                </div>
                <div className="mt-2 flex items-center gap-3 border-t border-black/5 pt-5">
                  <div className="h-9 w-9 rounded-full bg-black/5" />
                  <div className="space-y-1.5">
                    <div className="h-2 w-20 bg-black/5" />
                    <div className="h-2 w-12 bg-black/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.45em] text-black/25">
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

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import HeroHome from "@/components/HeroHome";

// ─── 02 · QUÉ ES SIM ────────────────────────────────────────────
function QueEsSim() {
  const bloques = [
    { val: "UN COCKPIT",  sub: "PROFESIONAL" },
    { val: "MOVIMIENTO",  sub: "REAL"         },
    { val: "VOS AL",      sub: "VOLANTE."     },
  ];

  return (
    <section className="border-y border-white/5">
      <div className="mx-auto max-w-7xl">

        <div className="grid md:grid-cols-3">
          {bloques.map((b, i) => (
            <div
              key={i}
              className={`px-10 py-14 ${i === 1 ? "border-y border-white/5 md:border-x md:border-y-0" : ""}`}
            >
              <p className="text-[2.6rem] font-black uppercase leading-[1] md:text-[3rem]">
                {b.val}
              </p>
              <p className="text-[2.6rem] font-black uppercase leading-[1] text-red-600 md:text-[3rem]">
                {b.sub}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-6 border-t border-white/5 px-10 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/35">
            Fórmula 1 sin licencia. Nuevo Centro Shopping, Córdoba.
          </p>
          <Link
            href="/reservas"
            className="inline-flex w-fit items-center gap-3 bg-red-600 px-8 py-4 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-white hover:text-black"
          >
            Reservar turno <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

      </div>
    </section>
  );
}

// ─── 03 · GALERÍA ───────────────────────────────────────────────
function Galeria() {
  return (
    <section className="px-6 py-12 md:px-12 md:py-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">

          {/* foto grande izquierda */}
          <div className="group relative min-h-[380px] overflow-hidden md:min-h-[580px]">
            <Image
              src="/sim-home-2.jpg"
              alt="SIM Argentina"
              fill
              className="object-cover transition-transform duration-700 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <div className="absolute bottom-0 left-0 p-8">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
                SIM Argentina
              </p>
              <h2 className="text-5xl font-black uppercase leading-[0.88] text-white md:text-6xl">
                LA<br />EXPERIENCIA.
              </h2>
            </div>
          </div>

          {/* fotos apiladas derecha */}
          <div className="grid gap-3">
            <div className="group relative min-h-[186px] overflow-hidden md:min-h-0">
              <Image
                src="/sim-home-3.jpg"
                alt="SIM Argentina"
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-black/20 transition-opacity duration-300 group-hover:bg-black/10" />
            </div>
            <div className="group relative min-h-[186px] overflow-hidden md:min-h-0">
              <Image
                src="/sim-home-11.jpg"
                alt="SIM Argentina"
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-black/20 transition-opacity duration-300 group-hover:bg-black/10" />
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

// ─── 04 · TESTIMONIOS ───────────────────────────────────────────
const TESTIMONIOS = [
  {
    quote: "Nunca manejé algo tan parecido a un F1 real.",
    nombre: "MATÍAS G.",
    ciudad: "Córdoba",
  },
  {
    quote: "Una experiencia que no se olvida. Pura adrenalina desde el primer segundo.",
    nombre: "LUCAS M.",
    ciudad: "Buenos Aires",
  },
  {
    quote: "Vine con amigos y quedamos todos enganchados. Ya volvimos tres veces.",
    nombre: "SOFÍA R.",
    ciudad: "Córdoba",
  },
];

function Testimonios() {
  return (
    <section className="bg-white text-black">
      <div className="mx-auto max-w-7xl">

        <div className="border-b border-black/8 px-10 py-10">
          <p className="text-[10px] font-black uppercase tracking-[0.55em] text-red-600">
            Pilotos SIM
          </p>
        </div>

        <div className="grid md:grid-cols-3">
          {TESTIMONIOS.map((t, i) => (
            <div
              key={t.nombre}
              className={`flex flex-col justify-between px-10 py-12 ${i < 2 ? "border-b border-black/8 md:border-b-0 md:border-r" : ""}`}
            >
              <div>
                <div className="mb-5 flex gap-0.5">
                  {[...Array(5)].map((_, j) => (
                    <span key={j} className="text-lg text-red-600">★</span>
                  ))}
                </div>
                <p className="text-2xl font-black uppercase leading-tight md:text-3xl">
                  "{t.quote}"
                </p>
              </div>

              <div className="mt-8 border-t border-black/8 pt-6">
                <p className="text-sm font-black uppercase tracking-widest text-black">
                  {t.nombre}
                </p>
                <p className="mt-0.5 text-xs font-black uppercase tracking-widest text-black/30">
                  {t.ciudad}
                </p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}

// ─── 05 · TORNEOS / COMUNIDAD ───────────────────────────────────
const STATS = [
  { val: "F1",   label: "Experiencia profesional"  },
  { val: "360°", label: "Inmersión total"           },
  { val: "2",    label: "Simuladores disponibles"   },
  { val: "NC",   label: "Nuevo Centro, Córdoba"     },
];

function Comunidad() {
  return (
    <section className="border-y border-white/5 px-6 py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-7xl grid gap-16 md:grid-cols-2 md:items-center">

        {/* texto */}
        <div>
          <p className="mb-5 text-[10px] font-black uppercase tracking-[0.55em] text-red-500">
            Comunidad
          </p>
          <h2 className="text-5xl font-black uppercase leading-[0.88] md:text-6xl">
            SIM no es<br />
            solo un turno.
          </h2>
          <p className="mt-7 max-w-sm text-sm leading-8 text-white/40">
            Torneos, competencias, eventos corporativos y experiencias grupales.
            Una comunidad de pilotos que compiten, mejoran y vuelven.
          </p>
          <Link
            href="https://www.instagram.com/sim_argentina"
            target="_blank"
            className="mt-8 inline-flex items-center gap-3 border border-white/15 px-7 py-4 text-sm font-black uppercase tracking-widest text-white/50 transition-all hover:border-red-600 hover:text-white"
          >
            Seguirnos en Instagram <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* grid de datos */}
        <div className="grid grid-cols-2 gap-px bg-white/5 overflow-hidden">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[#0a0a0a] px-8 py-10">
              <p className="text-4xl font-black text-white md:text-5xl">{s.val}</p>
              <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-white/25">
                {s.label}
              </p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}

// ─── 06 · CTA FINAL ─────────────────────────────────────────────
function CTAFinal() {
  return (
    <section className="relative overflow-hidden bg-red-600">
      {/* patrón de fondo */}
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
        <h2 className="text-5xl font-black uppercase leading-[0.88] text-white md:text-7xl">
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
            <MessageCircle className="h-3.5 w-3.5" />
            O consultá por WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── HOME ────────────────────────────────────────────────────────
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

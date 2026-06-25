"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const STATS = [
  { value: "F1",            sup: "",    label: "Experiencia\nprofesional" },
  { value: "15",            sup: "MIN", label: "Turnos\nágiles"           },
  { value: "30",            sup: "MIN", label: "Máxima\ninmersión"        },
  { value: "NUEVO CENTRO",  sup: "",    label: "Shopping\nCórdoba"        },
  { value: "EVENTOS",       sup: "",    label: "Corp.\ny privados"        },
];

const TICKER = [
  "SIM ARGENTINA",
  "SIMULADORES PROFESIONALES",
  "EVENTOS CORPORATIVOS",
  "ALQUILER DE EQUIPOS",
  "EXPERIENCIAS A MEDIDA",
  "CÓRDOBA · ARGENTINA",
];

const LINES = [
  { top: "18%", w: "35%", opacity: 0.06, dur: 9,  delay: 0,   color: "255,255,255" },
  { top: "27%", w: "20%", opacity: 0.04, dur: 13, delay: 2.5, color: "220,38,38"   },
  { top: "41%", w: "45%", opacity: 0.05, dur: 8,  delay: 1,   color: "255,255,255" },
  { top: "55%", w: "28%", opacity: 0.04, dur: 15, delay: 3.5, color: "220,38,38"   },
  { top: "68%", w: "38%", opacity: 0.06, dur: 10, delay: 0.8, color: "255,255,255" },
  { top: "79%", w: "22%", opacity: 0.03, dur: 12, delay: 4,   color: "255,255,255" },
];

export default function HeroHome() {
  return (
    <section className="relative flex min-h-[100svh] flex-col overflow-hidden bg-black">

      {/* ── Líneas de velocidad (solo desktop) ── */}
      <div className="hidden md:block">
        {LINES.map((l, i) => (
          <div
            key={i}
            className="pointer-events-none absolute left-0 h-px"
            style={{
              top: l.top,
              width: l.w,
              background: `rgba(${l.color}, ${l.opacity})`,
              animation: `speedline ${l.dur}s linear ${l.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* ── Imagen de fondo full bleed ── */}
      <div className="absolute inset-0">
        <Image
          src="/sim-hero.jpg"
          alt="SIM Argentina — Simulador profesional"
          fill
          sizes="100vw"
          className="object-cover object-right md:object-center"
          priority
        />

        {/* Mobile: overlay fuerte para legibilidad del texto */}
        <div className="absolute inset-0 bg-black/70 md:hidden" />

        {/* Desktop: overlay direccional izquierda */}
        <div
          className="absolute inset-0 hidden md:block"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.75) 28%, rgba(0,0,0,0.30) 52%, rgba(0,0,0,0.05) 75%, transparent 100%)",
          }}
        />

        {/* Overlay inferior: protege stats bar */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 15%, transparent 35%)",
          }}
        />

        {/* Overlay superior */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 12%)",
          }}
        />
      </div>

      {/* ── Contenido principal ── */}
      <div className="relative flex flex-1 flex-col justify-center px-6 pb-6 pt-20 md:max-w-[52%] md:px-12 md:py-0 md:pl-16">

        {/* texto vertical — solo desktop */}
        <div className="absolute left-5 top-1/2 hidden -translate-y-1/2 md:block">
          <p
            className="text-[9px] font-black uppercase tracking-[0.45em] text-white/20"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            EXPERIENCIA REAL · ADRENALINA PURA
          </p>
        </div>

        <h1 className="text-[2rem] font-black uppercase leading-[0.88] sm:text-[2.6rem] md:text-[3.2rem] lg:text-[4rem] xl:text-[4.8rem]">
          LA EXPERIENCIA<br />
          MÁS CERCANA<br />
          A MANEJAR UN{" "}
          <em className="not-italic text-red-600">F1.</em>
        </h1>

        <div className="my-5 h-0.5 w-10 bg-red-600 md:my-6 md:w-12" />

        <p className="max-w-xs text-sm leading-7 text-white/60 md:leading-8">
          Simuladores profesionales diseñados para quienes viven la pasión por el motorsport.
        </p>

        <Link
          href="/reservas"
          className="group mt-7 inline-flex w-full items-center justify-center gap-3 bg-red-600 py-4 text-sm font-black uppercase tracking-widest text-white transition-all duration-300 hover:bg-white hover:text-black sm:w-fit sm:px-8 sm:justify-start md:mt-8"
        >
          RESERVAR AHORA
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      </div>

      {/* ── Stats bar — scroll horizontal en mobile ── */}
      <div className="relative z-10 flex overflow-x-auto border-t border-white/8 scrollbar-none md:grid md:grid-cols-5 md:divide-x md:divide-white/8">
        {STATS.map((s) => (
          <div key={s.label} className="shrink-0 border-r border-white/8 px-5 py-4 md:border-r-0 md:px-6 md:py-5">
            <p className="text-lg font-black leading-none text-white md:text-2xl">
              {s.value}
              {s.sup && (
                <span className="ml-1 text-[10px] font-black text-red-500 md:text-xs">{s.sup}</span>
              )}
            </p>
            <p className="mt-1.5 whitespace-pre-line text-[9px] font-black uppercase tracking-widest text-white/30">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* ── Ticker ── */}
      <div className="relative z-10 flex items-center overflow-hidden border-t border-white/5 py-3">
        <div
          className="flex shrink-0 whitespace-nowrap"
          style={{ animation: "ticker 28s linear infinite" }}
        >
          {[...TICKER, ...TICKER].map((item, i) => (
            <span
              key={i}
              className="px-5 text-[9px] font-black uppercase tracking-[0.35em] text-white/20 md:px-6"
            >
              {item}
              <span className="mx-4 text-red-600 md:mx-5">·</span>
            </span>
          ))}
        </div>

      </div>

      <style jsx global>{`
        @keyframes speedline {
          0%   { transform: translateX(-110%); opacity: 0; }
          10%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateX(320%); opacity: 0; }
        }
        @keyframes ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </section>
  );
}

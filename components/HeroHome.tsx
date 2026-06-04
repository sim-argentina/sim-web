"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const STATS = [
  { value: "F1", sup: "", label: "Experiencia\nprofesional" },
  { value: "15", sup: "MIN", label: "Turnos\nágiles" },
  { value: "30", sup: "MIN", label: "Máxima\ninmersión" },
  { value: "NUEVO CENTRO", sup: "", label: "Shopping\nCórdoba" },
  { value: "EVENTOS", sup: "", label: "Corp.\ny privados" },
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

      {/* ── Líneas de velocidad ── */}
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

      {/* ── Imagen de fondo full bleed ── */}
      <div className="absolute inset-0">
        <Image
          src="/sim-hero.jpg"
          alt="SIM Argentina — Simulador profesional"
          fill
          className="object-cover object-center"
          priority
        />
        {/* overlay izquierda: protege el texto */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.75) 28%, rgba(0,0,0,0.30) 52%, rgba(0,0,0,0.05) 75%, transparent 100%)",
          }}
        />
        {/* overlay inferior: protege stats bar */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 15%, transparent 35%)",
          }}
        />
        {/* overlay superior: separa de navbar */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 12%)",
          }}
        />
      </div>

      {/* ── Contenido principal ── */}
      <div className="relative flex flex-1 flex-col justify-center px-8 pb-10 pt-24 md:px-12 md:py-0 md:pl-16 md:max-w-[52%]">

        {/* texto vertical */}
        <div className="absolute left-5 top-1/2 hidden -translate-y-1/2 md:block">
          <p
            className="text-[9px] font-black uppercase tracking-[0.45em] text-white/20"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            EXPERIENCIA REAL · ADRENALINA PURA
          </p>
        </div>

        <p className="mb-6 text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
          SIM ARGENTINA · CÓRDOBA
        </p>

        <h1 className="text-[2.6rem] font-black uppercase leading-[0.88] md:text-[3.2rem] lg:text-[4rem] xl:text-[4.8rem]">
          LA EXPERIENCIA<br />
          MÁS CERCANA<br />
          A MANEJAR UN{" "}
          <em className="not-italic text-red-600">F1.</em>
        </h1>

        <div className="my-6 h-0.5 w-12 bg-red-600" />

        <p className="max-w-xs text-sm leading-8 text-white/60">
          Simuladores profesionales diseñados para quienes viven la pasión por el motorsport.
        </p>

        <Link
          href="/reservas"
          className="group mt-8 inline-flex w-fit items-center gap-3 bg-red-600 px-8 py-4 text-sm font-black uppercase tracking-widest text-white transition-all duration-300 hover:bg-white hover:text-black"
        >
          RESERVAR AHORA
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      </div>

      {/* ── Stats bar ── */}
      <div className="relative z-10 grid grid-cols-2 divide-x divide-white/8 border-t border-white/8 sm:grid-cols-3 md:grid-cols-5">
        {STATS.map((s) => (
          <div key={s.label} className="px-6 py-5">
            <p className="text-xl font-black leading-none text-white md:text-2xl">
              {s.value}
              {s.sup && (
                <span className="ml-1 text-xs font-black text-red-500">{s.sup}</span>
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
              className="px-6 text-[9px] font-black uppercase tracking-[0.35em] text-white/20"
            >
              {item}
              <span className="mx-5 text-red-600">·</span>
            </span>
          ))}
        </div>

        <div className="absolute right-6 hidden items-center gap-2 bg-black pl-6 text-[9px] font-black uppercase tracking-widest text-white/20 md:flex">
          SCROLL <span className="text-red-600 tracking-tight">///</span>
          <span className="text-white/20">↓</span>
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
      `}</style>
    </section>
  );
}

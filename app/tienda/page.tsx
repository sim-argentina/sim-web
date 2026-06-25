"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { MessageCircle, ArrowRight, Check } from "lucide-react";

const WA = "https://wa.me/5493512520927";
const WA_F1 = `${WA}?text=${encodeURIComponent("Hola! Me interesa el Simulador F1. ¿Podés darme más información y precio?")}`;
const WA_GT = `${WA}?text=${encodeURIComponent("Hola! Me interesa el Simulador GT. ¿Podés darme más información y precio?")}`;

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("is-visible"); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useFadeIn();
  return (
    <div
      ref={ref}
      className={`fade-in ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function PlaceholderHero() {
  return (
    <div className="relative flex h-full min-h-[420px] w-full items-center justify-center overflow-hidden bg-[#0a0a0a]">
      <div className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(220,38,38,0.18) 0%, transparent 70%)",
        }}
      />
      <div className="absolute inset-0"
        style={{
          backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 50px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 50px)",
        }}
      />
      <div className="relative text-center select-none">
        <p className="text-[7rem] font-black uppercase leading-none tracking-tighter text-white/[0.04]">SIM</p>
        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.5em] text-white/15">Simulador · Foto próximamente</p>
      </div>
      {[["top-4 left-4 border-t border-l"],["top-4 right-4 border-t border-r"],["bottom-4 left-4 border-b border-l"],["bottom-4 right-4 border-b border-r"]].map(([cls], i) => (
        <div key={i} className={`absolute h-6 w-6 border-white/10 ${cls}`} />
      ))}
    </div>
  );
}

function PlaceholderCard({ label }: { label: string }) {
  return (
    <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[#0d0d0d]"
      style={{ background: "radial-gradient(ellipse 80% 70% at 50% 110%, rgba(220,38,38,0.12) 0%, #0d0d0d 65%)" }}
    >
      <div className="absolute inset-0"
        style={{
          backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,0.01) 0px, rgba(255,255,255,0.01) 1px, transparent 1px, transparent 60px)",
        }}
      />
      <div className="relative text-center select-none">
        <p className="text-6xl font-black uppercase tracking-tighter text-white/[0.05]">SIM</p>
        <p className="mt-2 text-[9px] font-black uppercase tracking-[0.4em] text-white/10">{label}</p>
      </div>
      {[["top-3 left-3 border-t border-l"],["top-3 right-3 border-t border-r"],["bottom-3 left-3 border-b border-l"],["bottom-3 right-3 border-b border-r"]].map(([cls], i) => (
        <div key={i} className={`absolute h-5 w-5 border-red-600/15 ${cls}`} />
      ))}
    </div>
  );
}

const TABLA = [
  { campo: "Tipo de butaca",      f1: "F1",                   gt: "Deportiva GT" },
  { campo: "Posición de manejo",  f1: "Extrema / recostada",  gt: "Tradicional / erguida" },
  { campo: "Uso recomendado",     f1: "Fórmula 1",              gt: "GT, turismo, rally" },
  { campo: "Nivel de inmersión",  f1: "Máximo",               gt: "Alto" },
  { campo: "Estética",            f1: "Agresiva",             gt: "Profesional" },
];

export default function TiendaPage() {
  return (
    <main className="min-h-screen bg-[#080808] text-white overflow-x-hidden">

      {/* ─── HERO ─────────────────────────────────────────────── */}
      <section className="relative min-h-[100svh] overflow-hidden">
        {/* speed lines */}
        <div className="pointer-events-none absolute inset-0">
          {[12,24,36,48,60,72,84].map((l, i) => (
            <div key={i} className="absolute top-0 bottom-0 w-px"
              style={{ left: `${l}%`, background: `linear-gradient(to bottom, transparent 0%, rgba(220,38,38,${0.06 - i * 0.006}) 40%, rgba(220,38,38,${0.03 - i * 0.003}) 60%, transparent 100%)` }}
            />
          ))}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-white/5" />
        </div>

        <div className="relative grid min-h-[100svh] md:grid-cols-[1.25fr_0.75fr]">
          {/* texto */}
          <div className="relative z-10 flex flex-col justify-start px-8 pt-28 pb-16 md:px-16 md:pt-36 md:pb-16">
            <div className="mb-8 flex items-center gap-4">
              <div className="h-px w-8 bg-red-600" />
              <p className="text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
                Sim Store · SIM Argentina
              </p>
            </div>

            <h1 className="max-w-full break-words text-[2.6rem] font-black uppercase leading-[0.9] md:text-[3.4rem] lg:text-[4rem]">
              Simuladores<br />
              <span className="text-red-600">Profesionales</span>
            </h1>

            <p className="mt-6 max-w-md text-[15px] leading-8 text-white/45">
              Diseñados para quienes viven el motorsport y buscan una experiencia de conducción premium.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link href={WA} target="_blank"
                className="group inline-flex items-center gap-3 rounded-none border border-red-600 bg-red-600 px-8 py-4 text-sm font-black uppercase tracking-widest text-white transition-all duration-300 hover:bg-transparent hover:text-red-500"
              >
                <MessageCircle className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                Solicitar información
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-14 flex gap-10 border-t border-white/5 pt-8">
              {[["Componentes","Profesionales"],["Máximo","Realismo"]].map(([a,b]) => (
                <div key={a}>
                  <p className="text-xs font-black uppercase text-white/70">{a}</p>
                  <p className="text-xs font-black uppercase text-white/30">{b}</p>
                </div>
              ))}
            </div>
          </div>

          {/* imagen hero */}
          <div className="hidden md:block">
            <PlaceholderHero />
          </div>
        </div>
      </section>

      {/* ─── DOS CONFIGS ──────────────────────────────────────── */}
      <section className="border-t border-white/5 px-6 py-20 md:px-12 md:py-28">
        <FadeIn className="mb-14 text-center">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.55em] text-red-500">Elegí tu experiencia</p>
          <h2 className="text-4xl font-black uppercase leading-tight md:text-5xl">
            Dos configuraciones.<br />
            <span className="text-white/30">Misma pasión.</span>
          </h2>
        </FadeIn>

        <div className="mx-auto grid max-w-6xl gap-px bg-white/5 md:grid-cols-2">

          {/* F1 */}
          <FadeIn delay={0} className="group flex flex-col bg-[#080808] transition-all duration-500 hover:bg-[#0f0f0f]">
            <div className="relative overflow-hidden">
              <div
                className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[#0d0d0d]"
                style={{ background: "radial-gradient(ellipse 80% 70% at 50% 110%, rgba(220,38,38,0.12) 0%, #0d0d0d 65%)" }}
              >
                <Image
                  src="/Sim-f1.png"
                  alt="Simulador F1 SIM Argentina"
                  fill
                  sizes="(max-width: 768px) 100vw, 45vw"
                  className="object-contain"
                />
              </div>
              <div className="absolute inset-0 bg-red-600/0 transition-all duration-500 group-hover:bg-red-600/5" />
              <div className="absolute top-4 left-4">
                <span className="border border-red-600/60 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-red-500">
                  Simulador
                </span>
              </div>
            </div>

            <div className="flex flex-1 flex-col p-8 md:p-10">
              <div className="mb-1 text-[10px] font-black uppercase tracking-[0.5em] text-red-600">Fórmula 1</div>
              <h3 className="mb-4 text-4xl font-black uppercase leading-none">F1</h3>
              <p className="text-sm leading-8 text-white/40">
                Posición de manejo inspirada en la Fórmula 1. Vivì la experiencia de conducción más extrema y realista.
              </p>

              <ul className="mt-6 space-y-2.5">
                {["Butaca F1","Posición recostada extrema","Máximo nivel de inmersión","Moza R5 Bundle incluido"].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-xs text-white/50">
                    <Check className="h-3.5 w-3.5 shrink-0 text-red-600" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-col gap-2 border-t border-white/5 pt-6 sm:flex-row">
                <Link href={WA_F1} target="_blank"
                  className="flex flex-1 items-center justify-center gap-2 border border-white/10 px-5 py-3.5 text-xs font-black uppercase tracking-widest text-white/50 transition-all duration-300 hover:border-red-600 hover:bg-red-600 hover:text-white"
                >
                  <MessageCircle className="h-4 w-4" />
                  Consultar por WhatsApp
                </Link>
              </div>
            </div>
          </FadeIn>

          {/* GT */}
          <FadeIn delay={100} className="group flex flex-col bg-[#080808] transition-all duration-500 hover:bg-[#0f0f0f]">
            <div className="relative overflow-hidden">
              <PlaceholderCard label="Simulador GT" />
              <div className="absolute inset-0 bg-red-600/0 transition-all duration-500 group-hover:bg-red-600/5" />
              <div className="absolute top-4 left-4">
                <span className="border border-red-600/60 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-red-500">
                  Simulador
                </span>
              </div>
            </div>

            <div className="flex flex-1 flex-col p-8 md:p-10">
              <div className="mb-1 text-[10px] font-black uppercase tracking-[0.5em] text-red-600">Gran Turismo</div>
              <h3 className="mb-4 text-4xl font-black uppercase leading-none">GT</h3>
              <p className="text-sm leading-8 text-white/40">
                Posición de manejo deportiva, similar a la de los autos de competición de turismo y GT.
              </p>

              <ul className="mt-6 space-y-2.5">
                {["Butaca deportiva GT","Posición erguida y cómoda","Alto nivel de inmersión","Moza R5 Bundle incluido"].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-xs text-white/50">
                    <Check className="h-3.5 w-3.5 shrink-0 text-red-600" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-col gap-2 border-t border-white/5 pt-6 sm:flex-row">
                <Link href={WA_GT} target="_blank"
                  className="flex flex-1 items-center justify-center gap-2 border border-white/10 px-5 py-3.5 text-xs font-black uppercase tracking-widest text-white/50 transition-all duration-300 hover:border-red-600 hover:bg-red-600 hover:text-white"
                >
                  <MessageCircle className="h-4 w-4" />
                  Consultar por WhatsApp
                </Link>
              </div>
            </div>
          </FadeIn>

        </div>
      </section>

      {/* ─── TABLA COMPARATIVA ────────────────────────────────── */}
      <section className="border-y border-white/5 bg-[#060606] px-6 py-20 md:px-12 md:py-28">
        <div className="mx-auto max-w-5xl">
          <FadeIn className="mb-14 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.55em] text-red-500">Equipamiento</p>
              <h2 className="text-4xl font-black uppercase leading-tight md:text-5xl">
                La diferencia<br />está en los<br />detalles.
              </h2>
            </div>
            <p className="max-w-xs text-sm leading-7 text-white/30 md:text-right">
              Dos configuraciones optimizadas para distintos estilos de conducción.
            </p>
          </FadeIn>

          <FadeIn delay={100}>
            {/* header */}
            <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-white/8 pb-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Característica</p>
              <p className="text-center text-[10px] font-black uppercase tracking-widest text-red-500">Simulador F1</p>
              <p className="text-center text-[10px] font-black uppercase tracking-widest text-white/50">Simulador GT</p>
            </div>

            {/* filas */}
            {TABLA.map((row, i) => (
              <div key={i} className={`grid grid-cols-[1fr_1fr_1fr] items-center gap-4 border-b border-white/5 py-5 transition-colors duration-200 hover:bg-white/[0.02] ${i % 2 === 0 ? "" : ""}`}>
                <p className="text-xs font-black uppercase tracking-widest text-white/30">{row.campo}</p>
                <div className="flex flex-col items-center gap-1">
                  <Check className="h-3.5 w-3.5 text-red-600" />
                  <p className="text-center text-[10px] text-white/50">{row.f1}</p>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Check className="h-3.5 w-3.5 text-white/30" />
                  <p className="text-center text-[10px] text-white/30">{row.gt}</p>
                </div>
              </div>
            ))}

            {/* WhatsApp row */}
            <div className="grid grid-cols-[1fr_1fr_1fr] items-center gap-4 pt-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Contacto</p>
              <Link href={WA_F1} target="_blank"
                className="flex items-center justify-center gap-1.5 border border-red-600/40 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-red-500 transition hover:bg-red-600 hover:text-white hover:border-red-600"
              >
                <MessageCircle className="h-3 w-3" /> WhatsApp
              </Link>
              <Link href={WA_GT} target="_blank"
                className="flex items-center justify-center gap-1.5 border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-white/30 transition hover:bg-white/10 hover:text-white"
              >
                <MessageCircle className="h-3 w-3" /> WhatsApp
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── EDITORIAL ────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-white/5 px-6 py-24 md:px-12 md:py-36">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <p className="select-none text-[18vw] font-black uppercase leading-none text-white/[0.018]">MOTORSPORT</p>
        </div>
        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-1 bg-red-600" />
        <FadeIn className="relative mx-auto max-w-5xl">
          <h2 className="text-[8vw] font-black uppercase leading-[0.88] md:text-[5.5vw]">
            Dos configuraciones.<br />
            <span className="text-red-600">Misma pasión.</span>
          </h2>
          <p className="mt-8 max-w-lg text-sm leading-8 text-white/35">
            Cada simulador SIM está ensamblado a mano en Argentina. Componentes profesionales, estructura personalizada y calibración incluida.
          </p>
        </FadeIn>
      </section>

      {/* ─── CIERRE ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-red-600 px-6 py-24 md:px-12 md:py-32">
        <div className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 80px)" }}
        />
        <FadeIn className="relative mx-auto flex max-w-5xl flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.55em] text-white/60">
              ¿Listo para el siguiente nivel?
            </p>
            <h2 className="text-4xl font-black uppercase leading-tight text-white md:text-6xl">
              Hablemos.
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-7 text-white/70">
              Contactanos por WhatsApp y recibí asesoramiento personalizado sobre nuestros simuladores.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link href={WA} target="_blank"
              className="group inline-flex items-center gap-3 bg-black px-10 py-5 text-sm font-black uppercase tracking-widest text-white transition-all duration-300 hover:bg-white hover:text-black"
            >
              <MessageCircle className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
              Hablar por WhatsApp
            </Link>
            <Link href="/reservas"
              className="inline-flex items-center justify-center gap-2 border border-white/30 px-10 py-4 text-xs font-black uppercase tracking-widest text-white/60 transition hover:border-white hover:text-white"
            >
              Probar antes de comprar
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </FadeIn>
      </section>

      <style jsx global>{`
        .fade-in {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.65s ease, transform 0.65s ease;
        }
        .fade-in.is-visible {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>
    </main>
  );
}

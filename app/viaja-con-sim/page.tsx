"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ChevronRight,
  Trophy,
  Bus,
  MapPin,
  Flag,
  Zap,
  ArrowRight,
} from "lucide-react";

export default function ViajaConSimPage() {
  return (
    <main className="min-h-screen bg-black text-white overflow-hidden">
      {/* HERO */}
      <section className="relative h-[100svh] flex items-center justify-center">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/videos/colectivo-sim.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-black/75" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.25),transparent_50%)]" />

        <div className="relative z-10 max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-2 border border-red-500/30 bg-red-500/10 px-4 py-2 rounded-full mb-6 backdrop-blur-sm">
              <Flag className="w-4 h-4 text-red-500" />
              <span className="text-sm tracking-wide text-zinc-300">
                EXPERIENCIA ITINERANTE F1
              </span>
            </div>

            <h1 className="text-5xl md:text-7xl font-black leading-[0.95] tracking-tight">
              VIAJÁ
              <br />
              <span className="text-red-500">CON SIM</span>
            </h1>

            <p className="mt-8 text-zinc-300 text-lg max-w-xl leading-relaxed">
              Llevamos la experiencia SIM a eventos, empresas, activaciones,
              shoppings y circuitos de todo el país con simuladores
              profesionales de Fórmula 1 en movimiento.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mt-10">
              <Link
                href="https://wa.me/543512520927"
                target="_blank"
                className="group bg-red-600 hover:bg-red-500 transition-all duration-300 px-7 py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 shadow-[0_0_40px_rgba(220,38,38,0.35)]"
              >
                Consultar disponibilidad
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>

              <Link
                href="/reservas"
                className="border border-white/10 hover:border-red-500/50 bg-white/5 hover:bg-white/10 transition-all duration-300 px-7 py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 backdrop-blur-sm"
              >
                Reservar turno
              </Link>
            </div>
          </div>

          <div className="relative hidden lg:flex justify-center">
            <div className="relative w-[540px] h-[620px]">
              <div className="absolute -inset-10 bg-red-600/20 blur-3xl rounded-full" />

              <Image
                src="/colectivo-sim.png"
                alt="Colectivo SIM"
                fill
                className="object-contain drop-shadow-[0_0_60px_rgba(255,0,0,0.25)]"
              />
            </div>
          </div>
        </div>

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronRight className="rotate-90 text-zinc-500 w-8 h-8" />
        </div>
      </section>

      {/* COLLAGE */}
      <section className="relative py-28 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-end justify-between mb-14">
            <div>
              <p className="text-red-500 font-semibold tracking-[0.25em] text-sm mb-4">
                EXPERIENCIA
              </p>

              <h2 className="text-4xl md:text-6xl font-black leading-none">
                SIM EN
                <br />
                MOVIMIENTO
              </h2>
            </div>

            <div className="hidden md:block max-w-sm text-zinc-400 text-right">
              Una experiencia visual, sonora y física diseñada para generar
              impacto en cualquier evento.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <div className="md:col-span-7 relative h-[480px] rounded-[32px] overflow-hidden border border-white/10">
              <Image
                src="/simulador1.jpg"
                alt="Simulador"
                fill
                className="object-cover hover:scale-105 transition-transform duration-700"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />

              <div className="absolute bottom-8 left-8">
                <p className="text-zinc-400 mb-2">Motion Platform</p>
                <h3 className="text-3xl font-bold">
                  Simuladores Profesionales
                </h3>
              </div>
            </div>

            <div className="md:col-span-5 flex flex-col gap-5">
              <div className="relative h-[228px] rounded-[32px] overflow-hidden border border-white/10">
                <Image
                  src="/simulador2.jpg"
                  alt="Evento"
                  fill
                  className="object-cover hover:scale-105 transition-transform duration-700"
                />

                <div className="absolute inset-0 bg-black/35" />
              </div>

              <div className="relative h-[228px] rounded-[32px] overflow-hidden border border-white/10">
                <Image
                  src="/simulador3.jpg"
                  alt="Experiencia"
                  fill
                  className="object-cover hover:scale-105 transition-transform duration-700"
                />

                <div className="absolute inset-0 bg-black/35" />
              </div>
            </div>

            <div className="md:col-span-4 relative h-[280px] rounded-[32px] overflow-hidden border border-white/10">
              <Image
                src="/simulador4.jpg"
                alt="F1"
                fill
                className="object-cover hover:scale-105 transition-transform duration-700"
              />

              <div className="absolute inset-0 bg-black/35" />
            </div>

            <div className="md:col-span-8 bg-zinc-950 border border-white/10 rounded-[32px] p-10 flex flex-col md:flex-row justify-between gap-10">
              <div className="max-w-xl">
                <p className="text-red-500 font-semibold mb-4">
                  MÁS QUE UN SIMULADOR
                </p>

                <h3 className="text-3xl md:text-4xl font-black leading-tight mb-5">
                  Creamos una experiencia que llama la atención desde lejos.
                </h3>

                <p className="text-zinc-400 leading-relaxed">
                  Ideal para marcas, activaciones, eventos corporativos,
                  exhibiciones, ferias, centros comerciales y experiencias
                  premium relacionadas al automovilismo.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-5 min-w-[260px]">
                <div className="bg-black rounded-2xl p-5 border border-white/5">
                  <Zap className="text-red-500 mb-4" />
                  <p className="text-3xl font-black">4</p>
                  <p className="text-zinc-500 text-sm mt-1">
                    Simuladores simultáneos
                  </p>
                </div>

                <div className="bg-black rounded-2xl p-5 border border-white/5">
                  <Bus className="text-red-500 mb-4" />
                  <p className="text-3xl font-black">2</p>
                  <p className="text-zinc-500 text-sm mt-1">
                    Pisos de experiencia
                  </p>
                </div>

                <div className="bg-black rounded-2xl p-5 border border-white/5">
                  <MapPin className="text-red-500 mb-4" />
                  <p className="text-3xl font-black">+</p>
                  <p className="text-zinc-500 text-sm mt-1">
                    Eventos en todo el país
                  </p>
                </div>

                <div className="bg-black rounded-2xl p-5 border border-white/5">
                  <Trophy className="text-red-500 mb-4" />
                  <p className="text-3xl font-black">F1</p>
                  <p className="text-zinc-500 text-sm mt-1">
                    Experiencia inmersiva
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-28 px-6">
        <div className="max-w-6xl mx-auto relative overflow-hidden rounded-[40px] border border-red-500/20 bg-gradient-to-br from-red-600/15 via-zinc-950 to-black p-10 md:p-16">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-red-600/20 blur-3xl rounded-full" />

          <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-10">
            <div className="max-w-2xl">
              <p className="text-red-500 font-semibold tracking-[0.25em] text-sm mb-5">
                ¿QUERÉS LLEVAR SIM A TU EVENTO?
              </p>

              <h2 className="text-4xl md:text-6xl font-black leading-[0.95] mb-6">
                HACÉ QUE
                <br />
                TU EVENTO
                <br />
                SE SIENTA
                <span className="text-red-500"> COMO F1</span>
              </h2>

              <p className="text-zinc-400 text-lg leading-relaxed">
                Activaciones de marca, eventos privados, acciones comerciales,
                torneos y experiencias premium.
              </p>
            </div>

            <Link
              href="https://wa.me/543512520927"
              target="_blank"
              className="group shrink-0 bg-red-600 hover:bg-red-500 transition-all duration-300 px-8 py-5 rounded-2xl font-bold text-lg flex items-center gap-3 shadow-[0_0_40px_rgba(220,38,38,0.35)]"
            >
              Hablar con SIM
              <ArrowRight className="group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
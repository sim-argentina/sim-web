"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Plane,
  Hotel,
  Ticket,
  ShieldCheck,
  ChevronRight,
  Flag,
  MapPin,
  Trophy,
} from "lucide-react";

export default function ViajaConSimBrasilPage() {
  const sectores = [
    {
      nombre: "G",
      descripcion:
        "Recta trasera, pasada la curva 3. Acceso a Fan Zone.",
      image: "/sectorg.jpg",
    },
    {
      nombre: "A",
      descripcion:
        "Recta principal con vista amplia de distintos sectores.",
      image: "/sectora.jpg",
    },
    {
      nombre: "R",
      descripcion:
        "Vista a Curva do Sol y parte de la salida de boxes.",
      image: "/sectorr.jpg",
    },
    {
      nombre: "H",
      descripcion:
        "Vista a la S de Senna y salida del pit lane.",
      image: "/sectorh.jpg",
    },
  ];

  return (
    <main className="bg-black text-white overflow-hidden">
      {/* HERO */}
      <section className="relative min-h-screen flex items-center">
        <Image
          src="/viaja-con-sim/senna.jpg"
          alt="GP Brasil"
          fill
          priority
          className="object-cover"
        />

        <div className="absolute inset-0 bg-black/75" />

        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,215,0,0.25),transparent_35%)]" />

        <div className="relative z-10 max-w-7xl mx-auto px-6 py-28 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-3 bg-yellow-400 text-black px-4 py-2 rounded-full font-bold text-sm mb-7">
              <Flag className="w-4 h-4" />
              VIVÍ LA F1 DONDE TODO PASA
            </div>

            <div className="flex items-center gap-4 mb-8">
              <Image
                src="/viaja-con-sim/logo-sim.png"
                alt="SIM"
                width={90}
                height={40}
                className="object-contain"
              />

              <span className="text-zinc-400 text-2xl font-light">×</span>

              <Image
                src="/viaja-con-sim/logo-tiul.png"
                alt="Tiul"
                width={90}
                height={40}
                className="object-contain"
              />
            </div>

            <h1 className="text-5xl md:text-8xl font-black leading-[0.9] tracking-tight">
              GP DE
              <br />
              <span className="text-white">BRASIL</span>
            </h1>

            <h2 className="text-4xl md:text-6xl font-black italic text-green-500 mt-2">
              INTERLAGOS 2026
            </h2>

            <div className="flex items-center gap-3 mt-8 text-lg text-zinc-300">
              <MapPin className="text-yellow-400" />
              São Paulo • 5 al 9 de Noviembre
            </div>

            <p className="mt-8 text-zinc-300 text-lg leading-relaxed max-w-xl">
              Viví el Gran Premio de Brasil junto a SIM y Tiul Sports.
              Viaje completo para sentir la Fórmula 1 desde adentro,
              en uno de los circuitos más históricos del mundo.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
              <div className="bg-black/50 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
                <Plane className="text-green-400 mb-3" />
                <p className="text-sm text-zinc-400">
                  Vuelos incluidos
                </p>
              </div>

              <div className="bg-black/50 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
                <Hotel className="text-green-400 mb-3" />
                <p className="text-sm text-zinc-400">
                  Hotel + desayuno
                </p>
              </div>

              <div className="bg-black/50 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
                <Ticket className="text-green-400 mb-3" />
                <p className="text-sm text-zinc-400">
                  Tickets F1
                </p>
              </div>

              <div className="bg-black/50 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
                <ShieldCheck className="text-green-400 mb-3" />
                <p className="text-sm text-zinc-400">
                  Asistencia viajero
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-5 mt-12">
              <Link
                href="https://wa.me/543512520927"
                target="_blank"
                className="bg-yellow-400 hover:bg-yellow-300 transition-all duration-300 text-black font-black px-8 py-5 rounded-2xl flex items-center justify-center gap-3 text-lg shadow-[0_0_40px_rgba(250,204,21,0.35)]"
              >
                CONSULTAR DISPONIBILIDAD
              </Link>

              <Link
                href="/"
                className="border border-white/10 hover:border-white/30 bg-white/5 px-8 py-5 rounded-2xl flex items-center justify-center gap-3 text-lg"
              >
                Volver al inicio
              </Link>
            </div>
          </div>

          <div className="relative hidden lg:flex justify-end">
            <div className="relative w-[620px] h-[780px]">
              <div className="absolute inset-0 bg-gradient-to-t from-green-500/20 via-yellow-500/10 to-transparent blur-3xl rounded-full" />

              <Image
                src="/senna.png"
                alt="Senna"
                fill
                className="object-contain object-bottom"
              />
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronRight className="rotate-90 w-8 h-8 text-white/60" />
        </div>
      </section>

      {/* INFO */}
      <section className="relative py-24 px-6 bg-white text-black">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <p className="text-green-600 font-black tracking-[0.3em] mb-4">
              EXPERIENCIA
            </p>

            <h2 className="text-5xl md:text-7xl font-black leading-none">
              BRASIL
              <span className="text-green-600"> TE ESPERA</span>
            </h2>

            <p className="text-zinc-600 text-lg mt-6 max-w-3xl">
              Interlagos no es solo una carrera. Es ambiente,
              historia, pasión y una de las mejores experiencias
              que puede vivir un fanático de la Fórmula 1.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            <div className="relative rounded-[32px] overflow-hidden h-[520px]">
              <Image
                src="/viaja-con-sim/interlagos-f1.jpg"
                alt="Interlagos"
                fill
                className="object-cover"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

              <div className="absolute bottom-8 left-8 right-8 text-white">
                <p className="text-green-400 font-bold mb-3">
                  CIRCUITO INTERLAGOS
                </p>

                <h3 className="text-4xl font-black mb-4">
                  Donde nació la historia.
                </h3>

                <p className="text-zinc-300 leading-relaxed">
                  La mítica S de Senna, las tribunas llenas y el
                  clima único del GP de Brasil convierten este viaje
                  en una experiencia irrepetible.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="bg-zinc-100 rounded-[28px] p-8">
                <p className="text-5xl font-black mb-3">4</p>
                <p className="text-zinc-600 font-medium">
                  Noches de hotel
                </p>
              </div>

              <div className="bg-zinc-100 rounded-[28px] p-8">
                <p className="text-5xl font-black mb-3">3</p>
                <p className="text-zinc-600 font-medium">
                  Días de Fórmula 1
                </p>
              </div>

              <div className="bg-zinc-100 rounded-[28px] p-8">
                <p className="text-5xl font-black mb-3">250+</p>
                <p className="text-zinc-600 font-medium">
                  Personas viajaron
                </p>
              </div>

              <div className="bg-zinc-100 rounded-[28px] p-8">
                <Trophy className="w-10 h-10 mb-4 text-green-600" />

                <p className="text-zinc-600 font-medium">
                  Experiencia premium F1
                </p>
              </div>

              <div className="col-span-2 bg-black text-white rounded-[28px] p-10 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-green-500/20 to-yellow-500/10" />

                <div className="relative z-10">
                  <p className="text-green-400 font-black tracking-[0.25em] text-sm mb-5">
                    IMPORTANTE
                  </p>

                  <h3 className="text-3xl font-black mb-5">
                    CUPOS LIMITADOS
                  </h3>

                  <p className="text-zinc-300 leading-relaxed">
                    El viaje se maneja con preventa y disponibilidad
                    limitada. La experiencia incluye coordinación en
                    destino y acompañamiento durante el evento.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTORES */}
      <section className="bg-black py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <p className="text-yellow-400 font-black tracking-[0.3em] mb-4">
              SECTORES
            </p>

            <h2 className="text-5xl md:text-7xl font-black">
              ELEGÍ TU
              <span className="text-yellow-400"> EXPERIENCIA</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {sectores.map((sector) => (
              <div
                key={sector.nombre}
                className="bg-zinc-950 border border-white/10 rounded-[28px] overflow-hidden group"
              >
                <div className="relative h-[240px] overflow-hidden">
                  <Image
                    src={sector.image}
                    alt={sector.nombre}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-700"
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />

                  <div className="absolute bottom-5 left-5">
                    <div className="w-14 h-14 rounded-full bg-yellow-400 text-black flex items-center justify-center text-2xl font-black">
                      {sector.nombre}
                    </div>
                  </div>
                </div>

                <div className="p-6">
                  <p className="text-zinc-300 leading-relaxed">
                    {sector.descripcion}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="relative py-28 px-6 overflow-hidden">
        <Image
          src="/viaja-con-sim/bandera-brasil.jpg"
          alt="Brasil"
          fill
          className="object-cover opacity-20"
        />

        <div className="absolute inset-0 bg-black/80" />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <p className="text-green-500 font-black tracking-[0.3em] mb-6">
            VIAJÁ CON SIM
          </p>

          <h2 className="text-5xl md:text-8xl font-black leading-[0.9]">
            NO ES LO MISMO
            <br />
            SIMULARLO
            <br />
            QUE
            <span className="text-yellow-400"> VIVIRLO</span>
          </h2>

          <p className="text-zinc-300 text-xl leading-relaxed max-w-3xl mx-auto mt-10">
            Formá parte del viaje al GP de Brasil 2026 y viví la
            Fórmula 1 como nunca antes.
          </p>

          <Link
            href="https://wa.me/543512520927"
            target="_blank"
            className="inline-flex mt-12 bg-yellow-400 hover:bg-yellow-300 transition-all duration-300 text-black font-black px-10 py-6 rounded-2xl text-xl shadow-[0_0_50px_rgba(250,204,21,0.35)]"
          >
            HABLAR POR WHATSAPP
          </Link>
        </div>
      </section>
    </main>
  );
}
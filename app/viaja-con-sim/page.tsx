"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Plane,
  BedDouble,
  Ticket,
  ShieldCheck,
  MapPin,
  CalendarDays,
  ArrowRight,
  Users,
  Star,
  Trophy,
  CreditCard,
  CheckCircle2,
  Flag,
  Route,
  Gauge,
} from "lucide-react";

export default function ViajaConSimPage() {
  const sectores = [
    ["G", "RECTA TRASERA", "Pasada la curva 3. Acceso a Fan Zone.", "green"],
    ["A", "RECTA PRINCIPAL", "Vista amplia de distintos sectores.", "yellow"],
    ["R", "CURVA DO SOL", "Inicio de recta trasera y zona técnica.", "green"],
    ["H", "S DE SENNA", "La zona más icónica del circuito.", "yellow"],
    ["M", "CURVA 1", "Ideal para ver maniobras y sobrepasos.", "green"],
    ["D", "LARGADA", "Final de recta principal e inicio de la S.", "yellow"],
  ];

  return (
    <main className="min-h-screen bg-black text-white overflow-hidden">
      {/* HERO */}
      <section className="relative px-6 pt-28 pb-20 overflow-hidden">
        <Image
          src="/interlagos-race.png"
          alt="Formula 1 Interlagos"
          fill
          priority
          className="object-cover opacity-45"
        />

        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/25" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black" />

        <Image
          src="/carbon.jpg"
          alt="Carbon texture"
          fill
          className="object-cover opacity-20 mix-blend-overlay"
        />

        <div className="absolute right-0 top-0 w-[760px] h-full opacity-60">
          <Image
            src="/brasil-flag.jpg"
            alt="Bandera Brasil"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-l from-transparent via-black/40 to-black" />
        </div>

        <div className="absolute right-8 top-28 hidden lg:block w-[310px] h-[430px] opacity-75 grayscale">
          <Image src="/senna.jpg" alt="Senna" fill className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/20" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-3 bg-yellow-400 text-black px-5 py-3 rounded-sm font-black text-sm mb-8">
              <Flag className="w-4 h-4" />
              VIVÍ LA F1 DONDE TODO PASA
            </div>

            <div className="flex items-center gap-4 mb-8">
              <span className="text-3xl font-black italic">SIM</span>
              <span className="text-zinc-500 text-xl">×</span>
              <span className="text-2xl font-black">
                Tiul<span className="text-sm ml-1">sports</span>
              </span>
            </div>

            <h1 className="text-6xl md:text-8xl lg:text-[8.5rem] font-black leading-[0.82]">
              GP DE
              <br />
              BRASIL
            </h1>

            <h2 className="mt-5 text-5xl md:text-7xl font-black italic leading-none">
              <span className="text-green-500">INTERLAGOS</span>{" "}
              <span className="text-yellow-400">2026</span>
            </h2>

            <div className="mt-8 flex flex-wrap gap-6 text-zinc-300 font-semibold">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-yellow-400" />
                São Paulo
              </div>

              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-yellow-400" />
                5 al 9 de noviembre
              </div>
            </div>

            <p className="mt-8 max-w-xl text-zinc-300 text-lg leading-relaxed">
              Viví el Gran Premio de Brasil con SIM y Tiul Sports. Un viaje
              pensado para disfrutar la Fórmula 1 desde adentro, en uno de los
              circuitos más históricos del mundo.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="https://wa.me/543512520927"
                target="_blank"
                className="bg-yellow-400 hover:bg-yellow-300 text-black px-8 py-5 rounded-2xl font-black flex items-center justify-center gap-3 transition shadow-[0_0_45px_rgba(250,204,21,0.35)]"
              >
                CONSULTAR DISPONIBILIDAD
                <ArrowRight className="w-5 h-5" />
              </Link>

              <a
                href="#sectores"
                className="border border-white/20 bg-white/10 hover:bg-white/15 px-8 py-5 rounded-2xl font-black flex items-center justify-center"
              >
                VER SECTORES
              </a>
            </div>
          </div>

          <div className="relative mt-16 rounded-[28px] border border-yellow-400/30 bg-black/70 backdrop-blur-xl overflow-hidden grid md:grid-cols-4">
            {[
              [Plane, "VUELOS", "Salidas desde distintas ciudades."],
              [BedDouble, "HOTEL", "4 noches con desayuno."],
              [Ticket, "TICKETS F1", "Entrada para los 3 días."],
              [ShieldCheck, "ASISTENCIA", "Acompañamiento al viajero."],
            ].map(([Icon, title, text]: any, i) => (
              <div
                key={title}
                className={`p-7 flex gap-5 ${
                  i !== 3 ? "md:border-r border-white/10" : ""
                }`}
              >
                <Icon className="w-10 h-10 text-green-400 shrink-0" />
                <div>
                  <h3 className="font-black mb-1">{title}</h3>
                  <p className="text-sm text-zinc-400">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INTERLAGOS */}
      <section className="relative px-6 py-24 border-t border-white/10">
        <Image
          src="/carbon.jpg"
          alt="Carbon"
          fill
          className="object-cover opacity-10"
        />

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-[0.75fr_1.25fr] gap-14 items-center">
          <div>
            <p className="text-green-400 font-black tracking-[0.25em] mb-5">
              CIRCUITO
            </p>

            <h2 className="text-5xl md:text-7xl font-black leading-none mb-8">
              INTERLAGOS
            </h2>

            <p className="text-zinc-300 leading-relaxed text-lg mb-10">
              Un circuito icónico donde la destreza técnica, la velocidad y la
              presión se combinan en cada vuelta. La S de Senna, la Curva do Sol
              y la Subida dos Boxes hacen que este GP sea especial.
            </p>

            <div className="grid grid-cols-3 gap-5">
              <div>
                <Route className="w-8 h-8 text-green-400 mb-3" />
                <p className="text-3xl font-black">4.309 m</p>
                <p className="text-xs text-zinc-500 font-bold">LONGITUD</p>
              </div>

              <div>
                <Gauge className="w-8 h-8 text-green-400 mb-3" />
                <p className="text-3xl font-black">71</p>
                <p className="text-xs text-zinc-500 font-bold">VUELTAS</p>
              </div>

              <div>
                <Trophy className="w-8 h-8 text-yellow-400 mb-3" />
                <p className="text-3xl font-black">1973</p>
                <p className="text-xs text-zinc-500 font-bold">DESDE</p>
              </div>
            </div>
          </div>

          <div className="relative h-[560px] rounded-[44px] border border-white/10 bg-white/[0.03] overflow-hidden p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.18),transparent_45%)]" />

            <Image
              src="/interlagos-map.webp"
              alt="Mapa Interlagos"
              fill
              className="object-contain p-10 invert brightness-200 opacity-75"
            />

            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/20" />

            <div className="absolute left-10 bottom-10">
              <p className="text-green-400 font-black tracking-[0.2em] text-sm">
                TRACK MAP
              </p>
              <h3 className="text-4xl font-black">SÃO PAULO</h3>
            </div>
          </div>
        </div>
      </section>

      {/* SECTORES */}
      <section id="sectores" className="px-6 py-24 border-t border-white/10">
        <div className="max-w-7xl mx-auto">
          <p className="text-green-400 font-black tracking-[0.25em] mb-5">
            SECTORES
          </p>

          <h2 className="text-5xl md:text-6xl font-black leading-none mb-12">
            ELEGÍ TU EXPERIENCIA
          </h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-5">
            {sectores.map(([letra, nombre, texto, color]) => (
              <div
                key={letra}
                className="group rounded-[24px] border border-white/10 bg-white/[0.04] overflow-hidden hover:-translate-y-2 transition-all duration-300"
              >
                <div className="relative h-44 bg-gradient-to-br from-zinc-900 to-black overflow-hidden">
                  <Image
                    src="/interlagos-race.png"
                    alt="Interlagos"
                    fill
                    className="object-cover opacity-45 group-hover:scale-110 transition duration-700"
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />

                  <div
                    className={`absolute left-5 bottom-4 w-12 h-12 rounded-full flex items-center justify-center text-black font-black text-2xl ${
                      color === "green" ? "bg-green-500" : "bg-yellow-400"
                    }`}
                  >
                    {letra}
                  </div>
                </div>

                <div className="p-5">
                  <h3 className="font-black uppercase mb-3">{nombre}</h3>

                  <p className="text-sm text-zinc-400 leading-relaxed min-h-[90px]">
                    {texto}
                  </p>

                  <div
                    className={`mt-5 h-1 w-16 ${
                      color === "green" ? "bg-green-500" : "bg-yellow-400"
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EXPERIENCIA */}
      <section className="relative px-6 py-24 border-t border-white/10 overflow-hidden">
        <Image
          src="/brasil-flag.jpg"
          alt="Brasil"
          fill
          className="object-cover opacity-10"
        />

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-3 gap-8 items-center">
          <div>
            <p className="text-green-400 font-black tracking-[0.18em] mb-5">
              ¿POR QUÉ VIAJAR CON SIM?
            </p>

            <h2 className="text-5xl font-black leading-none mb-8">
              EXPERIENCIA
              <br />
              GARANTIZADA
            </h2>

            <div className="space-y-4">
              {[
                "Coordinación en destino.",
                "Acompañamiento durante todo el viaje.",
                "Información detallada del circuito.",
                "Grupo exclusivo de viajeros SIM.",
              ].map((item) => (
                <div key={item} className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                  <p className="text-zinc-300">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-green-500/50 bg-black/80 p-10 text-center shadow-[0_0_50px_rgba(34,197,94,0.12)]">
            <Users className="w-14 h-14 text-green-400 mx-auto mb-5" />

            <p className="text-7xl font-black">250+</p>

            <p className="font-black mt-2">PERSONAS YA VIAJARON CON TIUL</p>

            <div className="flex justify-center gap-2 mt-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className="w-6 h-6 fill-yellow-400 text-yellow-400"
                />
              ))}
            </div>
          </div>

          <div className="relative rounded-[32px] border border-white/10 bg-black/70 p-8 overflow-hidden">
            <p className="text-6xl text-green-400 leading-none">“</p>

            <p className="text-2xl text-zinc-200 italic leading-relaxed">
              El año pasado vivimos una experiencia increíble. Organización,
              grupo y pasión por la F1 en cada detalle.
            </p>
          </div>
        </div>
      </section>

      {/* RESERVA */}
      <section className="px-6 pb-24">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-8">
          <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-9">
            <p className="text-green-400 font-black tracking-[0.2em] mb-6">
              CÓMO RESERVAR
            </p>

            <div className="space-y-5">
              {[
                "Seña por pasajero para confirmar la reserva.",
                "Cuotas mensuales o pago total del saldo.",
                "Pago total antes de la fecha límite.",
                "La preventa es hasta agotar stock.",
              ].map((text) => (
                <div key={text} className="flex gap-4">
                  <CheckCircle2 className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-zinc-300">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-9">
            <p className="text-green-400 font-black tracking-[0.2em] mb-6">
              FORMAS DE PAGO
            </p>

            <div className="space-y-5">
              {[
                "Efectivo en sucursales Tiul.",
                "Transferencia o depósito en dólares.",
                "Tarjeta de crédito en dólares.",
              ].map((text) => (
                <div key={text} className="flex gap-4">
                  <CreditCard className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-zinc-300">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* AUTO */}
      <section className="relative px-6 pb-24">
        <div className="max-w-7xl mx-auto relative h-[360px] rounded-[44px] border border-white/10 bg-gradient-to-r from-black via-zinc-950 to-black overflow-hidden">
          <Image
            src="/carbon.jpg"
            alt="Carbon"
            fill
            className="object-cover opacity-20"
          />

          <Image
            src="/f1-car.png"
            alt="F1 Car"
            width={850}
            height={360}
            className="absolute right-[-40px] bottom-[-20px] object-contain drop-shadow-[0_0_60px_rgba(250,204,21,0.22)]"
          />

          <div className="absolute left-10 top-10 max-w-xl">
            <p className="text-green-400 font-black tracking-[0.2em] mb-4">
              SIM + TIUL SPORTS
            </p>

            <h2 className="text-5xl font-black leading-none">
              BRASIL
              <br />
              TE ESPERA
            </h2>
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="relative px-6 py-10 bg-gradient-to-r from-green-600 via-yellow-400 to-yellow-500 text-black">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-8">
          <div>
            <p className="text-5xl font-black leading-none">
              NO ES LO MISMO
            </p>

            <p className="font-black mt-2 text-lg">
              SIMULARLO QUE VIVIRLO.
            </p>
          </div>

          <Link
            href="https://wa.me/543512520927"
            target="_blank"
            className="bg-black hover:bg-zinc-900 text-white px-9 py-5 rounded-2xl font-black flex items-center justify-center gap-3 transition"
          >
            HABLAR POR WHATSAPP
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </main>
  );
}
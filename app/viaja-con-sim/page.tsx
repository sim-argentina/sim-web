"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Plane,
  Hotel,
  Ticket,
  ShieldCheck,
  MapPin,
  CalendarDays,
  ArrowRight,
  CheckCircle2,
  Star,
  Users,
  Trophy,
  CreditCard,
  Route,
  Timer,
  Flag,
  Luggage,
  Bus,
} from "lucide-react";

export default function ViajaConSimPage() {
  const includes = [
    ["Vuelos con carry on", "Salidas desde Bs. As., Córdoba, Rosario y Mendoza.", Plane],
    ["4 noches de hotel", "Alojamiento con desayuno del 5 al 9 de noviembre.", Hotel],
    ["Tickets F1", "Entrada para los 3 días del Gran Premio.", Ticket],
    ["Traslados", "Traslados al circuito según paquete elegido.", Bus],
    ["Asistencia", "Asistencia al viajero durante la experiencia.", ShieldCheck],
    ["Kit de regalo", "Detalle especial para vivir el viaje desde el inicio.", Luggage],
  ];

  const packages = [
    {
      title: "Full Centro",
      subtitle: "Hotel en zona céntrica",
      text: "Una opción completa para quienes quieren vivir el viaje con todo resuelto: vuelos, hotel, tickets, traslados y asistencia.",
    },
    {
      title: "Full Berrini",
      subtitle: "Próximo a Interlagos",
      text: "Pensado para quienes priorizan estar mejor ubicados para moverse hacia el circuito durante el fin de semana.",
    },
    {
      title: "Alternativo",
      subtitle: "Más independencia",
      text: "Ideal para pasajeros que prefieren manejar sus horarios y moverse con mayor libertad durante el evento.",
    },
  ];

  const sectors = [
    ["G", "Recta trasera", "Pasada la curva 3. Acceso a Fan Zone."],
    ["A", "Recta principal", "Vista amplia de distintos sectores del circuito."],
    ["R", "Curva do Sol", "Zona técnica e inicio de recta trasera."],
    ["H", "S de Senna", "Una de las vistas más icónicas de Interlagos."],
    ["M", "Curva 1", "Ideal para ver maniobras, frenajes y sobrepasos."],
    ["D", "Largada", "Final de recta principal e inicio de la S de Senna."],
  ];

  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-hidden">
      {/* HERO */}
      <section className="relative min-h-screen px-6 pt-28 pb-20 flex items-center">
        <Image
          src="/interlagos-race.webp"
          alt="GP Brasil Interlagos"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-65"
        />

        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/25" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black" />

        <div className="relative z-10 max-w-7xl mx-auto w-full">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-3 bg-yellow-400 text-black px-5 py-3 rounded-full font-black text-sm mb-8">
              <Flag className="w-4 h-4" />
              VIVÍ LA F1 DONDE TODO PASA
            </div>

            <div className="flex items-center gap-4 mb-8">
              <span className="text-4xl font-black italic">SIM</span>
              <span className="text-zinc-500 text-2xl">×</span>
              <span className="text-3xl font-black">
                Tiul<span className="text-sm ml-1">sports</span>
              </span>
            </div>

            <h1 className="text-6xl md:text-8xl lg:text-[9rem] font-black leading-[0.8] tracking-tight">
              GP DE
              <br />
              BRASIL
            </h1>

            <h2 className="mt-5 text-5xl md:text-7xl font-black italic leading-none">
              <span className="text-green-500">INTERLAGOS</span>{" "}
              <span className="text-yellow-400">2026</span>
            </h2>

            <div className="mt-8 flex flex-wrap gap-5 text-zinc-200 font-semibold">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-yellow-400" />
                São Paulo
              </div>

              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-yellow-400" />
                5 al 9 de noviembre
              </div>
            </div>

            <p className="mt-8 max-w-2xl text-zinc-300 text-lg leading-relaxed">
              Viví el Gran Premio de Brasil con SIM y Tiul Sports. Un viaje
              completo para disfrutar la Fórmula 1 desde adentro, en uno de los
              circuitos más históricos y pasionales del calendario.
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
                href="#paquetes"
                className="border border-white/20 bg-white/10 hover:bg-white/15 px-8 py-5 rounded-2xl font-black flex items-center justify-center"
              >
                VER DETALLES
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* NUMBERS */}
      <section className="relative px-6 -mt-12 z-20">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 rounded-[30px] border border-yellow-400/30 bg-black/90 backdrop-blur-xl overflow-hidden">
          {[
            ["4", "noches de hotel"],
            ["3", "días de F1"],
            ["5-9", "noviembre"],
            ["250+", "personas ya viajaron"],
          ].map(([num, label], i) => (
            <div
              key={label}
              className={`p-8 text-center ${
                i !== 3 ? "md:border-r border-white/10" : ""
              }`}
            >
              <p className="text-5xl font-black">{num}</p>
              <p className="text-zinc-400 uppercase text-sm font-bold mt-2">
                {label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* INCLUDES */}
      <section className="px-6 py-28">
        <div className="max-w-7xl mx-auto">
          <p className="text-green-400 font-black tracking-[0.25em] mb-5">
            TODO INCLUIDO
          </p>

          <h2 className="text-5xl md:text-7xl font-black leading-none mb-6">
            VIAJÁ SIN
            <br />
            IMPROVISAR
          </h2>

          <p className="text-zinc-400 text-lg max-w-3xl leading-relaxed mb-14">
            La experiencia está pensada para que el viaje no dependa de resolver
            todo por separado. La idea es que llegues a São Paulo con la carrera,
            el alojamiento y la logística organizada.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {includes.map(([title, text, Icon]: any) => (
              <div
                key={title}
                className="rounded-[30px] border border-white/10 bg-white/[0.035] p-8 hover:bg-white/[0.06] transition"
              >
                <Icon className="w-10 h-10 text-green-400 mb-7" />
                <h3 className="text-2xl font-black mb-3">{title}</h3>
                <p className="text-zinc-400 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INTERLAGOS */}
      <section className="relative px-6 py-28 border-y border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_45%,rgba(34,197,94,0.18),transparent_35%)]" />

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <p className="text-yellow-400 font-black tracking-[0.25em] mb-5">
              CIRCUITO
            </p>

            <h2 className="text-5xl md:text-7xl font-black leading-none mb-8">
              INTERLAGOS
              <br />
              NO PERDONA
            </h2>

            <p className="text-zinc-300 text-lg leading-relaxed mb-8">
              Interlagos combina historia, desniveles, sectores técnicos y un
              ambiente único. La S de Senna, la Curva do Sol y la Subida dos
              Boxes hacen que cada vuelta tenga ritmo, tensión y oportunidades
              de maniobra.
            </p>

            <p className="text-zinc-400 leading-relaxed mb-10">
              Es uno de esos circuitos donde la carrera se vive distinto:
              tribunas intensas, clima sudamericano y una conexión especial con
              la historia de la Fórmula 1.
            </p>

            <div className="grid grid-cols-3 gap-5">
              <div className="rounded-2xl border border-white/10 bg-black/60 p-5">
                <Route className="w-8 h-8 text-green-400 mb-4" />
                <p className="text-3xl font-black">4.309 m</p>
                <p className="text-xs text-zinc-500 font-bold">LONGITUD</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/60 p-5">
                <Timer className="w-8 h-8 text-green-400 mb-4" />
                <p className="text-3xl font-black">71</p>
                <p className="text-xs text-zinc-500 font-bold">VUELTAS</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/60 p-5">
                <Trophy className="w-8 h-8 text-yellow-400 mb-4" />
                <p className="text-3xl font-black">1973</p>
                <p className="text-xs text-zinc-500 font-bold">DESDE</p>
              </div>
            </div>
          </div>

          <div className="relative h-[560px] rounded-[44px] overflow-hidden border border-white/10">
            <Image
              src="/brasil-flag.jpg"
              alt="Bandera de Brasil"
              fill
              className="object-cover"
            />

            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />

            <div className="absolute bottom-10 left-10 right-10">
              <p className="text-green-400 font-black tracking-[0.25em] text-sm mb-4">
                BRASIL TE ESPERA
              </p>

              <h3 className="text-5xl font-black leading-none">
                NO ES LO MISMO
                <br />
                SIMULARLO
                <br />
                <span className="text-yellow-400">QUE VIVIRLO</span>
              </h3>
            </div>
          </div>
        </div>
      </section>

      {/* PACKAGES */}
      <section id="paquetes" className="px-6 py-28">
        <div className="max-w-7xl mx-auto">
          <p className="text-green-400 font-black tracking-[0.25em] mb-5">
            PAQUETES
          </p>

          <h2 className="text-5xl md:text-7xl font-black leading-none mb-14">
            ELEGÍ CÓMO
            <br />
            QUERÉS VIAJAR
          </h2>

          <div className="grid lg:grid-cols-3 gap-6">
            {packages.map((pack, i) => (
              <div
                key={pack.title}
                className={`rounded-[34px] border p-8 ${
                  i === 1
                    ? "border-yellow-400/50 bg-yellow-400/10"
                    : "border-white/10 bg-white/[0.035]"
                }`}
              >
                <p
                  className={`font-black tracking-[0.2em] text-sm mb-4 ${
                    i === 1 ? "text-yellow-400" : "text-green-400"
                  }`}
                >
                  OPCIÓN {i + 1}
                </p>

                <h3 className="text-3xl font-black mb-2">{pack.title}</h3>
                <p className="text-zinc-400 mb-6">{pack.subtitle}</p>
                <p className="text-zinc-300 leading-relaxed mb-8">{pack.text}</p>

                <Link
                  href="https://wa.me/543512520927"
                  target="_blank"
                  className="inline-flex w-full justify-center bg-white text-black hover:bg-yellow-400 px-6 py-4 rounded-2xl font-black transition"
                >
                  CONSULTAR OPCIÓN
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTORS */}
      <section className="px-6 py-28 border-t border-white/10">
        <div className="max-w-7xl mx-auto">
          <p className="text-yellow-400 font-black tracking-[0.25em] mb-5">
            SECTORES DEL CIRCUITO
          </p>

          <h2 className="text-5xl md:text-7xl font-black leading-none mb-14">
            ELEGÍ TU LUGAR
            <br />
            EN LA ACCIÓN
          </h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sectors.map(([code, name, text], i) => (
              <div
                key={code}
                className="rounded-[30px] border border-white/10 bg-white/[0.035] p-8 hover:-translate-y-2 transition"
              >
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center text-black text-3xl font-black mb-8 ${
                    i % 2 === 0 ? "bg-green-500" : "bg-yellow-400"
                  }`}
                >
                  {code}
                </div>

                <h3 className="text-2xl font-black mb-4">{name}</h3>

                <p className="text-zinc-400 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RESERVA */}
      <section className="px-6 py-28 border-t border-white/10">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-8">
          <div className="rounded-[36px] border border-white/10 bg-white/[0.035] p-10">
            <p className="text-green-400 font-black tracking-[0.25em] mb-5">
              CÓMO RESERVAR
            </p>

            <h2 className="text-5xl font-black leading-none mb-8">
              ASEGURÁ
              <br />
              TU LUGAR
            </h2>

            {[
              "La reserva se confirma con una seña por pasajero.",
              "El saldo puede abonarse en cuotas mensuales o pago total.",
              "La preventa se mantiene hasta agotar stock.",
            ].map((text) => (
              <div key={text} className="flex gap-4 mb-5">
                <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0" />
                <p className="text-zinc-300">{text}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[36px] border border-yellow-400/30 bg-yellow-400/10 p-10">
            <p className="text-yellow-400 font-black tracking-[0.25em] mb-5">
              FORMAS DE PAGO
            </p>

            <h2 className="text-5xl font-black leading-none mb-8">
              SIMPLE Y
              <br />
              FLEXIBLE
            </h2>

            {[
              "Efectivo en sucursales Tiul.",
              "Transferencia o depósito en dólares.",
              "Tarjeta de crédito con consumo en dólares.",
            ].map((text) => (
              <div key={text} className="flex gap-4 mb-5">
                <CreditCard className="w-6 h-6 text-yellow-400 shrink-0" />
                <p className="text-zinc-300">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section className="relative px-6 py-24 overflow-hidden">
        <Image
          src="/brasil-flag.jpg"
          alt="Brasil"
          fill
          className="object-cover opacity-12"
        />

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-3 gap-8 items-center">
          <div>
            <p className="text-green-400 font-black tracking-[0.18em] mb-5">
              EXPERIENCIA REAL
            </p>

            <h2 className="text-5xl font-black leading-none">
              YA LO VIVIERON
              <br />
              MÁS DE 250
              <br />
              PERSONAS
            </h2>
          </div>

          <div className="rounded-[34px] border border-green-500/40 bg-black/75 p-10 text-center">
            <Users className="w-16 h-16 text-green-400 mx-auto mb-5" />
            <p className="text-7xl font-black">250+</p>
            <p className="font-black mt-3">PERSONAS YA VIAJARON CON TIUL</p>

            <div className="flex justify-center gap-2 mt-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className="w-6 h-6 fill-yellow-400 text-yellow-400"
                />
              ))}
            </div>
          </div>

          <div className="rounded-[34px] border border-white/10 bg-black/75 p-10">
            <p className="text-6xl text-green-400 leading-none">“</p>

            <p className="text-2xl italic leading-relaxed text-zinc-200">
              Una experiencia pensada para que solo tengas que disfrutar la F1:
              viaje, organización, grupo y acompañamiento.
            </p>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative px-6 py-14 bg-gradient-to-r from-green-600 via-yellow-400 to-yellow-500 text-black">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-8">
          <div>
            <p className="text-5xl md:text-6xl font-black leading-none">
              BRASIL TE ESPERA
            </p>

            <p className="font-black mt-3 text-lg">
              No es lo mismo simularlo que vivirlo.
            </p>
          </div>

          <Link
            href="https://wa.me/543512520927"
            target="_blank"
            className="bg-black hover:bg-zinc-900 text-white px-10 py-6 rounded-2xl font-black flex items-center justify-center gap-3 transition"
          >
            HABLAR POR WHATSAPP
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </main>
  );
}
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
  Info,
  Luggage,
  Bus,
  MapPinned,
} from "lucide-react";

export default function ViajaConSimPage() {
  const includes = [
    {
      icon: Plane,
      title: "Vuelos con carry on",
      text: "Salidas disponibles desde Buenos Aires, Córdoba, Rosario y Mendoza.",
    },
    {
      icon: Hotel,
      title: "4 noches de hotel",
      text: "Alojamiento con desayuno del 5 al 9 de noviembre.",
    },
    {
      icon: Ticket,
      title: "Tickets F1",
      text: "Entradas para los 3 días del Gran Premio en el sector elegido.",
    },
    {
      icon: Bus,
      title: "Traslados al circuito",
      text: "Opciones con traslados incluidos según el paquete seleccionado.",
    },
    {
      icon: ShieldCheck,
      title: "Asistencia al viajero",
      text: "Cobertura y acompañamiento para viajar con más tranquilidad.",
    },
    {
      icon: Luggage,
      title: "Kit de regalo",
      text: "Un detalle especial para que vivas la experiencia desde el primer momento.",
    },
  ];

  const sectors = [
    {
      code: "G",
      name: "Recta trasera",
      detail:
        "Pasada la curva 3. Sector con acceso a Fan Zone y ambiente ideal para vivir el ritmo de carrera.",
      tone: "green",
    },
    {
      code: "A",
      name: "Recta principal",
      detail:
        "Vista amplia del circuito. Una ubicación elevada para ver autos en distintos sectores.",
      tone: "yellow",
    },
    {
      code: "R",
      name: "Curva do Sol",
      detail:
        "Inicio de la recta trasera, con vista a una zona técnica y parte de la salida de boxes.",
      tone: "green",
    },
    {
      code: "H",
      name: "S de Senna",
      detail:
        "Una de las ubicaciones más icónicas: S de Senna, recta trasera y salida del pit lane.",
      tone: "yellow",
    },
    {
      code: "M",
      name: "Curva 1",
      detail:
        "Zona premium para ver frenajes, ataques, defensas y maniobras de sobrepaso.",
      tone: "green",
    },
    {
      code: "D",
      name: "Largada",
      detail:
        "Final de recta principal e inicio de la S de Senna. Vista directa de momentos clave.",
      tone: "yellow",
    },
  ];

  const packages = [
    {
      title: "Paquete Full Centro",
      subtitle: "Hotel en zona céntrica",
      items: [
        "Hotel Delplaza Excelsior o similar.",
        "Incluye vuelos, hotel, tickets F1, traslados y asistencia.",
        "Ideal para quienes buscan una experiencia completa y acompañada.",
      ],
    },
    {
      title: "Paquete Full Berrini",
      subtitle: "Próximo a Interlagos",
      items: [
        "Hotel Intercity Berrini o similar.",
        "Ubicación estratégica para moverse hacia el circuito.",
        "Pensado para vivir el GP con mayor cercanía al evento.",
      ],
    },
    {
      title: "Paquete Alternativo",
      subtitle: "Más independencia",
      items: [
        "Hotel Park Inn by Radisson Berrini o similar.",
        "Opción para quienes prefieren manejar sus horarios.",
        "Cercanía a estación de tren con conexión al autódromo.",
      ],
    },
  ];

  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-hidden">
      {/* HERO */}
      <section className="relative min-h-[92vh] px-6 pt-28 pb-20 flex items-center overflow-hidden">
        <Image
          src="/interlagos-race.png"
          alt="GP Brasil Interlagos"
          fill
          priority
          className="object-cover opacity-55"
        />

        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/90 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black" />

        <Image
          src="/carbon.jpg"
          alt="Carbono"
          fill
          className="object-cover opacity-25 mix-blend-overlay"
        />

        <div className="absolute right-[-120px] top-[-120px] w-[720px] h-[720px] rounded-full border-[90px] border-yellow-400/10" />
        <div className="absolute right-[70px] bottom-[-180px] w-[620px] h-[620px] rounded-full border-[80px] border-green-500/10" />

        <div className="relative z-10 max-w-7xl mx-auto w-full grid lg:grid-cols-[1fr_0.85fr] gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-3 bg-yellow-400 text-black px-5 py-3 rounded-full font-black text-sm mb-8 shadow-[0_0_45px_rgba(250,204,21,0.35)]">
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

            <h1 className="text-6xl md:text-8xl lg:text-[8.8rem] font-black leading-[0.8] tracking-tight">
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
              Una experiencia completa para vivir el Gran Premio de Brasil
              desde adentro: vuelos, hotel, tickets para los tres días,
              asistencia y opciones de paquete según tu forma de viajar.
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
                VER DETALLES DEL VIAJE
              </a>
            </div>
          </div>

          <div className="relative hidden lg:block">
            <div className="relative h-[620px] rounded-[44px] overflow-hidden border border-white/10 bg-black/45 backdrop-blur">
              <Image
                src="/brasil-flag.jpg"
                alt="Brasil"
                fill
                className="object-cover opacity-55"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />

              <div className="absolute bottom-8 left-8 right-8">
                <p className="text-green-400 font-black tracking-[0.25em] text-sm mb-4">
                  F1 EXPERIENCE
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

            <Image
              src="/f1-car.png"
              alt="F1"
              width={760}
              height={360}
              className="absolute -bottom-12 -right-28 drop-shadow-[0_0_55px_rgba(250,204,21,0.35)]"
            />
          </div>
        </div>
      </section>

      {/* QUICK INFO */}
      <section className="relative px-6 -mt-10 z-20">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 rounded-[30px] border border-yellow-400/30 bg-black/85 backdrop-blur-xl overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.6)]">
          {[
            ["4", "noches de hotel"],
            ["3", "días de Fórmula 1"],
            ["5-9", "noviembre 2026"],
            ["250+", "personas ya viajaron"],
          ].map(([number, text], index) => (
            <div
              key={text}
              className={`p-8 text-center ${
                index !== 3 ? "md:border-r border-white/10" : ""
              }`}
            >
              <p className="text-5xl font-black text-white">{number}</p>
              <p className="text-zinc-400 uppercase text-sm font-bold mt-2">
                {text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* INCLUDES */}
      <section className="px-6 py-28">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-3xl mb-14">
            <p className="text-green-400 font-black tracking-[0.25em] mb-5">
              TODO INCLUIDO
            </p>

            <h2 className="text-5xl md:text-7xl font-black leading-none mb-6">
              VIAJÁ SIN
              <br />
              IMPROVISAR
            </h2>

            <p className="text-zinc-400 text-lg leading-relaxed">
              La idea es simple: que tengas el viaje armado y puedas enfocarte
              en lo importante: vivir el ambiente de Interlagos, la carrera y
              la experiencia completa de Fórmula 1.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {includes.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className="group rounded-[30px] border border-white/10 bg-white/[0.035] p-8 hover:bg-white/[0.06] transition"
                >
                  <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-7 group-hover:scale-110 transition">
                    <Icon className="w-8 h-8 text-green-400" />
                  </div>

                  <h3 className="text-2xl font-black mb-3">{item.title}</h3>

                  <p className="text-zinc-400 leading-relaxed">{item.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* INTERLAGOS */}
      <section className="relative px-6 py-28 border-y border-white/10 overflow-hidden">
        <Image
          src="/carbon.jpg"
          alt="Carbono"
          fill
          className="object-cover opacity-15"
        />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_50%,rgba(34,197,94,0.18),transparent_35%),radial-gradient(circle_at_85%_20%,rgba(250,204,21,0.12),transparent_30%)]" />

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-[0.85fr_1.15fr] gap-14 items-center">
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
              Interlagos es uno de esos circuitos donde la carrera se siente
              distinta. Tiene zonas rápidas, sectores técnicos, desniveles,
              historia y una energía muy particular por la pasión brasileña.
            </p>

            <p className="text-zinc-400 leading-relaxed mb-10">
              La S de Senna, la Curva do Sol, el Bico de Pato y la Subida dos
              Boxes hacen que cada vuelta tenga tensión, ritmo y oportunidades
              de maniobra. Por eso el GP de Brasil suele regalar carreras
              intensas.
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

          <div className="relative h-[620px] rounded-[44px] border border-white/10 bg-black/65 overflow-hidden p-8">
            <Image
              src="/interlagos-map.webp"
              alt="Mapa Interlagos"
              fill
              className="object-contain p-10 invert brightness-200 opacity-80"
            />

            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/20" />

            <div className="absolute left-10 bottom-10 right-10 flex items-end justify-between gap-8">
              <div>
                <p className="text-green-400 font-black tracking-[0.25em] text-sm mb-3">
                  TRACK MAP
                </p>

                <h3 className="text-4xl md:text-5xl font-black leading-none">
                  AUTÓDROMO
                  <br />
                  JOSÉ CARLOS PACE
                </h3>
              </div>

              <div className="hidden md:block text-right text-zinc-400 max-w-xs">
                La pista donde la técnica, la presión y el clima de carrera se
                mezclan como en pocos lugares.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PACKAGES */}
      <section id="paquetes" className="px-6 py-28">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-14">
            <div>
              <p className="text-green-400 font-black tracking-[0.25em] mb-5">
                PAQUETES
              </p>

              <h2 className="text-5xl md:text-7xl font-black leading-none">
                ELEGÍ CÓMO
                <br />
                QUERÉS VIAJAR
              </h2>
            </div>

            <p className="text-zinc-400 text-lg max-w-xl">
              La página no muestra precios para que la consulta se cierre por
              WhatsApp y se pueda manejar disponibilidad actualizada.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {packages.map((pack, index) => (
              <div
                key={pack.title}
                className={`rounded-[34px] border p-8 overflow-hidden relative ${
                  index === 1
                    ? "border-yellow-400/50 bg-yellow-400/10"
                    : "border-white/10 bg-white/[0.035]"
                }`}
              >
                <div className="absolute right-[-80px] top-[-80px] w-52 h-52 rounded-full bg-green-500/10 blur-2xl" />

                <div className="relative z-10">
                  <p
                    className={`font-black tracking-[0.2em] text-sm mb-4 ${
                      index === 1 ? "text-yellow-400" : "text-green-400"
                    }`}
                  >
                    OPCIÓN {index + 1}
                  </p>

                  <h3 className="text-3xl font-black mb-2">{pack.title}</h3>

                  <p className="text-zinc-400 mb-8">{pack.subtitle}</p>

                  <div className="space-y-5">
                    {pack.items.map((item) => (
                      <div key={item} className="flex gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                        <p className="text-zinc-300">{item}</p>
                      </div>
                    ))}
                  </div>

                  <Link
                    href="https://wa.me/543512520927"
                    target="_blank"
                    className="mt-9 inline-flex w-full justify-center bg-white text-black hover:bg-yellow-400 px-6 py-4 rounded-2xl font-black transition"
                  >
                    CONSULTAR ESTA OPCIÓN
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTORS */}
      <section id="sectores" className="px-6 py-28 border-t border-white/10">
        <div className="max-w-7xl mx-auto">
          <div className="mb-14">
            <p className="text-yellow-400 font-black tracking-[0.25em] mb-5">
              SECTORES DEL CIRCUITO
            </p>

            <h2 className="text-5xl md:text-7xl font-black leading-none">
              ELEGÍ TU LUGAR
              <br />
              EN LA ACCIÓN
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sectors.map((sector) => (
              <div
                key={sector.code}
                className="rounded-[30px] border border-white/10 bg-white/[0.035] overflow-hidden hover:-translate-y-2 transition"
              >
                <div className="relative h-48">
                  <Image
                    src="/interlagos-race.png"
                    alt="Interlagos"
                    fill
                    className="object-cover opacity-55"
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

                  <div
                    className={`absolute left-6 bottom-5 w-16 h-16 rounded-full flex items-center justify-center text-black text-3xl font-black ${
                      sector.tone === "green" ? "bg-green-500" : "bg-yellow-400"
                    }`}
                  >
                    {sector.code}
                  </div>
                </div>

                <div className="p-7">
                  <h3 className="text-2xl font-black mb-4">{sector.name}</h3>

                  <p className="text-zinc-400 leading-relaxed">
                    {sector.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BOOKING + PAYMENT */}
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

            <div className="space-y-5">
              {[
                "La reserva se confirma con una seña por pasajero.",
                "El saldo puede abonarse en cuotas mensuales o en un pago total.",
                "La fecha límite de pago total se informa al momento de reservar.",
                "La preventa se mantiene hasta agotar stock disponible.",
              ].map((text) => (
                <div key={text} className="flex gap-4">
                  <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0 mt-0.5" />
                  <p className="text-zinc-300">{text}</p>
                </div>
              ))}
            </div>
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

            <div className="space-y-5">
              {[
                "Efectivo en sucursales Tiul.",
                "Transferencia o depósito en dólares.",
                "Tarjeta de crédito con consumo en dólares.",
              ].map((text) => (
                <div key={text} className="flex gap-4">
                  <CreditCard className="w-6 h-6 text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-zinc-300">{text}</p>
                </div>
              ))}
            </div>
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
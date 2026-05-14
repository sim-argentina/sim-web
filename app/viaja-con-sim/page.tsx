"use client";

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
    {
      letra: "G",
      nombre: "RECTA TRASERA",
      texto: "Pasada la curva 3. Acceso a Fan Zone.",
      color: "green",
    },
    {
      letra: "A",
      nombre: "RECTA PRINCIPAL",
      texto: "Vista amplia de distintos sectores del circuito.",
      color: "yellow",
    },
    {
      letra: "R",
      nombre: "CURVA DO SOL",
      texto: "Vista técnica y salida de la Curva do Sol.",
      color: "green",
    },
    {
      letra: "H",
      nombre: "S DE SENNA",
      texto: "La vista más icónica. Mirá la S de Senna.",
      color: "yellow",
    },
    {
      letra: "M",
      nombre: "CURVA 1",
      texto: "Ideal para ver maniobras y duelos.",
      color: "green",
    },
    {
      letra: "D",
      nombre: "LARGADA",
      texto: "Vista de la largada e inicio de la S.",
      color: "yellow",
    },
  ];

  return (
    <main className="min-h-screen bg-black text-white overflow-hidden">
      {/* HERO */}
      <section className="relative px-6 pt-28 pb-20 overflow-hidden">
        {/* Fondo */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(250,204,21,0.18),transparent_28%),radial-gradient(circle_at_20%_50%,rgba(0,255,128,0.14),transparent_32%),linear-gradient(135deg,#010101_0%,#04110b_40%,#010101_100%)]" />

        <div className="absolute inset-0 opacity-[0.05] bg-[linear-gradient(90deg,white_1px,transparent_1px),linear-gradient(white_1px,transparent_1px)] bg-[size:50px_50px]" />

        {/* Líneas */}
        <div className="absolute top-0 right-0 w-[900px] h-[900px] rounded-full border-[120px] border-green-500/10" />
        <div className="absolute top-20 right-20 w-[700px] h-[700px] rounded-full border-[90px] border-yellow-400/10" />

        {/* Glow */}
        <div className="absolute right-[10%] top-[18%] w-[450px] h-[450px] bg-green-500/10 blur-[120px]" />
        <div className="absolute right-[15%] bottom-[5%] w-[350px] h-[350px] bg-yellow-400/10 blur-[120px]" />

        <div className="relative z-10 max-w-7xl mx-auto">
          {/* TOP */}
          <div className="flex items-center justify-between mb-16">
            <div className="flex items-center gap-5">
              <div className="text-4xl font-black italic tracking-tight">
                SIM
              </div>

              <span className="text-zinc-600 text-2xl">×</span>

              <div className="text-3xl font-black tracking-tight">
                Tiul
                <span className="text-sm ml-1 font-semibold">sports</span>
              </div>
            </div>

            <nav className="hidden lg:flex items-center gap-8 text-sm font-black tracking-widest text-zinc-200">
              <Link href="/">INICIO</Link>
              <Link href="/reservas">RESERVA</Link>
              <Link href="/viaja-con-sim" className="text-yellow-400">
                VIAJA CON SIM
              </Link>
              <Link href="/sobre-nosotros">SOBRE NOSOTROS</Link>
              <Link href="/novedades">NOVEDADES</Link>
              <Link href="/tienda">TIENDA</Link>
            </nav>
          </div>

          {/* CONTENIDO */}
          <div className="grid lg:grid-cols-[1fr_0.95fr] gap-14 items-center">
            {/* IZQUIERDA */}
            <div>
              <div className="inline-flex items-center gap-3 bg-yellow-400 text-black px-5 py-3 rounded-sm font-black text-sm mb-8">
                <Flag className="w-4 h-4" />
                VIVÍ LA F1 DONDE TODO PASA
              </div>

              <h1 className="text-6xl md:text-8xl lg:text-[8rem] font-black leading-[0.82] tracking-tight">
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
                  5 AL 9 DE NOVIEMBRE
                </div>
              </div>

              <p className="mt-8 max-w-xl text-zinc-300 text-lg leading-relaxed">
                Viví el Gran Premio de Brasil con SIM y Tiul Sports. Un viaje
                pensado para que disfrutes la Fórmula 1 desde adentro.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  href="https://wa.me/543512520927"
                  target="_blank"
                  className="bg-yellow-400 hover:bg-yellow-300 text-black px-8 py-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all duration-300 shadow-[0_0_40px_rgba(250,204,21,0.25)]"
                >
                  CONSULTAR DISPONIBILIDAD
                  <ArrowRight className="w-5 h-5" />
                </Link>

                <a
                  href="#sectores"
                  className="border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] px-8 py-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all duration-300"
                >
                  VER SECTORES
                </a>
              </div>
            </div>

            {/* DERECHA */}
            <div className="relative min-h-[620px] rounded-[42px] border border-white/10 bg-white/[0.03] overflow-hidden backdrop-blur-xl">
              {/* Glow */}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(250,204,21,0.14),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(34,197,94,0.18),transparent_35%)]" />

              {/* Bandera abstracta */}
              <div className="absolute top-[-120px] right-[-120px] w-[520px] h-[520px] rotate-[-20deg]">
                <div className="absolute inset-0 bg-gradient-to-br from-green-500 via-yellow-400 to-green-600 rounded-[40%] blur-sm opacity-70" />
              </div>

              {/* Auto abstracto */}
              <div className="absolute bottom-0 left-0 right-0 h-[280px]">
                <div className="absolute left-1/2 -translate-x-1/2 bottom-16 w-[85%] h-[90px] rounded-[100px] bg-gradient-to-r from-zinc-900 via-zinc-700 to-zinc-900 border border-white/10" />

                <div className="absolute left-[16%] bottom-8 w-28 h-28 rounded-full border-[14px] border-zinc-700 bg-black" />
                <div className="absolute right-[16%] bottom-8 w-28 h-28 rounded-full border-[14px] border-zinc-700 bg-black" />

                <div className="absolute left-1/2 -translate-x-1/2 bottom-10 w-5 h-16 bg-red-500 rounded-full shadow-[0_0_25px_rgba(255,0,0,0.9)]" />
              </div>

              {/* Frase */}
              <div className="absolute top-12 right-12 max-w-xs">
                <p className="text-green-400 text-6xl leading-none">“</p>

                <p className="text-3xl italic leading-tight text-zinc-100">
                  No es lo mismo simularlo que vivirlo.
                </p>
              </div>
            </div>
          </div>

          {/* BENEFICIOS */}
          <div className="mt-14 grid md:grid-cols-4 rounded-[28px] border border-yellow-400/30 bg-black/60 backdrop-blur-xl overflow-hidden">
            {[
              {
                icon: Plane,
                title: "VUELOS",
                text: "Salidas desde distintas ciudades.",
              },
              {
                icon: BedDouble,
                title: "HOTEL",
                text: "4 noches de alojamiento con desayuno.",
              },
              {
                icon: Ticket,
                title: "TICKETS F1",
                text: "Entrada para los 3 días del evento.",
              },
              {
                icon: ShieldCheck,
                title: "ASISTENCIA",
                text: "Acompañamiento y asistencia al viajero.",
              },
            ].map((item, index) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className={`p-7 flex gap-5 ${
                    index !== 3 ? "md:border-r border-white/10" : ""
                  }`}
                >
                  <Icon className="w-10 h-10 text-green-400 shrink-0" />

                  <div>
                    <h3 className="font-black mb-1">{item.title}</h3>
                    <p className="text-sm text-zinc-400">{item.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* INTERLAGOS */}
      <section className="relative px-6 py-24 border-t border-white/10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_40%,rgba(34,197,94,0.14),transparent_38%)]" />

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-[0.78fr_1.22fr] gap-14 items-center">
          {/* TEXTO */}
          <div>
            <p className="text-green-400 font-black tracking-[0.25em] mb-5">
              CIRCUITO
            </p>

            <h2 className="text-5xl md:text-7xl font-black leading-none mb-8">
              INTERLAGOS
            </h2>

            <p className="text-zinc-300 leading-relaxed text-lg mb-10">
              Un circuito icónico donde la destreza técnica y la velocidad se
              funden para definir cada vuelta. La mística S de Senna y la
              Subida dos Boxes crean un desafío único.
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

          {/* MAPA */}
          <div className="relative h-[580px] rounded-[44px] border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(90deg,white_1px,transparent_1px),linear-gradient(white_1px,transparent_1px)] bg-[size:42px_42px]" />

            {/* Circuito */}
            <div className="absolute left-[8%] top-[28%] w-[78%] h-[42%] rounded-[48%] border-[20px] border-yellow-400 shadow-[0_0_40px_rgba(250,204,21,0.3)] rotate-[-4deg]" />

            <div className="absolute left-[18%] top-[43%] w-[36%] h-[32%] rounded-[48%] border-[20px] border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.3)] rotate-[-18deg]" />

            <div className="absolute left-[46%] top-[22%] w-[30%] h-[31%] rounded-[48%] border-[18px] border-green-500 shadow-[0_0_35px_rgba(34,197,94,0.3)] rotate-[10deg]" />

            <div className="absolute left-[28%] bottom-[27%] w-[250px] h-[20px] bg-white rounded-full rotate-[-8deg]" />

            <div className="absolute right-[18%] top-[38%] w-[170px] h-[20px] bg-white rounded-full rotate-[16deg]" />

            {/* Texto */}
            <p className="absolute left-[36%] top-[44%] text-5xl font-black text-white/10 tracking-[0.2em]">
              INTERLAGOS
            </p>

            {/* Puntos */}
            {[
              ["G", "Recta Trasera", "left-[25%] bottom-[23%]", "green"],
              ["A", "Recta Principal", "left-[42%] bottom-[5%]", "yellow"],
              ["R", "Curva do Sol", "right-[22%] top-[8%]", "yellow"],
              ["H", "S de Senna", "right-[6%] top-[34%]", "yellow"],
              ["D", "Largada", "right-[2%] top-[57%]", "yellow"],
              ["M", "Curva 1", "right-[15%] bottom-[15%]", "yellow"],
            ].map(([letter, label, position, color]) => (
              <div key={letter} className={`absolute ${position}`}>
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-black ${
                    color === "green" ? "bg-green-500" : "bg-yellow-400"
                  }`}
                >
                  {letter}
                </div>

                <p className="text-xs font-bold text-zinc-300 mt-1">
                  {label}
                </p>
              </div>
            ))}

            <div className="absolute right-10 bottom-8 flex items-center gap-2 text-zinc-300 font-bold">
              <MapPin className="w-5 h-5" />
              Punto de encuentro
            </div>
          </div>
        </div>
      </section>

      {/* SECTORES */}
      <section
        id="sectores"
        className="px-6 py-24 border-t border-white/10"
      >
        <div className="max-w-7xl mx-auto">
          <p className="text-green-400 font-black tracking-[0.25em] mb-5">
            SECTORES
          </p>

          <h2 className="text-5xl md:text-6xl font-black leading-none mb-12">
            ELEGÍ TU EXPERIENCIA
          </h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-5">
            {sectores.map((sector) => (
              <div
                key={sector.letra}
                className="group rounded-[24px] border border-white/10 bg-white/[0.03] overflow-hidden hover:-translate-y-2 transition-all duration-300"
              >
                <div className="relative h-44 bg-gradient-to-br from-zinc-900 to-black overflow-hidden">
                  <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(120deg,transparent_0%,transparent_45%,white_46%,transparent_47%)] bg-[size:42px_42px]" />

                  <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black to-transparent" />

                  <div
                    className={`absolute left-5 bottom-4 w-12 h-12 rounded-full flex items-center justify-center text-black font-black text-2xl ${
                      sector.color === "green"
                        ? "bg-green-500"
                        : "bg-yellow-400"
                    }`}
                  >
                    {sector.letra}
                  </div>
                </div>

                <div className="p-5">
                  <h3 className="font-black uppercase mb-3">
                    {sector.nombre}
                  </h3>

                  <p className="text-sm text-zinc-400 leading-relaxed min-h-[90px]">
                    {sector.texto}
                  </p>

                  <div
                    className={`mt-5 h-1 w-16 ${
                      sector.color === "green"
                        ? "bg-green-500"
                        : "bg-yellow-400"
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EXPERIENCIA */}
      <section className="px-6 py-24 border-t border-white/10">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-3 gap-8 items-center">
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

          <div className="rounded-[32px] border border-green-500/50 bg-black p-10 text-center shadow-[0_0_50px_rgba(34,197,94,0.12)]">
            <Users className="w-14 h-14 text-green-400 mx-auto mb-5" />

            <p className="text-7xl font-black">250+</p>

            <p className="font-black mt-2">
              PERSONAS YA VIAJARON CON TIUL
            </p>

            <div className="flex justify-center gap-2 mt-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className="w-6 h-6 fill-yellow-400 text-yellow-400"
                />
              ))}
            </div>
          </div>

          <div className="relative rounded-[32px] border border-white/10 bg-white/[0.03] p-8 overflow-hidden">
            <div className="absolute right-[-60px] bottom-[-60px] w-48 h-48 bg-yellow-400/10 rounded-full blur-2xl" />

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

      {/* CTA FINAL */}
      <section className="relative px-6 py-10 bg-gradient-to-r from-green-600 via-yellow-400 to-yellow-500 text-black">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-8">
          <div>
            <p className="text-5xl font-black leading-none">
              BRASIL TE ESPERA
            </p>

            <p className="font-black mt-2 text-lg">
              NO ES LO MISMO SIMULARLO QUE VIVIRLO.
            </p>
          </div>

          <Link
            href="https://wa.me/543512520927"
            target="_blank"
            className="bg-black hover:bg-zinc-900 text-white px-9 py-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all duration-300"
          >
            HABLAR POR WHATSAPP
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </main>
  );
}
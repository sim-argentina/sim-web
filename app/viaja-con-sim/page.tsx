"use client";

import Link from "next/link";
import {
  Plane,
  Hotel,
  Ticket,
  ShieldCheck,
  CalendarDays,
  MapPin,
  Flag,
  Trophy,
  CreditCard,
  CheckCircle2,
  ArrowRight,
  Users,
} from "lucide-react";

export default function ViajaConSimPage() {
  const beneficios = [
    { icon: Plane, title: "Vuelos", text: "Salidas disponibles desde distintas ciudades." },
    { icon: Hotel, title: "Hotel", text: "4 noches de alojamiento con desayuno." },
    { icon: Ticket, title: "Tickets F1", text: "Entrada para los 3 días del Gran Premio." },
    { icon: ShieldCheck, title: "Asistencia", text: "Acompañamiento y asistencia al viajero." },
  ];

  const sectores = [
    { name: "G", title: "Recta trasera", text: "Pasada la curva 3. Acceso a Fan Zone." },
    { name: "A", title: "Recta principal", text: "Vista amplia de distintos sectores del circuito." },
    { name: "R", title: "Curva do Sol", text: "Inicio de recta trasera y vista técnica." },
    { name: "H", title: "S de Senna", text: "Una de las zonas más icónicas de Interlagos." },
    { name: "M", title: "Curva 1", text: "Ideal para ver maniobras y sobrepasos." },
    { name: "D", title: "Largada", text: "Final de recta principal e inicio de la S de Senna." },
  ];

  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-hidden">
      {/* HERO */}
      <section className="relative min-h-screen px-6 pt-28 pb-20 flex items-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(250,204,21,0.22),transparent_35%),radial-gradient(circle_at_15%_30%,rgba(34,197,94,0.22),transparent_32%),linear-gradient(135deg,#030303_0%,#07140b_50%,#050505_100%)]" />

        <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(90deg,white_1px,transparent_1px),linear-gradient(white_1px,transparent_1px)] bg-[size:56px_56px]" />

        <div className="absolute right-[-180px] top-20 w-[620px] h-[620px] rounded-full border-[80px] border-yellow-400/10" />
        <div className="absolute right-[-90px] top-44 w-[420px] h-[420px] rounded-full border-[50px] border-green-500/10" />

        <div className="relative z-10 max-w-7xl mx-auto w-full grid lg:grid-cols-[1.1fr_0.9fr] gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-3 bg-yellow-400 text-black px-5 py-3 rounded-full font-black text-sm mb-8 shadow-[0_0_40px_rgba(250,204,21,0.25)]">
              <Flag className="w-4 h-4" />
              VIVÍ LA F1 DONDE TODO PASA
            </div>

            <div className="flex items-center gap-4 mb-8">
              <span className="text-2xl font-black tracking-[0.35em]">SIM</span>
              <span className="text-zinc-500">×</span>
              <span className="text-2xl font-black tracking-[0.15em]">TIUL SPORTS</span>
            </div>

            <h1 className="text-6xl md:text-8xl lg:text-9xl font-black leading-[0.82] tracking-tight">
              GP DE
              <br />
              BRASIL
            </h1>

            <h2 className="mt-5 text-5xl md:text-7xl font-black italic leading-none text-green-500">
              INTERLAGOS
              <span className="text-yellow-400"> 2026</span>
            </h2>

            <div className="mt-8 flex flex-wrap gap-4 text-zinc-300">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-yellow-400" />
                São Paulo
              </div>

              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-yellow-400" />
                5 al 9 de noviembre
              </div>
            </div>

            <p className="mt-8 max-w-2xl text-lg text-zinc-300 leading-relaxed">
              Una landing para vender el viaje al GP de Brasil sin mostrar precios:
              foco en experiencia, cupos, sectores, beneficios y consulta por WhatsApp.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="https://wa.me/543512520927"
                target="_blank"
                className="bg-yellow-400 hover:bg-yellow-300 text-black px-8 py-5 rounded-2xl font-black flex items-center justify-center gap-3 transition shadow-[0_0_50px_rgba(250,204,21,0.25)]"
              >
                CONSULTAR DISPONIBILIDAD
                <ArrowRight className="w-5 h-5" />
              </Link>

              <a
                href="#sectores"
                className="border border-white/10 bg-white/5 hover:bg-white/10 px-8 py-5 rounded-2xl font-bold flex items-center justify-center gap-3 transition"
              >
                Ver sectores
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="relative rounded-[40px] border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.18),transparent_45%)]" />

              <div className="relative z-10">
                <p className="text-yellow-400 font-black tracking-[0.25em] text-sm mb-8">
                  VIAJE OFICIAL
                </p>

                <div className="space-y-5">
                  <div className="flex justify-between items-center border-b border-white/10 pb-5">
                    <span className="text-zinc-400">Destino</span>
                    <span className="font-black">São Paulo</span>
                  </div>

                  <div className="flex justify-between items-center border-b border-white/10 pb-5">
                    <span className="text-zinc-400">Evento</span>
                    <span className="font-black">Formula 1</span>
                  </div>

                  <div className="flex justify-between items-center border-b border-white/10 pb-5">
                    <span className="text-zinc-400">Circuito</span>
                    <span className="font-black">Interlagos</span>
                  </div>

                  <div className="flex justify-between items-center border-b border-white/10 pb-5">
                    <span className="text-zinc-400">Duración</span>
                    <span className="font-black">4 noches</span>
                  </div>
                </div>

                <div className="mt-10 rounded-3xl bg-gradient-to-br from-green-500 to-yellow-400 p-[1px]">
                  <div className="rounded-3xl bg-black p-8">
                    <p className="text-4xl font-black mb-3">250+</p>
                    <p className="text-zinc-300">
                      personas ya viajaron con Tiul a experiencias F1.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section className="px-6 py-24 bg-white text-black">
        <div className="max-w-7xl mx-auto">
          <p className="text-green-700 font-black tracking-[0.3em] mb-4">
            TODO INCLUIDO
          </p>

          <h2 className="text-5xl md:text-7xl font-black leading-none mb-12">
            SOLO PREOCUPATE
            <br />
            POR DISFRUTAR
          </h2>

          <div className="grid md:grid-cols-4 gap-5">
            {beneficios.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className="rounded-[28px] bg-zinc-100 border border-zinc-200 p-8"
                >
                  <Icon className="w-10 h-10 text-green-700 mb-6" />
                  <h3 className="text-2xl font-black mb-3">{item.title}</h3>
                  <p className="text-zinc-600 leading-relaxed">{item.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* INTERLAGOS */}
      <section className="relative px-6 py-28 bg-[#050505]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_40%,rgba(34,197,94,0.18),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(250,204,21,0.14),transparent_35%)]" />

        <div className="relative max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <p className="text-yellow-400 font-black tracking-[0.3em] mb-4">
              CIRCUITO
            </p>

            <h2 className="text-5xl md:text-7xl font-black leading-none mb-8">
              INTERLAGOS
              <br />
              NO PERDONA
            </h2>

            <p className="text-zinc-300 text-lg leading-relaxed">
              Un circuito icónico donde la velocidad, la técnica y la presión
              se mezclan en cada vuelta. La S de Senna, la Curva do Sol y la
              Subida dos Boxes hacen que este GP sea una experiencia única.
            </p>
          </div>

          <div className="relative h-[440px] rounded-[40px] border border-white/10 bg-white/[0.04] overflow-hidden p-8">
            <div className="absolute inset-0 opacity-10 bg-[linear-gradient(90deg,white_1px,transparent_1px),linear-gradient(white_1px,transparent_1px)] bg-[size:40px_40px]" />

            <div className="relative h-full rounded-[32px] border-4 border-green-500/60">
              <div className="absolute left-[12%] top-[46%] w-[76%] h-[34%] border-[18px] border-yellow-400 rounded-[50%]" />
              <div className="absolute left-[34%] top-[18%] w-[42%] h-[48%] border-[18px] border-green-500 rounded-[45%]" />
              <div className="absolute left-[22%] bottom-[22%] w-[180px] h-[18px] bg-white rounded-full rotate-[-8deg]" />
              <div className="absolute right-[18%] top-[28%] w-[120px] h-[18px] bg-white rounded-full rotate-[18deg]" />

              <div className="absolute left-8 bottom-8">
                <p className="text-zinc-400 text-sm">Track mood</p>
                <h3 className="text-4xl font-black">SENNA MODE</h3>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTORES */}
      <section id="sectores" className="px-6 py-24 bg-white text-black">
        <div className="max-w-7xl mx-auto">
          <p className="text-green-700 font-black tracking-[0.3em] mb-4">
            SECTORES DEL CIRCUITO
          </p>

          <h2 className="text-5xl md:text-7xl font-black leading-none mb-12">
            ELEGÍ TU LUGAR
            <br />
            EN LA ACCIÓN
          </h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sectores.map((sector) => (
              <div
                key={sector.name}
                className="rounded-[30px] bg-black text-white p-7 border border-zinc-800 relative overflow-hidden"
              >
                <div className="absolute right-[-30px] top-[-30px] w-32 h-32 rounded-full bg-yellow-400/20" />

                <div className="w-16 h-16 rounded-full bg-yellow-400 text-black flex items-center justify-center text-3xl font-black mb-8">
                  {sector.name}
                </div>

                <h3 className="text-2xl font-black mb-3">{sector.title}</h3>

                <p className="text-zinc-400 leading-relaxed">{sector.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RESERVA */}
      <section className="px-6 py-28 bg-[#050505]">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-8">
          <div className="rounded-[40px] border border-white/10 bg-white/[0.04] p-10">
            <p className="text-green-400 font-black tracking-[0.25em] mb-5">
              CÓMO RESERVAR
            </p>

            <h2 className="text-4xl md:text-6xl font-black leading-none mb-8">
              ASEGURÁ
              <br />
              TU LUGAR
            </h2>

            <div className="space-y-5">
              {[
                "Reserva con seña por pasajero.",
                "Posibilidad de cuotas mensuales o pago total.",
                "Cupos sujetos a disponibilidad.",
                "La preventa se mantiene hasta agotar stock.",
              ].map((text) => (
                <div key={text} className="flex gap-3">
                  <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0" />
                  <p className="text-zinc-300">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[40px] border border-white/10 bg-gradient-to-br from-green-500/15 to-yellow-400/10 p-10">
            <p className="text-yellow-400 font-black tracking-[0.25em] mb-5">
              FORMAS DE PAGO
            </p>

            <h2 className="text-4xl md:text-6xl font-black leading-none mb-8">
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
                <div key={text} className="flex gap-3">
                  <CreditCard className="w-6 h-6 text-yellow-400 shrink-0" />
                  <p className="text-zinc-300">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative px-6 py-28 bg-white text-black">
        <div className="max-w-6xl mx-auto rounded-[44px] bg-black text-white p-10 md:p-16 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.25),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(250,204,21,0.18),transparent_35%)]" />

          <div className="relative z-10 grid lg:grid-cols-[1fr_auto] gap-10 items-center">
            <div>
              <p className="text-green-400 font-black tracking-[0.3em] mb-5">
                BRASIL TE ESPERA
              </p>

              <h2 className="text-5xl md:text-7xl font-black leading-none mb-6">
                NO ES LO MISMO
                <br />
                SIMULARLO
                <br />
                QUE VIVIRLO
              </h2>

              <p className="text-zinc-300 text-lg max-w-2xl">
                Consultá disponibilidad para el viaje al GP de Brasil 2026.
              </p>
            </div>

            <Link
              href="https://wa.me/543512520927"
              target="_blank"
              className="bg-yellow-400 hover:bg-yellow-300 text-black px-9 py-6 rounded-2xl font-black flex items-center justify-center gap-3 transition"
            >
              HABLAR POR WHATSAPP
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-8 flex flex-wrap gap-4 text-zinc-500 text-sm">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Viaje organizado junto a Tiul Sports.
          </div>

          <div>
            Tarifas sujetas a modificación y disponibilidad al momento de reservar.
          </div>
        </div>
      </section>
    </main>
  );
}